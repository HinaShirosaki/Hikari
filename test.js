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
const suitesRoot = path.join(__dirname, 'tests', 'suites');

// The suite file that called test() is the category — the tests/suites tree is
// already the taxonomy, so nothing needs to be tagged by hand.
function callerGroup() {
  const frames = String(new Error().stack).split('\n').slice(2);
  for (const frame of frames) {
    const file = (frame.match(/\(?(\/[^():]+\.js):\d+:\d+\)?$/) || [])[1];
    if (file && file.startsWith(suitesRoot)) {
      return path.relative(suitesRoot, file).replace(/\.js$/, '');
    }
  }
  return 'root';
}

function test(name, fn) {
  tests.push({ name, fn, group: callerGroup() });
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
    'designCrisprGuides',
    'buildCrisprGuideTsv'
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
    'buildSequenceMapSvg',
    'clampMapZoom',
    'getMapKind',
    'resolveBaseFromPoint'
  ]
);
// Gel ships as an internal plugin (src/plugins/gel), not a renderer module, so
// its suites run against the plugin-owned copy — the only implementation.
const GEL_PLUGIN_DIR = path.join('src', 'plugins', 'gel', 'vendor', 'modules', 'gel');
const gelAnalysisInternals = loadEsmStyleModule(
  path.join(__dirname, GEL_PLUGIN_DIR, 'public-api.js'),
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
  path.join(__dirname, GEL_PLUGIN_DIR, 'rendering', 'lane-table.js')
);
const papersPdfViewerInternals = loadEsmStyleModule(
  path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'index.js')
);
const assayAnalysis = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'assay', 'analysis', 'index.js'));
const mainUtils = require(path.join(__dirname, 'src', 'main', 'lib', 'main-utils.js'));
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

test('plugin system: bundled serve tokens resolve only to the matching packaged plugin', () => {
  const { resolvePluginServePath } = require(
    path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js')
  );
  const getBundledPluginPath = (id) => (id === 'gel' ? '/app/src/plugins/gel' : '');
  assert.equal(resolvePluginServePath({
    pluginId: 'gel',
    requestedPath: '@bundled/gel',
    getBundledPluginPath
  }), '/app/src/plugins/gel');
  assert.equal(resolvePluginServePath({
    pluginId: 'local',
    requestedPath: '/tmp/local',
    getBundledPluginPath
  }), '/tmp/local');
  assert.throws(() => resolvePluginServePath({
    pluginId: 'other',
    requestedPath: '@bundled/gel',
    getBundledPluginPath
  }), /Invalid bundled plugin path/);
  assert.throws(() => resolvePluginServePath({
    pluginId: 'missing',
    requestedPath: '@bundled/missing',
    getBundledPluginPath
  }), /Unknown bundled plugin/);
});

test('plugin system: Gel has no active renderer-module integrations after the plugin port', () => {
  assert.equal(
    fs.existsSync(path.join(__dirname, 'src', 'renderer', 'modules', 'gel')),
    false,
    'the Gel implementation must not leak back into renderer modules'
  );
  const activeHostSources = [
    ['topbar item handler', 'src/renderer/app/topbar-open-handlers.js', /\bGel\s*:/],
    ['Agent sub-app API', 'src/main/agent/runtime/agent-sub-app-api.js', /\blistGelRecords\b|\bgel:\s*Object\.freeze/],
    ['shared renderer CSS', 'ui/css/base/core.css', /#gel-view\b/]
  ];
  activeHostSources.forEach(([label, relativePath, pattern]) => {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    assert.doesNotMatch(source, pattern, label);
  });

  const bridgeSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'app', 'plugin-bridge.js'),
    'utf8'
  );
  assert.match(bridgeSource, /migration\.importLegacyGel/, 'legacy Gel data keeps an identity-locked migration path');
});

test('plugin system: export IPC validates bytes and writes only after the user chooses a path', async () => {
  const { registerDataIpc } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'));
  const { PLUGINS } = require(path.join(__dirname, 'src', 'shared', 'ipc', 'channels.js'));
  const handlers = new Map();
  const writes = [];
  const saveDialogs = [];
  registerDataIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog: {
      async showSaveDialog(options) {
        saveDialogs.push(options);
        return { canceled: false, filePath: '/tmp/gel-export.csv' };
      }
    },
    shell: {},
    fs: {
      async writeFile(filePath, bytes) {
        writes.push({ filePath, bytes: Buffer.from(bytes) });
      }
    },
    mainDataHelpers: {}
  });
  const exportFile = handlers.get(PLUGINS.EXPORT_FILE);
  assert.equal(typeof exportFile, 'function');

  const invalid = await exportFile(null, { fileName: 'bad.csv', dataBase64: 'not base64' });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /valid base64/);
  assert.equal(saveDialogs.length, 0, 'invalid bytes never open a destination dialog');

  const result = await exportFile(null, {
    fileName: '../gel export.csv',
    dataBase64: Buffer.from('lane,band\n1,1\n').toString('base64')
  });
  assert.deepEqual(result, { ok: true, saved: true, fileName: 'gel-export.csv' });
  assert.equal(saveDialogs[0].defaultPath, 'gel_export.csv');
  assert.equal(writes[0].filePath, '/tmp/gel-export.csv');
  assert.equal(writes[0].bytes.toString('utf8'), 'lane,band\n1,1\n');
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

