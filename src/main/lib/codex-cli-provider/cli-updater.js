'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { codexStandaloneRoot, codexInstallDirectory, codexReleaseTarget, compareCodexVersions, readCodexManagedInstall } = require('./cli-managed');
const { downloadCodexRelease, fetchCodexRelease, readCodexVersion, resolveCodexRelease } = require('./cli-update-download');
const { runNativeCodexUpdate, isNativeUpdateUnsupported } = require('./cli-native-update');
const { prepareStandaloneLinks, replaceSelection } = require('./cli-standalone-layout');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 5 * 60 * 1000;

function createCodexCliUpdater(deps = {}) {
  const env = deps.env || process.env;
  const platform = deps.platform || process.platform;
  const target = codexReleaseTarget(platform, deps.arch || process.arch);
  const root = codexStandaloneRoot(env, { platform });
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const installRelease = deps.installRelease || downloadCodexRelease;
  const readVersion = deps.readVersion || readCodexVersion;
  const updateNative = deps.updateNative || runNativeCodexUpdate;
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
    status = { ...status, status: 'checking', error: '' };
    let timeout = setTimeout(() => controller?.abort(), 15000);
    timeout.unref?.();
    try {
      const previous = readCodexManagedInstall(env, installOptions);
      // Not on Windows: Codex's install.ps1 always prepends the install
      // directory to the user's persistent PATH, exposing Hikari's private CLI.
      if (previous?.method === 'standalone' && platform !== 'win32') {
        clearTimeout(timeout);
        status.status = 'updating';
        timeout = setTimeout(() => controller?.abort(), 5 * 60 * 1000);
        timeout.unref?.();
        try {
          // Codex owns release discovery, verification, download and switching.
          await updateNative(previous.binary, { env, platform, signal });
          if (stopped || signal.aborted) throw new Error('Codex update stopped.');
          const selected = readCodexManagedInstall(env, installOptions);
          if (!selected || compareCodexVersions(selected.version, previous.version) < 0
            || await readVersion(selected.binary, { env, signal }) !== selected.version) {
            throw new Error('Codex update did not leave a runnable selected release.');
          }
          status = { ...status, status: 'up-to-date', latestVersion: selected.version, checkedAt: new Date(now()).toISOString() };
          if (selected.binary !== previous.binary || selected.version !== previous.version) deps.onUpdated?.(getStatus());
          return getStatus();
        } catch (error) {
          // A failed native switch must not make new requests lose a working CLI.
          await replaceSelection(root, path.dirname(path.dirname(previous.binary)), platform);
          await fs.writeFile(path.join(root, 'auto-update-version'), `${previous.version}-${target}`);
          if (!isNativeUpdateUnsupported(error)) throw error;
          // A pre-self-update CLI is bootstrapped once, then updates natively.
        }
      }
      // First install, Windows updates, and existing Hikari releases that
      // predate Codex's standalone layout (kept intact while adopting it).
      const metadata = await fetchCodexRelease(fetchImpl, signal);
      clearTimeout(timeout);
      const release = resolveCodexRelease(metadata, target);
      status = { ...status, latestVersion: release.version, checkedAt: new Date(now()).toISOString() };
      const installed = readCodexManagedInstall(env, installOptions);
      const reuse = installed && compareCodexVersions(installed.version, release.version) >= 0
        && await readVersion(installed.binary, { env, signal }) === installed.version;
      if (reuse && installed.method === 'standalone') {
        status.status = 'up-to-date';
        return getStatus();
      }
      const selectedVersion = reuse ? installed.version : release.version;
      status.status = 'updating';
      timeout = setTimeout(() => controller?.abort(), 5 * 60 * 1000);
      timeout.unref?.();
      await fs.mkdir(path.join(root, 'releases'), { recursive: true });
      staging = await fs.mkdtemp(path.join(root, '.staging-'));
      let packageDir;
      if (reuse) {
        packageDir = path.join(staging, 'package');
        await fs.cp(path.dirname(path.dirname(installed.binary)), packageDir, { recursive: true, mode: constants.COPYFILE_FICLONE });
      } else packageDir = await installRelease(release, staging, { fetchImpl, env, platform, signal });
      const executable = platform === 'win32' ? 'codex.exe' : 'codex';
      if (await readVersion(path.join(packageDir, 'bin', executable), { env, signal }) !== selectedVersion) {
        throw new Error('The downloaded Codex CLI did not report the expected version.');
      }
      if (stopped || signal.aborted) throw new Error('Codex update stopped.');
      const destination = path.join(root, 'releases', `${selectedVersion}-${target}`);
      try {
        await fs.rename(packageDir, destination);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)
          || await readVersion(path.join(destination, 'bin', executable), { env, signal }).catch(() => '') !== selectedVersion) {
          throw error;
        }
      }
      await prepareStandaloneLinks(root, destination, codexInstallDirectory(env, { platform }), platform);
      if (stopped || signal.aborted) throw new Error('Codex update stopped.');
      await fs.writeFile(path.join(root, 'auto-update-version'), `${selectedVersion}-${target}`);
      await replaceSelection(root, destination, platform);
      status.status = 'up-to-date';
      deps.onUpdated?.(getStatus());
    } catch (error) {
      status = { ...status, status: 'error', error: String(error?.message || error).slice(0, 400) };
    } finally {
      clearTimeout(timeout);
      controller = null;
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
