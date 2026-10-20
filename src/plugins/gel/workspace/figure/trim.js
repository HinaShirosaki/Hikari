export const DEFAULT_STACK_TRIM = Object.freeze({ mode: 'none', left: 0, right: 100 });

export function normalizeStackTrim(value = DEFAULT_STACK_TRIM) {
  const mode = value?.mode ?? 'none';
  const left = value?.left ?? 0;
  const right = value?.right ?? 100;
  if ((value != null && (typeof value !== 'object' || Array.isArray(value)))
    || !['none', 'auto', 'manual'].includes(mode)
    || !Number.isFinite(left) || !Number.isFinite(right)
    || left < 0 || right > 100 || right <= left) {
    throw new Error('Use left and right edges from 0–100%, with the right edge after the left edge.');
  }
  return mode === 'manual' ? { mode, left, right } : { mode, left: 0, right: 100 };
}

// Coordinates are in the aligned image area. The intersection has source pixels
// in every blot, so automatic trimming removes padding and unequal outer margins
// without changing any lane's scale or position relative to another blot.
export function resolveStackCrop(parts, fullWidth, value) {
  const trim = normalizeStackTrim(value);
  const sourceLeft = trim.mode === 'auto'
    ? Math.max(0, ...parts.map(part => part.imageX)) : fullWidth * trim.left / 100;
  const sourceRight = trim.mode === 'auto'
    ? Math.min(fullWidth, ...parts.map(part => part.imageX + part.imageWidth)) : fullWidth * trim.right / 100;
  if (sourceRight - sourceLeft < 1) throw new Error('The shared crop is too narrow. Move the trim edges farther apart.');
  return { mode: trim.mode, left: sourceLeft / fullWidth * 100, right: sourceRight / fullWidth * 100,
    sourceLeft, sourceWidth: sourceRight - sourceLeft };
}
