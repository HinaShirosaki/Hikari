'use strict';

const fs = require('fs/promises');
const path = require('path');
const { writeFileAtomic } = require('../lib/shared-json-file.js');
const { asArray, cleanText, ensureObject, isUnreadableJsonFile, keepLatestById, readJsonFile, sanitizeFolderName } = require('./storage-utils');

// Personal inventory on disk, one file per container:
//   Samples/<zone>/<container>__<id>.json  the container, its wellCount, and only
//                                          the wells that hold a sample (or that
//                                          still carry legacy well text)
//   Samples/<zone>/folders.json            that zone's container folders
//   Samples/unplaced.json                  samples no container holds
// Loading rebuilds each container's full wells array from wellCount, so the
// renderer sees the same shape it saved.
const SCHEMA_VERSION = '1.0.0';
const CONTAINER_SCHEMA = 'hikari_sample_container';
const FOLDERS_SCHEMA = 'hikari_sample_folders';
const UNPLACED_SCHEMA = 'hikari_unplaced_samples';
const FOLDERS_FILE_NAME = 'folders.json';
const UNPLACED_FILE_NAME = 'unplaced.json';

function readWellIndex(sample) {
  const value = ensureObject(sample.inventoryLink).wellIndex;
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return Number.isInteger(Number(value)) ? Number(value) : null;
}

function hasWellText(rawWell) {
  if (rawWell && typeof rawWell === 'object') {
    return Boolean(cleanText(rawWell.content));
  }
  return Boolean(String(rawWell || '').trim());
}

function buildContainerFile(section, container, position, linkedSamples, updatedAt) {
  const { wells: rawWells, ...fields } = container;
  const wells = asArray(rawWells);
  const wellEntries = new Map();
  const entryAt = (index) => {
    if (!wellEntries.has(index)) {
      wellEntries.set(index, { index, samples: [] });
    }
    return wellEntries.get(index);
  };
  const containerSamples = [];
  linkedSamples.forEach((sample) => {
    const index = readWellIndex(sample);
    if (index === null) {
      containerSamples.push(sample);
    } else {
      entryAt(index).samples.push(sample);
    }
  });
  wells.forEach((rawWell, index) => {
    if (hasWellText(rawWell)) {
      entryAt(index);
    }
  });
  for (const entry of wellEntries.values()) {
    const rawWell = wells[entry.index];
    if (rawWell !== undefined && rawWell !== '' && rawWell !== null) {
      entry.well = rawWell;
    }
  }
  return {
    schema_name: CONTAINER_SCHEMA,
    schema_version: SCHEMA_VERSION,
    updated_at: updatedAt,
    section,
    position,
    wellCount: wells.length,
    container: fields,
    wells: [...wellEntries.values()].sort((left, right) => left.index - right.index),
    samples: containerSamples
  };
}

async function writeJson(filePath, payload, writtenPaths) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(fs, filePath, JSON.stringify(payload, null, 2));
  writtenPaths.add(path.resolve(filePath));
}

// ponytail: zones whose names sanitize to the same folder share it; each file
// still records its own section, only folders.json would collide.
async function writeSampleContainers(samplesRootPath, snapshot, updatedAt) {
  if (!samplesRootPath) {
    return [];
  }
  const inventory = ensureObject(snapshot.inventory);
  const inventoryFolders = ensureObject(snapshot.inventoryFolders);
  const samplesByContainer = new Map();
  const unplaced = [];
  const containerKeys = new Set();
  Object.entries(inventory).forEach(([section, containers]) => {
    asArray(containers).forEach((container) => {
      const id = cleanText(ensureObject(container).id);
      if (id) {
        containerKeys.add(`${section}::${id}`);
      }
    });
  });
  asArray(snapshot.samples).forEach((rawSample) => {
    const sample = ensureObject(rawSample);
    const link = ensureObject(sample.inventoryLink);
    const key = `${link.section}::${link.containerId}`;
    if (!containerKeys.has(key)) {
      unplaced.push(sample);
      return;
    }
    if (!samplesByContainer.has(key)) {
      samplesByContainer.set(key, []);
    }
    samplesByContainer.get(key).push(sample);
  });

  const writtenPaths = new Set();
  const sections = new Set([...Object.keys(inventory), ...Object.keys(inventoryFolders)]);
  for (const section of sections) {
    const zonePath = path.join(samplesRootPath, sanitizeFolderName(section, 'Zone'));
    const containers = asArray(inventory[section]).map((container) => ensureObject(container));
    for (const [position, container] of containers.entries()) {
      const id = cleanText(container.id);
      if (!id) {
        continue;
      }
      const fileName = `${sanitizeFolderName(container.name, 'Container')}__${sanitizeFolderName(id, 'container')}.json`;
      const linkedSamples = samplesByContainer.get(`${section}::${id}`) || [];
      await writeJson(path.join(zonePath, fileName), buildContainerFile(section, container, position, linkedSamples, updatedAt), writtenPaths);
    }
    const folders = asArray(inventoryFolders[section]);
    if (folders.length) {
      await writeJson(path.join(zonePath, FOLDERS_FILE_NAME), {
        schema_name: FOLDERS_SCHEMA,
        schema_version: SCHEMA_VERSION,
        updated_at: updatedAt,
        section,
        folders
      }, writtenPaths);
    }
  }
  if (unplaced.length) {
    await writeJson(path.join(samplesRootPath, UNPLACED_FILE_NAME), {
      schema_name: UNPLACED_SCHEMA,
      schema_version: SCHEMA_VERSION,
      updated_at: updatedAt,
      samples: unplaced
    }, writtenPaths);
  }

  // These files are the only copy, so a deleted container, zone or folder list
  // must lose its file or the next load would bring it back.
  const pruneJson = async (filePath) => {
    if (filePath.endsWith('.json') && !writtenPaths.has(path.resolve(filePath)) && !(await isUnreadableJsonFile(filePath))) {
      await fs.rm(filePath, { force: true });
    }
  };
  await pruneJson(path.join(samplesRootPath, UNPLACED_FILE_NAME));
  const zoneEntries = await fs.readdir(samplesRootPath, { withFileTypes: true }).catch(() => []);
  for (const zoneEntry of zoneEntries.filter((entry) => entry.isDirectory())) {
    const zonePath = path.join(samplesRootPath, zoneEntry.name);
    const fileEntries = await fs.readdir(zonePath, { withFileTypes: true }).catch(() => []);
    for (const fileEntry of fileEntries.filter((entry) => entry.isFile())) {
      await pruneJson(path.join(zonePath, fileEntry.name));
    }
    await fs.rmdir(zonePath).catch(() => {});
  }
  return [...writtenPaths];
}

