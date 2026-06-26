export const APPEARANCE_MODES = Object.freeze({
  DAY: 'day',
  NIGHT: 'night',
  MIKU: 'miku'
});

const SUPPORTED_APPEARANCE_MODES = new Set(Object.values(APPEARANCE_MODES));

export function normalizeAppearanceMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_APPEARANCE_MODES.has(normalized)
    ? normalized
    : APPEARANCE_MODES.DAY;
}

export function applyAppearanceToDocument(
  appearance,
  rootDocument = globalThis?.document || null,
  defaultFontSize = 16
) {
  if (!rootDocument?.documentElement || !rootDocument?.body) {
    return {
      fontSize: defaultFontSize,
      mode: APPEARANCE_MODES.DAY
    };
  }

  const resolved = appearance && typeof appearance === 'object' ? appearance : {};
  const fontSize = Number(resolved.fontSize) || defaultFontSize;
  const mode = normalizeAppearanceMode(resolved.mode);
  const root = rootDocument.documentElement;
  const body = rootDocument.body;

  root.style.setProperty('--app-font-size', `${fontSize}px`);
  root.style.setProperty('font-size', `${fontSize}px`);
  body.classList.toggle('theme-night', mode === APPEARANCE_MODES.NIGHT);
  body.classList.toggle('theme-miku', mode === APPEARANCE_MODES.MIKU);
  body.classList.add('ui-neutral-compact');
  if (body.dataset) {
    body.dataset.appearanceMode = mode;
  }

  return { fontSize, mode };
}