test('plugin system: service plugins declare file conversions and stay local', async () => {
  const { inspectPluginFolder } = require(path.join(__dirname, 'src', 'main', 'lib', 'inspect-plugin-folder.js'));
  const dir = path.join(__dirname, 'tmp', 'svc-plugin');
  await fsPromises.rm(dir, { recursive: true, force: true });
  await fsPromises.mkdir(dir, { recursive: true });
  await fsPromises.writeFile(path.join(dir, 'index.html'), '<!doctype html><title>svc</title>');
  const writeManifest = (manifest) => fsPromises.writeFile(path.join(dir, 'plugin.json'), JSON.stringify(manifest));
  const valid = { id: 'svc-plugin', name: 'Svc', version: '1.0.0', permissions: ['python'], service: { fileConversions: [{ from: '.DNA', to: 'gbk' }] } };

  await writeManifest(valid);
  const ok = await inspectPluginFolder({ fs: fsPromises, folderPath: dir });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.service, { fileConversions: [{ from: 'dna', to: 'gbk' }] }, 'extensions normalized (lower-case, no dot)');
  assert.deepEqual(ok.permissions, ['python'], 'a service may request a narrow host capability');
  assert.equal(ok.embedUrl, '', 'a service is not a remote embed');
  assert.equal(ok.serve, false, 'a service is not served');

  for (const [label, manifest] of [
    ['service not an object', { ...valid, service: 'dna' }],
    ['empty conversions', { ...valid, service: { fileConversions: [] }}],
    ['bad extension', { ...valid, service: { fileConversions: [{ from: 'd.n.a', to: 'gbk' }] }}],
    ['service plus embed', { ...valid, embed: 'https://x.test/', service: valid.service }],
    ['service plus serve', { ...valid, serve: true }]
  ]) {
    await writeManifest(manifest);
    const rejected = await inspectPluginFolder({ fs: fsPromises, folderPath: dir });
    assert.equal(rejected.ok, false, `${label} must be rejected`);
  }
});

test('plugin service registry routes a conversion to the owning frame', async () => {
  const { createPluginServiceRegistry } = await import(
    pathToFileURL(path.join(__dirname, 'src', 'renderer', 'app', 'plugin-services.js')).href
  );

  let messageHandler = null;
  const registry = createPluginServiceRegistry({
    windowObject: { addEventListener: (_type, fn) => { messageHandler = fn; } }
  });

  const posted = [];
  const frame = { contentWindow: { postMessage: (payload) => posted.push(payload) } };
  registry.register(frame, { id: 'snapgene-dna', service: { fileConversions: [{ from: 'dna', to: 'gbk' }] } });

  assert.equal(registry.acceptExtensions(), '.dna');
  assert.equal(registry.getConverter('DNA')?.pluginId, 'snapgene-dna', 'lookup is case/dot-insensitive');
  assert.equal(registry.getConverter('gbk'), null, 'only registered extensions resolve');

  const bytes = new Uint8Array([1, 2, 3]);
  const resultPromise = registry.convert({ extension: 'dna', filename: 'p.dna', bytes });
  assert.equal(posted.length, 1, 'the owning frame was posted to');
  assert.equal(posted[0].call, 'convert');
  assert.equal(posted[0].bytes, bytes);
  const callId = posted[0].id;

  // The frame answers on the shared message channel.
  messageHandler({ data: { hikari: 1, call: 'convert:result', id: callId, ok: true, text: 'LOCUS ...' } });
  const result = await resultPromise;
  assert.equal(result.text, 'LOCUS ...');

  // A service-reported failure rejects.
  const failing = registry.convert({ extension: 'dna', filename: 'bad.dna', bytes });
  const failId = posted[posted.length - 1].id;
  messageHandler({ data: { hikari: 1, call: 'convert:result', id: failId, ok: false, error: 'boom' } });
  await assert.rejects(failing, /boom/);

  await assert.rejects(registry.convert({ extension: 'ab1', bytes }), /No installed service converts/);
});

