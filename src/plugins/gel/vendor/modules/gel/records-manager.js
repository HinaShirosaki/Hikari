import { DEFAULT_LADDER_PRESET_ID, getLadderPresetBands } from './constants.js';
import { createBandsCsv, downloadTextFile } from './export.js';
import { normalizeEnhancementSettings } from './analysis/image-processing.js';
import { clamp, createEmptyManualOverrides, normalizeManualOverrides, safeFilePart } from './shared.js';
import { createGelRecordArtifacts } from './records/record-artifacts.js';
import { createGelRecordImages } from './records/record-images.js';
import { createGelRecordList } from './records/record-list.js';

export function createRecordsManager({ runtime, elements, deps }) {
  let recordLoadRequest = 0;
  let savePromise = null;
  let exportPromise = null;
  let saveLockedControls = [];
  const deleteRequests = new Set();

  function ensureState() {
    if (!Array.isArray(runtime.state.gelAnalyses)) {
      runtime.state.gelAnalyses = [];
    }
  }

  const {
    getStorageRoot,
    syncNotebookGelLinks,
    persistNotebookPreviewImage,
    persistGelRecordArtifacts
  } = createGelRecordArtifacts({
    runtime,
    elements,
    deps
  });



  // An unknown id (older record, retired preset) falls back to the default so
  // the select never sits blank while readParams reports a preset.
  function setLadderPreset(presetId) {
    const select = elements.gelLadderPresetSelect;
    if (!select) {
      return;
    }
    select.value = String(presetId || DEFAULT_LADDER_PRESET_ID);
    if (!select.value) {
      select.value = DEFAULT_LADDER_PRESET_ID;
    }
  }

  function readParams() {
    const rawType = elements.gelTypeInput?.value;
    const analysisType = rawType === 'western' || rawType === 'agarose' ? rawType : 'sds-page';
    const enhancement = deps.readEnhancementSettingsFromUi();
    const ladderPreset = elements.gelLadderPresetSelect?.value || DEFAULT_LADDER_PRESET_ID;

    return {
      analysisType,
      analysisMode: 'manual',
      ladderPreset,
      ladderStandards: getLadderPresetBands(ladderPreset),
      ladderLane: clamp(Math.floor(Number(runtime.manualOverrides?.ladderLane) || 1), 1, 999),
      normalization: 'none',
      cropApplied: runtime.cropApplied,
      tiffPage: Number.isFinite(runtime.currentImage?.tiffPageIndex) ? runtime.currentImage.tiffPageIndex : null,
      tiffPageCount: Number.isFinite(runtime.currentImage?.tiffPageCount) ? runtime.currentImage.tiffPageCount : null,
      enhancement,
      manualOverrides: normalizeManualOverrides(runtime.manualOverrides)
    };
  }

  function buildRecordFromCurrentReport(existingId = '') {
    const pendingLink = runtime.pendingNotebookLink || {};
    const notebookEntryId = String(pendingLink.notebookEntryId || '').trim();
    const projectId = String(pendingLink.projectId || '').trim();
    const project = (runtime.state.projects || []).find((item) => item.id === projectId);
    const notebookEntry = (runtime.state.notebookEntries || []).find((entry) => entry.id === notebookEntryId);
    const report = runtime.currentReport;
    const params = readParams();
    const sourceImageName = String(runtime.currentImage?.name || '').trim();

    return {
      id: existingId || runtime.createId(),
      name: elements.gelNameInput?.value.trim() || `Gel-${Date.now()}`,
      projectId: projectId || project?.id || '',
      projectName: project?.name || notebookEntry?.projectName || '',
      notebookEntryId,
      notebookEntryProtocolName: notebookEntry?.experimentName || notebookEntry?.protocolName || '',
      notebookEntryType: notebookEntry?.notebookType || '',
      imageName: report?.image?.name || sourceImageName,
      analysisType: report?.analysisType || (elements.gelTypeInput?.value || 'sds-page'),
      parameters: report?.parameters || params,
      manualOverrides: normalizeManualOverrides(runtime.manualOverrides),
      report,
      updatedAt: new Date().toISOString()
    };
  }

  async function performSaveAnalysis() {
    ensureState();

    const name = elements.gelNameInput?.value.trim() || '';
    if (!name) {
      deps.setStatus('Gel name is required.');
      return null;
    }

    const editingId = elements.gelIdInput?.value || '';
    const existing = runtime.state.gelAnalyses.find((item) => item.id === editingId);
    const record = buildRecordFromCurrentReport(existing?.id || '');
    record.name = name;
    try {
      Object.assign(record, await persistNotebookPreviewImage(record, existing));
      Object.assign(record, await persistGelRecordArtifacts(record, existing));
    } catch (error) {
      deps.setStatus(error instanceof Error ? error.message : 'Could not save gel artifacts.');
      return null;
    }

    const index = runtime.state.gelAnalyses.findIndex((item) => item.id === record.id);
    const previousRecord = index >= 0 ? runtime.state.gelAnalyses[index] : null;
    if (index >= 0) {
      runtime.state.gelAnalyses[index] = record;
    } else {
      runtime.state.gelAnalyses.push(record);
    }

    syncNotebookGelLinks();
    try {
      await runtime.persist();
    } catch (error) {
      if (index >= 0) {
        runtime.state.gelAnalyses[index] = previousRecord;
      } else {
        runtime.state.gelAnalyses = runtime.state.gelAnalyses.filter((item) => item.id !== record.id);
      }
      syncNotebookGelLinks();
      deps.setStatus(`Could not save gel: ${error?.message || error}`);
      return null;
    }
    renderList();
    if (typeof runtime.onGelAnalysesChanged === 'function') {
      runtime.onGelAnalysesChanged();
    }
    // Cleared, not announced: a completed save needs no caption, but the previous
    // status must not linger as if it were the result of this save.
    deps.setStatus(record.report
      ? ''
      : `Saved gel draft: ${record.name}. You can finish the analysis later.`);
    runtime.markDraftSaved?.();
    return record;
  }

  function setActionLabel(button, label) {
    if (!button) return;
    const labelNode = button.querySelector?.('[data-gel-action-label]');
    (labelNode || button).textContent = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }

  function setSaveBusy(isBusy) {
    if (isBusy) {
      saveLockedControls = Array.from(
        elements.gelForm?.querySelectorAll?.('input, select, textarea, button') || []
      ).map((control) => ({ control, disabled: Boolean(control.disabled) }));
      saveLockedControls.forEach(({ control }) => {
        control.disabled = true;
      });
    } else {
      saveLockedControls.forEach(({ control, disabled }) => {
        control.disabled = disabled;
      });
      saveLockedControls = [];
    }
    if (elements.gelSaveBtn) {
      elements.gelSaveBtn.disabled = isBusy;
      setActionLabel(elements.gelSaveBtn, isBusy ? 'Saving…' : 'Save');
      elements.gelSaveBtn.setAttribute('aria-busy', String(isBusy));
    }
    elements.gelForm?.setAttribute('aria-busy', String(isBusy));
  }

  function onSaveAnalysis(event) {
    event?.preventDefault?.();
    if (savePromise) {
      return savePromise;
    }
    setSaveBusy(true);
    deps.setStatus('Saving gel analysis…');
    savePromise = performSaveAnalysis().finally(() => {
      setSaveBusy(false);
      savePromise = null;
    });
    return savePromise;
  }

  function runExclusiveExport(activeButton, action) {
    if (exportPromise) {
      return exportPromise;
    }
    const originalLabel = activeButton?.getAttribute('aria-label') || activeButton?.textContent || '';
    // Restore what each button was, not an assumed "enabled": these live inside
    // #gel-form, so a save running concurrently snapshots them and restores its
    // own copy afterwards. Forcing false here loses that race and leaves both
    // export buttons dead until the plugin reloads.
    const lockedExportButtons = [elements.gelExportCsvBtn]
      .filter(Boolean)
      .map((button) => ({ button, disabled: Boolean(button.disabled) }));
    lockedExportButtons.forEach(({ button }) => {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    });
    if (activeButton) {
      setActionLabel(activeButton, 'Exporting…');
    }
    exportPromise = Promise.resolve()
      .then(action)
      .finally(() => {
        lockedExportButtons.forEach(({ button, disabled }) => {
          button.disabled = disabled;
          button.removeAttribute('aria-busy');
        });
        if (activeButton) {
          setActionLabel(activeButton, originalLabel);
        }
        exportPromise = null;
      });
    return exportPromise;
  }

  function onExportCsv() {
    if (exportPromise) {
      return exportPromise;
    }
    if (!runtime.currentReport) {
      deps.setStatus('No analysis results to export.');
      return Promise.resolve(null);
    }

    const fileName = `${safeFilePart(elements.gelNameInput?.value, 'gel-analysis')}.csv`;
    return runExclusiveExport(elements.gelExportCsvBtn, async () => {
      try {
        const result = await downloadTextFile({
          content: createBandsCsv(runtime.currentReport),
          fileName,
          mimeType: 'text/csv;charset=utf-8;'
        });
        deps.setStatus(result?.canceled ? 'Export canceled.' : `Exported ${result?.fileName || fileName}.`);
        return result;
      } catch (error) {
        deps.setStatus(`Could not export CSV: ${error?.message || error}`);
        return null;
      }
    });
  }

  function resetForm() {
    if (savePromise) {
      deps.setStatus('Wait for the current save to finish before clearing the form.');
      return;
    }
    recordLoadRequest += 1;
    elements.gelForm?.setAttribute('aria-busy', 'false');
    if (elements.gelSaveBtn) {
      elements.gelSaveBtn.disabled = false;
    }
    elements.gelIdInput.value = '';
    elements.gelForm.reset();
    elements.gelTypeInput.value = 'sds-page';
    setLadderPreset(DEFAULT_LADDER_PRESET_ID);
    if (elements.gelDenoiseStrengthInput) {
      elements.gelDenoiseStrengthInput.value = '35';
    }
    if (elements.gelContrastStrengthInput) {
      elements.gelContrastStrengthInput.value = '100';
    }
    deps.renderEnhancementValues();

    deps.setCurrentImage(null);
    runtime.originalImage = null;
    runtime.originalFile = null;
    runtime.currentReport = null;
    runtime.manualOverrides = createEmptyManualOverrides();
    runtime.cropApplied = false;
    runtime.pendingNotebookLink = null;
    deps.leaveCropMode();
    runtime.manualDividerConfirmed = false;
    runtime.selectedViewerTool = '';

    deps.renderOverrideStatus();
    deps.renderManualProgress();
    deps.renderCanvas();
    deps.setStatus('');
    runtime.markDraftSaved?.();
  }

  const {
    restoreRecordImage
  } = createGelRecordImages({
    deps,
    getStorageRoot: () => getStorageRoot()
  });



  async function fillFromRecord(record) {
    const loadRequest = recordLoadRequest += 1;
    elements.gelForm?.setAttribute('aria-busy', 'true');
    if (elements.gelSaveBtn) {
      elements.gelSaveBtn.disabled = true;
    }
    elements.gelIdInput.value = record.id;
    elements.gelNameInput.value = record.name || '';
    runtime.pendingNotebookLink = {
      notebookEntryId: String(record.notebookEntryId || '').trim(),
      projectId: String(record.projectId || '').trim()
    };

    const parameters = record.parameters || {};
    elements.gelTypeInput.value = record.analysisType === 'western' || record.analysisType === 'agarose'
      ? record.analysisType
      : 'sds-page';
    setLadderPreset(parameters.ladderPreset);
    const enhancement = normalizeEnhancementSettings(parameters.enhancement || {});
    if (elements.gelDenoiseStrengthInput) {
      elements.gelDenoiseStrengthInput.value = String(enhancement.denoiseStrength);
    }
    if (elements.gelContrastStrengthInput) {
      elements.gelContrastStrengthInput.value = String(enhancement.contrastBoost);
    }
    deps.renderEnhancementValues();
    runtime.manualOverrides = normalizeManualOverrides(record.manualOverrides || parameters.manualOverrides);
    runtime.manualDividerConfirmed = Boolean(runtime.manualOverrides.laneSegmentation?.dividerDone);
    runtime.selectedViewerTool = '';
    deps.renderOverrideStatus();

    runtime.currentReport = record.report || null;
    deps.setCurrentImage(null);
    const clearedImageRevision = runtime.imageRevision;
    runtime.originalImage = null;
    runtime.originalFile = null;
    runtime.cropApplied = false;
    deps.leaveCropMode();
    deps.renderManualProgress();
    deps.renderCanvas();
    deps.setStatus('Loading saved gel image...');

    const restored = await restoreRecordImage(record);
    if (loadRequest !== recordLoadRequest || elements.gelIdInput.value !== record.id) {
      return;
    }

    elements.gelForm?.setAttribute('aria-busy', 'false');
    if (elements.gelSaveBtn) {
      elements.gelSaveBtn.disabled = false;
    }
    if (runtime.imageRevision !== clearedImageRevision) {
      return;
    }

    if (restored.image) {
      deps.setCurrentImage(restored.image);
      runtime.originalImage = deps.copyNormalizedImage(restored.image);
      deps.leaveCropMode();
      deps.renderCanvas();
      deps.setStatus(restored.kind === 'source'
        ? `Loaded saved gel: ${record.name || record.id}.`
        : `Loaded saved gel preview: ${record.name || record.id}. Upload the original image before reanalyzing.`);
    } else if (restored.hadCandidate) {
      const reason = restored.error instanceof Error ? ` ${restored.error.message}` : '';
      deps.setStatus(`Loaded saved analysis, but its image could not be restored.${reason}`);
    } else {
      deps.setStatus('Loaded saved analysis. This older record has no stored image; upload the original to restore the viewer.');
    }
    runtime.markDraftSaved?.();
  }

  async function deleteRecord(recordId) {
    if (!recordId || deleteRequests.has(recordId)) {
      return;
    }
    const record = (runtime.state.gelAnalyses || []).find((item) => item.id === recordId);
    if (!record) {
      return;
    }
    if (typeof deps.confirmDelete === 'function' && !deps.confirmDelete(record)) {
      deps.setStatus('Delete canceled.');
      return;
    }
    deleteRequests.add(recordId);
    const previousRecords = runtime.state.gelAnalyses || [];
    runtime.state.gelAnalyses = previousRecords.filter((item) => item.id !== recordId);
    syncNotebookGelLinks();
    try {
      await runtime.persist();
    } catch (error) {
      runtime.state.gelAnalyses = previousRecords;
      syncNotebookGelLinks();
      deps.setStatus(`Could not delete gel: ${error?.message || error}`);
      return;
    } finally {
      deleteRequests.delete(recordId);
    }
    renderList();
    if (typeof runtime.onGelAnalysesChanged === 'function') {
      runtime.onGelAnalysesChanged();
    }
    if (elements.gelIdInput?.value === recordId) {
      resetForm();
    }
    deps.setStatus(`Removed saved gel record: ${record.name || record.id}. Stored artifact files were left in place.`);
  }

  async function onListClick(event) {
    if (savePromise) {
      deps.setStatus('Wait for the current save to finish before opening or deleting another record.');
      return;
    }
    const target = event?.target;
    if (typeof target?.closest !== 'function') {
      return;
    }
    const editBtn = target.closest('[data-gel-edit]');
    if (editBtn) {
      const record = (runtime.state.gelAnalyses || []).find((item) => item.id === editBtn.dataset.gelEdit);
      if (record) {
        await fillFromRecord(record);
      }
      return;
    }

    const deleteBtn = target.closest('[data-gel-delete]');
    if (deleteBtn) {
      await deleteRecord(deleteBtn.dataset.gelDelete);
    }
  }

  const { renderList } = createGelRecordList({
    runtime,
    elements,
    ensureState: (...args) => ensureState(...args)
  });



  function startLinkedGel({ notebookEntryId = '', projectId = '', gelName = '' } = {}) {
    resetForm();

    const linkedEntry = (runtime.state.notebookEntries || []).find((entry) => entry.id === notebookEntryId);
    const resolvedProjectId = String(projectId || linkedEntry?.projectId || '').trim();
    runtime.pendingNotebookLink = {
      notebookEntryId: String(notebookEntryId || '').trim(),
      projectId: resolvedProjectId
    };
    const resolvedGelName = String(gelName || linkedEntry?.experimentName || linkedEntry?.protocolName || '').trim();
    if (resolvedGelName && elements.gelNameInput) {
      elements.gelNameInput.value = resolvedGelName;
    }
    if (elements.gelNameInput) {
      elements.gelNameInput.focus();
      elements.gelNameInput.select?.();
    }
    deps.setStatus(notebookEntryId
      ? `New gel analysis will be linked to notebook page ${notebookEntryId}.`
      : 'Create a new linked gel analysis.');
  }

  return {
    ensureState,
    onExportCsv,
    onListClick,
    onSaveAnalysis,
    readParams,
    renderList,
    resetForm,
    startLinkedGel
  };
}
