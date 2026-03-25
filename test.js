#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder, TextEncoder } = require('node:util');
const vm = require('node:vm');

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

function loadEsmStyleModule(filePath, extraGlobals = {}, additionalExports = []) {
  const source = fs.readFileSync(filePath, 'utf8');
  const exportNames = new Set();
  const importGlobals = {};
  let importCounter = 0;
  const resolveImportSpecifier = (specifier) => {
    const raw = String(specifier || '').trim();
    if (!raw.startsWith('.')) {
      return raw;
    }
    const resolved = path.resolve(path.dirname(filePath), raw);
    if (path.extname(resolved)) {
      return resolved;
    }
    return `${resolved}.js`;
  };
  const buildImportExpression = (specifier) => {
    const resolved = resolveImportSpecifier(specifier);
    if (!resolved.startsWith('/')) {
      return `require(${JSON.stringify(resolved)})`;
    }

    if (!fs.existsSync(resolved)) {
      return `require(${JSON.stringify(resolved)})`;
    }

    const importedSource = fs.readFileSync(resolved, 'utf8');
    const looksLikeEsm = /^\s*export\s+/m.test(importedSource) || /^\s*import\s+/m.test(importedSource);
    if (!looksLikeEsm) {
      return `require(${JSON.stringify(resolved)})`;
    }

    const key = `__esmImport${importCounter += 1}`;
    importGlobals[key] = loadEsmStyleModule(resolved);
    return key;
  };

  let transformed = source
    .replace(/^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm, (_match, names, specifier) => (
      `const { ${names.trim()} } = ${buildImportExpression(specifier)};`
    ))
    .replace(/^\s*import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm, (_match, name, specifier) => (
      `const ${name} = ${buildImportExpression(specifier)};`
    ))
    .replace(/^\s*import\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm, (_match, name, specifier) => (
      `const ${name} = ${buildImportExpression(specifier)};`
    ))
    .replace(/^\s*import\s+['"]([^'"]+)['"]\s*;?\s*$/gm, (_match, specifier) => (
      `${buildImportExpression(specifier)};`
    ))
    .replace(/^\s*export\s+(const|let|var)\s+([A-Za-z0-9_$]+)\s*=/gm, (match, _kind, name) => {
      exportNames.add(name);
      return match.replace('export ', '');
    })
    .replace(/^\s*export\s+function\s+([A-Za-z0-9_$]+)\s*\(/gm, (match, name) => {
      exportNames.add(name);
      return match.replace('export ', '');
    })
    .replace(/^\s*export\s+class\s+([A-Za-z0-9_$]+)\s*/gm, (match, name) => {
      exportNames.add(name);
      return match.replace('export ', '');
    })
    .replace(/^\s*export\s*\{([^}]+)\}\s*;?\s*$/gm, (_match, names) => {
      names
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
          const [left, right] = part.split(/\s+as\s+/);
          exportNames.add((right || left).trim());
      });
      return '';
    });

  additionalExports.forEach((name) => exportNames.add(name));
  transformed += `\nmodule.exports = { ${[...exportNames].join(', ')} };`;

  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
    require,
    console,
    Date,
    Math,
    JSON,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    Set,
    Map,
    structuredClone,
    ...importGlobals,
    ...extraGlobals
  });

  vm.runInContext(transformed, context, { filename: filePath });
  return context.module.exports;
}

function toCamelCase(value) {
  return String(value || '').replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
}

class MockClassList {
  constructor() {
    this.valueSet = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => {
      if (token) {
        this.valueSet.add(String(token));
      }
    });
  }

  remove(...tokens) {
    tokens.forEach((token) => this.valueSet.delete(String(token)));
  }

  contains(token) {
    return this.valueSet.has(String(token));
  }

  toggle(token, force) {
    const normalized = String(token);
    if (typeof force === 'boolean') {
      if (force) {
        this.valueSet.add(normalized);
      } else {
        this.valueSet.delete(normalized);
      }
      return force;
    }

    if (this.valueSet.has(normalized)) {
      this.valueSet.delete(normalized);
      return false;
    }
    this.valueSet.add(normalized);
    return true;
  }
}

class MockElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.textContent = '';
    this.dataset = {};
    this.files = [];
    this.style = {
      setProperty() {}
    };
    this.classList = new MockClassList();
    this.listeners = {};
    this._innerHTML = '';
    this._queryCache = new Map();
    this._submitButton = null;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this._queryCache.clear();
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  removeEventListener(type, listener) {
    const handlers = this.listeners[type];
    if (!handlers || !handlers.length) {
      return;
    }
    this.listeners[type] = handlers.filter((item) => item !== listener);
  }

  dispatch(type, event = {}) {
    const handlers = [...(this.listeners[type] || [])];
    handlers.forEach((handler) => {
      handler({
        preventDefault() {},
        stopPropagation() {},
        ...event,
        currentTarget: this,
        target: event.target || this
      });
    });
  }

  click() {
    this.dispatch('click');
  }

  change() {
    this.dispatch('change');
  }

  setSelectionRange() {}

  focus() {}

  reset() {}

  setSubmitButton(element) {
    this._submitButton = element;
  }

  querySelector(selector) {
    if (selector === 'button[type="submit"]') {
      return this._submitButton;
    }
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const key = String(selector || '');
    if (!this._queryCache.has(key)) {
      this._queryCache.set(key, this._buildDataMatches(key));
    }
    return this._queryCache.get(key);
  }

  _buildDataMatches(selector) {
    const attrMatch = selector.match(/\[data-([a-z0-9-]+)(?:=[^\]]+)?\]/i);
    if (!attrMatch) {
      return [];
    }

    const dataKey = attrMatch[1];
    const datasetKey = toCamelCase(dataKey);
    const attributeName = `data-${dataKey}`;
    const pattern = new RegExp(`${attributeName}(?:=\"([^\"]*)\")?(?=[\\s>])`, 'g');

    const results = [];
    let match;
    while ((match = pattern.exec(this._innerHTML))) {
      const element = new MockElement(`${this.id}:${attributeName}:${results.length}`);
      element.dataset[datasetKey] = String(match[1] || '');
      results.push(element);
    }

    return results;
  }
}

function createMockDocument(ids = []) {
  const elements = new Map();
  ids.forEach((id) => {
    elements.set(id, new MockElement(id));
  });

  return {
    getElementById(id) {
      const key = String(id || '');
      if (!elements.has(key)) {
        elements.set(key, new MockElement(key));
      }
      return elements.get(key);
    }
  };
}

function wireFormReset(formElement, inputElements) {
  formElement.reset = () => {
    (inputElements || []).forEach((item) => {
      item.value = '';
      item.checked = false;
      item.files = [];
    });
  };
}

function trigger(element, type, event = {}) {
  element.dispatch(type, event);
}

function flushAsync() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function btoaPolyfill(value) {
  return Buffer.from(String(value || ''), 'binary').toString('base64');
}

function atobPolyfill(value) {
  return Buffer.from(String(value || ''), 'base64').toString('binary');
}

function encodeBase64Url(raw) {
  return Buffer.from(String(raw || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

const memoryStorage = createMemoryStorage();
const shared = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'shared.js'), {
  localStorage: memoryStorage
});

function optionalRequire(modulePath, fallback = {}) {
  try {
    return require(modulePath);
  } catch {
    return fallback;
  }
}

const agentRouting = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-routing.js'));
const agentIntentParser = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'intent', 'agent-intent-parser.js'));
const agentTools = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-tools.js'));
const agentProtocolGeneration = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-protocol-generation.js'));
const agentProtocolMatching = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-protocol-matching.js'));
const agentNotebookGeneration = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-notebook-generation.js'));
const agentInventoryLookup = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-inventory-lookup.js'));
const agentRecordLookup = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-record-lookup.js'));
const agentSubAgent = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-sub-agent.js'));
const agentChatLog = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'context', 'agent-chat-log.js'));
const agentContextManagement = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'context', 'agent-context-management.js'));
const agentMemory = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'context', 'agent-memory.js'));
const agentToolCall = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-tool-call.js'));
const agentProjectRetrieval = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'agent-project-retrieval.js'));
const agentLiteratureSearch = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-literature-search.js'));
const agentPaperDownload = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-paper-download.js'));
const agentPaperAnalysis = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-paper-analysis.js'));
const agentScienceReasoningLoop = optionalRequire(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'runtime', 'agent-science-reasoning-loop.js'));
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
const sequenceLibrary = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'sequence-library.js'));
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
    'complementBase',
    'complementSequence',
    'renderDualStrandSequenceLinesHtml',
    'computeRestrictionAnnotationGeometry',
    'buildRestrictionCutPolylinePoints',
    'formatSelectedFeatureDetailHtml',
    'computeGcPercent',
    'countAmbiguousBases',
    'summarizeFastqQuality'
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
    'normalizeManualOverrides',
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
const papersManagementInternals = loadEsmStyleModule(
  path.join(__dirname, 'src', 'renderer', 'modules', 'papers-management.js'),
  {},
  [
    'normalizePaperSummary'
  ]
);
const assayAnalysis = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'assay-analysis.js'));
const mainUtils = require(path.join(__dirname, 'src', 'main', 'lib', 'main-utils.js'));
const telegramBot = require(path.join(__dirname, 'src', 'main', 'lib', 'telegramBot.js'));
const { generatePlannotateGbk } = require(path.join(__dirname, 'src', 'main', 'lib', 'plannotate-engine.js'));
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
  'toolbox_plannotate',
  'toolbox_crispr_sgrna_designer',
  'run_python_sandbox',
  'download_paper_pdf'
]);

const LEGACY_CHEMISTRY_DRAFT_KEY = 'enana_synthesis_chemistry_draft_v1';

