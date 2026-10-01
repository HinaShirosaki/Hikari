'use strict';

const childProcess = require('node:child_process');
const nodeFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveCodexNodeBinary } = require('../lib/codex-cli-provider/cli-discovery');

const NPM_PACKAGE_NAME = '@hinashirosaki/hikari';
const DEFAULT_STARTUP_DELAY_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

// Registry metadata for the published package (scoped name, so the '/' is encoded).
const NPM_UPDATE_METADATA_URL = 'https://registry.npmjs.org/@hinashirosaki%2fhikari';

const { compareSemver, normalizeVersion, satisfiesRange } = require('./version.js');
const { normalizeHttpsUrl, resolveNpmReleaseMetadata } = require('./release-metadata.js');
const { PORTABLE_WIN32_TARGET, findBuild, resolveNpmInvocation, resolveNpxInvocation } = require('./installer.js');
const { MANIFEST_FILE, getAppCodeRoot, getLoadedAppCode, listAppCode } = require('./app-code.js');

// The npm package is source that `npx @hinashirosaki/hikari` builds into a native
// installer on this machine (bin/hikari.js). There are no hosted binaries and the
// app is ad-hoc signed, so Electron's autoUpdater (Squirrel) is not an option.
// A release that runs on this build's Electron is installed app-only: npm fetches
// its files into <userData>/app-code and the next start runs them (app-code.js).
// Otherwise the in-app update runs the full build and swaps the result in.
// Flow: one "Update / Later" question; Update installs in the background, then
// restarts. The quit goes through the window's unsaved-changes check.
function createNpmUpdaterService(deps = {}) {
  const app = deps.app || {};
  const dialog = deps.dialog || null;
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
  const pid = deps.pid || process.pid;
  const resolveNode = deps.resolveNode || (() => resolveCodexNodeBinary('', process.env));
  const electronVersion = Object.prototype.hasOwnProperty.call(deps, 'electronVersion')
    ? deps.electronVersion
    : process.versions.electron;
  const getLoaded = deps.getLoadedAppCode || getLoadedAppCode;
  const warn = deps.warn || console.warn;

  let startupTimer = null;
  let activeAbortController = null;
  let checkPromise = null;
  let buildProcess = null;
  let pendingRelease = null;
  let installPromise = null;
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

  function requireNode() {
    const node = resolveNode();
    if (!node) {
      throw new Error('Node.js 20+ was not found. Install Node.js (or run the Hikari install script), then try again.');
    }
    return node;
  }

  // Desktop launches have a minimal PATH; npm's `#!/usr/bin/env node` needs this Node.
  function nodeEnv(node) {
    const env = { ...process.env };
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
    env[pathKey] = `${path.dirname(node)}${path.delimiter}${env[pathKey] || ''}`;
    return env;
  }

  // Runs one update step with its output appended to update.log; stop() kills it.
  async function runLogged(what, command, args, { cwd, env, logPath }) {
    const logFd = fs.openSync(logPath, 'a');
    try {
      await new Promise((resolve, reject) => {
        buildProcess = spawn(command, args, {
          cwd,
          env,
          stdio: ['ignore', logFd, logFd],
          // Windows: without this, the background build opens a console window
          // (closing it kills the update); npm's own children inherit the hidden one.
          windowsHide: true
        });
        buildProcess.on('error', reject);
        buildProcess.on('exit', (code, signal) => {
          buildProcess = null;
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`${what} exited with ${signal || code}. Log: ${logPath}`));
          }
        });
      });
    } finally {
      fs.closeSync(logFd);
    }
  }

  function canInstallAppCode(release) {
    return satisfiesRange(electronVersion, release.electronRange);
  }

  // App-only update: npm installs the release's files and runtime dependencies
  // (no Electron, Forge or packaging), its UI is built in place, and main.js runs
  // it from the next start. The folder is renamed into place only when complete.
  async function installAppCode(release) {
    const node = requireNode();
    const root = getAppCodeRoot(app);
    fs.mkdirSync(root, { recursive: true });
    for (const name of fs.readdirSync(root)) {
      // An earlier install that did not finish.
      if (name.startsWith('.')) await fs.promises.rm(path.join(root, name), { recursive: true, force: true });
    }
    const staging = fs.mkdtempSync(path.join(root, '.install-'));
    const logPath = path.join(staging, 'update.log');
    const env = nodeEnv(node);
    const npm = resolveNpmInvocation(node, platform);
    await runLogged('Installing Hikari', npm.command, [
      ...npm.args, 'install', `${NPM_PACKAGE_NAME}@${release.version}`, '--prefix', staging,
      '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'
    ], { cwd: staging, env, logPath });
    const appDir = path.join(staging, 'node_modules', ...NPM_PACKAGE_NAME.split('/'));
    await runLogged('Building the Hikari UI', node, [path.join(appDir, 'scripts', 'build-ui.mjs')],
      { cwd: appDir, env, logPath });
    // What npm actually installed decides, not the registry's summary.
    const installed = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
    const electron = String(installed.devDependencies?.electron || '');
    if (installed.version !== release.version || !satisfiesRange(electronVersion, electron)) {
      throw new Error(`npm installed Hikari ${installed.version} for Electron ${electron || 'unknown'}; `
        + `expected ${release.version} for Electron ${electronVersion}. Log: ${logPath}`);
    }
    fs.writeFileSync(path.join(staging, MANIFEST_FILE), JSON.stringify({
      version: installed.version,
      electron,
      entry: path.relative(staging, path.join(appDir, installed.main || 'src/main/main.js'))
    }, null, 2));
    const target = path.join(root, installed.version);
    await fs.promises.rm(target, { recursive: true, force: true });
    // Windows: a virus scan of the new files can block the rename for a moment.
    for (let attempt = 1; ; attempt += 1) {
      try {
        fs.renameSync(staging, target);
        return;
      } catch (error) {
        if (attempt === 20) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  // Copies that will not run again: not newer than what runs now. Best effort.
  async function pruneAppCode() {
    const running = getLoaded()?.dir;
    for (const copy of listAppCode(getAppCodeRoot(app), fs)) {
      if (copy.dir !== running && compareSemver(copy.version, status.currentVersion) <= 0) {
        await fs.promises.rm(copy.dir, { recursive: true, force: true });
      }
    }
  }

  // Runs the published installer build (`npx @hinashirosaki/hikari@<version>`)
  // in a temp dir and returns the built Hikari.app (macOS) or HikariSetup.exe (Windows).
  async function buildUpdate(release) {
    const node = requireNode();
    const tempDir = typeof app.getPath === 'function' ? app.getPath('temp') : os.tmpdir();
    // ponytail: the build dir (deps + old bundle) is left for the OS temp cleaner.
    const buildDir = fs.mkdtempSync(path.join(tempDir, 'hikari-update-'));
    const logPath = path.join(buildDir, 'update.log');
    const { command, args } = resolveNpxInvocation(node, platform);
    await runLogged('The Hikari build', command, [...args, '--yes', `${NPM_PACKAGE_NAME}@${release.version}`],
      { cwd: buildDir, env: nodeEnv(node), logPath });
    const target = platform === 'win32' && !isSquirrelInstall() ? PORTABLE_WIN32_TARGET : undefined;
    const build = findBuild(path.join(buildDir, 'hikari-out'), platform, fs, target);
    if (!build) {
      throw new Error(`The Hikari build produced no app. Log: ${logPath}`);
    }
    return build;
  }

  // Setup.exe installs keep Update.exe beside the app-<version> folder
  // (%LocalAppData%\\hikari); anything else is a portable copy.
  function isSquirrelInstall() {
    return fs.existsSync(path.join(path.dirname(path.dirname(execPath)), 'Update.exe'));
  }

  // The app updates where it is, whatever folder or drive that is.
  function applyUpdate(prepared) {
    if (platform === 'win32') {
      if (isSquirrelInstall()) {
        // Squirrel installs to %LocalAppData%\\hikari and launches the new version itself.
        spawn(prepared, [], { detached: true, stdio: 'ignore' }).unref();
        return;
      }
      // Portable copy: the new build's Hikari.exe swaps itself in once this one
      // has exited (finish-portable-update.js; Windows locks a running app's files).
      spawn(prepared, [`--hikari-swap-into=${path.dirname(execPath)}`, `--hikari-swap-after=${pid}`],
        { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    // Hikari.app/Contents/MacOS/Hikari -> Hikari.app
    const appBundle = path.resolve(execPath, '..', '..', '..');
    if (!appBundle.endsWith('.app')) {
      throw new Error(`${execPath} is not inside an app bundle.`);
    }
    // Parked beside the app, so this rename works on any drive.
    const parked = `${appBundle}.previous`;
    fs.rmSync(parked, { recursive: true, force: true });
    fs.renameSync(appBundle, parked);
    try {
      try {
        fs.renameSync(prepared, appBundle);
      } catch (error) {
        if (error?.code !== 'EXDEV') throw error;
        // The app is on another drive than the build: copy. ditto keeps the
        // bundle's symlinks, modes and code signature.
        execFileSync('ditto', [prepared, appBundle]);
      }
    } catch (error) {
      fs.rmSync(appBundle, { recursive: true, force: true });
      fs.renameSync(parked, appBundle);
      throw error;
    }
    fs.rmSync(parked, { recursive: true, force: true });
  }

  // One install at a time: the startup dialog and Settings > Updates share it.
  function installUpdate(release) {
    installPromise ||= runInstall(release).finally(() => { installPromise = null; });
    return installPromise;
  }

  async function runInstall(release) {
    if (canInstallAppCode(release)) {
      updateStatus({ status: 'installing', installKind: 'app', error: '' });
      try {
        await installAppCode(release);
        updateStatus({ status: 'ready', error: '' });
        // ponytail: if the user cancels the unsaved-changes prompt, the relaunch
        // stays armed and happens on their next quit.
        app.relaunch();
        app.quit();
        return 'restarting';
      } catch (error) {
        warn(`App-only update to Hikari ${release.version} failed; rebuilding the whole app instead.`, error);
      }
    }
    updateStatus({ status: 'installing', installKind: 'full', error: '' });
    let prepared;
    try {
      prepared = await buildUpdate(release);
    } catch (error) {
      const message = String(error?.message || error);
      updateStatus({ status: 'error', error: message });
      dialog.showErrorBox?.('Hikari update failed', message);
      return 'install-failed';
    }
    updateStatus({ status: 'ready', error: '' });

    app.once('will-quit', () => {
      try {
        applyUpdate(prepared);
      } catch (error) {
        dialog.showErrorBox?.('Hikari update failed', `${error?.message || error}\nThe built app is at ${prepared}.`);
      }
    });
    // Windows: HikariSetup.exe launches the new version itself once it has installed.
    // ponytail: if the user cancels the unsaved-changes prompt, the relaunch and
    // the swap stay armed and happen on their next quit.
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
      detail: [
        release.releaseNotes || `You are using Hikari ${status.currentVersion}.`,
        `Update downloads and installs it in the background (${canInstallAppCode(release) ? 'under a minute' : 'a few minutes'}; you can keep working), then restarts Hikari.`
      ].join('\n\n'),
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
      pendingRelease = comparison > 0 ? release : null;
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
    if (installPromise) {
      return Promise.resolve(getStatus());
    }
    if (checkPromise) {
      return checkPromise;
    }
    checkPromise = runUpdateCheck(options);
    return checkPromise.finally(() => {
      checkPromise = null;
    });
  }

  // Settings > Updates "Install Update": installs what the last check found.
  async function installAvailableUpdate() {
    if (!installPromise && (status.status !== 'update-available' || !pendingRelease)) {
      return { ...getStatus(), action: 'no-update' };
    }
    const action = await installUpdate(pendingRelease);
    return { ...getStatus(), action };
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
      void pruneAppCode().catch((error) => warn('Could not remove old Hikari app code:', error));
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
    installUpdate: installAvailableUpdate,
    start,
    stop
  };
}

module.exports = {
  NPM_PACKAGE_NAME,
  NPM_UPDATE_METADATA_URL,
  compareSemver,
  createNpmUpdaterService,
  findBuild,
  resolveNpmReleaseMetadata,
  resolveNpxInvocation
};
