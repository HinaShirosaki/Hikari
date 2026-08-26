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

export function resolveFragmentPrimerTemplate(fragment = {}) {
  const templateName = String(fragment?.metadata?.templateName || '').trim();
  const desiredSequence = normalizeSequence(fragment?.sequence || '');
  const templateSequence = normalizeSequence(
    fragment?.templateSequence
    || fragment?.metadata?.templateSequence
    || fragment?.metadata?.sourceTemplateSequence
    || ''
  );

  if (!desiredSequence.length) {
    return {
      desiredSequence: '',
      templateSequence: '',
      forwardAddedSequence: '',
      reverseAddedSequence: '',
      warnings: []
    };
  }

  if (!templateSequence.length) {
    return {
      desiredSequence,
      templateSequence: desiredSequence,
      forwardAddedSequence: '',
      reverseAddedSequence: '',
      warnings: []
    };
  }

  const core = findTemplateCoreInDesiredSequence(desiredSequence, templateSequence);
  if (!core) {
    return {
      desiredSequence,
      templateSequence: desiredSequence,
      forwardAddedSequence: '',
      reverseAddedSequence: '',
      warnings: [templateName
        ? `${templateName} does not contain this insert, so it cannot be the PCR template; primer binding falls back to the insert sequence. Check the donor plasmid or the amplicon range.`
        : 'Template sequence did not align to the desired fragment; primer binding falls back to the desired fragment sequence.']
    };
  }

  const templateCore = templateSequence.slice(core.templateStart, core.templateStart + core.length);
  return {
    desiredSequence,
    templateSequence: templateCore,
    forwardAddedSequence: desiredSequence.slice(0, core.desiredStart),
    reverseAddedSequence: desiredSequence.slice(core.desiredStart + core.length),
    warnings: []
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
  forwardReversePairs(safePrimers).forEach((group) => {
    const forward = group.primerF;
    const reverse = group.primerR;
    if (reverseComplementDna(normalizeSequence(forward?.sequence || '')) === normalizeSequence(reverse?.sequence || '')) {
      return;
    }
    evaluatePrimerPairQuality(forward, reverse).warnings.forEach((warning) => {
      qualityWarnings.push(`${forward?.name}/${reverse?.name}: ${warning}`);
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