function buildAgentSimulationSnapshot() {
  return {
    projects: [
      { id: 'project-atlas', name: 'Atlas', summary: 'PD-1 binder optimization and expression rescue.' },
      { id: 'project-mercury', name: 'Mercury', summary: 'Secondary screening workflow.' }
    ],
    protocols: [
      {
        id: 'protocol-transfection',
        name: 'HEK293 Transfection',
        category: 'cell',
        steps: ['Seed cells', 'Mix DNA and reagent', 'Incubate for [time]']
      },
      {
        id: 'protocol-assay',
        name: 'ELISA Workflow',
        category: 'assay',
        steps: ['Prepare plate', 'Add samples', 'Read plate']
      }
    ],
    notebookEntries: [
      {
        id: 'note-1',
        projectId: 'project-atlas',
        protocolId: 'protocol-transfection',
        protocolName: 'HEK293 Transfection',
        result: 'Expression dropped after day 3.',
        updatedAt: '2026-02-10T10:00:00.000Z'
      }
    ],
    workflows: [
      {
        id: 'workflow-1',
        name: 'Atlas Transfection Recovery',
        description: 'Rescue expression workflow after transfection.',
        projectId: 'project-atlas',
        notebookEntryIds: ['note-1'],
        blocks: [
          { id: 'wf-1-b1', protocolId: 'protocol-transfection' },
          { id: 'wf-1-b2', type: 'text', text: 'Check viability after 24 hours.' }
        ],
        links: [{ fromBlockId: 'wf-1-b1', toBlockId: 'wf-1-b2' }],
        updatedAt: '2026-02-10T09:00:00.000Z'
      },
      {
        id: 'workflow-2',
        name: 'Mercury ELISA Sweep',
        description: 'Secondary screen assay workflow.',
        projectId: 'project-mercury',
        notebookEntryIds: [],
        blocks: [
          { id: 'wf-2-b1', protocolId: 'protocol-assay' }
        ],
        links: [],
        updatedAt: '2026-02-08T09:00:00.000Z'
      }
    ],
    assays: [
      {
        id: 'assay-1',
        assay_number: 'ASSAY-101',
        name: 'PD-1 Viability',
        project_name: 'Atlas',
        notebook_entry_protocol_name: 'HEK293 Transfection',
        sample_axis: 'row',
        concentration_axis: 'column',
        result_well_count: 96,
        numeric_count: 96,
        updated_at: '2026-02-10T11:00:00.000Z'
      }
    ],
    gelAnalyses: [
      {
        id: 'gel-1',
        name: 'Western Atlas 1',
        analysis_type: 'western',
        project_name: 'Atlas',
        notebook_entry_protocol_name: 'HEK293 Transfection',
        image_name: 'atlas-western-1.tiff',
        lane_count: 8,
        band_count: 20,
        confidence_label: 'high',
        confidence_score: 0.91,
        warnings: ['Minor background noise'],
        updated_at: '2026-02-10T12:00:00.000Z'
      }
    ],
    papers: [
      {
        id: 'paper-1',
        title: 'PD-1 Binder Design 2025',
        linkedType: 'project',
        linkedId: 'project-atlas',
        summary: 'Discusses expression bottlenecks and rescue strategies.',
        methods: [
          {
            title: 'Transfection method',
            steps: ['Culture cells', 'Transfect', 'Measure expression'],
            citations: ['doi:10.1000/pd1']
          }
        ]
      }
    ],
    inventory: {
      personal: [
        {
          zone: 'Bench',
          items: [{ id: 'pi-1', name: 'PD-1 plasmid', quantity: '2', location: 'Box A1' }]
        }
      ],
      chemicals: [
        { id: 'chem-1', name: 'Biotin', amount: '10 g', cas: '58-85-5', location: 'Shelf 2', supplier: 'Sigma' },
        { id: 'chem-2', name: 'Imidazole', amount: '500 g', cas: '288-32-4', location: 'Shelf 4', supplier: 'TCI' }
      ]
    },
    settings: {
      storagePath: '/tmp/enana-storage'
    }
  };
}

function pickMockRows(rows, projector, query, limit = 5) {
  const source = Array.isArray(rows) ? rows : [];
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) {
    return source.slice(0, limit);
  }
  const tokens = needle.split(/[^a-z0-9]+/i).map((token) => token.trim()).filter(Boolean);
  return source
    .filter((item) => {
      const target = String(projector(item) || '').toLowerCase();
      if (!tokens.length) {
        return target.includes(needle);
      }
      return tokens.some((token) => token.length >= 2 && target.includes(token));
    })
    .slice(0, limit);
}

