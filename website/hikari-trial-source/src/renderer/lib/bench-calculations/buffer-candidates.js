import { BUFFER_COMPOUNDS } from '../chemistry/buffer-compounds.js';
import { resolveBufferCompound } from './buffer-concentration.js';

function normalizeBufferCandidateName(value) {
  return String(value || '').trim().toLowerCase();
}

// Stored chemical records come from several import formats, so accept the
// common spellings of each field.
function extractCompoundMw(record) {
  const source = record && typeof record === 'object' ? record : {};
  const keys = ['mw', 'molecularWeight', 'molecular_weight', 'formulaWeight', 'formula_weight', 'formulaMass', 'molarMass', 'fw'];
  for (const key of keys) {
    const parsed = Number(source[key]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return '';
}

function extractCompoundPka(record) {
  const source = record && typeof record === 'object' ? record : {};
  const keys = ['pKa', 'pka', 'pkaValue', 'pka_value'];
  for (const key of keys) {
    const parsed = Number(source[key]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return '';
}

function inferCompoundForm(record) {
  const source = record && typeof record === 'object' ? record : {};
  const formText = [
    source.form,
    source.physicalForm,
    source.state,
    source.type,
    source.unitSize,
    source.amountInStock
  ].map((item) => String(item || '').toLowerCase()).join(' ');
  return /\b(liquid|solution|ml|ul|l)\b/.test(formText) ? 'liquid' : 'solid';
}

// Ingredient suggestions for the buffer tool: the user's stored chemicals
// merged with the built-in BUFFER_COMPOUNDS by case-insensitive name. A stored
// record wins field by field; the built-in list only fills gaps it leaves.
function buildBufferCandidates({ storedCompounds = [] } = {}) {
  const candidates = new Map();

  function mergeCandidate(candidate) {
    const name = String(candidate?.name || '').trim();
    if (!name) {
      return;
    }
    const key = normalizeBufferCandidateName(name);
    const existing = candidates.get(key);
    if (!existing) {
      candidates.set(key, { ...candidate, name });
      return;
    }
    if (candidate.source === 'Stored') {
      candidates.set(key, {
        ...existing,
        ...candidate,
        mw: candidate.mw || existing.mw,
        form: candidate.form || existing.form,
        category: candidate.category || existing.category,
        pKa: candidate.pKa || existing.pKa
      });
      return;
    }
    candidates.set(key, {
      ...existing,
      mw: existing.mw || candidate.mw,
      form: existing.form || candidate.form,
      category: existing.category || candidate.category,
      pKa: existing.pKa || candidate.pKa
    });
  }

  (Array.isArray(storedCompounds) ? storedCompounds : []).forEach((record) => {
    mergeCandidate({
      source: 'Stored',
      name: record?.name,
      mw: extractCompoundMw(record),
      pKa: extractCompoundPka(record),
      form: inferCompoundForm(record),
      category: record?.casNumber ? `CAS ${record.casNumber}` : 'Stored compound'
    });
  });
  BUFFER_COMPOUNDS.forEach((compound) => {
    mergeCandidate({
      source: 'Tools',
      name: compound.name,
      mw: compound.mw,
      pKa: compound.pKa,
      form: compound.form === 'liquid' ? 'liquid' : 'solid',
      category: compound.category || 'Buffer compound'
    });
  });
  return [...candidates.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function findBufferCandidate(name, options = {}) {
  const key = normalizeBufferCandidateName(name);
  if (!key) {
    return null;
  }
  return buildBufferCandidates(options)
    .find((candidate) => normalizeBufferCandidateName(candidate.name) === key)
    || resolveBufferCompound(name)
    || null;
}

function bufferCandidateForm(name, options = {}) {
  const candidate = findBufferCandidate(name, options);
  return candidate?.form === 'liquid' ? 'liquid' : 'solid';
}

export {
  bufferCandidateForm,
  buildBufferCandidates,
  extractCompoundMw,
  extractCompoundPka,
  findBufferCandidate,
  inferCompoundForm,
  normalizeBufferCandidateName
};
