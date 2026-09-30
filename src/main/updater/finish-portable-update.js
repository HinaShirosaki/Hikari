'use strict';

const childProcess = require('node:child_process');
const nodeFs = require('node:fs');
const path = require('node:path');

// Windows portable update, second half. Windows locks a running app's files, so
// the old Hikari starts the new build's Hikari.exe with
// --hikari-swap-into=<app folder> --hikari-swap-after=<old pid> as it quits (a
// windowed program outlives its parent; a detached PowerShell helper never runs).
// This instance waits for the old one to exit, parks the old folder beside it,
// copies itself in (works across drives), starts the copy and returns. If the
// copy fails, the old folder is put back and started instead.
async function finishPortableUpdate({
  argv = process.argv,
  execPath = process.execPath,
  fs = nodeFs,
  spawn = childProcess.spawn,
  isRunning = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === 'EPERM';
    }
  },
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  const arg = (name) => (argv.find((item) => item.startsWith(`--${name}=`)) || '').slice(name.length + 3);
  const appDir = arg('hikari-swap-into');
  const oldPid = Number(arg('hikari-swap-after'));
  const newDir = path.dirname(execPath);
  const log = (message) => {
    try {
      fs.appendFileSync(path.join(path.dirname(newDir), 'swap-portable.log'), `${new Date().toISOString()} ${message}\n`);
    } catch { /* logging is best effort */ }
  };
  if (!appDir) return;

  for (let i = 0; i < 120 && oldPid && isRunning(oldPid); i++) await sleep(500);
  const parked = `${appDir}.previous`;
  fs.rmSync(parked, { recursive: true, force: true });
  let moved = false;
  // The old app's helper processes can hold its files a moment after it exits.
  for (let i = 0; i < 60 && !moved; i++) {
    try {
      fs.renameSync(appDir, parked);
      moved = true;
    } catch {
      await sleep(500);
    }
  }
  if (!moved) {
    log(`could not move ${appDir} aside; starting the old app`);
  } else {
    try {
      fs.cpSync(newDir, appDir, { recursive: true });
      fs.rmSync(parked, { recursive: true, force: true });
      log(`updated ${appDir}`);
    } catch (error) {
      log(`copy failed, restoring the old app: ${error.message}`);
      fs.rmSync(appDir, { recursive: true, force: true });
      fs.renameSync(parked, appDir);
    }
  }
  spawn(path.join(appDir, path.basename(execPath)), [], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = { finishPortableUpdate };
