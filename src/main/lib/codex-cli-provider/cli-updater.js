'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { codexManagedRoot, codexReleaseTarget, compareCodexVersions, readCodexManagedInstall } = require('./cli-managed');
const { downloadCodexRelease, fetchCodexRelease, readCodexVersion, resolveCodexRelease } = require('./cli-update-download');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 5 * 60 * 1000;

function createCodexCliUpdater(deps = {}) {
  const env = deps.env || process.env;
  const platform = deps.platform || process.platform;
  const target = codexReleaseTarget(platform, deps.arch || process.arch);
  const root = codexManagedRoot(env, { platform });
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const installRelease = deps.installRelease || downloadCodexRelease;
  const readVersion = deps.readVersion || readCodexVersion;
  const now = deps.now || Date.now;
  const intervalMs = deps.intervalMs ?? CHECK_INTERVAL_MS;
  const installOptions = { platform, arch: deps.arch || process.arch };
  let pending = null;
  let timer = null;
  let controller = null;
  let stopped = false;
  let lastAttempt = null;
  let status = { status: 'idle', currentVersion: '', latestVersion: '', error: '', checkedAt: '' };

  function getStatus() {
    const installed = readCodexManagedInstall(env, installOptions);
    return { ...status, currentVersion: installed?.version || '' };
  }

  async function check() {
    if (String(env.HIKARI_CODEX_CLI || '').trim() || String(env.HIKARI_CODEX_BIN || '').trim()) {
      status = { ...status, status: 'custom', error: '' };
      return getStatus();
    }
    if (!root || !target || stopped) return getStatus();
    lastAttempt = now();
    controller = new AbortController();
    const signal = controller.signal;
    let staging = '';
    let manifestTemp = '';
    status = { ...status, status: 'checking', error: '' };
    let timeout = setTimeout(() => controller?.abort(), 15000);
    timeout.unref?.();
    try {
      const metadata = await fetchCodexRelease(fetchImpl, signal);
      clearTimeout(timeout);
      const release = resolveCodexRelease(metadata, target);
      status = { ...status, latestVersion: release.version, checkedAt: new Date(now()).toISOString() };
      const installed = readCodexManagedInstall(env, installOptions);
      if (installed && compareCodexVersions(installed.version, release.version) >= 0
        && await readVersion(installed.binary, { env, signal }) === installed.version) {
        status.status = 'up-to-date';
        return getStatus();
      }
      status.status = 'updating';
      timeout = setTimeout(() => controller?.abort(), 5 * 60 * 1000);
      timeout.unref?.();
      await fs.mkdir(path.join(root, 'releases'), { recursive: true });
      staging = await fs.mkdtemp(path.join(root, '.staging-'));
      const packageDir = await installRelease(release, staging, { fetchImpl, env, platform, signal });
      const executable = platform === 'win32' ? 'codex.exe' : 'codex';
      if (await readVersion(path.join(packageDir, 'bin', executable), { env, signal }) !== release.version) {
        throw new Error('The downloaded Codex CLI did not report the expected version.');
      }
      if (stopped || signal.aborted) throw new Error('Codex update stopped.');
      const destination = path.join(root, 'releases', `${release.version}-${target}`);
      try {
        await fs.rename(packageDir, destination);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)
          || await readVersion(path.join(destination, 'bin', executable), { env, signal }).catch(() => '') !== release.version) {
          throw error;
        }
      }
      // Release folders are immutable: a running Windows CLI and its helpers
      // keep their files while new requests resolve the new manifest.
      const current = readCodexManagedInstall(env, installOptions);
      if (!current || compareCodexVersions(current.version, release.version) < 0) {
        manifestTemp = path.join(root, `current-${path.basename(staging)}.json`);
        await fs.writeFile(manifestTemp, JSON.stringify({ version: release.version, target }));
        if (stopped || signal.aborted) throw new Error('Codex update stopped.');
        await fs.rename(manifestTemp, path.join(root, 'current.json'));
        deps.onUpdated?.(getStatus());
      }
      status.status = 'up-to-date';
    } catch (error) {
      status = { ...status, status: 'error', error: String(error?.message || error).slice(0, 400) };
    } finally {
      clearTimeout(timeout);
      controller = null;
      if (manifestTemp) await fs.rm(manifestTemp, { force: true }).catch(() => {});
      if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
    return getStatus();
  }

  function ensureLatest({ force = false } = {}) {
    if (pending) return pending;
    const retryMs = status.status === 'error' ? RETRY_INTERVAL_MS : intervalMs;
    if (!force && lastAttempt !== null && now() - lastAttempt < retryMs) return Promise.resolve(getStatus());
    pending = check().finally(() => { pending = null; });
    return pending;
  }

  function start() {
    stopped = false;
    void ensureLatest();
    timer ||= setInterval(() => { void ensureLatest(); }, Math.min(intervalMs, RETRY_INTERVAL_MS));
    timer.unref?.();
  }

  async function stop() {
    stopped = true;
    clearInterval(timer);
    timer = null;
    controller?.abort();
    await pending;
  }

  return { ensureLatest, getStatus, start, stop };
}

module.exports = { CHECK_INTERVAL_MS, createCodexCliUpdater };
