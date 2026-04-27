export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Cannot convert imported file to data URL.'));
    reader.readAsDataURL(blob);
  });
}

export function extractBase64Payload(dataUrl) {
  const source = String(dataUrl || '');
  const commaIndex = source.indexOf(',');
  if (commaIndex < 0) {
    return '';
  }
  return source.slice(commaIndex + 1).trim();
}

async function ensureStorageFolderExists(storageFolder, ensureStorageDirectory) {
  if (!storageFolder || typeof ensureStorageDirectory !== 'function') {
    return;
  }
  await ensureStorageDirectory(storageFolder);
}

async function persistImportedNotebookFiles({
  files,
  storageFolder,
  storagePath,
  storeImportedFile
} = {}) {
  const selectedFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!selectedFiles.length) {
    return [];
  }

  const rootPath = String(storagePath || '').trim();
  if (!rootPath) {
    throw new Error('Set Storage Folder Path in Settings before importing notebook files.');
  }
  if (!storageFolder) {
    throw new Error('Notebook storage folder is missing.');
  }
  if (typeof storeImportedFile !== 'function') {
    throw new Error('Imported file storage API is unavailable.');
  }

  const targetFolder = `${storageFolder}/ResultFiles`;
  const importedAt = new Date().toISOString();
  const records = [];

  for (const file of selectedFiles) {
    const dataUrl = await blobToDataUrl(file);
    const dataBase64 = extractBase64Payload(dataUrl);
    if (!dataBase64) {
      throw new Error(`Cannot read ${file.name}.`);
    }
    const result = await storeImportedFile({
      storagePath: rootPath,
      targetFolder,
      fileName: file.name,
      dataBase64
    });
    if (!result?.ok) {
      throw new Error(result?.error || `Failed to store ${file.name}.`);
    }

    records.push({
      name: result.fileName || file.name,
      path: result.filePath || '',
      relativePath: result.relativePath || '',
      size: Number(file.size) || 0,
      importedAt
    });
  }

  return records;
}

export { ensureStorageFolderExists, persistImportedNotebookFiles };
