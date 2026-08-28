'use strict';

const { PROJECT_MEMORY_AUTO_END, PROJECT_MEMORY_AUTO_START } = require('../storage-memory');
const { cleanText } = require('../storage-utils');

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
  parseProjectMemoryMarkdown,
  pickLatestTimestamp
};
