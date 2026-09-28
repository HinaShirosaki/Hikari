import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const markup = await readFile(new URL('../ui/html/views/setting-view.html', import.meta.url), 'utf8');
const settingsModule = await readFile(new URL('../src/renderer/modules/settings/index.js', import.meta.url), 'utf8');

assert.match(markup, /<select id="setting-model">/);
assert.doesNotMatch(markup, /<input id="setting-model"/);
assert.doesNotMatch(markup, /id="setting-model-options"/);
assert.match(settingsModule, /defaultOption\.textContent = 'Use the default model';/);
assert.match(settingsModule, /settingModel\.value = String\(selectedModel \|\| ''\)\.trim\(\);/);

console.log('Settings model selector selfcheck passed.');
