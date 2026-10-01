'use strict';

const nodeFs = require('node:fs');
const path = require('node:path');
const { compareSemver, satisfiesRange } = require('./version.js');

// App-only updates (Obsidian's model). A release that runs on this build's
// Electron is installed as plain files in <userData>/app-code/<version>/, and
// main.js runs the newest such copy instead of the code bundled in app.asar.
// Updating then needs no Electron download, packaging or file swap; a full
// rebuild happens only when a release needs a different Electron.
const APP_CODE_DIR = 'app-code';
const MANIFEST_FILE = 'hikari-app-code.json';
const LOADED_KEY = Symbol.for('hikari.appCode');

function getAppCodeRoot(app) {
  return path.join(app.getPath('userData'), APP_CODE_DIR);
}

function readManifest(dir, fs = nodeFs) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8'));
    const entry = path.resolve(dir, String(manifest.entry || ''));
    if (!entry.startsWith(`${dir}${path.sep}`)) {
      return null;
    }
    return { version: String(manifest.version || ''), electron: String(manifest.electron || ''), dir, entry };
  } catch {
    return null;
  }
}

// Installed copies, newest first. Names starting with '.' are unfinished installs.
function listAppCode(root, fs = nodeFs) {
  let names = [];
  try {
    names = fs.readdirSync(root).map(String);
  } catch {
    names = [];
  }
  return names
    .filter((name) => !name.startsWith('.'))
    .map((name) => readManifest(path.join(root, name), fs))
    .filter((copy) => copy && compareSemver(copy.version, '0.0.0') !== null)
    .sort((left, right) => compareSemver(right.version, left.version));
}

// The newest installed copy that is newer than the bundled code and runs on this Electron.
function findNewerAppCode({ root, bundledVersion, electronVersion, fs = nodeFs }) {
  return listAppCode(root, fs).find((copy) => (
    compareSemver(copy.version, bundledVersion) > 0
    && satisfiesRange(electronVersion, copy.electron)
    && fs.existsSync(copy.entry)
  )) || null;
}

// The copy this process is running, or null when it runs the bundled code.
function getLoadedAppCode() {
  return globalThis[LOADED_KEY] || null;
}

// Called first thing in the bundled main.js: runs the newest compatible copy's
// main.js in its place and returns true. The copy's own main.js finds the marker
// and goes on to start normally. A copy that fails to load falls back to the
// bundled code, so a broken download cannot stop Hikari from starting.
function loadNewerAppCode({
  app = require('electron').app,
  fs = nodeFs,
  load = require,
  electronVersion = process.versions.electron,
  logError = console.error
} = {}) {
  // A dev checkout (`electron .`) always runs its own code.
  if (getLoadedAppCode() || !app.isPackaged) {
    return false;
  }
  const bundledVersion = app.getVersion();
  let copy = null;
  try {
    copy = findNewerAppCode({ root: getAppCodeRoot(app), bundledVersion, electronVersion, fs });
  } catch (error) {
    logError('Could not look for downloaded Hikari updates:', error);
  }
  if (!copy) {
    return false;
  }
  globalThis[LOADED_KEY] = { version: copy.version, dir: copy.dir, bundledVersion };
  // app.getVersion() otherwise reports the bundled package.json; Electron's own
  // startup sets it the same way.
  app.setVersion?.(copy.version);
  try {
    load(copy.entry);
    return true;
  } catch (error) {
    logError(`Hikari ${copy.version} (${copy.dir}) failed to load; starting the bundled ${bundledVersion}:`, error);
    delete globalThis[LOADED_KEY];
    app.setVersion?.(bundledVersion);
    return false;
  }
}

module.exports = {
  MANIFEST_FILE,
  findNewerAppCode,
  getAppCodeRoot,
  getLoadedAppCode,
  listAppCode,
  loadNewerAppCode
};
