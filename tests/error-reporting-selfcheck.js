#!/usr/bin/env node
// Self-check for local crash/error reporting: main-process failures, teed
// console output, renderer-forwarded errors, and the crashed-window dialog all
// end up as JSON lines in the error log without recursing or throwing.
// Run: node tests/error-reporting-selfcheck.js
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const { createErrorReporting } = require(path.join(__dirname, '..', 'src/main/lib/error-reporting.js'));

async function main() {
  const lines = [];
  const printed = [];
  const consoleObject = {
    error: (...args) => printed.push(['error', ...args]),
    warn: (...args) => printed.push(['warn', ...args])
  };
  const processObject = new EventEmitter();
  const app = new EventEmitter();
  app.quit = () => { app.quitCalled = true; };
  const webContents = { reload: () => { webContents.reloaded = true; } };
  const mainWindow = { webContents, isDestroyed: () => false };
  let dialogOptions = null;
  const dialog = { showMessageBox: async (_win, options) => { dialogOptions = options; return { response: 0 }; } };
  let crashReporterOptions = null;

  const reporting = createErrorReporting({
    app,
    crashReporter: { start: (options) => { crashReporterOptions = options; } },
    processObject,
    consoleObject,
    logPath: '/tmp/errors.log',
    appendLog: async ({ logPath, entry }) => { lines.push({ logPath, entry }); },
    getMainWindow: () => mainWindow,
    dialog
  });
  reporting.install();

  // --- native crash dumps are local only ---
  assert.equal(crashReporterOptions.uploadToServer, false);

  // --- main-process failures ---
  processObject.emit('uncaughtException', new Error('boom'));
  processObject.emit('unhandledRejection', 'nope');
  await Promise.resolve();
  assert.equal(lines.length, 2);
  assert.equal(lines[0].entry.source, 'main:uncaughtException');
  assert.equal(lines[0].entry.message, 'boom');
  assert.match(lines[0].entry.stack, /Error: boom/);
  assert.equal(lines[1].entry.message, 'nope');
  assert.equal(lines[0].logPath, '/tmp/errors.log');

  // --- console tee: still prints, also logs, does not recurse ---
  consoleObject.error('save failed:', new Error('disk full'));
  consoleObject.warn('slow');
  await Promise.resolve();
  assert.equal(lines.length, 4);
  assert.equal(lines[2].entry.source, 'main:console.error');
  assert.equal(lines[2].entry.message, 'disk full');
  assert.equal(lines[3].entry.message, 'slow');
  assert.ok(printed.some((row) => row[0] === 'error' && row[1] === 'save failed:'));

  // --- renderer payloads are a trust boundary: bounded and namespaced ---
  const entry = reporting.reportFromRenderer({
    source: 'notice',
    message: 'x'.repeat(10000),
    stack: 'trace',
    file: 'app.js',
    line: 12
  });
  assert.equal(entry.source, 'renderer:notice');
  assert.equal(entry.message.length, 4000);
  assert.equal(entry.line, 12);
  assert.equal(reporting.reportFromRenderer({}).source, 'renderer:unknown');
  assert.equal(reporting.reportFromRenderer({ source: 'renderer:error' }).source, 'renderer:error');

  // --- a crashed main window is logged, then offered a reload ---
  app.emit('render-process-gone', {}, webContents, { reason: 'crashed', exitCode: 5 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(dialogOptions.detail, /crashed/);
  assert.equal(webContents.reloaded, true);
  assert.notEqual(app.quitCalled, true);
  assert.ok(lines.some((row) => row.entry.source === 'render-process-gone' && row.entry.exitCode === 5));

  // --- a clean exit or a popup crash shows no dialog ---
  dialogOptions = null;
  app.emit('render-process-gone', {}, webContents, { reason: 'clean-exit' });
  app.emit('render-process-gone', {}, { reload() {} }, { reason: 'crashed' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dialogOptions, null);

  // --- a failing log write must not throw out of report() ---
  const broken = createErrorReporting({
    processObject: new EventEmitter(),
    consoleObject,
    appendLog: async () => { throw new Error('read-only'); }
  });
  assert.doesNotThrow(() => broken.report('x', new Error('y')));
  await Promise.resolve();

  console.log('error-reporting selfcheck: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
