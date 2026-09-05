import { cloningPrimerTm } from '../calculations/oligo.js';
import { reverseComplementDna } from '../calculations/sequence.js';
import { asArray, computeGcContent, mean, normalizeSequence } from './sequence-utils.js';
import { evaluatePrimerPairQuality, evaluatePrimerQuality } from './primer-quality.js';

export function buildPrimerRecord({
  name,
  role,
  sequence,
  tailSequence = '',
  bindingSequence = '',
  tmSequence = '',
  warnings = [],
  groupLabel = '',
  ampliconLength = 0,
  templateId = ''
}) {
  const safeSequence = normalizeSequence(sequence);
  const safeTail = normalizeSequence(tailSequence);
  const safeBinding = normalizeSequence(bindingSequence);
  const safeTmSequence = normalizeSequence(tmSequence);
  const tmTarget = safeTmSequence || (safeBinding.length ? safeBinding : safeSequence);
  const quality = evaluatePrimerQuality(safeSequence);

  return {
    name: String(name || '').trim() || 'primer',
    role: String(role || '').trim() || 'primer',
    sequence: safeSequence,
    tailSequence: safeTail,
    bindingSequence: safeBinding,
    tm: tmTarget.length ? cloningPrimerTm(tmTarget) : 0,
    length: safeSequence.length,
    gcContent: computeGcContent(safeSequence),
    warnings: asArray(warnings).filter(Boolean),
    qualityWarnings: quality.warnings,
    qualityBlockingWarnings: quality.blockingWarnings,
    groupLabel: String(groupLabel || '').trim(),
    ampliconLength: Math.max(0, Math.round(Number(ampliconLength) || 0)),
    templateId: String(templateId || '').trim()
  };
}

const TEMPLATE_SEED_LENGTH = 18;
// A repeat-heavy pair can offer the same seed from dozens of places, and every
// one of them would be extended.
// ponytail: 4 hits per seed caps that; raise it if a real donor ever loses its
// core to a repeat.
const MAX_SEED_HITS = 4;

export function findTemplateCoreInDesiredSequence(desiredSequence, templateSequence) {
  const desired = normalizeSequence(desiredSequence);
  const template = normalizeSequence(templateSequence);
  if (!desired.length || !template.length) {
    return null;
  }

  const exactIndex = desired.indexOf(template);
  if (exactIndex >= 0) {
    return {
      desiredStart: exactIndex,
      templateStart: 0,
      length: template.length
    };
  }

  // The donor case: the whole fragment sits somewhere inside a much larger
  // plasmid. One native scan, rather than the seed walk below.
  const donorIndex = template.indexOf(desired);
  if (donorIndex >= 0) {
    return {
      desiredStart: 0,
      templateStart: donorIndex,
      length: desired.length
    };
  }

  // Longest shared stretch, found by extending shared seeds. Re-scanning every
  // candidate length instead cost ~20 s of frozen UI whenever nothing matched
  // (1.5 kb insert against a 10 kb plasmid) -- and nothing matching is exactly
  // the wrong-donor case the caller exists to warn about.
  const seedLength = Math.min(TEMPLATE_SEED_LENGTH, desired.length, template.length);
  const seeds = new Map();
  for (let index = 0; index + seedLength <= desired.length; index += 1) {
    const seed = desired.slice(index, index + seedLength);
    const hits = seeds.get(seed);
    if (!hits) {
      seeds.set(seed, [index]);
    } else if (hits.length < MAX_SEED_HITS) {
      hits.push(index);
    }
  }

  let best = null;
  for (let templateStart = 0; templateStart + seedLength <= template.length; templateStart += 1) {
    const hits = seeds.get(template.slice(templateStart, templateStart + seedLength));
    if (!hits) {
      continue;
    }
    hits.forEach((desiredStart) => {
      let left = 0;
      while (
        desiredStart - left > 0
        && templateStart - left > 0
        && desired[desiredStart - left - 1] === template[templateStart - left - 1]
      ) {
        left += 1;
      }
      let right = seedLength;
      while (
        desiredStart + right < desired.length
        && templateStart + right < template.length
        && desired[desiredStart + right] === template[templateStart + right]
      ) {
        right += 1;
      }
      if (!best || left + right > best.length) {
        best = {
          desiredStart: desiredStart - left,
          templateStart: templateStart - left,
          length: left + right
        };
      }
    });
  }

  return best;
}

function blockedTemplate(desiredSequence, warning) {
  return {
    feasible: false,
    desiredSequence,
    templateSequence: '',
    forwardAddedSequence: '',
    reverseAddedSequence: '',
    warnings: [warning],
    blockingWarnings: [warning]
  };
}

