#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { TextEncoder } = require('node:util');
const vm = require('node:vm');

const {
  createMemoryStorage,
  loadEsmStyleModule,
  toCamelCase,
  MockClassList,
  MockElement,
  createMockDocument,
  wireFormReset,
  trigger,
  flushAsync,
  btoaPolyfill,
  atobPolyfill,
  encodeBase64Url
} = require('./tests/support/runtime.js');
fs.mkdirSync(path.join(__dirname, 'tmp'), { recursive: true });

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

const memoryStorage = createMemoryStorage();
const shared = {
  ...loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'views.js')),
  ...loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'utils.js')),
  ...loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'app-state.js'), {
    localStorage: memoryStorage
  })
};

const agentProtocolGeneration = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-protocol-generation.js'));
const agentProtocolMatching = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-protocol-matching.js'));
const agentNotebookGeneration = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-notebook-generation.js'));
const agentNotebookDraft = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-notebook-draft.js'));
const agentInventoryLookup = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-inventory-lookup.js'));
const agentSubAgent = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-sub-agent.js'));
const agentChatLog = require(path.join(__dirname, 'src', 'main', 'agent', 'context', 'agent-chat-log.js'));
const agentMemory = require(path.join(__dirname, 'src', 'main', 'agent', 'context', 'agent-memory.js'));
const agentToolLoading = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-tool-loading.js'));
const agentToolExecution = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-tool-execution.js'));
const agentLiteratureSearch = require(path.join(__dirname, 'src', 'main', 'papers', 'search', 'agent-literature-search.js'));
const agentLiteratureSearchWorkflow = require(path.join(__dirname, 'src', 'main', 'papers', 'workflow', 'agent-literature-search-workflow.js'));
const agentPaperContextLoader = require(path.join(__dirname, 'src', 'main', 'papers', 'retrieve', 'agent-paper-context-loader.js'));
const agentPaperDownload = require(path.join(__dirname, 'src', 'main', 'papers', 'download', 'agent-paper-download.js'));
const agentPaperKnowledgeDatabase = require(path.join(__dirname, 'src', 'main', 'papers', 'store', 'agent-paper-knowledge-database.js'));
const agentPaperAnalysis = require(path.join(__dirname, 'src', 'main', 'papers', 'analysis', 'agent-paper-analysis.js'));
const paperMarkdownImport = require(path.join(__dirname, 'src', 'main', 'papers', 'parse', 'paper-markdown-import.js'));
const agentToolSmokeTest = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-tool-smoke-test.js'));
const agentObservability = require(path.join(__dirname, 'src', 'main', 'agent', 'shared', 'agent-observability.js'));
const agentPython = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-python-sandbox.js'));
const sequenceLibrary = require(path.join(
  __dirname,
  'src',
  'renderer',
  'modules',
  'sequence-viewer',
  'main-process',
  'sequence-library'
));
const toolBox = loadEsmStyleModule(
  path.join(__dirname, 'src', 'renderer', 'modules', 'tool-box.js'),
  {},
  [
    'toNumber',
    'formatSequenceLines',
    'concentrationToM',
    'concentrationFromM',
    'volumeToL',
    'volumeFromL',
    'massToG',
    'massFromG',
    'cleanNucleotideSequence',
    'nucleotideCounts',
    'reverseComplementDna',
    'translateDnaSequence',
    'cleanProteinSequence',
    'parseRestrictionSites',
    'getCodonOptionsForResidue',
    'reverseTranslateProteinSequence',
    'oligoMolecularWeight',
    'oligoExtinction',
    'oligoTm',
    'linearRegression',
    'cleanSequence',
    'countResidues',
    'calculatePeptideMass',
    'positiveCharge',
    'negativeCharge',
    'calculateNetCharge',
    'estimatePI',
    'residueSummary',
    'peptideStats',
    'normalizeIupacPattern',
    'matchesIupacPattern',
    'parseCrisprTargetsInput',
    'collectCrisprPamSites',
    'computeCrisprOffTargetStats',
    'designCrisprGuides'
  ]
);
const sequenceViewerInternals = loadEsmStyleModule(
  path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
  {},
  [
    'normalizeSequenceText',
    'detectSequenceFormat',
    'parseFastaRecords',
    'parseFastqRecords',
    'parseGenBankRecords',
    'parseInputRecords',
    'normalizeExternalPayload',
    'parseGenBankLocationSegments',
    'normalizeFeatureType',
    'getFeatureTypeGenbankKey',
    'complementBase',
    'complementSequence',
    'renderDualStrandSequenceLinesHtml',
    'computeRestrictionAnnotationGeometry',
    'buildRestrictionCutPolylinePoints',
    'formatSelectedFeatureDetailHtml',
    'computeGcPercent',
    'countAmbiguousBases',
    'summarizeFastqQuality',
    'buildCircularPreviewHtmlDocument'
  ]
);
const gelAnalysisInternals = loadEsmStyleModule(
  path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'public-api.js'),
  {},
  [
    'clamp',
    'round',
    'mean',
    'confidenceLabel',
    'createEmptyManualOverrides',
    'normalizeLaneBandWindows',
    'normalizeLaneVertices',
    'normalizePeakIntegrations',
    'getLaneRowBounds',
    'getLaneRowSegment',
    'getLaneRectifiedWidth',
    'lanePointToRectifiedRow',
    'laneContainsPoint',
    'getTargetBandWindowForLane',
    'isPerLaneBandMode',
    'normalizeManualOverrides',
    'analyzeGelImage',
    'safeFilePart',
    'escapeCsv',
    'computeHistogramPercentiles',
    'normalizeArrayRange',
    'buildGaussianKernel',
    'gaussianBlur2d',
    'linearRegression',
    'buildCalibration',
    'applyCalibrationToBands',
    'applyNormalization',
    'clusterBandsAcrossLanes',
    'computeLaneConfidence',
    'interpretLane'
  ]
);
const gelLaneTableInternals = loadEsmStyleModule(
  path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'rendering', 'lane-table.js')
);
const papersPdfViewerInternals = loadEsmStyleModule(
  path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'index.js')
);
const assayAnalysis = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'assay', 'analysis', 'index.js'));
const mainUtils = require(path.join(__dirname, 'src', 'main', 'lib', 'main-utils.js'));
const telegramBot = require(path.join(__dirname, 'src', 'main', 'lib', 'telegramBot.js'));
const forgeConfig = require(path.join(__dirname, 'forge.config.js'));
const packageManifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

