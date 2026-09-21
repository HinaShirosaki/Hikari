'use strict';

const childProcess = require('node:child_process');
const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveCodexNodeBinary } = require('../../lib/codex-cli-provider/cli-discovery');

const NPM_PACKAGE_NAME = '@hinashirosaki/hikari';
const DEFAULT_STARTUP_DELAY_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

// Registry metadata for the published package (scoped name, so the '/' is encoded).
const NPM_UPDATE_METADATA_URL = 'https://registry.npmjs.org/@hinashirosaki%2fhikari';

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v(?=\d)/i, '');
}

function parseSemver(value) {
  const normalized = normalizeVersion(value);
  const match = normalized.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  );
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  };
}

function comparePrerelease(left = [], right = []) {
  if (!left.length && !right.length) {
    return 0;
  }
  if (!left.length) {
    return 1;
  }
  if (!right.length) {
    return -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined) {
      return -1;
    }
    if (rightValue === undefined) {
      return 1;
    }
    if (leftValue === rightValue) {
      continue;
    }
    const leftNumeric = /^\d+$/.test(leftValue);
    const rightNumeric = /^\d+$/.test(rightValue);
    if (leftNumeric && rightNumeric) {
      return Number(leftValue) > Number(rightValue) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return leftValue > rightValue ? 1 : -1;
  }
  return 0;
}

