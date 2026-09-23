'use strict';

const { normalizeFolderKey } = require('../memory/text-utils.js');
const { PROJECT_MEMORY_AUTO_END, PROJECT_MEMORY_AUTO_START } = require('../storage-memory');
const { asArray, cleanText, ensureObject } = require('../storage-utils');

function pickLatestTimestamp(...values) {
  let latest = '';
  let latestMs = 0;
  values.forEach((value) => {
    const normalized = cleanText(value, 80);
    const ms = Date.parse(normalized);
    if (normalized && Number.isFinite(ms) && ms >= latestMs) {
      latest = normalized;
      latestMs = ms;
    }
  });
  return latest;
}

function buildProjectFolderDisplayName(folderName) {
  const normalized = cleanText(folderName, 320);
  return normalized ? normalized.replace(/_/g, ' ') : 'Untitled Project';
}

// The folder IS the project's identity on disk: it was written as
// sanitizeFolderName(project.name), so the same transform finds the live record
// again. Without this, a project whose folder holds no page.json to read the id
// back from hydrates under a minted id and lands beside itself in the list.
// ponytail: two names that sanitize to one folder key collide and the first
// known project wins. They already share a single folder, so memory for the
// second is lost before hydration sees it; fix that at the folder layer.
function buildProjectIdResolverByFolder(knownProjects) {
  const byFolderKey = new Map();
  asArray(knownProjects).forEach((project) => {
    const source = ensureObject(project);
    const id = cleanText(source.id, 220);
    const folderKey = normalizeFolderKey(source.name);
    if (id && folderKey && !byFolderKey.has(folderKey)) {
      byFolderKey.set(folderKey, id);
    }
  });
  return (folderName) => byFolderKey.get(normalizeFolderKey(folderName)) || '';
}

function buildProjectFolderFallbackId(folderName) {
  const normalized = cleanText(folderName, 220)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `project_folder_${normalized || 'untitled_project'}`;
}

function parseProjectMemoryMarkdown(rawMarkdown) {
  const markdown = String(rawMarkdown || '');
  if (!markdown.trim()) {
    return {};
  }
  const markerStart = markdown.indexOf(PROJECT_MEMORY_AUTO_START);
  const markerEnd = markerStart >= 0
    ? markdown.indexOf(PROJECT_MEMORY_AUTO_END, markerStart + PROJECT_MEMORY_AUTO_START.length)
    : -1;
  const metadataMarkdown = markerStart >= 0 && markerEnd >= 0
    ? markdown.slice(markerStart + PROJECT_MEMORY_AUTO_START.length, markerEnd)
    : markdown;
  const out = {};
  metadataMarkdown.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([A-Za-z ]+):\s*(.*)$/);
    if (!match) {
      return;
    }
    const key = cleanText(match[1], 80).toLowerCase();
    const value = cleanText(match[2], 4000);
    if (!value || value === 'None recorded.' || value === 'Unknown') {
      return;
    }
    if (key === 'name') {
      out.name = value;
    } else if (key === 'id') {
      out.id = value;
    } else if (key === 'description') {
      out.description = value;
    } else if (key === 'created') {
      out.createdAt = value;
    } else if (key === 'updated') {
      out.updatedAt = value;
    }
  });
  return out;
}

module.exports = {
  buildProjectFolderDisplayName,
  buildProjectFolderFallbackId,
  buildProjectIdResolverByFolder,
  parseProjectMemoryMarkdown,
  pickLatestTimestamp
};
