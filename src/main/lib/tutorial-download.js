'use strict';

// Settings > Tutorial: the illustrated tutorials live in their own public repo.
// Nothing ships with Hikari. Download installs the repo's latest commit into
// `dir`, Check compares it with GitHub, and Open only reads the local copy, so
// the tutorial works offline once downloaded.
//
// Version = the repo commit it was downloaded from, plus that commit's date for
// display. Every push to the repo is a new version; nothing to bump by hand.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const TUTORIAL_REPO = 'HinaShirosaki/hikari-tutorial';
const VERSION_FILE = 'tutorial-version.json';

// macOS and Windows 10+ both ship bsdtar. On Windows the System32 copy is used
// so a GNU tar from Git on PATH cannot misread "C:\..." as a remote host.
function extractTarGz(archive, destination) {
  const tar = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  return new Promise((resolve, reject) => {
    const child = spawn(tar, ['-xzf', '-', '-C', destination, '--strip-components=1'], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdin.on('error', () => {}); // tar exiting early surfaces through 'close'
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `tar exited with code ${code}`))));
    child.stdin.end(archive);
  });
}

function installedVersion(dir) {
  if (!fs.existsSync(path.join(dir, 'index.html'))) return null;
  try {
    const { commit, date } = JSON.parse(fs.readFileSync(path.join(dir, VERSION_FILE), 'utf8'));
    return /^[0-9a-f]{40}$/.test(commit) ? { commit, date: String(date || '') } : null;
  } catch {
    return null;
  }
}

async function latestVersion(fetchImpl) {
  const response = await fetchImpl(`https://api.github.com/repos/${TUTORIAL_REPO}/commits?sha=main&per_page=1`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Hikari' },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const [latest] = await response.json();
  if (!/^[0-9a-f]{40}$/.test(latest?.sha || '')) throw new Error('GitHub returned no tutorial version');
  return { commit: latest.sha, date: String(latest.commit?.committer?.date || '') };
}

async function download(dir, version, fetchImpl, extract) {
  const response = await fetchImpl(`https://codeload.github.com/${TUTORIAL_REPO}/tar.gz/${version.commit}`, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const staging = `${dir}.download`;
  const previous = `${dir}.previous`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    await extract(archive, staging);
    if (!fs.existsSync(path.join(staging, 'index.html'))) throw new Error('the download has no start page');
    fs.writeFileSync(path.join(staging, VERSION_FILE), JSON.stringify(version));
    // Swap in the new copy; the old one is only removed once the new one is in place.
    fs.rmSync(previous, { recursive: true, force: true });
    if (fs.existsSync(dir)) fs.renameSync(dir, previous);
    fs.renameSync(staging, dir);
    fs.rmSync(previous, { recursive: true, force: true });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

const errorStatus = (dir, error) => ({ status: 'error', installed: installedVersion(dir), error: String(error?.message || error) });

function getTutorialStatus(dir) {
  const installed = installedVersion(dir);
  return { status: installed ? 'installed' : 'not-downloaded', installed };
}

async function checkTutorialUpdate(dir, { fetchImpl = fetch } = {}) {
  const installed = installedVersion(dir);
  try {
    const latest = await latestVersion(fetchImpl);
    if (!installed) return { status: 'not-downloaded', installed, latest };
    return { status: installed.commit === latest.commit ? 'up-to-date' : 'update-available', installed, latest };
  } catch (error) {
    return errorStatus(dir, error);
  }
}

// Download or update to GitHub's latest version. One install at a time: a
// second click waits for the first.
let inFlight = null;
function installTutorial(dir, { fetchImpl = fetch, extract = extractTarGz } = {}) {
  inFlight ||= (async () => {
    try {
      const latest = await latestVersion(fetchImpl);
      if (installedVersion(dir)?.commit !== latest.commit) await download(dir, latest, fetchImpl, extract);
      return { status: 'up-to-date', installed: installedVersion(dir), latest };
    } catch (error) {
      return errorStatus(dir, error);
    }
  })().finally(() => { inFlight = null; });
  return inFlight;
}

module.exports = { getTutorialStatus, checkTutorialUpdate, installTutorial, extractTarGz, TUTORIAL_REPO };
