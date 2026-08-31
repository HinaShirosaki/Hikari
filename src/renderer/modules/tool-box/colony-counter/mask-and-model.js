import { countColoniesWithModel } from '../colony-counter-model.js';
import { EMPTY_MASK } from './canvas-utils.js';

// Drawing / clearing the count mask, and running the trained colony model over
// the current source image.
function createMaskAndModelCount({
  state,
  colonySourceCanvas,
  getModelSettings,
  isCropModeActive,
  hasActiveMask,
  normalizeMask,
  renderPreviewCanvas,
  renderColonySummary,
  setColonyStatus,
  updateControlState
} = {}) {
  const colonyState = state;

  function startMaskDrawing() {
    if (!colonyState.hasImage) {
      setColonyStatus('Load an image before drawing a mask.', true);
      return;
    }
    if (isCropModeActive()) {
      setColonyStatus('Apply or cancel crop mode before drawing a mask.', true);
      return;
    }
    if (colonyState.isDrawingMask) {
      colonyState.isDrawingMask = false;
      colonyState.maskDraft = null;
      colonyState.maskStartPoint = null;
      renderPreviewCanvas();
      setColonyStatus('Mask drawing cancelled.');
      updateControlState();
      return;
    }

    colonyState.isDrawingMask = true;
    colonyState.maskDraft = null;
    colonyState.maskStartPoint = null;
    setColonyStatus('Drag on the plate preview to draw the count mask.');
    updateControlState();
  }

  function clearMask() {
    if (!hasActiveMask() && !colonyState.maskDraft) {
      return;
    }
    colonyState.mask = { ...EMPTY_MASK };
    colonyState.maskDraft = null;
    colonyState.isDrawingMask = false;
    colonyState.maskStartPoint = null;
    renderPreviewCanvas();
    renderColonySummary();
    setColonyStatus('Mask cleared. Auto Count will detect the plate automatically when no hand mask is drawn.');
    updateControlState();
  }

  async function runModelCount() {
    if (!colonyState.hasImage || !colonySourceCanvas) {
      setColonyStatus('Load a plate image before running auto count.', true);
      return;
    }
    if (isCropModeActive()) {
      setColonyStatus('Apply or cancel crop mode before running auto count.', true);
      return;
    }
    if (colonyState.isDrawingMask) {
      setColonyStatus('Finish or cancel mask drawing before running auto count.', true);
      return;
    }

    const settings = getModelSettings();
    colonyState.isModelRunning = true;
    updateControlState();
    setColonyStatus('Loading colony model and counting...');

    try {
      const result = await countColoniesWithModel(colonySourceCanvas, {
        ...settings,
        mask: colonyState.mask
      });

      if (result.maskSource === 'plate-model' && result.detectedPlateMask) {
        colonyState.mask = normalizeMask(result.detectedPlateMask);
      }

      colonyState.markers = result.colonies.map((colony) => ({
        x: colony.x,
        y: colony.y,
        source: 'model',
        score: colony.score
      }));
      colonyState.lastCountSource = 'model';
      colonyState.lastModelStats = {
        threshold: result.threshold,
        minDistance: result.minDistance,
        elapsedMs: result.elapsedMs,
        totalPeaks: result.totalPeaks,
        maskSource: result.maskSource,
        plateThreshold: result.plateThreshold,
        plateArea: result.plateArea
      };

      renderPreviewCanvas();
      renderColonySummary();
      const maskText = result.maskSource === 'plate-model'
        ? ` inside detected plate (${result.totalPeaks} total colony peak${result.totalPeaks === 1 ? '' : 's'})`
        : (hasActiveMask() ? ` inside mask (${result.totalPeaks} total colony peak${result.totalPeaks === 1 ? '' : 's'})` : '');
      const fallbackText = result.maskSource === 'none' ? ' Plate was not detected; counted the full image.' : '';
      const countText = `Auto count: ${colonyState.markers.length} colon${colonyState.markers.length === 1 ? 'y' : 'ies'}${maskText}.`;
      setColonyStatus(`${countText}${fallbackText}`);
    } catch (error) {
      setColonyStatus(error?.message || 'Auto count failed.', true);
      console.error('Colony auto count failed:', error);
    } finally {
      colonyState.isModelRunning = false;
      updateControlState();
    }
  }


  return { startMaskDrawing, clearMask, runModelCount };
}

export { createMaskAndModelCount };
