const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const folders = ['src/plugins/gel', 'plugins/scientific-illustration', 'plugins/qpcr-analysis'];
assert.equal(new Set(folders.map(folder => fs.readFileSync(path.join(root, folder, 'i18n.js'), 'utf8'))).size, 1, 'First-party plugin runtimes stay identical');
const parameters = message => [...new Set([...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
let checked = 0;
for (const [folder, namespace] of [['src/plugins/gel', 'gel'], ['plugins/scientific-illustration', 'figura']]) {
  const context = vm.createContext({});
  const index = fs.readFileSync(path.join(root, folder, 'index.html'), 'utf8');
  const scripts = [...index.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
    .map(match => match[1].replace(/^\.\//, ''))
    .filter(file => /^(?:locales\/(?:en|es|zh-Hans|zh-Hant|ja)|i18n)\.js$/.test(file));
  assert.equal(scripts.length, 6, 'Classic startup loads all catalogs and the runtime');
  for (const script of scripts) vm.runInContext(fs.readFileSync(path.join(root, folder, script), 'utf8'), context, { filename: script });
  const english = context.HikariUiEnglish[namespace], ui = context.HikariUi;
  for (const locale of ['zh-Hans', 'zh-Hant', 'ja']) {
    const catalog = context.HikariUiTranslations[locale][namespace];
    assert.deepEqual(Object.keys(catalog).sort(), Object.keys(english).sort(), `${namespace} ${locale} covers every English key`);
    assert.equal(ui.setLocale(locale), locale);
    for (const [key, message] of Object.entries(catalog)) {
      assert.equal(typeof message, 'string', `${namespace} ${locale} ${key}`);
      assert.ok(message.length > 0 || english[key] === '', 'Only intentionally empty source messages stay empty');
      assert.deepEqual(parameters(message), parameters(english[key]), `Interpolation is preserved: ${namespace} ${locale} ${key}`);
      const params = Object.fromEntries(parameters(message).map(name => [name, 'User <&> $&']));
      const expected = Object.entries(params).reduce((text, [name, value]) => text.split(`{${name}}`).join(value), message);
      assert.equal(ui.t(`${namespace}.${key}`, params), expected, 'Production translation is registered and interpolated literally');
      checked++;
    }
    const presentation = ui.createPresentation(namespace);
    assert.equal(presentation.englishText(presentation.message('Exported {p0}.', { p0: 'Raw <&>' })), 'Exported Raw <&>.', 'Canonical output stays English');
    assert.equal(ui.t('missing.key', {}, 'Original English'), 'Original English', 'Unknown messages retain their fallback');
    assert.match(presentation.html('<img src=x>'), /&lt;img src=x&gt;/, 'Source text is escaped at the HTML boundary');
  }
  for (const [input, expected] of [
    ['zh', 'zh-Hans'], ['zh-CN', 'zh-Hans'], ['zh-SG', 'zh-Hans'],
    ['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'], ['zh-MO', 'zh-Hant'],
    ['zh_Hant_TW', 'zh-Hant'], ['zh-Hans-TW', 'zh-Hans'], ['zh-Hant-CN', 'zh-Hant'],
    ['ja-JP', 'ja'], ['es-MX', 'es'], ['en-US', 'en']
  ]) assert.equal(ui.setLocale(input), expected, `Regional preference resolves consistently: ${input}`);
  for (const invalid of [null, {}, [], '', 'not a locale', 'fr']) assert.equal(ui.setLocale(invalid), 'en');
}
console.log(`Plugin catalogs: ${checked} Chinese/Japanese translations, classic startup, region resolution, placeholders, fallback, and canonical output checks passed.`);
