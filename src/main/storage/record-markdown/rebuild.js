'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { isBundleCandidateName, looksLikeHikariSnapshot } = require('../storage-discovery');
const { readSampleContainers } = require('../sample-containers');
const { withStorageRootWrite } = require('../write-coordinator');
const { array, object } = require('./format');
const { existingMarkdown, writeRecordMarkdown } = require('./index');
const { prepareRecordDocument, readRecordDocument, writeRecordDocument } = require('./document-storage');
const { documentMarker } = require('./document-fields');
const { sanitizeFolderName } = require('../storage-utils');
const { isPathInside } = require('../../lib/path-safety');
const { buildWorkflowFolderLayout } = require('../workflow/folder-names');
const { buildNotebookStorageFolder } = require('../workflow/fs-helpers');
const { resolveWorkflowTemplateRecord } = require('../workflow/record-compaction');
const { writeFileAtomic } = require('../../lib/shared-json-file');

async function materializeWorkflowMetadata(snapshot, storageRoot) {
  const templates = new Map(array(snapshot.workflowTemplates).map(record => [record.id, record]));
  for (const workflow of array(snapshot.workflows)) {
    const template = resolveWorkflowTemplateRecord(templates, workflow);
    const layout = buildWorkflowFolderLayout({ storagePath: storageRoot, template, workflow });
    for (const [filePath, payload] of [
      [path.join(layout.templateFolderPath, 'template.json'), { template }],
      [path.join(layout.workflowFolderPath, 'workflow.json'), { template, workflow }]
    ]) {
      const exists = await fs.stat(filePath).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      if (!exists) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await writeFileAtomic(fs, filePath, JSON.stringify(payload, null, 2));
      }
    }
  }
}

function addSnapshotDocuments(snapshot, records, storageRoot) {
  const known = new Set(records.map(record => `${record.kind}:${record.payload[record.kind === 'protocol' ? 'protocol' : 'notebookEntry'].id}`));
  const templateById = new Map(array(snapshot.workflowTemplates).map(template => [template.id, template]));
  for (const [key, kind] of [['protocols', 'protocol'], ['notebookEntries', 'notebook']]) {
    for (const record of array(snapshot[key])) {
      if (!record.id) throw new Error(`Missing ${kind} ID in legacy snapshot`);
      if (known.has(`${kind}:${record.id}`)) continue;
      let folder;
      if (kind === 'protocol') {
        folder = path.join(storageRoot, 'Protocol', `${sanitizeFolderName(record.name, 'Protocol')}__${sanitizeFolderName(record.id, 'protocol')}`);
      } else {
        const workflow = array(snapshot.workflows).find(item => item.id === record.workflowContext?.workflowId);
        if (workflow) {
          const template = resolveWorkflowTemplateRecord(templateById, workflow);
          folder = buildNotebookStorageFolder(buildWorkflowFolderLayout({ storagePath: storageRoot, workflow, template }), record);
        } else if (record.storageFolder && isPathInside(storageRoot, record.storageFolder)) {
          folder = path.resolve(record.storageFolder);
        } else {
          folder = path.join(storageRoot, 'Project', sanitizeFolderName(record.projectName, 'Untitled_Project'), 'Notebook',
            `${sanitizeFolderName(record.protocolName || record.id, 'Notebook_Page')}__${sanitizeFolderName(record.id, 'page')}`);
        }
      }
      records.push({ kind, time: 0, filePath: path.join(folder, kind === 'protocol' ? 'protocol.json' : 'page.json'),
        payload: { [kind === 'protocol' ? 'protocol' : 'notebookEntry']: { ...record, ...(kind === 'notebook' ? { storageFolder: '' } : {}) } } });
      known.add(`${kind}:${record.id}`);
    }
  }
}

async function walk(folder, output) {
  let entries;
  try { entries = await fs.readdir(folder, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const filePath = path.join(folder, entry.name);
    // Never follow external folder links or scan generated assets.
    if (entry.isDirectory() && entry.name !== '.hikari-markdown' && entry.name !== '.agents') await walk(filePath, output);
    else if (entry.isFile()) output.add(filePath);
  }
}

async function readJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { throw new Error(`Cannot regenerate Markdown from ${filePath}: ${error.message}`); }
}

