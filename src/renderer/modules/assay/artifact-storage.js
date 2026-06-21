function sanitizeStorageName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
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

export function createAssayArtifactStorage({
  state,
  createId,
  getAssayById,
  getActiveResultsAssay,
  persist
}) {
  function getStorageRoot() {
    return String(state.settings?.storagePath || '').trim();
  }

  function buildAssayArtifactFolder(assay) {
    const storageRoot = getStorageRoot();
    if (!storageRoot || !assay) {
      return '';
    }
    const linkedEntry = (state.notebookEntries || []).find((entry) => entry.id === assay.notebookEntryId);
    const folderName = `${sanitizeStorageName(assay.name || assay.assayNumber || assay.id, 'Assay')}__${sanitizeStorageName(assay.id, 'assay')}`;
    if (linkedEntry?.storageFolder) {
      return `${String(linkedEntry.storageFolder).replace(/[\\/]+$/, '')}/assay/${folderName}`;
    }
    return `${storageRoot.replace(/[\\/]+$/, '')}/Assays/${folderName}`;
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
      dataBase64
    });
    return result?.ok ? result : null;
  }

  async function persistAssayArtifacts(assayId) {
    const assay = getAssayById(assayId);
    const storageRoot = getStorageRoot();
    const targetFolder = buildAssayArtifactFolder(assay);
    if (!assay || !storageRoot || !targetFolder || !window.hikariApi?.writeJsonFile) {
      return;
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
      chartStyle: assay.chartStyle || null,
      updatedAt: assay.updatedAt
    };
    const latestAnalysis = assay.latestAnalysis && typeof assay.latestAnalysis === 'object'
      ? { ...assay.latestAnalysis }
      : null;
    const chartDataUrl = String(latestAnalysis?.chartDataUrl || '').trim();
    if (latestAnalysis) {
      latestAnalysis.chartDataUrl = '';
    }

    let definitionResult = null;
    let analysisResult = null;
    let chartResult = null;
    try {
      [definitionResult, analysisResult, chartResult] = await Promise.all([
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
    } catch (error) {
      console.warn('Failed to persist assay artifacts:', error);
      return;
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
    if (definitionResult?.ok) {
      setIfChanged('definitionJsonPath', definitionResult.filePath);
      setIfChanged('definitionJsonRelativePath', definitionResult.relativePath);
    }
    if (analysisResult?.ok) {
      setIfChanged('analysisResultPath', analysisResult.filePath);
      setIfChanged('analysisResultRelativePath', analysisResult.relativePath);
    }
    if (chartResult?.filePath) {
      if (!liveAssay.latestAnalysis || typeof liveAssay.latestAnalysis !== 'object') {
        liveAssay.latestAnalysis = {};
      }
      if (String(liveAssay.latestAnalysis.chartPath || '') !== String(chartResult.filePath || '')) {
        liveAssay.latestAnalysis.chartPath = chartResult.filePath || '';
        liveAssay.latestAnalysis.chartRelativePath = chartResult.relativePath || '';
        changed = true;
      }
    }

    if (changed) {
      persist();
    }
  }

  async function persistAssayResultAttachment({ fileName, dataBase64, candidate } = {}) {
    const assay = getActiveResultsAssay();
    const storageRoot = getStorageRoot();
    const targetFolder = buildAssayArtifactFolder(assay);
    if (!assay) {
      throw new Error('Select an assay plate before attaching a result file.');
    }
    if (!storageRoot || !targetFolder) {
      throw new Error('Set a storage folder before attaching assay result files.');
    }
    if (!dataBase64) {
      throw new Error('Result attachment file data is missing.');
    }
    if (!window.hikariApi?.storeImportedFile) {
      throw new Error('Result attachment storage is unavailable.');
    }

    const stored = await window.hikariApi.storeImportedFile({
      storagePath: storageRoot,
      targetFolder,
      fileName,
      dataBase64
    });
    if (!stored?.ok) {
      throw new Error(stored?.error || 'Unable to save result attachment.');
    }

    return {
      id: createId(),
      originalFileName: String(fileName || '').trim(),
      fileName: stored.fileName || String(fileName || '').trim(),
      filePath: stored.filePath || '',
      relativePath: stored.relativePath || '',
      storageFolder: targetFolder,
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
