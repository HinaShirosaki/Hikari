module.exports = function registerPluginSettingsSuite(context = {}) {
  const { assert, fsPromises: fs, path, test } = context.scope;
  const root = context.__dirname;
  const { pathToFileURL } = require('node:url');
  const { normalizePluginSettingsSchema, normalizePluginSettingsStore } = require(path.join(root, 'src/shared/plugin-settings.mjs'));
  const schema = [
    { key: 'enabled', type: 'boolean', label: 'Enabled', default: true },
    { key: 'author', type: 'string', label: 'Author', default: '', maxLength: 16 },
    { key: 'dpi', type: 'number', label: 'Resolution', default: 300, min: 72, max: 1200, step: 1 },
    { key: 'format', type: 'select', label: 'Format', default: 'svg', options: [{ value: 'svg', label: 'SVG' }, { value: 'png', label: 'PNG' }] }
  ];
  const plugin = { id: 'settings-demo', permissions: ['settings', 'storage'], settings: normalizePluginSettingsSchema(schema) };

  test('plugin settings: manifest inspection validates schemas and requires a local settings grant', async () => {
    const { inspectPluginFolder } = require(path.join(root, 'src/main/lib/inspect-plugin-folder.js'));
    const temp = await fs.mkdtemp(path.join(root, 'tmp', 'plugin-settings-'));
    const dir = path.join(temp, plugin.id);
    try {
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html>');
      const manifest = { id: plugin.id, name: 'Demo', version: '1.0.0', permissions: ['settings'], settings: schema };
      const inspect = async changes => {
        await fs.writeFile(path.join(dir, 'plugin.json'), JSON.stringify({ ...manifest, ...changes }));
        return inspectPluginFolder({ fs, folderPath: dir });
      };
      const result = await inspect({});
      assert.equal(result.ok, true);
      assert.deepEqual(result.settings, plugin.settings);
      assert.equal((await inspect({ permissions: [] })).ok, false);
      assert.equal((await inspect({ embed: 'https://example.test', permissions: [] })).ok, false);
      assert.equal((await inspect({ tool: true })).ok, true, 'tool plugins can declare preferences');
      assert.equal((await inspect({ service: { fileConversions: [{ from: 'dna', to: 'gbk' }] } })).ok, true, 'headless services can use host preferences');
      for (const settings of [
        null, {}, [schema[0], schema[0]], [{ ...schema[0], key: 'constructor' }],
        [{ ...schema[0], key: '__proto__' }], [{ ...schema[0], type: 'html' }],
        [{ ...schema[0], default: 'true' }], [{ ...schema[0], label: '' }],
        [{ ...schema[1], default: 'x'.repeat(17) }], [{ ...schema[1], maxLength: 5000 }], [{ ...schema[1], maxLength: null }],
        [{ ...schema[2], min: 2000 }], [{ ...schema[2], step: 0 }],
        [{ ...schema[2], default: 300.5 }], [{ ...schema[2], default: null }],
        [{ ...schema[3], default: 'pdf' }], [{ ...schema[3], options: [] }],
        [{ ...schema[3], options: [schema[3].options[0], schema[3].options[0]] }],
        Array.from({ length: 41 }, (_, i) => ({ ...schema[0], key: `field${i}` }))
      ]) assert.equal((await inspect({ settings })).ok, false, JSON.stringify(settings).slice(0, 160));
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  });

  test('plugin settings: partial patches are atomic, bounded, independent of storage, and roll back on failure', async () => {
    const { readPluginSettings, writePluginSettings } = await import(pathToFileURL(path.join(root, 'src/renderer/lib/plugin-settings.js')).href);
    const state = { settings: { pluginStorage: { [plugin.id]: { records: ['keep'] } }, pluginSettings: { other: { author: 'other' } } } };
    let saves = 0;
    const events = [];
    const windowObject = { CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
      document: { dispatchEvent: event => events.push(event) } };
    const write = (values, persist = () => saves++) => writePluginSettings({ state, plugin, values, persist, windowObject });
    assert.deepEqual(readPluginSettings(state, plugin), { enabled: true, author: '', dpi: 300, format: 'svg' });
    assert.deepEqual(write({ author: 'Ada' }).values, { enabled: true, author: 'Ada', dpi: 300, format: 'svg' });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].detail, { pluginId: plugin.id });
    assert.deepEqual(state.settings.pluginSettings[plugin.id], { author: 'Ada' }, 'only overrides are stored');
    assert.deepEqual(state.settings.pluginStorage[plugin.id], { records: ['keep'] });
    assert.deepEqual(state.settings.pluginSettings.other, { author: 'other' });
    const before = JSON.stringify(state);
    for (const patch of [undefined, null, [], { author: 'x'.repeat(17) }, { enabled: 'true' }, { dpi: 71 },
      { dpi: NaN }, { dpi: Infinity }, { dpi: 300.5 }, { format: 'pdf' }, { author: 'new', unknown: true },
      JSON.parse('{"__proto__":true}'), { constructor: true }]) {
      assert.throws(() => write(patch));
      assert.equal(JSON.stringify(state), before);
    }
    assert.throws(() => write({ dpi: 600 }, () => { throw new Error('disk full'); }), /disk full/);
    assert.equal(JSON.stringify(state), before);
    assert.equal(events.length, 1, 'no events for rejected saves');
    write({ author: 'Ada' });
    assert.equal(saves, 1, 'unchanged patches do not save or broadcast');
    write({ dpi: 600 });
    assert.equal(readPluginSettings(state, plugin).author, 'Ada', 'partial updates retain other fields');
    write({ author: '', dpi: 300 });
    assert.deepEqual(state.settings.pluginSettings[plugin.id], {}, 'values equal to a default are not pinned');
    state.settings.pluginSettings[plugin.id].dpi = -1;
    assert.equal(readPluginSettings(state, plugin).dpi, 300, 'invalid imported values fall back to defaults');
  });

  test('plugin settings: state normalization retains schemas and preferences without trusting imported grants', async () => {
    const { normalizeState } = await import(pathToFileURL(path.join(root, 'src/renderer/modules/app-state/state-normalizer.js')).href);
    const entry = { ...plugin, name: 'Demo', path: '/tmp/settings-demo', entryUrl: 'file:///tmp/settings-demo/index.html' };
    const state = normalizeState({ settings: { plugins: [entry, { ...entry, id: 'remote', embedUrl: 'https://example.test' },
      { ...entry, id: 'invalid', settings: [{ ...schema[0], default: 'yes' }] }],
    pluginSettings: { [plugin.id]: { author: 'Ada', dpi: 600 }, removed: { format: 'png' }, bad: { nested: {}, large: 'x'.repeat(4001) } } } });
    assert.deepEqual(state.settings.plugins.find(p => p.id === plugin.id).settings, plugin.settings);
    assert.deepEqual(state.settings.plugins.find(p => p.id === 'remote').settings, []);
    assert.deepEqual(state.settings.plugins.find(p => p.id === 'invalid').settings, []);
    assert.deepEqual(state.settings.pluginSettings[plugin.id], { author: 'Ada', dpi: 600 });
    assert.deepEqual(state.settings.pluginSettings.removed, { format: 'png' });
    assert.deepEqual(state.settings.pluginSettings.bad, {});
    assert.deepEqual(normalizePluginSettingsStore(JSON.parse('{"__proto__":{"x":1},"ok":{"constructor":true}}')), { ok: {} });
  });

  test('plugin settings: bridge confines reads, writes, and change events to granted frame identity', async () => {
    const { createPluginBridge, PLUGIN_BRIDGE_VERBS } = await import(pathToFileURL(path.join(root, 'src/renderer/app/plugin-bridge.js')).href);
    const listeners = new Map();
    const windowObject = { addEventListener() {}, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
      document: { addEventListener: (name, callback) => listeners.set(name, callback), dispatchEvent: event => listeners.get(event.type)?.(event) } };
    const state = { settings: { pluginSettings: { neighbour: { author: 'private' } } } };
    let fail = false;
    const bridge = createPluginBridge({ state, windowObject, persist: () => { if (fail) throw new Error('disk full'); } });
    const origin = 'http://127.0.0.1:43210';
    const makeFrame = () => ({ messages: [], postMessage(message, target) { this.messages.push({ message, target }); } });
    const owner = makeFrame(), neighbour = makeFrame(), denied = makeFrame(), unknown = makeFrame();
    bridge.register(owner, plugin, origin);
    bridge.register(neighbour, { ...plugin, id: 'neighbour' }, origin);
    bridge.register(denied, { ...plugin, permissions: [] }, origin);
    let id = 0;
    const send = (frame, verb, params = {}, sourceOrigin = origin) => {
      const requestId = ++id;
      bridge.handleMessage({ source: frame, origin: sourceOrigin, data: { hikari: 1, id: requestId, verb, params } });
      return frame.messages.find(entry => entry.message.id === requestId)?.message;
    };
    assert.equal(PLUGIN_BRIDGE_VERBS['settings.get'], 'settings');
    assert.equal(PLUGIN_BRIDGE_VERBS['settings.set'], 'settings');
    assert.equal(send(unknown, 'settings.get'), undefined);
    assert.equal(send(denied, 'settings.get').ok, false);
    assert.equal(send(denied, 'settings.set', { values: { author: 'hacked' } }).ok, false);
    assert.equal(send(owner, 'settings.get', { pluginId: 'neighbour' }).result.values.author, '');
    assert.equal(send(owner, 'settings.set', { pluginId: 'neighbour', values: { author: 'Ada' } }).ok, true);
    assert.equal(state.settings.pluginSettings.neighbour.author, 'private');
    const updates = frame => frame.messages.filter(entry => entry.message.event === 'settings.changed');
    assert.equal(updates(owner).length, 1);
    assert.equal(updates(neighbour).length, 0);
    assert.equal(updates(denied).length, 0);
    assert.equal(updates(owner)[0].target, origin);
    assert.equal(updates(owner)[0].message.payload.values.author, 'Ada');
    fail = true;
    assert.equal(send(owner, 'settings.set', { values: { author: 'Grace' } }).ok, false);
    assert.equal(updates(owner).length, 1);
    assert.equal(send(owner, 'settings.get').result.values.author, 'Ada');
    assert.equal(send(owner, 'settings.get', {}, 'https://replacement.test'), undefined, 'navigated frames lose the grant');
  });
};
