import { DEFAULT_LADDER_PRESET_ID, getLadderPresetBands } from './constants.js';
import { createBandsCsv, downloadTextFile } from './export.js';
import { normalizeEnhancementSettings } from './analysis/image-processing.js';
import { clamp, createEmptyManualOverrides, normalizeManualOverrides, safeFilePart } from './shared.js';

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

  function getStorageRoot() {
    return String(runtime.state.settings?.storagePath || '').trim();
  }

  function encodeDataUrlPayload(dataUrl) {
    const source = String(dataUrl || '').trim();
    const commaIndex = source.indexOf(',');
    if (!source.startsWith('data:') || commaIndex < 0) {
      return '';
    }
    const header = source.slice(0, commaIndex);
    const payload = source.slice(commaIndex + 1);
    if (/;base64/i.test(header)) {
      return payload.trim();
    }
    try {
      return btoa(unescape(encodeURIComponent(decodeURIComponent(payload))));
    } catch {
      try {
        return btoa(unescape(encodeURIComponent(payload)));
      } catch {
        return '';
      }
    }
  }

  function buildGelArtifactFolder(record) {
    const storageRoot = getStorageRoot();
    if (!storageRoot || !record) {
      return '';
    }
    // A record that already has a folder keeps it. Recomputing would move the
    // artifacts whenever the name changed, and the v1 migration sanitizes the
    // folder name differently from safeFilePart ("Old Gel" -> Old_Gel there,
    // Old-Gel here) — so a migrated record would orphan its whole artifact
    // tree on its first re-save.
    const existingFolder = String(record.storageFolder || '').trim();
    if (existingFolder) {
      return existingFolder;
    }
    const linkedEntry = (runtime.state.notebookEntries || []).find((entry) => entry.id === record.notebookEntryId);
    const folderName = `${safeFilePart(record.name || record.id, 'gel')}__${safeFilePart(record.id, 'gel')}`;
    if (linkedEntry?.storageFolder) {
      return `${String(linkedEntry.storageFolder).replace(/[\\/]+$/, '')}/gel/${folderName}`;
    }
    return `${storageRoot.replace(/[\\/]+$/, '')}/Gels/${folderName}`;
  }

  async function persistDataUrlArtifact({ targetFolder, fileName, dataUrl }) {
    const storageRoot = getStorageRoot();
    const dataBase64 = encodeDataUrlPayload(dataUrl);
    if (!storageRoot || !targetFolder || !dataBase64 || !window.hikariApi?.storeImportedFile) {
      return null;
    }
    const result = await window.hikariApi.storeImportedFile({
      storagePath: storageRoot,
      targetFolder,
      fileName,
      dataBase64
    });
    if (!result?.ok) {
      throw new Error(result?.error || `Could not store ${fileName}.`);
    }
    return result;
  }

  function arraysEqual(left, right) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => value === right[index]);
  }

  function syncNotebookGelLinks() {
    if (!Array.isArray(runtime.state.notebookEntries)) {
      return;
    }

    const linkedIdsByEntry = new Map();
    (runtime.state.gelAnalyses || []).forEach((analysis) => {
      const entryId = String(analysis?.notebookEntryId || '').trim();
      const analysisId = String(analysis?.id || '').trim();
      if (!entryId || !analysisId) {
        return;
      }
      if (!linkedIdsByEntry.has(entryId)) {
        linkedIdsByEntry.set(entryId, []);
      }
      linkedIdsByEntry.get(entryId).push(analysisId);
    });

    runtime.state.notebookEntries = runtime.state.notebookEntries.map((entry) => {
      const nextIds = linkedIdsByEntry.get(String(entry?.id || '').trim()) || [];
      const currentIds = Array.isArray(entry?.gelIds)
        ? entry.gelIds.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
      if (arraysEqual(currentIds, nextIds)) {
        return entry;
      }
      return {
        ...entry,
        gelIds: nextIds
      };
    });
  }

  function captureNotebookPreviewImage(fallback = '') {
    try {
      if (elements.gelCanvas?.width && elements.gelCanvas?.height) {
        return elements.gelCanvas.toDataURL('image/png');
      }
    } catch {}
    if (runtime.currentImage?.imageData) {
      return deps.imageDataToDataUrl(runtime.currentImage.imageData);
    }
    return String(fallback || '').trim();
  }

  async function persistNotebookPreviewImage(record, existingRecord = null) {
    const existingPath = String(existingRecord?.previewImagePath || '').trim();
    const existingRelativePath = String(existingRecord?.previewImageRelativePath || '').trim();
    const targetFolder = buildGelArtifactFolder(record);
    const existingDataUrl = String(existingRecord?.previewImageDataUrl || '').trim();
    const previewDataUrl = targetFolder
      ? captureNotebookPreviewImage(existingDataUrl)
      : runtime.currentImage?.imageData
        ? deps.imageDataToDataUrl(runtime.currentImage.imageData)
        : existingDataUrl;
    if (!previewDataUrl) {
      return {
        previewImagePath: existingPath,
        previewImageRelativePath: existingRelativePath,
        previewImageDataUrl: String(existingRecord?.previewImageDataUrl || '').trim(),
        previewImageIsSource: Boolean(existingRecord?.previewImageIsSource)
      };
    }

    if (targetFolder) {
      try {
        const stored = await persistDataUrlArtifact({
          targetFolder,
          fileName: 'preview.png',
          dataUrl: previewDataUrl
        });
        if (stored?.filePath) {
          return {
            previewImagePath: stored.filePath,
            previewImageRelativePath: stored.relativePath || '',
            previewImageDataUrl: '',
            previewImageIsSource: false
          };
        }
      } catch (error) {
        throw new Error(`Could not save the gel preview: ${error?.message || error}`);
      }
      throw new Error('Could not save the gel preview image.');
    }

    throw new Error('Choose a storage folder in Hikari Settings before saving gels.');
  }

  async function persistGelRecordArtifacts(record, existingRecord = null) {
    const storageRoot = getStorageRoot();
    const targetFolder = buildGelArtifactFolder(record);
    if (!storageRoot || !targetFolder || !window.hikariApi?.writeJsonFile) {
      throw new Error('Gel artifact storage is unavailable. Choose a storage folder in Hikari Settings.');
    }

    const sourceImageDataUrl = runtime.currentImage?.imageData
      ? deps.imageDataToDataUrl(runtime.currentImage.imageData)
      : String(existingRecord?.sourceImageDataUrl || '').trim();

    let reportResult = null;
    let metadataResult = null;
    let sourceImageResult = null;
    try {
      [reportResult, metadataResult, sourceImageResult] = await Promise.all([
        window.hikariApi.writeJsonFile({
          storagePath: storageRoot,
          targetFolder,
          fileName: 'analysis-result.json',
          data: record.report || {}
        }),
        window.hikariApi.writeJsonFile({
          storagePath: storageRoot,
          targetFolder,
          fileName: 'gel-record.json',
          data: {
            id: record.id,
            name: record.name,
            projectId: record.projectId,
            projectName: record.projectName,
            notebookEntryId: record.notebookEntryId,
            notebookEntryProtocolName: record.notebookEntryProtocolName,
            notebookEntryType: record.notebookEntryType,
            imageName: record.imageName,
            analysisType: record.analysisType,
            parameters: record.parameters || {},
            manualOverrides: record.manualOverrides || {},
            updatedAt: record.updatedAt
          }
        }),
        sourceImageDataUrl
          ? persistDataUrlArtifact({
              targetFolder,
              fileName: 'source.png',
              dataUrl: sourceImageDataUrl
            })
          : Promise.resolve(null)
      ]);
    } catch (error) {
      throw new Error(`Could not save gel artifacts: ${error?.message || error}`);
    }

    // A null here is a *failure*, not "nothing to do": persistDataUrlArtifact
    // returns null when the payload encodes empty (an oversized canvas yields
    // the literal "data:,"). Treating it as success dropped the source image
    // while the save reported "Saved gel analysis".
    if (sourceImageDataUrl && !sourceImageResult) {
      throw new Error('Could not save gel artifacts: the source image could not be encoded.');
    }
    const failedResult = [reportResult, metadataResult, sourceImageDataUrl ? sourceImageResult : null]
      .find((result) => result && result.ok !== true);
    if (failedResult) {
      throw new Error(`Could not save gel artifacts: ${failedResult.error || 'the host did not confirm the write.'}`);
    }
    if (!reportResult?.filePath || !metadataResult?.filePath) {
      throw new Error('Could not save gel artifacts: required report or metadata paths are missing.');
    }

    return {
      storageFolder: targetFolder,
      analysisResultPath: reportResult?.ok ? reportResult.filePath || '' : '',
      analysisResultRelativePath: reportResult?.ok ? reportResult.relativePath || '' : '',
      recordJsonPath: metadataResult?.ok ? metadataResult.filePath || '' : '',
      recordJsonRelativePath: metadataResult?.ok ? metadataResult.relativePath || '' : '',
      sourceImagePath: sourceImageResult?.filePath || '',
      sourceImageRelativePath: sourceImageResult?.relativePath || '',
      sourceImageDataUrl: ''
    };
  }

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
      normalization: elements.gelNormalizationInput?.value === 'total-lane'
        ? elements.gelNormalizationInput.value
        : 'none',
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
      elements.gelSaveBtn.textContent = isBusy ? 'Saving…' : 'Save Analysis';
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
    const originalLabel = activeButton?.textContent || '';
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
      activeButton.textContent = 'Exporting…';
    }
    exportPromise = Promise.resolve()
      .then(action)
      .finally(() => {
        lockedExportButtons.forEach(({ button, disabled }) => {
          button.disabled = disabled;
          button.removeAttribute('aria-busy');
        });
        if (activeButton) {
          activeButton.textContent = originalLabel;
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
      deps.setStatus('No analysis report to export.');
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
    elements.gelNormalizationInput.value = 'none';
    if (elements.gelDenoiseStrengthInput) {
      elements.gelDenoiseStrengthInput.value = '35';
    }
    if (elements.gelContrastStrengthInput) {
      elements.gelContrastStrengthInput.value = '100';
    }
    deps.renderEnhancementValues();

    deps.setCurrentImage(null);
    runtime.originalImage = null;
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
    deps.renderReport();
    deps.setStatus('');
    runtime.markDraftSaved?.();
  }

  function resolveStoredImagePath(pathValue, relativePathValue) {
    const storedPath = String(pathValue || '').trim();
    if (storedPath) {
      return storedPath;
    }
    const relativePath = String(relativePathValue || '').trim();
    const storageRoot = getStorageRoot();
    if (!relativePath || !storageRoot) {
      return '';
    }
    return `${storageRoot.replace(/[\\/]+$/, '')}/${relativePath.replace(/^[\\/]+/, '')}`;
  }

  function inferImageMimeType(pathValue) {
    const normalizedPath = String(pathValue || '').toLowerCase();
    if (normalizedPath.endsWith('.jpg') || normalizedPath.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (normalizedPath.endsWith('.webp')) {
      return 'image/webp';
    }
    if (normalizedPath.endsWith('.gif')) {
      return 'image/gif';
    }
    return 'image/png';
  }

  async function readStoredImageDataUrl(pathValue) {
    const storedPath = String(pathValue || '').trim();
    if (!storedPath || typeof window.hikariApi?.readFileBase64 !== 'function') {
      return '';
    }
    const response = await window.hikariApi.readFileBase64(storedPath);
    if (!response?.ok || !response.dataBase64) {
      return '';
    }
    return `data:${inferImageMimeType(storedPath)};base64,${response.dataBase64}`;
  }

  async function restoreRecordImage(record) {
    const sourcePath = resolveStoredImagePath(record.sourceImagePath, record.sourceImageRelativePath);
    const previewPath = resolveStoredImagePath(record.previewImagePath, record.previewImageRelativePath);
    const candidates = [
      {
        kind: 'source',
        dataUrl: String(record.sourceImageDataUrl || '').trim(),
        path: ''
      },
      {
        kind: 'source',
        dataUrl: '',
        path: sourcePath
      },
      {
        kind: record.previewImageIsSource ? 'source' : 'preview',
        dataUrl: String(record.previewImageDataUrl || '').trim(),
        path: ''
      },
      {
        kind: record.previewImageIsSource ? 'source' : 'preview',
        dataUrl: '',
        path: previewPath
      }
    ].filter((candidate) => candidate.dataUrl || candidate.path);

    let lastError = null;
    for (const candidate of candidates) {
      try {
        const dataUrl = candidate.dataUrl || await readStoredImageDataUrl(candidate.path);
        if (!dataUrl) {
          continue;
        }
        const image = await deps.decodeImageSource(
          dataUrl,
          String(record.imageName || candidate.path || 'saved-gel.png')
        );
        return {
          image,
          kind: candidate.kind,
          hadCandidate: true,
          error: null
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      image: null,
      kind: '',
      hadCandidate: candidates.length > 0,
      error: lastError
    };
  }

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
    elements.gelNormalizationInput.value = parameters.normalization || 'none';
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
    runtime.cropApplied = false;
    deps.leaveCropMode();
    deps.renderManualProgress();
    deps.renderCanvas();
    deps.renderReport();
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
      deps.renderReport();
      deps.setStatus(restored.kind === 'source'
        ? `Loaded saved gel: ${record.name || record.id}.`
        : `Loaded saved gel preview: ${record.name || record.id}. Upload the original image before reanalyzing.`);
    } else if (restored.hadCandidate) {
      const reason = restored.error instanceof Error ? ` ${restored.error.message}` : '';
      deps.setStatus(`Loaded saved report, but its image could not be restored.${reason}`);
    } else {
      deps.setStatus('Loaded saved report. This older record has no stored image; upload the original to restore the viewer.');
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

  function matchesSearch(record, term) {
    if (!term) {
      return true;
    }
    const haystack = [
      record.name,
      record.projectName,
      record.notebookEntryProtocolName,
      record.analysisType,
      record.imageName,
      record.updatedAt
    ].join(' ').toLowerCase();
    return haystack.includes(term);
  }

  function renderList() {
    ensureState();
    const term = String(elements.gelSearchInput?.value || '').trim().toLowerCase();
    const records = (runtime.state.gelAnalyses || [])
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));
    const rows = records.filter((record) => matchesSearch(record, term));

    if (elements.gelBrowserCount) {
      elements.gelBrowserCount.textContent = term ? `${rows.length}/${records.length}` : String(records.length);
    }

    if (!rows.length) {
      elements.gelList.innerHTML = '<p class="small-note gel-browser-empty">No saved gels found.</p>';
      return;
    }

    elements.gelList.innerHTML = rows.map((record) => {
      const title = record.name || record.id || 'Untitled gel';
      const safeTitle = runtime.safeText(title);
      const safeId = runtime.safeText(record.id);
      return `
        <article class="gel-browser-item">
          <div class="gel-browser-item-copy">
            <p class="gel-browser-item-title">${safeTitle}</p>
          </div>
          <div class="card-actions gel-browser-item-actions">
            <button type="button" class="row-action-icon-btn" data-gel-edit="${safeId}" aria-label="Edit ${safeTitle}" title="Edit">
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button type="button" class="row-action-icon-btn row-action-icon-btn-danger" data-gel-delete="${safeId}" aria-label="Delete ${safeTitle}" title="Delete">
              <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v5" />
                <path d="M14 11v5" />
              </svg>
            </button>
          </div>
        </article>
      `;
    }).join('');
  }

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
