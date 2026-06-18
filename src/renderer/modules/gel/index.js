import { analyzeGelImage } from './analysis-core.js';
import { createCropController } from './crop-controller.js';
import { getGelElements } from './dom.js';
import { createImageController } from './image-controller.js';
import { createLaneTableController } from './lane-table.js';
import { createManualWorkflowController } from './manual-workflow.js';
import { createRecordsManager } from './records-manager.js';
import { createRenderingController, selectViewerBaseImageData } from './rendering.js';
import { createEmptyManualOverrides } from './shared.js';
import { bindFileDropTarget } from '../file-drop.js';
import { serializeDraftSnapshot, snapshotFormControls } from '../unsaved-draft.js';

export { selectViewerBaseImageData };

export function initGelAnalysis({
  state,
  persist,
  createId,
  safeText,
  onGelAnalysesChanged,
  document: rootDocument = globalThis?.document || null
}) {
  const elements = getGelElements(rootDocument);
  const runtime = {
    createId,
    cropApplied: false,
    cropDisplaySize: null,
    cropperActive: false,
    cropperInstance: null,
    currentImage: null,
    currentReport: null,
    enhancementRerunTimer: null,
    imageRevision: 0,
    manualDividerConfirmed: false,
    manualOverrides: createEmptyManualOverrides(),
    onGelAnalysesChanged,
    originalImage: null,
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
  const laneTable = createLaneTableController({
    runtime,
    elements,
    safeText,
    deps: {
      setStatus
    }
  });
  const imageController = createImageController({
    runtime,
    elements,
    deps: {
      leaveCropMode: () => cropController.leaveCropMode(),
      onRunAnalysis,
      renderCanvas: () => rendering.renderCanvas(),
      renderOverrideStatus: () => manualWorkflow.renderOverrideStatus(),
      renderReport: () => rendering.renderReport(),
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
      renderCanvas: () => rendering.renderCanvas(),
      renderOverrideStatus: () => manualWorkflow.renderOverrideStatus(),
      renderReport: () => rendering.renderReport(),
      setCurrentImage: imageController.setCurrentImage,
      setStatus
    }
  });
  const manualWorkflow = createManualWorkflowController({
    runtime,
    elements,
    deps: {
      onRunAnalysis,
      renderCanvas: () => rendering.renderCanvas(),
      renderLaneTable: () => laneTable.render(),
      renderReport: () => rendering.renderReport(),
      setStatus
    }
  });
  const recordsManager = createRecordsManager({
    runtime,
    elements,
    deps: {
      imageDataToDataUrl: imageController.imageDataToDataUrl,
      leaveCropMode: () => cropController.leaveCropMode(),
      readEnhancementSettingsFromUi: imageController.readEnhancementSettingsFromUi,
      renderCanvas: () => rendering.renderCanvas(),
      renderEnhancementValues: () => imageController.renderEnhancementValues(),
      renderManualProgress: () => manualWorkflow.renderManualProgress(),
      renderOverrideStatus: () => manualWorkflow.renderOverrideStatus(),
      renderReport: () => rendering.renderReport(),
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
      renderLaneTable: () => laneTable.render()
    }
  });

  elements.gelImageFileInput?.addEventListener('change', imageController.onImageFileChange);
  bindFileDropTarget({
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
  elements.gelRunBtn?.addEventListener('click', onRunAnalysis);
  elements.gelResetOverridesBtn?.addEventListener('click', manualWorkflow.onResetManualOverrides);
  elements.gelStartCropBtn?.addEventListener('click', cropController.onCropAction);
  elements.gelCancelCropBtn?.addEventListener('click', cropController.onCancelCrop);
  elements.gelResetCropBtn?.addEventListener('click', cropController.onResetCrop);
  elements.gelRotateLeftBtn?.addEventListener('click', cropController.onRotateLeft);
  elements.gelRotateRightBtn?.addEventListener('click', cropController.onRotateRight);
  elements.gelCanvas?.addEventListener('click', manualWorkflow.onCanvasClick);
  elements.gelCanvas?.addEventListener('contextmenu', manualWorkflow.onCanvasContextMenu);
  elements.gelCanvas?.addEventListener('mousedown', manualWorkflow.onCanvasMouseDown);
  if (typeof window !== 'undefined') {
    window.addEventListener('mousemove', manualWorkflow.onCanvasMouseMove);
    window.addEventListener('mouseup', manualWorkflow.onCanvasMouseUp);
  }
  elements.gelCancelBtn?.addEventListener('click', recordsManager.resetForm);
  elements.gelExportJsonBtn?.addEventListener('click', recordsManager.onExportJson);
  elements.gelExportCsvBtn?.addEventListener('click', recordsManager.onExportCsv);
  elements.gelToolLeftBorderBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('left'));
  elements.gelToolRightBorderBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('right'));
  elements.gelToolDividersBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('dividers'));
  elements.gelToolLadderLaneBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('ladder'));
  elements.gelToolLaneVerticesBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('lane-vertices'));
  elements.gelToolBandTopBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('band-top'));
  elements.gelToolBandBottomBtn?.addEventListener('click', () => manualWorkflow.onViewerToolSelected('band-bottom'));
  elements.gelLaneBandModeBtn?.addEventListener('click', manualWorkflow.onLaneBandModeToggle);
  elements.gelAddTableBtn?.addEventListener('click', laneTable.onAddTableClick);
  elements.gelMeasureIntensityBtn?.addEventListener('click', onRunAnalysis);
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
    rendering.renderReport();
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
      rendering.renderReport();
      manualWorkflow.renderOverrideStatus();
      setStatus(`Analysis complete: ${runtime.currentReport.lanes.length} lane(s), ${runtime.currentReport.bandGroups.length} group(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Analysis failed.');
    }
  }

  return {
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
