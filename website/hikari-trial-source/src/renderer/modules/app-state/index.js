import { trackGrowthEvent } from './growth-events.js';
import {
  normalizePaperComment,
  normalizePaperHighlight,
  normalizePaperRecord
} from './paper-normalizers.js';
import { defaultState, normalizeState } from './state-normalizer.js';

// bootstrap/index-shell.js reads this key too (for the pre-boot appearance),
// so rename both together.
export const STORAGE_KEY = 'hikari_state_v1';

export {
  defaultState,
  normalizePaperComment,
  normalizePaperHighlight,
  normalizePaperRecord,
  normalizeState,
  trackGrowthEvent
};

// localStorage is a fast boot cache; the storage folder is the durable copy and
// is merged in by storageImportController.hydrateStateFromStorageRoot() during
// initApp. A corrupt cache falls back to defaults rather than blocking boot.
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

export function persistState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
