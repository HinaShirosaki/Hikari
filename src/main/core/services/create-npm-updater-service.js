'use strict';

const DEFAULT_STARTUP_DELAY_MS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  REQUIRED BEFORE NPM UPDATES CAN RUN                                    ║
// ║                                                                          ║
// ║  PASTE THE EXACT NPM REGISTRY METADATA URL BETWEEN THE QUOTES BELOW.     ║
// ║  Expected shape: https://registry.npmjs.org/<package-name>               ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const NPM_UPDATE_METADATA_URL = '';

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
  const releaseUrl = normalizeHttpsUrl(
    release.dist?.tarball
      || source.dist?.tarball
      || release.homepage
      || source.homepage
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

  let startupTimer = null;
  let activeAbortController = null;
  let checkPromise = null;
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

  async function promptForUpdate(release) {
    const targetUrl = release.releaseUrl || updateUrl;
    if (!dialog || typeof dialog.showMessageBox !== 'function') {
      return 'notification-unavailable';
    }
    const messageBoxOptions = {
      type: 'info',
      title: 'Hikari Update Available',
      message: `Hikari ${release.version} is available.`,
      detail: release.releaseNotes || `You are currently using Hikari ${status.currentVersion}.`,
      buttons: ['Open Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    };
    const mainWindow = getMainWindow();
    const result = mainWindow && !mainWindow.isDestroyed?.()
      ? await dialog.showMessageBox(mainWindow, messageBoxOptions)
      : await dialog.showMessageBox(messageBoxOptions);
    if (result?.response !== 0) {
      return 'dismissed';
    }
    if (!targetUrl || !shell || typeof shell.openExternal !== 'function') {
      return 'open-unavailable';
    }
    await shell.openExternal(targetUrl);
    return 'opened';
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
  NPM_UPDATE_METADATA_URL,
  compareSemver,
  createNpmUpdaterService,
  resolveNpmReleaseMetadata
};
