#!/usr/bin/env node
// End-to-end check of app-only updates, meant for a fresh VM (macOS or Windows,
// run inside the logged-in desktop session) and also runnable on Linux:
//   1. packages this checkout labelled 0.0.0-e2e (forge package), timed;
//   2. starts it and updates it the way Settings > Updates does (Check, Install);
//   3. checks that it restarts into the latest npm release from <userData>/app-code.
// With --compare-full it also times the full rebuild an update needs without
// app-only updates (`npx @hinashirosaki/hikari@<latest>`; macOS and Windows only).
// Deletes <userData>/app-code first. Writes the result to hikari-e2e-result.json
// in the OS temp folder.
//   node scripts/dev/vm-test/app-only-update-e2e.mjs [--skip-install] [--compare-full]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = new Set(process.argv.slice(2));
const platform = process.platform;
const PORT = 9333;
const LABEL = '0.0.0-e2e';
const result = { platform, arch: process.arch, steps: {}, ok: false };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (since) => Number(((Date.now() - since) / 1000).toFixed(1));
const say = (message) => console.log(`[e2e] ${message}`);

function run(command, commandArgs, options = {}) {
  const started = Date.now();
  const outcome = spawnSync(command, commandArgs, {
    // Windows: npm and npx are .cmd scripts, which need a shell.
    cwd: repo, stdio: 'inherit', shell: platform === 'win32' && !path.isAbsolute(command), ...options
  });
  if (outcome.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} exited with ${outcome.status}`);
  return seconds(started);
}

function userDataDir() {
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Hikari');
  if (platform === 'win32') return path.join(process.env.APPDATA, 'Hikari');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Hikari');
}

function findExecutable(outDir) {
  const folder = fs.readdirSync(outDir).find((name) => name.startsWith(`Hikari-${platform}-`));
  if (!folder) throw new Error(`forge package left no Hikari-${platform}-* in ${outDir}`);
  const base = path.join(outDir, folder);
  if (platform === 'darwin') return path.join(base, 'Hikari.app', 'Contents', 'MacOS', 'Hikari');
  if (platform === 'win32') return path.join(base, 'Hikari.exe');
  return path.join(base, fs.readdirSync(base).find((name) => /^hikari$/i.test(name)));
}

async function devtools(pathname) {
  return (await fetch(`http://127.0.0.1:${PORT}${pathname}`)).json();
}

async function waitForWindow(timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const page = (await devtools('/json/list')).find((target) => target.type === 'page' && target.url.endsWith('index.html'));
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('no Hikari window appeared');
}

async function evaluate(page, expression) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const reply = new Promise((resolve) => {
    socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.id === 1) resolve(data);
    };
  });
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  const data = await reply;
  socket.close();
  if (data.result?.exceptionDetails) throw new Error(data.result.exceptionDetails.exception?.description || 'evaluate failed');
  return data.result?.result?.value;
}

// The window's version, and whether it runs the bundled code or a downloaded copy.
async function describeWindow(page) {
  for (let i = 0; i < 100 && !(await evaluate(page, 'Boolean(window.hikariApi?.getUpdateStatus)')); i++) await sleep(200);
  const status = await evaluate(page, 'window.hikariApi.getUpdateStatus()');
  const url = decodeURIComponent(page.url).replace(/\\/g, '/');
  return { version: status?.currentVersion, runs: url.includes('/app-code/') ? 'app-code' : 'bundled', url, status };
}

function launch(executable) {
  const launchArgs = [`--remote-debugging-port=${PORT}`];
  if (platform === 'linux' && process.getuid?.() === 0) launchArgs.push('--no-sandbox');
  if (platform === 'darwin') {
    // LaunchServices starts it in the desktop session, as a double-click would.
    const app = path.resolve(executable, '..', '..', '..');
    spawnSync('open', ['-n', app, '--args', ...launchArgs], { stdio: 'inherit' });
    return;
  }
  spawn(executable, launchArgs, { detached: true, stdio: 'ignore' }).unref();
}

