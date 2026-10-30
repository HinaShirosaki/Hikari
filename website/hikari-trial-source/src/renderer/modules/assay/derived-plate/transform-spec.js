const ARITHMETIC_OPS = Object.freeze(['none', 'add', 'subtract', 'multiply', 'divide']);
const VALUE_TRANSFORMS = Object.freeze(['none', 'log10', 'ln', 'sqrt', 'reciprocal', 'square']);
const TRANSFORM_MODES = Object.freeze(['steps', 'formula', 'cells']);

const TRANSFORM_LABELS = Object.freeze({
  log10: 'log10(x)',
  ln: 'ln(x)',
  sqrt: 'sqrt(x)',
  reciprocal: '1/x',
  square: 'x^2'
});

const ARITHMETIC_LABELS = Object.freeze({
  add: 'Added',
  subtract: 'Subtracted',
  multiply: 'Multiplied by',
  divide: 'Divided by'
});

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function cleanReference(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanFormulaCells(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value).reduce((cells, [rawWell, rawFormula]) => {
    const well = String(rawWell || '').trim().toUpperCase();
    const formula = String(rawFormula || '').trim().slice(0, 500);
    if (well && formula) {
      cells[well] = formula;
    }
    return cells;
  }, {});
}

function normalizeTransformSpec(input) {
  const source = input && typeof input === 'object' ? input : {};
  // Number('') is 0, and the operand arrives as a raw DOM string: an empty box has to
  // stay null or "multiply" would silently zero the whole plate.
  const rawArithmetic = String(source.arithmeticValue ?? '').trim();
  const arithmeticValue = rawArithmetic ? Number(rawArithmetic) : NaN;
  return {
    mode: pick(source.mode, TRANSFORM_MODES, 'steps'),
    enabled: source.enabled === true,
    formulas: cleanFormulaCells(source.formulas),
    formula: String(source.formula || '').slice(0, 500),
    blank: cleanReference(source.blank),
    normalizeHundred: cleanReference(source.normalizeHundred),
    normalizeZero: cleanReference(source.normalizeZero),
    arithmeticOp: pick(source.arithmeticOp, ARITHMETIC_OPS, 'none'),
    arithmeticValue: Number.isFinite(arithmeticValue) ? arithmeticValue : null,
    transform: pick(source.transform, VALUE_TRANSFORMS, 'none')
  };
}

function isTransformActive(spec) {
  const normalized = normalizeTransformSpec(spec);
  if (normalized.mode === 'cells') {
    return normalized.enabled || Boolean(Object.keys(normalized.formulas).length);
  }
  if (normalized.mode === 'formula') {
    return Boolean(normalized.formula.trim());
  }
  return Boolean(
    normalized.blank
    || normalized.normalizeHundred
    || normalized.normalizeZero
    || (normalized.arithmeticOp !== 'none' && Number.isFinite(normalized.arithmeticValue))
    || normalized.transform !== 'none'
  );
}

export {
  ARITHMETIC_LABELS,
  ARITHMETIC_OPS,
  TRANSFORM_LABELS,
  TRANSFORM_MODES,
  VALUE_TRANSFORMS,
  cleanFormulaCells,
  cleanReference,
  isTransformActive,
  normalizeTransformSpec
};
