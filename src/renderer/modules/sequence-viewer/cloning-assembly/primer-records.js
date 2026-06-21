import { oligoTm } from '../../tool-box/oligo.js';
import { asArray, computeGcContent, mean, normalizeSequence } from './sequence-utils.js';

export function buildPrimerRecord({ name, role, sequence, tailSequence = '', bindingSequence = '', tmSequence = '', warnings = [] }) {
  const safeSequence = normalizeSequence(sequence);
  const safeTail = normalizeSequence(tailSequence);
  const safeBinding = normalizeSequence(bindingSequence);
  const safeTmSequence = normalizeSequence(tmSequence);
  const tmTarget = safeTmSequence || (safeBinding.length ? safeBinding : safeSequence);

  return {
    name: String(name || '').trim() || 'primer',
    role: String(role || '').trim() || 'primer',
    sequence: safeSequence,
    tailSequence: safeTail,
    bindingSequence: safeBinding,
    tm: tmTarget.length ? oligoTm(tmTarget, 'DNA') : 0,
    length: safeSequence.length,
    gcContent: computeGcContent(safeSequence),
    warnings: asArray(warnings).filter(Boolean)
  };
}

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

  const minimumUsefulLength = Math.min(18, desired.length, template.length);
  for (let length = Math.min(desired.length, template.length); length >= minimumUsefulLength; length -= 1) {
    for (let templateStart = 0; templateStart + length <= template.length; templateStart += 1) {
      const candidate = template.slice(templateStart, templateStart + length);
      const desiredStart = desired.indexOf(candidate);
      if (desiredStart >= 0) {
        return {
          desiredStart,
          templateStart,
          length
        };
      }
    }
  }

  return null;
}

export function resolveFragmentPrimerTemplate(fragment = {}) {
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
      warnings: ['Template sequence did not align to the desired fragment; primer binding falls back to the desired fragment sequence.']
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

// Group primers into forward/reverse pairs by their shared `<base>_F` / `<base>_R`
// name. Returns one entry per complete pair; primers without an `_F`/`_R` suffix
// (e.g. multi-oligo tiles) are excluded.
export function forwardReversePairs(primers) {
  const pairs = new Map();
  asArray(primers).forEach((primer) => {
    const match = String(primer?.name || '').match(/^(.*)_([FR])$/);
    if (!match) {
      return;
    }
    const group = pairs.get(match[1]) || { base: match[1] };
    group[match[2]] = Number(primer?.tm) || 0;
    pairs.set(match[1], group);
  });
  return [...pairs.values()].filter((group) => Number.isFinite(group.F) && Number.isFinite(group.R));
}

export function summarizePrimerPlan(primers, overlaps = []) {
  const safePrimers = asArray(primers);
  const tmValues = safePrimers.map((primer) => Number(primer?.tm) || 0);
  const sortedTm = [...tmValues].sort((left, right) => left - right);

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
      tmDifference: Math.abs(group.F - group.R)
    })),
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
