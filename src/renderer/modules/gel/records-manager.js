import { DEFAULT_LADDER_STANDARDS } from './constants.js';
import { createBandsCsv, downloadTextFile } from './export.js';
import { normalizeEnhancementSettings } from './analysis/image-processing.js';
import { clamp, createEmptyManualOverrides, normalizeManualOverrides, safeFilePart } from './shared.js';

export function createRecordsManager({ runtime, elements, deps }) {
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
    return result?.ok ? result : null;
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
    const previewDataUrl = captureNotebookPreviewImage(String(existingRecord?.previewImageDataUrl || '').trim());
    if (!previewDataUrl) {
      return {
        previewImagePath: existingPath,
        previewImageRelativePath: existingRelativePath,
        previewImageDataUrl: String(existingRecord?.previewImageDataUrl || '').trim()
      };
    }

    const targetFolder = buildGelArtifactFolder(record);

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
            previewImageDataUrl: ''
          };
        }
      } catch (error) {
        console.warn('Failed to persist gel preview image:', error);
      }
    }

    return {
      previewImagePath: existingPath,
      previewImageRelativePath: existingRelativePath,
      previewImageDataUrl: previewDataUrl
    };
  }

  async function persistGelRecordArtifacts(record, existingRecord = null) {
    const storageRoot = getStorageRoot();
    const targetFolder = buildGelArtifactFolder(record);
    if (!storageRoot || !targetFolder || !window.hikariApi?.writeJsonFile) {
      return {};
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
      console.warn('Failed to persist gel record artifacts:', error);
      return {};
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

  function readParams() {
    const rawType = elements.gelTypeInput?.value;
    const analysisType = rawType === 'western' || rawType === 'agarose' ? rawType : 'sds-page';
    const enhancement = deps.readEnhancementSettingsFromUi();

    return {
      analysisType,
      analysisMode: 'manual',
      ladderStandards: DEFAULT_LADDER_STANDARDS.slice(),
      ladderLane: clamp(Math.floor(Number(elements.gelLadderLaneInput?.value) || 1), 1, 999),
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

  async function onSaveAnalysis(event) {
    event.preventDefault();
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
    Object.assign(record, await persistNotebookPreviewImage(record, existing));
    Object.assign(record, await persistGelRecordArtifacts(record, existing));

    const index = runtime.state.gelAnalyses.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      runtime.state.gelAnalyses[index] = record;
    } else {
      runtime.state.gelAnalyses.push(record);
    }

    syncNotebookGelLinks();
    runtime.persist();
    renderList();
    if (typeof runtime.onGelAnalysesChanged === 'function') {
      runtime.onGelAnalysesChanged();
    }
    deps.setStatus(record.report
      ? `Saved gel analysis: ${record.name}.`
      : `Saved gel draft: ${record.name}. You can finish the analysis later.`);
    runtime.markDraftSaved?.();
    return record;
  }

  function onExportJson() {
    if (!runtime.currentReport) {
      deps.setStatus('No analysis report to export.');
      return;
    }

    const fileName = `${safeFilePart(elements.gelNameInput?.value, 'gel-analysis')}.json`;
    downloadTextFile({
      content: `${JSON.stringify(runtime.currentReport, null, 2)}\n`,
      fileName,
      mimeType: 'application/json;charset=utf-8;'
    });
    deps.setStatus(`Exported ${fileName}.`);
  }

  function onExportCsv() {
    if (!runtime.currentReport) {
      deps.setStatus('No analysis report to export.');
      return;
    }

    const fileName = `${safeFilePart(elements.gelNameInput?.value, 'gel-analysis')}.csv`;
    downloadTextFile({
      content: createBandsCsv(runtime.currentReport),
      fileName,
      mimeType: 'text/csv;charset=utf-8;'
    });
    deps.setStatus(`Exported ${fileName}.`);
  }

  function resetForm() {
    elements.gelIdInput.value = '';
    elements.gelForm.reset();
    elements.gelTypeInput.value = 'sds-page';
    elements.gelLadderLaneInput.value = '1';
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

  function fillFromRecord(record) {
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
    elements.gelLadderLaneInput.value = String(parameters.ladderLane || 1);
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
    runtime.originalImage = null;
    runtime.cropApplied = false;
    deps.leaveCropMode();
    deps.renderManualProgress();
    deps.renderCanvas();
    deps.renderReport();
    deps.setStatus('Loaded saved report. Upload original image to view overlay.');
    runtime.markDraftSaved?.();
  }

  function deleteRecord(recordId) {
    runtime.state.gelAnalyses = (runtime.state.gelAnalyses || []).filter((item) => item.id !== recordId);
    syncNotebookGelLinks();
    runtime.persist();
    renderList();
    if (typeof runtime.onGelAnalysesChanged === 'function') {
      runtime.onGelAnalysesChanged();
    }
    if (elements.gelIdInput?.value === recordId) {
      resetForm();
    }
  }

  function onListClick(event) {
    const editBtn = event.target.closest('[data-gel-edit]');
    if (editBtn) {
      const record = (runtime.state.gelAnalyses || []).find((item) => item.id === editBtn.dataset.gelEdit);
      if (record) {
        fillFromRecord(record);
      }
      return;
    }

    const deleteBtn = event.target.closest('[data-gel-delete]');
    if (deleteBtn) {
      deleteRecord(deleteBtn.dataset.gelDelete);
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
    onExportJson,
    onListClick,
    onSaveAnalysis,
    readParams,
    renderList,
    resetForm,
    startLinkedGel
  };
}
