// Settings > Updates panel: status text and which of the two buttons is enabled.
import assert from 'node:assert/strict';
import { createUpdateSettings } from '../src/renderer/modules/settings/update-controller.js';

function element() {
  const listeners = {};
  return {
    textContent: '', disabled: false, dataset: {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
    click: () => listeners.click?.()
  };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const statusElement = element();
const checkButton = element();
const installButton = element();
let status = { status: 'up-to-date', currentVersion: '1.1.0-beta.1', latestVersion: '1.1.0-beta.1' };
let finishInstall;
const api = {
  getUpdateStatus: async () => status,
  checkForUpdates: async () => (status = { status: 'update-available', currentVersion: '1.1.0-beta.1', latestVersion: '1.1.0-beta.2' }),
  installUpdate: () => new Promise((resolve) => { finishInstall = resolve; })
};
const panel = createUpdateSettings({ api, statusElement, checkButton, installButton });

await panel.refresh();
assert.match(statusElement.textContent, /up to date/);
assert.equal(checkButton.disabled, false);
assert.equal(installButton.disabled, true, 'nothing to install yet');

checkButton.click();
assert.equal(statusElement.textContent, 'Checking for updates…');
assert.equal(checkButton.disabled, true);
await flush();
assert.match(statusElement.textContent, /1\.1\.0-beta\.2 is available/);
assert.equal(installButton.disabled, false);

installButton.click();
assert.match(statusElement.textContent, /Downloading and installing Hikari 1\.1\.0-beta\.2/);
assert.equal(checkButton.disabled, true);
assert.equal(installButton.disabled, true);
await panel.refresh();
assert.match(statusElement.textContent, /Downloading and installing/, 'reopening the panel mid-install keeps the install state');

finishInstall({ status: 'error', error: 'The Hikari build exited with 1.', currentVersion: '1.1.0-beta.1' });
await flush();
assert.match(statusElement.textContent, /Could not update: The Hikari build exited with 1\./);
assert.equal(statusElement.dataset.error, 'true');
assert.equal(checkButton.disabled, false, 'can check again after a failure');
assert.equal(installButton.disabled, true);

const dev = element();
createUpdateSettings({ api: { getUpdateStatus: async () => ({ status: 'development-disabled' }) }, statusElement: dev, checkButton: element(), installButton: element() }).refresh();
await flush();
assert.match(dev.textContent, /installed app/);

console.log('settings updates panel ok');
