const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createAgentMcpGateway } = require('../src/main/agent/mcp-contract/gateway.js');
const { callPluginCanvas } = require('../src/main/agent/mcp-contract/direct-tools/plugin-canvas.js');
const { callImageOutput } = require('../src/main/agent/mcp-contract/direct-tools/image-output.js');
const { buildHikariCodexMcpConfigBlock } = require('../src/main/agent/codex-agent/runtime-files.js');
const { buildCodexCliExecArgs, buildCodexCliExecResumeArgs } = require('../src/main/lib/codex-cli-provider/args.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'illustration-native-images-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const storage = path.join(temp, 'storage'), home = path.join(temp, 'codex-home');
  const generated = path.join(home, 'generated_images');
  await fs.mkdir(storage); await fs.mkdir(generated, { recursive: true });
  const nativePath = path.join(generated, 'component.png');
  await fs.writeFile(nativePath, png);
  await fs.writeFile(path.join(home, 'auth.json'), png); // valid bytes, forbidden location
  await fs.writeFile(path.join(storage, 'supplied.png'), png);
  const calls = [];
  const gateway = createAgentMcpGateway({ env: { HIKARI_CODEX_HOME: home }, workspacePath: storage,
    runTool: async (_id, args) => { calls.push(args); return { ok: true }; } });
  const importAsset = (asset, context) => gateway.callGatewayTool('plugin_canvas', {
    plugin_id: 'scientific-illustration', request: { action: 'apply' }, assets: [{ id: 'component', ...asset }]
  }, context);
  return { temp, storage, home, generated, nativePath, calls, importAsset };
}

test('fresh and resumed canvas requests enable native image generation without relaxing the sandbox', () => {
  for (const build of [buildCodexCliExecArgs, buildCodexCliExecResumeArgs]) {
    const args = build({ outputFile: '/tmp/answer', sessionId: 'saved-session', enableImageGeneration: true });
    const index = args.indexOf('features.image_generation=true');
    assert.ok(index > 0 && index < args.indexOf('exec'));
    assert.equal(args[index - 1], '-c');
    assert.equal(args[args.indexOf('-s') + 1], 'read-only');
    assert.equal(args[args.indexOf('-a') + 1], 'never');
    assert.equal(build({}).includes('features.image_generation=true'), false);
  }
});

test('MCP configuration binds native output imports to the actual managed Codex home', () => {
  const config = buildHikariCodexMcpConfigBlock({ mcpCommandPath: '/node', envOverrides: {
    HIKARI_CODEX_HOME: '/managed/home', HIKARI_CODEX_REQUEST_CONTEXT: JSON.stringify({ codexHomePath: '/forged' })
  } });
  assert.ok(config.includes('HIKARI_CODEX_HOME = "/managed/home"'));
});

test('native outputs outside Hikari storage import as embedded bytes using exact or relative paths', async t => {
  const f = await fixture(t);
  for (const sourcePath of [f.nativePath, 'component.png']) {
    assert.equal((await f.importAsset({ source: 'codex', path: sourcePath })).ok, true);
    assert.equal(f.calls.at(-1).assets.component.data_url, `data:image/png;base64,${png.toString('base64')}`);
    assert.equal(f.calls.at(-1).assets.component.path, undefined, 'Plugin receives bytes, no host path');
  }
  assert.equal((await f.importAsset({ path: 'supplied.png' })).ok, true);
  assert.equal((await f.importAsset({ source: 'storage', path: f.nativePath })).status, 'invalid_path');
  assert.equal((await callImageOutput({ path: f.nativePath, alt: 'component' }, {}, { workspacePath: f.storage })).status,
    'invalid_path', 'General image output remains confined to Hikari storage');
});

test('native imports reject traversal, sibling paths and symlink escapes before canvas edits', async t => {
  const f = await fixture(t);
  await fs.symlink(path.join(f.storage, 'supplied.png'), path.join(f.generated, 'escape.png'));
  for (const sourcePath of ['../auth.json', path.join(f.home, 'auth.json'), path.join(f.storage, 'supplied.png'), 'escape.png']) {
    assert.equal((await f.importAsset({ source: 'codex', path: sourcePath })).status, 'invalid_path');
  }
  assert.equal(f.calls.length, 0);
  await fs.rm(f.generated, { recursive: true });
  await fs.symlink(f.storage, f.generated);
  assert.equal((await f.importAsset({ source: 'codex', path: 'supplied.png' })).status, 'invalid_path');
  assert.equal(f.calls.length, 0);
});

test('agent context cannot redirect the native-image root or bypass missing host configuration', async t => {
  const f = await fixture(t);
  const context = { codexHomePath: f.storage, snapshot: { settings: { codexHomePath: f.storage } } };
  assert.equal((await f.importAsset({ source: 'codex', path: path.join(f.storage, 'supplied.png') }, context)).status, 'invalid_path');
  const result = await callPluginCanvas({ plugin_id: 'scientific-illustration', request: { action: 'apply' },
    assets: [{ id: 'component', source: 'codex', path: f.nativePath }] }, context, { workspacePath: f.storage });
  assert.equal(result.status, 'unavailable');
  assert.equal(f.calls.length, 0);
});

test('native imports validate image bytes and size; missing tools have an actionable failure', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.generated, 'invalid.png'), 'not an image');
  await fs.writeFile(path.join(f.generated, 'oversized.png'), Buffer.alloc(5 * 1024 * 1024 + 1));
  for (const filename of ['invalid.png', 'oversized.png']) {
    assert.equal((await f.importAsset({ source: 'codex', path: filename })).status, 'invalid_image');
  }
  await fs.rm(f.generated, { recursive: true });
  const missing = await f.importAsset({ source: 'codex', path: 'component.png' });
  assert.equal(missing.status, 'not_found'); assert.match(missing.error, /Codex image_gen/);
  assert.equal(f.calls.length, 0);
});

test('all complexity levels request Codex native generation and forbid provider substitution', async () => {
  const { agentInstructions } = await import('../plugins/scientific-illustration/agent/workflow.mjs');
  for (const complexity of ['simple', 'standard', 'detailed']) {
    const instructions = agentInstructions(complexity);
    assert.match(instructions, /built-in image_gen/);
    assert.match(instructions, /source:"codex"/);
    assert.match(instructions, /never silently switch providers/);
  }
});
