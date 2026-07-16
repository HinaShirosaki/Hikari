#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
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

test('plugin system: inspect-plugin-folder validates and normalizes plugin folders', async () => {
  const { inspectPluginFolder } = require(path.join(__dirname, 'src', 'main', 'lib', 'inspect-plugin-folder.js'));
  const dir = path.join(__dirname, 'tmp', 'plugin-fixture');
  await fsPromises.rm(dir, { recursive: true, force: true });
  await fsPromises.mkdir(dir, { recursive: true });

  const relative = await inspectPluginFolder({ fs: fsPromises, folderPath: 'relative/path' });
  assert.equal(relative.ok, false);

  const missingEntry = await inspectPluginFolder({ fs: fsPromises, folderPath: dir });
  assert.equal(missingEntry.ok, false);

  await fsPromises.writeFile(path.join(dir, 'index.html'), '<!DOCTYPE html><title>x</title>');
  await fsPromises.writeFile(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'My Plugin!', description: 'demo' }));
  const result = await inspectPluginFolder({ fs: fsPromises, folderPath: dir });
  assert.equal(result.ok, true);
  assert.equal(result.id, 'my-plugin');
  assert.equal(result.name, 'My Plugin!');
  assert.equal(result.description, 'demo');
  assert.ok(result.entryUrl.startsWith('file://'));
  assert.ok(result.entryUrl.endsWith('/index.html'));

  await fsPromises.writeFile(path.join(dir, 'plugin.json'), '{not json');
  const badManifest = await inspectPluginFolder({ fs: fsPromises, folderPath: dir });
  assert.equal(badManifest.ok, false);
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