async function readSampleContainers(samplesRootPath) {
  const result = { exists: false, samples: [], inventory: {}, inventoryFolders: {}, warnings: [] };
  const rootPath = cleanText(samplesRootPath);
  if (!rootPath) {
    return result;
  }
  let zoneEntries = [];
  try {
    zoneEntries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      result.warnings.push(`Could not read ${rootPath}: ${String(error?.message || error)}`);
    }
    return result;
  }
  result.exists = true;

  const readFile = async (filePath) => {
    const payload = await readJsonFile(filePath);
    if (!payload.ok) {
      if (payload.exists && payload.error) {
        result.warnings.push(payload.error);
      }
      return null;
    }
    const { mtimeMs } = await fs.stat(filePath).catch(() => ({ mtimeMs: 0 }));
    return { data: ensureObject(payload.data), mtimeMs };
  };
  const containers = new Map();
  const samples = new Map();
  const addSamples = (records, mtimeMs) => asArray(records).forEach((sample) => {
    if (cleanText(ensureObject(sample).id)) {
      keepLatestById(samples, { record: sample, mtimeMs });
    }
  });

  for (const zoneEntry of zoneEntries.filter((entry) => entry.isDirectory())) {
    const zonePath = path.join(rootPath, zoneEntry.name);
    const fileEntries = await fs.readdir(zonePath, { withFileTypes: true }).catch(() => []);
    for (const fileEntry of fileEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))) {
      const file = await readFile(path.join(zonePath, fileEntry.name));
      if (!file) {
        continue;
      }
      const section = cleanText(file.data.section) || zoneEntry.name;
      if (fileEntry.name === FOLDERS_FILE_NAME) {
        result.inventoryFolders[section] = asArray(file.data.folders);
        continue;
      }
      const container = ensureObject(file.data.container);
      if (!cleanText(container.id)) {
        continue;
      }
      const wells = Array.from({ length: Math.max(0, Number(file.data.wellCount) || 0) }, () => '');
      const wellSamples = [];
      asArray(file.data.wells).forEach((entry) => {
        const index = Number(entry?.index);
        if (!Number.isInteger(index) || index < 0) {
          return;
        }
        if (entry.well !== undefined) {
          wells[index] = entry.well;
        }
        wellSamples.push(...asArray(entry.samples));
      });
      keepLatestById(containers, { record: container, mtimeMs: file.mtimeMs }, {
        section,
        position: Number(file.data.position) || 0,
        container: { ...container, wells },
        samples: [...wellSamples, ...asArray(file.data.samples)],
        mtimeMs: file.mtimeMs
      });
    }
  }
  const unplacedFile = await readFile(path.join(rootPath, UNPLACED_FILE_NAME));
  if (unplacedFile) {
    addSamples(unplacedFile.data.samples, unplacedFile.mtimeMs);
  }

  const placed = [...containers.values()].map((entry) => entry.value)
    .sort((left, right) => left.position - right.position);
  placed.forEach(({ section, container, samples: containerSamples, mtimeMs }) => {
    result.inventory[section] = result.inventory[section] || [];
    result.inventory[section].push(container);
    addSamples(containerSamples, mtimeMs);
  });
  Object.keys(result.inventoryFolders).forEach((section) => {
    result.inventory[section] = result.inventory[section] || [];
  });
  result.samples = [...samples.values()].map((entry) => entry.value);
  return result;
}

module.exports = {
  readSampleContainers,
  writeSampleContainers
};
