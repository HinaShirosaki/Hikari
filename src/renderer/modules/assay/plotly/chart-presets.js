import { normalizeChartStyle } from './chart-style-model.js';
// UI-only identifier; saved names remain a separate namespace, including "Prism Classic".
export const PRISM_CLASSIC_PRESET = 'builtin:prism-classic';

// Named chart styles, shared across assays. normalizeChartStyle already sanitises
// anything read back, so the store is a plain name -> style map in localStorage.

const STORAGE_KEY = 'hikari_assay_chart_presets_v1';
const MAX_PRESETS = 40;

function getStorage() {
  try {
    return globalThis?.localStorage || null;
  } catch {
    return null;
  }
}

function readAll() {
  const storage = getStorage();
  if (!storage) {
    return {};
  }
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(presets) {
  const storage = getStorage();
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

export function sanitizePresetName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function listChartPresets() {
  return Object.keys(readAll()).sort((a, b) => a.localeCompare(b));
}

export function getChartPreset(name) {
  const stored = readAll()[sanitizePresetName(name)];
  return stored ? normalizeChartStyle(stored) : null;
}

export function saveChartPreset(name, style) {
  const key = sanitizePresetName(name);
  if (!key) {
    return false;
  }
  const presets = readAll();
  if (!(key in presets) && Object.keys(presets).length >= MAX_PRESETS) {
    return false;
  }
  presets[key] = normalizeChartStyle(style);
  return writeAll(presets);
}

export function deleteChartPreset(name) {
  const presets = readAll();
  const key = sanitizePresetName(name);
  if (!(key in presets)) {
    return false;
  }
  delete presets[key];
  return writeAll(presets);
}