export function resolveFragmentPrimerTemplate(fragment = {}) {
  const templateName = String(fragment?.metadata?.templateName || '').trim();
  const source = String(fragment?.metadata?.source || '').trim().toLowerCase();
  const desiredSequence = normalizeSequence(fragment?.sequence || '');
  const rawTemplateSequence = normalizeSequence(
    fragment?.templateSequence
    || fragment?.metadata?.templateSequence
    || fragment?.metadata?.sourceTemplateSequence
    || ''
  );
  // Anything shorter than one primer seed cannot be amplified off, so it is no
  // template at all rather than a wrong one -- a de-novo insertion's mapped
  // pre-edit range can leave a couple of shared boundary bases behind. Routing
  // it through the missing-template branch below states the actionable cause
  // (pick a donor, or order the fragment) instead of blaming the sequence.
  const templateSequence = rawTemplateSequence.length >= TEMPLATE_SEED_LENGTH ? rawTemplateSequence : '';

  if (!desiredSequence.length) {
    return blockedTemplate('', `${fragment?.name || 'This fragment'} has no sequence to amplify.`);
  }

  if (!templateSequence.length) {
    const canUseDesiredAsPhysicalTemplate = !source
      || source === 'provided_fragment'
      || source === 'physical_fragment'
      || source === 'synthesis'
      || String(fragment?.role || fragment?.type || '').toLowerCase() === 'backbone';
    if (!canUseDesiredAsPhysicalTemplate) {
      return blockedTemplate(
        desiredSequence,
        `${fragment?.name || 'Insert'} has no physical PCR template. Choose a donor record or mark the fragment for DNA synthesis before designing primers.`
      );
    }
    return {
      feasible: true,
      desiredSequence,
      templateSequence: desiredSequence,
      forwardAddedSequence: '',
      reverseAddedSequence: '',
      warnings: source === 'synthesis'
        ? [`${fragment?.name || 'Insert'} must be ordered as synthetic DNA before assembly; the listed primers assume that synthesized fragment is available.`]
        : [],
      blockingWarnings: []
    };
  }

  const core = findTemplateCoreInDesiredSequence(desiredSequence, templateSequence);
  // A one- or two-base accidental match is not a PCR template. Requiring one
  // full primer-sized seed also turns a de-novo insertion (whose mapped
  // pre-edit range can retain a shared boundary base) into the actionable
  // donor/synthesis error instead of a misleading Tm failure.
  if (!core || core.length < TEMPLATE_SEED_LENGTH) {
    return blockedTemplate(desiredSequence, templateName
      ? `${templateName} does not contain this insert, so it cannot be the PCR template. Choose the correct donor plasmid or change the amplicon range.`
      : 'The stated PCR template does not contain the desired fragment. Provide the correct physical template or order the fragment by synthesis.');
  }

  const templateCore = templateSequence.slice(core.templateStart, core.templateStart + core.length);
  return {
    feasible: true,
    desiredSequence,
    templateSequence: templateCore,
    forwardAddedSequence: desiredSequence.slice(0, core.desiredStart),
    reverseAddedSequence: desiredSequence.slice(core.desiredStart + core.length),
    warnings: [],
    blockingWarnings: []
  };
}

// Group primers into forward/reverse pairs by their shared `<base> F` / `<base> R`
// name (an underscore separator is the older engine form). Returns one entry per
// complete pair; primers without an F/R suffix (e.g. multi-oligo tiles) are excluded.
export function forwardReversePairs(primers) {
  const pairs = new Map();
  asArray(primers).forEach((primer) => {
    const match = String(primer?.name || '').match(/^(.*)[_ ]([FR])$/);
    if (!match) {
      return;
    }
    const group = pairs.get(match[1]) || { base: match[1] };
    group[match[2]] = Number(primer?.tm) || 0;
    // Carry the primer itself: the separator varies, so callers must not have to
    // rebuild the name to find its partner.
    group[`primer${match[2]}`] = primer;
    pairs.set(match[1], group);
  });
  return [...pairs.values()].filter((group) => Number.isFinite(group.F) && Number.isFinite(group.R));
}

export function summarizePrimerPlan(primers, overlaps = []) {
  const safePrimers = asArray(primers);
  const tmValues = safePrimers.map((primer) => Number(primer?.tm) || 0);
  const sortedTm = [...tmValues].sort((left, right) => left - right);

  const qualityWarnings = safePrimers.flatMap((primer) => (
    asArray(primer?.qualityWarnings).map((warning) => `${primer.name}: ${warning}`)
  ));
  const qualityBlockers = safePrimers.flatMap((primer) => (
    asArray(primer?.qualityBlockingWarnings).map((warning) => `${primer.name}: ${warning}`)
  ));
  forwardReversePairs(safePrimers).forEach((group) => {
    const forward = group.primerF;
    const reverse = group.primerR;
    if (reverseComplementDna(normalizeSequence(forward?.sequence || '')) === normalizeSequence(reverse?.sequence || '')) {
      return;
    }
    const pairQuality = evaluatePrimerPairQuality(forward, reverse);
    pairQuality.warnings.forEach((warning) => {
      qualityWarnings.push(`${forward?.name}/${reverse?.name}: ${warning}`);
    });
    pairQuality.blockingWarnings.forEach((warning) => {
      qualityBlockers.push(`${forward?.name}/${reverse?.name}: ${warning}`);
    });
  });

  return {
    primerCount: safePrimers.length,
    primerOrder: safePrimers.map((primer) => primer.name),
    primerTmSummary: {
      min: safePrimers.length ? sortedTm[0] : 0,
      max: safePrimers.length ? sortedTm[sortedTm.length - 1] : 0,
      mean: mean(tmValues)
    },
    primerTmDifferences: forwardReversePairs(safePrimers).map((group) => ({
      pair: group.base,
      tmDifference: Math.abs(group.F - group.R) < 1e-9 ? 0 : Math.abs(group.F - group.R)
    })),
    qualityWarnings: [...new Set(qualityWarnings)],
    qualityBlockers: [...new Set(qualityBlockers)],
    overlapSummary: asArray(overlaps).map((item) => ({
      leftFragmentId: item.leftFragmentId,
      rightFragmentId: item.rightFragmentId,
      overlapLength: item.overlapLength,
      overlapTm: item.overlapTm,
      mode: item.mode
    }))
  };
}

export function buildRouteWarnings(result) {
  return asArray(result?.warnings).filter(Boolean);
}
