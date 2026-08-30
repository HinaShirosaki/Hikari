// Enables/disables the toolbar buttons and switches the preview cursor based on
// whether an image is loaded, a crop or mask is in progress, and markers exist.
function createColonyControlState({
  state,
  elements = {},
  isCropModeActive,
  hasActiveMask,
  closeColonyCropMenu
} = {}) {
  const colonyState = state;
  const {
    colonyRunBtn,
    colonyAutoCountBtn,
    colonyStartMaskBtn,
    colonyClearMaskBtn,
    colonyClearMarkersBtn,
    colonyStartCropBtn,
    colonyApplyCropBtn,
    colonyCancelCropBtn,
    colonyResetCropBtn,
    colonyCropMenuBtn,
    colonyPreviewCanvas
  } = elements;

  // Enable or disable buttons and cursors based on image availability, crop mode, and marker state.
  function updateControlState() {
    const hasImage = colonyState.hasImage;
    const cropActive = isCropModeActive();
    const busy = colonyState.isModelRunning;
    const drawingMask = colonyState.isDrawingMask;

    if (colonyCropMenuBtn) {
      colonyCropMenuBtn.disabled = !hasImage || busy || drawingMask;
      if (colonyCropMenuBtn.disabled) {
        closeColonyCropMenu();
      }
    }

    if (colonyStartCropBtn) {
      colonyStartCropBtn.disabled = !hasImage || cropActive || busy || drawingMask;
    }
    if (colonyApplyCropBtn) {
      colonyApplyCropBtn.disabled = !cropActive || busy || drawingMask;
    }
    if (colonyCancelCropBtn) {
      colonyCancelCropBtn.disabled = !cropActive || busy || drawingMask;
    }
    if (colonyResetCropBtn) {
      colonyResetCropBtn.disabled = !hasImage || cropActive || busy || drawingMask;
    }
    if (colonyAutoCountBtn) {
      colonyAutoCountBtn.disabled = !hasImage || cropActive || busy || drawingMask;
    }
    if (colonyStartMaskBtn) {
      colonyStartMaskBtn.disabled = !hasImage || cropActive || busy;
      colonyStartMaskBtn.textContent = drawingMask ? 'Cancel Mask' : 'Draw Mask';
    }
    if (colonyClearMaskBtn) {
      colonyClearMaskBtn.disabled = !hasImage || cropActive || busy || drawingMask || !hasActiveMask();
    }
    if (colonyClearMarkersBtn) {
      colonyClearMarkersBtn.disabled = !hasImage || cropActive || busy || drawingMask || colonyState.markers.length === 0;
    }
    if (colonyRunBtn) {
      colonyRunBtn.disabled = !hasImage || cropActive || busy || drawingMask;
    }
    if (colonyPreviewCanvas) {
      if (!hasImage || cropActive) {
        colonyPreviewCanvas.style.cursor = 'default';
      } else if (drawingMask) {
        colonyPreviewCanvas.style.cursor = 'crosshair';
      } else if (colonyState.isPanning) {
        colonyPreviewCanvas.style.cursor = 'grabbing';
      } else if (colonyState.zoom > 1.001) {
        colonyPreviewCanvas.style.cursor = 'grab';
      } else {
        colonyPreviewCanvas.style.cursor = 'crosshair';
      }
    }
  }

  return { updateControlState };
}

export { createColonyControlState };
