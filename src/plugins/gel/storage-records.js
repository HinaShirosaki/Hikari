// Gel records travel to the host as base64 JSON with the heavy image blobs kept
// in separate plugin files, so a saved record stays small enough to persist.
function createGelStorageRecords({ hikari, errorMessage } = {}) {
function toBase64(value) {
  const bytes = new TextEncoder().encode(String(value));
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

function fromBase64Json(dataBase64) {
  const binary = atob(String(dataBase64 || ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// The ported records manager still talks to window.hikariApi. This shim keeps
// its artifacts in the plugin namespace and converts bridge failures into the
// same { ok:false } shape the original module already understands.
window.hikariApi = {
  async storeImportedFile({ targetFolder, fileName, dataBase64 }) {
    try {
      const result = await hikari.call('files.write', {
        path: `${targetFolder}/${fileName}`,
        dataBase64
      });
      return { ok: true, filePath: result.path, relativePath: result.path, fileName };
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'Could not store the gel file.') };
    }
  },
  async writeJsonFile({ targetFolder, fileName, data }) {
    try {
      const result = await hikari.call('files.write', {
        path: `${targetFolder}/${fileName}`,
        dataBase64: toBase64(JSON.stringify(data ?? {}, null, 2))
      });
      return { ok: true, filePath: result.path, relativePath: result.path, fileName };
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'Could not store the gel metadata.') };
    }
  },
  async readFileBase64(path) {
    try {
      return { ok: true, ...(await hikari.call('files.read', { path })) };
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'Could not read the gel file.') };
    }
  },
  async exportTextFile({ content, fileName }) {
    return hikari.call('downloads.save', {
      fileName,
      dataBase64: toBase64(content)
    });
  },
  async exportBinaryFile({ dataBase64, fileName }) {
    return hikari.call('downloads.save', {
      fileName,
      dataBase64
    });
  }
};

function toStoredRecord(record) {
  const durableRecordPath = String(record?.recordJsonPath || record?.recordJsonRelativePath || '').trim();
  if (!durableRecordPath) {
    return record;
  }
  return {
    id: record.id,
    name: record.name,
    projectId: record.projectId || '',
    projectName: record.projectName || '',
    notebookEntryId: record.notebookEntryId || '',
    notebookEntryProtocolName: record.notebookEntryProtocolName || '',
    notebookEntryType: record.notebookEntryType || '',
    imageName: record.imageName || '',
    analysisType: record.analysisType || 'sds-page',
    updatedAt: record.updatedAt || '',
    storageFolder: record.storageFolder || '',
    analysisResultPath: record.analysisResultPath || '',
    analysisResultRelativePath: record.analysisResultRelativePath || '',
    recordJsonPath: record.recordJsonPath || '',
    recordJsonRelativePath: record.recordJsonRelativePath || '',
    sourceImagePath: record.sourceImagePath || '',
    sourceImageRelativePath: record.sourceImageRelativePath || '',
    previewImagePath: record.previewImagePath || '',
    previewImageRelativePath: record.previewImageRelativePath || '',
    previewImageIsSource: Boolean(record.previewImageIsSource)
  };
}

  return { toBase64, fromBase64Json, toStoredRecord };
}

export { createGelStorageRecords };
