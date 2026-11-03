import { i18n } from './i18n.mjs';
const text = key => i18n.t(`figura.generateHere.${key}`);

export function canvasGenerationPoint(matrix, clientX, clientY, canvas) {
  if (!matrix || !canvas) return null;
  const { a, b, c, d, e, f } = matrix, determinant = a * d - b * c;
  if (![a, b, c, d, e, f, clientX, clientY, canvas.width, canvas.height].every(Number.isFinite) || !determinant) return null;
  const x = (d * (clientX - e) - c * (clientY - f)) / determinant;
  const y = (-b * (clientX - e) + a * (clientY - f)) / determinant;
  if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return null;
  return { x: Math.min(canvas.width, Math.round(x * 100) / 100), y: Math.min(canvas.height, Math.round(y * 100) / 100) };
}

export function canvasGenerationMessage(description, target, renderer) {
  const prompt = String(description || '').trim();
  if (!prompt || prompt.length > 2000) throw new Error(text('descriptionRequired'));
  if (!target || ![target.x, target.y, target.width, target.height].every(Number.isFinite)
    || target.width <= 0 || target.height <= 0 || target.x < 0 || target.y < 0 || target.x > target.width || target.y > target.height) throw new Error(text('positionUnavailable'));
  const choice = {
    auto: 'Choose editable SVG or Codex image_gen to suit this component and the figure’s style and renderer preferences.',
    svg: 'Use editable SVG for this addition; do not use image generation.',
    image: 'Use Codex image_gen for this addition, with a transparent background and no baked-in text. This choice applies only to this addition; do not change the saved renderer preference.'
  }[renderer];
  if (!choice) throw new Error(text('rendererRequired'));
  return `Add a new component to this illustration: ${prompt}\n\nPlace the center of the new component at canvas coordinates (${target.x}, ${target.y}) on the main canvas (${target.width} × ${target.height}). Choose a compact size; near an edge, shift only enough to keep the component inside the canvas. Keep existing layers, the canvas size, and figure settings unchanged; do not recenter or rearrange the figure. ${choice} Keep any requested labels as separate text layers. Inspect the placement before finishing.`;
}

export function createCanvasGeneration({ document, workspace, getContext, canGenerate, beforeSend, sendToChat, status }) {
  const $ = id => document.getElementById(id), dialog = $('generate-here-dialog');
  const description = $('generate-here-description'), renderer = $('generate-here-renderer');
  const error = $('generate-here-error'), submit = $('confirm-generate-here'), cancel = $('cancel-generate-here');
  let target = null, submitting = false;
  function close() { target = null; dialog.close(); }
  function capture({ clientX, clientY, keyboard }) {
    const context = getContext(), canvas = context.document?.canvases.main;
    const stage = $('main-canvas'), svg = stage.querySelector('svg');
    if (!context.illustrationId || !canvas || !svg) return null;
    if (keyboard) {
      const visible = stage.getBoundingClientRect(), artwork = svg.getBoundingClientRect();
      clientX = (Math.max(visible.left, artwork.left) + Math.min(visible.right, artwork.right)) / 2;
      clientY = (Math.max(visible.top, artwork.top) + Math.min(visible.bottom, artwork.bottom)) / 2;
    }
    const point = canvasGenerationPoint(svg.getScreenCTM(), clientX, clientY, canvas);
    return point && { ...point, illustrationId: context.illustrationId, width: canvas.width, height: canvas.height };
  }
  function open(point) {
    if (!point || submitting || !canGenerate() || point.illustrationId !== getContext().illustrationId) return;
    target = point; error.textContent = '';
    dialog.showModal(); description.focus();
  }
  cancel.addEventListener('click', close);
  dialog.addEventListener('close', () => { if (!dialog.open) target = null; });
  dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
  $('generate-here-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!target || submitting) return;
    const intent = target;
    submitting = true; submit.disabled = cancel.disabled = true; error.textContent = '';
    try {
      if (!canGenerate()) throw new Error(text('unavailable'));
      const message = canvasGenerationMessage(description.value, intent, renderer.value);
      await beforeSend(); await workspace.ready;
      if (target !== intent || intent.illustrationId !== getContext().illustrationId) return;
      const current = await workspace.request({ action: 'read', illustration_id: intent.illustrationId });
      if (!current.ok) throw new Error(current.error);
      if (target !== intent || intent.illustrationId !== getContext().illustrationId) return;
      if (current.canvases.main.width !== intent.width || current.canvases.main.height !== intent.height) throw new Error(text('canvasChanged'));
      await sendToChat(message, current);
      if (target === intent) { close(); description.value = ''; }
      status(text('started'));
    } catch (failure) {
      if (target === intent) error.textContent = failure.message;
      else status(failure.message);
    } finally { submitting = false; submit.disabled = cancel.disabled = false; }
  });
  return { capture, open, close, isSubmitting: () => submitting };
}
