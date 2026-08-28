const BUFFER_MASS_FACTORS_G = {
  ng: 1e-9,
  ug: 1e-6,
  mg: 1e-3,
  g: 1,
  kg: 1e3
};

const BUFFER_VOLUME_FACTORS_L = {
  nL: 1e-9,
  uL: 1e-6,
  mL: 1e-3,
  L: 1
};

const BUFFER_PKA_HINTS = [
  { pattern: /\bmes\b/i, pKa: 6.1, label: 'MES' },
  { pattern: /\bbis[- ]?tris\b/i, pKa: 6.5, label: 'Bis-Tris' },
  { pattern: /\baces\b/i, pKa: 6.73, label: 'ACES' },
  { pattern: /\bpipes\b/i, pKa: 6.76, label: 'PIPES' },
  { pattern: /\bbes\b/i, pKa: 7.09, label: 'BES' },
  { pattern: /\bmops\b/i, pKa: 7.2, label: 'MOPS' },
  { pattern: /\b(?:phosphate|hpo4|h2po4|kh2po4|na2hpo4|nah2po4)\b/i, pKa: 7.21, label: 'phosphate' },
  { pattern: /\btes\b/i, pKa: 7.4, label: 'TES' },
  { pattern: /\bhepes\b/i, pKa: 7.48, label: 'HEPES' },
  { pattern: /\b(?:tris|tris-hcl)\b/i, pKa: 8.06, label: 'Tris' },
  { pattern: /\btricine\b/i, pKa: 8.05, label: 'Tricine' },
  { pattern: /\bbicine\b/i, pKa: 8.35, label: 'Bicine' },
  { pattern: /\btaps\b/i, pKa: 8.4, label: 'TAPS' },
  { pattern: /\b(?:epps|hepps)\b/i, pKa: 8, label: 'EPPS' },
  { pattern: /\b(?:gly[- ]?gly|glycylglycine)\b/i, pKa: 8.2, label: 'Gly-Gly' },
  { pattern: /\bches\b/i, pKa: 9.3, label: 'CHES' },
  { pattern: /\bglycine\b/i, pKa: 9.78, label: 'Glycine' },
  { pattern: /\b(?:carbonate|bicarbonate)\b/i, pKa: 10.33, label: 'carbonate' },
  { pattern: /\bcaps\b/i, pKa: 10.4, label: 'CAPS' },
  { pattern: /\bacetate\b/i, pKa: 4.76, label: 'acetate' }
];

const BUFFER_PH_ADJUSTMENT_MOLARITY = 6;
const VOLUME_EPSILON_L = 1e-15;
const ADAPTIVE_VOLUME_UNITS = [
  { unit: 'L', factor: 1 },
  { unit: 'mL', factor: 1e-3 },
  { unit: 'uL', factor: 1e-6 },
  { unit: 'nL', factor: 1e-9 }
];
const ADAPTIVE_MASS_UNITS = [
  { unit: 'kg', factor: 1e3 },
  { unit: 'g', factor: 1 },
  { unit: 'mg', factor: 1e-3 },
  { unit: 'ug', factor: 1e-6 },
  { unit: 'ng', factor: 1e-9 }
];
const ADAPTIVE_CONCENTRATION_UNITS = [
  { unit: 'M', factor: 1 },
  { unit: 'mM', factor: 1e-3 },
  { unit: 'uM', factor: 1e-6 },
  { unit: 'nM', factor: 1e-9 },
  { unit: 'pM', factor: 1e-12 },
  { unit: 'fM', factor: 1e-15 }
];

export {
  ADAPTIVE_CONCENTRATION_UNITS,
  ADAPTIVE_MASS_UNITS,
  ADAPTIVE_VOLUME_UNITS,
  BUFFER_MASS_FACTORS_G,
  BUFFER_PH_ADJUSTMENT_MOLARITY,
  BUFFER_PKA_HINTS,
  BUFFER_VOLUME_FACTORS_L,
  VOLUME_EPSILON_L
};
