'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { asArray, cleanText, ensureObject, sanitizeFolderName } = require('../storage-utils');
const { isPathInside } = require('../../lib/path-safety');
const { buildWorkflowFolderLayout, collectLinkedNotebookIds } = require('../workflow/folder-names');
const { buildNotebookStorageFolder } = require('../workflow/fs-helpers');
const { resolveWorkflowTemplateRecord } = require('../workflow/record-compaction');

// Copying a folder in Finder or Explorer repeats its protocol ID. The folder
// Hikari named for the protocol owns the ID; readers skip copies and the
// writer never prunes them.
function protocolFolderRank(folderName, protocol) {
  if (folderName === buildProtocolFolderName(protocol)) return 0;
  return folderName.endsWith(`__${sanitizeFolderName(protocol.id)}`) ? 1 : 2;
}

async function protocolFoldersById(protocolRootPath) {
  const owners = new Map();
  for (const entry of await fs.readdir(protocolRootPath, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })) {
    if (!entry.isDirectory()) continue;
    try {
      const protocol = JSON.parse(await fs.readFile(path.join(protocolRootPath, entry.name, 'protocol.json'), 'utf8')).protocol;
      if (!protocol?.id) continue;
      const rank = protocolFolderRank(entry.name, protocol);
      const owner = owners.get(protocol.id);
      if (!owner || rank < owner.rank || (rank === owner.rank && entry.name < owner.folder)) owners.set(protocol.id, { folder: entry.name, rank });
    } catch { /* Unreadable records are retained by the writer. */ }
  }
  return new Map([...owners].map(([id, owner]) => [id, owner.folder]));
}

function buildProtocolFolderName(protocol, index = 0) {
  const source = ensureObject(protocol);
  const id = cleanText(source.id, 220);
  const name = cleanText(source.name, 220);
  return name || id
    ? `${sanitizeFolderName(name, 'Protocol')}__${sanitizeFolderName(id, `protocol_${index + 1}`)}`
    : sanitizeFolderName(`protocol_${index + 1}`, `protocol_${index + 1}`);
}

function isWorkflowNotebookEntry(entry) {
  const context = ensureObject(entry?.workflowContext);
  return Boolean(cleanText(context.workflowId, 220) || cleanText(context.workflowEntryId, 220) || cleanText(context.workflowBlockId, 220));
}

function buildNotebookPageFolderPath(root, entry) {
  const record = ensureObject(entry);
  const existing = cleanText(record.storageFolder, 2400);
  if (existing && isPathInside(root, existing)) return path.resolve(existing);
  return path.join(root, 'Project', sanitizeFolderName(record.projectName || 'Untitled_Project', 'Untitled_Project'), 'Notebook',
    `${sanitizeFolderName(record.protocolName || record.id || 'Notebook_Page', 'Notebook_Page')}__${sanitizeFolderName(record.id, 'page')}`);
}

function workflowDocumentInputs(root, snapshot) {
  const templates = new Map(asArray(snapshot.workflowTemplates).map(template => [template.id, template]));
  return asArray(snapshot.workflows).flatMap(workflow => {
    if (!cleanText(workflow.id, 220)) return [];
    const template = resolveWorkflowTemplateRecord(templates, workflow);
    const layout = buildWorkflowFolderLayout({ storagePath: root, template, workflow });
    const linked = collectLinkedNotebookIds(workflow);
    return asArray(snapshot.notebookEntries).filter(entry => linked.includes(cleanText(entry?.id, 220))).map(entry => ({
      kind: 'notebook', filePath: path.join(buildNotebookStorageFolder(layout, entry), 'page.json'), payload: { notebookEntry: entry }
    }));
  });
}

async function snapshotDocumentInputs(root, snapshot) {
  for (const [key, kind] of [['protocols', 'protocol'], ['notebookEntries', 'notebook']]) {
    const ids = new Set();
    for (const record of asArray(snapshot[key])) {
      const id = cleanText(record?.id, 220);
      if (id && ids.has(id)) throw new Error(`Duplicate ${kind} ID: ${id}`);
      if (id) ids.add(id);
    }
  }
  const protocolRoot = path.join(root, 'Protocol');
  const folders = await protocolFoldersById(protocolRoot);
  return [
    ...asArray(snapshot.protocols).map((protocol, index) => ({ kind: 'protocol',
      filePath: path.join(protocolRoot, folders.get(protocol.id) || buildProtocolFolderName(protocol, index), 'protocol.json'), payload: { protocol } })),
    ...asArray(snapshot.notebookEntries).filter(entry => !isWorkflowNotebookEntry(entry)).map(entry => ({ kind: 'notebook',
      filePath: path.join(buildNotebookPageFolderPath(root, entry), 'page.json'), payload: { notebookEntry: entry } })),
    ...workflowDocumentInputs(root, snapshot)
  ];
}

module.exports = { buildNotebookPageFolderPath, buildProtocolFolderName, isWorkflowNotebookEntry, protocolFoldersById, snapshotDocumentInputs, workflowDocumentInputs };
