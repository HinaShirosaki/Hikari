import { bindFileDropTarget } from '../../../lib/file-drop.js';
import { notifyUnsupportedDrop } from '../../../lib/notify.js';
import { shellText } from '../../../lib/i18n/shell.js';
// Wires the assay page DOM elements to their handlers. Pure wiring, no state.
export function bindAssayEvents({
  elements,
  layoutManager,
  resultsManager,
  analysisView,
  handlers
}) {
  const {
    onSubmit,
    startNewAssay,
    resetForm,
    setAssayMode,
    renderNotebookOptions,
    renderAssayNumberDisplay,
    onResultsAssaySelected,
    onSaveResults,
    renderList,
    onListClick
  } = handlers;

  elements.assayForm?.addEventListener('submit', onSubmit);
  elements.assayNewBtn?.addEventListener('click', startNewAssay);
  elements.assayCancelBtn?.addEventListener('click', resetForm);
  elements.assayModeCreateBtn?.addEventListener('click', () => setAssayMode('create'));
  elements.assayModeResultsBtn?.addEventListener('click', () => setAssayMode('results'));
  elements.assayProjectInput?.addEventListener('change', renderNotebookOptions);
  elements.assayPlateTypeInput?.addEventListener('change', () => {
    layoutManager.onPlateTypeChange();
    renderAssayNumberDisplay();
  });
  elements.assayRowAxisInput?.addEventListener('change', (event) => {
    layoutManager.onAxisAssignmentChange('row', event.currentTarget.value);
  });
  elements.assayColumnAxisInput?.addEventListener('change', (event) => {
    layoutManager.onAxisAssignmentChange('column', event.currentTarget.value);
  });
  elements.assayFillModeInput?.addEventListener('change', layoutManager.syncFillModeInputs);
  elements.assayDilutionFillBtn?.addEventListener('click', layoutManager.onFillConcentrations);
  layoutManager.syncFillModeInputs();
  elements.assayClearMappingsBtn?.addEventListener('click', layoutManager.onClearWellMappings);
  elements.assaySerialDilutionBtn?.addEventListener('click', layoutManager.openSerialDilutionDialog);
  elements.assaySerialDilutionCloseBtn?.addEventListener('click', layoutManager.closeSerialDilutionDialog);
  elements.assaySerialDilutionOverlay?.addEventListener('click', layoutManager.onSerialDilutionOverlayClick);
  elements.assaySerialDilutionOverlay?.addEventListener('input', layoutManager.onSerialDilutionDialogInput);
  elements.assaySearchInput?.addEventListener('input', renderList);
  elements.assayResultsSearchInput?.addEventListener('input', renderList);
  elements.assayLayoutExportMenu?.addEventListener('click', (event) => {
    const format = event.target.closest('[data-assay-layout-export]')?.dataset.assayLayoutExport;
    if (format) {
      event.currentTarget.hidePopover();
      void layoutManager.exportLayout(format);
    }
  });
  elements.assayImportTemplateBtn?.addEventListener('click', () => elements.assayImportFile?.click());
  elements.assayImportFile?.addEventListener('change', layoutManager.onImportCsv);
  bindFileDropTarget({
    target: elements.assayCreateLayout?.querySelector?.('.left-rail-template__main') || elements.assayCreateLayout,
    caption: () => shellText('fileDrop.caption.plateLayout'),
    input: elements.assayImportFile,
    disabled: () => Boolean(elements.assayCreateLayout?.hidden),
    onRejected: notifyUnsupportedDrop
  });
  elements.assayResultsAssaySelect?.addEventListener('change', onResultsAssaySelected);
  elements.assayAnalysisKindInput?.addEventListener('change', analysisView.onAnalysisMethodChange);
  elements.assayAnalysisGroupByInput?.addEventListener('change', analysisView.onAnalysisMethodChange);
  elements.assayAnalysisDataSourceInput?.addEventListener('change', analysisView.onAnalysisDataSourceChange);
  elements.assayAnalysisXAxisInput?.addEventListener('change', analysisView.onAnalysisMethodChange);
  // The order applies as it is typed; a blank or out-of-range box waits.
  elements.assayAnalysisPolyOrderInput?.addEventListener('input', (event) => {
    if (event.target.value !== '' && event.target.validity.valid) analysisView.onAnalysisConfigChange(event);
  });
  elements.assayAnalysisSubtotalsInput?.addEventListener('change', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisHighControlInput?.addEventListener('change', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisLowControlInput?.addEventListener('change', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisRowGroupsInput?.addEventListener('input', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisColumnGroupsInput?.addEventListener('input', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisErrorBarsInput?.addEventListener('change', analysisView.onAnalysisConfigChange);
  elements.assayChartExportPngBtn?.addEventListener('click', () => analysisView.exportChartImage('png'));
  elements.assayChartExportSvgBtn?.addEventListener('click', () => analysisView.exportChartImage('svg'));
  elements.assayTransformOpenBtn?.addEventListener('click', analysisView.createTransformPlate);
  elements.assayTransformClearBtn?.addEventListener('click', analysisView.clearTransform);
  elements.assayDerivedPlatePanel?.addEventListener('toggle', () => {
    if (elements.assayDerivedPlatePanel.open) {
      analysisView.redrawTransformGrid();
    }
  });
  elements.assayAnalysisAddRowGroupBtn?.addEventListener('click', resultsManager.onStartRowGroup);
  elements.assayAnalysisAddColumnGroupBtn?.addEventListener('click', resultsManager.onStartColumnGroup);
  elements.assayAnalysisClearGroupsBtn?.addEventListener('click', resultsManager.onClearAnalysisGroups);
  elements.assayAttachResultFileBtn?.addEventListener('click', resultsManager.onAttachResultFileClick);
  elements.assayResultFileInput?.addEventListener('change', resultsManager.onResultFileChange);
  elements.assayResultImportOverlay?.addEventListener('click', resultsManager.onResultImportOverlayClick);
  elements.assayResultImportCandidates?.addEventListener('click', resultsManager.onResultImportCandidateClick);
  elements.assayResultImportCloseBtn?.addEventListener('click', resultsManager.closeResultImportDialog);
  elements.assayResultImportCancelBtn?.addEventListener('click', resultsManager.closeResultImportDialog);
  elements.assayResultImportApplyBtn?.addEventListener('click', resultsManager.applySelectedResultImportCandidate);
  elements.assaySaveResultsBtn?.addEventListener('click', onSaveResults);
  elements.assayClearResultsBtn?.addEventListener('click', resultsManager.onClearResults);
  elements.assayResultTable?.addEventListener('paste', resultsManager.onResultTablePaste);
  elements.assayResultTablePanel?.addEventListener('toggle', () => {
    if (elements.assayResultTablePanel.open) {
      resultsManager.redrawResultGrid();
    }
  });
  elements.assayPlatePreview?.addEventListener('input', layoutManager.onPlatePreviewInput);
  elements.assayPlatePreview?.addEventListener('change', layoutManager.onPlatePreviewChange);
  elements.assayPlatePreview?.addEventListener('focusin', layoutManager.onPlatePreviewFocusIn);
  elements.assayPlatePreview?.addEventListener('click', layoutManager.onPlatePreviewClick);
  elements.assayPlatePreview?.addEventListener('keydown', layoutManager.onPlatePreviewKeyDown);
  elements.assayPlatePreview?.addEventListener('contextmenu', layoutManager.onPlatePreviewContextMenu);
  elements.assayPlatePreview?.addEventListener('scroll', layoutManager.onPlatePreviewScroll, true);
  elements.assayList?.addEventListener('click', onListClick);
  elements.assayResultsList?.addEventListener('click', onListClick);
  globalThis.addEventListener?.('pointerdown', layoutManager.onGlobalPointerDown);
  globalThis.addEventListener?.('keydown', layoutManager.onGlobalKeyDown);
}
