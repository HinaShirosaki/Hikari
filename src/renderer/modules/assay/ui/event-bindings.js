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
  elements.assaySampleAxisInput?.addEventListener('change', () => {
    layoutManager.syncAxisDisplay();
    layoutManager.setLayoutFromAxisAndOverrides();
    layoutManager.renderPlatePreview();
    resultsManager.renderResultTable();
  });
  elements.assaySampleAxisRowBtn?.addEventListener('click', () => layoutManager.setSampleAxis('row'));
  elements.assaySampleAxisColumnBtn?.addEventListener('click', () => layoutManager.setSampleAxis('column'));
  elements.assayConcentrationAxisInput?.addEventListener('change', () => {
    layoutManager.setConcentrationAxis(elements.assayConcentrationAxisInput?.value);
  });
  elements.assayConcentrationAxisRowBtn?.addEventListener('click', () => layoutManager.setConcentrationAxis('row'));
  elements.assayConcentrationAxisColumnBtn?.addEventListener('click', () => layoutManager.setConcentrationAxis('column'));
  elements.assayPlateFieldSampleBtn?.addEventListener('click', () => layoutManager.setPlateEditField('sampleId'));
  elements.assayPlateFieldConcentrationBtn?.addEventListener('click', () => layoutManager.setPlateEditField('concentration'));
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
  elements.assayExportTemplateBtn?.addEventListener('click', layoutManager.exportCsvTemplate);
  elements.assayImportTemplateBtn?.addEventListener('click', () => elements.assayImportFile?.click());
  elements.assayImportFile?.addEventListener('change', layoutManager.onImportCsv);
  elements.assayResultsAssaySelect?.addEventListener('change', onResultsAssaySelected);
  elements.assayAnalysisKindInput?.addEventListener('change', analysisView.onAnalysisMethodChange);
  elements.assayAnalysisGroupByInput?.addEventListener('change', analysisView.onAnalysisMethodChange);
  elements.assayAnalysisXAxisInput?.addEventListener('change', analysisView.onAnalysisMethodChange);
  elements.assayAnalysisXTransformInput?.addEventListener('change', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisAsymmetricInput?.addEventListener('change', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisPolyOrderInput?.addEventListener('change', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisSubtotalsInput?.addEventListener('change', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisRowGroupsInput?.addEventListener('input', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisColumnGroupsInput?.addEventListener('input', analysisView.onAnalysisConfigChange);
  elements.assayAnalysisErrorBarsInput?.addEventListener('change', analysisView.onAnalysisConfigChange);
  elements.assayTransformOpenBtn?.addEventListener('click', analysisView.createTransformPlate);
  elements.assayTransformClearBtn?.addEventListener('click', analysisView.clearTransform);
  elements.assayDerivedPlatePanel?.addEventListener('toggle', () => {
    if (elements.assayDerivedPlatePanel.open) {
      analysisView.redrawTransformGrid();
    }
  });
  elements.assayAnalysisAddRowGroupBtn?.addEventListener('click', resultsManager.onAddSelectedRowGroup);
  elements.assayAnalysisAddColumnGroupBtn?.addEventListener('click', resultsManager.onAddSelectedColumnGroup);
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
