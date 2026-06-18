import { trackGrowthEvent } from './app-state/growth-events.js';
import {
  normalizePaperComment,
  normalizePaperHighlight,
  normalizePaperRecord
} from './app-state/paper-normalizers.js';
import { defaultState, normalizeState } from './app-state/state-normalizer.js';

export const STORAGE_KEY = 'hikari_state_v1';

export {
  defaultState,
  normalizePaperComment,
  normalizePaperHighlight,
  normalizePaperRecord,
  normalizeState,
  trackGrowthEvent
};

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
