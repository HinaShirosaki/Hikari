import { DEFAULT_LADDER_STANDARDS } from './constants.js';
import { createBandsCsv, downloadTextFile } from './export.js';
import { normalizeEnhancementSettings } from './image-processing.js';
import { formatAnalysisTypeLabel, notebookLabel } from './presentation.js';
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
    if (!storageRoot || !targetFolder || !dataBase64 || !window.enanaApi?.storeImportedFile) {
      return null;
    }
    const result = await window.enanaApi.storeImportedFile({
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

  function selectNotebookOption(value) {
    if (!elements.gelNotebookEntryInput) {
      return;
    }
    const targetValue = String(value || '').trim();
    if (!targetValue) {
      elements.gelNotebookEntryInput.value = '';
      return;
    }
    if (!Array.from(elements.gelNotebookEntryInput.options).some((option) => option.value === targetValue)) {
      const option = document.createElement('option');
      option.value = targetValue;
      option.textContent = `${targetValue} (missing notebook page)`;
      elements.gelNotebookEntryInput.append(option);
    }
    elements.gelNotebookEntryInput.value = targetValue;
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
      } catch {}
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
    if (!storageRoot || !targetFolder || !window.enanaApi?.writeJsonFile) {
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
        window.enanaApi.writeJsonFile({
          storagePath: storageRoot,
          targetFolder,
          fileName: 'analysis-result.json',
          data: record.report || {}
        }),
        window.enanaApi.writeJsonFile({
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
    } catch {
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

  function renderProjectOptions() {
    if (!elements.gelProjectInput) {
      return;
    }
    const selected = elements.gelProjectInput.value;
    const options = ['<option value="">Select project</option>'];
    (runtime.state.projects || []).forEach((project) => {
      const isSelected = project.id === selected ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${runtime.safeText(project.name)}</option>`);
    });
    elements.gelProjectInput.innerHTML = options.join('');
    if (selected && (runtime.state.projects || []).some((project) => project.id === selected)) {
      elements.gelProjectInput.value = selected;
    }
  }

  function renderNotebookOptions() {
    if (!elements.gelNotebookEntryInput) {
      return;
    }

    const selected = elements.gelNotebookEntryInput.value;
    const projectId = elements.gelProjectInput?.value || '';
    const entries = (runtime.state.notebookEntries || [])
      .filter((entry) => !projectId || entry.projectId === projectId)
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''));

    const options = ['<option value="">Not linked</option>'];
    entries.forEach((entry) => {
      options.push(`<option value="${entry.id}">${runtime.safeText(notebookLabel(entry))}</option>`);
    });

    elements.gelNotebookEntryInput.innerHTML = options.join('');

    if (selected && entries.some((entry) => entry.id === selected)) {
      elements.gelNotebookEntryInput.value = selected;
    }
  }

  function buildRecordFromCurrentReport(existingId = '') {
    const project = (runtime.state.projects || []).find((item) => item.id === elements.gelProjectInput?.value);
    const notebookEntry = (runtime.state.notebookEntries || []).find((entry) => entry.id === elements.gelNotebookEntryInput?.value);

    return {
      id: existingId || runtime.createId(),
      name: elements.gelNameInput?.value.trim() || `Gel-${Date.now()}`,
      projectId: project?.id || '',
      projectName: project?.name || '',
      notebookEntryId: elements.gelNotebookEntryInput?.value || '',
      notebookEntryProtocolName: notebookEntry?.protocolName || '',
      notebookEntryType: notebookEntry?.notebookType || '',
      imageName: runtime.currentReport?.image?.name || '',
      analysisType: runtime.currentReport?.analysisType || (elements.gelTypeInput?.value || 'sds-page'),
      parameters: runtime.currentReport?.parameters || readParams(),
      manualOverrides: normalizeManualOverrides(runtime.manualOverrides),
      report: runtime.currentReport,
      updatedAt: new Date().toISOString()
    };
  }

  async function onSaveAnalysis(event) {
    event.preventDefault();
    ensureState();

    if (!runtime.currentReport) {
      deps.setStatus('Run analysis before saving.');
      return;
    }

    const name = elements.gelNameInput?.value.trim() || '';
    if (!name) {
      deps.setStatus('Analysis name is required.');
      return;
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
    deps.setStatus(`Saved analysis: ${record.name}.`);
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
    deps.leaveCropMode();
    runtime.manualDividerConfirmed = false;
    runtime.selectedViewerTool = '';

    renderProjectOptions();
    renderNotebookOptions();
    deps.renderOverrideStatus();
    deps.renderManualProgress();
    deps.renderCanvas();
    deps.renderReport();
    deps.setStatus('');
  }

  function fillFromRecord(record) {
    elements.gelIdInput.value = record.id;
    elements.gelNameInput.value = record.name || '';
    elements.gelProjectInput.value = record.projectId || '';
    renderProjectOptions();
    elements.gelProjectInput.value = record.projectId || '';
    renderNotebookOptions();
    elements.gelNotebookEntryInput.value = record.notebookEntryId || '';

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
    const rows = (runtime.state.gelAnalyses || [])
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''))
      .filter((record) => matchesSearch(record, term));

    if (!rows.length) {
      elements.gelList.innerHTML = '<p class="small-note">No gel analyses saved.</p>';
      return;
    }

    elements.gelList.innerHTML = rows.map((record) => {
      const confidence = record.report?.confidence || { label: '-', score: '-' };
      const laneCount = record.report?.lanes?.length || 0;
      const bandCount = (record.report?.lanes || []).reduce((sum, lane) => sum + (lane.bands?.length || 0), 0);
      const overrideCount = (() => {
        const summary = record.report?.preprocessing?.manualOverridesSummary;
        if (summary) {
          return (summary.laneSegmentationDividers || 0)
            + (Number.isFinite(summary.laneSegmentationLeft) ? 1 : 0)
            + (Number.isFinite(summary.laneSegmentationRight) ? 1 : 0)
            + (Number.isFinite(summary.laneSegmentationBandTop) ? 1 : 0)
            + (Number.isFinite(summary.laneSegmentationBandBottom) ? 1 : 0)
            + (summary.addedBands || 0)
            + (summary.ladderBands || 0)
            + (Number.isFinite(summary.ladderLaneOverride) ? 1 : 0);
        }
        const manual = normalizeManualOverrides(record.manualOverrides || {});
        const segmentationCount = (Number.isFinite(manual.laneSegmentation?.gelLeft) ? 1 : 0)
          + (Number.isFinite(manual.laneSegmentation?.gelRight) ? 1 : 0)
          + (manual.laneSegmentation?.dividers?.length || 0)
          + (Number.isFinite(manual.laneSegmentation?.bandTop) ? 1 : 0)
          + (Number.isFinite(manual.laneSegmentation?.bandBottom) ? 1 : 0)
          + (Number.isFinite(manual.ladderLane) ? 1 : 0);
        return manual.addedBands.length + (manual.ladderBands?.length || 0) + segmentationCount;
      })();
      return `
        <article class="card">
          <h3>${runtime.safeText(record.name || record.id)}</h3>
          <p><strong>Type:</strong> ${runtime.safeText(formatAnalysisTypeLabel(record.analysisType))}</p>
          <p><strong>Project:</strong> ${runtime.safeText(record.projectName || '-')}</p>
          <p><strong>Notebook:</strong> ${runtime.safeText(record.notebookEntryProtocolName || '-')}</p>
          <p><strong>Image:</strong> ${runtime.safeText(record.imageName || '-')}</p>
          <p><strong>Lanes/Bands:</strong> ${runtime.safeText(`${laneCount} / ${bandCount}`)}</p>
          <p><strong>Overrides:</strong> ${runtime.safeText(String(overrideCount))}</p>
          <p><strong>Confidence:</strong> ${runtime.safeText(String(confidence.label || '-'))} (${runtime.safeText(String(confidence.score ?? '-'))})</p>
          <p><strong>Updated:</strong> ${runtime.safeText(new Date(record.updatedAt || '').toLocaleString() || '-')}</p>
          <div class="card-actions">
            <button type="button" class="ghost-btn" data-gel-edit="${record.id}">Edit</button>
            <button type="button" class="danger-btn" data-gel-delete="${record.id}">Delete</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function startLinkedGel({ notebookEntryId = '', projectId = '' } = {}) {
    resetForm();

    const linkedEntry = (runtime.state.notebookEntries || []).find((entry) => entry.id === notebookEntryId);
    const resolvedProjectId = String(projectId || linkedEntry?.projectId || '').trim();
    if (resolvedProjectId && elements.gelProjectInput) {
      elements.gelProjectInput.value = resolvedProjectId;
      renderProjectOptions();
      elements.gelProjectInput.value = resolvedProjectId;
    }

    renderNotebookOptions();
    selectNotebookOption(notebookEntryId);
    if (elements.gelNameInput) {
      elements.gelNameInput.focus();
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
    renderNotebookOptions,
    renderProjectOptions,
    resetForm,
    startLinkedGel
  };
}