function quitAll(executable) {
  if (platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/IM', path.basename(executable)], { stdio: 'ignore' });
  else spawnSync('pkill', ['-f', executable], { stdio: 'ignore' });
}

const packageJsonPath = path.join(repo, 'package.json');
const originalPackageJson = fs.readFileSync(packageJsonPath, 'utf8');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-e2e-out-'));
let executable = '';
try {
  say(`${platform}-${process.arch}, Node ${process.versions.node}, repo ${repo}`);
  const latest = (await (await fetch('https://registry.npmjs.org/@hinashirosaki%2fhikari', {
    headers: { Accept: 'application/vnd.npm.install-v1+json' }
  })).json())['dist-tags'].latest;
  result.latest = latest;
  say(`latest on npm: ${latest}`);

  const appCode = path.join(userDataDir(), 'app-code');
  fs.rmSync(appCode, { recursive: true, force: true });
  say(`cleared ${appCode}`);

  fs.writeFileSync(packageJsonPath, originalPackageJson.replace(/"version":\s*"[^"]+"/, `"version": "${LABEL}"`));
  if (!args.has('--skip-install')) {
    say('npm ci');
    result.steps.npmCi = run('npm', ['ci', '--no-audit', '--no-fund']);
  }
  say(`packaging this checkout as ${LABEL}`);
  result.steps.packageThisCheckout = run(process.execPath, [path.join('scripts', 'build-ui.mjs')])
    + run(process.execPath, [path.join('node_modules', '@electron-forge', 'cli', 'dist', 'electron-forge.js'), 'package'],
      { env: { ...process.env, HIKARI_OUT_DIR: outDir } });
  executable = findExecutable(outDir);
  say(`packaged: ${executable}`);

  let started = Date.now();
  launch(executable);
  let page = await waitForWindow();
  result.steps.firstWindow = seconds(started);
  const before = await describeWindow(page);
  result.before = { version: before.version, runs: before.runs };
  say(`started: ${before.version} (${before.runs}) in ${result.steps.firstWindow} s`);
  if (before.version !== LABEL || before.runs !== 'bundled') throw new Error('the packaged build did not start as itself');

  // Settings > Updates. The startup check may already have found the update.
  let status = before.status;
  for (let i = 0; i < 100 && status?.status === 'checking'; i++) {
    await sleep(200);
    status = await evaluate(page, 'window.hikariApi.getUpdateStatus()');
  }
  if (status?.status !== 'update-available') status = await evaluate(page, 'window.hikariApi.checkForUpdates()');
  if (status?.status !== 'update-available') throw new Error(`no update found: ${JSON.stringify(status)}`);
  say(`update available: ${status.latestVersion}; installing`);
  started = Date.now();
  evaluate(page, 'window.hikariApi.installUpdate()').catch(() => { /* the app quits mid-call */ });
  // The window stays until the install is done and Hikari quits.
  for (;;) {
    await sleep(250);
    try {
      await devtools('/json/version');
    } catch {
      break;
    }
    if (Date.now() - started > 600000) throw new Error('Hikari did not restart within 10 minutes');
  }
  result.steps.installAndQuit = seconds(started);
  started = Date.now();
  page = await waitForWindow();
  result.steps.relaunchToWindow = seconds(started);
  const after = await describeWindow(page);
  result.after = { version: after.version, runs: after.runs, installKind: after.status?.installKind };
  say(`restarted: ${after.version} (${after.runs}) — install+quit ${result.steps.installAndQuit} s, relaunch ${result.steps.relaunchToWindow} s`);
  const log = path.join(appCode, latest, 'update.log');
  if (fs.existsSync(log)) say(`update.log:\n${fs.readFileSync(log, 'utf8').trim().split('\n').slice(-4).join('\n')}`);
  result.ok = after.version === latest && after.runs === 'app-code';
  quitAll(executable);

  if (args.has('--compare-full') && platform !== 'linux') {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-e2e-full-'));
    say(`timing the full rebuild: npx @hinashirosaki/hikari@${latest} in ${buildDir}`);
    result.steps.fullRebuild = run('npx', ['--yes', `@hinashirosaki/hikari@${latest}`], { cwd: buildDir });
  }
} catch (error) {
  result.error = String(error?.message || error);
  console.error(`[e2e] FAILED: ${result.error}`);
} finally {
  if (executable) quitAll(executable);
  fs.writeFileSync(packageJsonPath, originalPackageJson);
  const resultPath = path.join(os.tmpdir(), 'hikari-e2e-result.json');
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  say(`${result.ok ? 'PASS' : 'FAIL'} (seconds: ${JSON.stringify(result.steps)}); saved to ${resultPath}`);
  process.exitCode = result.ok ? 0 : 1;
}
