import { analyzeGelImage } from './analysis/analysis-core.js';
import { createCropController } from './images/crop-controller.js';
import { getGelElements } from './dom.js';
import { createImageController } from './images/image-controller.js';
import { createLaneTableController } from './rendering/lane-table.js';
import { createManualWorkflowController } from './manual/manual-workflow.js';
import { createHistoryController } from './history.js';
import { createRecordsManager } from './records-manager.js';
import { createRenderingController, selectViewerBaseImageData } from './rendering/index.js';
import { DEFAULT_LADDER_PRESET_ID, LADDER_PRESETS, getLadderPresetBands } from './constants.js';
import { createEmptyManualOverrides } from './shared.js';
import { bindFileDropTarget } from '../../lib/file-drop.js';
import { serializeDraftSnapshot, snapshotFormControls } from '../../lib/unsaved-draft.js';

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
    cellTableDialogOpen: false,
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
      controls: snapshotFormControls(elements.gelForm),
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
      onHistoryChanged: (historyState) => onHistoryChanged?.(historyState),
      renderAll: () => {
        manualWorkflow.renderOverrideStatus();
        rendering.renderCanvas();
        onRunAnalysis();
      }
    }
  });

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

  elements.gelImageFileInput?.addEventListener('change', imageController.onImageFileChange);
  const unbindFileDrop = bindFileDropTarget({
    target: elements.gelViewerStage || elements.gelImageRow || elements.gelForm,
    accept: elements.gelImageFileInput?.getAttribute?.('accept') || 'image/*',
    onFiles: ([file]) => imageController.loadImageFile(file),
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
      new rootWindow.ResizeObserver(() => laneTable.fitViewerToStage())
        .observe(elements.gelViewerStage);
    }
  }
  elements.gelCancelBtn?.addEventListener('click', recordsManager.resetForm);
  elements.gelExportCsvBtn?.addEventListener('click', recordsManager.onExportCsv);
  elements.gelToolDividersBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('dividers'));
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
  // ponytail: the MW suggestions are rebuilt on focus rather than tracked from
  // every place the preset can change (reset, record load, user pick).
  elements.gelLadderBandMwInput?.addEventListener('focus', () => {
    if (!elements.gelLadderBandMwOptions) {
      return;
    }
    elements.gelLadderBandMwOptions.innerHTML = getLadderPresetBands(elements.gelLadderPresetSelect?.value)
      .map((size) => `<option value="${size}"></option>`)
      .join('');
  });
  elements.gelToolLadderLaneBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('ladder'));
  elements.gelToolLaneVerticesBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('lane-vertices'));
  elements.gelToolBandTopBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('band-top'));
  elements.gelToolBandBottomBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('band-bottom'));
  elements.gelLaneBandModeBtn?.addEventListener('click', manualWorkflow.onLaneBandModeToggle);
  elements.gelAddTableBtn?.addEventListener('click', laneTable.onAddTableClick);
  elements.gelExportImageBtn?.addEventListener('click', (event) => laneTable.onGenerateFigureClick(event.currentTarget));
  elements.gelExportPptxBtn?.addEventListener('click', (event) => laneTable.onGeneratePowerPointClick(event.currentTarget));
  elements.gelLaneTableShell?.addEventListener('click', laneTable.onShellClick);
  elements.gelLaneTableShell?.addEventListener('input', laneTable.onShellInput);
  elements.gelForm?.addEventListener('submit', recordsManager.onSaveAnalysis);
  elements.gelSearchInput?.addEventListener('input', recordsManager.renderList);
  elements.gelList?.addEventListener('click', recordsManager.onListClick);
  elements.gelManualNextBtn?.addEventListener('click', manualWorkflow.onManualNextStep);
  elements.gelManualResetBtn?.addEventListener('click', manualWorkflow.onManualResetSteps);
  elements.gelAutoDetectLanesBtn?.addEventListener('click', manualWorkflow.onAutoDetectLanes);
  elements.gelCellSnrThresholdInput?.addEventListener('input', () => {
    rendering.renderCellTable();
    rendering.renderCanvas();
  });
  function updateViewerModeButtons() {
    const isProcessed = runtime.viewerMode === 'processed';
    if (elements.gelProcessImageBtn) {
      elements.gelProcessImageBtn.setAttribute('aria-pressed', String(isProcessed));
      elements.gelProcessImageBtn.classList.toggle('is-active', isProcessed);
    }
    if (elements.gelViewOriginalBtn) {
      elements.gelViewOriginalBtn.setAttribute('aria-pressed', String(!isProcessed));
      elements.gelViewOriginalBtn.classList.toggle('is-active', !isProcessed);
    }
  }
  elements.gelProcessImageBtn?.addEventListener('click', () => {
    if (!runtime.currentImage) {
      setStatus('Load a gel image before processing.');
      return;
    }
    runtime.viewerMode = 'processed';
    updateViewerModeButtons();
    rendering.renderCanvas();
    setStatus('Showing processed image (denoise + contrast applied).');
  });
  elements.gelViewOriginalBtn?.addEventListener('click', () => {
    runtime.viewerMode = 'original';
    updateViewerModeButtons();
    rendering.renderCanvas();
    setStatus('Showing original gel image.');
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
  elements.gelOpenPeakEditorBtn?.addEventListener('click', rendering.onPeakEditorOpen);
  elements.gelPeakEditorCloseBtn?.addEventListener('click', rendering.onPeakEditorClose);
  elements.gelOpenCellTableBtn?.addEventListener('click', rendering.onCellTableOpen);
  elements.gelCellTableCloseBtn?.addEventListener('click', rendering.onCellTableClose);
  elements.gelCellTableOverlay?.addEventListener('click', rendering.onCellTableOverlayClick);
  rootDocument?.addEventListener?.('keydown', rendering.onCellTableKeyDown);
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
      setStatus('Running gel analysis pipeline...');
      const result = analyzeGelImage({
        gray: runtime.currentImage.gray,
        imageName: runtime.currentImage.name,
        width: runtime.currentImage.width,
        height: runtime.currentImage.height,
        params,
        preprocessed
      });
      runtime.currentReport = result.report;
      rendering.renderCanvas();
      manualWorkflow.renderOverrideStatus();
      setStatus(`Analysis complete: ${runtime.currentReport.lanes.length} lane(s), ${runtime.currentReport.bandGroups.length} group(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Analysis failed.');
    }
  }

  function destroy() {
    unbindFileDrop?.();
    if (runtime.enhancementRerunTimer) {
      clearTimeout(runtime.enhancementRerunTimer);
      runtime.enhancementRerunTimer = null;
    }
    cropController.leaveCropMode();
    if (rootWindow) {
      rootWindow.removeEventListener('pointermove', cropController.onRotationDragMove);
      rootWindow.removeEventListener('pointerup', cropController.onRotationDragEnd);
      rootWindow.removeEventListener('pointercancel', cropController.onRotationDragEnd);
      rootWindow.removeEventListener('mousemove', manualWorkflow.onCanvasMouseMove);
      rootWindow.removeEventListener('mouseup', manualWorkflow.onCanvasMouseUp);
    }
    rootDocument.removeEventListener?.('keydown', rendering.onCellTableKeyDown);
  }

  return {
    destroy,
    getHistoryState: history.getHistoryState,
    redo: history.redo,
    resetHistory: history.reset,
    undo: history.undo,
    hasUnsavedChanges: () => Boolean(savedDraftSnapshot && getCurrentDraftSnapshot() !== savedDraftSnapshot),
    render,
    renderList: recordsManager.renderList,
    saveUnsavedChanges: async () => {
      const record = await recordsManager.onSaveAnalysis({ preventDefault() {} });
      return Boolean(record) && getCurrentDraftSnapshot() === savedDraftSnapshot;
    },
    startLinkedGel: recordsManager.startLinkedGel
  };
}