test('plugin service: Biopython converts .dna through the host API into GenBank the sequence viewer can parse', async () => {
  const converter = require(
    path.join(__dirname, 'examples', 'plugins', 'snapgene-dna', 'biopython-converter.js')
  );
  const { createPluginBridge } = await import(
    pathToFileURL(path.join(__dirname, 'src', 'renderer', 'app', 'plugin-bridge.js')).href
  );
  const { runPythonSandbox } = require(
    path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-python-sandbox', 'runner.js')
  );
  const { parseGenBankRecords } = sequenceViewerInternals;

  const sequence = 'ATGCAAACCCGGGTTTAAACCGGTTAACCGGTTAACCATGC';
  const dna = Buffer.from(
    'CQAAAA5TbmFwR2VuZQABAAAAAAAAAAAqAUFUR0NBQUFDQ0NHR0dUVFRBQUFDQ0dHVFRBQUNDR0dUVEFBQ0NBVEdDCgAAAMc8RmVhdHVyZXM+PEZlYXR1cmUgbmFtZT0ib3JpIiB0eXBlPSJyZXBfb3JpZ2luIiBkaXJlY3Rpb25hbGl0eT0iMSI+PFNlZ21lbnQgcmFuZ2U9IjUtMjAiLz48L0ZlYXR1cmU+PEZlYXR1cmUgbmFtZT0icmV2R2VuZSIgdHlwZT0iQ0RTIiBkaXJlY3Rpb25hbGl0eT0iMiI+PFNlZ21lbnQgcmFuZ2U9IjIxLTMwIi8+PC9GZWF0dXJlPjwvRmVhdHVyZXM+',
    'base64'
  );
  const frame = {
    replies: [],
    postMessage(payload) {
      this.replies.push(payload);
    }
  };
  const bridge = createPluginBridge({
    state: { settings: {} },
    api: {
      runPython: (payload) => runPythonSandbox(payload, {
        sandboxRoot: path.join(__dirname, 'tmp', 'snapgene-biopython-plugin')
      })
    },
    windowObject: { addEventListener() {} }
  });
  bridge.register(frame, { id: 'snapgene-dna', permissions: ['python'] });
  bridge.handleMessage({
    source: frame,
    data: {
      hikari: 1,
      id: 'convert-with-biopython',
      verb: 'python.run',
      params: converter.buildPythonRunParams(dna, { filename: 'pDemo.dna' })
    }
  });
  for (let attempt = 0; attempt < 1500 && !frame.replies.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(frame.replies.length, 1, 'python.run should reply within the service conversion timeout');
  const pythonReply = frame.replies.at(-1);
  assert.equal(pythonReply.ok, true, pythonReply.error || 'python.run bridge failed');
  const gbk = converter.extractGenBankResult(pythonReply.result);
  const { records } = parseGenBankRecords(gbk);
  assert.ok(records && records.length, 'the converted GenBank parses');
  assert.equal(records[0].sequence.toUpperCase(), sequence, 'sequence survives .dna -> gbk -> parse');
  assert.equal(records[0].topology, 'circular', 'topology survives the round-trip');
  assert.equal(records[0].features.some((feature) => feature.name === 'ori'), true, 'forward feature survives');
  assert.equal(records[0].features.some((feature) => feature.name === 'revGene' && feature.strand === -1), true, 'reverse feature survives');
});

test('plugin system: a service plugin mounts a hidden frame and no view', async () => {
  const { installPlugins } = await import(
    pathToFileURL(path.join(__dirname, 'src', 'renderer', 'app', 'plugin-loader.js')).href
  );
  function makeNode(tag) {
    const node = {
      tagName: String(tag).toUpperCase(), id: '', className: '', hidden: false, src: '',
      children: [], attributes: new Map(),
      setAttribute(n, v) { this.attributes.set(n, String(v)); },
      getAttribute(n) { return this.attributes.has(n) ? this.attributes.get(n) : null; },
      append(...kids) { this.children.push(...kids); }
    };
    if (node.tagName === 'IFRAME') {
      node.contentWindow = {};
    }
    return node;
  }
  const workspace = makeNode('div');
  workspace.className = 'workspace-main';
  const documentObject = {
    createElement: (tag) => makeNode(tag),
    querySelector: (sel) => (sel === '.workspace-main' ? workspace : null),
    getElementById: (id) => {
      const find = (node) => {
        for (const child of node.children) {
          if (child.id === id) return child;
          const nested = find(child);
          if (nested) return nested;
        }
        return null;
      };
      return find(workspace);
    }
  };
  const registered = [];
  const bridged = [];
  const services = { register: (frame, plugin) => registered.push({ frame, plugin }) };
  const bridge = { register: (frameWindow, plugin) => bridged.push({ frameWindow, plugin }) };
  const appRegistry = [];

  const state = { settings: { plugins: [
    { id: 'snapgene-dna', name: 'Svc', entryUrl: 'file:///tmp/snapgene-dna/index.html', path: '/tmp/snapgene-dna', permissions: ['python'], service: { fileConversions: [{ from: 'dna', to: 'gbk' }] } }
  ] } };
  installPlugins({ state, documentObject, appRegistry, services, bridge });

  assert.equal(documentObject.getElementById('plugin-snapgene-dna-view'), null, 'a service has no view section');
  assert.equal(appRegistry.length, 0, 'a service adds no navigation entry');
  const frame = documentObject.getElementById('plugin-service-snapgene-dna');
  assert.ok(frame, 'a hidden service frame is mounted');
  assert.equal(frame.hidden, true, 'the service frame is hidden');
  assert.ok(
    String(frame.className).split(/\s+/).includes('plugin-service-frame'),
    'the frame carries the class that pins it to display:none'
  );
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-forms allow-modals allow-popups', 'opaque-origin sandbox, no allow-same-origin');
  assert.equal(registered.length, 1, 'the frame is registered with the service registry');
  assert.equal(registered[0].plugin.id, 'snapgene-dna');
  assert.equal(bridged.length, 1, 'the frame is registered with the permission bridge');
  assert.equal(bridged[0].frameWindow, frame.contentWindow);
  assert.deepEqual(bridged[0].plugin.permissions, ['python']);

  // The host must pin service frames to display:none, not merely rely on the
  // `hidden` attribute, so a service cannot render even with markup.
  assert.match(
    readSource(path.join('ui', 'css', 'base', 'core.css')),
    /\.plugin-service-frame\s*\{[^}]*display:\s*none\s*!important/,
    'core.css pins .plugin-service-frame to display:none'
  );
});

test('plugin service: the example service ships no UI', () => {
  const html = readSource(path.join('examples', 'plugins', 'snapgene-dna', 'index.html'));
  // Strip comments, then the body should hold script tags and nothing else.
  const body = (/<body[^>]*>([\s\S]*?)<\/body>/i.exec(html) || [])[1] || '';
  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, '');
  const withoutScripts = withoutComments.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  assert.equal(withoutScripts.trim(), '', 'a service page renders nothing: only script tags in the body');
  assert.equal(/\bstyle\s*=|<style\b/i.test(html), false, 'a service page carries no styling');

  // The service worker must not touch the DOM.
  const worker = readSource(path.join('examples', 'plugins', 'snapgene-dna', 'main.js'));
  assert.equal(/\bdocument\./.test(worker), false, 'the service worker touches no DOM');
  const converter = readSource(path.join('examples', 'plugins', 'snapgene-dna', 'biopython-converter.js'));
  assert.match(converter, /hikari\.call\('python\.run'/, 'the service delegates conversion to the Python API');
  assert.match(converter, /from Bio import SeqIO/, 'the Python program uses Biopython');
  const manifest = JSON.parse(readSource(path.join('examples', 'plugins', 'snapgene-dna', 'plugin.json')));
  assert.deepEqual(manifest.permissions, ['python'], 'the headless service declares only Python access');
});

test('plugin service: the headless worker routes conversion through python.run and replies with GenBank', async () => {
  const workerSource = readSource(path.join('examples', 'plugins', 'snapgene-dna', 'main.js'));
  const converter = require(
    path.join(__dirname, 'examples', 'plugins', 'snapgene-dna', 'biopython-converter.js')
  );
  const genBank = [
    'LOCUS       pWorker         4 bp    DNA     linear   SYN 01-JAN-1980',
    'FEATURES             Location/Qualifiers',
    'ORIGIN',
    '        1 acgt',
    '//',
    ''
  ].join('\n');
  const calls = [];
  const replies = [];
  let messageHandler = null;
  const windowObject = {
    parent: { postMessage: (payload) => replies.push(payload) },
    HikariPlugin: {
      hikari: {
        call: async (verb, params) => {
          calls.push({ verb, params });
          return { ok: true, files: [{ path: 'output.gbk', content: genBank, truncated: false }] };
        }
      }
    },
    SnapGeneBiopython: converter,
    addEventListener: (_type, listener) => { messageHandler = listener; }
  };
  vm.runInNewContext(workerSource, { window: windowObject, console });

  messageHandler({
    data: {
      hikari: 1,
      call: 'convert',
      id: 'svc_worker',
      from: 'dna',
      to: 'gbk',
      filename: 'pWorker.dna',
      bytes: new Uint8Array([1, 2, 3, 4])
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].verb, 'python.run');
  assert.equal(calls[0].params.readbackPaths[0], 'output.gbk');
  assert.equal(replies.length, 1);
  assert.deepEqual(
    { call: replies[0].call, id: replies[0].id, ok: replies[0].ok, text: replies[0].text },
    { call: 'convert:result', id: 'svc_worker', ok: true, text: genBank }
  );
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
        { id: 'gel', name: 'Tampered Gel', path: '/tmp/not-gel', serve: true, permissions: ['notebook:read'], enabled: false },
        { id: 'nowhere', name: 'D' }
      ],
      // App state is one localStorage record, so an oversized blob arriving
      // from an imported or hand-edited state would break every later save.
      pluginStorage: {
        keeper: { records: [{ id: 'g1' }] },
        hog: 'x'.repeat(1000001),
        '': { records: [] }
      }
    }
  });

  const byId = Object.fromEntries(settings.plugins.map((plugin) => [plugin.id, plugin]));
  assert.equal(byId.downgraded.embedUrl, '', 'non-https embed is dropped');
  assert.equal(byId.grabby.embedUrl, 'https://ij.imjoy.io/');
  assert.deepEqual(byId.grabby.permissions, [], 'remote plugins lose host permissions');
  assert.deepEqual(byId.local.permissions, ['notebook:read'], 'local permissions survive');
  assert.equal(byId.nowhere, undefined, 'an entry with neither entryUrl nor embedUrl is dropped');
  assert.equal(byId.gel.bundled, true, 'the Gel plugin is restored as a bundled app');
  assert.equal(byId.gel.path, '@bundled/gel');
  assert.equal(byId.gel.icon, 'gel-analysis');
  assert.match(byId.gel.iconMarkup, /data-hikari-icon="gel-analysis"/);
  assert.deepEqual(byId.gel.permissions, ['storage', 'files', 'downloads', 'layout']);
  assert.equal(byId.gel.enabled, false, 'the user can keep a bundled plugin disabled');

  assert.deepEqual(settings.pluginStorage.keeper, { records: [{ id: 'g1' }] });
  assert.equal('hog' in settings.pluginStorage, false, 'an over-cap blob is dropped on load');
  assert.equal('' in settings.pluginStorage, false, 'a blob with no plugin id is dropped');
});

