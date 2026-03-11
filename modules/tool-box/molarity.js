import { toNumber } from './common.js';

const CONCENTRATION_TO_M = {
  fM: 1e-15,
  pM: 1e-12,
  nM: 1e-9,
  uM: 1e-6,
  mM: 1e-3,
  M: 1
};

const VOLUME_TO_L = {
  uL: 1e-6,
  mL: 1e-3,
  L: 1
};

const MASS_TO_G = {
  ug: 1e-6,
  mg: 1e-3,
  g: 1,
  kg: 1e3
};

export function concentrationToM(value, unit) {
  return toNumber(value) * (CONCENTRATION_TO_M[unit] || 0);
}

export function concentrationFromM(valueM, unit) {
  const factor = CONCENTRATION_TO_M[unit] || 0;
  return factor ? valueM / factor : 0;
}

export function volumeToL(value, unit) {
  return toNumber(value) * (VOLUME_TO_L[unit] || 0);
}

export function volumeFromL(valueL, unit) {
  const factor = VOLUME_TO_L[unit] || 0;
  return factor ? valueL / factor : 0;
}

export function massToG(value, unit) {
  return toNumber(value) * (MASS_TO_G[unit] || 0);
}

export function massFromG(valueG, unit) {
  const factor = MASS_TO_G[unit] || 0;
  return factor ? valueG / factor : 0;
}
