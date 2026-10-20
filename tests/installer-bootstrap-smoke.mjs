// Real download + source build with no Node/npm/npx on the installer's PATH.
// Run with a locally packed branch tarball; does not install or launch the app.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tarball = path.resolve(process.argv[2] || process.env.HIKARI_SMOKE_TARBALL);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-bootstrap-smoke-'));
try {
  fs.copyFileSync(tarball, path.join(tmp, 'hikari.tgz'));
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^path$|^psmodulepath$|^hikari_|^npm_config_cache$/i.test(key)));
  const bins = process.platform === 'win32' ? ['node.exe', 'npm.cmd', 'npx.cmd'] : ['node', 'npm', 'npx'];
  env.PATH = (process.env.PATH || process.env.Path).split(path.delimiter)
    .filter((directory) => directory && !bins.some((bin) => fs.existsSync(path.join(directory, bin))))
    .join(path.delimiter);
  Object.assign(env, {
    HIKARI_VERSION: version, HIKARI_BUILD_FROM_SOURCE: '1', HIKARI_PACKAGE_SPEC: './hikari.tgz',
    HIKARI_NODE_DIR: path.join(tmp, 'private-node'), HIKARI_OUT_DIR: path.join(tmp, 'output'),
    npm_config_cache: path.join(tmp, 'npm-cache')
  });
  const probe = process.platform === 'win32'
    ? spawnSync('where.exe', ['node'], { env }) : spawnSync('/usr/bin/which', ['node'], { env });
  assert.notEqual(probe.status, 0, 'Node must be absent from the bootstrap PATH');
  const command = process.platform === 'win32'
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/bash';
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'install.ps1')]
    : [path.join(root, 'install.sh')];
  const run = () => {
    const result = spawnSync(command, args, { cwd: tmp, env, stdio: 'inherit', timeout: 30 * 60_000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Fresh-computer bootstrap must succeed');
    const target = process.platform === 'darwin' ? 'Hikari.app/Contents/Info.plist' : 'Hikari/Hikari.exe';
    assert.ok(fs.statSync(path.join(env.HIKARI_OUT_DIR, `Hikari-${process.platform}-${process.arch}`, target)).size);
  };
  // A node executable without npm/npx simulates an interrupted earlier install.
  fs.mkdirSync(env.HIKARI_NODE_DIR);
  const nodeDestination = process.platform === 'darwin' ? 'bin/node' : 'node.exe';
  fs.mkdirSync(path.dirname(path.join(env.HIKARI_NODE_DIR, nodeDestination)), { recursive: true });
  // Homebrew's Node uses dylibs relative to its real location; a symlink keeps
  // the executable valid while npm/npx are intentionally absent from the cache.
  if (process.platform === 'darwin') fs.symlinkSync(process.execPath, path.join(env.HIKARI_NODE_DIR, nodeDestination));
  else fs.copyFileSync(process.execPath, path.join(env.HIKARI_NODE_DIR, nodeDestination));
  run();
  const cachedNode = path.join(env.HIKARI_NODE_DIR, nodeDestination);
  assert.equal(spawnSync(cachedNode, ['--version'], { encoding: 'utf8' }).status, 0);
  const { createReleaseAssets } = createRequire(import.meta.url)('../bin/release-assets.js');
  const archive = createReleaseAssets({ root, outputRoot: env.HIKARI_OUT_DIR });
  const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  assert.ok(fs.readFileSync(`${archive}.sha256`, 'utf8').startsWith(`${digest}  `));
  // Feed the real archive through the actual prebuilt installer, replacing only
  // transport so a branch test never needs a public GitHub release.
  const transport = path.join(tmp, 'transport');
  fs.mkdirSync(transport);
  const downloader = path.join(root, 'tests/support/installer-download-fixture.js');
  const fixture = path.join(tmp, 'prebuilt-fixture.json');
  fs.writeFileSync(fixture, JSON.stringify({ version, asset: path.basename(archive), assetFile: archive,
    assetSha: digest, prebuilt: true, requests: path.join(tmp, 'prebuilt-requests') }));
  const prebuiltEnv = { ...env, HIKARI_BUILD_FROM_SOURCE: '0', HIKARI_OUT_DIR: path.join(tmp, 'prebuilt'),
    HIKARI_NODE_DIR: path.join(tmp, 'unused-node'), HIKARI_TEST_FIXTURE: fixture,
    HIKARI_TEST_NODE: process.execPath, HIKARI_TEST_DOWNLOADER: downloader, HIKARI_TEST_INSTALLER: path.join(root, 'install.ps1') };
  let prebuiltArgs = args;
  if (process.platform === 'darwin') {
    fs.writeFileSync(path.join(transport, 'curl'), `#!${process.execPath}\nrequire(${JSON.stringify(downloader)});`, { mode: 0o755 });
    prebuiltEnv.PATH = `${transport}${path.delimiter}${env.PATH}`;
  } else {
    const driver = path.join(transport, 'driver.ps1');
    fs.writeFileSync(driver, `function Invoke-WebRequest { param([switch]$UseBasicParsing, [int]$TimeoutSec, [string]$Uri, [string]$OutFile)\n & $env:HIKARI_TEST_NODE $env:HIKARI_TEST_DOWNLOADER $Uri $OutFile\n if ($LASTEXITCODE -ne 0) { throw 'Fixture download failed' }\n}\nfunction Start-Sleep {}\n& $env:HIKARI_TEST_INSTALLER\n`);
    prebuiltArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', driver];
  }
  const prebuilt = spawnSync(command, prebuiltArgs, { cwd: tmp, env: prebuiltEnv, stdio: 'inherit', timeout: 5 * 60_000 });
  if (prebuilt.error) throw prebuilt.error;
  assert.equal(prebuilt.status, 0, 'The real release archive must install without Node');
  assert.ok(!fs.existsSync(prebuiltEnv.HIKARI_NODE_DIR));
  if (process.platform === 'darwin') {
    const app = path.join(prebuiltEnv.HIKARI_OUT_DIR, `Hikari-darwin-${process.arch}`, 'Hikari.app');
    assert.equal(spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' }).status, 0);
  }
  console.log('Fresh-computer bootstrap repaired the incomplete cache and built the app.');
  console.log('The checksummed release archive installed successfully without Node.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
