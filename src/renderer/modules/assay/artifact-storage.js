import { plateError, plateNotice, plateUi } from './localization.js';
import { PLATES_ROOT_FOLDER_NAME, recordFolderName } from '../../../shared/storage-layout.mjs';
import { buildAssayPlateCsvFiles } from './plate-csv.js';

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

export function createAssayArtifactStorage({
  state,
  createId,
  getAssayById,
  getActiveResultsAssay,
  persist
}) {
  const writes = new Map();
  function getStorageRoot() {
    return String(state.settings?.storagePath || '').trim();
  }

  // An assay linked to a notebook page lives inside that page's folder
  // (<page>/plate/<name>__<id>); an unlinked one under <root>/Plates/.
  function buildAssayArtifactFolder(assay) {
    const storageRoot = getStorageRoot();
    if (!storageRoot || !assay) {
      return '';
    }
    const linkedEntry = (state.notebookEntries || []).find((entry) => entry.id === assay.notebookEntryId);
    const folderName = recordFolderName(assay, 'Assay');
    if (linkedEntry?.storageFolder) {
      return `${String(linkedEntry.storageFolder).replace(/[\\/]+$/, '')}/plate/${folderName}`;
    }
    return `${storageRoot.replace(/[\\/]+$/, '')}/${PLATES_ROOT_FOLDER_NAME}/${folderName}`;
  }

  async function persistAssayImageArtifact({ targetFolder, fileName, dataUrl }) {
    const storageRoot = getStorageRoot();
    const dataBase64 = encodeDataUrlPayload(dataUrl);
    if (!storageRoot || !targetFolder || !dataBase64 || !window.hikariApi?.storeImportedFile) {
      return null;
    }
    const result = await window.hikariApi.storeImportedFile({
      storagePath: storageRoot,
      targetFolder,
      fileName,
      dataBase64,
      overwrite: true
    });
    return result?.ok ? result : null;
  }

  // Freeze each requested save, then write it in order. A slow previous save
  // must never overwrite CSVs produced from newer edits or formulas.
  function persistAssayArtifacts(assayId) {
    const assay = getAssayById(assayId);
    const storageRoot = getStorageRoot();
    const targetFolder = buildAssayArtifactFolder(assay);
    if (!assay || !storageRoot || !targetFolder || !window.hikariApi?.writeJsonFile) {
      return Promise.resolve({ ok: false, skipped: true });
    }
    const snapshot = structuredClone(assay);
    const current = (writes.get(assayId) || Promise.resolve())
      .then(() => writeAssayArtifacts(assayId, snapshot, storageRoot, targetFolder))
      .catch(error => {
        console.warn('Failed to persist assay artifacts:', error);
        const detail = String(error?.message || error || '');
        plateNotice(detail ? plateUi('storage.writeFailed', { error: detail }) : plateUi('storage.writeFailedUnknown'), { type: 'error' });
        return { ok: false, error };
      });
    writes.set(assayId, current);
    void current.then(() => { if (writes.get(assayId) === current) writes.delete(assayId); });
    return current;
  }

  async function writeAssayArtifacts(assayId, assay, storageRoot, targetFolder) {
    if (!window.hikariApi?.storeImportedFile) throw plateError('storage.unavailable');
    const csvFiles = buildAssayPlateCsvFiles(assay);
    const plateCsvFiles = {};
    for (const [key, file] of Object.entries(csvFiles)) {
      const stored = await window.hikariApi.storeImportedFile({
        storagePath: storageRoot, targetFolder, fileName: file.fileName,
        dataBytes: new TextEncoder().encode(file.content), overwrite: true
      });
      if (!stored?.ok) throw stored?.error ? new Error(stored.error) : plateError('storage.saveFailed');
      plateCsvFiles[key] = { name: file.name, fileName: stored.fileName || file.fileName,
        filePath: stored.filePath || '', relativePath: stored.relativePath || '' };
    }

    const definitionPayload = {
      id: assay.id,
      assayNumber: assay.assayNumber,
      name: assay.name,
      projectId: assay.projectId,
      projectName: assay.projectName,
      plateType: assay.plateType,
      plateLabel: assay.plateLabel,
      plateRows: assay.plateRows,
      plateColumns: assay.plateColumns,
      wellCount: assay.wellCount,
      sampleAxis: assay.sampleAxis,
      concentrationAxis: assay.concentrationAxis,
      sampleAxisValues: assay.sampleAxisValues,
      concentrationAxisValues: assay.concentrationAxisValues,
      manualWellOverrides: assay.manualWellOverrides,
      suppressedWells: assay.suppressedWells,
      notebookEntryId: assay.notebookEntryId,
      notebookEntryProtocolName: assay.notebookEntryProtocolName,
      notebookEntryType: assay.notebookEntryType,
      serialDilution: assay.serialDilution,
      serialDilutionSummary: assay.serialDilutionSummary,
      wellLayout: assay.wellLayout,
      resultAttachments: Array.isArray(assay.resultAttachments) ? assay.resultAttachments : [],
      plateCsvFiles,
      analysisGroups: assay.analysisGroups || null,
      analysisDataSource: assay.analysisDataSource || null,
      concentrationUnit: assay.concentrationUnit || '',
      chartStyle: assay.chartStyle || null,
      transformSpec: assay.transformSpec || null,
      updatedAt: assay.updatedAt
    };
    const latestAnalysis = assay.latestAnalysis && typeof assay.latestAnalysis === 'object'
      ? { ...assay.latestAnalysis }
      : null;
    const chartDataUrl = String(latestAnalysis?.chartDataUrl || '').trim();
    if (latestAnalysis) {
      latestAnalysis.chartDataUrl = '';
    }

    const [definitionResult, analysisResult, chartResult] = await Promise.all([
      window.hikariApi.writeJsonFile({
        storagePath: storageRoot,
        targetFolder,
        fileName: 'assay-definition.json',
        data: definitionPayload
      }),
      window.hikariApi.writeJsonFile({
        storagePath: storageRoot,
        targetFolder,
        fileName: 'analysis-result.json',
        data: {
          assayId: assay.id,
          resultValues: assay.resultValues || {},
          resultAttachments: Array.isArray(assay.resultAttachments) ? assay.resultAttachments : [],
          plateCsvFiles,
          transformSpec: assay.transformSpec || null,
          analysisGroups: assay.analysisGroups || null,
          analysisDataSource: assay.analysisDataSource || null,
          latestAnalysis,
          updatedAt: assay.updatedAt
        }
      }),
      chartDataUrl
        ? persistAssayImageArtifact({
            targetFolder,
            fileName: 'analysis-chart.svg',
            dataUrl: chartDataUrl
          })
        : Promise.resolve(null)
    ]);
    if (!definitionResult?.ok || !analysisResult?.ok) {
      const detail = definitionResult?.error || analysisResult?.error;
      throw detail ? new Error(detail) : plateError('storage.saveFailed');
    }

    const liveAssay = getAssayById(assayId);
    if (!liveAssay) {
      return;
    }

    let changed = false;
    const setIfChanged = (key, value) => {
      if (String(liveAssay?.[key] || '') !== String(value || '')) {
        liveAssay[key] = value || '';
        changed = true;
      }
    };

    setIfChanged('storageFolder', targetFolder);
    if (JSON.stringify(liveAssay.plateCsvFiles || {}) !== JSON.stringify(plateCsvFiles)) {
      liveAssay.plateCsvFiles = plateCsvFiles;
      changed = true;
    }
    if (definitionResult?.ok) {
      setIfChanged('definitionJsonPath', definitionResult.filePath);
      setIfChanged('definitionJsonRelativePath', definitionResult.relativePath);
    }
    if (analysisResult?.ok) {
      setIfChanged('analysisResultPath', analysisResult.filePath);
      setIfChanged('analysisResultRelativePath', analysisResult.relativePath);
    }
    if (chartResult?.filePath && liveAssay.latestAnalysis
      && liveAssay.latestAnalysis.analyzedAt === latestAnalysis?.analyzedAt) {
      if (String(liveAssay.latestAnalysis.chartPath || '') !== String(chartResult.filePath || '')) {
        liveAssay.latestAnalysis.chartPath = chartResult.filePath || '';
        liveAssay.latestAnalysis.chartRelativePath = chartResult.relativePath || '';
        changed = true;
      }
    }

    if (changed) {
      persist();
    }
    return { ok: true, plateCsvFiles };
  }

  async function persistAssayResultAttachment({ assayId, fileName, dataBase64, candidate } = {}) {
    const assay = assayId ? getAssayById(assayId) : getActiveResultsAssay();
    const storageRoot = getStorageRoot();
    const targetFolder = buildAssayArtifactFolder(assay);
    if (!assay) {
      throw plateError('import.selectAssay');
    }
    if (!storageRoot || !targetFolder) {
      throw plateError('storage.noFolder');
    }
    if (!dataBase64) {
      throw plateError('storage.missingData');
    }
    if (!window.hikariApi?.storeImportedFile) {
      throw plateError('storage.unavailable');
    }

    const stored = await window.hikariApi.storeImportedFile({
      storagePath: storageRoot,
      // Uploaded source files have their own namespace, so a result file named
      // original-plate.csv can never be overwritten by a generated snapshot.
      targetFolder: `${targetFolder}/result-files`,
      fileName,
      dataBase64
    });
    if (!stored?.ok) {
      throw stored?.error ? new Error(stored.error) : plateError('storage.saveFailed');
    }

    return {
      id: createId(),
      originalFileName: String(fileName || '').trim(),
      fileName: stored.fileName || String(fileName || '').trim(),
      filePath: stored.filePath || '',
      relativePath: stored.relativePath || '',
      storageFolder: `${targetFolder}/result-files`,
      importedAt: new Date().toISOString(),
      tableName: candidate?.tableName || '',
      format: candidate?.format || '',
      rangeLabel: candidate?.rangeLabel || '',
      startRowIndex: Number(candidate?.startRowIndex || 0),
      startColumnIndex: Number(candidate?.startColumnIndex || 0),
      rows: Number(candidate?.rows || 0),
      columns: Number(candidate?.columns || 0),
      numericCount: Number(candidate?.numericCount || 0),
      nonBlankCount: Number(candidate?.nonBlankCount || 0)
    };
  }

  return {
    getStorageRoot,
    buildAssayArtifactFolder,
    persistAssayArtifacts,
    persistAssayResultAttachment
  };
}
