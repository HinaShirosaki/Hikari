export function sanitizeFolderName(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildNotebookFolderPath({ storagePath, projectName, protocolName, entryId } = {}) {
  const rootPath = String(storagePath || '').trim();
  if (!rootPath) {
    return '';
  }
  const safeProject = sanitizeFolderName(projectName) || 'Untitled_Project';
  const safeProtocol = sanitizeFolderName(protocolName) || 'Notebook_Page';
  const safeEntryId = sanitizeFolderName(entryId) || 'page';
  return `${rootPath}/Project/${safeProject}/Notebook/${safeProtocol}__${safeEntryId}`;
}

export function normalizeStoragePath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
}

export function joinStoragePath(rootPath, relativePath) {
  const root = normalizeStoragePath(rootPath);
  const relative = String(relativePath || '').trim().replace(/\\/g, '/').replace(/^\/+/g, '');
  if (!root || !relative) {
    return '';
  }
  return `${root}/${relative}`;
}

export function isPathInsideRoot(rootPath, targetPath) {
  const root = normalizeStoragePath(rootPath);
  const target = normalizeStoragePath(targetPath);
  if (!root || !target) {
    return false;
  }
  return target === root || target.startsWith(`${root}/`);
}
