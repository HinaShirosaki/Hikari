import { toolFailure, toolUi } from '../localization.js';
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
  updateControlState,
  countWithModel = countColoniesWithModel
} = {}) {
  const colonyState = state;

  function startMaskDrawing() {
    if (!colonyState.hasImage) {
      setColonyStatus(toolUi('colony.loadBeforeMask'), true);
      return;
    }
    if (isCropModeActive()) {
      setColonyStatus(toolUi('colony.cropBeforeMask'), true);
      return;
    }
    if (colonyState.isDrawingMask) {
      colonyState.isDrawingMask = false;
      colonyState.maskDraft = null;
      colonyState.maskStartPoint = null;
      renderPreviewCanvas();
      setColonyStatus(toolUi('colony.maskCancelled'));
      updateControlState();
      return;
    }

    colonyState.isDrawingMask = true;
    colonyState.maskDraft = null;
    colonyState.maskStartPoint = null;
    setColonyStatus(toolUi('colony.maskDrawing'));
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
    setColonyStatus(toolUi('colony.maskCleared'));
    updateControlState();
  }

  async function runModelCount() {
    if (!colonyState.hasImage || !colonySourceCanvas) {
      setColonyStatus(toolUi('colony.loadBeforeAuto'), true);
      return;
    }
    if (isCropModeActive()) {
      setColonyStatus(toolUi('colony.cropBeforeAuto'), true);
      return;
    }
    if (colonyState.isDrawingMask) {
      setColonyStatus(toolUi('colony.maskBeforeAuto'), true);
      return;
    }

    const settings = getModelSettings();
    colonyState.isModelRunning = true;
    updateControlState();
    setColonyStatus(toolUi('colony.modelLoading'));

    try {
      const result = await countWithModel(colonySourceCanvas, {
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
      setColonyStatus('');
    } catch (error) {
      setColonyStatus(toolFailure(error, 'colony.autoFailed'), true);
      console.error('Colony auto count failed:', error);
    } finally {
      colonyState.isModelRunning = false;
      updateControlState();
    }
  }


  return { startMaskDrawing, clearMask, runModelCount };
}

export { createMaskAndModelCount };