const sourceCache = new Map();

function readSource(relativePath) {
  const filePath = path.join(__dirname, relativePath);
  if (!sourceCache.has(filePath)) {
    sourceCache.set(filePath, fs.readFileSync(filePath, 'utf8'));
  }
  return sourceCache.get(filePath);
}

function assertClose(actual, expected, epsilon = 1e-6) {
  assert.equal(Number.isFinite(actual), true, `Expected finite number, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`);
}

const registerCoreSuite = require(path.join(__dirname, 'tests', 'suites', 'core-suite.js'));
const registerEdgeSuite = require(path.join(__dirname, 'tests', 'suites', 'edge-suite.js'));

const suiteScope = {
  assert,
  fs,
  fsPromises,
  path,
  TextEncoder,
  vm,
  createMemoryStorage,
  loadEsmStyleModule,
  toCamelCase,
  MockClassList,
  MockElement,
  createMockDocument,
  wireFormReset,
  trigger,
  flushAsync,
  btoaPolyfill,
  atobPolyfill,
  encodeBase64Url,
  test,
  shared,
  agentProtocolGeneration,
  agentProtocolMatching,
  agentNotebookGeneration,
  agentNotebookDraft,
  agentInventoryLookup,
  agentSubAgent,
  agentChatLog,
  agentMemory,
  agentToolLoading,
  agentToolExecution,
  agentLiteratureSearch,
  agentLiteratureSearchWorkflow,
  agentPaperContextLoader,
  agentPaperDownload,
  agentPaperKnowledgeDatabase,
  agentPaperAnalysis,
  paperMarkdownImport,
  agentToolSmokeTest,
  agentObservability,
  agentPython,
  sequenceLibrary,
  toolBox,
  sequenceViewerInternals,
  gelAnalysisInternals,
  gelLaneTableInternals,
  papersPdfViewerInternals,
  assayAnalysis,
  mainUtils,
  telegramBot,
  forgeConfig,
  packageManifest,
  readSource,
  assertClose
};

registerCoreSuite({ __dirname, scope: suiteScope });
registerEdgeSuite({ __dirname, scope: suiteScope });

