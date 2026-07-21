// Self-check for the main-window navigation guards in
// src/main/windows/create-main-window.js.
//
// These guards are the only thing standing between untrusted paper/LLM content
// and a window that still carries the preload bridge, so the URL classification
// gets a runnable check rather than a code review.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createMainWindow } = require(path.join(projectRoot, 'src/main/windows/create-main-window.js'));

function harness() {
  const opened = [];
  const listeners = new Map();
  let permissionHandler = null;

  const webContents = {
    setWindowOpenHandler(fn) { webContents.openHandler = fn; },
    on(event, fn) { listeners.set(event, fn); },
    getURL: () => 'file:///app/index.html',
    session: {
      setPermissionRequestHandler(fn) { permissionHandler = fn; }
    }
  };
  const window = { webContents, loadFile() {}, on() {} };

  createMainWindow({
    BrowserWindow: function BrowserWindowStub() { return window; },
    shell: { openExternal: (url) => opened.push(url) },
    path,
    projectRoot: '/app',
    appIconPath: '/app/icon.png',
    preloadPath: '/app/preload.js'
  });

  return {
    opened,
    open: (url) => webContents.openHandler({ url }),
    navigate: (url) => {
      let prevented = false;
      listeners.get('will-navigate')({ preventDefault() { prevented = true; } }, url);
      return prevented;
    },
    permission: () => {
      let allowed = null;
      permissionHandler({}, 'media', (value) => { allowed = value; });
      return allowed;
    }
  };
}

// The app opens PDFs it generated itself; those must still work.
{
  const h = harness();
  const blob = h.open('blob:file:///9f3c-1a2b');
  assert.equal(blob.action, 'allow', 'generated blob PDFs must still open');
  assert.equal(blob.overrideBrowserWindowOptions.webPreferences.sandbox, true,
    'PDF popups must be sandboxed so the preload bridge cannot attach');
  assert.equal(h.open('data:application/pdf;base64,JVBERi0=').action, 'allow');
  assert.deepEqual(h.opened, [], 'self-issued documents must not leak to the browser');
}

// External links leave for the system browser, never an Electron window.
{
  const h = harness();
  assert.equal(h.open('https://example.com/paper.pdf').action, 'deny');
  assert.equal(h.open('http://example.com').action, 'deny');
  assert.deepEqual(h.opened, ['https://example.com/paper.pdf', 'http://example.com']);
}

// Everything else is dropped outright - notably data:text/html, which is script
// bearing, and file:, which would hand out a fresh preloaded window.
{
  const h = harness();
  for (const url of ['data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
    assert.equal(h.open(url).action, 'deny', `${url} must be denied`);
  }
  assert.deepEqual(h.opened, [], 'denied schemes must not be handed to the browser either');
}

// The SPA never navigates; a reload of the current URL is the one legal case.
{
  const h = harness();
  assert.equal(h.navigate('file:///app/index.html'), false, 'reload must not be blocked');
  assert.equal(h.navigate('https://example.com'), true, 'external navigation must be blocked');
  assert.deepEqual(h.opened, ['https://example.com'], 'blocked navigation should redirect to the browser');
  assert.equal(h.navigate('file:///other.html'), true, 'sideways file navigation must be blocked');
}

// No feature asks for camera/mic/geolocation.
assert.equal(harness().permission(), false, 'permission requests must be refused');

console.log('PASS window-guard: popup, navigation, and permission guards');
