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
  BUFFER_VOLUME_FACTORS_L,
  VOLUME_EPSILON_L
};
