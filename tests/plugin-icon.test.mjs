import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadPluginIcons, pluginIconMarkup } from '../src/renderer/app/plugin-loader.js';

const require = createRequire(import.meta.url);
const { inspectPluginFolder } = require('../src/main/lib/inspect-plugin-folder.js');
const manifest = { id: 'icon-plugin', name: 'Icon plugin', version: '1.0.0' };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

test('plugin icons are optional, bounded SVG files confined to the installed folder', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-icon-'));
  try {
    const folderPath = path.join(temp, manifest.id);
    await fs.mkdir(folderPath);
    await fs.writeFile(path.join(folderPath, 'index.html'), '<title>Plugin</title>');
    const inspect = async icon => {
      await fs.writeFile(path.join(folderPath, 'plugin.json'), JSON.stringify({ ...manifest, icon }));
      return inspectPluginFolder({ fs, folderPath });
    };
    assert.equal((await inspect()).iconDataUrl, '');
    await fs.mkdir(path.join(folderPath, 'assets'));
    await fs.writeFile(path.join(folderPath, 'assets/icon.svg'), svg);
    assert.equal((await inspect('assets/icon.svg')).iconDataUrl, dataUrl);
    for (const icon of ['../outside.svg', '/outside.svg', 'C:/outside.svg', 'assets\\icon.svg', 'https://example.com/icon.svg', 'data:image/svg+xml,hi', 'assets/../icon.svg', {}, 'assets/icon.png', 'missing.svg', 'assets']) {
      assert.equal((await inspect(icon)).ok, false, `reject ${String(icon)}`);
    }
    await fs.writeFile(path.join(temp, 'outside.svg'), svg);
    await fs.symlink(path.join(temp, 'outside.svg'), path.join(folderPath, 'linked.svg'));
    assert.equal((await inspect('linked.svg')).ok, false, 'a symlink cannot escape the folder');
    await fs.symlink(temp, path.join(folderPath, 'linked-folder'));
    assert.equal((await inspect('linked-folder/outside.svg')).ok, false, 'parent symlinks cannot escape either');
    await fs.writeFile(path.join(folderPath, 'large.svg'), svg + ' '.repeat(32768));
    assert.equal((await inspect('large.svg')).ok, false);
    await fs.writeFile(path.join(folderPath, 'invalid.svg'), '<html>Wrong type</html>');
    assert.equal((await inspect('invalid.svg')).ok, false);
    await fs.writeFile(path.join(folderPath, 'limit.svg'), svg.padEnd(32768));
    const atLimit = await inspect('limit.svg');
    assert.equal(atLimit.ok, true);
    assert.match(pluginIconMarkup(atLimit.iconDataUrl), /data-plugin-icon/);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('icon refresh loads assets for existing installs without changing permissions or identity', async () => {
  const plugin = { id: manifest.id, path: '/installed/icon-plugin', permissions: ['storage'] };
  const app = { id: `plugin-${manifest.id}`, iconMarkup: pluginIconMarkup('') };
  let reads = 0;
  const api = { inspectPluginFolder: async () => {
    reads += 1;
    return { ok: true, ...manifest, permissions: ['files'], iconDataUrl: dataUrl };
  } };
  const before = structuredClone(plugin);
  await loadPluginIcons({ plugins: [plugin, { ...plugin, bundled: true }, { ...plugin, enabled: false }, { ...plugin, service: {} }], appRegistry: [app], api });
  assert.equal(reads, 1);
  assert.match(app.iconMarkup, /data-plugin-icon/);
  assert.deepEqual(plugin, before);
  for (const inspected of [{ ok: false }, { ok: true, id: 'different', iconDataUrl: dataUrl }]) {
    await loadPluginIcons({ plugins: [plugin], appRegistry: [app], api: { inspectPluginFolder: async () => inspected } });
    assert.doesNotMatch(app.iconMarkup, /data-plugin-icon/);
  }
  await loadPluginIcons({ plugins: [plugin], appRegistry: [app], api: { inspectPluginFolder: async () => { throw new Error('unavailable'); } } });
  await loadPluginIcons({ plugins: [plugin], appRegistry: [app] });
});

test('untrusted icon data never becomes executable host markup or a URL injection', () => {
  for (const value of [undefined, {}, 'https://example.com/a.svg', 'data:image/svg+xml,<svg onload="alert(1)">', `${dataUrl}')"><script>alert(1)</script>`, 'data:image/svg+xml;base64,abc', 'data:image/svg+xml;base64,' + 'a'.repeat(44000)]) {
    assert.doesNotMatch(pluginIconMarkup(value), /data-plugin-icon/);
  }
  const hostile = '<svg xmlns="http://www.w3.org/2000/svg"><script>parent.pwned=1</script><foreignObject><body onload="alert(1)"/></foreignObject></svg>';
  const markup = pluginIconMarkup(`data:image/svg+xml;base64,${Buffer.from(hostile).toString('base64')}`);
  assert.match(markup, /data-plugin-icon/);
  assert.doesNotMatch(markup, /<script|<foreignObject|onload/);
  assert.match(markup, /fill="currentColor"/);
});
