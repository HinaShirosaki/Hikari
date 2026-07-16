'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PLUGIN_ENTRY_FILE = 'index.html';
const PLUGIN_MANIFEST_FILE = 'plugin.json';
const MAX_TEXT_LENGTH = 400;

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value || '').trim().slice(0, maxLength);
}

function slugify(value) {
  return cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Validates a user-selected plugin folder and returns the normalized record the
// renderer stores in settings. A plugin folder must contain index.html; an
// optional plugin.json can override name/description.
async function inspectPluginFolder({ fs, folderPath }) {
  const cleanPath = cleanText(folderPath, 2400);
  if (!cleanPath || !path.isAbsolute(cleanPath)) {
    return { ok: false, error: 'Plugin folder path must be an absolute path.' };
  }

  const entryPath = path.join(cleanPath, PLUGIN_ENTRY_FILE);
  try {
    const stats = await fs.stat(entryPath);
    if (!stats.isFile()) {
      return { ok: false, error: `${PLUGIN_ENTRY_FILE} in the plugin folder is not a file.` };
    }
  } catch {
    return { ok: false, error: `Plugin folder does not contain ${PLUGIN_ENTRY_FILE}.` };
  }

  let manifest = {};
  try {
    const rawManifest = await fs.readFile(path.join(cleanPath, PLUGIN_MANIFEST_FILE), 'utf8');
    const parsed = JSON.parse(rawManifest);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      manifest = parsed;
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, error: `${PLUGIN_MANIFEST_FILE} is not valid JSON.` };
    }
    // Missing manifest is fine — folder name becomes the plugin name.
  }

  const name = cleanText(manifest.name, 120) || path.basename(cleanPath);
  const id = slugify(name) || slugify(path.basename(cleanPath));
  if (!id) {
    return { ok: false, error: 'Could not derive a plugin id from the folder name.' };
  }

  return {
    ok: true,
    id,
    name,
    description: cleanText(manifest.description),
    path: cleanPath,
    entryUrl: pathToFileURL(entryPath).href
  };
}

module.exports = {
  inspectPluginFolder
};
