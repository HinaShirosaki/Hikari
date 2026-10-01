'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PLUGIN_ENTRY_FILE = 'index.html';
const PLUGIN_MANIFEST_FILE = 'plugin.json';
const MAX_TEXT_LENGTH = 400;

const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLUGIN_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const FILE_EXTENSION_PATTERN = /^[a-z0-9]+$/;

// Capability names a plugin may request in plugin.json "permissions". The
// renderer bridge (src/renderer/app/plugin-bridge.js) refuses any verb whose
// permission is not in the installed record, so this list is the security
// boundary for the host API.
const PLUGIN_PERMISSIONS = Object.freeze([
  'protocols:read',
  'projects:read',
  'samples:read',
  'notebook:read',
  'notebook:write',
  'storage',
  'files',
  'downloads',
  'python',
  'notifications',
  'layout',
  'agent:chat',
  'agent:canvas'
]);

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value || '').trim().slice(0, maxLength);
}

// A remote plugin's `embed` URL must be absolute https. This is a security
// invariant, not a style rule: the renderer adds `allow-same-origin` to remote
// frames, which is only safe because a remote origin is not the host's origin.
// Allowing file:/http: here would hand a frame the host's own origin.
function parseEmbedUrl(rawEmbed) {
  const embed = cleanText(rawEmbed, 2000);
  if (!embed) {
    return { embedUrl: '' };
  }
  let parsed;
  try {
    parsed = new URL(embed);
  } catch {
    return { error: `"embed" must be an absolute URL (found "${embed}").` };
  }
  if (parsed.protocol !== 'https:') {
    return { error: `"embed" must use https (found "${parsed.protocol}//").` };
  }
  return { embedUrl: parsed.href };
}

// A service plugin has no view — it registers a capability instead. The only
// capability today is file conversion: a list of { from, to } extension pairs
// (bare, lower-case, no dot) the plugin can transform. Returns the normalized
// service block, or { error } / { service: null } when absent.
function parseService(rawService) {
  if (rawService === undefined || rawService === null) {
    return { service: null };
  }
  if (typeof rawService !== 'object' || Array.isArray(rawService)) {
    return { error: '"service" must be an object.' };
  }
  const rawConversions = rawService.fileConversions;
  if (!Array.isArray(rawConversions) || !rawConversions.length) {
    return { error: '"service" must declare a non-empty "fileConversions" array.' };
  }
  const fileConversions = [];
  for (const entry of rawConversions) {
    const from = cleanText(entry?.from, 16).toLowerCase().replace(/^\./, '');
    const to = cleanText(entry?.to, 16).toLowerCase().replace(/^\./, '');
    if (!FILE_EXTENSION_PATTERN.test(from) || !FILE_EXTENSION_PATTERN.test(to)) {
      return { error: '"service.fileConversions" needs bare lower-case extensions, e.g. { "from": "dna", "to": "gbk" }.' };
    }
    fileConversions.push({ from, to });
  }
  return { service: { fileConversions } };
}