test('plugin system: a plugin view is its frame, with no host chrome around it', async () => {
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
        {
          id: 'served-one',
          name: 'Served One',
          description: 'A served plugin',
          serve: true,
          path: '/tmp/served-one',
          permissions: [],
          iconMarkup: '<svg data-untrusted-icon="true"></svg>'
        },
        { id: 'local-one', name: 'Local One', entryUrl: 'file:///tmp/local-one/index.html', permissions: ['notebook:read'] },
        {
          id: 'gel',
          name: 'Gel Analysis',
          serve: true,
          path: '@bundled/gel',
          permissions: [],
          bundled: true,
          icon: 'gel-analysis',
          iconMarkup: '<svg data-hikari-icon="gel-analysis"></svg>',
          aliases: ['gel', 'electrophoresis']
        }
      ]
    }
  };
  const appRegistry = [];
  // api.servePluginFolder is async; the frame src arrives later and is not
  // needed for the view-shape assertions.
  installPlugins({ state, documentObject, appRegistry, api: { servePluginFolder: () => new Promise(() => {}) } });

  for (const pluginId of ['served-one', 'local-one', 'gel']) {
    const section = documentObject.getElementById(`plugin-${pluginId}-view`);
    assert.ok(section, `${pluginId} view section exists`);

    // No host chrome. A plugin that draws its own rail — every ported
    // workspace does — would otherwise end up behind a second, emptier one.
    const rails = findAll(section, (node) => node.getAttribute('data-sync-left-rail') !== null);
    assert.equal(rails.length, 0, `${pluginId} view draws no host rail`);
    const templates = findAll(section, (node) => hasClass(node, 'left-rail-template'));
    assert.equal(templates.length, 0, `${pluginId} view is not wrapped in the rail template`);

    // The frame is the view: one pane, one frame, nothing beside it.
    const frames = findAll(section, (node) => node.tagName === 'IFRAME');
    assert.equal(frames.length, 1, `${pluginId} has one frame`);
    const mains = findAll(section, (node) => hasClass(node, 'plugin-view__main'));
    assert.equal(mains.length, 1, `${pluginId} has one pane`);
    assert.ok(mains[0].children.includes(frames[0]), `${pluginId} frame fills the pane`);

    // Identity did not vanish with the rail: it rides on the frame, so it is
    // the accessible name and the tooltip.
    assert.equal(frames[0].title, frames[0].getAttribute('aria-label'));
    assert.ok(/Host access|host access/.test(frames[0].title), `${pluginId} frame states host access`);
  }

  const frameFor = (pluginId) => findAll(
    documentObject.getElementById(`plugin-${pluginId}-view`),
    (node) => node.tagName === 'IFRAME'
  )[0];

  const servedTitle = frameFor('served-one').title;
  assert.ok(servedTitle.includes('Served One'), 'served plugin is named');
  assert.ok(servedTitle.includes('Served plugin'), 'served plugin is labelled as such');
  assert.ok(servedTitle.includes('host access: none'), 'served plugin with no permissions says none');

  const localTitle = frameFor('local-one').title;
  assert.ok(localTitle.includes('Local plugin'), 'local plugin is labelled as such');
  assert.ok(localTitle.includes('notebook:read'), 'local plugin lists its declared permission');

  const registryById = Object.fromEntries(appRegistry.map((app) => [app.id, app]));
  assert.doesNotMatch(
    registryById['plugin-served-one'].iconMarkup,
    /data-untrusted-icon/,
    'installable plugin SVG never enters the host document'
  );
  assert.match(
    registryById['plugin-gel'].iconMarkup,
    /data-hikari-icon="gel-analysis"/,
    'the source-owned Gel icon reaches the navigation registry'
  );
  assert.equal(registryById['plugin-gel'].icon, 'gel-analysis');
  assert.deepEqual(registryById['plugin-gel'].aliases, ['gel', 'electrophoresis']);
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
  const railStyles = new Map();
  const railStorage = new Map();
  const layoutEvents = [];
  class FakeCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const windowObject = {
    innerWidth: 1280,
    document: {
      documentElement: {
        style: { setProperty: (name, value) => railStyles.set(name, value) }
      }
    },
    localStorage: {
      getItem: (key) => railStorage.get(key) || null,
      setItem: (key, value) => railStorage.set(key, String(value))
    },
    getComputedStyle: () => ({
      getPropertyValue: (name) => railStyles.get(name) || ''
    }),
    CustomEvent: FakeCustomEvent,
    addEventListener: (_type, fn) => listeners.push(fn),
    dispatchEvent: (event) => layoutEvents.push(event)
  };
  const bridge = createPluginBridge({
    state,
    persist: () => { persisted += 1; },
    windowObject
  });
  assert.equal(listeners.length, 1, 'bridge subscribes to window messages');

  // Each fake frame is its own object identity, exactly like a contentWindow.
  const makeFrame = () => {
    const replies = [];
    return { replies, postMessage: (payload) => replies.push(payload) };
  };
  const reader = makeFrame();
  const stranger = makeFrame();
  bridge.register(reader, { id: 'reader', permissions: ['notebook:read', 'notebook:write', 'layout'] });
  const noLayout = makeFrame();
  bridge.register(noLayout, { id: 'no-layout', permissions: ['notebook:read'] });

  const send = (source, verb, params = {}) => {
    bridge.handleMessage({ source, data: { hikari: 1, id: verb, verb, params } });
    return source.replies[source.replies.length - 1];
  };

  // Unregistered frames get no reply at all — not even an error.
  bridge.handleMessage({ source: stranger, data: { hikari: 1, id: 'x', verb: 'notebook.list' } });
  assert.equal(stranger.replies.length, 0);

  assert.equal(send(reader, 'notebook.list').ok, true);
  assert.equal(send(reader, 'notebook.list').result[0].experimentName, 'Exp 1');

  const appInfo = send(reader, 'app.info');
  assert.deepEqual(appInfo.result.layout.leftRail, {
    width: 280,
    min: 240,
    max: 400,
    mobileBreakpoint: 980
  });
  assert.equal(send(reader, 'app.setLeftRailWidth', { width: '360' }).ok, false, 'layout writes require a number');
  // The rail write touches host CSS, host localStorage, and every other frame, so it
  // is gated like any other write verb rather than being free.
  const deniedRail = send(noLayout, 'app.setLeftRailWidth', { width: 360 });
  assert.equal(deniedRail.ok, false, 'layout writes require the layout permission');
  assert.ok(deniedRail.error.includes('layout'));
  const resizedRail = send(reader, 'app.setLeftRailWidth', { width: 360 });
  assert.equal(resizedRail.ok, true);
  assert.equal(resizedRail.result.leftRail.width, 360);
  assert.equal(railStyles.get('--shared-left-rail-width'), '360px');
  assert.equal(railStorage.get('hikari_shared_left_rail_width_v2'), '360');
  assert.equal(layoutEvents.at(-1).type, 'hikari:left-rail-width-changed');

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

  // Per-plugin storage. The slice is keyed by the frame's resolved identity, so
  // there is no parameter a plugin could pass to reach another plugin's data.
  const keeper = makeFrame();
  const neighbour = makeFrame();
  bridge.register(keeper, { id: 'keeper', permissions: ['storage'] });
  bridge.register(neighbour, { id: 'neighbour', permissions: ['storage'] });

  assert.equal(send(reader, 'storage.get').ok, false, 'storage needs its own permission');
  assert.equal(send(keeper, 'storage.get').result.value, null, 'unset storage reads as null');

  assert.equal(send(keeper, 'storage.set', { value: { records: [{ id: 'g1' }] } }).ok, true);
  assert.deepEqual(state.settings.pluginStorage.keeper, { records: [{ id: 'g1' }] });
  assert.deepEqual(send(keeper, 'storage.get').result.value, { records: [{ id: 'g1' }] });
  assert.equal(send(neighbour, 'storage.get').result.value, null, 'a plugin sees only its own slice');

  const missingValue = send(keeper, 'storage.set', {});
  assert.equal(missingValue.ok, false, 'omitting value is not an implicit delete');
  assert.match(missingValue.error, /Pass null explicitly/);
  assert.deepEqual(state.settings.pluginStorage.keeper, { records: [{ id: 'g1' }] });

  const invalidParams = send(keeper, 'storage.get', []);
  assert.equal(invalidParams.ok, false, 'raw protocol callers cannot pass array params');
  assert.match(invalidParams.error, /object for params/);

  // The cap guards app-wide state, not just this plugin's data, so a rejected
  // write must leave what was already stored intact.
  const overCap = send(keeper, 'storage.set', { value: 'x'.repeat(1000001) });
  assert.equal(overCap.ok, false);
  assert.ok(overCap.error.includes('exceeds'));
  assert.deepEqual(state.settings.pluginStorage.keeper, { records: [{ id: 'g1' }] });

  const cyclic = { self: null };
  cyclic.self = cyclic;
  assert.equal(send(keeper, 'storage.set', { value: cyclic }).ok, false, 'unserializable values are refused');

  assert.equal(send(keeper, 'storage.set', { value: null }).ok, true);
  assert.equal('keeper' in state.settings.pluginStorage, false, 'setting null clears the slice');
});

