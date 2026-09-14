'use strict';

// Local-only crash and error reporting. Hikari has no backend, so nothing is
// uploaded: native crash dumps land in app.getPath('crashDumps') and every
// JS-level failure is appended as one JSON line to <Logs>/errors.log next to the
// agent chat log. Settings → Startup & Data → "Open Logs Folder" is how a user
// gets them to you.
//
// ponytail: file only. If a real error service is ever wanted, `report()` is the
// single hook to forward from.

const MAX_TEXT = 4000;

function trim(value, max = MAX_TEXT) {
  return String(value ?? '').trim().slice(0, max);
}

function describeError(error) {
  if (error && typeof error === 'object') {
    return {
      message: trim(error.message || error.reason || error.name || String(error)),
      stack: trim(error.stack || '')
    };
  }
  return { message: trim(error), stack: '' };
}

function createErrorReporting({
  app = null,
  crashReporter = null,
  processObject = process,
  consoleObject = console,
  logPath = '',
  appendLog,
  getMainWindow = () => null,
  dialog = null
} = {}) {
  if (typeof appendLog !== 'function') {
    throw new Error('appendLog is required.');
  }
  // Keep the originals: report() prints through them, so teeing console.error
  // below cannot recurse.
  const originalError = consoleObject.error.bind(consoleObject);
  const originalWarn = consoleObject.warn.bind(consoleObject);

  function report(source, error, extra = {}) {
    const entry = {
      at: new Date().toISOString(),
      source: trim(source, 120) || 'unknown',
      ...describeError(error),
      ...extra
    };
    appendLog({ logPath, entry }).catch((writeError) => {
      originalError('Error log write failed:', writeError);
    });
    return entry;
  }

  function install() {
    // Native crashes (renderer, GPU, main). Must run before app ready.
    try {
      crashReporter?.start?.({ submitURL: '', uploadToServer: false });
    } catch (error) {
      originalError('crashReporter.start failed:', error);
    }

    processObject.on('uncaughtException', (error) => {
      originalError('Uncaught exception in main:', error);
      report('main:uncaughtException', error);
    });
    processObject.on('unhandledRejection', (reason) => {
      originalError('Unhandled rejection in main:', reason);
      report('main:unhandledRejection', reason);
    });

    // Packaged builds have no terminal, and every existing failure path in main
    // already speaks through console.error/warn — tee them instead of touching
    // each call site.
    consoleObject.error = (...args) => {
      originalError(...args);
      report('main:console.error', args.find((a) => a instanceof Error) || args.map(String).join(' '));
    };
    consoleObject.warn = (...args) => {
      originalWarn(...args);
      report('main:console.warn', args.find((a) => a instanceof Error) || args.map(String).join(' '));
    };

    app?.on?.('child-process-gone', (_event, details) => {
      report('child-process-gone', details?.reason, { type: details?.type, name: details?.name, exitCode: details?.exitCode });
    });
    app?.on?.('render-process-gone', async (_event, webContents, details) => {
      const reason = trim(details?.reason, 60);
      report('render-process-gone', reason, { exitCode: details?.exitCode });
      const mainWindow = getMainWindow();
      const isMain = mainWindow && !mainWindow.isDestroyed?.() && webContents === mainWindow.webContents;
      if (!isMain || reason === 'clean-exit' || reason === 'killed' || !dialog) {
        return;
      }
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Hikari',
        message: 'The Hikari window stopped unexpectedly.',
        detail: `Reason: ${reason}. Your data in the storage folder is safe. A report was written to the logs folder.`,
        buttons: ['Reload', 'Quit'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      }).catch(() => null);
      if (result?.response === 0) {
        webContents.reload();
      } else {
        app.quit();
      }
    });
  }

  // Trust boundary: the renderer (or a plugin via the bridge) sends this.
  function reportFromRenderer(payload = {}) {
    const source = trim(payload?.source, 120);
    return report(source.startsWith('renderer:') ? source : `renderer:${source || 'unknown'}`, {
      message: payload?.message,
      stack: payload?.stack
    }, {
      file: trim(payload?.file, 600),
      line: Number.isFinite(payload?.line) ? payload.line : undefined
    });
  }

  return { install, report, reportFromRenderer, logPath };
}

module.exports = { createErrorReporting };
