function sanitizeFolderName(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildNamedFolder(name, nameFallback, id, idFallback) {
  const safeName = sanitizeFolderName(name || nameFallback) || nameFallback;
  const safeId = sanitizeFolderName(id || idFallback) || idFallback;
  return `${safeName}__${safeId}`;
}

function blobToDataUrl(blob, FileReaderClass) {
  return new Promise((resolve, reject) => {
    const reader = new FileReaderClass();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Cannot convert imported file to data URL.'));
    reader.readAsDataURL(blob);
  });
}

function extractBase64Payload(dataUrl) {
  const source = String(dataUrl || '');
  const commaIndex = source.indexOf(',');
  return commaIndex < 0 ? '' : source.slice(commaIndex + 1).trim();
}

// On-disk layout for workflow runs, under the storage folder:
//   Workflow/<template>__<id>/<workflow>__<id>/
//     Results/<entry>__<id>/<step>__<blockId>/ResultFiles/<imported files>
//     Notebook/<entry>__<id>/Notebook_Page__<pageId>/
// Names are sanitized; the id suffix keeps renamed or same-named items apart.
export function createWorkflowArtifactStorage({
  state,
  renderer,
  getTemplateById,
  windowObject = globalThis?.window || null,
  FileReaderClass = globalThis?.FileReader || null
}) {
  function buildWorkflowInstanceRootFolderPath(workflow) {
    const rootPath = String(state.settings?.storagePath || '').trim();
    if (!rootPath) {
      return '';
    }

    const template = getTemplateById(String(workflow?.templateId || '').trim()) || {
      id: String(workflow?.templateId || 'untemplated').trim() || 'untemplated',
      name: 'Untemplated Workflow'
    };
    const templateFolder = buildNamedFolder(
      template?.name,
      'Untitled_Template',
      template?.id,
      'template'
    );
    const workflowFolder = buildNamedFolder(
      workflow?.name,
      'Untitled_Workflow',
      workflow?.id,
      'workflow'
    );
    return `${rootPath}/Workflow/${templateFolder}/${workflowFolder}`;
  }

  function buildWorkflowStepResultsFolderPath(workflow, entry, block) {
    const workflowRoot = buildWorkflowInstanceRootFolderPath(workflow);
    if (!workflowRoot) {
      return '';
    }
    const entryFolder = buildNamedFolder(entry?.name, 'Entry', entry?.id, 'entry');
    const blockFolder = buildNamedFolder(
      renderer.titleForBlock?.(block) || block?.id,
      'Step',
      block?.id,
      'step'
    );
    return `${workflowRoot}/Results/${entryFolder}/${blockFolder}`;
  }

  function buildWorkflowStepNotebookFolderPath(workflow, entry, notebookEntryId = '') {
    const workflowRoot = buildWorkflowInstanceRootFolderPath(workflow);
    if (!workflowRoot) {
      return '';
    }
    const entryFolder = buildNamedFolder(entry?.name, 'Entry', entry?.id, 'entry');
    const notebookFolder = buildNamedFolder('Notebook_Page', 'Notebook_Page', notebookEntryId, 'page');
    return `${workflowRoot}/Notebook/${entryFolder}/${notebookFolder}`;
  }

  async function ensureStorageFolderExists(storageFolder) {
    if (storageFolder && windowObject?.hikariApi?.ensureStorageDirectory) {
      await windowObject.hikariApi.ensureStorageDirectory(storageFolder);
    }
  }

  async function persistImportedWorkflowFiles({ files, storageFolder }) {
    const selectedFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!selectedFiles.length) {
      return [];
    }

    const rootPath = String(state.settings?.storagePath || '').trim();
    if (!rootPath) {
      throw new Error('Set Storage Folder Path in Settings before importing workflow files.');
    }
    if (!storageFolder) {
      throw new Error('Workflow storage folder is missing.');
    }
    if (!windowObject?.hikariApi?.storeImportedFile || typeof FileReaderClass !== 'function') {
      throw new Error('Imported file storage API is unavailable.');
    }

    const targetFolder = `${storageFolder}/ResultFiles`;
    const importedAt = new Date().toISOString();
    const records = [];
    for (const file of selectedFiles) {
      const dataBase64 = extractBase64Payload(await blobToDataUrl(file, FileReaderClass));
      if (!dataBase64) {
        throw new Error(`Cannot read ${file.name}.`);
      }
      const result = await windowObject.hikariApi.storeImportedFile({
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

  return {
    buildWorkflowStepNotebookFolderPath,
    buildWorkflowStepResultsFolderPath,
    ensureStorageFolderExists,
    persistImportedWorkflowFiles
  };
}
