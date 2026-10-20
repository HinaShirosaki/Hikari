'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { preparePackage, readBuildLock } = require('../bin/prepare-package');
const { buildFromSource } = require('../bin/source-build');
const { createReleaseAssets } = require('../bin/release-assets');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari installer checks '));
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
function write(file, contents, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, mode ? { mode } : undefined);
}
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

try {
  check('published build lock matches the current manifest', () => assert.ok(readBuildLock(root)));
  const source = path.join(scratch, 'source');
  const manifest = { name: '@test/hikari', version: '1.2.3', files: ['bin', 'src', '!src/README.md'], dependencies: { example: '^1.0.0' } };
  const lock = { lockfileVersion: 3, packages: { '': manifest } };
  write(path.join(source, 'package.json'), JSON.stringify(manifest));
  write(path.join(source, 'package-lock.json'), JSON.stringify(lock));
  write(path.join(source, 'src/main.js'), 'source');
  write(path.join(source, 'private-data/secret'), 'must not copy');
  write(path.join(source, 'node_modules/keep'), 'must not change');
  fs.mkdirSync(path.join(source, 'bin'));
  check('prepack publishes a lock even though npm omits package-lock.json', () => {
    preparePackage(source);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(source, 'bin/build-lock.json'))), lock);
    fs.rmSync(path.join(source, 'package-lock.json'));
    assert.deepEqual(JSON.parse(readBuildLock(source)), lock);
  });
  check('stale build lock fails before installation', () => {
    write(path.join(source, 'package.json'), JSON.stringify({ ...manifest, dependencies: { example: '^2.0.0' } }));
    assert.throws(() => readBuildLock(source), /outdated dependencies/);
    write(path.join(source, 'package.json'), JSON.stringify(manifest));
  });
  let workspace;
  check('source build uses npm ci in an isolated workspace and preserves caller output', () => {
    const commands = [];
    const output = path.join(scratch, 'caller output');
    assert.equal(buildFromSource({ root: source, tempRoot: scratch, env: { HIKARI_OUT_DIR: output }, run(command, options) {
      workspace = options.cwd;
      commands.push(command);
      assert.notEqual(workspace, source);
      assert.equal(options.env.HIKARI_OUT_DIR, output);
      assert.ok(fs.existsSync(path.join(workspace, 'package-lock.json')));
      assert.ok(fs.existsSync(path.join(workspace, 'src/main.js')));
      assert.ok(!fs.existsSync(path.join(workspace, 'private-data')));
      assert.ok(!fs.existsSync(path.join(workspace, 'node_modules')));
    } }), output);
    assert.deepEqual(commands, ['npm ci --include=dev --no-audit --no-fund --allow-git=all', 'npm run dist']);
    assert.ok(!fs.existsSync(workspace));
    assert.equal(fs.readFileSync(path.join(source, 'node_modules/keep'), 'utf8'), 'must not change');
  });
  check('failed dependency install cleans the workspace and never packages', () => {
    let calls = 0;
    assert.throws(() => buildFromSource({ root: source, tempRoot: scratch, run(_command, options) {
      workspace = options.cwd; calls++; throw new Error('network interrupted');
    } }), /network interrupted/);
    assert.equal(calls, 1);
    assert.ok(!fs.existsSync(workspace));
  });
  for (const platform of ['darwin', 'win32']) {
    check(`${platform} release asset has the expected name and checksum`, () => {
      const releaseRoot = path.join(scratch, platform);
      write(path.join(releaseRoot, 'package.json'), JSON.stringify({ version: '1.2.3' }));
      for (const name of ['Hikari.app/Contents/Info.plist', 'Hikari/Hikari.exe', 'HikariSetup.exe']) {
        write(path.join(releaseRoot, 'out', `Hikari-${platform}-x64`, name), 'fixture');
      }
      const archive = createReleaseAssets({ root: releaseRoot, outputRoot: path.join(releaseRoot, 'out'), platform, arch: 'x64', run(command, args, options) {
        assert.equal(command, platform === 'darwin' ? 'ditto' : 'powershell.exe');
        write(platform === 'darwin' ? args.at(-1) : options.env.HIKARI_ARCHIVE_DESTINATION, 'archive fixture');
      } });
      assert.equal(path.basename(archive), `Hikari-1.2.3-${platform}-x64.zip`);
      assert.equal(fs.readFileSync(`${archive}.sha256`, 'utf8'), `${sha(archive)}  ${path.basename(archive)}\n`);
    });
  }

  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Installer checks require macOS or Windows.');
  const windows = process.platform === 'win32';
  const arch = process.arch;
  const fixtureRoot = path.join(scratch, 'fixtures');
  const runtimeRoot = path.join(fixtureRoot, `node-v24.0.0-${windows ? 'win' : 'darwin'}-${arch}`);
  const cliDir = windows ? 'node_modules/npm/bin' : 'lib/node_modules/npm/bin';
  const cli = `const fs=require('node:fs');if(process.argv.includes('--version')){console.log('11.0.0');}else{fs.appendFileSync(process.env.HIKARI_TEST_INVOCATIONS,JSON.stringify(process.argv.slice(2))+'\\n');process.exit(Number(process.env.HIKARI_TEST_BUILD_EXIT||0));}`;
  write(path.join(runtimeRoot, cliDir, 'npm-cli.js'), cli);
  write(path.join(runtimeRoot, cliDir, 'npx-cli.js'), cli);
  if (windows) {
    fs.copyFileSync(process.execPath, path.join(runtimeRoot, 'node.exe'));
    for (const name of ['npm', 'npx']) write(path.join(runtimeRoot, `${name}.cmd`), `@"%~dp0node.exe" "%~dp0node_modules\\npm\\bin\\${name}-cli.js" %*\r\n`);
  } else {
    write(path.join(runtimeRoot, 'bin/node'), '#!/bin/sh\nif [ "$1" = -e ]; then exit 0; fi\n[ -f "$1" ]\n', 0o755);
    for (const name of ['npm', 'npx']) write(path.join(runtimeRoot, `bin/${name}`), `#!${process.execPath}\n${cli}`, 0o755);
  }
  const nodeName = path.basename(runtimeRoot) + (windows ? '.zip' : '.tar.gz');
  const nodeFile = path.join(fixtureRoot, nodeName);
  const shellQuote = (value) => `'${value.replaceAll("'", "''")}'`;
  if (windows) {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -LiteralPath ${shellQuote(runtimeRoot)} -DestinationPath ${shellQuote(nodeFile)}`]);
  } else {
    execFileSync('tar', ['-czf', nodeFile, '-C', fixtureRoot, path.basename(runtimeRoot)]);
  }
  const asset = `Hikari-1.2.3-${process.platform}-${arch}.zip`;
  const assetFile = path.join(fixtureRoot, asset);
  const appRoot = path.join(fixtureRoot, `Hikari-${process.platform}-${arch}`);
  if (windows) {
    write(path.join(appRoot, 'Hikari/Hikari.exe'), 'app');
    write(path.join(appRoot, 'HikariSetup.exe'), 'setup');
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -LiteralPath ${shellQuote(appRoot)} -DestinationPath ${shellQuote(assetFile)}`]);
  } else {
    write(path.join(appRoot, 'Hikari.app/Contents/Info.plist'), 'app');
    execFileSync('ditto', ['-c', '-k', '--keepParent', appRoot, assetFile]);
  }
  const downloader = path.join(__dirname, 'support/installer-download-fixture.js');
  const shim = path.join(fixtureRoot, 'shim');
  fs.mkdirSync(shim);
  let command, args;
  if (windows) {
    const driver = path.join(fixtureRoot, 'driver.ps1');
    write(driver, `function Invoke-WebRequest { param([switch]$UseBasicParsing, [int]$TimeoutSec, [string]$Uri, [string]$OutFile)\n & $env:HIKARI_TEST_NODE $env:HIKARI_TEST_DOWNLOADER $Uri $OutFile\n if ($LASTEXITCODE -ne 0) { throw 'Fixture download failed' }\n}\nfunction Start-Sleep {}\n& $env:HIKARI_TEST_INSTALLER\n`);
    command = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', driver];
  } else {
    write(path.join(shim, 'curl'), `#!${process.execPath}\nrequire(${JSON.stringify(downloader)});`, 0o755);
    command = '/bin/bash'; args = [path.join(root, 'install.sh')];
  }
  let sequence = 0;
  function install(options = {}) {
    const work = path.join(scratch, `install ${++sequence}`);
    fs.mkdirSync(work);
    const cache = path.join(work, 'node');
    const config = { version: '1.2.3', requests: path.join(work, 'requests'), nodeName, nodeFile, nodeSha: sha(nodeFile), asset, assetFile, assetSha: sha(assetFile), ...options };
    // A PSModulePath inherited from the runner's pwsh points Windows PowerShell 5.1
    // at PowerShell 7's Utility module, which hides Get-FileHash.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^path$|^psmodulepath$|^hikari_/i.test(key)));
    env.PATH = windows ? `${shim};${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0` : `${shim}:/usr/bin:/bin:/usr/sbin:/sbin`;
    Object.assign(env, { HIKARI_TEST_NODE: process.execPath, HIKARI_TEST_DOWNLOADER: downloader,
      HIKARI_TEST_INSTALLER: path.join(root, 'install.ps1'), HIKARI_TEST_FIXTURE: path.join(work, 'fixture.json'),
      HIKARI_TEST_INVOCATIONS: path.join(work, 'invocations'), HIKARI_TEST_BUILD_EXIT: String(options.buildExit || 0),
      HIKARI_NODE_DIR: cache, HIKARI_OUT_DIR: path.join(work, 'output'),
      HIKARI_BUILD_FROM_SOURCE: options.forceSource ? '1' : '0' });
    if (options.version) env.HIKARI_VERSION = options.version;
    if (options.cache === 'unrelated') write(path.join(cache, 'keep'), 'user files');
    else if (options.cache) {
      fs.cpSync(runtimeRoot, cache, { recursive: true });
      if (options.cache === 'broken') fs.rmSync(path.join(cache, cliDir, 'npx-cli.js'));
      if (options.cache === 'missing-shim') fs.rmSync(path.join(cache, windows ? 'npx.cmd' : 'bin/npx'));
    }
    if (options.existingOutput) write(path.join(env.HIKARI_OUT_DIR, `Hikari-${process.platform}-${arch}`, 'keep'), 'existing app');
    write(env.HIKARI_TEST_FIXTURE, JSON.stringify(config));
    const result = spawnSync(command, args, { cwd: work, env, encoding: 'utf8', timeout: 30_000 });
    if (result.error) throw result.error;
    const requests = fs.existsSync(config.requests) ? fs.readFileSync(config.requests, 'utf8') : '';
    const invocations = fs.existsSync(env.HIKARI_TEST_INVOCATIONS) ? fs.readFileSync(env.HIKARI_TEST_INVOCATIONS, 'utf8') : '';
    return { ...result, requests, invocations, work, cache, env };
  }
  function succeeds(result) { assert.equal(result.status, 0, result.stdout + result.stderr); }
  function noStaging(result) {
    assert.ok(!fs.readdirSync(result.work).some((name) => name.startsWith('.hikari-node') || name.endsWith('.install-lock')));
  }
  check('prebuilt install succeeds with no Node and skips bootstrapping', () => {
    const result = install({ prebuilt: true }); succeeds(result);
    assert.ok(fs.existsSync(path.join(result.env.HIKARI_OUT_DIR, `Hikari-${process.platform}-${arch}`)), result.stdout + result.stderr);
    assert.ok(!result.requests.includes('nodejs.org'));
    assert.equal(result.invocations, '');
    assert.ok(!fs.existsSync(result.cache));
  });
  check('corrupt prebuilt download fails without falling through to a build', () => {
    const result = install({ prebuilt: true, badChecksum: true });
    assert.notEqual(result.status, 0);
    assert.ok(!result.requests.includes('nodejs.org'));
    assert.equal(result.invocations, '');
  });
  check('prebuilt install preserves an existing destination', () => {
    const result = install({ prebuilt: true, existingOutput: true });
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(result.env.HIKARI_OUT_DIR, `Hikari-${process.platform}-${arch}`, 'keep'), 'utf8'), 'existing app');
    assert.equal(result.invocations, '');
  });
  check('missing prebuilt bootstraps Node and builds the exact resolved version', () => {
    const result = install(); succeeds(result);
    assert.ok(result.requests.includes('SHASUMS256.txt'));
    assert.ok(result.requests.includes(`/dist/v24.0.0/${nodeName}`));
    assert.match(result.invocations, /@hinashirosaki\/hikari@1\.2\.3/);
    noStaging(result);
  });
  check('incomplete cached Node is repaired', () => {
    const result = install({ cache: 'broken', forceSource: true }); succeeds(result);
    assert.ok(result.requests.includes('SHASUMS256.txt'));
    assert.ok(fs.existsSync(path.join(result.cache, cliDir, 'npx-cli.js')));
    noStaging(result);
  });
  check('valid cached Node is reused', () => {
    const result = install({ cache: 'valid', forceSource: true }); succeeds(result);
    assert.ok(!result.requests.includes('nodejs.org'));
    assert.match(result.invocations, /@hinashirosaki\/hikari@1\.2\.3/);
  });
  check('missing npm launcher is repaired even when CLI sources remain', () => {
    const result = install({ cache: 'missing-shim', forceSource: true }); succeeds(result);
    assert.ok(result.requests.includes('SHASUMS256.txt'));
    assert.ok(fs.existsSync(path.join(result.cache, windows ? 'npx.cmd' : 'bin/npx')));
    noStaging(result);
  });
  check('interrupted download preserves the old cache and removes staging', () => {
    const result = install({ cache: 'broken', interrupted: true, forceSource: true });
    assert.notEqual(result.status, 0);
    assert.ok(fs.existsSync(path.join(result.cache, windows ? 'node.exe' : 'bin/node')));
    assert.ok(!fs.existsSync(path.join(result.cache, cliDir, 'npx-cli.js')));
    assert.equal(result.invocations, ''); noStaging(result);
  });
  check('repair refuses to replace an unrelated cache directory', () => {
    const result = install({ cache: 'unrelated', forceSource: true });
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(result.cache, 'keep'), 'utf8'), 'user files');
    assert.ok(!result.requests.includes('nodejs.org'));
    assert.equal(result.invocations, ''); noStaging(result);
  });
  check('invalid Node checksum never promotes the runtime', () => {
    const result = install({ badNodeChecksum: true, forceSource: true });
    assert.notEqual(result.status, 0);
    assert.ok(!fs.existsSync(result.cache));
    assert.equal(result.invocations, ''); noStaging(result);
  });
  check('build failure propagates to the installer caller', () => {
    const result = install({ cache: 'valid', forceSource: true, buildExit: 7 });
    assert.notEqual(result.status, 0); noStaging(result);
  });
  check('invalid release version is rejected before use', () => {
    const result = install({ version: 'bad/version' });
    assert.notEqual(result.status, 0);
    assert.equal(result.invocations, '');
  });
  console.log(`${count}/${count} installer checks passed`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
