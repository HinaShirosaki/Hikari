import { prepareRaster, cropRasterPatch } from './raster.mjs';

// Crop the selected source in the active canvas. Persist only after Apply;
// the figure keeps its original rotation, stretch, and pixel placement.
export function initCanvasCrop({ workspace, getSelected, getCanvas, getIllustrationId, onStart, onActiveChange, select, status }) {
  const $ = id => document.getElementById(id);
  let session, generation = 0;
  function close({ focus = true } = {}) {
    generation++;
    if (!session) return;
    const current = session; session = null;
    current.observer?.disconnect(); current.cropper?.destroy(); current.overlay.remove(); current.stage.inert = current.inert; current.stage.classList.remove('is-cropping');
    onActiveChange(false, focus);
  }
  function layout(current) {
    const stage = current.stage.getBoundingClientRect(), parent = current.stage.parentElement.getBoundingClientRect();
    Object.assign(current.overlay.style, { left: `${stage.left - parent.left}px`, top: `${stage.top - parent.top}px`, width: `${stage.width}px`, height: `${stage.height}px` });
  }
  function syncFields(current) {
    if (session !== current || !current.cropper?.ready) return;
    const crop = current.cropper.getData(true);
    for (const key of ['x', 'y', 'width', 'height']) current.overlay.querySelector(`[data-crop-field="${key}"]`).value = crop[key];
    current.overlay.querySelector('[data-crop-size]').textContent = `${crop.width} × ${crop.height} px`;
  }
  async function apply() {
    const current = session; if (!current || current.saving || !current.cropper?.ready) return;
    const error = current.overlay.querySelector('[data-crop-error]'); error.textContent = '';
    try {
      // Enter in a numeric field commits its value before applying the crop.
      const values = {};
      for (const key of ['width', 'height', 'x', 'y']) {
        const input = current.overlay.querySelector(`[data-crop-field="${key}"]`);
        if (!input.reportValidity() || !Number.isFinite(input.valueAsNumber)) return;
        values[key] = input.valueAsNumber;
      }
      current.cropper.setData(values);
      const crop = current.cropper.getData(true), patch = cropRasterPatch(current.object, current.raster, crop);
      const canvas = current.cropper.getCroppedCanvas({ width: crop.width, height: crop.height, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
      if (!canvas?.width || !canvas.height) throw new Error('Select a visible area to crop.');
      current.saving = true; current.cropper.disable();
      for (const control of current.overlay.querySelectorAll('button, input')) control.disabled = true;
      const result = await workspace.request({ action: 'apply', illustration_id: current.illustrationId, expected_revision: current.revision, request_id: crypto.randomUUID(),
        operations: [{ op: 'update', id: current.object.id, patch: { ...patch, dataUrl: canvas.toDataURL('image/png'), textFree: true } }] });
      if (!result.ok) throw new Error(result.error);
      if (session === current) { close(); select(current.object.id); status('Artwork cropped'); }
    } catch (failure) { if (session === current) error.textContent = failure.message; }
    finally {
      if (session === current) {
        current.saving = false; current.cropper.enable();
        for (const control of current.overlay.querySelectorAll('button, input')) control.disabled = false;
      }
    }
  }
  async function start() {
    if (session) { if (!session.saving) close(); return; }
    const object = getSelected(); if (object?.type !== 'raster') return;
    const token = ++generation, illustrationId = getIllustrationId(), revision = workspace.getDocument().revision, canvas = getCanvas();
    try {
      const raster = await prepareRaster(object.dataUrl);
      if (token !== generation || illustrationId !== getIllustrationId() || revision !== workspace.getDocument().revision || object.id !== getSelected()?.id) return;
      if (typeof window.Cropper !== 'function') throw new Error('The bundled cropper could not load.');
      onStart();
      const stage = $(`${canvas}-canvas`), overlay = document.createElement('section'); overlay.className = 'canvas-crop-overlay'; overlay.id = 'canvas-crop-overlay';
      overlay.setAttribute('aria-label', `Crop ${object.name}`);
      overlay.innerHTML = `<div class="canvas-crop-heading"><strong data-crop-name></strong><button id="canvas-crop-reset" type="button">Reset</button><button id="canvas-crop-cancel" type="button">Cancel</button><button id="canvas-crop-apply" class="primary-button" type="button">Apply crop</button></div>
        <div class="canvas-crop-image"><img id="canvas-crop-preview" alt="Selected artwork crop preview"></div>
        <div class="canvas-crop-fields" role="group" aria-label="Crop in pixels">
          <label>X<input data-crop-field="x" type="number" min="0" step="1"></label><label>Y<input data-crop-field="y" type="number" min="0" step="1"></label>
          <label>Width<input data-crop-field="width" type="number" min="1" step="1"></label><label>Height<input data-crop-field="height" type="number" min="1" step="1"></label>
        </div><div class="canvas-crop-note"><span>Drag the handles to crop.</span><span data-crop-size role="status"></span></div><p data-crop-error role="alert"></p>`;
      overlay.querySelector('[data-crop-name]').textContent = `Crop ${object.name}`;
      const current = { object, raster, illustrationId, revision, canvas, stage, overlay, inert: stage.inert, saving: false };
      session = current; stage.inert = true; stage.classList.add('is-cropping'); stage.parentElement.append(overlay); layout(current); onActiveChange(true, false);
      current.observer = new ResizeObserver(() => { if (session === current) layout(current); }); current.observer.observe(stage);
      const image = $('canvas-crop-preview'); image.src = raster.dataUrl;
      $('canvas-crop-cancel').addEventListener('click', () => close());
      $('canvas-crop-apply').addEventListener('click', () => void apply());
      $('canvas-crop-reset').addEventListener('click', () => { current.cropper?.reset(); syncFields(current); });
      await image.decode(); if (session !== current) return;
      current.cropper = new window.Cropper(image, { viewMode: 1, autoCropArea: 1, dragMode: 'crop', zoomable: false, movable: false,
        rotatable: false, scalable: false, checkOrientation: false, toggleDragModeOnDblclick: false,
        ready: () => { syncFields(current); if (session === current) $('canvas-crop-apply').focus({ preventScroll: true }); }, crop: () => syncFields(current) });
      for (const input of overlay.querySelectorAll('[data-crop-field]')) input.addEventListener('change', () => {
        if (current.cropper?.ready && input.checkValidity() && Number.isFinite(input.valueAsNumber)) current.cropper.setData({ [input.dataset.cropField]: input.valueAsNumber });
        syncFields(current);
      });
    } catch (error) { if (token === generation) { close({ focus: false }); status(error.message); } }
  }
  $('crop-raster').addEventListener('click', () => void start());
  return {
    close,
    onDocumentChange(document, id) {
      if (!session) return;
      if (id !== session.illustrationId || getCanvas() !== session.canvas || getSelected()?.id !== session.object.id
        || document.revision !== session.revision && !session.saving) {
        close({ focus: false }); status('Crop canceled because the illustration changed.');
      }
    },
    handleKey(event) {
      if (!session) return false;
      if (event.key === 'Escape') { event.preventDefault(); if (!session.saving) close(); }
      if (event.key === 'Enter') { event.preventDefault(); void apply(); }
      return true;
    }
  };
}
