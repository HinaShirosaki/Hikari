import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createPresentation } from '../src/plugins/gel/i18n.mjs';
import { createGelNotifications } from '../src/plugins/gel/notifications.js';

const calls = [], errors = [];
let timestamp = 10000, rejectNotice = false;
const notifications = createGelNotifications({ now: () => timestamp, onError: error => errors.push(error),
  hikari: { async call(verb, params) { assert.equal(verb, 'notifications.show'); if (rejectNotice) throw new Error('Bridge unavailable'); calls.push(params); } }
});
for (const message of ['', 'Loading saved gel image...', 'Saving figure project…', 'Preparing PNG…']) await notifications.show(message);
await notifications.show('Refreshing records', { kind: 'loading' });
assert.equal(calls.length, 0, 'Empty and progress updates do not create host notices');
await notifications.show('PNG exported.');
assert.equal(calls[0].type, 'success');
assert.equal(calls[0].durationMs, 5000);
await notifications.show('PNG exported.');
assert.equal(calls.length, 1, 'Repeated status callbacks do not duplicate a notice');
timestamp += 2000;
await notifications.show('PNG exported.');
assert.equal(calls.length, 2, 'A later user action can report the same result');
await notifications.show('Could not save gel: Disk is full');
assert.equal(calls.at(-1).type, 'error');
assert.equal(calls.at(-1).durationMs, 8000);
await notifications.show('Some artifacts are missing', { kind: 'warning' });
assert.equal(calls.at(-1).type, 'error', 'Warnings use the host attention state');
await notifications.show('x'.repeat(1400));
assert.equal(calls.at(-1).message.length, 1000, 'Long messages respect the host API bound');
rejectNotice = true;
assert.equal(await notifications.show('A failed bridge call'), false);
rejectNotice = false;
assert.equal(await notifications.show('A failed bridge call'), true, 'A failed delivery can be retried');
assert.equal(errors.length, 1);

const source = await fs.readFile(new URL('../src/plugins/gel/main.js', import.meta.url), 'utf8');
const menuRetry = { hidden: true }, indicator = {}, bootMessage = {}, bootRetryButton = {};
const bootPanel = { hidden: true, dataset: {}, classList: { toggle() {}, remove() {} }, querySelector: () => indicator };
let attempts = 0;
const context = vm.createContext({ i18nUi: createPresentation('gel'), notifications, bootPanel, bootMessage, bootRetryButton, retryAction: null,
  workspaceReady: true, readyWarningKey: '', loadWarnings: { artifactWarnings: 0, migrationError: '' },
  state: { settings: { storagePath: '.' } }, persistFailure: '',
  document: { getElementById: () => menuRetry }, host: { setAttribute() {} },
  refreshHostData: () => {}, errorMessage: error => error.message
});
vm.runInContext(source.slice(source.indexOf('function setHostBusy('), source.indexOf('const { fromBase64Json,')), context);
vm.runInContext(source.slice(source.indexOf('function retryLastNotification()'), source.indexOf("bootRetryButton?.addEventListener('click'")), context);
context.showBanner('Recovered 2 saved gels.', { kind: 'success' });
assert.equal(bootPanel.hidden, true, 'Successful operations leave no Gel-local banner');
assert.equal(bootMessage.hidden, true);
assert.equal(calls.at(-1).message, 'Recovered 2 saved gels.');
context.showBanner('Could not recover saved gels.', { kind: 'error', retry: async () => { attempts++; } });
assert.equal(bootPanel.hidden, true, 'Workspace errors use the host notification');
assert.equal(menuRetry.hidden, false, 'Retry remains available in Add gel');
await context.retryLastNotification();
assert.equal(attempts, 1);
assert.equal(menuRetry.hidden, true, 'A completed retry clears the retry action');
context.loadWarnings.artifactWarnings = 2;
context.showReadyState();
const count = calls.length; timestamp += 10000;
context.showReadyState();
assert.equal(calls.length, count, 'Theme and layout updates do not repeat the same warning');
context.loadWarnings.artifactWarnings = 0;
context.showReadyState();
context.workspaceReady = false;
context.showBanner('Loading gel workspace…', { kind: 'loading', busy: true });
assert.equal(bootPanel.hidden, false, 'Initial startup retains its loader');
assert.equal(bootMessage.hidden, false);
context.showBanner('Gel could not start.', { kind: 'error', retry: async () => { throw new Error('Still unavailable'); } });
assert.equal(bootMessage.hidden, true, 'Startup error text also moves to the host');
assert.equal(bootRetryButton.hidden, false, 'A failed boot retains a reachable retry button');
await context.retryLastNotification();
assert.match(calls.at(-1).message, /Retry failed: Still unavailable/);
assert.equal(menuRetry.hidden, false, 'Retry failures remain retryable');
console.log('gel-notifications-selfcheck: passed (host routing, progress filtering, deduplication, error states, bounds, failed delivery, warning renders, and retries)');