test('plugin system: inspect-plugin-folder enforces the required folder shape', async () => {
  const { inspectPluginFolder } = require(path.join(__dirname, 'src', 'main', 'lib', 'inspect-plugin-folder.js'));
  // The folder must be named after the manifest id, so the fixture is too.
  const dir = path.join(__dirname, 'tmp', 'my-plugin');
  await fsPromises.rm(dir, { recursive: true, force: true });
  await fsPromises.mkdir(dir, { recursive: true });
  const writeManifest = (manifest) => fsPromises.writeFile(
    path.join(dir, 'plugin.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest)
  );
  const valid = { id: 'my-plugin', name: 'My Plugin', version: '1.0.0', description: 'demo' };

  const relative = await inspectPluginFolder({ fs: fsPromises, folderPath: 'relative/path' });
  assert.equal(relative.ok, false);

  const missingEntry = await inspectPluginFolder({ fs: fsPromises, folderPath: dir });
  assert.equal(missingEntry.ok, false);

  await fsPromises.writeFile(path.join(dir, 'index.html'), '<!DOCTYPE html><title>x</title>');
  const missingManifest = await inspectPluginFolder({ fs: fsPromises, folderPath: dir });
  assert.equal(missingManifest.ok, false, 'plugin.json is required, not optional');

  await writeManifest(valid);
  const result = await inspectPluginFolder({ fs: fsPromises, folderPath: dir });
  assert.equal(result.ok, true);
  assert.equal(result.id, 'my-plugin');
  assert.equal(result.name, 'My Plugin');
  assert.equal(result.version, '1.0.0');
  assert.deepEqual(result.permissions, []);
  assert.ok(result.entryUrl.startsWith('file://'));
  assert.ok(result.entryUrl.endsWith('/index.html'));

  await writeManifest({ ...valid, permissions: ['notebook:read', 'notebook:write'] });
  const permitted = await inspectPluginFolder({ fs: fsPromises, folderPath: dir });
  assert.deepEqual(permitted.permissions, ['notebook:read', 'notebook:write']);

  for (const [label, manifest] of [
    ['unparseable manifest', '{not json'],
    ['missing id', { name: 'X', version: '1.0.0' }],
    ['non-kebab id', { ...valid, id: 'My_Plugin' }],
    ['id not matching folder name', { ...valid, id: 'other-plugin' }],
    ['missing name', { id: 'my-plugin', version: '1.0.0' }],
    ['bad version', { ...valid, version: '1.0' }],
    ['unknown permission', { ...valid, permissions: ['filesystem:write'] }],
    ['non-array permissions', { ...valid, permissions: 'notebook:read' }]
  ]) {
    await writeManifest(manifest);
    const rejected = await inspectPluginFolder({ fs: fsPromises, folderPath: dir });
    assert.equal(rejected.ok, false, `${label} must be rejected`);
    assert.ok(rejected.error, `${label} must report a reason`);
  }
});

test('plugin system: remote plugins require https and cannot hold host permissions', async () => {
  const { inspectPluginFolder } = require(path.join(__dirname, 'src', 'main', 'lib', 'inspect-plugin-folder.js'));
  const dir = path.join(__dirname, 'tmp', 'remote-plugin');
  await fsPromises.rm(dir, { recursive: true, force: true });
  await fsPromises.mkdir(dir, { recursive: true });
  const writeManifest = (manifest) => fsPromises.writeFile(
    path.join(dir, 'plugin.json'),
    JSON.stringify(manifest)
  );
  const valid = { id: 'remote-plugin', name: 'Remote', version: '1.0.0', embed: 'https://ij.imjoy.io/' };

  // A remote plugin is manifest-only: no index.html anywhere in the folder.
  await writeManifest(valid);
  const remote = await inspectPluginFolder({ fs: fsPromises, folderPath: dir });
  assert.equal(remote.ok, true, 'embed replaces the index.html requirement');
  assert.equal(remote.embedUrl, 'https://ij.imjoy.io/');
  assert.equal(remote.entryUrl, '', 'a remote plugin has no local entry url');
  assert.deepEqual(remote.permissions, []);

  for (const [label, manifest] of [
    // http/file would be same-origin-ish to the host once allow-same-origin is
    // applied, which is exactly the case this must never permit.
    ['http embed', { ...valid, embed: 'http://ij.imjoy.io/' }],
    ['file embed', { ...valid, embed: 'file:///etc/passwd' }],
    ['relative embed', { ...valid, embed: '/index.html' }],
    ['embed plus permissions', { ...valid, permissions: ['notebook:read'] }]
  ]) {
    await writeManifest(manifest);
    const rejected = await inspectPluginFolder({ fs: fsPromises, folderPath: dir });
    assert.equal(rejected.ok, false, `${label} must be rejected`);
  }
});

test('plugin system: only non-host origins get allow-same-origin', async () => {
  const { isSameOriginSafeUrl } = await import(
    pathToFileURL(path.join(__dirname, 'src', 'renderer', 'app', 'plugin-loader.js')).href
  );
  for (const safe of ['https://ij.imjoy.io/', 'http://127.0.0.1:51234/', 'http://[::1]:8080/']) {
    assert.equal(isSameOriginSafeUrl(safe), true, `${safe} is a distinct origin from the file:// host`);
  }
  for (const hostile of [
    // Plaintext to a remote host, and anything that would inherit the host's
    // own file:// origin.
    'http://ij.imjoy.io/',
    'http://evil.test/',
    'file:///Users/me/plugin/index.html',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    '',
    null,
    undefined
  ]) {
    assert.equal(isSameOriginSafeUrl(hostile), false, `${String(hostile)} must not qualify for allow-same-origin`);
  }
});

test('plugin server: refuses to serve anything outside the plugin folder', async () => {
  const { resolveRequestPath, contentTypeFor } = require(path.join(__dirname, 'src', 'main', 'lib', 'plugin-server.js'));
  const root = path.join(__dirname, 'tmp', 'served-plugin');

  assert.equal(resolveRequestPath(root, '/'), path.join(root, 'index.html'), 'bare / maps to index.html');
  assert.equal(resolveRequestPath(root, '/ij153/ij.jar'), path.join(root, 'ij153', 'ij.jar'));

  // The invariant is "never resolves outside the folder", not any particular
  // rejection mechanism: URL parsing normalizes plain ../ away (so it lands
  // harmlessly inside root and 404s), while percent-encoded traversal survives
  // parsing and is caught by the explicit boundary check. Both are safe, so
  // assert the property rather than the route taken to it.
  for (const hostile of [
    '/../../../../etc/passwd',
    '/..%2f..%2f..%2fetc%2fpasswd',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/subdir/../../../etc/passwd',
    '/%00/etc/passwd',
    '//etc/passwd',
    '/....//....//etc/passwd',
    '/../served-plugin-evil/secret.txt'
  ]) {
    const resolved = resolveRequestPath(root, hostile);
    if (resolved !== null) {
      assert.ok(
        resolved === root || resolved.startsWith(root + path.sep),
        `${hostile} resolved outside the plugin folder: ${resolved}`
      );
    }
  }

  assert.equal(contentTypeFor('/a/b.wasm'), 'application/wasm');
  assert.equal(contentTypeFor('/a/b.jar'), 'application/java-archive');
  assert.equal(contentTypeFor('/a/b.unknown'), 'application/octet-stream', 'unknown types are not guessed');
});

test('plugin server: serves files over loopback and 404s the rest', async () => {
  const { createPluginServer } = require(path.join(__dirname, 'src', 'main', 'lib', 'plugin-server.js'));
  const root = path.join(__dirname, 'tmp', 'served-plugin');
  await fsPromises.rm(root, { recursive: true, force: true });
  await fsPromises.mkdir(path.join(root, 'sub'), { recursive: true });
  await fsPromises.writeFile(path.join(root, 'index.html'), '<!doctype html>hi');
  await fsPromises.writeFile(path.join(root, 'sub', 'app.js'), 'export const x = 1;');
  // A file next to the plugin folder that must stay unreachable.
  await fsPromises.writeFile(path.join(__dirname, 'tmp', 'outside-secret.txt'), 'SECRET');

  const instance = createPluginServer({ rootPath: root });
  const baseUrl = await instance.listen();
  try {
    assert.ok(baseUrl.startsWith('http://127.0.0.1:'), 'server binds to loopback only');

    const index = await fetch(baseUrl);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.equal((await index.text()).includes('hi'), true);

    const script = await fetch(`${baseUrl}sub/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);

    assert.equal((await fetch(`${baseUrl}nope.txt`)).status, 404);
    assert.equal((await fetch(`${baseUrl}../outside-secret.txt`)).status, 404,
      'fetch normalizes the traversal away; the file stays unreachable');

    // Raw traversal that bypasses fetch's URL normalization.
    const raw = await new Promise((resolve) => {
      const url = new URL(baseUrl);
      require('node:http').get({
        host: url.hostname,
        port: url.port,
        path: '/../outside-secret.txt'
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
    });
    assert.notEqual(raw.status, 200, 'raw ../ traversal must not succeed');
    assert.equal(raw.body.includes('SECRET'), false, 'secret never leaves the folder');

    const post = await fetch(baseUrl, { method: 'POST' });
    assert.equal(post.status, 405, 'only GET/HEAD are served');
  } finally {
    await instance.close();
  }
});

test('plugin system: state normalizer strips unsafe embeds and remote permissions', async () => {
  const { normalizeState } = await import(
    pathToFileURL(path.join(__dirname, 'src', 'renderer', 'modules', 'app-state', 'state-normalizer.js')).href
  );
  const { settings } = normalizeState({
    settings: {
      plugins: [
        // Hand-edited settings must not be able to grant a remote frame the
        // host's own origin, nor give remote code host permissions.
        { id: 'downgraded', name: 'A', entryUrl: 'file:///a/index.html', embedUrl: 'http://evil.test/' },
        { id: 'grabby', name: 'B', embedUrl: 'https://ij.imjoy.io/', permissions: ['notebook:write'] },
        { id: 'local', name: 'C', entryUrl: 'file:///c/index.html', permissions: ['notebook:read'] },
        { id: 'nowhere', name: 'D' }
      ]
    }
  });

  const byId = Object.fromEntries(settings.plugins.map((plugin) => [plugin.id, plugin]));
  assert.equal(byId.downgraded.embedUrl, '', 'non-https embed is dropped');
  assert.equal(byId.grabby.embedUrl, 'https://ij.imjoy.io/');
  assert.deepEqual(byId.grabby.permissions, [], 'remote plugins lose host permissions');
  assert.deepEqual(byId.local.permissions, ['notebook:read'], 'local permissions survive');
  assert.equal(byId.nowhere, undefined, 'an entry with neither entryUrl nor embedUrl is dropped');
});

test('plugin system: every plugin view is built with the mandatory left rail', async () => {
  const { installPlugins } = await import(
    pathToFileURL(path.join(__dirname, 'src', 'renderer', 'app', 'plugin-loader.js')).href
  );

  // Minimal DOM: just enough of createElement/append/tree-query for the loader.
  function makeNode(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      title: '',
      src: '',
      textContent: '',
      children: [],
      attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, String(value)); },
      getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; },
      append(...kids) { this.children.push(...kids); }
    };
    return node;
  }
  function walk(node, fn) {
    for (const child of node.children) { fn(child); walk(child, fn); }
  }
  function findAll(root, predicate) {
    const out = [];
    walk(root, (node) => { if (predicate(node)) out.push(node); });
    return out;
  }
  const hasClass = (node, cls) => String(node.className || '').split(/\s+/).includes(cls);

  const workspace = makeNode('div');
  workspace.className = 'workspace-main';
  const documentObject = {
    createElement: (tag) => makeNode(tag),
    querySelector: (sel) => (sel === '.workspace-main' ? workspace : null),
    getElementById: (id) => findAll(workspace, (node) => node.id === id)[0] || null
  };

  const state = {
    settings: {
      plugins: [
        { id: 'served-one', name: 'Served One', description: 'A served plugin', serve: true, path: '/tmp/served-one', permissions: [] },
        { id: 'local-one', name: 'Local One', entryUrl: 'file:///tmp/local-one/index.html', permissions: ['notebook:read'] }
      ]
    }
  };
  const appRegistry = [];
  // api.servePluginFolder is async; the frame src arrives later and is not
  // needed for the rail-shape assertions.
  installPlugins({ state, documentObject, appRegistry, api: { servePluginFolder: () => new Promise(() => {}) } });

  for (const pluginId of ['served-one', 'local-one']) {
    const section = documentObject.getElementById(`plugin-${pluginId}-view`);
    assert.ok(section, `${pluginId} view section exists`);

    const layouts = findAll(section, (node) => hasClass(node, 'left-rail-template'));
    assert.equal(layouts.length, 1, `${pluginId} has exactly one left-rail-template layout`);

    // The rail is present and opts into the shared, draggable width.
    const rails = findAll(section, (node) => node.getAttribute('data-sync-left-rail') !== null);
    assert.equal(rails.length, 1, `${pluginId} has the mandatory rail`);
    assert.ok(hasClass(rails[0], 'left-rail-template__rail'), `${pluginId} rail uses the template rail class`);

    // The iframe lives in the main pane, not loose in the section.
    const frames = findAll(section, (node) => node.tagName === 'IFRAME');
    assert.equal(frames.length, 1, `${pluginId} has one frame`);
    const mains = findAll(section, (node) => hasClass(node, 'left-rail-template__main'));
    assert.equal(mains.length, 1);
    assert.ok(mains[0].children.includes(frames[0]), `${pluginId} frame is inside the main pane`);

    // The rail names the plugin and states its host access.
    const railText = findAll(rails[0], () => true).map((node) => node.textContent).join(' | ');
    assert.ok(railText.includes(pluginId === 'served-one' ? 'Served One' : 'Local One'), `${pluginId} rail shows the name`);
    assert.ok(/Host access/.test(railText), `${pluginId} rail states host access`);
  }

  // Kind and access are reported accurately per plugin.
  const servedRail = findAll(documentObject.getElementById('plugin-served-one-view'), (n) => n.getAttribute('data-sync-left-rail') !== null)[0];
  const servedText = findAll(servedRail, () => true).map((n) => n.textContent).join(' | ');
  assert.ok(servedText.includes('Served plugin'), 'served plugin is labelled as such');
  assert.ok(servedText.includes('Host access: none'), 'served plugin with no permissions says none');

  const localRail = findAll(documentObject.getElementById('plugin-local-one-view'), (n) => n.getAttribute('data-sync-left-rail') !== null)[0];
  const localText = findAll(localRail, () => true).map((n) => n.textContent).join(' | ');
  assert.ok(localText.includes('Local plugin'), 'local plugin is labelled as such');
  assert.ok(localText.includes('notebook:read'), 'local plugin lists its declared permission');
});

test('plugin system: bridge gates verbs on manifest permissions and frame identity', async () => {
  const { createPluginBridge } = await import(
    pathToFileURL(path.join(__dirname, 'src', 'renderer', 'app', 'plugin-bridge.js')).href
  );

  const state = {
    protocols: [{ id: 'p1', name: 'Gel run', steps: [] }],
    notebookEntries: [{ id: 'n1', experimentName: 'Exp 1', resultText: 'first', resultTables: [] }]
  };
  let persisted = 0;
  const listeners = [];
  const bridge = createPluginBridge({
    state,
    persist: () => { persisted += 1; },
    windowObject: { addEventListener: (_type, fn) => listeners.push(fn) }
  });
  assert.equal(listeners.length, 1, 'bridge subscribes to window messages');

  // Each fake frame is its own object identity, exactly like a contentWindow.
  const makeFrame = () => {
    const replies = [];
    return { replies, postMessage: (payload) => replies.push(payload) };
  };
  const reader = makeFrame();
  const stranger = makeFrame();
  bridge.register(reader, { id: 'reader', permissions: ['notebook:read', 'notebook:write'] });

  const send = (source, verb, params = {}) => {
    bridge.handleMessage({ source, data: { hikari: 1, id: verb, verb, params } });
    return source.replies[source.replies.length - 1];
  };

  // Unregistered frames get no reply at all — not even an error.
  bridge.handleMessage({ source: stranger, data: { hikari: 1, id: 'x', verb: 'notebook.list' } });
  assert.equal(stranger.replies.length, 0);

  assert.equal(send(reader, 'notebook.list').ok, true);
  assert.equal(send(reader, 'notebook.list').result[0].experimentName, 'Exp 1');

  // Declared read/write permissions do not imply unrelated ones.
  const denied = send(reader, 'protocols.list');
  assert.equal(denied.ok, false);
  assert.ok(denied.error.includes('protocols:read'));

  assert.equal(send(reader, 'nope.nope').ok, false, 'unknown verbs are rejected');

  const appended = send(reader, 'notebook.appendResult', {
    entryId: 'n1',
    text: 'second',
    table: { columns: [{ field: 'area', title: 'Area' }], rows: [{ id: 'r1', area: '12' }] }
  });
  assert.equal(appended.ok, true);
  assert.equal(persisted, 1, 'writes persist state');
  assert.equal(state.notebookEntries[0].resultText, 'first\n\nsecond');
  assert.equal(state.notebookEntries[0].resultTables.length, 1);

  assert.equal(send(reader, 'notebook.appendResult', { entryId: 'missing', text: 'x' }).ok, false);
  assert.equal(send(reader, 'notebook.appendResult', { entryId: 'n1' }).ok, false, 'empty writes are rejected');
});

async function run() {
  let passed = 0;

  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      console.log(`PASS ${item.name}`);
    } catch (error) {
      console.error(`FAIL ${item.name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    }
  }

  console.log(`\n${passed}/${tests.length} tests passed.`);

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

run();
