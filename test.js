#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { TextEncoder } = require('node:util');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

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
    // POSIX (/repo/...) and Windows (D:\repo\...) frames; group names always use '/'
    // so filters such as '^core/...' work on every platform.
    const file = (frame.match(/\(?((?:[A-Za-z]:)?[\\/][^():]+\.js):\d+:\d+\)?$/) || [])[1];
    if (file && file.startsWith(suitesRoot)) {
      return path.relative(suitesRoot, file).split(path.sep).join('/').replace(/\.js$/, '');
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
  ...loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'lib', 'app-utils.js')),
  ...loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'app-state', 'index.js'), {
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
const agentToolSmokeTest = require(path.join(__dirname, 'tests', 'support', 'agent-tool-smoke-test', 'index.js'));
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
const toolBox = Object.assign({}, ...[
  ['src', 'renderer', 'lib', 'molarity.js'],
  ['src', 'renderer', 'lib', 'bench-calculations.js'],
  ['src', 'renderer', 'modules', 'tool-box', 'common.js'],
  ['src', 'renderer', 'modules', 'tool-box', 'qpcr.js'],
  ['src', 'renderer', 'modules', 'sequence-viewer', 'calculations', 'sequence.js'],
  ['src', 'renderer', 'modules', 'sequence-viewer', 'calculations', 'oligo.js'],
  ['src', 'renderer', 'modules', 'sequence-viewer', 'calculations', 'protein.js'],
  ['src', 'renderer', 'modules', 'sequence-viewer', 'calculations', 'crispr.js']
].map((segments) => loadEsmStyleModule(path.join(__dirname, ...segments))));
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
const GEL_PLUGIN_DIR = path.join('src', 'plugins', 'gel', 'workspace');
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
const mainUtils = require(path.join(__dirname, 'src', 'main', 'storage', 'storage-paths.js'));
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

// Static checks and tests/*-selfcheck.* each run in their own process (they
// swap console methods, use node:test, or read the built index.html) and report
// through the same PASS/FAIL lines as everything else. Their own output is
// only shown when they fail.
function processTest(group, name, args) {
  tests.push({ group, name, fn: () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', ...args], {
      cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const error = new Error(`exit ${code}\n${output.trim()}`);
      error.stack = error.message; // the child's output is the trace
      reject(error);
    });
  }) });
}
processTest('check', 'lint', ['node_modules/eslint/bin/eslint.js', 'src', 'scripts', 'tests', 'test.js', 'eslint.config.mjs']);
for (const name of ['css-colors', 'dom-ids', 'source-layout']) processTest('check', name, [`scripts/check-${name}.mjs`]);
for (const file of fs.readdirSync(path.join(__dirname, 'tests')).filter((f) => /-selfcheck\.(c?js|mjs)$/.test(f)).sort()) {
  processTest('selfcheck', file.replace(/-selfcheck\.\w+$/, ''), [path.join('tests', file)]);
}

registerCoreSuite({ __dirname, scope: suiteScope });
registerEdgeSuite({ __dirname, scope: suiteScope });


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
      console.log(`PASS [${item.group}] ${item.name}`);
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