function buildMockToolArgs(toolName, message, snapshot) {
  if (toolName === 'toolbox_molarity_calculator') {
    return {
      operation: 'mass_from_concentration_volume',
      concentration_value: 10,
      concentration_unit: 'mM',
      volume_value: 5,
      volume_unit: 'mL',
      molecular_weight_g_mol: 58.44,
      output_unit: 'mg'
    };
  }
  if (toolName === 'toolbox_peptide_properties') {
    return {
      sequence_text: 'ACDEFGHIKLMNPQRSTVWY',
      ph: 7
    };
  }
  if (toolName === 'toolbox_buffer_preparer') {
    return {
      volume_ml: 1000,
      components: [
        { name: 'NaCl', form: 'solid', molecular_weight_g_mol: 58.44, concentration_value: 150, concentration_unit: 'mM' },
        { name: 'Tween-20', form: 'liquid', concentration_value: 0.05, concentration_unit: 'percent_vv' }
      ]
    };
  }
  if (toolName === 'toolbox_dna_to_protein') {
    return {
      sequence_text: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG',
      sequence_type: 'DNA',
      frame: 1,
      stop_mode: 'star'
    };
  }
  if (toolName === 'toolbox_protein_to_dna') {
    return {
      protein_sequence: 'MKTIIALSYIFCLVFA',
      organism: 'ecoli',
      append_stop_codon: true,
      restriction_sites: ['GAATTC', 'AAGCTT']
    };
  }
  if (toolName === 'toolbox_oligo_properties') {
    return {
      sequence_text: 'ATGCGTATCGAT',
      oligo_type: 'DNA'
    };
  }
  if (toolName === 'toolbox_extinction_coefficient') {
    return {
      sequence_type: 'protein',
      sequence_text: 'MKWVTFISLLFLFSSAYS'
    };
  }
  if (toolName === 'toolbox_qpcr_efficiency') {
    return {
      points: [
        { quantity: 1, ct: 18.0 },
        { quantity: 0.1, ct: 21.3 },
        { quantity: 0.01, ct: 24.7 }
      ]
    };
  }
  if (toolName === 'toolbox_plannotate') {
    return {
      sequence_text: '>plasmid\\nATGCGTACGTAGCTAGCTAGCTAGCATCGATCGATCGATCGATCGATCG',
      topology: 'circular',
      detailed: false,
      min_identity: 85,
      min_coverage: 0.25,
      min_hit_length: 24,
      max_hits: 10,
      record_name: 'mock_plasmid'
    };
  }
  if (toolName === 'toolbox_crispr_sgrna_designer') {
    return {
      targets_text: '>Target_A\\nGAGTCCGAGCAGAAGAAGAAGGGGAGGAGGAGGAGGAGGA',
      reference_genome_id: 'human-hg38',
      pam_pattern: 'NGG',
      guide_length: 20,
      top_count: 5,
      min_gc: 35,
      max_gc: 75
    };
  }
  if (toolName === 'run_python_sandbox') {
    return {
      code: 'import math\nprint(round((2 + 8) / 2, 2))',
      timeout_ms: 1200,
      files: [],
      readback_paths: []
    };
  }
  if (toolName === 'download_paper_pdf') {
    return {
      linked_type: 'project',
      linked_name: snapshot.projects[0]?.name || 'Atlas',
      paper_pdf_url: 'https://example.org/paper.pdf',
      paper_file_name: 'atlas-paper.pdf',
      storage_path: snapshot.settings?.storagePath || '/tmp/enana-storage'
    };
  }
  return {
    query: String(message || 'atlas'),
    limit: 5
  };
}

