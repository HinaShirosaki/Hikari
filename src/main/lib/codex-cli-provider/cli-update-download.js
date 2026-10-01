'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const exec = promisify(execFile);
const RELEASES_URL = 'https://releases.openai.com/codex';

async function fetchCodexRelease(fetchImpl, signal) {
  const response = await fetchImpl(`${RELEASES_URL}/channels/latest`, {
    headers: { Accept: 'application/json' }, signal
  });
  if (!response.ok) throw new Error(`Codex release check failed (HTTP ${response.status}).`);
  return response.json();
}

function resolveCodexRelease(metadata, target) {
  const version = String(metadata?.tag_name || '').replace(/^rust-v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Codex did not publish a valid stable release.');
  const name = `codex-package-${target}.tar.gz`;
  const asset = metadata?.assets?.find((entry) => entry.name === name);
  const digest = /^sha256:([a-f\d]{64})$/i.exec(String(asset?.digest || ''))?.[1];
  if (!digest) throw new Error(`Codex has no verified package for ${target}.`);
  return { version, target, digest: digest.toLowerCase(), url: `${RELEASES_URL}/releases/${version}/${name}` };
}

async function readCodexVersion(binary, { env, signal } = {}) {
  const { stdout } = await exec(binary, ['--version'], { env, signal, timeout: 10000, windowsHide: true });
  return /^codex-cli\s+(\d+\.\d+\.\d+(?:-[\w.-]+)?)/m.exec(stdout)?.[1] || '';
}

async function downloadCodexRelease(release, directory, { fetchImpl, env, platform, signal }) {
  const archive = path.join(directory, 'codex.tar.gz');
  const packageDir = path.join(directory, 'package');
  const response = await fetchImpl(release.url, { signal });
  if (!response.ok || !response.body) throw new Error(`Codex download failed (HTTP ${response.status}).`);
  const hash = crypto.createHash('sha256');
  const digestStream = new Transform({ transform(chunk, _encoding, callback) {
    hash.update(chunk);
    callback(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), digestStream, fs.createWriteStream(archive), { signal });
  if (hash.digest('hex') !== release.digest) throw new Error('Codex download checksum did not match its release.');
  await fs.promises.mkdir(packageDir);
  const tar = platform === 'win32'
    ? path.win32.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'tar.exe')
    : '/usr/bin/tar';
  await exec(tar, ['-xzf', archive, '-C', packageDir], { signal, timeout: 60000, windowsHide: true });
  if (platform !== 'win32') {
    for (const relative of ['bin/codex', 'bin/codex-code-mode-host', 'codex-path/rg']) {
      await fs.promises.chmod(path.join(packageDir, relative), 0o755);
    }
  }
  return packageDir;
}

module.exports = { downloadCodexRelease, fetchCodexRelease, readCodexVersion, resolveCodexRelease };
