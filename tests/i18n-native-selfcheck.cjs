const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const espree = require(require.resolve('espree', { paths: [path.dirname(require.resolve('eslint'))] }));
const ui = require('../src/main/lib/i18n.js');
const english = require('../src/main/lib/locales/en.json');
const folder = path.resolve(__dirname, '../src/main');
let checked = 0;
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'CallExpression' && node.callee.name === 'nativeText' && typeof node.arguments[0]?.value === 'string') {
    const fallback = node.arguments[0].value;
    assert.equal(english[ui.keyFor(fallback)], fallback, `Native English catalog: ${fallback}`);
    checked++;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') visit(value);
  }
}
for (const file of fs.readdirSync(folder, { recursive: true }).filter(f => f.endsWith('.js') && !f.startsWith('lib/locales/'))) {
  visit(espree.parse(fs.readFileSync(path.join(folder, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'commonjs' }));
}
assert.ok(checked >= 20);
const text = 'You are using Hikari {version}.';
assert.equal(ui.nativeText(text, { version: '1.2' }), 'You are using Hikari 1.2.');
assert.equal(ui.setLocale('es-MX'), 'es');
assert.equal(ui.nativeText('Hikari {p0} is available.', { p0: '1.2' }), 'Hikari 1.2 está disponible.');
assert.equal(ui.nativeText('Choose a folder'), 'Choose a folder', 'Missing native translations retain English');
assert.equal(ui.setLocale('not a locale'), 'en');
assert.equal(ui.nativeText(text, { version: '1.2' }), 'You are using Hikari 1.2.');
console.log(`Native i18n: ${checked} dialog/filter/button call sites and English/Spanish interpolation/fallback checks passed.`);
