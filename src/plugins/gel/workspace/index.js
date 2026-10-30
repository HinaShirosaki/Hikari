import { createPresentation } from "../i18n.mjs";
const i18nUi = createPresentation("gel");
import { analyzeGelImage } from './analysis/analysis-core.js';
import { BAND_MEASUREMENT_VERSION } from './analysis/lane-signal.js';
import { createCropController } from './images/crop-controller.js';
import { getGelElements } from './dom.js';
import { createFloatingWindows } from './floating-windows.js';
import { createGelToolDock } from './tool-dock.js';
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
  onRecoverSavedGels,
  onNotify,
  workspacePersistence = null,
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
    'gelCanvas'
  ];
  const missingElementKeys = requiredElementKeys.filter((key) => !elements[key]);
  if (missingElementKeys.length) {
    throw new Error(`Gel workspace markup is missing required elements: ${missingElementKeys.join(', ')}.`);
  }
  const rootWindow = rootDocument.defaultView || (typeof window !== 'undefined' ? window : null);
  function upgradeBandReport(draft) {
    const report = draft.currentReport, image = draft.currentImage;
    if (!image || report?.quantification?.version === BAND_MEASUREMENT_VERSION
      || !report?.lanes?.some(lane => lane.targetBand)) return null;
    const parameters = report.parameters || {};
    return analyzeGelImage({ gray: image.gray, imageName: image.name, width: image.width, height: image.height,
      preprocessed: { cleanNormalized: image.gray, preprocessing: report.preprocessing || {} },
      params: { ladderStandards: [], ladderLane: 1, normalization: 'none', ...parameters,
        analysisType: draft.controls?.['gel-type'] || report.analysisType,
        tiffPage: image.tiffPageIndex ?? report.image?.tiffPage ?? null,
        tiffPageCount: image.tiffPageCount ?? report.image?.tiffPageCount ?? null,
        manualOverrides: draft.manualOverrides, enhancement: parameters.enhancement || {} }
    }).report;
  }
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
    analysisPromise: null,
    analysisRevision: null,
    imageRevision: 0,
    figureExportIncludeLadder: true,
    ladderBandDrag: null,
    laneDividerDrag: null,
    suppressNextLaneDividerClick: false,
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
      // The tool sections live in #gel-form too; these fields are view
      // state, not record data, so editing them is not an unsaved change.
      controls: snapshotFormControls(elements.gelForm, {
        excludeIds: ['gel-expected-lane-count', 'gel-lane-profile-select', 'gel-processed-preview']
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
      i18nUi.setOwnedText(elements.gelStatus, (message || ''));
      elements.gelStatus.hidden = true;
    }
    onNotify?.(message);
  }

  let rendering;
  let blotFigure;
  function renderCanvasAndCommit() {
    rendering.renderCanvas();
    // One gesture, one undo step. A drag re-renders on every pointer sample, so
    // committing those would push dozens of entries and shove every earlier edit
    // off the end of the stack. Both drags clear their flag before the mouseup
    // render, so the settled position is what gets committed.
    if (runtime.laneVertexDrag || runtime.ladderBandDrag || runtime.laneDividerDrag) {
      return;
    }
    history.commit();
  }

  const history = createHistoryController({
    runtime,
    deps: {
      onHistoryChanged: (historyState) => {
        if (!blotFigure?.ownsHistory()) onHistoryChanged?.(historyState);
      },
      renderAll: ({ analyzed }) => {
        const segmentation = runtime.manualOverrides?.laneSegmentation || {};
        runtime.currentReport = null;
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
      getFigureImageData: async () => {
        const image = runtime.currentImage, revision = runtime.imageRevision, mode = runtime.viewerMode;
        const preprocessed = mode === 'processed' ? await imageController.prepareCurrentImage() : null;
        if (image !== runtime.currentImage || revision !== runtime.imageRevision || mode !== runtime.viewerMode || (mode === 'processed' && !preprocessed)) {
          throw new Error('The gel changed while preparing the export. Try exporting again.');
        }
        return selectViewerBaseImageData(image, preprocessed, mode);
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
      bindCropModeLabel: (element, label) => {
        i18nUi.setAttribute(element, 'title', i18nUi.owned(label));
        i18nUi.setAttribute(element, 'aria-label', i18nUi.owned(label));
      },
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
      beforeSave: settleProcessing,
      upgradeBandReport,
      confirmDelete: (record) => (
        typeof rootWindow?.confirm !== 'function'
        || rootWindow.confirm(
          i18nUi.text("Remove the saved Gel record \"{p0}\"? Its artifact files will remain in plugin storage.", { p0: record?.name || record?.id || 'Untitled gel' })
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
      onPeakIntegrationsChanged: () => {
        renderCanvasAndCommit();
        if (runtime.currentReport) void onRunAnalysis();
      },
      setStatus
    }
  });

  floatingWindows = createFloatingWindows({
    documentObject: rootDocument,
    onOpen: {
      intensity: () => rendering.renderCellTable(),
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
      prepareImage: imageController.prepareImage,
      upgradeBandReport,
      peekProcessedImage: imageController.peekProcessedImage,
      saveImportedGel: recordsManager.saveImportedGel,
      restoreRecordImage: recordsManager.restoreRecordImage,
      openSavedAnalysis: recordsManager.fillFromRecord,
      recoverSavedGels: onRecoverSavedGels,
      notify: onNotify,
      workspacePersistence,
      resetEditor: recordsManager.resetForm,
      leaveCropMode: () => cropController.leaveCropMode(),
      hideWindows: () => floatingWindows.closeAll(),
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
        cropController.setCropUiState();
        runtime.manualOverrides = JSON.parse(JSON.stringify(draft.manualOverrides));
        runtime.currentReport = draft.currentReport ? JSON.parse(JSON.stringify(draft.currentReport)) : null;
        runtime.cropApplied = draft.cropApplied;
        runtime.viewerMode = draft.viewerMode;
        runtime.pendingNotebookLink = draft.pendingNotebookLink;
        runtime.selectedViewerTool = '';
        runtime.selectedLaneProfileLane = null;
        runtime.laneProfileHoverY = null;
        imageController.renderEnhancementValues();
        updateViewerModeButtons();
        manualWorkflow.renderOverrideStatus();
        manualWorkflow.renderManualProgress();
        history.reset();
        if (draft.analysisPending) void onRunAnalysis();
      },
      setStatus
    }
  });

  const toolDock = createGelToolDock({
    documentObject: rootDocument,
    onProcess: () => blotFigure.processSelected(),
    onSelect: category => { if (category === 'results') { rendering.renderCellTable(); rendering.renderLaneProfile(); } }
  });

  elements.gelImageFileInput?.addEventListener('change', (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length || blotFigure?.handleFileDrop(files)) return;
    return imageController.loadImageFile(files[0]);
  });
  const unbindFileDrop = bindFileDropTarget({
    target: elements.gelViewerStage || elements.gelImageRow || elements.gelForm,
    accept: elements.gelImageFileInput?.getAttribute?.('accept') || 'image/*',
    multiple: true,
    onFiles: (files) => {
      if (blotFigure?.handleFileDrop(files)) return;
      blotFigure?.detachEditor();
      return imageController.loadImageFile(files[0]);
    },
    onRejected: () => {
      if (blotFigure?.handleFileDrop([])) return;
      setStatus(i18nUi.text("Drop an image file to load it into Gel."));
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
    i18nUi.setHtml(elements.gelLadderPresetSelect, groups.map((group) => {
      const options = LADDER_PRESETS
        .filter((preset) => preset.group === group)
        .map((preset) => `<option value="${preset.id}">${safeText(preset.label)}</option>`)
        .join('');
      return `<optgroup label="${safeText(group)}">${options}</optgroup>`;
    }).join(''));
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
  // The table bar (rows, ladder lane) and the strip's inputs both live in the panel.
  elements.gelLaneTablePanel?.addEventListener('click', laneTable.onShellClick);
  elements.gelLaneTablePanel?.addEventListener('input', (event) => {
    laneTable.onShellInput(event);
    rendering.renderCellTable();
  });
  elements.gelForm?.addEventListener('submit', recordsManager.onSaveAnalysis);
  elements.gelSearchInput?.addEventListener('input', recordsManager.renderList);
  elements.gelList?.addEventListener('click', recordsManager.onListClick);
  // Export and record actions are popover menus. Close one before its item
  // runs: the exports disable their own button while working, and a disabled
  // button skips the popovertargetaction hide, which left the menu open.
  rootDocument.querySelectorAll('.gel-menu:not(.gel-divider-menu)').forEach((menu) => {
    menu.addEventListener('click', (event) => {
      if (event.target.closest('button')) menu.hidePopover?.();
    }, true);
  });
  elements.gelAutoDetectLanesBtn?.addEventListener('click', manualWorkflow.onAutoDetectLanes);
  // The lane count sits inside #gel-form, where Enter would submit (save) the
  // record. Enter here means "detect with this count".
  elements.gelExpectedLaneCountInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    manualWorkflow.onAutoDetectLanes();
  });
  function updateViewerModeButtons() {
    if (elements.gelProcessedPreviewInput) elements.gelProcessedPreviewInput.checked = runtime.viewerMode === 'processed';
  }
  function setViewerMode(mode) {
    if (mode === 'processed' && !runtime.currentImage) {
      updateViewerModeButtons();
      setStatus(i18nUi.text("Load a gel image before processing."));
      return;
    }
    runtime.viewerMode = mode;
    imageController.updateProcessingNotice();
    updateViewerModeButtons();
    rendering.renderCanvas();
  }
  // Opening enhancement tools previews their effect; the panel switch compares
  // it with the original without changing the saved enhancement settings.
  elements.gelProcessImageBtn?.addEventListener('click', () => {
    if (elements.gelProcessImageBtn.getAttribute('aria-expanded') === 'true') setViewerMode('processed');
  });
  elements.gelProcessedPreviewInput?.addEventListener('change', () => setViewerMode(elements.gelProcessedPreviewInput.checked ? 'processed' : 'original'));
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
    blotFigure?.refreshSavedRecords();
    if (!runtime.currentImage) {
      rendering.renderCanvas();
    }
    if (!savedDraftSnapshot) {
      markDraftSaved();
    }
  }

  let analysisRequest = 0;
  let disposed = false;
  function onRunAnalysis() {
    if (!runtime.currentImage) { setStatus(i18nUi.text("Load a gel image before running analysis.")); return Promise.resolve(null); }
    const request = ++analysisRequest, image = runtime.currentImage, revision = runtime.imageRevision;
    const params = recordsManager.readParams(), signature = JSON.stringify(params);
    const task = (async () => {
      try {
        const preprocessed = await imageController.prepareCurrentImage();
        if (!preprocessed || disposed || request !== analysisRequest || image !== runtime.currentImage || revision !== runtime.imageRevision
          || signature !== JSON.stringify(recordsManager.readParams())) return null;
        const result = analyzeGelImage({ gray: image.gray, imageName: image.name, width: image.width, height: image.height, params, preprocessed });
        runtime.currentReport = result.report;
        renderCanvasAndCommit(); manualWorkflow.renderOverrideStatus();
        return result;
      } catch (error) { if (!disposed && request === analysisRequest) setStatus(((error instanceof Error ? error.message : i18nUi.text("Analysis failed.")))); return null; }
    })();
    runtime.analysisPromise = task;
    runtime.analysisRevision = revision;
    void task.finally(() => { if (runtime.analysisPromise === task) runtime.analysisPromise = null; });
    return task;
  }
  async function settleProcessing() {
    if (!runtime.currentImage) return;
    const result = await imageController.prepareCurrentImage();
    if (!result && runtime.currentImage) throw new Error('The gel changed while processing. Try saving again.');
    if (runtime.enhancementRerunTimer) {
      clearTimeout(runtime.enhancementRerunTimer); runtime.enhancementRerunTimer = null;
      await onRunAnalysis();
    }
    if (runtime.analysisPromise) await runtime.analysisPromise;
  }

  function destroy() {
    disposed = true; analysisRequest++;
    rendering.destroy?.();
    toolDock.destroy();
    imageController.destroy();
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
    ready: blotFigure?.ready,
    waitForProcessing: settleProcessing,
    getProcessingStats: imageController.getProcessingStats,
    suspendWorkspace: () => blotFigure?.suspendWorkspace(),
    destroy,
    getHistoryState: () => blotFigure?.ownsHistory() ? blotFigure.getHistoryState() : history.getHistoryState(),
    redo: () => blotFigure?.ownsHistory() ? blotFigure.redo() : history.redo(),
    resetHistory: history.reset,
    undo: () => blotFigure?.ownsHistory() ? blotFigure.undo() : history.undo(),
    hasUnsavedChanges: () => Boolean(blotFigure?.hasUnsavedChanges()
      || (!blotFigure?.ownsEditor() && savedDraftSnapshot && getCurrentDraftSnapshot() !== savedDraftSnapshot)),
    render,
    renderList: () => { recordsManager.renderList(); blotFigure?.refreshSavedRecords(); },
    saveUnsavedChanges: async () => {
      await settleProcessing();
      if (blotFigure?.hasUnsavedChanges() && !await blotFigure.saveWorkspace()) return false;
      if (blotFigure?.ownsEditor()) { markDraftSaved(); return true; }
      if (getCurrentDraftSnapshot() === savedDraftSnapshot) return true;
      const record = await recordsManager.onSaveAnalysis({ preventDefault() {} });
      return Boolean(record) && getCurrentDraftSnapshot() === savedDraftSnapshot;
    },
    startLinkedGel: (link) => { blotFigure?.detachEditor(); return recordsManager.startLinkedGel(link); }
  };
}