function compareSemver(leftVersion, rightVersion) {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  if (!left || !right) {
    return null;
  }
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) {
      return left[key] > right[key] ? 1 : -1;
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function normalizeHttpsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function resolveNpmReleaseMetadata(metadata = {}) {
  const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {};
  const latestTag = normalizeVersion(source['dist-tags']?.latest);
  const taggedRelease = latestTag && source.versions && typeof source.versions === 'object'
    ? source.versions[latestTag]
    : null;
  const release = taggedRelease && typeof taggedRelease === 'object'
    ? taggedRelease
    : source;
  const version = normalizeVersion(release.version || latestTag || source.version);
  const packageName = String(release.name || source.name || '').trim();
  const releaseUrl = normalizeHttpsUrl(
    (packageName && `https://www.npmjs.com/package/${packageName}`)
      || release.homepage
      || source.homepage
      || release.dist?.tarball
      || source.dist?.tarball
  );
  const releaseNotes = String(
    release.hikariReleaseNotes
      || release.releaseNotes
      || source.hikariReleaseNotes
      || source.releaseNotes
      || ''
  ).trim();

  return {
    version,
    releaseUrl,
    releaseNotes
  };
}

// The npm package is source that `npx @hinashirosaki/hikari` builds into a native
// installer on this machine (bin/hikari.js). There are no hosted binaries and the
// app is ad-hoc signed, so Electron's autoUpdater (Squirrel) is not an option;
// the in-app update runs that same build and swaps the result in.
function resolveNpxInvocation(nodeBinary, platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const nodeDir = paths.dirname(nodeBinary);
  if (platform === 'win32') {
    // npx.cmd needs a shell; npm's JS entrypoint sits next to node.exe.
    return { command: nodeBinary, args: [paths.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js')] };
  }
  return { command: paths.join(nodeDir, 'npx'), args: [] };
}

const INSTALLER_PATTERNS = {
  darwin: /\.zip$/iu,
  win32: /Setup\.exe$/iu,
  linux: /\.(?:deb|rpm)$/iu
};

function findInstaller(makeDir, platform, fs = nodeFs) {
  const pattern = INSTALLER_PATTERNS[platform];
  let entries = [];
  try {
    entries = fs.readdirSync(makeDir, { recursive: true });
  } catch {
    entries = [];
  }
  const match = entries.map(String).find((entry) => pattern?.test(entry));
  return match ? path.join(makeDir, match) : '';
}

function createNpmUpdaterService(deps = {}) {
  const app = deps.app || {};
  const dialog = deps.dialog || null;
  const shell = deps.shell || null;
  const getMainWindow = typeof deps.getMainWindow === 'function'
    ? deps.getMainWindow
    : (() => null);
  const fetchImpl = typeof deps.fetchImpl === 'function'
    ? deps.fetchImpl
    : globalThis.fetch;
  const updateUrl = normalizeHttpsUrl(
    Object.prototype.hasOwnProperty.call(deps, 'updateUrl')
      ? deps.updateUrl
      : NPM_UPDATE_METADATA_URL
  );
  const startupDelayMs = Number.isFinite(Number(deps.startupDelayMs))
    ? Math.max(0, Number(deps.startupDelayMs))
    : DEFAULT_STARTUP_DELAY_MS;
  const requestTimeoutMs = Number.isFinite(Number(deps.requestTimeoutMs))
    ? Math.max(1000, Number(deps.requestTimeoutMs))
    : DEFAULT_REQUEST_TIMEOUT_MS;
  const allowDevelopment = deps.allowDevelopment === true;
  const platform = deps.platform || process.platform;
  const execPath = deps.execPath || process.execPath;
  const fs = deps.fs || nodeFs;
  const spawn = deps.spawn || childProcess.spawn;
  const execFileSync = deps.execFileSync || childProcess.execFileSync;
  const resolveNode = deps.resolveNode || (() => resolveCodexNodeBinary('', process.env));

  let startupTimer = null;
  let activeAbortController = null;
  let checkPromise = null;
  let buildProcess = null;
  let status = {
    configured: Boolean(updateUrl),
    status: updateUrl ? 'idle' : 'not-configured',
    currentVersion: normalizeVersion(
      typeof app.getVersion === 'function' ? app.getVersion() : ''
    ),
    latestVersion: '',
    releaseUrl: '',
    checkedAt: '',
    error: ''
  };

  function updateStatus(next = {}) {
    status = {
      ...status,
      ...next
    };
    return getStatus();
  }

  function getStatus() {
    return { ...status };
  }

  function isPackagedBuild() {
    return app.isPackaged === true || allowDevelopment;
  }

  async function fetchMetadata() {
    if (typeof fetchImpl !== 'function') {
      throw new Error('Fetch is unavailable in this Electron runtime.');
    }
    activeAbortController = new AbortController();
    const timeout = setTimeout(() => activeAbortController?.abort(), requestTimeoutMs);
    timeout.unref?.();
    try {
      const response = await fetchImpl(updateUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.npm.install-v1+json, application/json'
        },
        redirect: 'follow',
        signal: activeAbortController.signal
      });
      if (!response?.ok) {
        throw new Error(`NPM update request failed with HTTP ${response?.status || 'unknown'}.`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
      activeAbortController = null;
    }
  }

  function showMessage(options) {
    const mainWindow = getMainWindow();
    return mainWindow && !mainWindow.isDestroyed?.()
      ? dialog.showMessageBox(mainWindow, options)
      : dialog.showMessageBox(options);
  }

  // Runs the published installer build (`npx @hinashirosaki/hikari@<version>`)
  // in a temp dir and returns the built installer path.
  async function buildUpdate(release) {
    const node = resolveNode();
    if (!node) {
      throw new Error('Node.js 20+ was not found. Install Node.js (or run the Hikari install script), then try again.');
    }
    const tempDir = typeof app.getPath === 'function' ? app.getPath('temp') : os.tmpdir();
    // ponytail: the build dir (deps + old bundle) is left for the OS temp cleaner.
    const buildDir = fs.mkdtempSync(path.join(tempDir, 'hikari-update-'));
    const logPath = path.join(buildDir, 'update.log');
    const logFd = fs.openSync(logPath, 'a');
    const { command, args } = resolveNpxInvocation(node, platform);
    const env = { ...process.env };
    // Desktop launches have a minimal PATH; npx's `#!/usr/bin/env node` needs this Node.
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
    env[pathKey] = `${path.dirname(node)}${path.delimiter}${env[pathKey] || ''}`;
    try {
      await new Promise((resolve, reject) => {
        buildProcess = spawn(command, [...args, '--yes', `${NPM_PACKAGE_NAME}@${release.version}`], {
          cwd: buildDir,
          env,
          stdio: ['ignore', logFd, logFd]
        });
        buildProcess.on('error', reject);
        buildProcess.on('exit', (code, signal) => {
          buildProcess = null;
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`The Hikari build exited with ${signal || code}. Log: ${logPath}`));
          }
        });
      });
    } finally {
      fs.closeSync(logFd);
    }
    const installer = findInstaller(path.join(buildDir, 'hikari-out', 'make'), platform, fs);
    if (!installer) {
      throw new Error(`The Hikari build produced no installer. Log: ${logPath}`);
    }
    return installer;
  }

  // Everything that can fail happens here, while the app is still running and
  // can show an error; applyUpdate() at quit time only renames.
  function prepareUpdate(installer) {
    if (platform !== 'darwin') {
      return installer;
    }
    const extractDir = path.join(path.dirname(installer), 'extracted');
    // ditto keeps the framework symlinks and code signature; Node zip libraries don't.
    execFileSync('ditto', ['-x', '-k', installer, extractDir]);
    const bundle = fs.readdirSync(extractDir).find((name) => name.endsWith('.app'));
    if (!bundle) {
      throw new Error(`No .app bundle inside ${installer}.`);
    }
    return path.join(extractDir, bundle);
  }

  function applyUpdate(prepared) {
    if (platform === 'win32') {
      // Squirrel installs to %LocalAppData%\\hikari and launches the new version itself.
      spawn(prepared, [], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    // Hikari.app/Contents/MacOS/Hikari -> Hikari.app
    const appBundle = path.resolve(execPath, '..', '..', '..');
    if (!appBundle.endsWith('.app')) {
      throw new Error(`${execPath} is not inside an app bundle.`);
    }
    // ponytail: rename swap only (same volume as temp); an app on another volume
    // gets the error dialog with the built bundle path for a manual install.
    const parked = path.join(path.dirname(prepared), `${path.basename(appBundle)}.previous`);
    fs.renameSync(appBundle, parked);
    try {
      fs.renameSync(prepared, appBundle);
    } catch (error) {
      fs.renameSync(parked, appBundle);
      throw error;
    }
  }

  async function installUpdate(release) {
    updateStatus({ status: 'installing', error: '' });
    void showMessage({
      type: 'info',
      title: 'Updating Hikari',
      message: `Hikari ${release.version} is downloading and building in the background.`,
      detail: 'This takes a few minutes. You can keep working; Hikari will ask before restarting.',
      buttons: ['OK'],
      noLink: true
    });
    let prepared;
    try {
      prepared = prepareUpdate(await buildUpdate(release));
    } catch (error) {
      const message = String(error?.message || error);
      updateStatus({ status: 'error', error: message });
      dialog.showErrorBox?.('Hikari update failed', message);
      return 'install-failed';
    }
    updateStatus({ status: 'ready', error: '' });

    if (platform === 'linux') {
      const result = await showMessage({
        type: 'info',
        title: 'Hikari Update Built',
        message: `Hikari ${release.version} was built.`,
        detail: `Install ${path.basename(prepared)} with your package manager to finish the update.`,
        buttons: ['Show File', 'Close'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (result?.response === 0) {
        shell?.showItemInFolder?.(prepared);
      }
      return 'built';
    }

    app.once('will-quit', () => {
      try {
        applyUpdate(prepared);
      } catch (error) {
        dialog.showErrorBox?.('Hikari update failed', `${error?.message || error}\nThe built app is at ${prepared}.`);
      }
    });
    const result = await showMessage({
      type: 'info',
      title: 'Hikari Update Ready',
      message: `Hikari ${release.version} is ready.`,
      detail: 'Restart Hikari to finish the update. If you restart later, the update is applied when Hikari quits.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (result?.response !== 0) {
      return 'apply-on-quit';
    }
    if (platform === 'darwin') {
      app.relaunch();
    }
    app.quit();
    return 'restarting';
  }

  async function promptForUpdate(release) {
    if (!dialog || typeof dialog.showMessageBox !== 'function') {
      return 'notification-unavailable';
    }
    const result = await showMessage({
      type: 'info',
      title: 'Hikari Update Available',
      message: `Hikari ${release.version} is available.`,
      detail: release.releaseNotes || `You are currently using Hikari ${status.currentVersion}.`,
      buttons: ['Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (result?.response !== 0) {
      return 'dismissed';
    }
    return installUpdate(release);
  }

  async function runUpdateCheck(options = {}) {
    if (!updateUrl) {
      return updateStatus({
        configured: false,
        status: 'not-configured',
        error: ''
      });
    }
    if (!isPackagedBuild()) {
      return updateStatus({
        status: 'development-disabled',
        error: ''
      });
    }

    updateStatus({
      status: 'checking',
      error: ''
    });

    try {
      const metadata = await fetchMetadata();
      const release = resolveNpmReleaseMetadata(metadata);
      const comparison = compareSemver(release.version, status.currentVersion);
      if (!release.version || comparison === null) {
        throw new Error('NPM update metadata did not contain a valid semantic version.');
      }

      const checkedAt = new Date().toISOString();
      if (comparison <= 0) {
        return updateStatus({
          status: 'up-to-date',
          latestVersion: release.version,
          releaseUrl: release.releaseUrl,
          checkedAt,
          error: ''
        });
      }

      updateStatus({
        status: 'update-available',
        latestVersion: release.version,
        releaseUrl: release.releaseUrl || updateUrl,
        checkedAt,
        error: ''
      });
      const action = options.prompt === false ? 'not-prompted' : await promptForUpdate(release);
      return {
        ...getStatus(),
        action
      };
    } catch (error) {
      return updateStatus({
        status: 'error',
        checkedAt: new Date().toISOString(),
        error: String(error?.message || error || 'NPM update check failed.')
      });
    }
  }

  function checkForUpdates(options = {}) {
    if (checkPromise) {
      return checkPromise;
    }
    checkPromise = runUpdateCheck(options);
    return checkPromise.finally(() => {
      checkPromise = null;
    });
  }

  function start() {
    if (!updateUrl) {
      return updateStatus({
        configured: false,
        status: 'not-configured',
        error: ''
      });
    }
    if (!isPackagedBuild()) {
      return updateStatus({
        status: 'development-disabled',
        error: ''
      });
    }
    if (startupTimer) {
      return getStatus();
    }
    updateStatus({
      status: 'scheduled',
      error: ''
    });
    startupTimer = setTimeout(() => {
      startupTimer = null;
      void checkForUpdates();
    }, startupDelayMs);
    startupTimer.unref?.();
    return getStatus();
  }

  function stop() {
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = null;
    }
    activeAbortController?.abort();
    activeAbortController = null;
    buildProcess?.kill();
    return updateStatus({
      status: 'stopped'
    });
  }

  return {
    checkForUpdates,
    getStatus,
    start,
    stop
  };
}

module.exports = {
  NPM_PACKAGE_NAME,
  NPM_UPDATE_METADATA_URL,
  compareSemver,
  createNpmUpdaterService,
  findInstaller,
  resolveNpmReleaseMetadata,
  resolveNpxInvocation
};
