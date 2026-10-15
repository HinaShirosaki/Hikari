import { clamp } from '../shared.js';

// A band click chooses the row; only submitting this box changes calibration.
export function createLadderMwEditor({ runtime, elements, onSet }) {
  const editor = elements.gelLadderMwEditor;
  const input = elements.gelLadderBandMwInput;
  const documentObject = editor?.ownerDocument;
  const windowObject = documentObject?.defaultView;
  let pending = null;

  function close({ restoreFocus = false } = {}) {
    pending = null;
    if (editor) editor.hidden = true;
    input?.setCustomValidity?.('');
    if (restoreFocus) elements.gelToolLadderMwBtn?.focus();
  }

  function isCurrent() {
    return pending
      && runtime.selectedViewerTool === 'ladder-mw'
      && !runtime.cropperActive
      && pending.image === runtime.currentImage
      && pending.overrides === runtime.manualOverrides;
  }

  function sync() {
    if (pending && !isCurrent()) close();
  }

  function open({ rowY, mw, clientX, clientY }) {
    if (!editor || !input || !runtime.currentImage || runtime.cropperActive
      || runtime.selectedViewerTool !== 'ladder-mw') return;
    pending = { rowY, image: runtime.currentImage, overrides: runtime.manualOverrides };
    input.value = Number.isFinite(mw) ? String(mw) : '';
    input.setCustomValidity?.('');
    editor.hidden = false;
    const bounds = editor.getBoundingClientRect();
    const viewportWidth = windowObject?.innerWidth || 1024;
    const viewportHeight = windowObject?.innerHeight || 768;
    const left = clientX + 12 + bounds.width <= viewportWidth - 8
      ? clientX + 12 : clientX - bounds.width - 12;
    const top = clientY + 12 + bounds.height <= viewportHeight - 8
      ? clientY + 12 : clientY - bounds.height - 12;
    editor.style.left = `${clamp(left, 8, Math.max(8, viewportWidth - bounds.width - 8))}px`;
    editor.style.top = `${clamp(top, 8, Math.max(8, viewportHeight - bounds.height - 8))}px`;
    input.focus();
    input.select();
  }

  function onSubmit(event) {
    event.preventDefault();
    if (!isCurrent()) {
      close();
      return;
    }
    const mw = Number(input.value);
    if (!Number.isFinite(mw) || mw <= 0) {
      input.setCustomValidity?.('Enter a molecular weight greater than 0.');
      input.reportValidity?.();
      return;
    }
    const { rowY } = pending;
    close({ restoreFocus: true });
    onSet(rowY, mw);
  }

  function onInput() {
    input.setCustomValidity?.('');
  }

  function onPointerDown(event) {
    if (pending && !editor.contains(event.target)) close();
  }

  function onKeyDown(event) {
    if (!pending || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close({ restoreFocus: true });
  }

  function onViewportChange(event) {
    if (event.target === windowObject || !editor?.contains(event.target)) close();
  }

  editor?.addEventListener('submit', onSubmit);
  input?.addEventListener('input', onInput);
  documentObject?.addEventListener('pointerdown', onPointerDown, true);
  documentObject?.addEventListener('keydown', onKeyDown, true);
  windowObject?.addEventListener('resize', onViewportChange);
  windowObject?.addEventListener('scroll', onViewportChange, true);

  function destroy() {
    close();
    editor?.removeEventListener('submit', onSubmit);
    input?.removeEventListener('input', onInput);
    documentObject?.removeEventListener('pointerdown', onPointerDown, true);
    documentObject?.removeEventListener('keydown', onKeyDown, true);
    windowObject?.removeEventListener('resize', onViewportChange);
    windowObject?.removeEventListener('scroll', onViewportChange, true);
  }

  return { open, close, sync, destroy };
}
