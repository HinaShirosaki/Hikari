// Settings > Tutorial panel: Download until there is a copy, then Open, Check for
// Updates, and Update only when GitHub has a newer version.
import assert from 'node:assert/strict';
import { createTutorialSettings } from '../src/renderer/modules/settings/tutorial-controller.js';

function element() {
  const listeners = {};
  return {
    textContent: '', disabled: false, hidden: false, dataset: {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
    click: () => listeners.click?.()
  };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const v1 = { commit: 'a'.repeat(40), date: '2026-11-07T10:00:00Z' };
const v2 = { commit: 'b'.repeat(40), date: '2026-11-20T10:00:00Z' };
let installed = null;
let latest = v1;
let finishInstall;
const opened = [];
const api = {
  getTutorialStatus: async () => ({ status: installed ? 'installed' : 'not-downloaded', installed }),
  checkTutorialUpdate: async () => ({ status: installed.commit === latest.commit ? 'up-to-date' : 'update-available', installed, latest }),
  installTutorial: () => new Promise((resolve) => { finishInstall = () => { installed = latest; resolve({ status: 'up-to-date', installed, latest }); }; }),
  openTutorial: async () => { opened.push(installed.commit); return { ok: true }; }
};
const statusElement = element();
const openButton = element();
const checkButton = element();
const updateButton = element();
const panel = createTutorialSettings({ api, statusElement, openButton, checkButton, updateButton });

await panel.refresh();
assert.equal(statusElement.textContent, 'The tutorial is not downloaded yet.');
assert.equal(openButton.textContent, 'Download Tutorial', 'nothing downloaded: the main button downloads');
assert.equal(checkButton.hidden, true);
assert.equal(updateButton.hidden, true);

openButton.click();
await flush();
assert.match(statusElement.textContent, /Downloading the tutorial/);
assert.equal(openButton.disabled, true, 'no second download while one runs');
finishInstall();
await flush();
assert.equal(statusElement.textContent, 'The tutorial is up to date (version 2026-11-07 · aaaaaaa).');
assert.equal(openButton.textContent, 'Open Tutorial in Browser');
assert.equal(openButton.disabled, false);
assert.equal(checkButton.hidden, false);
assert.deepEqual(opened, [], 'downloading does not open it');

openButton.click();
await flush();
assert.deepEqual(opened, [v1.commit]);

latest = v2;
checkButton.click();
await flush();
assert.equal(statusElement.textContent, 'A newer tutorial is available: version 2026-11-20 · bbbbbbb. You have version 2026-11-07 · aaaaaaa.');
assert.equal(updateButton.hidden, false);

updateButton.click();
await flush();
assert.match(statusElement.textContent, /Downloading the tutorial/);
finishInstall();
await flush();
assert.match(statusElement.textContent, /up to date \(version 2026-11-20 · bbbbbbb\)/);
assert.equal(updateButton.hidden, true);

const offlineStatus = element();
const offline = createTutorialSettings({
  api: { ...api, checkTutorialUpdate: async () => ({ status: 'error', installed, error: 'fetch failed' }) },
  statusElement: offlineStatus, openButton: element(), checkButton: element(), updateButton: element()
});
await offline.refresh();
await flush();
assert.equal(offlineStatus.textContent, 'Tutorial version 2026-11-20 · bbbbbbb.');

console.log('settings tutorial selfcheck passed');