async function rebuildUnlocked(storageRoot, { migrate = false } = {}) {
  const files = new Set();
  for (const folder of ['Protocol', 'Project', 'Workflow', 'Plates', 'Gels', 'Plugins/gel']) {
    await walk(path.join(storageRoot, folder), files);
  }
  const snapshotKeys = ['protocols', 'notebookEntries', 'workflowTemplates', 'workflows', 'assays', 'gelAnalyses', 'samples'];
  const snapshot = { settings: { storagePath: storageRoot }, ...Object.fromEntries(snapshotKeys.map(key => [key, []])) };
  const roots = (await fs.readdir(storageRoot, { withFileTypes: true }))
    .filter(entry => entry.isFile() && isBundleCandidateName(entry.name));
  const rootSnapshots = [];
  for (const entry of roots) {
    const filePath = path.join(storageRoot, entry.name);
    const payload = await readJson(filePath);
    if (Array.isArray(payload.notebookPages) && !payload.notebookEntries) payload.notebookEntries = payload.notebookPages;
    if (looksLikeHikariSnapshot(payload)) rootSnapshots.push({ payload, time: (await fs.stat(filePath)).mtimeMs });
  }
  rootSnapshots.sort((a, b) => a.time - b.time);
  for (const { payload } of rootSnapshots) {
    for (const key of snapshotKeys) snapshot[key].push(...array(payload[key]));
    snapshot.settings = { ...snapshot.settings, ...object(payload.settings), storagePath: storageRoot };
  }

  const records = [];
  const assays = [];
  const gels = [];
  const pluginGels = [];
  const seen = new Set();
  for (const candidate of files) {
    const filePath = candidate.replace(/((?:protocol|page)\.json)\.pending$/, '$1');
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    const name = path.basename(filePath);
    if (!['protocol.json', 'page.json', 'assay.json', 'gel.json', 'assay-definition.json', 'gel-record.json'].includes(name)) continue;
    const folder = path.dirname(filePath);
    if (name === 'protocol.json' || name === 'page.json') {
      const kind = name === 'protocol.json' ? 'protocol' : 'notebook';
      const loaded = await readRecordDocument(filePath, kind);
      if (!loaded.ok) throw new Error(`Cannot regenerate Markdown from ${filePath}: ${loaded.error || 'missing record checkpoint'}`);
      const record = object(kind === 'protocol' ? loaded.data.protocol : loaded.data.notebookEntry);
      if (!record.id) throw new Error(`Missing ${kind} ID in ${filePath}`);
      if ((loaded.markdownError || loaded.checkpointError) && loaded.warnings.length && (migrate || loaded.markdownError?.code !== 'ENOENT')) throw new Error(loaded.warnings.join('\n'));
      records.push({ filePath, payload: loaded.data, kind, time: (await fs.stat(candidate)).mtimeMs });
      continue;
    }
    const payload = await readJson(filePath);
    if (name === 'assay.json') assays.push(object(payload.assay));
    else if (name === 'gel.json') gels.push(object(payload.gel));
    else if (name === 'assay-definition.json') {
      const analysisPath = path.join(folder, 'analysis-result.json');
      const result = files.has(analysisPath) ? object(await readJson(analysisPath)) : {};
      assays.unshift({ ...object(payload), ...result });
    } else {
      const record = { ...object(payload), recordJsonPath: filePath };
      for (const [field, fileName] of [['analysisResultPath', 'analysis-result.json'], ['previewImagePath', 'preview.png'], ['sourceImagePath', 'source.png']]) {
        const candidate = path.join(folder, fileName);
        if (files.has(candidate)) record[field] = candidate;
      }
      (filePath.startsWith(path.join(storageRoot, 'Plugins', 'gel') + path.sep) ? pluginGels : gels).push(record);
    }
  }
  records.sort((a, b) => a.time - b.time);
  snapshot.protocols.push(...records.filter(record => record.kind === 'protocol').map(record => record.payload.protocol));
  snapshot.assays.push(...assays);
  snapshot.gelAnalyses.push(...gels);
  for (const key of snapshotKeys) {
    snapshot[key] = [...new Map(snapshot[key].map(record => [record.id, record])).values()];
  }
  if (!Array.isArray(snapshot.settings.pluginStorage?.gel?.gelAnalyses) && pluginGels.length) {
    snapshot.settings.pluginStorage = { ...object(snapshot.settings.pluginStorage), gel: { gelAnalyses: pluginGels } };
  }
  const sampleData = await readSampleContainers(path.join(storageRoot, 'Samples'));
  if (sampleData.warnings.length) throw new Error(sampleData.warnings.join('\n'));
  snapshot.samples = [...new Map([...snapshot.samples, ...sampleData.samples].map(record => [record.id, record])).values()];
  if (migrate) addSnapshotDocuments(snapshot, records, storageRoot);

  // Validate every document before writing; unrelated indexes are never touched.
  for (const record of records) {
    if (migrate) await prepareRecordDocument(record);
    else await existingMarkdown(record.filePath.replace(/\.json$/, '.md'));
  }
  if (migrate) await materializeWorkflowMetadata(snapshot, storageRoot);
  const markdownPaths = [];
  for (const record of records) {
    const input = { ...record, snapshot, storageRoot };
    if (migrate) markdownPaths.push((await writeRecordDocument(input)).markdownPath);
    else {
      const current = await existingMarkdown(record.filePath.replace(/\.json$/, '.md'));
      markdownPaths.push(await writeRecordMarkdown({ ...input, canonical: Boolean(record.payload.document) || current.includes(documentMarker(record.kind)) }));
    }
  }
  return { protocols: records.filter(record => record.kind === 'protocol').length, notebooks: records.filter(record => record.kind === 'notebook').length, markdownPaths };
}

async function rebuildRecordMarkdown(storagePath, options = {}) {
  const storageRoot = await fs.realpath(path.resolve(storagePath));
  if (!(await fs.stat(storageRoot)).isDirectory()) throw new Error(`Expected a storage directory: ${storageRoot}`);
  return withStorageRootWrite(storageRoot, () => rebuildUnlocked(storageRoot, options));
}

module.exports = { rebuildRecordMarkdown };
