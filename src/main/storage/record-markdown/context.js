'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { isPathInside } = require('../../lib/path-safety');
const { array, object, text } = require('./format');

function resolveLocalPath(value, storageRoot, basePath = storageRoot) {
  const source = text(value).trim();
  if (!source || /^[a-z][a-z0-9+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source)) return '';
  return path.isAbsolute(source) ? source : path.resolve(basePath, source.replace(/\\/g, '/'));
}

function getGels(snapshot, storageRoot) {
  const pluginRecords = snapshot?.settings?.pluginStorage?.gel?.gelAnalyses;
  const plugin = Array.isArray(pluginRecords);
  return array(plugin ? pluginRecords : snapshot.gelAnalyses).map(rawRecord => {
    const record = object(rawRecord);
    const basePath = plugin ? path.join(storageRoot, 'Plugins', 'gel') : storageRoot;
    const portable = { ...record };
    for (const key of ['previewImage', 'sourceImage', 'originalImage', 'analysisResult', 'recordJson']) {
      portable[`${key}Path`] = resolveLocalPath(record[`${key}RelativePath`] || record[`${key}Path`], storageRoot, basePath);
    }
    return portable;
  });
}

async function readLinkedJson(filePath, storageRoot, warnings) {
  if (!filePath) return null;
  try {
    const actual = await fs.realpath(filePath);
    if (!isPathInside(await fs.realpath(storageRoot), actual)) throw new Error('outside the storage root');
    return JSON.parse(await fs.readFile(actual, 'utf8'));
  } catch (error) {
    warnings.push(`Could not load linked JSON ${filePath}: ${error.message}`);
    return null;
  }
}

function linkedRecords(records, ids, notebookId) {
  const requested = new Set(array(ids).map(text));
  return array(records).filter(record => record && (requested.has(text(record.id)) || notebookId && record.notebookEntryId === notebookId));
}

async function notebookContext(entry, snapshot, storageRoot) {
  const warnings = [];
  let protocol = object(entry.protocolSnapshot);
  if (!Object.keys(protocol).length) {
    protocol = object(array(snapshot.protocols).find(record => record?.id === entry.protocolId));
    warnings.push(Object.keys(protocol).length
      ? 'No saved protocol snapshot; the current protocol is shown as a fallback.'
      : 'No saved protocol snapshot or matching protocol is available.');
  }
  const assays = linkedRecords(snapshot.assays, entry.assayIds, entry.id);
  const gels = linkedRecords(getGels(snapshot, storageRoot), entry.gelIds, entry.id);
  for (const [kind, records, ids] of [['assay', assays, entry.assayIds], ['gel', gels, entry.gelIds]]) {
    for (const id of array(ids)) {
      if (!records.some(record => text(record.id) === text(id))) warnings.push(`Linked ${kind} ${text(id)} is unavailable.`);
    }
  }
  // Plugin records deliberately omit reports/parameters from the primary
  // snapshot. Load those from their durable JSON artifacts as well.
  const assayDetails = [];
  for (const assay of assays) {
    const definition = await readLinkedJson(resolveLocalPath(assay.definitionJsonRelativePath || assay.definitionJsonPath, storageRoot), storageRoot, warnings);
    const analysis = await readLinkedJson(resolveLocalPath(assay.analysisResultRelativePath || assay.analysisResultPath, storageRoot), storageRoot, warnings);
    assayDetails.push({ ...object(definition), ...object(analysis), ...assay,
      ...(definition ? { artifactDefinition: definition } : {}), ...(analysis ? { artifactAnalysis: analysis } : {}) });
  }
  const gelDetails = [];
  for (const gel of gels) {
    const record = await readLinkedJson(gel.recordJsonPath, storageRoot, warnings);
    const report = await readLinkedJson(gel.analysisResultPath, storageRoot, warnings);
    gelDetails.push({ ...object(record), ...gel, ...(report ? { report } : {}) });
  }
  const samples = array(entry.sampleLinks).map(link => ({
    link,
    sample: array(snapshot.samples).find(sample => sample?.id && sample.id === (link?.sampleId || link?.id)) || null
  }));
  return { protocol, assays: assayDetails, gels: gelDetails, samples, warnings };
}

module.exports = { getGels, linkedRecords, notebookContext, resolveLocalPath };