test('plugin system: files verbs stay inside the plugin folder', async () => {
  const { createPluginBridge } = await import(
    pathToFileURL(path.join(__dirname, 'src', 'renderer', 'app', 'plugin-bridge.js')).href
  );

  // Stands in for the preload bridge. readFileBase64 in the real app reads any
  // absolute path it is handed and storeImportedFile confines writes to the
  // storage root but not below it, so containment has to come from the bridge —
  // this fake records exactly what the bridge asked for.
  const disk = new Map();
  const overwriteRequests = [];
  let writeFailure = '';
  const api = {
    async storeImportedFile({ storagePath, targetFolder, fileName, dataBase64, overwrite }) {
      if (writeFailure) {
        return { ok: false, error: writeFailure };
      }
      overwriteRequests.push(overwrite);
      const filePath = `${targetFolder}/${fileName}`;
      disk.set(filePath, dataBase64);
      return { ok: true, filePath, relativePath: filePath.slice(`${storagePath}/`.length) };
    },
    async readFileBase64(target) {
      return disk.has(target)
        ? { ok: true, dataBase64: disk.get(target) }
        : { ok: false, error: 'ENOENT' };
    }
  };

  const state = { settings: { storagePath: '/root' } };
  const listeners = [];
  const bridge = createPluginBridge({
    state,
    api,
    windowObject: { addEventListener: (_type, fn) => listeners.push(fn) }
  });
  const frame = { replies: [], postMessage: (payload) => frame.replies.push(payload) };
  bridge.register(frame, { id: 'gel', permissions: ['files'] });

  // files verbs are async, so a reply lands a turn later than a sync verb's.
  const call = async (verb, params) => {
    bridge.handleMessage({ source: frame, data: { hikari: 1, id: verb, verb, params } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return frame.replies[frame.replies.length - 1];
  };

  const written = await call('files.write', { path: 'Gels/run1/source.png', dataBase64: 'aGk=' });
  assert.equal(written.ok, true);
  assert.equal(written.result.path, 'Gels/run1/source.png', 'paths come back relative to the plugin folder');
  assert.deepEqual([...disk.keys()], ['/root/Plugins/gel/Gels/run1/source.png']);

  const read = await call('files.read', { path: 'Gels/run1/source.png' });
  assert.equal(read.result.dataBase64, 'aGk=', 'a written file reads back');

  const invalidBase64 = await call('files.write', { path: 'Gels/run1/bad.png', dataBase64: 'not base64' });
  assert.equal(invalidBase64.ok, false, 'invalid base64 is refused before filesystem IPC');
  assert.match(invalidBase64.error, /canonical base64/);
  assert.equal(disk.size, 1);

  writeFailure = 'disk full';
  const failedWrite = await call('files.write', { path: 'Gels/run1/failure.png', dataBase64: 'aGk=' });
  assert.equal(failedWrite.ok, false, 'downstream write failures are not acknowledged as saved');
  assert.match(failedWrite.error, /disk full/);
  writeFailure = '';

  // Every one of these must fail closed, and must not reach the fake at all.
  for (const badPath of [
    '../../../notebook.json',
    'Gels/../../../secret.txt',
    '/etc/passwd',
    'C:\\Windows\\system.ini',
    '..\\..\\secret.txt',
    'Gels/\u0000evil.txt',
    ''
  ]) {
    const rejected = await call('files.write', { path: badPath, dataBase64: 'aGk=' });
    assert.equal(rejected.ok, false, `write escaped the plugin folder: ${badPath}`);
    const rejectedRead = await call('files.read', { path: badPath });
    assert.equal(rejectedRead.ok, false, `read escaped the plugin folder: ${badPath}`);
  }
  assert.equal(disk.size, 1, 'no escape attempt wrote a file');

  // The plugin owns this folder and addresses it by path, so re-writing a path
  // replaces the file. Without this the host de-duplicates to source_2.png and
  // every re-save leaks a copy the plugin can never reach or delete.
  assert.equal(overwriteRequests.at(-1), true, 'plugin writes ask the host to overwrite');

  // The id is half the confining path. inspect-plugin-folder checks it at
  // install time, but a persisted record is re-hydrated without that check.
  const hostile = { replies: [], postMessage: (payload) => hostile.replies.push(payload) };
  bridge.register(hostile, { id: '../..', permissions: ['files'] });
  bridge.handleMessage({
    source: hostile,
    data: { hikari: 1, id: 'r', verb: 'files.read', params: { path: 'notebook.json' } }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(hostile.replies.at(-1).ok, false, 'a traversing plugin id cannot address files');
  assert.match(hostile.replies.at(-1).error, /Invalid plugin id/);

  // No storage folder configured is a refusal, not a write to somewhere else.
  state.settings.storagePath = '';
  const unconfigured = await call('files.write', { path: 'a.txt', dataBase64: 'aGk=' });
  assert.equal(unconfigured.ok, false);
  assert.ok(unconfigured.error.includes('storage folder'));
});

test('plugin system: app context events and user-mediated downloads stay permission gated', async () => {
  const { createPluginBridge } = await import(
    pathToFileURL(path.join(__dirname, 'src', 'renderer', 'app', 'plugin-bridge.js')).href
  );
  const exports = [];
  const state = {
    settings: {
      storagePath: '/root',
      appearance: { mode: 'night', fontSize: 18 }
    }
  };
  const bridge = createPluginBridge({
    state,
    api: {
      async exportPluginFile(payload) {
        exports.push(payload);
        return { ok: true, fileName: payload.fileName };
      }
    },
    windowObject: { addEventListener() {} }
  });
  const makeFrame = () => {
    const replies = [];
    return { replies, postMessage: (payload) => replies.push(payload) };
  };
  const exporter = makeFrame();
  const reader = makeFrame();
  bridge.register(exporter, { id: 'exporter', permissions: ['downloads'] });
  bridge.register(reader, { id: 'reader', permissions: [] });

  const info = (() => {
    bridge.handleMessage({ source: exporter, data: { hikari: 1, id: 'info', verb: 'app.info', params: {} } });
    return exporter.replies.at(-1);
  })();
  assert.deepEqual(info.result.appearance, { mode: 'night', fontSize: 18 });
  assert.deepEqual(info.result.storage, { configured: true });

  bridge.handleMessage({
    source: reader,
    data: { hikari: 1, id: 'denied', verb: 'downloads.save', params: { fileName: 'x.csv', dataBase64: 'eA==' } }
  });
  assert.equal(reader.replies.at(-1).ok, false);

  bridge.handleMessage({
    source: exporter,
    data: { hikari: 1, id: 'invalid', verb: 'downloads.save', params: { fileName: 'x.csv', dataBase64: 'not base64' } }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(exporter.replies.at(-1).ok, false);
  assert.match(exporter.replies.at(-1).error, /canonical base64/);
  assert.equal(exports.length, 0, 'invalid export bytes never reach native IPC');

  bridge.handleMessage({
    source: exporter,
    data: { hikari: 1, id: 'save', verb: 'downloads.save', params: { fileName: 'gel.csv', dataBase64: 'Z2Vs' } }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(exporter.replies.at(-1).result.saved, true);
  assert.equal(exports[0].fileName, 'gel.csv');

  state.settings.appearance = { mode: 'miku', fontSize: 15 };
  bridge.broadcastAppContext('appearance');
  assert.equal(exporter.replies.at(-1).event, 'app.context');
  assert.deepEqual(exporter.replies.at(-1).payload.appearance, { mode: 'miku', fontSize: 15 });
  assert.equal(exporter.replies.at(-1).payload.changed, 'appearance');
});

test('plugin system: bundled Gel migration copies legacy records into its file namespace', async () => {
  const { createPluginBridge } = await import(
    pathToFileURL(path.join(__dirname, 'src', 'renderer', 'app', 'plugin-bridge.js')).href
  );
  const disk = new Map([
    ['/root/Gels/old/source.png', 'U09VUkNF'],
    ['/root/Gels/old/preview.png', 'UFJFVklFVw==']
  ]);
  const api = {
    async readFileBase64(filePath) {
      return disk.has(filePath)
        ? { ok: true, dataBase64: disk.get(filePath) }
        : { ok: false, error: 'ENOENT' };
    },
    async storeImportedFile({ storagePath, targetFolder, fileName, dataBase64 }) {
      const filePath = `${targetFolder}/${fileName}`;
      disk.set(filePath, dataBase64);
      return { ok: true, relativePath: filePath.slice(`${storagePath}/`.length) };
    }
  };
  const state = {
    settings: { storagePath: '/root' },
    gelAnalyses: [{
      id: 'gel-1',
      name: 'Old Gel',
      sourceImagePath: '/root/Gels/old/source.png',
      previewImagePath: '/root/Gels/old/preview.png',
      report: { lanes: [{ laneIndex: 1 }] },
      updatedAt: '2026-08-01T00:00:00.000Z'
    }]
  };
  const bridge = createPluginBridge({
    state,
    api,
    windowObject: { addEventListener() {} }
  });
  const frame = { replies: [], postMessage: (payload) => frame.replies.push(payload) };
  bridge.register(frame, { id: 'gel', permissions: ['storage', 'files'], bundled: true, path: '@bundled/gel' });
  bridge.handleMessage({
    source: frame,
    data: { hikari: 1, id: 'migrate', verb: 'migration.importLegacyGel', params: {} }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const reply = frame.replies.at(-1);
  assert.equal(reply.ok, true);
  assert.equal(reply.result.records.length, 1);
  const migrated = reply.result.records[0];
  assert.match(migrated.sourceImagePath, /^Gels\/Old_Gel__gel-1\/source\.png$/);
  assert.match(migrated.recordJsonPath, /^Gels\/Old_Gel__gel-1\/gel-record\.json$/);
  assert.ok(disk.has('/root/Plugins/gel/Gels/Old_Gel__gel-1/analysis-result.json'));
  assert.ok(disk.has('/root/Plugins/gel/Gels/Old_Gel__gel-1/gel-record.json'));

  // Callable again: a storage-root import merges legacy gels into host state
  // long after first run, and a one-shot gate would strand them.
  state.gelAnalyses.push({
    id: 'gel-2',
    name: 'Imported Gel',
    updatedAt: '2026-08-02T00:00:00.000Z'
  });
  bridge.handleMessage({
    source: frame,
    data: {
      hikari: 1,
      id: 'again',
      verb: 'migration.importLegacyGel',
      params: { skipIds: ['gel-1'] }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = frame.replies.at(-1).result.records;
  assert.equal(second.length, 1, 'a repeat call returns only what is new');
  assert.equal(second[0].id, 'gel-2');

  // A moved storage root makes the recorded absolute path stale; the record's
  // relative path still resolves, and losing the image here is permanent.
  disk.set('/moved/Gels/old/source.png', 'U09VUkNF');
  state.settings.storagePath = '/moved';
  state.gelAnalyses = [{
    id: 'gel-3',
    name: 'Moved Gel',
    sourceImagePath: '/root/Gels/old/source.png',
    sourceImageRelativePath: 'Gels/old/source.png',
    updatedAt: '2026-08-03T00:00:00.000Z'
  }];
  bridge.handleMessage({
    source: frame,
    data: { hikari: 1, id: 'moved', verb: 'migration.importLegacyGel', params: {} }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(
    frame.replies.at(-1).result.records[0].sourceImagePath,
    /source\.png$/,
    'a stale absolute path falls back to the relative one'
  );
  state.settings.storagePath = '/root';

  const other = { replies: [], postMessage: (payload) => other.replies.push(payload) };
  bridge.register(other, { id: 'other', permissions: [], bundled: true, path: '@bundled/other' });
  bridge.handleMessage({
    source: other,
    data: { hikari: 1, id: 'blocked', verb: 'migration.importLegacyGel', params: {} }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(other.replies.at(-1).ok, false, 'other plugin ids cannot claim Gel legacy data');
});

test('plugin system: python.run is permission gated and hands back no host paths', async () => {
  const { createPluginBridge, PLUGIN_BRIDGE_VERBS } = await import(
    pathToFileURL(path.join(__dirname, 'src', 'renderer', 'app', 'plugin-bridge.js')).href
  );
  const { PLUGIN_PERMISSIONS } = require(path.join(__dirname, 'src', 'main', 'lib', 'inspect-plugin-folder.js'));
  // A verb whose permission is not installable is unreachable, so the two
  // lists have to agree or the verb is dead on arrival.
  assert.equal(PLUGIN_BRIDGE_VERBS['python.run'], 'python');
  assert.ok(PLUGIN_PERMISSIONS.includes('python'), 'manifests must be able to request "python"');

  const runs = [];
  const bridge = createPluginBridge({
    state: { settings: {} },
    api: {
      async runPython(payload) {
        runs.push(payload);
        return {
          ok: true,
          status: 'ok',
          stdout: 'doubled 42\n',
          stderr: '',
          exit_code: 0,
          timed_out: false,
          readback_files: [{ path: 'out.txt', content: '42', truncated: false }],
          // The host result carries these; the frame must not see them.
          python_executable: '/usr/local/bin/python3',
          run_id: 'run-1',
          process_id: 4242
        };
      }
    },
    windowObject: { addEventListener() {} }
  });
  const makeFrame = () => {
    const replies = [];
    return { replies, postMessage: (payload) => replies.push(payload) };
  };
  const runner = makeFrame();
  const reader = makeFrame();
  bridge.register(runner, { id: 'runner', permissions: ['python'] });
  bridge.register(reader, { id: 'reader', permissions: ['files', 'storage'] });

  // Holding files/storage is not holding python: a subprocess is its own grant.
  bridge.handleMessage({
    source: reader,
    data: { hikari: 1, id: 'denied', verb: 'python.run', params: { code: 'print(1)' } }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reader.replies.at(-1).ok, false);
  assert.match(reader.replies.at(-1).error, /did not declare the "python" permission/);
  assert.equal(runs.length, 0, 'a denied call never reaches the host runner');

  bridge.handleMessage({
    source: runner,
    data: { hikari: 1, id: 'empty', verb: 'python.run', params: { code: '   ' } }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runner.replies.at(-1).ok, false);
  assert.equal(runs.length, 0, 'blank code never reaches the host runner');

  bridge.handleMessage({
    source: runner,
    data: {
      hikari: 1,
      id: 'run',
      verb: 'python.run',
      params: {
        code: 'print("doubled 42")',
        files: [{ path: 'in.txt', content: '21' }],
        readbackPaths: ['out.txt'],
        timeoutMs: 5000
      }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const reply = runner.replies.at(-1);
  assert.equal(reply.ok, true);
  assert.equal(reply.result.stdout, 'doubled 42\n', 'stdout crosses verbatim, not trimmed');
  assert.equal(reply.result.exitCode, 0);
  assert.deepEqual(reply.result.files, [{ path: 'out.txt', content: '42', truncated: false }]);
  assert.equal(reply.result.pythonExecutable, undefined, 'the interpreter path stays host-side');
  assert.equal(reply.result.python_executable, undefined);
  assert.equal(reply.result.run_id, undefined);
  assert.equal(reply.result.process_id, undefined);
  assert.deepEqual(runs.at(-1).files, [{ path: 'in.txt', content: '21' }]);
  assert.equal(runs.at(-1).timeout_ms, 5000);

  const repliesBeforeServiceMessage = runner.replies.length;
  bridge.handleMessage({
    source: runner,
    data: { hikari: 1, call: 'convert:result', id: 'svc_1', ok: true, text: 'LOCUS ...' }
  });
  assert.equal(
    runner.replies.length,
    repliesBeforeServiceMessage,
    'service protocol replies stay off the host-verb channel'
  );

  // Oversized input is refused at the bridge rather than shipped to a subprocess.
  bridge.handleMessage({
    source: runner,
    data: {
      hikari: 1,
      id: 'huge',
      verb: 'python.run',
      params: { code: 'print(1)', files: [{ path: 'big.txt', content: 'x'.repeat(4000001) }] }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runner.replies.at(-1).ok, false);
  assert.match(runner.replies.at(-1).error, /exceeds the 4000000-character limit/);
  assert.equal(runs.length, 1, 'oversized input never reaches the host runner');
});

test('plugin system: a frame with unsaved work reaches the host quit guard', async () => {
  const { createPluginBridge } = await import(
    pathToFileURL(path.join(__dirname, 'src', 'renderer', 'app', 'plugin-bridge.js')).href
  );
  const bridge = createPluginBridge({
    state: { settings: {} },
    windowObject: { addEventListener() {}, setTimeout: () => 0 }
  });
  const frame = { replies: [], postMessage: (payload) => frame.replies.push(payload) };
  bridge.register(frame, { id: 'gel', name: 'Gel Analysis', permissions: [] });
  const push = (unsaved) => bridge.handleMessage({
    source: frame,
    data: { hikari: 1, id: 'u', verb: 'app.setUnsaved', params: { unsaved } }
  });

  assert.deepEqual(bridge.getUnsavedSources(), [], 'a clean frame does not block the quit');

  push(true);
  const [source] = bridge.getUnsavedSources();
  assert.equal(source.label, 'Gel Analysis', 'the dialog names the plugin, not its id');
  assert.equal(source.moduleApi.hasUnsavedChanges(), true);

  // Saving is a broadcast plus a wait for the frame's next push — there is no
  // host->plugin request in the protocol.
  const saved = source.moduleApi.saveUnsavedChanges();
  assert.equal(frame.replies.at(-1).event, 'app.save');
  push(false);
  assert.equal(await saved, true);
  assert.deepEqual(bridge.getUnsavedSources(), []);
});

function selectTests() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    const counts = new Map();
    for (const item of tests) counts.set(item.group, (counts.get(item.group) || 0) + 1);
    for (const [group, count] of [...counts].sort()) console.log(`${String(count).padStart(4)}  ${group}`);
    console.log(`\n${tests.length} tests in ${counts.size} groups. Run a subset: node test.js <regex>`);
    process.exit(0);
  }
  const patterns = args.filter((arg) => !arg.startsWith('-')).map((arg) => new RegExp(arg, 'i'));
  if (!patterns.length) return tests;
  return tests.filter((item) => patterns.some((re) => re.test(`${item.group} ${item.name}`)));
}

async function run() {
  let passed = 0;
  const selected = selectTests();
  if (!selected.length) {
    console.error('No tests matched. Use `node test.js --list` to see the groups.');
    process.exit(1);
  }
  if (selected.length !== tests.length) {
    console.log(`Running ${selected.length}/${tests.length} tests.\n`);
  }
  const slow = [];

  for (const item of selected) {
    const started = Date.now();
    try {
      await item.fn();
      passed += 1;
      console.log(`PASS ${item.name}`);
    } catch (error) {
      console.error(`FAIL [${item.group}] ${item.name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    }
    const elapsed = Date.now() - started;
    if (elapsed >= 1000) slow.push({ elapsed, item });
  }

  console.log(`\n${passed}/${selected.length} tests passed.`);
  for (const { elapsed, item } of slow.sort((a, b) => b.elapsed - a.elapsed).slice(0, 10)) {
    console.log(`SLOW ${(elapsed / 1000).toFixed(1)}s  [${item.group}] ${item.name}`);
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

run();
