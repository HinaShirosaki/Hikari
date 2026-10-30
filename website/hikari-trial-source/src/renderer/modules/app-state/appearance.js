export const APPEARANCE_MODES = Object.freeze({
  DAY: 'day',
  NIGHT: 'night'
});

const SUPPORTED_APPEARANCE_MODES = new Set(Object.values(APPEARANCE_MODES));

export function normalizeAppearanceMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_APPEARANCE_MODES.has(normalized)
    ? normalized
    : APPEARANCE_MODES.DAY;
}
