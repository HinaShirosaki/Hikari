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
// Only terminal additions that can fit on primers may be inferred from the
// chosen template. Searching arbitrary internal shared blocks turned unrelated
// stock similarity into hundreds of bases of invented primer tail.
const MAX_TERMINAL_ADDITION = 60;

export function findTemplateCoreInDesiredSequence(desiredSequence, templateSequence) {
  const desired = normalizeSequence(desiredSequence);
  const template = normalizeSequence(templateSequence);
  if (!desired.length || !template.length) {
    return null;
  }
  const exactIndex = desired.indexOf(template);
  if (exactIndex >= 0) {
    return { desiredStart: exactIndex, templateStart: 0, length: template.length };
  }
  const maxTrim = Math.min(2 * MAX_TERMINAL_ADDITION, desired.length - TEMPLATE_SEED_LENGTH);
  for (let trimmed = 0; trimmed <= maxTrim; trimmed += 1) {
    for (let left = Math.max(0, trimmed - MAX_TERMINAL_ADDITION); left <= Math.min(trimmed, MAX_TERMINAL_ADDITION); left += 1) {
      const length = desired.length - trimmed;
      const templateStart = template.indexOf(desired.slice(left, left + length));
      if (templateStart >= 0) {
        return { desiredStart: left, templateStart, length };
      }
    }
  }
  return null;
}

// A PCR template is double-stranded. A feature stored from (or dropped onto) a
// minus-strand site reads as the reverse complement of the donor's plus strand,
// and scanning only the plus strand called that "wrong donor" -- every insert
// route came back infeasible for a swap that is perfectly amplifiable.
function findTemplateCoreOnEitherStrand(desiredSequence, templateSequence, circular = false) {
  let best = { core: null, templateSequence };
  for (const strand of [templateSequence, reverseComplementDna(templateSequence)]) {
    const searchSequence = circular ? `${strand}${strand}` : strand;
    const core = findTemplateCoreInDesiredSequence(desiredSequence, searchSequence);
    if (core && core.length <= strand.length && core.templateStart < strand.length && core.length > (best.core?.length || 0)) {
      best = { core, templateSequence: searchSequence };
    }
    if (best.core?.length === normalizeSequence(desiredSequence).length) {
      break;
    }
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

// Primers designed off the assembled fragment itself, with whatever the stored
// template could not confirm reported as a note. The template is the user's
// declared choice -- Vector Builder and Protein Builder both make them pick it
// -- so a library copy that does not visibly carry the fragment is a stale or
// oppositely-annotated record far more often than a wrong tube, and it must not
// veto a design the bench can run.
function untemplatedDesign(desiredSequence, warnings) {
  return {
    feasible: true,
    desiredSequence,
    templateSequence: desiredSequence,
    forwardAddedSequence: '',
    reverseAddedSequence: '',
    warnings: warnings.filter(Boolean),
    blockingWarnings: []
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
    const isDeclaredPhysicalFragment = !source
      || source === 'provided_fragment'
      || source === 'physical_fragment'
      || source === 'synthesis'
      || String(fragment?.role || fragment?.type || '').toLowerCase() === 'backbone';
    return untemplatedDesign(desiredSequence, [
      source === 'synthesis'
        ? `${fragment?.name || 'Insert'} must be ordered as synthetic DNA before assembly; the listed primers assume that synthesized fragment is available.`
        : '',
      isDeclaredPhysicalFragment
        ? ''
        : `${fragment?.name || 'Insert'} names no PCR template, so its primers were designed off the assembled sequence. Confirm what goes in the tube, or order the fragment by synthesis.`
    ]);
  }

  // A one- or two-base accidental match is no template at all -- a de-novo
  // insertion's mapped pre-edit range can retain a shared boundary base -- so a
  // core has to be at least one primer seed long to be worth binding to.
  const { core, templateSequence: strandTemplate } =
    findTemplateCoreOnEitherStrand(desiredSequence, templateSequence, Boolean(fragment?.metadata?.specificityCircular));
  if (!core || core.length < TEMPLATE_SEED_LENGTH) {
    return untemplatedDesign(desiredSequence, [
      `${templateName || 'The stated template'} does not visibly carry this fragment; its primers were designed off the assembled sequence. Confirm the template before ordering.`
    ]);
  }

  const templateCore = strandTemplate.slice(core.templateStart, core.templateStart + core.length);
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

export function fragmentPrimerConfig(fragment, config = {}) {
  const metadata = fragment?.metadata || {};
  return metadata.specificitySequence
    ? { ...config, specificitySequence: metadata.specificitySequence, specificityCircular: Boolean(metadata.specificityCircular) }
    : config;
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