function buildMockToolDispatch(snapshot) {
  const calls = [];

  const handlers = {
    search_projects: (args) => {
      const items = pickMockRows(snapshot.projects, (item) => `${item.name} ${item.summary}`, args?.query, args?.limit)
        .map((item) => ({
          id: item.id,
          name: item.name,
          summary: item.summary
        }));
      return {
        items,
        citations: items.map((item) => ({ source: 'project', pointer: item.id, reason: 'Matched project metadata.' })),
        summary: `Found ${items.length} matching projects.`
      };
    },
    search_protocols: (args) => {
      const items = pickMockRows(
        snapshot.protocols,
        (item) => `${item.name} ${item.category} ${(item.steps || []).join(' ')}`,
        args?.query,
        args?.limit
      ).map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        steps: Array.isArray(item.steps) ? item.steps : []
      }));
      return {
        items,
        citations: items.map((item) => ({ source: 'protocol', pointer: item.id, reason: 'Matched protocol name/steps.' })),
        summary: `Found ${items.length} matching protocols.`
      };
    },
    search_notebook_entries: (args) => {
      const items = pickMockRows(
        snapshot.notebookEntries,
        (item) => `${item.protocolName} ${item.result} ${item.updatedAt}`,
        args?.query,
        args?.limit
      ).map((item) => ({
        id: item.id,
        protocolName: item.protocolName,
        result: item.result,
        updatedAt: item.updatedAt
      }));
      return {
        items,
        citations: items.map((item) => ({ source: 'notebook_entry', pointer: item.id, reason: 'Matched notebook records.' })),
        summary: `Found ${items.length} matching notebook entries.`
      };
    },
    search_workflows: (args) => {
      const items = pickMockRows(
        snapshot.workflows,
        (item) => [
          item.name,
          item.description,
          (item.blocks || []).map((block) => block.text || block.protocolId).join(' ')
        ].join(' '),
        args?.query,
        args?.limit
      ).map((item) => {
        const project = (snapshot.projects || []).find((row) => row.id === item.projectId);
        return {
          id: item.id,
          name: item.name,
          project_name: project?.name || '',
          description: item.description || '',
          block_count: Array.isArray(item.blocks) ? item.blocks.length : 0,
          link_count: Array.isArray(item.links) ? item.links.length : 0,
          steps_preview: (item.blocks || []).map((block) => String(block?.text || block?.protocolId || '').trim()).filter(Boolean).slice(0, 8),
          updated_at: item.updatedAt || item.createdAt || ''
        };
      });
      return {
        items,
        citations: items.map((item) => ({ source: 'workflow', pointer: item.id, reason: 'Matched workflow metadata.' })),
        summary: `Found ${items.length} matching workflows.`
      };
    },
    search_assays: (args) => {
      const items = pickMockRows(
        snapshot.assays,
        (item) => `${item.name} ${item.project_name} ${item.notebook_entry_protocol_name}`,
        args?.query,
        args?.limit
      ).map((item) => ({ ...item }));
      return {
        items,
        citations: items.map((item) => ({ source: 'assay', pointer: item.id, reason: 'Matched assay metadata.' })),
        summary: `Found ${items.length} matching assays.`
      };
    },
    search_gel_analyses: (args) => {
      const items = pickMockRows(
        snapshot.gelAnalyses,
        (item) => `${item.name} ${item.project_name} ${item.notebook_entry_protocol_name}`,
        args?.query,
        args?.limit
      ).map((item) => ({ ...item }));
      return {
        items,
        citations: items.map((item) => ({ source: 'gel_analysis', pointer: item.id, reason: 'Matched gel analysis metadata.' })),
        summary: `Found ${items.length} matching gel analyses.`
      };
    },
    search_inventory: (args) => {
      const merged = [
        ...(snapshot.inventory?.chemicals || []).map((item) => ({ kind: 'chemical_inventory', ...item })),
        ...((snapshot.inventory?.personal || []).flatMap((zone) => (
          (zone.items || []).map((item) => ({ kind: 'personal_inventory', zone: zone.zone, ...item }))
        )))
      ];
      const items = pickMockRows(
        merged,
        (item) => `${item.name} ${item.cas || ''} ${item.location || ''} ${item.supplier || ''}`,
        args?.query,
        args?.limit
      ).map((item) => ({ ...item }));
      return {
        items,
        citations: items.map((item) => ({ source: item.kind, pointer: item.id || item.name, reason: 'Matched inventory metadata.' })),
        summary: `Found ${items.length} matching inventory records.`
      };
    },
    search_papers: (args) => {
      const items = pickMockRows(
        snapshot.papers,
        (item) => `${item.title} ${item.summary}`,
        args?.query,
        args?.limit
      ).map((item) => ({ ...item }));
      return {
        items,
        citations: items.map((item) => ({ source: 'paper', pointer: item.id, reason: 'Matched uploaded paper metadata.' })),
        summary: `Found ${items.length} matching papers.`
      };
    },
    search_uniprot: () => ({
      items: [
        {
          accession: 'P12345',
          entry_id: 'PD1_HUMAN',
          protein_name: 'Programmed cell death protein 1',
          gene_names: ['PDCD1'],
          organism: 'Homo sapiens',
          reviewed: true,
          length: 288,
          uniprot_url: 'https://www.uniprot.org/uniprotkb/P12345'
        }
      ],
      citations: [{ source: 'uniprot', pointer: 'P12345', reason: 'Matched UniProtKB protein record.' }],
      summary: 'Found 1 matching UniProt records.'
    }),
    search_pubmed: () => ({
      items: [
        {
          pmid: '12345678',
          title: 'PD-1 binder expression optimization',
          journal: 'J Mol Bio',
          pubdate: '2025-01-20',
          doi: '10.1000/pubmed',
          authors: ['A. Smith', 'B. Jones'],
          pubmed_url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/'
        }
      ],
      citations: [{ source: 'pubmed', pointer: '12345678', reason: 'Matched PubMed article metadata.' }],
      summary: 'Found 1 matching PubMed records.'
    }),
    search_crossref: () => ({
      items: [
        {
          doi: '10.1000/crossref',
          title: 'Crossref indexed binder design study',
          journal: 'Bioengineering',
          published: '2025-04-10',
          type: 'journal-article',
          cited_by_count: 12,
          authors: ['C. Li', 'D. Park'],
          url: 'https://doi.org/10.1000/crossref'
        }
      ],
      citations: [{ source: 'crossref', pointer: '10.1000/crossref', reason: 'Matched Crossref works metadata.' }],
      summary: 'Found 1 matching Crossref records.'
    }),
    search_europe_pmc: () => ({
      items: [
        {
          id: 'PMC1234567',
          source: 'MED',
          title: 'Europe PMC indexed assay design',
          author_string: 'E. Kim; F. Ray',
          journal: 'Lab Methods',
          pub_year: '2024',
          doi: '10.1000/epmc',
          pmid: '45678901',
          pmcid: 'PMC1234567',
          europe_pmc_url: 'https://europepmc.org/article/MED/45678901'
        }
      ],
      citations: [{ source: 'europe_pmc', pointer: '45678901', reason: 'Matched Europe PMC metadata.' }],
      summary: 'Found 1 matching Europe PMC records.'
    }),
    search_web: () => ({
      items: [
        {
          title: 'PD-1 review article',
          url: 'https://example.org/pd1-review',
          snippet: 'A concise review of PD-1 biology and assay considerations.',
          source_domain: 'example.org',
          published_at: '2026-01-12'
        }
      ],
      citations: [{ source: 'web_source', pointer: 'https://example.org/pd1-review', reason: 'Matched web source metadata.' }],
      summary: 'Found 1 matching web source.'
    }),
    toolbox_molarity_calculator: () => ({
      items: [
        {
          operation: 'mass_from_concentration_volume',
          result_value: 2.922,
          result_unit: 'mg',
          concentration_M: 0.01,
          volume_L: 0.005,
          molecular_weight_g_mol: 58.44
        }
      ],
      citations: [{ source: 'toolbox_molarity', pointer: 'mass_from_concentration_volume', reason: 'Computed deterministic molarity conversion.' }],
      summary: 'Calculated mass from concentration and volume in mg.'
    }),
    toolbox_peptide_properties: () => ({
      items: [
        {
          sequence: 'ACDEFGHIKLMNPQRSTVWY',
          length: 20,
          mass: 2395.7,
          pI: 7.1,
          net_charge: -0.4,
          extinction_reduced: 6990,
          extinction_oxidized: 7115
        }
      ],
      citations: [{ source: 'toolbox_peptide', pointer: 'length:20', reason: 'Computed peptide physicochemical properties.' }],
      summary: 'Computed peptide properties for 20 residues.'
    }),
    toolbox_buffer_preparer: () => ({
      items: [
        {
          name: 'NaCl',
          form: 'solid',
          concentration_value: 150,
          concentration_unit: 'mM',
          molecular_weight_g_mol: 58.44,
          required_mg: 8766
        },
        {
          name: 'Tween-20',
          form: 'liquid',
          concentration_value: 0.05,
          concentration_unit: 'percent_vv',
          required_ml: 0.5
        }
      ],
      citations: [{ source: 'toolbox_buffer', pointer: 'components:2', reason: 'Calculated buffer component amounts.' }],
      summary: 'Calculated 2 buffer components.'
    }),
    toolbox_dna_to_protein: () => ({
      items: [
        {
          sequence_type: 'DNA',
          cleaned_sequence: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG',
          protein: 'MAIVMGR*KGAR*',
          codons: 13,
          frame: 1,
          strand: '+',
          remainderBases: 0
        }
      ],
      citations: [{ source: 'toolbox_translation', pointer: '+1', reason: 'Translated sequence with codon table.' }],
      summary: 'Translated 13 codons in frame +1.'
    }),
    toolbox_protein_to_dna: () => ({
      items: [
        {
          ok: true,
          protein: 'MKTIIALSYIFCLVFA*',
          dna: 'ATGAAAACAATTATTGCTCTTTCTTATATTTTTTGTTTTGCTTAA',
          aa_length: 17,
          nt_length: 51
        }
      ],
      citations: [{ source: 'toolbox_reverse_translation', pointer: 'aa:17', reason: 'Reverse-translated protein sequence to DNA.' }],
      summary: 'Reverse-translated protein to 51 bp DNA.'
    }),
    toolbox_oligo_properties: () => ({
      items: [
        {
          oligo_type: 'DNA',
          sequence: 'ATGCGTATCGAT',
          length: 12,
          tm_celsius: 36,
          molecular_weight_g_mol: 3700,
          extinction_coefficient_m1_cm1: 123000
        }
      ],
      citations: [{ source: 'toolbox_oligo', pointer: 'DNA:12', reason: 'Computed oligo properties.' }],
      summary: 'Computed oligo properties for 12 nt (DNA).'
    }),
    toolbox_extinction_coefficient: () => ({
      items: [
        {
          sequence_type: 'protein',
          sequence: 'MKWVTFISLLFLFSSAYS',
          length: 18,
          extinction_reduced_m1_cm1: 6990,
          extinction_oxidized_m1_cm1: 6990
        }
      ],
      citations: [{ source: 'toolbox_extinction', pointer: 'protein:18', reason: 'Computed protein extinction coefficients.' }],
      summary: 'Computed protein extinction coefficient for 18 residues.'
    }),
    toolbox_qpcr_efficiency: () => ({
      items: [
        {
          slope: -3.32,
          slope_source: 'regression',
          intercept: 18.01,
          r_squared: 0.998,
          points_used: 3,
          efficiency_percent: 100.4
        }
      ],
      citations: [{ source: 'toolbox_qpcr', pointer: 'points:3', reason: 'Computed qPCR efficiency from standard curve points.' }],
      summary: 'Computed qPCR efficiency as 100.40%.'
    }),
    toolbox_plannotate: () => ({
      items: [
        {
          id: 'mock_hit_1',
          feature: 'CMV promoter',
          type: 'promoter',
          start: 1,
          end: 600,
          strand: '+',
          identity_percent: 99.5,
          coverage_percent: 100
        }
      ],
      citations: [{ source: 'plannotate', pointer: 'mock_hit_1', reason: 'Annotated pLannotate feature hit from plain-text sequence.' }],
      summary: 'Annotated 1 feature hit from plain-text sequence.'
    }),
    toolbox_crispr_sgrna_designer: () => ({
      items: [
        {
          rank: 1,
          target_id: 'target-1',
          target_name: 'Target_A',
          strand: '+',
          start: 1,
          end: 20,
          guide_sequence: 'GAGTCCGAGCAGAAGAAGAA',
          pam_sequence: 'GGG',
          gc_percent: 55,
          on_target_score: 78,
          specificity_score: 88,
          off_target_rate: 12
        }
      ],
      citations: [{ source: 'toolbox_crispr', pointer: 'target-1:1-20:+', reason: 'Ranked sgRNA candidate from deterministic CRISPR scoring.' }],
      summary: 'Designed 1 sgRNA candidate from 1 selected target.'
    }),
    run_python_sandbox: () => ({
      items: [
        {
          run_id: 'sandbox-run-1',
          status: 'ok',
          timeout_ms: 1200,
          python_executable: 'python3',
          exit_code: 0,
          signal: null,
          timed_out: false,
          stdout: '5.0',
          stderr: '',
          files_written: [],
          readback_files: [],
          warnings: []
        }
      ],
      citations: [{ source: 'python_sandbox', pointer: 'sandbox-run-1', reason: 'Executed deterministic Python sandbox.' }],
      summary: 'Python sandbox execution completed.'
    }),
    download_paper_pdf: (args) => {
      const linkedName = String(args?.linked_name || 'Atlas').trim() || 'Atlas';
      return {
        items: [
          {
            kind: 'paper',
            source_url: String(args?.paper_pdf_url || 'https://example.org/paper.pdf'),
            file_name: String(args?.paper_file_name || 'paper.pdf'),
            relative_path: `${linkedName}/Papers/${String(args?.paper_file_name || 'paper.pdf')}`,
            size_bytes: 2048
          }
        ],
        citations: [{ source: 'paper_download', pointer: `${linkedName}/Papers`, reason: 'Downloaded mocked paper file.' }],
        summary: 'Downloaded 1 paper PDF and 0 SI PDF(s).'
      };
    }
  };

  const dispatch = async (toolName, args) => {
    calls.push({ toolName, args: args && typeof args === 'object' ? { ...args } : {} });
    const handler = handlers[toolName];
    if (!handler) {
      throw new Error(`Unexpected tool in mock dispatch: ${toolName}`);
    }
    const raw = handler(args || {});
    return {
      ok: true,
      tool_name: toolName,
      input: args && typeof args === 'object' ? { ...args } : {},
      items: Array.isArray(raw?.items) ? raw.items : [],
      citations: Array.isArray(raw?.citations) ? raw.citations : [],
      summary: String(raw?.summary || '')
    };
  };

  return {
    dispatch,
    calls,
    coveredToolNames: new Set(Object.keys(handlers))
  };
}

