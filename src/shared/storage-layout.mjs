// Folder layout of the storage root. Renderer and main both name folders
// here, so the folder the renderer files a record under is the one main
// hydrates, indexes and hands to Codex. Paths are relative and '/'-separated:
// main joins them with path.join, the renderer appends them to the root.

export const PROJECT_ROOT_FOLDER_NAME = 'Project';
export const PROTOCOL_ROOT_FOLDER_NAME = 'Protocol';
export const WORKFLOW_ROOT_FOLDER_NAME = 'Workflow';
export const PAPERS_ROOT_FOLDER_NAME = 'Papers';
export const PLATES_ROOT_FOLDER_NAME = 'Plates';

export function sanitizeFolderName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  // Separators are already gone, but a name of nothing but dots survives them
  // and still walks: path.join(root, 'Project', '..') is the storage root.
  return !cleaned || /^\.+$/.test(cleaned) ? fallback : cleaned;
}

// <name>__<id>: the id keeps two records with the same name apart.
export function namedFolder(name, nameFallback, id, idFallback) {
  return `${sanitizeFolderName(name, nameFallback)}__${sanitizeFolderName(id, idFallback)}`;
}

export function projectFolderPath(projectName) {
  return `${PROJECT_ROOT_FOLDER_NAME}/${sanitizeFolderName(projectName, 'Untitled_Project')}`;
}

// Project/<project>/Notebook/<protocol>__<entryId>
export function notebookPageFolderPath(entry) {
  const pageName = entry?.protocolName || entry?.experimentName;
  return `${projectFolderPath(entry?.projectName)}/Notebook/${namedFolder(pageName, 'Notebook_Page', entry?.id, 'page')}`;
}

export function protocolFolderPath(protocol) {
  return `${PROTOCOL_ROOT_FOLDER_NAME}/${namedFolder(protocol?.name, 'Protocol', protocol?.id, 'protocol')}`;
}

// Literature-search and journal-club papers get top-level collections; any
// other link files the PDF under its project.
export function paperFolderPath({ linkedType, linkedName } = {}) {
  const type = String(linkedType || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const name = sanitizeFolderName(linkedName, 'Uncategorized');
  return type === 'journal-club' || type === 'literature-search'
    ? `${PAPERS_ROOT_FOLDER_NAME}/${name}`
    : `${PROJECT_ROOT_FOLDER_NAME}/${name}/Papers`;
}

// Plate (assay) and gel record folders.
export function recordFolderName(record, label) {
  return namedFolder(record?.name || record?.assayNumber || record?.id, label, record?.id, label.toLowerCase());
}

export function workflowTemplateFolderName(template) {
  return namedFolder(template?.name, 'Untitled_Template', template?.id, 'template');
}

export function workflowFolderName(workflow) {
  return namedFolder(workflow?.name, 'Untitled_Workflow', workflow?.id, 'workflow');
}

export function workflowEntryFolderName(entryName, entryId) {
  return namedFolder(entryName, 'Entry', entryId, 'entry');
}

export function workflowBlockFolderName(blockName, blockId) {
  return namedFolder(blockName, 'Step', blockId, 'step');
}

export function workflowNotebookPageFolderName(notebookEntryId) {
  return namedFolder('Notebook_Page', 'Notebook_Page', notebookEntryId, 'page');
}
