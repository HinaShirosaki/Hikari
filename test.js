#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder, TextEncoder } = require('node:util');
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
const {
  createAgentSimulationSupport
} = require('./tests/support/agent-simulation.js');

fs.mkdirSync(path.join(__dirname, 'tmp'), { recursive: true });

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function optionalRequire(modulePath, fallback = {}) {
  try {
    return require(modulePath);
  } catch {
    return fallback;
  }
}

const memoryStorage = createMemoryStorage();
const shared = {
  ...loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'views.js')),
  ...loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'utils.js')),
  ...loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'app-state.js'), {
    localStorage: memoryStorage
  })
};

const agentRouting = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-routing.js'));
const agentIntentParser = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'intent', 'agent-intent-parser.js'));
const agentTools = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-tools.js'));
const agentProtocolGeneration = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-protocol-generation.js'));
const agentProtocolMatching = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-protocol-matching.js'));
const agentNotebookGeneration = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-notebook-generation.js'));
const agentNotebookDraft = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-notebook-draft.js'));
const agentInventoryLookup = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-inventory-lookup.js'));
const agentRecordLookup = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-record-lookup.js'));
const agentSubAgent = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-sub-agent.js'));
const agentChatLog = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'context', 'agent-chat-log.js'));
const agentContextManagement = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'context', 'agent-context-management.js'));
const agentMemory = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'context', 'agent-memory.js'));
const agentToolCall = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-tool-call.js'));
const agentToolLoading = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-tool-loading.js'));
const agentToolExecution = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-tool-execution.js'));
const agentProjectRetrieval = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-project-retrieval.js'));
const agentLiteratureSearch = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-literature-search.js'));
const agentLiteratureSearchWorkflow = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'literature-search', 'agent-literature-search-workflow.js'));
const agentPaperContextLoader = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-paper-context-loader.js'));
const agentPaperDownload = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-paper-download.js'));
const agentPaperKnowledgeDatabase = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-paper-knowledge-database.js'));
const agentPaperAnalysis = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-paper-analysis.js'));
const agentScienceReasoningLoop = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'science-reasoning-loop', 'index.js'));
const agentToolSmokeTest = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-tool-smoke-test.js'));
const agentResponseLayer = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-response-layer.js'));
const agentValidationSafety = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-validation-safety.js'));
const agentObservability = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'shared', 'agent-observability.js'));
const agentPythonSandbox = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-python-sandbox.js'));
const agentPython = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-python-sandbox.js'));
const agentPythonOrchestration = agentPython;
const agentPythonCodegen = agentPython;
const agentWebFallback = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-web-fallback.js'));
const phase89Runtime = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-phase89-runtime.js'));
const agentSqliteIndex = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-sqlite-index.js'));
const sequenceLibrary = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'sequence', 'sequence-library.js'));
const objectGraph = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'object-graph.js'));
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
    'renderChemicalOptions',
    'normalizeIupacPattern',
    'matchesIupacPattern',
    'parseCrisprTargetsInput',
    'collectCrisprPamSites',
    'computeCrisprOffTargetStats',
    'designCrisprGuides'
  ]
);
const sequenceViewerInternals = loadEsmStyleModule(
  path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer.js'),
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
  path.join(__dirname, 'src', 'renderer', 'modules', 'gel-analysis.js'),
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
  path.join(__dirname, 'src', 'renderer', 'modules', 'gel', 'lane-table.js')
);
const papersManagementInternals = loadEsmStyleModule(
  path.join(__dirname, 'src', 'renderer', 'modules', 'papers-management.js'),
  {},
  ['normalizePaperSummary']
);
const papersPdfViewerInternals = loadEsmStyleModule(
  path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer.js')
);
const assayAnalysis = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'assay', 'analysis', 'index.js'));
const mainUtils = require(path.join(__dirname, 'src', 'main', 'lib', 'main-utils.js'));
const telegramBot = require(path.join(__dirname, 'src', 'main', 'lib', 'telegramBot.js'));
const forgeConfig = require(path.join(__dirname, 'forge.config.js'));
const packageManifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

const AGENT_SIMULATION_DISPATCH_TOOL_NAMES = new Set([
  'search_projects',
  'search_protocols',
  'search_notebook_entries',
  'search_workflows',
  'search_assays',
  'search_gel_analyses',
  'search_inventory',
  'search_papers',
  'search_uniprot',
  'search_pubmed',
  'search_crossref',
  'search_europe_pmc',
  'search_web',
  'toolbox_molarity_calculator',
  'toolbox_peptide_properties',
  'toolbox_buffer_preparer',
  'toolbox_dna_to_protein',
  'toolbox_protein_to_dna',
  'toolbox_oligo_properties',
  'toolbox_extinction_coefficient',
  'toolbox_qpcr_efficiency',
  'toolbox_crispr_sgrna_designer',
  'run_python_sandbox',
  'download_paper_pdf'
]);

const {
  buildAgentSimulationSnapshot,
  pickMockRows,
  buildMockToolArgs,
  buildMockToolDispatch,
  runSimulatedAgentTurn
} = createAgentSimulationSupport({
  assert,
  agentIntentParser,
  agentRouting,
  agentTools,
  AGENT_SIMULATION_DISPATCH_TOOL_NAMES
});

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
  TextDecoder,
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
  memoryStorage,
  shared,
  agentRouting,
  agentIntentParser,
  agentTools,
  agentProtocolGeneration,
  agentProtocolMatching,
  agentNotebookGeneration,
  agentNotebookDraft,
  agentInventoryLookup,
  agentRecordLookup,
  agentSubAgent,
  agentChatLog,
  agentContextManagement,
  agentMemory,
  agentToolCall,
  agentToolLoading,
  agentToolExecution,
  agentProjectRetrieval,
  agentLiteratureSearch,
  agentLiteratureSearchWorkflow,
  agentPaperContextLoader,
  agentPaperDownload,
  agentPaperKnowledgeDatabase,
  agentPaperAnalysis,
  agentScienceReasoningLoop,
  agentToolSmokeTest,
  agentResponseLayer,
  agentValidationSafety,
  agentObservability,
  agentPythonSandbox,
  agentPython,
  agentPythonOrchestration,
  agentPythonCodegen,
  agentWebFallback,
  phase89Runtime,
  agentSqliteIndex,
  sequenceLibrary,
  objectGraph,
  toolBox,
  sequenceViewerInternals,
  gelAnalysisInternals,
  gelLaneTableInternals,
  papersManagementInternals,
  papersPdfViewerInternals,
  assayAnalysis,
  mainUtils,
  telegramBot,
  forgeConfig,
  packageManifest,
  AGENT_SIMULATION_DISPATCH_TOOL_NAMES,
  buildAgentSimulationSnapshot,
  runSimulatedAgentTurn,
  pickMockRows,
  buildMockToolArgs,
  buildMockToolDispatch,
  readSource,
  assertClose
};

registerCoreSuite({ __dirname, scope: suiteScope });
registerEdgeSuite({ __dirname, scope: suiteScope });

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
