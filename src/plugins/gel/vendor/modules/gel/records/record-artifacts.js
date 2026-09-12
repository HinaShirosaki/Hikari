import { bytesToBase64 } from '../export.js';
import { safeFilePart } from '../shared.js';

// Where a saved gel's files live on disk, and the notebook links and preview
// image that are written alongside them.
function createGelRecordArtifacts({
  runtime,
  elements,
  deps
} = {}) {
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
    return persistBase64Artifact({ targetFolder, fileName, dataBase64: encodeDataUrlPayload(dataUrl) });
  }

  // The imported file as uploaded (TIFF, JPEG, ...), untouched: source.png is a
  // downscaled re-encode the analysis coordinates depend on, not an archive.
  async function persistOriginalFileArtifact({ targetFolder, file }) {
    const extension = String(file.name || '').match(/\.[a-zA-Z0-9]+$/)?.[0]?.toLowerCase() || '';
    return persistBase64Artifact({
      targetFolder,
      fileName: `original${extension}`,
      dataBase64: bytesToBase64(await file.arrayBuffer())
    });
  }

  async function persistBase64Artifact({ targetFolder, fileName, dataBase64 }) {
    const storageRoot = getStorageRoot();
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

    const originalFile = runtime.originalFile || null;

    let reportResult = null;
    let metadataResult = null;
    let sourceImageResult = null;
    let originalFileResult = null;
    try {
      [reportResult, metadataResult, sourceImageResult, originalFileResult] = await Promise.all([
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
          : Promise.resolve(null),
        originalFile
          ? persistOriginalFileArtifact({ targetFolder, file: originalFile })
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
    if (originalFile && !originalFileResult) {
      throw new Error('Could not save gel artifacts: the original image file could not be stored.');
    }
    const failedResult = [reportResult, metadataResult, sourceImageDataUrl ? sourceImageResult : null, originalFileResult]
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
      sourceImageDataUrl: '',
      // A re-save of an opened record has no File in memory; the one written
      // at import stays the original.
      originalImagePath: originalFileResult?.filePath || existingRecord?.originalImagePath || '',
      originalImageRelativePath: originalFileResult?.relativePath || existingRecord?.originalImageRelativePath || ''
    };
  }

  return {
    getStorageRoot,
    encodeDataUrlPayload,
    buildGelArtifactFolder,
    persistDataUrlArtifact,
    syncNotebookGelLinks,
    captureNotebookPreviewImage,
    persistNotebookPreviewImage,
    persistGelRecordArtifacts
  };
}

export { createGelRecordArtifacts };
