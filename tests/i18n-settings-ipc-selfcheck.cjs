const assert = require('node:assert/strict');
const { registerSystemIpc } = require('../src/main/ipc/register-system-ipc.js');
const { createSystemApi } = require('../src/main/preload/api/system-api.js');
const { SYSTEM } = require('../src/shared/ipc/channels.js');
const { nativeText, setLocale } = require('../src/main/lib/i18n.js');
const english = require('../src/main/lib/locales/en.json');
const spanish = require('../src/main/lib/locales/es.json');
assert.deepEqual(Object.keys(spanish).sort(), Object.keys(english).sort());
const parameters = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
for (const [key, message] of Object.entries(english)) assert.deepEqual(parameters(spanish[key]), parameters(message), 'Native Spanish preserves interpolation: ' + key);
for (const locale of ['zh-Hans', 'zh-Hant', 'ja']) {
  const messages = require(`../src/main/lib/locales/${locale}.json`);
  assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort(), locale + ' covers every native message');
  for (const [key, message] of Object.entries(english)) assert.deepEqual(parameters(messages[key]), parameters(message), locale + ' preserves interpolation: ' + key);
}
const handlers = new Map();
registerSystemIpc({ ipcMain: { handle: (channel, callback) => handlers.set(channel, callback), on() {} } });
const api = createSystemApi({ invoke: (channel, payload) => handlers.get(channel)({}, payload) });
assert.ok(handlers.has(SYSTEM.SET_UI_LOCALE));
assert.deepEqual(api.setUiLocale('es-MX'), { ok: true, locale: 'es' });
assert.equal(nativeText('Cancel'), 'Cancelar');
assert.equal(nativeText('Hikari {p0} is available.', { p0: '1.2' }), 'Hikari 1.2 está disponible.');
for (const [input, locale, cancel, update] of [
  ['zh-CN', 'zh-Hans', '取消', 'Hikari 1.2 已发布。'],
  ['zh-TW', 'zh-Hant', '取消', 'Hikari 1.2 已推出。'],
  ['zh-HK', 'zh-Hant', '取消', 'Hikari 1.2 已推出。'],
  ['zh_Hans_TW', 'zh-Hans', '取消', 'Hikari 1.2 已发布。'],
  ['zh-Hant-CN', 'zh-Hant', '取消', 'Hikari 1.2 已推出。'],
  ['ja-JP', 'ja', 'キャンセル', 'Hikari 1.2 が利用可能です。']
]) {
  assert.deepEqual(api.setUiLocale(input), { ok: true, locale });
  assert.equal(nativeText('Cancel'), cancel);
  assert.equal(nativeText('Hikari {p0} is available.', { p0: '1.2' }), update);
  assert.equal(nativeText('Choose a folder'), 'Choose a folder', 'Uncatalogued native text retains English');
}
for (const invalid of ['fr', null, {}, [], 'not a locale', 'x'.repeat(10000)]) {
  assert.deepEqual(api.setUiLocale(invalid), { ok: true, locale: 'en' });
  assert.equal(nativeText('Cancel'), 'Cancel');
}
setLocale('en');
console.log('Language IPC: preload/main routing, Spanish/Chinese/Japanese regions, native catalogs, and invalid-value fallback passed.');