// Validates a user-selected plugin folder and returns the normalized record the
// renderer stores in settings.
//
// The folder shape is deliberately strict: `plugin.json` at the root, an
// explicit kebab-case `id` that matches the folder name, and a semver
// `version`. Hikari refuses to boot anything else. Guessing at a loose folder
// (deriving ids from display names, tolerating a missing manifest) produced
// installs whose identity changed when the author renamed a title, so identity
// is declared, not inferred.
//
// Two kinds of plugin:
//   local  - ships `index.html`; runs on private loopback; may hold host permissions.
//   remote - declares `embed` (https URL); the folder is metadata only, and it
//            may NOT hold host permissions because the code is third-party and
//            not shipped in the folder the user reviewed.
async function inspectPluginFolder({ fs, folderPath }) {
  const cleanPath = cleanText(folderPath, 2400);
  if (!cleanPath || !path.isAbsolute(cleanPath)) {
    return { ok: false, error: 'Plugin folder path must be an absolute path.' };
  }

  let manifest = null;
  try {
    const rawManifest = await fs.readFile(path.join(cleanPath, PLUGIN_MANIFEST_FILE), 'utf8');
    const parsed = JSON.parse(rawManifest);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: `${PLUGIN_MANIFEST_FILE} must contain a JSON object.` };
    }
    manifest = parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, error: `${PLUGIN_MANIFEST_FILE} is not valid JSON.` };
    }
    return { ok: false, error: `Plugin folder does not contain ${PLUGIN_MANIFEST_FILE}.` };
  }

  const id = cleanText(manifest.id, 80);
  if (!id) {
    return { ok: false, error: `${PLUGIN_MANIFEST_FILE} is missing the required "id" field.` };
  }
  if (!PLUGIN_ID_PATTERN.test(id)) {
    return { ok: false, error: `Plugin id "${id}" must be lower-case kebab-case (e.g. "imagej-bridge").` };
  }
  const folderName = path.basename(cleanPath);
  if (folderName !== id) {
    return { ok: false, error: `Plugin folder must be named "${id}" to match the manifest id (found "${folderName}").` };
  }

  const name = cleanText(manifest.name, 120);
  if (!name) {
    return { ok: false, error: `${PLUGIN_MANIFEST_FILE} is missing the required "name" field.` };
  }

  const version = cleanText(manifest.version, 32);
  if (!PLUGIN_VERSION_PATTERN.test(version)) {
    return { ok: false, error: `${PLUGIN_MANIFEST_FILE} needs a "version" like "1.0.0" (found "${version || 'nothing'}").` };
  }

  const { embedUrl = '', error: embedError } = parseEmbedUrl(manifest.embed);
  if (embedError) {
    return { ok: false, error: `${PLUGIN_MANIFEST_FILE} ${embedError}` };
  }

  const serve = manifest.serve === true;
  if (serve && embedUrl) {
    return { ok: false, error: `${PLUGIN_MANIFEST_FILE} cannot set both "serve" and "embed".` };
  }
  if (manifest.serve !== undefined && typeof manifest.serve !== 'boolean') {
    return { ok: false, error: `${PLUGIN_MANIFEST_FILE} "serve" must be true or false.` };
  }

  const { service = null, error: serviceError } = parseService(manifest.service);
  if (serviceError) {
    return { ok: false, error: `${PLUGIN_MANIFEST_FILE} ${serviceError}` };
  }
  // A service is local code you audited in the folder. Remote code cannot be a
  // trusted service, and service delivery is host-controlled, so its manifest
  // may opt into neither a remote embed nor `serve: true`. The renderer still
  // delivers the hidden service through its private loopback server because
  // packaged Electron blocks scripts in external file: frames.
  if (service && (embedUrl || serve)) {
    return { ok: false, error: `${PLUGIN_MANIFEST_FILE} a "service" plugin cannot also use "embed" or "serve".` };
  }

  // Every plugin ships its entry page except a remote embed. A service runs its
  // code in a hidden frame, so it needs index.html too.
  let entryUrl = '';
  if (!embedUrl) {
    const entryPath = path.join(cleanPath, PLUGIN_ENTRY_FILE);
    try {
      const stats = await fs.stat(entryPath);
      if (!stats.isFile()) {
        return { ok: false, error: `${PLUGIN_ENTRY_FILE} in the plugin folder is not a file.` };
      }
    } catch {
      return { ok: false, error: `Plugin folder does not contain ${PLUGIN_ENTRY_FILE}.` };
    }
    entryUrl = pathToFileURL(entryPath).href;
  }

  const rawPermissions = manifest.permissions === undefined ? [] : manifest.permissions;
  if (!Array.isArray(rawPermissions)) {
    return { ok: false, error: `${PLUGIN_MANIFEST_FILE} "permissions" must be an array.` };
  }
  const permissions = [];
  for (const rawPermission of rawPermissions) {
    const permission = cleanText(rawPermission, 40);
    if (!PLUGIN_PERMISSIONS.includes(permission)) {
      return {
        ok: false,
        error: `Unknown permission "${permission}". Allowed: ${PLUGIN_PERMISSIONS.join(', ')}.`
      };
    }
    if (!permissions.includes(permission)) {
      permissions.push(permission);
    }
  }

  // Host permissions are a grant to code the user can read in the folder they
  // installed. Remote code can change after review, so it never gets one.
  if (embedUrl && permissions.length) {
    return {
      ok: false,
      error: 'A plugin with "embed" cannot request host permissions — remote code has no access to Hikari data.'
    };
  }

  return {
    ok: true,
    id,
    name,
    version,
    description: cleanText(manifest.description),
    permissions,
    path: cleanPath,
    entryUrl,
    embedUrl,
    serve,
    service
  };
}

module.exports = {
  inspectPluginFolder,
  PLUGIN_PERMISSIONS
};