async function runSimulatedAgentTurn({
  message,
  snapshot = buildAgentSimulationSnapshot(),
  allowWriteTools = false,
  writeIntent = false,
  parserPayload = null
}) {
  const availableToolNames = [...AGENT_SIMULATION_DISPATCH_TOOL_NAMES];
  const inferPrimaryIntent = (text) => {
    const source = String(text || '').toLowerCase();
    if (/\b(compare .+ vs|extract methods?|extract reagents?|key figures?)\b/.test(source)) {
      return 'paper_analysis';
    }
    if (/\b(mw|molecular weight|inventory|stock|where is|cas)\b/.test(source)) {
      return 'inventory_lookup';
    }
    if (/\b(last time|history|record|workflow step)\b/.test(source)) {
      return 'record_lookup';
    }
    if (/\bproject\b/.test(source)) {
      return 'project_science_question';
    }
    if (/\bpaper|pdf|journal|literature|publication\b/.test(source)) {
      return 'paper_analysis';
    }
    if (/\bpython|csv|plot|compute|code|script\b/.test(source)) {
      return 'result_analysis';
    }
    if (/\b(i grew|i did|i ran|transfection|protocol|notebook)\b/.test(source)) {
      return 'protocol_to_notebook';
    }
    return 'general_science_question';
  };
  const primaryIntent = inferPrimaryIntent(message);
  const sourceText = String(message || '');
  const sourceLower = sourceText.toLowerCase();
  const inferProjectName = () => {
    const explicit = sourceText.match(/\bproject\s+([a-z0-9][a-z0-9\- _]{1,60})/i);
    if (explicit) {
      return String(explicit[1] || '').trim();
    }
    if (sourceLower.includes('atlas')) {
      return 'Atlas';
    }
    return null;
  };
  const inferPaperTitle = () => {
    const quoted = sourceText.match(/["“”']([^"“”']{4,220})["“”']/);
    if (quoted) {
      return String(quoted[1] || '').trim();
    }
    return null;
  };
  const inferInventoryItem = () => {
    const mwMatch = sourceText.match(/\b(?:mw|molecular weight)\s+(?:of\s+)?([a-z0-9\- ]{2,80})/i);
    if (mwMatch) {
      return String(mwMatch[1] || '').trim();
    }
    const whereMatch = sourceText.match(/\bwhere is\s+([a-z0-9\- ]{2,80})/i);
    if (whereMatch) {
      return String(whereMatch[1] || '').trim();
    }
    return null;
  };
  const inferredEntities = {
    activity_type: /\b(transfection|culture|grew|purif|assay|expression)\b/i.test(sourceText)
      ? (sourceLower.includes('transfection') ? 'transfection' : 'lab activity')
      : null,
    project_name: inferProjectName(),
    protocol_name: null,
    protein_name: /\b(pd-1|pd1)\b/i.test(sourceText) ? 'PD-1' : null,
    compound_name: null,
    inventory_item: inferInventoryItem(),
    cell_line: /\b(hek293|expi293|cho|293t)\b/i.test(sourceText)
      ? String((sourceText.match(/\b(hek293|expi293|cho|293t)\b/i) || [])[1] || '').toUpperCase()
      : null,
    paper_title: inferPaperTitle(),
    workflow_step: /\b(transfection|assay|purification)\b/i.test(sourceText)
      ? String((sourceText.match(/\b(transfection|assay|purification)\b/i) || [])[1] || '')
      : null,
    requested_output: /\b(analyze|analysis|plot|compute|compare|extract)\b/i.test(sourceText)
      ? 'analysis'
      : null
  };
  if (primaryIntent === 'inventory_lookup' && inferredEntities.inventory_item && !inferredEntities.compound_name) {
    inferredEntities.compound_name = inferredEntities.inventory_item;
  }
  const fallbackParserPayload = {
    primary_intent: primaryIntent,
    needs_clarification: false,
    clarification_reason: null,
    entities: inferredEntities,
    inventory_search: {
      normalized_query: null,
      candidate_terms: [],
      aliases: [],
      search_mode: null
    },
    protocol_candidates: primaryIntent === 'protocol_to_notebook'
      ? [inferredEntities.protocol_name || 'General Protocol']
      : [],
    reasoning_summary: 'test parser payload'
  };
  const parserResult = agentIntentParser.normalizeIntentParserPayload(parserPayload || fallbackParserPayload);
  assert.equal(parserResult.ok, true);
  const routing = agentRouting.buildRoutingDecisionFromIntentParser({
    parserPayload: parserResult.payload,
    message,
    snapshot,
    availableToolNames,
    writeIntent
  });

  const requiresApproval = writeIntent && !allowWriteTools;
  if (routing.plan.needs_clarification) {
    return {
      routing,
      toolOutputs: [],
      toolTrace: [],
      citations: [],
      executedToolNames: [],
      requiresApproval,
      dispatchCalls: []
    };
  }

  const { dispatch, calls } = buildMockToolDispatch(snapshot);
  const toolNames = routing.plan.needs_tools
    ? [...new Set(Array.isArray(routing.plan.selected_tool_names) ? routing.plan.selected_tool_names : [])]
    : [];

  const toolOutputs = [];
  const toolTrace = [];
  const citations = [];

  for (const toolName of toolNames) {
    const args = buildMockToolArgs(toolName, message, snapshot);
    const result = await agentTools.executeToolCall(toolName, args, {
      allowWriteTools,
      dispatch,
      fuzzyVocabulary: ['atlas', 'biotin', 'pd-1', 'transfection', 'assay', 'elisa']
    });
    toolOutputs.push(result);
    toolTrace.push({
      tool: toolName,
      summary: result.summary,
      ok: result.ok === true
    });
    if (Array.isArray(result.citations)) {
      citations.push(...result.citations);
    }
  }

  return {
    routing,
    toolOutputs,
    toolTrace,
    citations,
    executedToolNames: toolOutputs.map((item) => item.tool_name),
    requiresApproval,
    dispatchCalls: calls
  };
}

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
  agentInventoryLookup,
  agentRecordLookup,
  agentSubAgent,
  agentChatLog,
  agentContextManagement,
  agentMemory,
  agentToolCall,
  agentProjectRetrieval,
  agentLiteratureSearch,
  agentPaperDownload,
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
  papersManagementInternals,
  assayAnalysis,
  mainUtils,
  telegramBot,
  generatePlannotateGbk,
  forgeConfig,
  packageManifest,
  AGENT_SIMULATION_DISPATCH_TOOL_NAMES,
  LEGACY_CHEMISTRY_DRAFT_KEY,
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
