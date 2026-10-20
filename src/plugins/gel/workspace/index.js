import { analyzeGelImage } from './analysis/analysis-core.js';
import { createCropController } from './images/crop-controller.js';
import { getGelElements } from './dom.js';
import { createFloatingWindows } from './floating-windows.js';
import { createBlotFigureController } from './figure/controller.js';
import { createImageController } from './images/image-controller.js';
import { createLaneTableController } from './rendering/lane-table.js';
import { createManualWorkflowController } from './manual/manual-workflow.js';
import { createHistoryController } from './history.js';
import { createRecordsManager } from './records-manager.js';
import { createRenderingController, selectViewerBaseImageData } from './rendering/index.js';
import { DEFAULT_LADDER_PRESET_ID, LADDER_PRESETS } from './constants.js';
import { createEmptyManualOverrides } from './shared.js';
import { bindFileDropTarget } from '../lib/file-drop.js';
import { serializeDraftSnapshot, snapshotFormControls } from '../lib/unsaved-draft.js';

export { selectViewerBaseImageData };

export function initGelAnalysis({
  state,
  persist,
  createId,
  safeText,
  onGelAnalysesChanged,
  onHistoryChanged = null,
  document: rootDocument = globalThis?.document || null
}) {
  if (!state || typeof state !== 'object') {
    throw new Error('Gel initialization needs a mutable state object.');
  }
  if (typeof persist !== 'function' || typeof createId !== 'function' || typeof safeText !== 'function') {
    throw new Error('Gel initialization needs persist, createId, and safeText functions.');
  }
  if (!rootDocument?.getElementById) {
    throw new Error('Gel initialization needs a document containing the Gel workspace.');
  }
  const elements = getGelElements(rootDocument);
  const requiredElementKeys = [
    'gelForm',
    'gelNameInput',
    'gelImageFileInput',
    'gelStatus',
    'gelSaveBtn',
    'gelViewerStage',
    'gelCanvas',
    'gelList'
  ];
  const missingElementKeys = requiredElementKeys.filter((key) => !elements[key]);
  if (missingElementKeys.length) {
    throw new Error(`Gel workspace markup is missing required elements: ${missingElementKeys.join(', ')}.`);
  }
  const rootWindow = rootDocument.defaultView || (typeof window !== 'undefined' ? window : null);
  const runtime = {
    createId,
    cropApplied: false,
    cropDisplaySize: null,
    cropRotationDegrees: 0,
    cropRotationDrag: null,
    cropperActive: false,
    cropperInstance: null,
    currentImage: null,
    currentReport: null,
    enhancementRerunTimer: null,
    imageRevision: 0,
    figureExportIncludeLadder: true,
    ladderBandDrag: null,
    manualDividerConfirmed: false,
    manualOverrides: createEmptyManualOverrides(),
    onGelAnalysesChanged,
    originalImage: null,
    originalFile: null,
    pendingNotebookLink: null,
    persist,
    preprocessedCache: null,
    safeText,
    laneProfileHoverY: null,
    laneVertexDrag: null,
    selectedLaneProfileLane: null,
    selectedViewerTool: '',
    state,
    viewerMode: 'original',
    markDraftSaved: null
  };
  let savedDraftSnapshot = '';

  function getCurrentDraftSnapshot() {
    return serializeDraftSnapshot({
      // The tool sections live in #gel-form too; these two fields are view
      // state, not record data, so editing them is not an unsaved change.
      controls: snapshotFormControls(elements.gelForm, {
        excludeIds: ['gel-expected-lane-count', 'gel-lane-profile-select']
      }),
      currentImage: runtime.currentImage
        ? {
          name: runtime.currentImage.name || '',
          width: runtime.currentImage.width || 0,
          height: runtime.currentImage.height || 0,
          revision: runtime.imageRevision
        }
        : null,
      currentReport: runtime.currentReport,
      manualOverrides: runtime.manualOverrides,
      cropApplied: runtime.cropApplied,
      pendingNotebookLink: runtime.pendingNotebookLink
    });
  }

  function markDraftSaved() {
    savedDraftSnapshot = getCurrentDraftSnapshot();
  }

  runtime.markDraftSaved = markDraftSaved;

  function setStatus(message) {
    if (elements.gelStatus) {
      elements.gelStatus.textContent = message || '';
    }
  }

  let rendering;
  let blotFigure;
  function renderCanvasAndCommit() {
    rendering.renderCanvas();
    // One gesture, one undo step. A drag re-renders on every pointer sample, so
    // committing those would push dozens of entries and shove every earlier edit
    // off the end of the stack. Both drags clear their flag before the mouseup
    // render, so the settled position is what gets committed.
    if (runtime.laneVertexDrag || runtime.ladderBandDrag) {
      return;
    }
    history.commit();
  }

  const history = createHistoryController({
    runtime,
    deps: {
      onHistoryChanged: (historyState) => {
        if (!blotFigure?.isOpen()) onHistoryChanged?.(historyState);
      },
      renderAll: ({ analyzed }) => {
        const segmentation = runtime.manualOverrides?.laneSegmentation || {};
        runtime.currentReport = null;
        runtime.manualDividerConfirmed = Boolean(segmentation.dividerDone);
        // Unfinished dividers are edited with the divider tool, so undoing
        // Finish reopens it and redoing Finish closes it, as the clicks did.
        if (!segmentation.dividerDone && Number.isFinite(segmentation.gelLeft)) {
          runtime.selectedViewerTool = 'dividers';
        } else if (segmentation.dividerDone && runtime.selectedViewerTool === 'dividers') {
          runtime.selectedViewerTool = '';
        }
        manualWorkflow.renderOverrideStatus();
        rendering.renderCanvas();
        if (analyzed) {
          onRunAnalysis();
        }
      }
    }
  });

  let floatingWindows;
  let viewerResizeObserver;
  const laneTable = createLaneTableController({
    runtime,
    elements,
    safeText,
    deps: {
      documentObject: rootDocument,
      getFigureImageData: () => {
        const preprocessed = runtime.viewerMode === 'processed'
          ? imageController.getPreprocessedImageForCurrentSettings?.()
          : null;
        return selectViewerBaseImageData(runtime.currentImage, preprocessed, runtime.viewerMode);
      },
      setStatus
    }
  });
  const imageController = createImageController({
    runtime,
    elements,
    deps: {
      leaveCropMode: () => cropController.leaveCropMode(),
      onRunAnalysis,
      renderCanvas: renderCanvasAndCommit,
      renderOverrideStatus: () => manualWorkflow.renderOverrideStatus(),
      setStatus
    }
  });
  const cropController = createCropController({
    runtime,
    elements,
    deps: {
      copyNormalizedImage: imageController.copyNormalizedImage,
      imageDataToDataUrl: imageController.imageDataToDataUrl,
      normalizeCurrentCanvasCrop: imageController.normalizeCurrentCanvasCrop,
      renderCanvas: renderCanvasAndCommit,
      renderOverrideStatus: () => manualWorkflow.renderOverrideStatus(),
      setCurrentImage: imageController.setCurrentImage,
      setStatus
    }
  });
  const manualWorkflow = createManualWorkflowController({
    runtime,
    elements,
    deps: {
      onRunAnalysis,
      renderCanvas: renderCanvasAndCommit,
      renderLaneTable: () => laneTable.render(),
      setStatus
    }
  });
  const recordsManager = createRecordsManager({
    runtime,
    elements,
    deps: {
      copyNormalizedImage: imageController.copyNormalizedImage,
      confirmDelete: (record) => (
        typeof rootWindow?.confirm !== 'function'
        || rootWindow.confirm(
          `Remove the saved Gel record "${record?.name || record?.id || 'Untitled gel'}"? Its artifact files will remain in plugin storage.`
        )
      ),
      decodeImageSource: imageController.decodeImageSource,
      imageDataToDataUrl: imageController.imageDataToDataUrl,
      leaveCropMode: () => cropController.leaveCropMode(),
      readEnhancementSettingsFromUi: imageController.readEnhancementSettingsFromUi,
      renderCanvas: renderCanvasAndCommit,
      renderEnhancementValues: () => imageController.renderEnhancementValues(),
      renderManualProgress: () => manualWorkflow.renderManualProgress(),
      renderOverrideStatus: () => manualWorkflow.renderOverrideStatus(),
      setCurrentImage: imageController.setCurrentImage,
      setStatus
    }
  });
  rendering = createRenderingController({
    runtime,
    elements,
    safeText,
    deps: {
      getPreprocessedImageForCurrentSettings: imageController.getPreprocessedImageForCurrentSettings,
      renderLaneTable: () => laneTable.render(),
      setStatus
    }
  });

  floatingWindows = createFloatingWindows({
    documentObject: rootDocument,
    onOpen: {
      peak: () => {
        rendering.onPeakEditorOpen();
        return Boolean(runtime.peakEditor?.open);
      }
    },
    onClose: {
      peak: rendering.onPeakEditorClose
    }
  });

  blotFigure = createBlotFigureController({
    runtime, elements, documentObject: rootDocument,
    deps: {
      imageDataToDataUrl: imageController.imageDataToDataUrl,
      leaveCropMode: () => cropController.leaveCropMode(),
      hideWindows: () => floatingWindows.close('peak'),
      onHistoryChanged,
      onEditorHistory: () => onHistoryChanged?.(history.getHistoryState()),
      renderEditor: () => { rendering.renderCanvas(); laneTable.fitViewerToStage(); },
      restoreDraft: (draft) => {
        cropController.leaveCropMode();
        for (const [id, value] of Object.entries(draft.controls)) {
          const control = rootDocument.getElementById(id);
          if (control) control.value = value;
        }
        imageController.setCurrentImage(draft.currentImage);
        runtime.originalImage = draft.originalImage;
        runtime.originalFile = draft.originalFile;
        runtime.manualOverrides = JSON.parse(JSON.stringify(draft.manualOverrides));
        runtime.currentReport = draft.currentReport ? JSON.parse(JSON.stringify(draft.currentReport)) : null;
        runtime.cropApplied = draft.cropApplied;
        runtime.viewerMode = draft.viewerMode;
        runtime.pendingNotebookLink = draft.pendingNotebookLink;
        runtime.manualDividerConfirmed = Boolean(runtime.manualOverrides.laneSegmentation?.dividerDone);
        runtime.selectedViewerTool = '';
        runtime.selectedLaneProfileLane = null;
        runtime.laneProfileHoverY = null;
        imageController.renderEnhancementValues();
        updateViewerModeButtons();
        manualWorkflow.renderOverrideStatus();
        manualWorkflow.renderManualProgress();
        history.reset();
      },
      setStatus
    }
  });

  elements.gelImageFileInput?.addEventListener('change', imageController.onImageFileChange);
  const unbindFileDrop = bindFileDropTarget({
    target: elements.gelViewerStage || elements.gelImageRow || elements.gelForm,
    accept: elements.gelImageFileInput?.getAttribute?.('accept') || 'image/*',
    onFiles: ([file]) => {
      blotFigure?.detachEditor();
      return imageController.loadImageFile(file);
    },
    onRejected: () => {
      setStatus('Drop an image file to load it into Gel.');
    },
    onError: (error) => {
      setStatus(String(error?.message || error || 'Failed to load the dropped gel image.'));
    }
  });
  elements.gelDenoiseStrengthInput?.addEventListener('input', imageController.onEnhancementChanged);
  elements.gelContrastStrengthInput?.addEventListener('input', imageController.onEnhancementChanged);
  elements.gelResetOverridesBtn?.addEventListener('click', manualWorkflow.onResetManualOverrides);
  elements.gelCropModeBtn?.addEventListener('click', cropController.onCropModeAction);
  elements.gelApplyCropBtn?.addEventListener('click', cropController.onApplyCrop);
  elements.gelResetCropBtn?.addEventListener('click', cropController.onResetCrop);
  elements.gelCancelCropBtn?.addEventListener('click', cropController.onCancelCrop);
  elements.gelCropRotateBtn?.addEventListener('click', cropController.onRotateQuarter);
  elements.gelCropAngleInput?.addEventListener('input', cropController.onAngleInput);
  // Crop mode keys, as in photo editors: Enter keeps the crop, Escape drops it.
  // Capture phase, so Escape ends the crop before the peak editor sees it.
  function onCropKeydown(event) {
    if (!runtime.cropperActive) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cropController.onCancelCrop();
    } else if (event.key === 'Enter' && !event.target?.closest?.('button, select, textarea, input:not([type=range])')) {
      event.preventDefault();
      cropController.onApplyCrop();
    }
  }
  rootDocument.addEventListener('keydown', onCropKeydown, true);
  elements.gelViewerStage?.addEventListener('pointerdown', cropController.onRotationDragStart, true);
  elements.gelCanvas?.addEventListener('click', manualWorkflow.onCanvasClick);
  elements.gelCanvas?.addEventListener('mousedown', manualWorkflow.onCanvasMouseDown);
  if (rootWindow) {
    rootWindow.addEventListener('pointermove', cropController.onRotationDragMove);
    rootWindow.addEventListener('pointerup', cropController.onRotationDragEnd);
    rootWindow.addEventListener('pointercancel', cropController.onRotationDragEnd);
    rootWindow.addEventListener('mousemove', manualWorkflow.onCanvasMouseMove);
    rootWindow.addEventListener('mouseup', manualWorkflow.onCanvasMouseUp);
    if (rootWindow.ResizeObserver && elements.gelViewerStage) {
      viewerResizeObserver = new rootWindow.ResizeObserver(() => laneTable.fitViewerToStage());
      viewerResizeObserver.observe(elements.gelViewerStage);
    }
  }
  elements.gelCancelBtn?.addEventListener('click', recordsManager.resetForm);
  elements.gelExportCsvBtn?.addEventListener('click', recordsManager.onExportCsv);
  elements.gelToolDividersBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('dividers'));
  elements.gelFinishDividersBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('dividers'));
  elements.gelToolLadderMwBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('ladder-mw'));
  elements.gelDetectLadderBtn?.addEventListener('click', manualWorkflow.onDetectLadderBands);
  if (elements.gelLadderPresetSelect && !elements.gelLadderPresetSelect.options.length) {
    const groups = [...new Set(LADDER_PRESETS.map((preset) => preset.group))];
    elements.gelLadderPresetSelect.innerHTML = groups.map((group) => {
      const options = LADDER_PRESETS
        .filter((preset) => preset.group === group)
        .map((preset) => `<option value="${preset.id}">${safeText(preset.label)}</option>`)
        .join('');
      return `<optgroup label="${safeText(group)}">${options}</optgroup>`;
    }).join('');
    elements.gelLadderPresetSelect.value = DEFAULT_LADDER_PRESET_ID;
  }
  elements.gelToolLadderLaneBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('ladder'));
  elements.gelToolLaneVerticesBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('lane-vertices'));
  elements.gelToolBandTopBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('band-top'));
  elements.gelToolBandBottomBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('band-bottom'));
  elements.gelLaneBandModeBtn?.addEventListener('click', manualWorkflow.onLaneBandModeToggle);
  elements.gelAddTableBtn?.addEventListener('click', laneTable.onAddTableClick);
  elements.gelOpenLaneTableBtn?.addEventListener('click', laneTable.onTogglePanel);
  elements.gelCloseLaneTableBtn?.addEventListener('click', laneTable.onClosePanel);
  elements.gelExportImageBtn?.addEventListener('click', (event) => laneTable.onGenerateFigureClick(event.currentTarget));
  elements.gelExportPptxBtn?.addEventListener('click', (event) => laneTable.onGeneratePowerPointClick(event.currentTarget));
  elements.gelLaneTableShell?.addEventListener('click', laneTable.onShellClick);
  elements.gelLaneTableShell?.addEventListener('input', laneTable.onShellInput);
  elements.gelForm?.addEventListener('submit', recordsManager.onSaveAnalysis);
  elements.gelSearchInput?.addEventListener('input', recordsManager.renderList);
  elements.gelList?.addEventListener('click', recordsManager.onListClick);
  // Export and record actions are popover menus. Close one before its item
  // runs: the exports disable their own button while working, and a disabled
  // button skips the popovertargetaction hide, which left the menu open.
  rootDocument.querySelectorAll('.gel-menu').forEach((menu) => {
    menu.addEventListener('click', (event) => {
      if (event.target.closest('button')) menu.hidePopover?.();
    }, true);
  });
  elements.gelManualNextBtn?.addEventListener('click', manualWorkflow.onManualNextStep);
  elements.gelAutoDetectLanesBtn?.addEventListener('click', manualWorkflow.onAutoDetectLanes);
  // The lane count sits inside #gel-form, where Enter would submit (save) the
  // record. Enter here means "detect with this count".
  elements.gelExpectedLaneCountInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    manualWorkflow.onAutoDetectLanes();
  });
  function updateViewerModeButtons() {
    elements.gelProcessImageBtn?.setAttribute('aria-pressed', String(runtime.viewerMode === 'processed'));
  }
  // One switch: on shows the image with denoise and contrast applied.
  elements.gelProcessImageBtn?.addEventListener('click', () => {
    if (runtime.viewerMode !== 'processed' && !runtime.currentImage) {
      setStatus('Load a gel image before processing.');
      return;
    }
    runtime.viewerMode = runtime.viewerMode === 'processed' ? 'original' : 'processed';
    updateViewerModeButtons();
    rendering.renderCanvas();
  });
  updateViewerModeButtons();
  elements.gelLaneProfileSelect?.addEventListener('change', (event) => {
    const nextLane = Number(event?.target?.value);
    runtime.selectedLaneProfileLane = Number.isFinite(nextLane) && nextLane > 0
      ? Math.floor(nextLane)
      : null;
    runtime.laneProfileHoverY = null;
    rendering.renderLaneProfile();
    rendering.renderCanvas();
  });
  elements.gelLaneProfileChart?.addEventListener('mousemove', rendering.onLaneProfileChartMouseMove);
  elements.gelLaneProfileChart?.addEventListener('mouseleave', rendering.onLaneProfileChartMouseLeave);
  elements.gelPeakEditorCloseBtn?.addEventListener('click', () => floatingWindows.close('peak'));
  elements.gelCellTableCopyBtn?.addEventListener('click', rendering.onCellTableCopy);
  elements.gelPeakEditorLaneSelect?.addEventListener('change', rendering.onPeakEditorLaneChange);
  elements.gelPeakEditorBaselineModeBtn?.addEventListener('click', () => rendering.onPeakEditorModeSelected('baseline'));
  elements.gelPeakEditorDividerModeBtn?.addEventListener('click', () => rendering.onPeakEditorModeSelected('divider'));
  elements.gelPeakEditorClearLaneBtn?.addEventListener('click', rendering.onPeakEditorClearLane);
  elements.gelPeakEditorClearAllBtn?.addEventListener('click', rendering.onPeakEditorClearAll);
  elements.gelPeakEditorChart?.addEventListener('click', rendering.onPeakEditorChartClick);
  elements.gelPeakEditorChart?.addEventListener('mousemove', rendering.onPeakEditorChartMouseMove);
  elements.gelPeakEditorChart?.addEventListener('mouseleave', rendering.onPeakEditorChartMouseLeave);
  elements.gelCanvas?.addEventListener('mousemove', rendering.onCanvasHoverMove);
  elements.gelCanvas?.addEventListener('mouseleave', rendering.onCanvasHoverLeave);

  function render() {
    recordsManager.ensureState();
    imageController.renderEnhancementValues();
    cropController.setCropUiState();
    manualWorkflow.renderOverrideStatus();
    manualWorkflow.renderManualProgress();
    manualWorkflow.renderViewerToolbar();
    laneTable.render();
    recordsManager.renderList();
    if (!runtime.currentImage) {
      rendering.renderCanvas();
    }
    if (!savedDraftSnapshot) {
      markDraftSaved();
    }
  }

  function onRunAnalysis() {
    if (!runtime.currentImage) {
      setStatus('Load a gel image before running analysis.');
      return;
    }

    try {
      const params = recordsManager.readParams();
      const preprocessed = imageController.getPreprocessedImageForCurrentSettings();
      const result = analyzeGelImage({
        gray: runtime.currentImage.gray,
        imageName: runtime.currentImage.name,
        width: runtime.currentImage.width,
        height: runtime.currentImage.height,
        params,
        preprocessed
      });
      runtime.currentReport = result.report;
      renderCanvasAndCommit();
      // No success message: it would replace the hint for the next step.
      manualWorkflow.renderOverrideStatus();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Analysis failed.');
    }
  }

  function destroy() {
    blotFigure?.destroy();
    manualWorkflow.destroy();
    floatingWindows.destroy();
    viewerResizeObserver?.disconnect();
    unbindFileDrop?.();
    if (runtime.enhancementRerunTimer) {
      clearTimeout(runtime.enhancementRerunTimer);
      runtime.enhancementRerunTimer = null;
    }
    cropController.leaveCropMode();
    rootDocument.removeEventListener('keydown', onCropKeydown, true);
    if (rootWindow) {
      rootWindow.removeEventListener('pointermove', cropController.onRotationDragMove);
      rootWindow.removeEventListener('pointerup', cropController.onRotationDragEnd);
      rootWindow.removeEventListener('pointercancel', cropController.onRotationDragEnd);
      rootWindow.removeEventListener('mousemove', manualWorkflow.onCanvasMouseMove);
      rootWindow.removeEventListener('mouseup', manualWorkflow.onCanvasMouseUp);
    }
  }

  return {
    destroy,
    getHistoryState: () => blotFigure?.isOpen() ? blotFigure.getHistoryState() : history.getHistoryState(),
    redo: () => blotFigure?.isOpen() ? blotFigure.redo() : history.redo(),
    resetHistory: history.reset,
    undo: () => blotFigure?.isOpen() ? blotFigure.undo() : history.undo(),
    hasUnsavedChanges: () => Boolean(blotFigure?.hasUnsavedChanges()
      || (!blotFigure?.ownsEditor() && savedDraftSnapshot && getCurrentDraftSnapshot() !== savedDraftSnapshot)),
    render,
    renderList: recordsManager.renderList,
    saveUnsavedChanges: async () => {
      if (blotFigure?.hasUnsavedChanges() && !await blotFigure.saveProject()) return false;
      if (blotFigure?.ownsEditor()) { markDraftSaved(); return true; }
      if (getCurrentDraftSnapshot() === savedDraftSnapshot) return true;
      const record = await recordsManager.onSaveAnalysis({ preventDefault() {} });
      return Boolean(record) && getCurrentDraftSnapshot() === savedDraftSnapshot;
    },
    startLinkedGel: (link) => { blotFigure?.detachEditor(); return recordsManager.startLinkedGel(link); }
  };
}
