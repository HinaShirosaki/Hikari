#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
const shared = loadEsmStyleModule(path.join(__dirname, 'modules', 'shared.js'), {
  localStorage: memoryStorage
});
const agentRouting = require(path.join(__dirname, 'agent-routing.js'));
const agentTools = require(path.join(__dirname, 'agent-tools.js'));
const objectGraph = loadEsmStyleModule(path.join(__dirname, 'modules', 'object-graph.js'));
const toolBox = loadEsmStyleModule(
  path.join(__dirname, 'modules', 'tool-box.js'),
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
  path.join(__dirname, 'modules', 'sequence-viewer.js'),
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
    'formatSelectedFeatureDetailHtml',
    'computeGcPercent',
    'countAmbiguousBases',
    'summarizeFastqQuality'
  ]
);
const gelAnalysisInternals = loadEsmStyleModule(
  path.join(__dirname, 'modules', 'gel-analysis.js'),
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
  path.join(__dirname, 'modules', 'papers-management.js'),
  {},
  [
    'normalizePaperSummary'
  ]
);
const assayAnalysis = loadEsmStyleModule(path.join(__dirname, 'modules', 'assay-analysis.js'));
const mainUtils = require(path.join(__dirname, 'main-utils'));
const telegramBot = require(path.join(__dirname, 'telegramBot.js'));
const { generatePlannotateGbk } = require(path.join(__dirname, 'plannotate-engine.js'));
const forgeConfig = require(path.join(__dirname, 'forge.config.js'));
const packageManifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const AGENT_IO_CONTRACT_RAW = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8')
);
const AGENT_IO_CONTRACT = agentTools.loadToolContract(AGENT_IO_CONTRACT_RAW);
const AGENT_IO_TOOL_NAMES = AGENT_IO_CONTRACT.tools.map((tool) => tool.name);
const AGENT_SIMULATION_DISPATCH_TOOL_NAMES = new Set([
  'search_projects',
  'search_protocols',
  'search_notebook_entries',
  'search_assays',
  'search_gel_analyses',
  'search_inventory',
  'search_papers',
  'search_uniprot',
  'search_pubmed',
  'search_crossref',
  'search_europe_pmc',
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
  fallbackPayload = null
}) {
  const availableToolNames = AGENT_IO_TOOL_NAMES.slice();
  const ruleDecision = agentRouting.buildRuleBasedRoutingDecision({
    message,
    snapshot,
    availableToolNames,
    toolContract: AGENT_IO_CONTRACT,
    writeIntent
  });

  const routing = fallbackPayload
    ? agentRouting.mergeRoutingFallback({
      ruleDecision,
      fallbackPayload,
      message,
      writeIntent,
      availableToolNames,
      toolContract: AGENT_IO_CONTRACT
    })
    : ruleDecision;

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
      contract: AGENT_IO_CONTRACT,
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

test('plannotate GenBank generator builds a valid record with qualifiers', () => {
  const gbk = generatePlannotateGbk({
    sequence: 'ATGCGTACGTAGCTAGCTAGCTAGCATCGATCGATCGATCGATCGATCG',
    topology: 'circular',
    recordName: 'demo_plasmid',
    hits: [
      {
        qstart: 0,
        qend: 12,
        sframe: 1,
        Feature: 'promoterA',
        Type: 'promoter',
        db: 'snapgene',
        pident: 99.7,
        percmatch: 100,
        fragment: false
      }
    ]
  });

  assert.match(gbk, /^LOCUS\s+demo_plasmid/m);
  assert.match(gbk, /^FEATURES\s+Location\/Qualifiers$/m);
  assert.match(gbk, /^\s+promoter\s+1\.\.12$/m);
  assert.match(gbk, /\/label="promoterA"/);
  assert.match(gbk, /\/identity="99\.7"/);
  assert.match(gbk, /^ORIGIN$/m);
  assert.match(gbk, /^\/\/$/m);
});

test('plannotate GenBank generator preserves reverse-strand origin crossing order', () => {
  const gbk = generatePlannotateGbk({
    sequence: 'ATGCGTACGTAGCTAGCTAGCTAGCATCGATCGATCGATCGATCGATCG',
    topology: 'circular',
    hits: [
      {
        qstart: 40,
        qend: 5,
        sframe: -1,
        Feature: 'cdsX',
        Type: 'CDS',
        db: 'swissprot',
        pident: 87.2,
        percmatch: 45.4,
        fragment: true,
        crossesOrigin: true
      }
    ]
  });

  assert.match(gbk, /complement\(join\(1\.\.5,41\.\.49\)\)/);
  assert.match(gbk, /\/label="cdsX \(fragment\)"/);
});

test('papers-management normalizePaperSummary preserves non-JSON text', () => {
  const rawSummary = 'This paper reports a new screening assay with reproducible hit enrichment.';
  const normalized = papersManagementInternals.normalizePaperSummary(rawSummary);
  assert.equal(normalized.summary, rawSummary);
  assert.equal(normalized.structured, null);
});

test('papers-management normalizePaperSummary prefers structured plain-English summary', () => {
  const rawSummary = JSON.stringify({
    title: 'Demo paper',
    plain_english_summary: 'A simple plain-language summary.',
    main_conclusion: 'Main conclusion text.'
  });
  const normalized = papersManagementInternals.normalizePaperSummary(rawSummary);
  assert.equal(normalized.summary, 'A simple plain-language summary.');
  assert.equal(normalized.structured?.title, 'Demo paper');
});

test('normalizeState keeps defaults and migrates legacy LLM API key', () => {
  const normalized = shared.normalizeState({
    growthMetrics: {
      counters: {
        protocol_share_sent: '3',
        protocol_share_imported: 'bad'
      },
      events: 'not-an-array'
    },
    settings: {
      llm: {
        api: 'sk-test-123'
      }
    }
  });

  assert.equal(Array.isArray(normalized.members), true);
  assert.equal(normalized.growthMetrics.counters.protocol_share_sent, 3);
  assert.equal(normalized.growthMetrics.counters.protocol_share_imported, 0);
  assert.equal(Array.isArray(normalized.growthMetrics.events), true);
  assert.equal(normalized.growthMetrics.events.length, 0);
  assert.equal(normalized.settings.llm.provider, 'openai');
  assert.equal(normalized.settings.llm.apiKey, 'sk-test-123');
  assert.equal(
    normalized.settings.llm.apiEndpoint,
    shared.defaultState.settings.llm.apiEndpoint
  );
});

test('persistState and loadState round trip through localStorage', () => {
  memoryStorage.clear();
  const state = shared.normalizeState({
    members: [{ id: 'm1', name: 'Alice' }]
  });
  shared.persistState(state);

  const loaded = shared.loadState();
  assert.equal(loaded.members.length, 1);
  assert.equal(loaded.members[0].id, 'm1');

  memoryStorage.setItem(shared.STORAGE_KEY, '{bad-json');
  const fallback = shared.loadState();
  assert.equal(JSON.stringify(fallback), JSON.stringify(shared.defaultState));
});

test('loadState migrates legacy synthesis drafts and clears legacy key', () => {
  memoryStorage.clear();
  const base = shared.normalizeState({});
  base.synthesisChemistryDrafts = {};
  memoryStorage.setItem(shared.STORAGE_KEY, JSON.stringify(base));

  const legacyDrafts = {
    projectA: {
      __synthesis__: {
        synthesisChemistry: { enabled: true }
      }
    }
  };
  memoryStorage.setItem(LEGACY_CHEMISTRY_DRAFT_KEY, JSON.stringify(legacyDrafts));

  const loaded = shared.loadState();
  assert.deepEqual(loaded.synthesisChemistryDrafts, legacyDrafts);
  assert.equal(memoryStorage.getItem(LEGACY_CHEMISTRY_DRAFT_KEY), null);

  const persisted = JSON.parse(memoryStorage.getItem(shared.STORAGE_KEY));
  assert.deepEqual(persisted.synthesisChemistryDrafts, legacyDrafts);
});

test('loadState drops invalid legacy synthesis draft payloads', () => {
  memoryStorage.clear();
  memoryStorage.setItem(shared.STORAGE_KEY, JSON.stringify(shared.normalizeState({})));
  memoryStorage.setItem(LEGACY_CHEMISTRY_DRAFT_KEY, JSON.stringify(['invalid']));

  const loaded = shared.loadState();
  assert.deepEqual(loaded.synthesisChemistryDrafts, {});
  assert.equal(memoryStorage.getItem(LEGACY_CHEMISTRY_DRAFT_KEY), null);
});

test('trackGrowthEvent increments counters and caps event history at 500', () => {
  const state = {};
  shared.trackGrowthEvent(state, 'protocol_share_sent', { source: 'test' });
  assert.equal(state.growthMetrics.counters.protocol_share_sent, 1);
  assert.equal(state.growthMetrics.events.length, 1);

  for (let i = 0; i < 510; i += 1) {
    shared.trackGrowthEvent(state, 'custom_event', { index: i });
  }
  assert.equal(state.growthMetrics.events.length, 500);
});

test('safeText and cssEscape escape unsafe input', () => {
  assert.equal(shared.safeText(`<script>alert('x')</script>`), '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
  assert.equal(shared.cssEscape(String.raw`a"b\c`), String.raw`a\"b\\c`);
});

test('main-utils handles supported data-file extensions and fallback behavior', () => {
  assert.equal(mainUtils.hasSupportedDataExtension('/tmp/file.json'), true);
  assert.equal(mainUtils.hasSupportedDataExtension('/tmp/file.ENA'), true);
  assert.equal(mainUtils.hasSupportedDataExtension('/tmp/file.txt'), false);

  assert.equal(
    mainUtils.normalizeDataFilePath('/tmp/session.ena', '/tmp/default.json'),
    '/tmp/session.ena'
  );
  assert.equal(
    mainUtils.normalizeDataFilePath('/tmp/session', '/tmp/default.json'),
    '/tmp/session.json'
  );
  assert.equal(
    mainUtils.normalizeDataFilePath('', '/tmp/default.ena'),
    '/tmp/default.ena'
  );
  assert.equal(mainUtils.normalizeDataFilePath('', ''), '');
});

test('main-utils normalizes output names, suffixes, and sequence input', () => {
  assert.equal(mainUtils.sanitizeOutputName('  My Plasmid v1  '), 'My_Plasmid_v1');
  assert.equal(mainUtils.sanitizeOutputName('***', 'fallback'), 'fallback');
  assert.equal(mainUtils.sanitizeSuffix(' _pL ann!* '), '_pLann');

  const normalized = mainUtils.normalizeSequenceInput('acgt '.repeat(30));
  const lines = normalized.trimEnd().split('\n');
  assert.equal(lines[0], '>sequence');
  assert.equal(lines[1].length, 80);
  assert.equal(lines[2].length, 40);
  assert.equal(mainUtils.normalizeSequenceInput('>existing\nACGT\n'), '>existing\nACGT');
});

[
  ['I grew HEK293 cells and ran transfection today.', 'protocol_to_notebook'],
  ['What is the MW of biotin in stock?', 'inventory_lookup'],
  ['What did we do last time for PD-1 expression?', 'record_lookup'],
  ['Why did project Atlas fail after transfection?', 'project_science_question'],
  ['Summarize this paper on PD-1 binder design.', 'paper_analysis'],
  ['Use Python to analyze this CSV and plot IC50.', 'coding_data_analysis'],
  ['What is ELISA and how does it work?', 'general_science_question']
].forEach(([message, expectedIntent], idx) => {
  test(`[P0] agent-routing classifyIntentByRules case ${idx + 1}`, () => {
    const classified = agentRouting.classifyIntentByRules(message, {});
    assert.equal(classified.intent, expectedIntent);
    assert.equal(classified.confidence > 0, true);
  });
});

[
  ['protocol_to_notebook', { activity: 'grew cells', protocol: '', compound: '' }, { needs_tools: true, needs_protocol_search: true, needs_python: false }],
  ['inventory_lookup', { compound: 'biotin' }, { needs_tools: true, needs_protocol_search: false, needs_python: false }],
  ['record_lookup', { workflow_step: 'transfection' }, { needs_tools: true, needs_notebook_retrieval: true }],
  ['project_science_question', { project: 'Atlas' }, { needs_tools: true, needs_notebook_retrieval: true }],
  ['paper_analysis', { paper_title: 'Binder paper' }, { needs_tools: true, needs_pdf_reading: true }],
  ['coding_data_analysis', { activity: 'fit curve' }, { needs_tools: true, needs_python: true }],
  ['general_science_question', {}, { needs_tools: false }]
].forEach(([intent, entities, expectedFlags], idx) => {
  test(`[P0] agent-routing buildExecutionPlan case ${idx + 1}`, () => {
    const plan = agentRouting.buildExecutionPlan({
      intent,
      entities,
      message: 'test message',
      writeIntent: false,
      classificationConfidence: 0.9,
      fallbackUsed: true
    });
    Object.entries(expectedFlags).forEach(([key, expected]) => {
      assert.equal(plan[key], expected);
    });
  });
});

test('agent-routing fallback trigger and malformed fallback degrade safely', () => {
  const ruleDecision = agentRouting.buildRuleBasedRoutingDecision({
    message: 'help',
    snapshot: {},
    availableToolNames: ['search_projects', 'search_protocols', 'search_notebook_entries'],
    writeIntent: false
  });
  assert.equal(agentRouting.shouldUseRoutingFallback(ruleDecision), true);
  const merged = agentRouting.mergeRoutingFallback({
    ruleDecision,
    fallbackPayload: 'not-json',
    message: 'help',
    writeIntent: false,
    availableToolNames: ['search_projects', 'search_protocols', 'search_notebook_entries']
  });
  assert.equal(merged.classifier.fallbackAttempted, true);
  assert.equal(merged.classifier.fallbackUsed, false);
  assert.equal(merged.plan.needs_clarification, true);
  assert.equal(Boolean(merged.plan.clarification_question), true);
});

test('agent-routing uses scored tool selection when toolContract is provided', () => {
  const toolContract = agentTools.loadToolContract({
    tools: [
      { name: 'search_inventory', description: 'inventory reagent stock', input_schema: {}, output_schema: {} },
      { name: 'search_notebook_entries', description: 'notebook history', input_schema: {}, output_schema: {} },
      { name: 'search_uniprot', description: 'protein uniprot', input_schema: {}, output_schema: {} }
    ]
  });
  const routing = agentRouting.buildRuleBasedRoutingDecision({
    message: 'what is the mw of biotin',
    snapshot: {},
    availableToolNames: ['search_inventory', 'search_notebook_entries', 'search_uniprot'],
    toolContract,
    writeIntent: false
  });
  assert.equal(routing.plan.selected_tool_names.includes('search_inventory'), true);
  assert.equal(Array.isArray(routing.plan.tool_selection_rationale), true);
  assert.equal(routing.plan.tool_selection_rationale.length > 0, true);
});

test('agent-routing fallback payload parsing accepts valid intent payload', () => {
  const parsed = agentRouting.parseRoutingFallbackPayload(JSON.stringify({
    intent: 'inventory_lookup',
    confidence: 0.78,
    entities: {
      compound: 'biotin'
    },
    needs_clarification: false,
    clarification_question: '',
    reason: 'Detected compound lookup.'
  }));
  assert.equal(parsed.intent, 'inventory_lookup');
  assert.equal(parsed.entities.compound, 'biotin');
  assert.equal(parsed.needs_clarification, false);
});

test('agent-tools registry loader/list/find APIs return expected tool subsets', () => {
  const rawContract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const contract = agentTools.loadToolContract(rawContract);
  assert.equal(contract.tools.length > 0, true);
  const allTools = agentTools.listAvailableTools(contract, { includeWrite: true });
  const readOnlyTools = agentTools.listAvailableTools(contract, { includeWrite: false });
  assert.equal(allTools.some((tool) => tool.name === 'download_paper_pdf'), true);
  assert.equal(readOnlyTools.some((tool) => tool.name === 'download_paper_pdf'), false);
  const proteinTools = agentTools.findToolsByEntityType(contract, 'protein');
  assert.equal(proteinTools.some((tool) => tool.name === 'search_uniprot'), true);
  const literatureTools = agentTools.findToolsByTaskType(contract, 'literature_lookup');
  assert.equal(literatureTools.some((tool) => tool.name === 'search_pubmed'), true);
});

test('agent-tools selectToolsForRequest ranks tools by entity/task/exactness', () => {
  const rawContract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const contract = agentTools.loadToolContract(rawContract);

  const inventorySelection = agentTools.selectToolsForRequest({
    intent: 'inventory_lookup',
    entities: { compound: 'biotin', protein: '' },
    message: 'what is the MW of biotin in stock',
    contract,
    allowWriteTools: false
  });
  assert.equal(inventorySelection.selectedToolNames[0], 'search_inventory');

  const proteinSelection = agentTools.selectToolsForRequest({
    intent: 'inventory_lookup',
    entities: { protein: 'PD-1' },
    message: 'what is the pI of PD-1',
    contract,
    allowWriteTools: false
  });
  assert.equal(proteinSelection.selectedToolNames.includes('search_uniprot'), true);

  const recordSelection = agentTools.selectToolsForRequest({
    intent: 'record_lookup',
    entities: { workflow_step: 'transfection', protocol: 'Cell Prep' },
    message: 'what did we do last time for transfection',
    contract,
    allowWriteTools: false
  });
  assert.equal(recordSelection.selectedToolNames.includes('search_notebook_entries'), true);
});

test('agent-tools executeToolCall handles known, unknown, and write-policy paths', async () => {
  const contract = agentTools.loadToolContract({
    tools: [
      { name: 'search_inventory', description: 'inventory', input_schema: {}, output_schema: {} },
      { name: 'download_paper_pdf', description: 'write', input_schema: {}, output_schema: {} }
    ]
  });
  const toEnvelope = (toolName, args, rawResult, options = {}) => ({
    ok: options.ok !== false,
    tool_name: toolName,
    input: args,
    items: rawResult?.items || [],
    citations: rawResult?.citations || [],
    summary: rawResult?.summary || '',
    ...(options.error ? { error: options.error } : {})
  });
  const dispatch = async (toolName, args) => {
    if (toolName === 'search_inventory') {
      return toEnvelope(toolName, args, {
        items: [{ id: 'c1', name: 'biotin' }],
        citations: [{ source: 'inventory', pointer: 'c1', reason: 'match' }],
        summary: 'Found 1'
      });
    }
    if (toolName === 'download_paper_pdf') {
      return toEnvelope(toolName, args, {
        items: [{ linked_name: 'x', status: 'downloaded' }],
        citations: [{ source: 'paper_store', pointer: 'x', reason: 'write completed' }],
        summary: 'Downloaded 1'
      });
    }
    throw new Error('unexpected');
  };

  const known = await agentTools.executeToolCall('search_inventory', { query: 'biotin' }, {
    contract,
    allowWriteTools: false,
    toEnvelope,
    dispatch
  });
  assert.equal(known.ok, true);
  assert.equal(known.items.length, 1);

  const unknown = await agentTools.executeToolCall('missing_tool', { query: 'x' }, {
    contract,
    allowWriteTools: false,
    toEnvelope,
    dispatch
  });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Unknown tool/i);

  const blockedWrite = await agentTools.executeToolCall('download_paper_pdf', { linked_name: 'x' }, {
    contract,
    allowWriteTools: false,
    toEnvelope,
    dispatch
  });
  assert.equal(blockedWrite.ok, false);
  assert.match(blockedWrite.error, /Write action blocked/i);

  const allowedWrite = await agentTools.executeToolCall('download_paper_pdf', { linked_name: 'x' }, {
    contract,
    allowWriteTools: true,
    toEnvelope,
    dispatch
  });
  assert.equal(allowedWrite.ok, true);
  assert.equal(allowedWrite.items.length, 1);
});

test('agent-tools executeToolCall applies conservative local fuzzy retries then no-match fallback', async () => {
  const contract = agentTools.loadToolContract({
    tools: [
      { name: 'search_inventory', description: 'inventory', input_schema: {}, output_schema: {} }
    ]
  });
  const toEnvelope = (toolName, args, rawResult, options = {}) => ({
    ok: options.ok !== false,
    tool_name: toolName,
    input: args,
    items: rawResult?.items || [],
    citations: rawResult?.citations || [],
    summary: rawResult?.summary || '',
    ...(options.error ? { error: options.error } : {})
  });

  const calls = [];
  const dispatch = async (_toolName, args) => {
    calls.push(String(args.query || ''));
    const q = String(args.query || '').toLowerCase();
    if (q.includes('molecular weight') && q.includes('biotin')) {
      return toEnvelope('search_inventory', args, {
        items: [{ id: 'biotin' }],
        citations: [{ source: 'inventory', pointer: 'biotin', reason: 'alias retry' }],
        summary: 'Found 1'
      });
    }
    return toEnvelope('search_inventory', args, {
      items: [],
      citations: [],
      summary: 'Found 0'
    });
  };

  const aliasHit = await agentTools.executeToolCall('search_inventory', { query: 'mw biotin' }, {
    contract,
    allowWriteTools: false,
    fuzzyVocabulary: ['biotin', 'molecular weight'],
    toEnvelope,
    dispatch
  });
  assert.equal(aliasHit.items.length, 1);
  assert.equal(calls.length >= 2, true);

  const noMatch = await agentTools.executeToolCall('search_inventory', { query: 'unknownzzzz' }, {
    contract,
    allowWriteTools: false,
    fuzzyVocabulary: ['biotin'],
    toEnvelope,
    dispatch: async () => toEnvelope('search_inventory', { query: 'unknownzzzz' }, { items: [], citations: [], summary: 'Found 0' })
  });
  assert.equal(noMatch.items.length, 0);
  assert.equal(noMatch.summary, 'No matching record found.');
});

test('agent-tools executeToolCall normalization retry can recover local-search misses', async () => {
  const contract = agentTools.loadToolContract({
    tools: [
      { name: 'search_inventory', description: 'inventory', input_schema: {}, output_schema: {} }
    ]
  });
  const toEnvelope = (toolName, args, rawResult, options = {}) => ({
    ok: options.ok !== false,
    tool_name: toolName,
    input: args,
    items: rawResult?.items || [],
    citations: rawResult?.citations || [],
    summary: rawResult?.summary || '',
    ...(options.error ? { error: options.error } : {})
  });
  const calls = [];
  const hit = await agentTools.executeToolCall('search_inventory', { query: 'TNF-α reagent' }, {
    contract,
    allowWriteTools: false,
    fuzzyVocabulary: ['tnf-alpha', 'reagent'],
    toEnvelope,
    dispatch: async (_toolName, args) => {
      const q = String(args.query || '');
      calls.push(q);
      if (q.includes('tnf-alpha')) {
        return toEnvelope('search_inventory', args, {
          items: [{ id: 'tnfa' }],
          citations: [{ source: 'inventory', pointer: 'tnfa', reason: 'normalization retry' }],
          summary: 'Found 1'
        });
      }
      return toEnvelope('search_inventory', args, {
        items: [],
        citations: [],
        summary: 'Found 0'
      });
    }
  });
  assert.equal(hit.items.length, 1);
  assert.equal(calls.some((q) => q.includes('tnf-alpha')), true);
});

test('agent-tools executeToolCall light fuzzy retry can recover one-edit query typos', async () => {
  const contract = agentTools.loadToolContract({
    tools: [
      { name: 'search_inventory', description: 'inventory', input_schema: {}, output_schema: {} }
    ]
  });
  const toEnvelope = (toolName, args, rawResult, options = {}) => ({
    ok: options.ok !== false,
    tool_name: toolName,
    input: args,
    items: rawResult?.items || [],
    citations: rawResult?.citations || [],
    summary: rawResult?.summary || '',
    ...(options.error ? { error: options.error } : {})
  });
  const calls = [];
  const hit = await agentTools.executeToolCall('search_inventory', { query: 'biotn lot' }, {
    contract,
    allowWriteTools: false,
    fuzzyVocabulary: ['biotin', 'lot'],
    toEnvelope,
    dispatch: async (_toolName, args) => {
      const q = String(args.query || '').toLowerCase();
      calls.push(q);
      if (q.includes('biotin')) {
        return toEnvelope('search_inventory', args, {
          items: [{ id: 'biotin' }],
          citations: [{ source: 'inventory', pointer: 'biotin', reason: 'fuzzy retry' }],
          summary: 'Found 1'
        });
      }
      return toEnvelope('search_inventory', args, {
        items: [],
        citations: [],
        summary: 'Found 0'
      });
    }
  });
  assert.equal(hit.items.length, 1);
  assert.equal(calls.includes('biotin lot'), true);
});

test('agent simulation contract parity guard keeps tool contract/capabilities/mock-dispatch in sync', () => {
  const missingCapabilities = AGENT_IO_TOOL_NAMES.filter(
    (name) => !Object.prototype.hasOwnProperty.call(agentTools.TOOL_CAPABILITY_MAP, name)
  );
  const missingMockDispatch = AGENT_IO_TOOL_NAMES.filter(
    (name) => !AGENT_SIMULATION_DISPATCH_TOOL_NAMES.has(name)
  );
  assert.equal(
    missingCapabilities.length,
    0,
    `Missing TOOL_CAPABILITY_MAP coverage: ${missingCapabilities.join(', ')}`
  );
  assert.equal(
    missingMockDispatch.length,
    0,
    `Missing mock dispatch coverage: ${missingMockDispatch.join(', ')}`
  );
});

test('agent simulation tool execution matrix covers all contract tools with write-policy behavior', async () => {
  const snapshot = buildAgentSimulationSnapshot();
  const matrixQuery = 'atlas biotin pd-1 transfection';
  const { dispatch, coveredToolNames } = buildMockToolDispatch(snapshot);
  const executedToolNames = [];

  for (const toolName of AGENT_IO_TOOL_NAMES) {
    const args = buildMockToolArgs(toolName, matrixQuery, snapshot);
    const result = await agentTools.executeToolCall(toolName, args, {
      contract: AGENT_IO_CONTRACT,
      allowWriteTools: false,
      dispatch,
      fuzzyVocabulary: ['atlas', 'biotin', 'pd-1', 'transfection']
    });

    executedToolNames.push(toolName);
    if (toolName === 'download_paper_pdf') {
      assert.equal(result.ok, false);
      assert.match(String(result.error || ''), /Write action blocked/i);
      continue;
    }

    assert.equal(result.ok, true, `Expected ${toolName} to execute in matrix test`);
    assert.equal(Array.isArray(result.items), true);
    assert.equal(result.items.length > 0, true, `Expected ${toolName} to return at least one item`);
    assert.equal(String(result.summary || '').length > 0, true);
  }

  const writeAllowed = await agentTools.executeToolCall(
    'download_paper_pdf',
    buildMockToolArgs('download_paper_pdf', matrixQuery, snapshot),
    {
      contract: AGENT_IO_CONTRACT,
      allowWriteTools: true,
      dispatch,
      fuzzyVocabulary: ['atlas', 'biotin']
    }
  );
  assert.equal(writeAllowed.ok, true);
  assert.equal(Array.isArray(writeAllowed.items), true);
  assert.equal(writeAllowed.items.length > 0, true);
  assert.equal(coveredToolNames.has('download_paper_pdf'), true);
  assert.deepEqual(executedToolNames.sort(), AGENT_IO_TOOL_NAMES.slice().sort());
});

test('agent simulation intent matrix executes expected tool families across request types', async () => {
  const snapshot = buildAgentSimulationSnapshot();
  const scenarios = [
    {
      intent: 'inventory_lookup',
      message: 'What is the molecular weight of biotin in stock?',
      expectedTools: ['search_inventory'],
      expectNeedsTools: true
    },
    {
      intent: 'record_lookup',
      message: 'What did we do last time for PD-1 expression?',
      expectedTools: ['search_notebook_entries', 'search_assays', 'search_gel_analyses'],
      expectNeedsTools: true
    },
    {
      intent: 'project_science_question',
      message: 'Why did project Atlas fail after transfection?',
      expectedTools: ['search_projects', 'search_notebook_entries', 'search_papers'],
      expectNeedsTools: true
    },
    {
      intent: 'paper_analysis',
      message: 'Summarize this paper on PD-1 binder design.',
      expectedTools: ['search_papers', 'search_pubmed'],
      expectNeedsTools: true
    },
    {
      intent: 'coding_data_analysis',
      message: 'Use Python to analyze this CSV and compute mean values.',
      expectedTools: ['run_python_sandbox'],
      expectNeedsTools: true
    },
    {
      intent: 'general_science_question',
      message: 'What is ELISA and how does it work?',
      expectedTools: [],
      expectNeedsTools: false
    },
    {
      intent: 'protocol_to_notebook',
      message: 'I grew HEK293 cells and ran transfection today.',
      expectedTools: ['search_protocols'],
      expectNeedsTools: true
    }
  ];

  for (const scenario of scenarios) {
    const turn = await runSimulatedAgentTurn({
      message: scenario.message,
      snapshot,
      allowWriteTools: false,
      writeIntent: false
    });

    assert.equal(turn.routing.intent, scenario.intent);
    assert.equal(turn.routing.plan.needs_tools, scenario.expectNeedsTools);
    assert.equal(turn.routing.plan.needs_clarification, false);

    if (!scenario.expectNeedsTools) {
      assert.equal(turn.executedToolNames.length, 0);
      continue;
    }

    scenario.expectedTools.forEach((toolName) => {
      assert.equal(
        turn.executedToolNames.includes(toolName),
        true,
        `Expected ${scenario.intent} to execute ${toolName}`
      );
    });
    assert.equal(turn.toolTrace.length > 0, true);
    assert.equal(turn.citations.length > 0, true);
  }
});

test('agent simulation protocol-generation phrasing triggers routing clarification and write-approval gate', async () => {
  const turn = await runSimulatedAgentTurn({
    message: 'Generate a lab notebook page for today.',
    snapshot: buildAgentSimulationSnapshot(),
    allowWriteTools: false,
    writeIntent: true
  });

  assert.equal(turn.routing.intent, 'protocol_to_notebook');
  assert.equal(turn.routing.plan.needs_tools, true);
  assert.equal(turn.routing.plan.needs_clarification, true);
  assert.equal(String(turn.routing.plan.clarification_question || '').length > 0, true);
  assert.equal(turn.requiresApproval, true);
  assert.equal(turn.executedToolNames.length, 0);
});

test('protocol generation materialization persists normalized draft from extracted method payload', () => {
  const document = createMockDocument([
    'protocol-list-panel',
    'protocol-editor-panel',
    'protocol-view-panel',
    'create-protocol-btn',
    'protocol-editor-back-btn',
    'protocol-cancel-btn',
    'protocol-view-back-btn',
    'protocol-editor-heading',
    'protocol-view-title',
    'protocol-view-content',
    'protocol-form',
    'protocol-name',
    'protocol-purpose',
    'protocol-materials',
    'protocol-steps',
    'protocol-troubleshooting',
    'add-placeholder-btn',
    'placeholder-name',
    'protocol-share-status',
    'protocol-share-link-panel',
    'protocol-share-link-output',
    'protocol-list',
    'protocol-sort-field-btn',
    'protocol-sort-order-btn'
  ]);
  const protocolForm = document.getElementById('protocol-form');
  const protocolName = document.getElementById('protocol-name');
  const protocolPurpose = document.getElementById('protocol-purpose');
  const protocolMaterials = document.getElementById('protocol-materials');
  const protocolSteps = document.getElementById('protocol-steps');
  const protocolTroubleshooting = document.getElementById('protocol-troubleshooting');
  wireFormReset(protocolForm, [
    protocolName,
    protocolPurpose,
    protocolMaterials,
    protocolSteps,
    protocolTroubleshooting
  ]);

  let persistCalls = 0;
  const state = {
    protocols: [],
    notebookEntries: [],
    workflows: [],
    workflowTemplates: [],
    assays: [],
    gelAnalyses: [],
    messages: [],
    members: [],
    settings: {
      personalInfo: {
        enanaEmail: ''
      }
    }
  };

  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'modules', 'protocol-management.js'), {
    document,
    TextEncoder,
    btoa: btoaPolyfill
  });
  const protocol = protocolModule.initProtocolManagement({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let idx = 0;
      return () => `generated-protocol-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onProtocolsChanged: () => {},
    trackGrowthEvent: () => {}
  });

  const created = protocol.addDraftFromExtractedMethod(
    {
      title: 'Transfection Rescue',
      purpose: 'Recover expression by adjusting transfection conditions.',
      materials: ['HEK293 cells', 'Transfection reagent'],
      steps: [
        { step_number: 2, action: 'Incubate for [time] at 37 C.' },
        { step_number: 1, action: 'Add [] uL DNA mix.' }
      ],
      troubleshooting: [
        {
          problem: 'Low expression',
          possible_cause: 'Inefficient transfection',
          solution: 'Increase DNA purity and optimize reagent ratio'
        }
      ]
    },
    { title: 'Atlas Study' }
  );

  assert.equal(created, true);
  assert.match(protocolName.value, /Atlas Study - Transfection Rescue/);
  assert.match(protocolPurpose.value, /Recover expression/);
  assert.match(protocolSteps.value, /Add \[value\] uL DNA mix/);
  assert.match(protocolSteps.value, /Incubate for \[time\]/);
  assert.match(protocolTroubleshooting.value, /Problem: Low expression/);

  trigger(protocolForm, 'submit');

  assert.equal(state.protocols.length, 1);
  const persisted = state.protocols[0];
  assert.match(String(persisted.id || ''), /^generated-protocol-/);
  assert.equal(persisted.name, 'Atlas Study - Transfection Rescue');
  assert.equal(Array.isArray(persisted.materials), true);
  assert.equal(persisted.materials.length, 2);
  assert.equal(persisted.materials.includes('HEK293 cells'), true);
  assert.equal(persisted.materials.includes('Transfection reagent'), true);
  assert.equal(Array.isArray(persisted.steps), true);
  assert.equal(persisted.steps.length, 2);
  assert.equal(persisted.steps.some((step) => String(step?.text || '').includes('{{ph:')), true);
  const placeholderNames = persisted.steps.flatMap((step) => (
    Array.isArray(step?.placeholders) ? step.placeholders.map((item) => item?.name) : []
  ));
  assert.equal(placeholderNames.includes('value'), true);
  assert.equal(placeholderNames.includes('time'), true);
  assert.ok(Number.isFinite(Date.parse(persisted.createdAt)));
  assert.ok(Number.isFinite(Date.parse(persisted.updatedAt)));
  assert.equal(persistCalls > 0, true);
});

test('createUid uses type:id convention', () => {
  assert.equal(objectGraph.createUid('project', 'p1'), 'project:p1');
});

test('lab-management supports member create, edit, and delete lifecycle', () => {
  const document = createMockDocument([
    'member-form',
    'member-id',
    'member-name',
    'member-institution-email',
    'member-position',
    'member-enana-email',
    'member-cancel-btn',
    'member-cards'
  ]);
  const memberForm = document.getElementById('member-form');
  const memberId = document.getElementById('member-id');
  const memberName = document.getElementById('member-name');
  const memberInstitutionEmail = document.getElementById('member-institution-email');
  const memberPosition = document.getElementById('member-position');
  const memberEnanaEmail = document.getElementById('member-enana-email');
  const memberCards = document.getElementById('member-cards');
  wireFormReset(memberForm, [memberName, memberInstitutionEmail, memberPosition, memberEnanaEmail]);

  let persistCalls = 0;
  const state = { members: [] };
  const labManagementModule = loadEsmStyleModule(path.join(__dirname, 'modules', 'lab-management.js'), {
    document
  });
  const labManagement = labManagementModule.initLabManagement({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: () => 'member-1',
    safeText: shared.safeText
  });

  memberName.value = '  Alice <Admin>  ';
  memberInstitutionEmail.value = 'alice@example.edu';
  memberPosition.value = 'PI';
  memberEnanaEmail.value = 'alice@enana.test';
  trigger(memberForm, 'submit');

  assert.equal(state.members.length, 1);
  assert.equal(state.members[0].id, 'member-1');
  assert.equal(state.members[0].name, 'Alice <Admin>');
  assert.equal(persistCalls, 1);
  assert.equal(memberId.value, '');
  assert.match(memberCards.innerHTML, /Alice &lt;Admin&gt;/);

  const editBtn = memberCards.querySelectorAll('[data-member-edit]')[0];
  trigger(editBtn, 'click');
  assert.equal(memberId.value, 'member-1');
  assert.equal(memberPosition.value, 'PI');

  memberPosition.value = 'Lab Director';
  trigger(memberForm, 'submit');
  assert.equal(state.members.length, 1);
  assert.equal(state.members[0].position, 'Lab Director');

  labManagement.render();
  const deleteBtn = memberCards.querySelectorAll('[data-member-delete]')[0];
  trigger(deleteBtn, 'click');
  assert.equal(state.members.length, 0);
  assert.match(memberCards.innerHTML, /No members yet/);
});

test('personal-inventory shows right-side sample editor and saves linked sample fields', () => {
  const document = createMockDocument([
    'inventory-sections',
    'container-detail',
    'inventory-add-container-btn',
    'inventory-add-container-form',
    'inventory-add-container-name',
    'inventory-add-container-location',
    'inventory-add-container-type',
    'inventory-add-container-cancel'
  ]);
  const inventorySections = document.getElementById('inventory-sections');
  const inventoryModule = loadEsmStyleModule(path.join(__dirname, 'modules', 'personal-inventory.js'), {
    document
  });

  let persistCalls = 0;
  let sampleChangedCalls = 0;
  const state = {
    samples: [
      {
        id: 'sample-1',
        code: 'S-001',
        name: 'Seed Sample',
        type: 'plasmid',
        lot: 'L-1',
        concentration: '1 mg/mL',
        notes: 'initial',
        location: {
          storageType: 'freezer',
          freezer: '-20 Degree',
          rack: '',
          box: 'Box A',
          position: '1'
        },
        inventoryLink: {
          section: '-20 Degree',
          containerId: 'box-1',
          wellIndex: 0
        },
        chemicalLinks: [],
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    inventory: {
      'Room Temp': [],
      '4 Degree': [],
      '-20 Degree': [
        {
          id: 'box-1',
          name: 'Box A',
          type: 'box81',
          wells: [{ name: 'A1', content: 'Seed slot' }]
        }
      ],
      '-80 Degree': [],
      'Liquid Nitrogen': []
    }
  };

  const personalInventory = inventoryModule.initPersonalInventory({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: () => 'container-x',
    safeText: shared.safeText,
    cssEscape: shared.cssEscape,
    onSamplesChanged: () => {
      sampleChangedCalls += 1;
    }
  });

  personalInventory.renderSections();
  const openBtn = inventorySections.querySelectorAll('[data-container-open]')[0];
  openBtn.dataset.section = '-20 Degree';
  trigger(openBtn, 'click');
  const wellBtn = inventorySections.querySelectorAll('[data-well-index]')[0];
  wellBtn.dataset.section = '-20 Degree';
  wellBtn.dataset.containerId = 'box-1';
  trigger(wellBtn, 'click');

  assert.match(inventorySections.innerHTML, /well-editor-shell/);
  assert.match(inventorySections.innerHTML, /data-well-sample-save="sample-1"/);

  inventorySections.querySelector('[data-well-sample-code]').value = 'S-UPDATED-1';
  inventorySections.querySelector('[data-well-sample-name]').value = 'Updated Sample';
  inventorySections.querySelector('[data-well-sample-type]').value = 'protein';
  inventorySections.querySelector('[data-well-sample-lot]').value = 'LOT-99';
  inventorySections.querySelector('[data-well-sample-concentration]').value = '2 mg/mL';
  inventorySections.querySelector('[data-well-sample-notes]').value = 'edited in side panel';
  trigger(inventorySections.querySelectorAll('[data-well-sample-save]')[0], 'click');

  assert.equal(state.samples.length, 1);
  assert.equal(state.samples[0].code, 'S-UPDATED-1');
  assert.equal(state.samples[0].name, 'Updated Sample');
  assert.equal(state.samples[0].type, 'protein');
  assert.equal(state.samples[0].lot, 'LOT-99');
  assert.equal(state.samples[0].concentration, '2 mg/mL');
  assert.equal(state.samples[0].notes, 'edited in side panel');
  assert.equal(state.samples[0].inventoryLink.section, '-20 Degree');
  assert.equal(state.samples[0].inventoryLink.containerId, 'box-1');
  assert.equal(state.samples[0].inventoryLink.wellIndex, 0);
  assert.ok(persistCalls >= 1);
  assert.equal(sampleChangedCalls, 1);
});

test('personal-inventory creates a linked sample from the side editor for an empty cell', () => {
  const document = createMockDocument([
    'inventory-sections',
    'container-detail',
    'inventory-add-container-btn',
    'inventory-add-container-form',
    'inventory-add-container-name',
    'inventory-add-container-location',
    'inventory-add-container-type',
    'inventory-add-container-cancel'
  ]);
  const inventorySections = document.getElementById('inventory-sections');
  const inventoryModule = loadEsmStyleModule(path.join(__dirname, 'modules', 'personal-inventory.js'), {
    document
  });

  let persistCalls = 0;
  let sampleChangedCalls = 0;
  const state = {
    samples: [],
    inventory: {
      'Room Temp': [],
      '4 Degree': [],
      '-20 Degree': [
        {
          id: 'box-2',
          name: 'Box B',
          type: 'box81',
          wells: [{ name: 'A1', content: '' }]
        }
      ],
      '-80 Degree': [],
      'Liquid Nitrogen': []
    }
  };

  const personalInventory = inventoryModule.initPersonalInventory({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: () => 'container-y',
    safeText: shared.safeText,
    cssEscape: shared.cssEscape,
    onSamplesChanged: () => {
      sampleChangedCalls += 1;
    }
  });

  personalInventory.renderSections();
  const openBtn = inventorySections.querySelectorAll('[data-container-open]')[0];
  openBtn.dataset.section = '-20 Degree';
  trigger(openBtn, 'click');
  const wellBtn = inventorySections.querySelectorAll('[data-well-index]')[0];
  wellBtn.dataset.section = '-20 Degree';
  wellBtn.dataset.containerId = 'box-2';
  trigger(wellBtn, 'click');

  assert.match(inventorySections.innerHTML, /data-well-sample-create="0"/);
  inventorySections.querySelector('[data-well-sample-new-code]').value = 'S-NEW-1';
  inventorySections.querySelector('[data-well-sample-new-name]').value = 'Created Sample';
  inventorySections.querySelector('[data-well-sample-new-type]').value = 'antibody';
  inventorySections.querySelector('[data-well-sample-new-lot]').value = 'BATCH-7';
  inventorySections.querySelector('[data-well-sample-new-concentration]').value = '5 mg/mL';
  inventorySections.querySelector('[data-well-sample-new-notes]').value = 'created from inventory panel';
  trigger(inventorySections.querySelectorAll('[data-well-sample-create]')[0], 'click');

  assert.equal(state.samples.length, 1);
  assert.equal(state.samples[0].code, 'S-NEW-1');
  assert.equal(state.samples[0].name, 'Created Sample');
  assert.equal(state.samples[0].type, 'antibody');
  assert.equal(state.samples[0].lot, 'BATCH-7');
  assert.equal(state.samples[0].concentration, '5 mg/mL');
  assert.equal(state.samples[0].notes, 'created from inventory panel');
  assert.equal(state.samples[0].inventoryLink.section, '-20 Degree');
  assert.equal(state.samples[0].inventoryLink.containerId, 'box-2');
  assert.equal(state.samples[0].inventoryLink.wellIndex, 0);
  assert.ok(persistCalls >= 1);
  assert.equal(sampleChangedCalls, 1);
});

test('project-management deletes projects with linked notebook and workflow cleanup', () => {
  const document = createMockDocument([
    'project-form',
    'project-id',
    'project-name',
    'project-description',
    'project-cancel-btn',
    'project-list',
    'project-notebook-filter',
    'project-notebook-pages'
  ]);
  const projectForm = document.getElementById('project-form');
  const projectNameInput = document.getElementById('project-name');
  const projectDescriptionInput = document.getElementById('project-description');
  wireFormReset(projectForm, [projectNameInput, projectDescriptionInput, document.getElementById('project-id')]);

  let persistCalls = 0;
  let projectsChangedCalls = 0;
  const state = {
    projects: [
      { id: 'p1', name: 'Project One', description: 'Primary' },
      { id: 'p2', name: 'Project Two', description: 'Secondary' }
    ],
    notebookEntries: [
      { id: 'n1', projectId: 'p1', protocolName: 'Protocol A', updatedAt: '2026-01-03T00:00:00.000Z', resultFiles: [] },
      { id: 'n2', projectId: 'p2', protocolName: 'Protocol B', updatedAt: '2026-01-02T00:00:00.000Z', resultFiles: [] }
    ],
    assays: [
      { id: 'a1', name: 'Assay A', projectId: 'p1', notebookEntryId: 'n1', updatedAt: '2026-01-03T01:00:00.000Z' }
    ],
    gelAnalyses: [
      { id: 'g1', name: 'Gel A', projectId: 'p1', notebookEntryId: 'n1', updatedAt: '2026-01-03T01:30:00.000Z' }
    ],
    workflows: [
      { id: 'w1', projectId: 'p1', notebookEntryIds: ['n1', 'n2'] }
    ]
  };

  const projectManagementModule = loadEsmStyleModule(path.join(__dirname, 'modules', 'project-management.js'), {
    document
  });
  const projectManagement = projectManagementModule.initProjectManagement({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: () => 'project-new',
    safeText: shared.safeText,
    onProjectsChanged: () => {
      projectsChangedCalls += 1;
    }
  });

  projectManagement.render();
  const projectList = document.getElementById('project-list');
  const deleteBtn = projectList.querySelectorAll('[data-project-delete]')[0];
  trigger(deleteBtn, 'click');

  assert.deepEqual(state.projects.map((item) => item.id), ['p2']);
  assert.deepEqual(state.notebookEntries.map((item) => item.id), ['n2']);
  assert.equal(state.assays.length, 0);
  assert.equal(state.gelAnalyses.length, 0);
  assert.equal(state.workflows[0].projectId, '');
  assert.deepEqual(state.workflows[0].notebookEntryIds, ['n2']);
  assert.equal(document.getElementById('project-notebook-filter').value, 'p2');
  assert.ok(persistCalls >= 1);
  assert.ok(projectsChangedCalls >= 1);
});

test('collaboration-management sends messages and imports protocol share links', () => {
  const document = createMockDocument([
    'message-form',
    'message-from',
    'message-to',
    'message-subject',
    'message-body',
    'inbox-email',
    'inbox-list',
    'protocol-link-input',
    'import-protocol-link-btn',
    'protocol-link-status'
  ]);
  const messageForm = document.getElementById('message-form');
  const messageFrom = document.getElementById('message-from');
  const messageTo = document.getElementById('message-to');
  const messageSubject = document.getElementById('message-subject');
  const messageBody = document.getElementById('message-body');
  const inboxEmail = document.getElementById('inbox-email');
  const inboxList = document.getElementById('inbox-list');
  const protocolLinkInput = document.getElementById('protocol-link-input');
  const importProtocolLinkBtn = document.getElementById('import-protocol-link-btn');
  const protocolLinkStatus = document.getElementById('protocol-link-status');
  wireFormReset(messageForm, [messageSubject, messageBody]);

  let persistCalls = 0;
  let importedCalls = 0;
  const tracked = [];
  const state = {
    members: [
      { id: 'm1', enanaEmail: 'alice@enana.test' },
      { id: 'm2', enanaEmail: 'bob@enana.test' }
    ],
    messages: [],
    protocols: []
  };

  const collaborationModule = loadEsmStyleModule(path.join(__dirname, 'modules', 'collaboration-management.js'), {
    document,
    atob: atobPolyfill,
    TextDecoder,
    Uint8Array
  });
  const collaboration = collaborationModule.initCollaborationManagement({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let idx = 0;
      return () => `id-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onProtocolsImported: () => {
      importedCalls += 1;
    },
    trackGrowthEvent: (_state, name, props) => {
      tracked.push({ name, props });
    }
  });

  collaboration.renderEmailSelectors();

  messageFrom.value = 'alice@enana.test';
  messageTo.value = 'bob@enana.test';
  messageSubject.value = 'Status Update';
  messageBody.value = 'Workflow complete.';
  trigger(messageForm, 'submit');

  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].subject, 'Status Update');
  assert.equal(messageFrom.value, 'alice@enana.test');
  assert.equal(messageTo.value, 'bob@enana.test');

  inboxEmail.value = 'bob@enana.test';
  trigger(inboxEmail, 'change');
  assert.match(inboxList.innerHTML, /Status Update/);

  const payload = {
    version: 1,
    type: 'protocol_share_link',
    from: 'alice@enana.test',
    protocol: {
      id: 'proto-source',
      name: 'PCR Protocol',
      purpose: 'Amplify DNA',
      materials: ['Buffer', 'Primer'],
      steps: [{ id: 'step-1', text: 'Mix reagents', placeholders: [] }],
      troubleshooting: ''
    }
  };
  const token = encodeBase64Url(JSON.stringify(payload));
  protocolLinkInput.value = `enana://protocol-share/${token}`;
  trigger(importProtocolLinkBtn, 'click');

  assert.equal(state.protocols.length, 1);
  assert.equal(state.protocols[0].name, 'PCR Protocol');
  assert.equal(protocolLinkInput.value, '');
  assert.match(protocolLinkStatus.textContent, /Imported "PCR Protocol"/);
  assert.equal(importedCalls, 1);
  assert.equal(tracked[0].name, 'protocol_share_link_imported');

  protocolLinkInput.value = `enana://protocol-share/${token}`;
  trigger(importProtocolLinkBtn, 'click');
  assert.equal(state.protocols.length, 2);
  assert.match(state.protocols[1].name, /^PCR Protocol \(Shared Copy\)/);
  assert.equal(importedCalls, 2);

  protocolLinkInput.value = JSON.stringify([
    {
      title: 'JSON Protocol',
      purpose: 'Validate JSON import',
      materials: ['Water', 'Salt'],
      steps: [
        { step_number: 2, action: 'Incubate for [time]' },
        { step_number: 1, action: 'Add [] mL buffer' }
      ],
      troubleshooting: [
        {
          problem: 'Cloudy solution',
          possible_cause: 'Contamination',
          solution: 'Prepare a fresh buffer'
        }
      ]
    }
  ]);
  trigger(importProtocolLinkBtn, 'click');
  assert.equal(state.protocols.length, 3);
  assert.equal(state.protocols[2].name, 'JSON Protocol');
  assert.equal(state.protocols[2].purpose, 'Validate JSON import');
  assert.deepEqual(state.protocols[2].materials, ['Water', 'Salt']);
  assert.equal(state.protocols[2].steps.length, 2);
  assert.match(state.protocols[2].steps[0].text, /Add \{\{ph:/);
  assert.equal(state.protocols[2].steps[0].placeholders[0].name, 'value');
  assert.match(state.protocols[2].steps[1].text, /Incubate for \{\{ph:/);
  assert.equal(state.protocols[2].steps[1].placeholders[0].name, 'time');
  assert.match(state.protocols[2].troubleshooting, /Problem: Cloudy solution/);
  assert.match(protocolLinkStatus.textContent, /Imported "JSON Protocol"/);
  assert.equal(importedCalls, 3);

  protocolLinkInput.value = 'invalid-link';
  trigger(importProtocolLinkBtn, 'click');
  assert.match(protocolLinkStatus.textContent, /Invalid protocol link/);
  assert.ok(persistCalls >= 4);
});

test('protocol-management supports draft creation, sharing, link copy, and delete cascades', async () => {
  const document = createMockDocument([
    'protocol-list-panel',
    'protocol-editor-panel',
    'protocol-view-panel',
    'create-protocol-btn',
    'protocol-editor-back-btn',
    'protocol-cancel-btn',
    'protocol-view-back-btn',
    'protocol-editor-heading',
    'protocol-view-title',
    'protocol-view-content',
    'protocol-form',
    'protocol-name',
    'protocol-purpose',
    'protocol-materials',
    'protocol-steps',
    'protocol-troubleshooting',
    'add-placeholder-btn',
    'placeholder-name',
    'protocol-share-status',
    'protocol-share-link-panel',
    'protocol-share-link-output',
    'protocol-list',
    'protocol-sort-field-btn',
    'protocol-sort-order-btn'
  ]);
  const protocolForm = document.getElementById('protocol-form');
  const protocolName = document.getElementById('protocol-name');
  const protocolPurpose = document.getElementById('protocol-purpose');
  const protocolMaterials = document.getElementById('protocol-materials');
  const protocolSteps = document.getElementById('protocol-steps');
  const protocolTroubleshooting = document.getElementById('protocol-troubleshooting');
  wireFormReset(protocolForm, [
    protocolName,
    protocolPurpose,
    protocolMaterials,
    protocolSteps,
    protocolTroubleshooting
  ]);

  let persistCalls = 0;
  let importedCalls = 0;
  let copiedText = '';
  const tracked = [];
  const state = {
    protocols: [],
    notebookEntries: [],
    workflows: [],
    workflowTemplates: [],
    assays: [],
    gelAnalyses: [],
    messages: [],
    members: [
      { id: 'm1', enanaEmail: 'owner@enana.test' },
      { id: 'm2', enanaEmail: 'teammate@enana.test' }
    ],
    settings: {
      personalInfo: {
        enanaEmail: 'owner@enana.test'
      }
    }
  };

  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'modules', 'protocol-management.js'), {
    document,
    TextEncoder,
    btoa: btoaPolyfill,
    navigator: {
      clipboard: {
        writeText: async (value) => {
          copiedText = String(value || '');
        }
      }
    }
  });
  const protocol = protocolModule.initProtocolManagement({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let idx = 0;
      return () => `protocol-id-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onProtocolsChanged: () => {
      importedCalls += 1;
    },
    trackGrowthEvent: (_state, name, props) => {
      tracked.push({ name, props });
    }
  });

  protocol.renderShareTargets();
  assert.match(document.getElementById('protocol-share-status').textContent, /Click Share/);

  assert.equal(
    protocol.addDraftFromExtractedMethod({ title: 'Empty Method', steps: [] }, { title: 'Paper' }),
    false
  );

  const created = protocol.addDraftFromExtractedMethod(
    {
      title: 'Cell Prep',
      steps: ['Resuspend pellet', 'Add [volume] media'],
      citations: ['DOI:10.1000/example']
    },
    { title: 'Paper X' }
  );
  assert.equal(created, true);
  assert.match(protocolName.value, /Paper X - Cell Prep/);
  assert.match(protocolSteps.value, /Resuspend pellet/);

  const createdFromProtocolJson = protocol.addDraftFromExtractedMethod(
    {
      title: 'JSON Schema Protocol',
      purpose: 'Validate protocol-shape method ingestion',
      materials: ['Tube', 'PBS'],
      steps: [
        { step_number: 2, action: 'Incubate for [time]' },
        { step_number: 1, action: 'Add [] mL PBS' }
      ],
      troubleshooting: [
        {
          problem: 'No pellet',
          possible_cause: 'Low cell density',
          solution: 'Increase starting cells'
        }
      ]
    },
    { title: 'Paper X' }
  );
  assert.equal(createdFromProtocolJson, true);
  assert.match(protocolName.value, /Paper X - JSON Schema Protocol/);
  assert.equal(protocolPurpose.value, 'Validate protocol-shape method ingestion');
  assert.match(protocolMaterials.value, /Tube/);
  assert.match(protocolTroubleshooting.value, /Problem: No pellet/);
  assert.match(protocolSteps.value, /Add \[value\] mL PBS/);
  assert.match(protocolSteps.value, /Incubate for \[time\]/);

  trigger(protocolForm, 'submit');
  assert.equal(state.protocols.length, 1);
  assert.ok(Number.isFinite(Date.parse(state.protocols[0].createdAt)));
  assert.ok(Number.isFinite(Date.parse(state.protocols[0].updatedAt)));

  protocol.renderList();
  const protocolList = document.getElementById('protocol-list');
  const shareBtn = protocolList.querySelectorAll('[data-protocol-share]')[0];
  trigger(shareBtn, 'click');

  const shareSelect = protocolList.querySelectorAll('[data-protocol-share-select]')[0];
  shareSelect.value = 'teammate@enana.test';
  trigger(shareSelect, 'change');

  const confirmShareBtn = protocolList.querySelectorAll('[data-protocol-share-confirm]')[0];
  trigger(confirmShareBtn, 'click');
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].type, 'protocol_share');
  assert.match(state.messages[0].payload.shareLink, /^enana:\/\/protocol-share\//);
  assert.equal(tracked[0].name, 'protocol_share_sent');

  protocol.renderList();
  const reopenedShareBtn = protocolList.querySelectorAll('[data-protocol-share]')[0];
  trigger(reopenedShareBtn, 'click');

  const copyLinkBtn = protocolList.querySelectorAll('[data-protocol-copy-link]')[0];
  trigger(copyLinkBtn, 'click');
  await flushAsync();

  assert.equal(copiedText, state.messages[0].payload.shareLink);
  assert.equal(tracked[1].name, 'protocol_share_link_copied');
  assert.equal(document.getElementById('protocol-share-link-panel').hidden, false);
  assert.equal(document.getElementById('protocol-share-link-output').value, copiedText);
  assert.match(document.getElementById('protocol-share-status').textContent, /Copied a share link/);

  const protocolId = state.protocols[0].id;
  state.notebookEntries = [{ id: 'entry-1', protocolId, projectId: 'project-1' }];
  state.assays = [{ id: 'assay-1', notebookEntryId: 'entry-1', projectId: 'project-1' }];
  state.gelAnalyses = [{ id: 'gel-1', notebookEntryId: 'entry-1', projectId: 'project-1' }];
  state.workflows = [{
    id: 'workflow-1',
    projectId: 'project-1',
    blocks: [
      { id: 'block-1', protocolId },
      { id: 'block-2', protocolId: 'other-protocol' }
    ],
    links: [
      { fromBlockId: 'block-1', toBlockId: 'block-2' },
      { fromBlockId: 'block-2', toBlockId: 'block-1' }
    ]
  }];
  state.workflowTemplates = [{
    id: 'template-1',
    blocks: [
      { id: 'tblock-1', protocolId },
      { id: 'tblock-2', protocolId: 'other-protocol' }
    ],
    links: [
      { fromBlockId: 'tblock-1', toBlockId: 'tblock-2' },
      { fromBlockId: 'tblock-2', toBlockId: 'tblock-1' }
    ]
  }];

  protocol.renderList();
  const deleteBtn = protocolList.querySelectorAll('[data-protocol-delete]')[0];
  trigger(deleteBtn, 'click');

  assert.equal(state.protocols.length, 0);
  assert.equal(state.notebookEntries.length, 0);
  assert.equal(state.assays[0].notebookEntryId, '');
  assert.equal(state.gelAnalyses[0].notebookEntryId, '');
  assert.deepEqual(state.workflows[0].blocks.map((item) => item.id), ['block-2']);
  assert.equal(state.workflows[0].links.length, 0);
  assert.deepEqual(state.workflowTemplates[0].blocks.map((item) => item.id), ['tblock-2']);
  assert.equal(state.workflowTemplates[0].links.length, 0);
  assert.ok(persistCalls >= 3);
  assert.ok(importedCalls >= 2);
});

test('protocol-management keeps legacy string steps editable and viewable', () => {
  const document = createMockDocument([
    'protocol-list-panel',
    'protocol-editor-panel',
    'protocol-view-panel',
    'create-protocol-btn',
    'protocol-editor-back-btn',
    'protocol-cancel-btn',
    'protocol-view-back-btn',
    'protocol-editor-heading',
    'protocol-view-title',
    'protocol-view-content',
    'protocol-form',
    'protocol-name',
    'protocol-purpose',
    'protocol-materials',
    'protocol-steps',
    'protocol-troubleshooting',
    'add-placeholder-btn',
    'placeholder-name',
    'protocol-share-status',
    'protocol-list',
    'protocol-sort-field-btn',
    'protocol-sort-order-btn'
  ]);
  const protocolForm = document.getElementById('protocol-form');
  const protocolName = document.getElementById('protocol-name');
  const protocolPurpose = document.getElementById('protocol-purpose');
  const protocolMaterials = document.getElementById('protocol-materials');
  const protocolSteps = document.getElementById('protocol-steps');
  const protocolTroubleshooting = document.getElementById('protocol-troubleshooting');
  wireFormReset(protocolForm, [
    protocolName,
    protocolPurpose,
    protocolMaterials,
    protocolSteps,
    protocolTroubleshooting
  ]);

  const state = {
    protocols: [
      {
        id: 'legacy-protocol-1',
        name: 'Legacy Protocol',
        purpose: 'Backward compatibility check',
        materials: ['Buffer'],
        steps: ['Add buffer', 'Incubate for 10 minutes'],
        troubleshooting: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ],
    notebookEntries: [],
    workflows: [],
    workflowTemplates: [],
    assays: [],
    gelAnalyses: [],
    messages: [],
    members: [],
    settings: { personalInfo: { enanaEmail: '' } }
  };

  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'modules', 'protocol-management.js'), {
    document,
    TextEncoder,
    btoa: btoaPolyfill
  });
  const protocol = protocolModule.initProtocolManagement({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `legacy-step-id-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onProtocolsChanged: () => {},
    trackGrowthEvent: () => {}
  });

  protocol.renderList();
  const protocolList = document.getElementById('protocol-list');
  const editBtn = protocolList.querySelectorAll('[data-protocol-edit]')[0];
  trigger(editBtn, 'click');
  assert.match(protocolSteps.value, /Add buffer/);
  assert.match(protocolSteps.value, /Incubate for 10 minutes/);

  protocol.renderList();
  const viewBtn = protocolList.querySelectorAll('[data-protocol-view]')[0];
  trigger(viewBtn, 'click');
  assert.match(document.getElementById('protocol-view-content').innerHTML, /Add buffer/);
});

test('agent-chat maps assay experiment data with numeric summaries and preview caps', () => {
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'modules', 'agent-chat.js'));
  const mapped = agentModule.mapExperimentDataToLlmJson({
    notebookEntries: [
      { id: 'n1', projectId: 'p1', protocolId: 'pr1', protocolName: 'Cell Prep', result: 'Done', updatedAt: '2026-01-01T00:00:00.000Z' }
    ],
    assays: [
      {
        id: 'a1',
        assayNumber: 'ASSAY-1',
        name: 'Viability Plate',
        projectId: 'p1',
        projectName: 'Cancer Study',
        notebookEntryId: 'n1',
        notebookEntryProtocolName: 'Cell Prep',
        plateType: '96',
        plateLabel: '96-well plate',
        plateRows: 8,
        plateColumns: 12,
        wellCount: 96,
        sampleAxis: 'row',
        concentrationAxis: 'column',
        sampleAxisValues: Array.from({ length: 14 }, (_value, index) => `sample-${index + 1}`),
        concentrationAxisValues: Array.from({ length: 14 }, (_value, index) => `${index + 1}`),
        wellLayout: Array.from({ length: 14 }, (_value, index) => ({
          well: `A${index + 1}`,
          sampleId: index % 2 === 0 ? 'sample-a' : 'sample-b',
          concentration: `${index + 1}`
        })),
        resultValues: {
          A1: '1',
          A2: '2.5',
          A3: 'not_numeric',
          A4: 4,
          A5: '',
          A6: '6',
          A7: '7',
          A8: '8',
          A9: '9',
          A10: '10',
          A11: '11',
          A12: '12',
          A13: '13'
        },
        notes: 'plate notes',
        updatedAt: '2026-02-01T00:00:00.000Z'
      },
      {
        id: 'a2',
        name: 'Other Project Assay',
        projectId: 'p2',
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    gelAnalyses: []
  }, 'p1');

  assert.equal(mapped.schema_name, 'enana_experiment_json');
  assert.equal(mapped.schema_version, '1.0');
  assert.equal(mapped.notebook_runs.length, 1);
  assert.equal(mapped.assay_runs.length, 1);
  assert.equal(mapped.gel_runs.length, 0);

  const assayRun = mapped.assay_runs[0];
  assert.equal(assayRun.project_id, 'p1');
  assert.equal(assayRun.layout_summary.mapped_well_count, 14);
  assert.equal(assayRun.layout_summary.unique_sample_count, 2);
  assert.equal(assayRun.layout_summary.preview.length, 12);
  assert.equal(assayRun.axis.sample_values.length, 12);
  assert.equal(assayRun.axis.concentration_values.length, 12);
  assert.equal(assayRun.result_summary.result_well_count, 13);
  assert.equal(assayRun.result_summary.numeric_count, 11);
  assert.equal(assayRun.result_summary.min, 1);
  assert.equal(assayRun.result_summary.max, 13);
  assertClose(assayRun.result_summary.mean, 7.590909090909091, 1e-12);
  assert.equal(assayRun.result_summary.preview.length, 12);
});

test('agent-chat maps gel experiment data with confidence, calibration, and warning caps', () => {
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'modules', 'agent-chat.js'));
  const mapped = agentModule.mapExperimentDataToLlmJson({
    notebookEntries: [],
    assays: [],
    gelAnalyses: [
      {
        id: 'g1',
        name: 'Gel Run 1',
        projectId: 'p1',
        projectName: 'Cancer Study',
        notebookEntryId: 'n1',
        notebookEntryProtocolName: 'Cell Prep',
        analysisType: 'western',
        imageName: 'gel-1.tiff',
        updatedAt: '2026-02-02T00:00:00.000Z',
        report: {
          confidence: { score: 0.91, label: 'high' },
          calibration: { ok: true, r2: 0.88, ladderLane: 2 },
          lanes: [{ bands: [{}, {}] }, { bands: [{}] }],
          bandGroups: [{ id: 'bg1' }, { id: 'bg2' }],
          warnings: Array.from({ length: 12 }, (_value, index) => `warning-${index + 1}`),
          preprocessing: {
            manualOverridesSummary: {
              laneSegmentationLeft: 10,
              laneSegmentationRight: 210,
              laneSegmentationDividers: 7,
              laneSegmentationBandTop: 20,
              laneSegmentationBandBottom: 44,
              addedBands: 2,
              ladderLaneOverride: 2,
              ladderBands: 3,
              ladderBandsDone: true
            }
          }
        }
      },
      {
        id: 'g2',
        name: 'Gel Run Other Project',
        projectId: 'p2',
        updatedAt: '2026-02-03T00:00:00.000Z'
      }
    ]
  }, 'p1');

  assert.equal(mapped.gel_runs.length, 1);
  const gelRun = mapped.gel_runs[0];
  assert.equal(gelRun.project_id, 'p1');
  assert.equal(gelRun.analysis_type, 'western');
  assert.equal(gelRun.lane_count, 2);
  assert.equal(gelRun.band_count, 3);
  assert.equal(gelRun.band_group_count, 2);
  assert.equal(gelRun.confidence.label, 'high');
  assert.equal(gelRun.confidence.score, 0.91);
  assert.equal(gelRun.calibration.ok, true);
  assert.equal(gelRun.calibration.r2, 0.88);
  assert.equal(gelRun.calibration.ladder_lane, 2);
  assert.equal(gelRun.warnings.length, 10);
  assert.equal(gelRun.manual_override_summary.lane_segmentation_dividers, 7);
  assert.equal(gelRun.manual_override_summary.ladder_bands_done, true);
});

test('agent-chat sends settings API key to main process and stores assistant response', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const projectSelect = document.getElementById('agent-project-select');
  const contextSummary = document.getElementById('agent-context-summary');
  const history = document.getElementById('agent-chat-history');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');
  const clearBtn = document.getElementById('agent-clear-btn');
  const status = document.getElementById('agent-status');

  let persistCalls = 0;
  let payloadSeen = null;
  const state = {
    projects: [
      { id: 'p1', name: 'Cancer Study' },
      { id: 'p2', name: 'Protein Screen' }
    ],
    protocols: [{ id: 'pr1', name: 'Cell Prep', steps: [{ text: 'Harvest cells' }, 'Legacy mix step'] }],
    notebookEntries: [
      { id: 'n1', projectId: 'p1', protocolId: 'pr1', protocolName: 'Cell Prep', result: 'Done' },
      { id: 'n2', projectId: 'p2', protocolId: 'pr1', protocolName: 'Cell Prep', result: 'Deferred' }
    ],
    assays: [
      {
        id: 'a1',
        assayNumber: 'ASSAY-1',
        name: 'Viability Plate',
        projectId: 'p1',
        projectName: 'Cancer Study',
        notebookEntryId: 'n1',
        notebookEntryProtocolName: 'Cell Prep',
        plateType: '96',
        plateLabel: '96-well plate',
        plateRows: 8,
        plateColumns: 12,
        wellCount: 96,
        sampleAxis: 'row',
        concentrationAxis: 'column',
        sampleAxisValues: ['sample-a'],
        concentrationAxisValues: ['1'],
        wellLayout: [{ well: 'A1', sampleId: 'sample-a', concentration: '1' }],
        resultValues: { A1: '100' },
        notes: 'note',
        updatedAt: '2026-02-01T00:00:00.000Z'
      },
      {
        id: 'a2',
        name: 'Other Project Assay',
        projectId: 'p2',
        updatedAt: '2026-02-01T00:00:00.000Z'
      }
    ],
    gelAnalyses: [
      {
        id: 'g1',
        name: 'Gel 1',
        projectId: 'p1',
        projectName: 'Cancer Study',
        notebookEntryId: 'n1',
        notebookEntryProtocolName: 'Cell Prep',
        analysisType: 'western',
        imageName: 'gel-1.tiff',
        updatedAt: '2026-02-01T00:00:00.000Z',
        report: {
          confidence: { score: 0.91, label: 'high' },
          calibration: { ok: true, r2: 0.88, ladderLane: 2 },
          lanes: [{ bands: [{}, {}] }],
          bandGroups: [{ id: 'bg1' }],
          warnings: ['warning-1']
        }
      },
      {
        id: 'g2',
        name: 'Other Project Gel',
        projectId: 'p2',
        updatedAt: '2026-02-01T00:00:00.000Z'
      }
    ],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      }
    },
    agentChat: { projectId: '', messages: [] }
  };

  const window = {
    enanaApi: {
      agentChat: async (payload) => {
        payloadSeen = payload;
        return {
          ok: true,
          answer: 'Use protocol Cell Prep and verify culture viability.',
          confidence: 0.88,
          requiresApproval: false,
          routing: {
            intent: 'protocol_to_notebook',
            confidence: 0.81,
            entities: {
              activity: 'cell prep',
              project: 'Cancer Study',
              protein: '',
              compound: '',
              protocol: 'Cell Prep',
              cell_line: 'HEK293',
              paper_title: '',
              workflow_step: ''
            },
            plan: {
              needs_tools: true,
              needs_protocol_search: true,
              needs_notebook_retrieval: false,
              needs_pdf_reading: false,
              needs_python: false,
              needs_web_search: false,
              needs_clarification: false,
              clarification_reason: '',
              clarification_question: '',
              selected_tool_names: ['search_protocols']
            },
            classifier: {
              source: 'rules',
              fallbackAttempted: false,
              fallbackUsed: false,
              lowConfidence: false,
              tieDetected: false,
              ruleReason: 'Matched protocol terms.',
              fallbackError: ''
            }
          },
          citations: [{ source: 'protocol', pointer: 'pr1', reason: 'Matched protocol name.' }],
          decisionRecord: {
            assumptions: ['Test assumption'],
            open_questions: [],
            verification_notes: ['Test verification']
          },
          proposedWriteActions: [],
          intermediateStates: [{ stage: 'synthesize', goal: 'Done.' }],
          toolTrace: [{ tool: 'search_protocols', summary: 'Found one protocol.' }]
        };
      }
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText
  });

  agent.render();
  assert.match(contextSummary.value, /projects/);

  projectSelect.value = 'p1';
  trigger(projectSelect, 'change');
  assert.equal(state.agentChat.projectId, 'p1');
  assert.match(contextSummary.value, /1 assays/);
  assert.match(contextSummary.value, /1 gel analyses/);

  messageInput.value = 'Give me next steps for p1.';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(payloadSeen.llm.model, 'gpt-5');
  assert.equal(payloadSeen.llm.apiEndpoint, 'https://api.openai.com/v1/responses');
  assert.equal(payloadSeen.llm.apiKey, 'sk-local-key');
  assert.equal(payloadSeen.projectId, 'p1');
  assert.deepEqual(payloadSeen.stateSnapshot.protocols[0].steps, ['Harvest cells', 'Legacy mix step']);
  assert.equal(payloadSeen.stateSnapshot.notebookEntries[0].protocolName, 'Cell Prep');
  assert.equal(payloadSeen.stateSnapshot.assays.length, 1);
  assert.equal(payloadSeen.stateSnapshot.assays[0].project_id, 'p1');
  assert.equal(payloadSeen.stateSnapshot.gelAnalyses.length, 1);
  assert.equal(payloadSeen.stateSnapshot.gelAnalyses[0].project_id, 'p1');
  assert.equal(payloadSeen.stateSnapshot.experimentData.schema_name, 'enana_experiment_json');
  assert.equal(payloadSeen.stateSnapshot.experimentData.assay_runs.length, 1);
  assert.equal(payloadSeen.stateSnapshot.experimentData.gel_runs.length, 1);
  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[0].role, 'user');
  assert.equal(state.agentChat.messages[1].role, 'assistant');
  assert.match(history.innerHTML, /Assistant/);
  assert.match(history.innerHTML, /Routing/);
  assert.match(history.innerHTML, /protocol_to_notebook/);
  assert.equal(sendBtn.disabled, false);
  assert.equal(clearBtn.disabled, false);
  assert.equal(projectSelect.disabled, false);
  assert.equal(messageInput.disabled, false);
  assert.equal(status.textContent, 'Complete.');
  assert.ok(persistCalls >= 3);

  trigger(clearBtn, 'click');
  assert.equal(state.agentChat.messages.length, 0);
  assert.equal(status.textContent, 'Chat history cleared.');
});

function buildStandardCurveObservations({
  sampleId = 'Std',
  concentrations = [0.1, 0.3, 1, 3, 10, 30],
  replicates = 2
} = {}) {
  const observations = [];
  concentrations.forEach((concentration, concentrationIndex) => {
    const signal = 10 + (90 / (1 + Math.exp(1.3 * (1.1 - Math.log10(Math.max(concentration, 1e-6))))));
    for (let replicateIndex = 0; replicateIndex < replicates; replicateIndex += 1) {
      const offset = (replicateIndex % 2 === 0 ? -1 : 1) * 0.6;
      observations.push({
        well: `A${(concentrationIndex * replicates) + replicateIndex + 1}`,
        response: signal + offset,
        rowIndex: 0,
        rowLabel: 'A',
        columnIndex: concentrationIndex,
        columnNumber: concentrationIndex + 1,
        rawSampleId: sampleId,
        sampleId,
        sampleValue: Number.NaN,
        rawConcentration: String(concentration),
        concentrationLabel: String(concentration),
        concentrationValue: concentration
      });
    }
  });
  return observations;
}

test('assay-analysis standard curve methods produce fitted rows and line chart models', () => {
  const observations = buildStandardCurveObservations();
  const methods = [
    'standard_curve_line',
    'standard_curve_4pl_log_concentration',
    'standard_curve_4pl_concentration',
    'standard_curve_5pl_log_concentration',
    'standard_curve_5pl_concentration',
    'standard_curve_semilog_line',
    'standard_curve_hyperbola',
    'standard_curve_quadratic',
    'standard_curve_cubic',
    'standard_curve_pade_11'
  ];

  methods.forEach((method) => {
    const result = assayAnalysis.analyzeAssayData({ method, observations });
    assert.equal(result.rows.length, 1, `expected one fitted row for ${method}`);
    assert.equal(result.headers.includes('R²'), true, `expected R² column for ${method}`);
    assert.equal(result.headers.includes('RMSE'), true, `expected RMSE column for ${method}`);
    assert.equal(result.chartModel?.chartType, 'line', `expected line chart for ${method}`);
    assert.equal(Array.isArray(result.chartModel?.series), true, `expected chart series for ${method}`);
    assert.ok(result.chartModel.series.length >= 1, `expected non-empty chart series for ${method}`);

    const row = result.rows[0];
    assert.ok(String(row[0] || '').trim().length > 0, `expected non-empty series label for ${method}`);
    assert.ok(Number.isFinite(Number(row[1])), `expected numeric point count for ${method}`);
    assert.ok(Number.isFinite(Number(row[3])), `expected numeric r2 for ${method}`);
    assert.ok(Number.isFinite(Number(row[4])), `expected numeric rmse for ${method}`);
    assert.equal(typeof row[5], 'string');
    assert.equal(typeof row[6], 'string');
  });
});

test('assay-analysis log-concentration methods skip non-positive concentration points', () => {
  const observations = buildStandardCurveObservations({
    concentrations: [-5, -1, 0],
    replicates: 2
  });
  const methods = [
    'standard_curve_4pl_log_concentration',
    'standard_curve_5pl_log_concentration',
    'standard_curve_semilog_line'
  ];

  methods.forEach((method) => {
    const result = assayAnalysis.analyzeAssayData({ method, observations });
    assert.equal(result.rows.length, 0, `expected no fitted rows for ${method}`);
    assert.match(result.summary, /skipped/i);
  });
});

test('rebuildObjectGraph creates cross-module links used by queries', () => {
  const state = {
    members: [{ id: 'm1', name: 'Alice' }],
    projects: [{ id: 'p1', name: 'Project 1' }],
    protocols: [{ id: 'pr1', name: 'Protocol 1' }],
    workflowTemplates: [
      {
        id: 'wt1',
        name: 'Template 1',
        blocks: [{ id: 'tb1', protocolId: 'pr1', assigneeId: 'm1' }],
        links: []
      }
    ],
    workflows: [
      {
        id: 'w1',
        name: 'Workflow 1',
        projectId: 'p1',
        notebookEntryIds: ['n1'],
        blocks: [{ id: 'b1', protocolId: 'pr1', assigneeId: 'm1' }],
        links: []
      }
    ],
    instruments: [{ id: 'i1', name: 'HPLC' }],
    papers: [
      {
        id: 'pa1',
        title: 'Paper 1',
        methodsExtract: [{ title: 'Method A' }],
        keyReagents: [{ name: 'Reagent A' }]
      }
    ],
    paperExperimentLinks: [{ paperId: 'pa1', entryId: 'n1', projectId: 'p1', note: 'linked' }],
    labInventory: {
      chemicals: [{ id: 'c1', name: 'Acetone' }]
    },
    samples: [
      {
        id: 's1',
        code: 'S-1',
        name: 'Sample 1',
        location: { storageType: 'fridge', fridge: 'F1', shelf: 'Top' },
        chemicalLinks: ['c1'],
        inventoryLink: { containerId: 'box1', section: '-20 Degree', wellIndex: 5 }
      }
    ],
    inventory: {
      '-20 Degree': [
        {
          id: 'box1',
          name: 'Box 1',
          type: 'box81',
          wells: [{ name: 'A1', content: 'Material' }]
        }
      ]
    },
    notebookEntries: [
      {
        id: 'n1',
        projectId: 'p1',
        protocolId: 'pr1',
        protocolName: 'Protocol 1',
        updatedAt: '2026-01-15T00:00:00.000Z',
        references: {
          instrumentId: 'i1',
          chemicalIds: ['c1'],
          sampleIds: ['S-1'],
          paperIds: ['pa1'],
          peopleIds: ['m1'],
          reagentLots: ['lot-42']
        },
        synthesisOutcome: {
          producedCompoundCode: 'CMP-1',
          purityPercent: 98,
          usedInAssay: 'yes'
        },
        resultFiles: ['result.txt']
      }
    ],
    assays: [
      {
        id: 'a1',
        name: 'Assay 1',
        projectId: 'p1',
        notebookEntryId: 'n1',
        sampleAxis: 'row',
        concentrationAxis: 'col',
        plateType: '96'
      }
    ],
    gelAnalyses: [
      {
        id: 'g1',
        name: 'Gel 1',
        projectId: 'p1',
        notebookEntryId: 'n1',
        analysisType: 'western',
        report: { confidence: { score: 0.9 } }
      }
    ]
  };

  const graph = objectGraph.rebuildObjectGraph(state);
  assert.equal(Boolean(graph.nodes['project:p1']), true);
  assert.equal(Boolean(graph.nodes['notebook_entry:n1']), true);
  assert.equal(Boolean(graph.nodes['workflow:w1']), true);
  assert.equal(Boolean(graph.nodes['workflow_block:w1:block:b1']), true);
  assert.equal(Boolean(graph.nodes['workflow_template:wt1']), true);
  assert.equal(Boolean(graph.nodes['workflow_template_block:wt1:block:tb1']), true);
  assert.equal(Boolean(graph.nodes['reagent_lot:lot-42']), true);
  assert.equal(
    graph.edges.some((edge) => edge.from === 'workflow:w1' && edge.to === 'notebook_entry:n1' && edge.relation === 'links_notebook_page'),
    true
  );
  assert.equal(
    graph.edges.some((edge) => edge.from === 'workflow_block:w1:block:b1' && edge.to === 'person:m1' && edge.relation === 'assigned_to'),
    true
  );

  state.objectGraph = graph;
  const lotMatches = objectGraph.queryNotebookEntriesByRelation(state, {
    relation: 'uses_reagent_lot',
    targetType: 'reagent_lot',
    targetId: 'lot-42'
  });
  assert.equal(lotMatches.length, 1);
  assert.equal(lotMatches[0].id, 'n1');

  const usage = objectGraph.queryInstrumentUsageInRange(
    state,
    'i1',
    '2026-01-01T00:00:00.000Z',
    '2026-01-31T23:59:59.000Z'
  );
  assert.equal(usage.length, 1);
  assert.equal(usage[0].id, 'n1');
  assert.equal(objectGraph.queryInstrumentUsageInRange(state, 'i1', 'bad', 'date').length, 0);
});

test('rebuildObjectGraph supports plain-text workflow blocks without protocol edges', () => {
  const state = {
    members: [{ id: 'm1', name: 'Alice' }],
    workflowTemplates: [
      {
        id: 'wt-text',
        name: 'Text Template',
        blocks: [{ id: 'tb-text', type: 'text', text: 'Mix gently', assigneeId: 'm1' }],
        links: []
      }
    ],
    workflows: [
      {
        id: 'w-text',
        name: 'Text Workflow',
        projectId: '',
        notebookEntryIds: [],
        blocks: [{ id: 'b-text', type: 'text', text: 'Incubate 10 min', assigneeId: 'm1' }],
        links: []
      }
    ]
  };

  const graph = objectGraph.rebuildObjectGraph(state);
  assert.equal(Boolean(graph.nodes['workflow_block:w-text:block:b-text']), true);
  assert.equal(Boolean(graph.nodes['workflow_template_block:wt-text:block:tb-text']), true);
  assert.equal(
    graph.edges.some((edge) => edge.from === 'workflow_block:w-text:block:b-text' && edge.relation === 'assigned_to' && edge.to === 'person:m1'),
    true
  );
  assert.equal(
    graph.edges.some((edge) => edge.from === 'workflow_block:w-text:block:b-text' && edge.relation === 'uses_protocol'),
    false
  );
  assert.equal(
    graph.edges.some((edge) => edge.from === 'workflow_template_block:wt-text:block:tb-text' && edge.relation === 'uses_protocol'),
    false
  );
});

test('view constants and index navigation stay in sync', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const viewValues = Object.values(shared.VIEWS);
  const sectionViews = new Set([...html.matchAll(/<section id=\"([^\"]+)\" class=\"view\"/g)].map((match) => match[1]));
  const navViews = new Set([...html.matchAll(/data-view=\"([^\"]+)\"/g)].map((match) => match[1]));

  const nonHomeViews = viewValues.filter((value) => value !== shared.VIEWS.HOME);
  const navRequiredViews = nonHomeViews.filter((value) => value !== shared.VIEWS.PERSONAL_INVENTORY);
  const missingSections = nonHomeViews.filter((value) => !sectionViews.has(value));
  const missingNav = navRequiredViews.filter((value) => !navViews.has(value));
  const unknownNav = [...navViews].filter((value) => !viewValues.includes(value));

  assert.deepEqual(missingSections, []);
  assert.deepEqual(missingNav, []);
  assert.deepEqual(unknownNav, []);
});

test('sample and inventory use a merged navigation entry', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(
    html,
    /<button class="app-nav-btn" type="button" data-view="sample-registry-view">Sample &amp; Inventory<\/button>/
  );
  assert.equal(/<button[^>]+data-view="personal-inventory-view"/.test(html), false);
  assert.match(
    html,
    /<button class="tile" data-view="sample-registry-view">[\s\S]*?<span class="label">Sample &amp; Inventory<\/span>[\s\S]*?<\/button>/
  );
});

test('renderer routes personal inventory aliases to merged sample workspace', () => {
  const source = readSource('renderer.js');
  assert.match(
    source,
    /function normalizeViewId\(viewId\)\s*\{\s*return viewId === VIEWS\.PERSONAL_INVENTORY \? VIEWS\.SAMPLE_REGISTRY : viewId;\s*\}/
  );
  assert.match(source, /\['inventory', \{ viewId: VIEWS\.SAMPLE_REGISTRY, inputId: 'sample-search', label: 'Sample & Inventory' \}\]/);
  assert.match(source, /const showSampleInventoryWorkspace = nextView === VIEWS\.SAMPLE_REGISTRY;/);
  assert.match(
    source,
    /if \(nextView === VIEWS\.SAMPLE_REGISTRY\) \{\s*personalInventory\.renderSections\(\);\s*sampleRegistry\.render\(\);\s*\}/
  );
});

test('renderer defines sequence viewer aliases and showView render hook', () => {
  const source = readSource('renderer.js');
  assert.match(source, /\['sequence', VIEWS\.SEQUENCE_VIEWER\]/);
  assert.match(source, /\['seqviewer', VIEWS\.SEQUENCE_VIEWER\]/);
  assert.match(source, /\['sequence-viewer', VIEWS\.SEQUENCE_VIEWER\]/);
  assert.match(source, /if \(nextView === VIEWS\.SEQUENCE_VIEWER\) \{\s*sequenceViewer\?\.render\?\.\(\);\s*\}/);
});

test('tool-box exposes optional sequence viewer handoff callback contract', () => {
  const source = readSource('modules/tool-box.js');
  assert.match(source, /export function initToolBox\(options = \{\}\)/);
  assert.match(source, /const onOpenSequenceViewer = typeof options\?\.onOpenSequenceViewer === 'function'/);
  assert.match(source, /plannotate-open-sequence-viewer/);
});

test('sequence viewer uses bottom feature track without table dependency', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const viewerSource = readSource('modules/sequence-viewer.js');
  assert.match(html, /id="sequence-viewer-feature-rail-host"/);
  assert.match(html, /id="sequence-viewer-feature-detail"/);
  assert.equal(html.includes('sequence-viewer-feature-table-body'), false);
  assert.equal(viewerSource.includes('featureTableBody'), false);
});

test('ketcher embedded page uses portable static path resolution', () => {
  const html = fs.readFileSync(path.join(__dirname, 'ketcher-embedded.html'), 'utf8');
  assert.equal(html.includes('/Users/'), false);
  assert.equal(html.includes('C:\\\\Users'), false);
  assert.match(
    html,
    /new URL\('\.\/vendor\/ketcher-src\/packages\/release\/index\.html', window\.location\.href\)/
  );
});

test('forge config prunes dev deps and ignores build artifacts', () => {
  assert.equal(forgeConfig.packagerConfig.asar, true);
  assert.equal(forgeConfig.packagerConfig.prune, true);
  assert.ok(Array.isArray(forgeConfig.packagerConfig.ignore));
  const ignoreAsText = forgeConfig.packagerConfig.ignore.map((item) => item.toString()).join('\n');
  assert.match(ignoreAsText, /\\\/out\(\$\|\\\/\)/);
  assert.match(ignoreAsText, /\\\/output\(\$\|\\\/\)/);
  assert.match(ignoreAsText, /\\\/tmp\(\$\|\\\/\)/);
  assert.match(ignoreAsText, /\.DS_Store/);
  assert.match(ignoreAsText, /enana-data\(\?:\\\.ena\)\?\\\.json/);
});

test('telegram bridge keeps only supported renderer IPC channel', () => {
  const telegramBotSource = fs.readFileSync(path.join(__dirname, 'telegramBot.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  assert.equal(telegramBotSource.includes('telegram-message'), false);
  assert.equal(preloadSource.includes('onTelegramCommand'), true);
});

test('telegram bot writes events to data/telegram-events.log by default', () => {
  const telegramBotSource = fs.readFileSync(path.join(__dirname, 'telegramBot.js'), 'utf8');
  assert.match(telegramBotSource, /data', 'telegram-events\.log'/);
  assert.equal(telegramBotSource.includes('telegram-messages.log'), false);
});

test('main agent chat logging records request/result/error with redacted API key metadata', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.match(mainSource, /const AGENT_CHAT_LOG_FILE_NAME = 'agent-chat\.log';/);
  assert.match(mainSource, /ENANA_AGENT_CHAT_LOG_PATH/);
  assert.match(mainSource, /void ensureAgentChatLogFile\(getAgentChatLogPath\(\)\);/);
  assert.match(mainSource, /apiKeyProvided: Boolean\(cleanText\(source\.apiKey, 12\)\)/);
  assert.equal(mainSource.includes('apiKey: cleanText(source.apiKey'), false);
  assert.match(mainSource, /type: 'agent-chat-request'/);
  assert.match(mainSource, /type: 'agent-chat-result'/);
  assert.match(mainSource, /type: 'agent-chat-error'/);
});

test('agent chat contract exposes optional routing payload', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const agentChat = (contract.functions || []).find((fn) => fn.name === 'agent_chat');
  assert.equal(Boolean(agentChat), true);
  const props = agentChat.output_schema?.properties || {};
  assert.equal(Boolean(props.routing), true);
  assert.equal(props.routing.type, 'object');
});

test('toolbox_plannotate contract enforces plain-text sequence input for LLM tool calls', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'agent-io-contract.json'), 'utf8'));
  const tool = (contract.tools || []).find((entry) => entry.name === 'toolbox_plannotate');
  assert.equal(Boolean(tool), true);
  const schema = tool.input_schema || {};
  assert.equal(Array.isArray(schema.required), true);
  assert.equal(schema.required.includes('sequence_text'), true);
  const props = schema.properties || {};
  assert.equal(Boolean(props.sequence_text), true);
  assert.equal(props.sequence_text.type, 'string');
  assert.equal(Boolean(props.file_path), false);
  assert.equal(Boolean(props.file_text), false);
  assert.equal(Boolean(props.file_bytes_base64), false);
});

test('main agent controller output includes routing metadata fields', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.match(mainSource, /routing:\s*normalizeRoutingForAgentLog\(source\.routing\)/);
  assert.match(mainSource, /routing,\n\s*intermediateStates,\n\s*toolTrace/);
  assert.match(mainSource, /buildRuleBasedRoutingDecision\(/);
  assert.match(mainSource, /shouldUseRoutingFallback\(/);
  assert.match(mainSource, /requestRoutingFallbackPayload\(/);
  assert.match(mainSource, /executeToolCall\(/);
  assert.match(mainSource, /runAgentToolDispatchLegacy\(/);
  assert.match(mainSource, /tool_selection_rationale/);
  assert.match(mainSource, /selector score=/);
});

test('telegram bot internals normalize search and module parsing', () => {
  const internals = telegramBot._internals || {};
  assert.equal(typeof internals.getCommandArgs, 'function');
  assert.equal(typeof internals.getSearchTarget, 'function');
  assert.equal(typeof internals.splitFirstToken, 'function');

  assert.equal(internals.getCommandArgs('/search assay kinase inhibitor'), 'assay kinase inhibitor');
  assert.equal(internals.normalizeTokenKey('Sample Registry'), 'sample-registry');
  assert.equal(internals.getSearchTarget('assays').type, 'search-assays');
  assert.equal(internals.getSearchTarget('chemicals').type, 'search-chemicals');
  assert.deepEqual(
    internals.splitFirstToken('assay kinase inhibitor'),
    { first: 'assay', rest: 'kinase inhibitor' }
  );
});

test('telegram bot internals suggest module names for typos', () => {
  const internals = telegramBot._internals || {};
  assert.equal(typeof internals.getModuleSuggestions, 'function');
  assert.equal(typeof internals.getModuleCatalog, 'function');
  assert.equal(typeof internals.levenshteinDistance, 'function');
  assert.ok(internals.getModuleCatalog().some((entry) => entry.token === 'protocols'));
  assert.ok(internals.getModuleCatalog().some((entry) => entry.token === 'projects'));
  assert.ok(internals.getModuleSuggestions('protcols').includes('protocols'));
  assert.equal(internals.levenshteinDistance('assay', 'asay'), 1);
});

test('package manifest includes scripts and dependencies required for portable installs', () => {
  assert.equal(packageManifest.scripts.start, 'electron-forge start');
  assert.equal(packageManifest.scripts.test, 'node test.js');
  assert.equal(packageManifest.scripts.dist, 'electron-forge make');
  assert.equal(packageManifest.scripts['package:app'], 'electron-forge package');
  assert.equal(packageManifest.dependencies.telegraf, '^4.16.3');
  assert.equal(packageManifest.dependencies['electron-squirrel-startup'], '^1.0.1');
  assert.equal(packageManifest.devDependencies.electron, '^40.7.0');
  assert.equal(Boolean(packageManifest.devDependencies['@electron-forge/cli']), true);
});

test('DOM id references in source map to markup or approved dynamic IDs', () => {
  const sourceFiles = [
    path.join(__dirname, 'renderer.js'),
    ...fs.readdirSync(path.join(__dirname, 'modules'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => path.join(__dirname, 'modules', name))
  ];
  const htmlFiles = [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'ketcher-embedded.html')
  ];

  const referencedIds = new Set();
  sourceFiles.forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const re = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = re.exec(source))) {
      referencedIds.add(match[1]);
    }
  });

  const markupIds = new Set();
  htmlFiles.forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const re = /id\s*=\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = re.exec(source))) {
      markupIds.add(match[1]);
    }
  });

  const allowedDynamic = new Set([
    'exit-btn',
    'sample-loc-freezer',
    'sample-loc-rack',
    'sample-loc-box',
    'sample-loc-position',
    'sample-loc-fridge',
    'sample-loc-shelf',
    'sample-loc-desiccator',
    'sample-loc-desiccator-position',
    'sample-loc-cabinet',
    'sample-loc-cabinet-slot'
  ]);

  const missing = [...referencedIds].filter((id) => !markupIds.has(id));
  const unexpected = missing.filter((id) => !allowedDynamic.has(id));
  assert.deepEqual(unexpected, []);
});

const sourceCache = new Map();
function readSource(relativePath) {
  const filePath = path.join(__dirname, relativePath);
  if (!sourceCache.has(filePath)) {
    sourceCache.set(filePath, fs.readFileSync(filePath, 'utf8'));
  }
  return sourceCache.get(filePath);
}

function hasEdge(graph, from, relation, to) {
  return graph.edges.some((edge) => edge.from === from && edge.relation === relation && edge.to === to);
}

function assertClose(actual, expected, epsilon = 1e-6) {
  assert.equal(Number.isFinite(actual), true, `Expected finite number, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`);
}

function buildObjectGraphFixture() {
  return {
    members: [{ id: 'm1', name: 'Alice' }],
    projects: [{ id: 'p1', name: 'Project 1' }],
    protocols: [{ id: 'pr1', name: 'Protocol 1' }],
    workflowTemplates: [
      {
        id: 'wt1',
        name: 'Template 1',
        blocks: [{ id: 'tb1', protocolId: 'pr1', assigneeId: 'm1' }],
        links: []
      }
    ],
    workflows: [
      {
        id: 'w1',
        name: 'Workflow 1',
        projectId: 'p1',
        notebookEntryIds: ['n1'],
        blocks: [{ id: 'b1', protocolId: 'pr1', assigneeId: 'm1' }],
        links: []
      }
    ],
    instruments: [{ id: 'i1', name: 'HPLC' }],
    papers: [
      {
        id: 'pa1',
        title: 'Paper 1',
        methodsExtract: [{ title: 'Method A' }],
        keyReagents: [{ name: 'Reagent A' }]
      }
    ],
    paperExperimentLinks: [{ paperId: 'pa1', entryId: 'n1', projectId: 'p1', note: 'linked' }],
    labInventory: { chemicals: [{ id: 'c1', name: 'Acetone' }] },
    samples: [
      {
        id: 's1',
        code: 'S-1',
        name: 'Sample 1',
        location: { storageType: 'freezer', freezer: 'F1', rack: 'R1', box: 'B1', position: 'A1' },
        chemicalLinks: ['c1'],
        inventoryLink: { containerId: 'box1', section: '-20 Degree', wellIndex: 5 }
      }
    ],
    inventory: {
      '-20 Degree': [
        {
          id: 'box1',
          name: 'Box 1',
          type: 'box81',
          wells: [{ name: 'A1', content: 'Material' }]
        }
      ]
    },
    notebookEntries: [
      {
        id: 'n1',
        projectId: 'p1',
        protocolId: 'pr1',
        protocolName: 'Protocol 1',
        updatedAt: '2026-01-15T00:00:00.000Z',
        references: {
          instrumentId: 'i1',
          chemicalIds: ['c1'],
          sampleIds: ['S-1'],
          paperIds: ['pa1'],
          peopleIds: ['m1'],
          reagentLots: ['lot-42']
        },
        synthesisOutcome: {
          producedCompoundCode: 'CMP-1',
          purityPercent: 98,
          usedInAssay: 'yes'
        },
        resultFiles: ['result.txt']
      }
    ],
    assays: [{ id: 'a1', name: 'Assay 1', projectId: 'p1', notebookEntryId: 'n1' }],
    gelAnalyses: [{ id: 'g1', name: 'Gel 1', projectId: 'p1', notebookEntryId: 'n1', report: { confidence: { score: 0.9 } } }]
  };
}

const normalizedArrayKeys = [
  'instruments',
  'projects',
  'workflows',
  'workflowTemplates',
  'journalClubs',
  'papers',
  'paperExperimentLinks',
  'notebookEntries',
  'assays',
  'gelAnalyses',
  'samples',
  'messages'
];

normalizedArrayKeys.forEach((key) => {
  test(`[P0] normalizeState resets invalid "${key}" to []`, () => {
    const normalized = shared.normalizeState({ [key]: { bad: true } });
    assert.equal(Array.isArray(normalized[key]), true);
    assert.equal(normalized[key].length, 0);
  });
});

normalizedArrayKeys.forEach((key) => {
  test(`[P1] normalizeState preserves valid array for "${key}"`, () => {
    const payload = [{ id: `${key}-1` }];
    const normalized = shared.normalizeState({ [key]: payload });
    assert.deepEqual(normalized[key], payload);
  });
});

test('[P0] normalizeState resets invalid knowledgeChats object', () => {
  const normalized = shared.normalizeState({ knowledgeChats: 'bad' });
  assert.equal(typeof normalized.knowledgeChats, 'object');
  assert.equal(Array.isArray(normalized.knowledgeChats), false);
  assert.equal(Object.keys(normalized.knowledgeChats).length, 0);
});

test('[P0] normalizeState normalizes agentChat defaults', () => {
  const normalized = shared.normalizeState({ agentChat: { projectId: 123, messages: 'bad' } });
  assert.equal(normalized.agentChat.projectId, '123');
  assert.equal(Array.isArray(normalized.agentChat.messages), true);
  assert.equal(normalized.agentChat.messages.length, 0);
});

test('[P1] normalizeState preserves provided agentChat messages array', () => {
  const payload = [{ id: 'm1', role: 'user', text: 'hello' }];
  const normalized = shared.normalizeState({ agentChat: { projectId: 'p1', messages: payload } });
  assert.equal(normalized.agentChat.projectId, 'p1');
  assert.deepEqual(normalized.agentChat.messages, payload);
});

test('[P0] normalizeState keeps default inventory locations when invalid', () => {
  const normalized = shared.normalizeState({ settings: { inventoryLocations: 'bad' } });
  assert.deepEqual(normalized.settings.inventoryLocations, shared.defaultState.settings.inventoryLocations);
});

test('[P1] normalizeState preserves explicit inventory locations array', () => {
  const normalized = shared.normalizeState({ settings: { inventoryLocations: ['Freezer A', 'Fridge B'] } });
  assert.deepEqual(normalized.settings.inventoryLocations, ['Freezer A', 'Fridge B']);
});

test('[P1] normalizeState keeps startup defaults when settings.startup is missing', () => {
  const normalized = shared.normalizeState({ settings: {} });
  assert.deepEqual(normalized.settings.startup, shared.defaultState.settings.startup);
});

test('[P0] normalizeState falls back to home-view for invalid startup defaultViewId', () => {
  const normalized = shared.normalizeState({
    settings: {
      startup: {
        defaultViewId: 'unknown-view-id',
        rememberLastView: true,
        autoLoadDataFileOnLaunch: true
      }
    }
  });
  assert.equal(normalized.settings.startup.defaultViewId, 'home-view');
  assert.equal(normalized.settings.startup.rememberLastView, true);
  assert.equal(normalized.settings.startup.autoLoadDataFileOnLaunch, true);
});

test('[P0] normalizeState resets invalid startup flags to defaults', () => {
  const normalized = shared.normalizeState({
    settings: {
      startup: {
        defaultViewId: 'assay-view',
        rememberLastView: 'yes',
        autoLoadDataFileOnLaunch: 1
      }
    }
  });
  assert.equal(normalized.settings.startup.defaultViewId, 'assay-view');
  assert.equal(
    normalized.settings.startup.rememberLastView,
    shared.defaultState.settings.startup.rememberLastView
  );
  assert.equal(
    normalized.settings.startup.autoLoadDataFileOnLaunch,
    shared.defaultState.settings.startup.autoLoadDataFileOnLaunch
  );
});

test('[P1] normalizeState migrates legacy endpoint from llm.api URL', () => {
  const normalized = shared.normalizeState({ settings: { llm: { api: 'https://example.com/v1' } } });
  assert.equal(normalized.settings.llm.apiEndpoint, 'https://example.com/v1');
  assert.equal(normalized.settings.llm.apiKey, '');
  assert.equal(normalized.settings.llm.provider, 'openai');
});

test('[P1] normalizeState treats codex:// legacy llm.api as endpoint', () => {
  const normalized = shared.normalizeState({ settings: { llm: { provider: 'codex', api: 'codex://cli' } } });
  assert.equal(normalized.settings.llm.provider, 'codex');
  assert.equal(normalized.settings.llm.apiEndpoint, 'codex://cli');
  assert.equal(normalized.settings.llm.apiKey, '');
});

test('[P1] normalizeState keeps explicit llm.apiKey over legacy llm.api key', () => {
  const normalized = shared.normalizeState({ settings: { llm: { api: 'legacy-key', apiKey: 'new-key' } } });
  assert.equal(normalized.settings.llm.apiKey, 'new-key');
});

test('[P1] normalizeState trims llm.apiEndpoint whitespace', () => {
  const normalized = shared.normalizeState({ settings: { llm: { apiEndpoint: '  https://api.example/v1  ' } } });
  assert.equal(normalized.settings.llm.apiEndpoint, 'https://api.example/v1');
});

test('[P1] normalizeState keeps explicit llm.provider', () => {
  const normalized = shared.normalizeState({ settings: { llm: { provider: 'claude' } } });
  assert.equal(normalized.settings.llm.provider, 'claude');
  assert.equal(normalized.settings.llm.apiEndpoint, 'https://api.anthropic.com/v1/messages');
});

test('[P1] normalizeState infers llm.provider from endpoint', () => {
  const normalized = shared.normalizeState({
    settings: {
      llm: {
        apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta'
      }
    }
  });
  assert.equal(normalized.settings.llm.provider, 'gemini');
});

test('[P1] normalizeState infers llm.provider from codex endpoint', () => {
  const normalized = shared.normalizeState({
    settings: {
      llm: {
        apiEndpoint: 'codex://cli'
      }
    }
  });
  assert.equal(normalized.settings.llm.provider, 'codex');
});

test('[P1] normalizeState does not mutate defaultState arrays', () => {
  const normalized = shared.normalizeState({});
  normalized.members.push({ id: 'm1' });
  assert.equal(shared.defaultState.members.length, 0);
});

test('[P1] normalizeState merges objectGraph from source', () => {
  const normalized = shared.normalizeState({
    objectGraph: {
      nodes: { 'project:p1': { uid: 'project:p1' } },
      edges: [{ from: 'a', to: 'b', relation: 'r' }]
    }
  });
  assert.equal(Boolean(normalized.objectGraph.nodes['project:p1']), true);
  assert.equal(normalized.objectGraph.edges.length, 1);
});

[
  ['plain text', 'plain text'],
  ['<tag>', '&lt;tag&gt;'],
  ['Tom & Jerry', 'Tom &amp; Jerry'],
  ['"quoted"', '&quot;quoted&quot;'],
  ["it's", 'it&#39;s'],
  [null, ''],
  [123, '123']
].forEach(([input, expected], idx) => {
  test(`[P0] safeText case ${idx + 1}`, () => {
    assert.equal(shared.safeText(input), expected);
  });
});

[
  ['abc', 'abc'],
  ['a"b', 'a\\"b'],
  ['a\\b', 'a\\\\b'],
  ['"\\', '\\"\\\\'],
  ['', ''],
  [123, '123']
].forEach(([input, expected], idx) => {
  test(`[P1] cssEscape case ${idx + 1}`, () => {
    assert.equal(shared.cssEscape(input), expected);
  });
});

[
  'protocol_share_sent',
  'protocol_share_imported',
  'protocol_share_link_copied',
  'protocol_share_link_imported'
].forEach((eventName) => {
  test(`[P0] trackGrowthEvent increments counter "${eventName}"`, () => {
    const state = {};
    shared.trackGrowthEvent(state, eventName, { source: 'unit' });
    assert.equal(state.growthMetrics.counters[eventName], 1);
    assert.equal(state.growthMetrics.events.length, 1);
    assert.equal(state.growthMetrics.events[0].name, eventName);
  });
});

test('[P1] trackGrowthEvent records unknown events without counter mutation', () => {
  const state = {};
  shared.trackGrowthEvent(state, 'unknown_event', { a: 1 });
  assert.equal(state.growthMetrics.counters.protocol_share_sent, 0);
  assert.equal(state.growthMetrics.events.length, 1);
  assert.equal(state.growthMetrics.events[0].name, 'unknown_event');
});

test('[P1] trackGrowthEvent clones props object', () => {
  const state = {};
  const props = { a: 1 };
  shared.trackGrowthEvent(state, 'unknown_event', props);
  props.a = 2;
  assert.equal(state.growthMetrics.events[0].props.a, 1);
});

test('[P1] createId returns non-empty token containing "-" separator', () => {
  const value = shared.createId();
  assert.equal(typeof value, 'string');
  assert.equal(value.includes('-'), true);
  assert.ok(value.length > 8);
});

[
  ['a.json', true],
  ['a.JSON', true],
  ['a.ena', true],
  ['a.ENA', true],
  ['a.json ', true],
  [' a.ena', true],
  ['a.txt', false],
  ['a.json.bak', false],
  ['json', false],
  ['', false]
].forEach(([input, expected], idx) => {
  test(`[P0] hasSupportedDataExtension case ${idx + 1}`, () => {
    assert.equal(mainUtils.hasSupportedDataExtension(input), expected);
  });
});

[
  ['/tmp/a.json', '/tmp/fallback.json', '/tmp/a.json'],
  ['/tmp/a', '/tmp/fallback.json', '/tmp/a.json'],
  ['', '/tmp/fallback.json', '/tmp/fallback.json'],
  ['', '/tmp/fallback', '/tmp/fallback.json'],
  ['/tmp/a.ena', '', '/tmp/a.ena'],
  ['/tmp/a.JSON', '', '/tmp/a.JSON'],
  ['  /tmp/a  ', '', '/tmp/a.json'],
  ['', '', ''],
  [null, '/tmp/fallback.ena', '/tmp/fallback.ena'],
  [undefined, '/tmp/fallback', '/tmp/fallback.json']
].forEach(([preferred, fallback, expected], idx) => {
  test(`[P0] normalizeDataFilePath case ${idx + 1}`, () => {
    assert.equal(mainUtils.normalizeDataFilePath(preferred, fallback), expected);
  });
});

[
  ['My Plasmid', 'My_Plasmid'],
  ['  spaced name  ', 'spaced_name'],
  ['A/B:C', 'A_B_C'],
  ['___abc___', 'abc'],
  ['a.b-c_d', 'a.b-c_d'],
  ['***', 'plasmid'],
  ['', 'plasmid'],
  [null, 'plasmid'],
  ['alpha beta gamma', 'alpha_beta_gamma'],
  ['中文', 'plasmid']
].forEach(([input, expected], idx) => {
  test(`[P1] sanitizeOutputName default fallback case ${idx + 1}`, () => {
    assert.equal(mainUtils.sanitizeOutputName(input), expected);
  });
});

test('[P1] sanitizeOutputName uses custom fallback when normalized output is empty', () => {
  assert.equal(mainUtils.sanitizeOutputName('***', 'fallback_name'), 'fallback_name');
});

[
  [' _pL ann!* ', '_pLann'],
  ['suffix-1', 'suffix-1'],
  ['A.B_C', 'A.B_C'],
  ['   ', ''],
  [null, '_pLann'],
  [undefined, '_pLann'],
  ['x/y:z', 'xyz'],
  ['"quoted"', 'quoted']
].forEach(([input, expected], idx) => {
  test(`[P1] sanitizeSuffix case ${idx + 1}`, () => {
    assert.equal(mainUtils.sanitizeSuffix(input), expected);
  });
});

[
  ['', ''],
  ['   ', ''],
  ['>already\nACGT\n', '>already\nACGT'],
  ['acgt', '>sequence\nACGT\n'],
  ['ac gt 123', '>sequence\nACGT\n'],
  ['n-n-n', '>sequence\nNNN\n'],
  ['abc!def', '>sequence\nABCDEF\n'],
  ['a'.repeat(80), `>sequence\n${'A'.repeat(80)}\n`],
  ['a'.repeat(81), `>sequence\n${'A'.repeat(80)}\nA\n`],
  ['a'.repeat(160), `>sequence\n${'A'.repeat(80)}\n${'A'.repeat(80)}\n`]
].forEach(([input, expected], idx) => {
  test(`[P0] normalizeSequenceInput case ${idx + 1}`, () => {
    assert.equal(mainUtils.normalizeSequenceInput(input), expected);
  });
});

const expectedGraphRelations = [
  ['workflow:w1', 'uses_project', 'project:p1'],
  ['workflow:w1', 'links_notebook_page', 'notebook_entry:n1'],
  ['workflow:w1', 'has_block', 'workflow_block:w1:block:b1'],
  ['workflow_block:w1:block:b1', 'uses_protocol', 'protocol:pr1'],
  ['workflow_block:w1:block:b1', 'assigned_to', 'person:m1'],
  ['workflow_template:wt1', 'has_block', 'workflow_template_block:wt1:block:tb1'],
  ['workflow_template_block:wt1:block:tb1', 'uses_protocol', 'protocol:pr1'],
  ['workflow_template_block:wt1:block:tb1', 'suggested_assignee', 'person:m1'],
  ['paper:pa1', 'describes_method', 'method:pa1:method:1'],
  ['paper:pa1', 'mentions_reagent', 'reagent:pa1:reagent:1'],
  ['sample:S-1', 'stored_at', 'location:F1 -> R1 -> B1 -> A1'],
  ['sample:S-1', 'related_chemical', 'chemical:c1'],
  ['sample:S-1', 'stored_in_container', 'container:box1'],
  ['sample:box1:well:1', 'stored_in', 'container:box1'],
  ['notebook_entry:n1', 'uses_project', 'project:p1'],
  ['notebook_entry:n1', 'uses_protocol', 'protocol:pr1'],
  ['notebook_entry:n1', 'uses_instrument', 'instrument:i1'],
  ['notebook_entry:n1', 'uses_chemical', 'chemical:c1'],
  ['notebook_entry:n1', 'uses_sample', 'sample:S-1'],
  ['notebook_entry:n1', 'references_paper', 'paper:pa1'],
  ['notebook_entry:n1', 'performed_by', 'person:m1'],
  ['notebook_entry:n1', 'uses_reagent_lot', 'reagent_lot:lot-42'],
  ['notebook_entry:n1', 'produces_compound', 'compound:CMP-1'],
  ['notebook_entry:n1', 'has_attachment', 'file:n1:result.txt'],
  ['assay:a1', 'uses_project', 'project:p1'],
  ['assay:a1', 'links_notebook_page', 'notebook_entry:n1'],
  ['gel_analysis:g1', 'uses_project', 'project:p1'],
  ['gel_analysis:g1', 'links_notebook_page', 'notebook_entry:n1'],
  ['paper:pa1', 'inspires_experiment', 'notebook_entry:n1']
];

expectedGraphRelations.forEach(([from, relation, to], idx) => {
  test(`[P0] rebuildObjectGraph relation case ${idx + 1}`, () => {
    const graph = objectGraph.rebuildObjectGraph(buildObjectGraphFixture());
    assert.equal(hasEdge(graph, from, relation, to), true);
  });
});

[
  [{ storageType: 'freezer', freezer: 'F1', rack: 'R1', box: 'B1', position: 'A1' }, 'location:F1 -> R1 -> B1 -> A1'],
  [{ storageType: 'fridge', fridge: 'FR1', shelf: 'Top' }, 'location:FR1 -> Top'],
  [{ storageType: 'desiccator', desiccator: 'D2', position: 'P3' }, 'location:D2 -> P3'],
  [{ storageType: 'cabinet', cabinet: 'CAB', slot: 'S1' }, 'location:CAB -> S1']
].forEach(([location, expectedNode], idx) => {
  test(`[P1] rebuildObjectGraph builds location node case ${idx + 1}`, () => {
    const state = buildObjectGraphFixture();
    state.samples = [{ id: 's1', code: 'S-1', name: 'Sample', location, chemicalLinks: [], inventoryLink: null }];
    const graph = objectGraph.rebuildObjectGraph(state);
    assert.equal(Boolean(graph.nodes[expectedNode]), true);
  });
});

[
  ['uses_chemical', 'chemical', 'c1', ['n1']],
  ['uses_sample', 'sample', 'S-1', ['n1']],
  ['uses_reagent_lot', 'reagent_lot', 'lot-42', ['n1']],
  ['references_paper', 'paper', 'pa1', ['n1']],
  ['performed_by', 'person', 'm1', ['n1']],
  ['uses_project', 'project', 'missing', []],
  ['missing_relation', 'chemical', 'c1', []]
].forEach(([relation, targetType, targetId, expectedIds], idx) => {
  test(`[P0] queryNotebookEntriesByRelation case ${idx + 1}`, () => {
    const state = buildObjectGraphFixture();
    const entries = objectGraph.queryNotebookEntriesByRelation(state, { relation, targetType, targetId });
    assert.equal(JSON.stringify(entries.map((item) => item.id)), JSON.stringify(expectedIds));
  });
});

[
  ['i1', '2026-01-01T00:00:00.000Z', '2026-01-31T23:59:59.000Z', ['n1']],
  ['i1', '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z', ['n1']],
  ['i1', 'bad', '2026-01-31T23:59:59.000Z', []],
  ['i1', '2026-01-01T00:00:00.000Z', 'bad', []],
  ['i2', '2026-01-01T00:00:00.000Z', '2026-01-31T23:59:59.000Z', []],
  ['i1', '2026-01-16T00:00:00.000Z', '2026-01-31T23:59:59.000Z', []],
  ['i1', '2026-01-31T23:59:59.000Z', '2026-01-01T00:00:00.000Z', []]
].forEach(([instrumentId, startIso, endIso, expectedIds], idx) => {
  test(`[P0] queryInstrumentUsageInRange case ${idx + 1}`, () => {
    const state = buildObjectGraphFixture();
    const entries = objectGraph.queryInstrumentUsageInRange(state, instrumentId, startIso, endIso);
    assert.equal(JSON.stringify(entries.map((item) => item.id)), JSON.stringify(expectedIds));
  });
});

const moduleExportContracts = [
  ['modules/agent-chat.js', /export function initAgentChat/],
  ['modules/assay.js', /export function initAssay/],
  ['modules/assay-analysis.js', /export function analyzeAssayData/],
  ['modules/biology-notebook.js', /export function initLabNotebook/],
  ['modules/buffer-compounds.js', /export const BUFFER_COMPOUNDS/],
  ['modules/collaboration-management.js', /export function initCollaborationManagement/],
  ['modules/gel-analysis.js', /export function initGelAnalysis/],
  ['modules/instrument-management.js', /export function initInstrumentManagement/],
  ['modules/lab-common-inventory.js', /export function initLabCommonInventory/],
  ['modules/lab-management.js', /export function initLabManagement/],
  ['modules/lab-notebook.js', /export function initLabNotebook/],
  ['modules/object-graph.js', /export function createUid/],
  ['modules/object-graph.js', /export function rebuildObjectGraph/],
  ['modules/papers-management.js', /export function initPapersManagement/],
  ['modules/personal-inventory.js', /export function initPersonalInventory/],
  ['modules/project-management.js', /export function initProjectManagement/],
  ['modules/protocol-management.js', /export function initProtocolManagement/],
  ['modules/sample-registry.js', /export function initSampleRegistry/],
  ['modules/settings.js', /export function initSettings/],
  ['modules/tool-box.js', /export function initToolBox/],
  ['modules/workflow-management.js', /export function initWorkflowManagement/]
];

moduleExportContracts.forEach(([relativePath, pattern], idx) => {
  test(`[P1] module export contract case ${idx + 1} (${relativePath})`, () => {
    assert.match(readSource(relativePath), pattern);
  });
});

const removedCodeGuards = [
  ['modules/shared.js', /LAB_NOTEBOOK/, false],
  ['telegramBot.js', /telegram-message/, false],
  ['preload.js', /onTelegramMessage/, false],
  ['ketcher-embedded.html', /\/Users\//, false],
  ['ketcher-embedded.html', /file:\/\//, false],
  ['index.html', /lab-notebook-view/, false],
  ['renderer.js', /VIEWS\.LAB_NOTEBOOK/, false],
  ['forge.config.js', /enana-data/, true],
  ['package.json', /"dist": "electron-forge make"/, true],
  ['package.json', /"package:app": "electron-forge package"/, true],
  ['modules/agent-chat.js', /apiKey: String\(state\.settings\?\.llm\?\.apiKey/, true]
];

removedCodeGuards.forEach(([relativePath, pattern, shouldMatch], idx) => {
  test(`[P1] regression guard case ${idx + 1} (${relativePath})`, () => {
    const source = readSource(relativePath);
    assert.equal(pattern.test(source), shouldMatch);
  });
});

const indexHtmlSource = readSource('index.html');
const sectionViews = new Set([...indexHtmlSource.matchAll(/<section id=\"([^\"]+)\" class=\"view\"/g)].map((match) => match[1]));
const navViews = new Set([...indexHtmlSource.matchAll(/data-view=\"([^\"]+)\"/g)].map((match) => match[1]));
const nonHomeViews = Object.values(shared.VIEWS).filter((viewId) => viewId !== shared.VIEWS.HOME);

nonHomeViews.forEach((viewId) => {
  test(`[P0] index section exists for ${viewId}`, () => {
    assert.equal(sectionViews.has(viewId), true);
  });
});

const navExpectedViews = nonHomeViews.filter((viewId) => viewId !== shared.VIEWS.PERSONAL_INVENTORY);
navExpectedViews.forEach((viewId) => {
  test(`[P0] index nav entry exists for ${viewId}`, () => {
    assert.equal(navViews.has(viewId), true);
  });
});

Object.entries(shared.TITLES).forEach(([viewId, title], idx) => {
  test(`[P1] title text exists for mapped view case ${idx + 1} (${viewId})`, () => {
    assert.equal(typeof title, 'string');
    assert.ok(title.trim().length > 0);
  });
});

const extraInvalidValues = [null, undefined, '', '[]', 0, 1, true, false, () => 1, Symbol.for('x')];
normalizedArrayKeys.forEach((key) => {
  extraInvalidValues.forEach((value, idx) => {
    test(`[EDGE] normalizeState invalid type matrix ${key} case ${idx + 1}`, () => {
      const normalized = shared.normalizeState({ [key]: value });
      assert.equal(Array.isArray(normalized[key]), true);
      assert.equal(normalized[key].length, 0);
    });
  });
});

normalizedArrayKeys.forEach((key) => {
  [
    [{ id: `${key}-a` }],
    [{ id: `${key}-a` }, { id: `${key}-b` }],
    [1, 2, 3]
  ].forEach((value, idx) => {
    test(`[EDGE] normalizeState valid array matrix ${key} case ${idx + 1}`, () => {
      const normalized = shared.normalizeState({ [key]: value });
      assert.deepEqual(normalized[key], value);
    });
  });
});

[
  '<script>',
  '<IMG SRC=x onerror=alert(1)>',
  '&already&escaped',
  'a"b"c',
  "apostrophe's test",
  '<<>>',
  '汉字<script>',
  '\nline\nbreak',
  '`code`',
  '<svg><path/></svg>',
  String.raw`slash\quote"combo`,
  '<a href="javascript:alert(1)">x</a>'
].forEach((input, idx) => {
  test(`[EDGE] safeText strips dangerous chars case ${idx + 1}`, () => {
    const output = shared.safeText(input);
    assert.equal(output.includes('<'), false);
    assert.equal(output.includes('>'), false);
  });
});

[
  '"',
  '\\',
  '\\"',
  'abc\\"def',
  'path\\to\\dir',
  'mix"and\\slash',
  '',
  'simple',
  '""""',
  '\\\\\\\\'
].forEach((input, idx) => {
  test(`[EDGE] cssEscape escapes quote/slash matrix case ${idx + 1}`, () => {
    const output = shared.cssEscape(input);
    assert.equal(/(^|[^\\])"/.test(output), false);
    assert.equal(output.includes('\\'), input.includes('\\') || input.includes('"'));
  });
});

[
  ['.json', true],
  ['.ena', true],
  ['file.', false],
  ['file..json', true],
  ['archive.tar.json', true],
  ['archive.tar.ena', true],
  [' spaced .json', true],
  ['a/b/c.ENA', true],
  ['A/B/C.Json', true],
  ['name\n.json', true],
  ['name\t.ena', true],
  ['sample.Json ', true],
  ['sample.Ena ', true],
  ['samplejson', false],
  ['sampleena', false],
  ['sample.jso', false],
  ['sample.en', false],
  ['sample.jpeg', false],
  ['sample.enaa', false],
  ['sample.jsonl', false],
  ['  ', false],
  ['a.🧪', false],
  ['A.JSON.BAK', false],
  ['a..ena', true],
  ['a..json', true],
  ['../relative/file.ena', true],
  ['../relative/file.json', true],
  ['C:\\temp\\file.json', true],
  ['C:\\temp\\file.ena', true],
  ['file.JSON\n', true]
].forEach(([input, expected], idx) => {
  test(`[EDGE] hasSupportedDataExtension extended case ${idx + 1}`, () => {
    assert.equal(mainUtils.hasSupportedDataExtension(input), expected);
  });
});

for (let length = 1; length <= 120; length += 3) {
  test(`[EDGE] normalizeSequenceInput wrap behavior len ${length}`, () => {
    const source = 'acgt'.repeat(Math.ceil(length / 4)).slice(0, length);
    const output = mainUtils.normalizeSequenceInput(source);
    const lines = output.trim().split('\n');
    assert.equal(lines[0], '>sequence');
    const seq = lines.slice(1).join('');
    assert.equal(seq, source.toUpperCase());
    lines.slice(1).forEach((line) => {
      assert.ok(line.length <= 80);
    });
  });
}

[
  ['>h\nacgt\nnn\n', '>h\nacgt\nnn'],
  ['>h\r\nACGT\r\n', '>h\r\nACGT'],
  ['>h\n', '>h'],
  ['>header with space\nACGT', '>header with space\nACGT'],
  ['>\nACGT', '>\nACGT']
].forEach(([input, expected], idx) => {
  test(`[EDGE] normalizeSequenceInput fasta passthrough case ${idx + 1}`, () => {
    assert.equal(mainUtils.normalizeSequenceInput(input), expected);
  });
});

[
  ['/tmp/name.', '/tmp/fallback.json', '/tmp/name..json'],
  ['/tmp/.hidden', '/tmp/fallback.json', '/tmp/.hidden.json'],
  ['/tmp/valid.ENA', '/tmp/fallback.json', '/tmp/valid.ENA'],
  ['/tmp/valid.Json', '/tmp/fallback.json', '/tmp/valid.Json'],
  ['/tmp/with spaces', '/tmp/fallback.ena', '/tmp/with spaces.json'],
  ['/tmp/multi.part.name', '/tmp/fallback.ena', '/tmp/multi.part.name.json'],
  ['  /tmp/trailing-space   ', '/tmp/fallback.ena', '/tmp/trailing-space.json'],
  ['', '/tmp/fallback.without.ext', '/tmp/fallback.without.ext.json'],
  [null, '/tmp/fallback.with.dot.', '/tmp/fallback.with.dot..json'],
  [undefined, '/tmp/only', '/tmp/only.json'],
  ['', '  ', ''],
  ['   ', '   ', '']
].forEach(([preferred, fallback, expected], idx) => {
  test(`[EDGE] normalizeDataFilePath extended case ${idx + 1}`, () => {
    assert.equal(mainUtils.normalizeDataFilePath(preferred, fallback), expected);
  });
});

[
  ['a'.repeat(120), 'a'.repeat(120)],
  ['a b c d e', 'a_b_c_d_e'],
  ['___', 'plasmid'],
  ['.....', '.....'],
  ['abc/def?ghi', 'abc_def_ghi'],
  [' leading-and-trailing ', 'leading-and-trailing'],
  ['UPPER lower MIXED', 'UPPER_lower_MIXED'],
  ['multiple   spaces', 'multiple_spaces'],
  ['name-with-dash', 'name-with-dash'],
  ['name_with_underscore', 'name_with_underscore'],
  ['name.with.dot', 'name.with.dot'],
  ['$', 'plasmid'],
  ['\n\t', 'plasmid'],
  ['__alpha__beta__', 'alpha__beta'],
  ['A/B\\C:D*E?F"G<H>I|J', 'A_B_C_D_E_F_G_H_I_J']
].forEach(([input, expected], idx) => {
  test(`[EDGE] sanitizeOutputName extended case ${idx + 1}`, () => {
    assert.equal(mainUtils.sanitizeOutputName(input), expected);
  });
});

[
  ['_alpha', '_alpha'],
  [' alpha beta ', 'alphabeta'],
  ['-x-y-z-', '-x-y-z-'],
  ['A.B.C', 'A.B.C'],
  ['A/B/C', 'ABC'],
  ['***suffix***', 'suffix'],
  ['123', '123'],
  ['__', '__'],
  ['\nA\tB\r', 'AB'],
  ['汉字', ''],
  [Symbol.for('x'), 'Symbolx']
].forEach(([input, expected], idx) => {
  test(`[EDGE] sanitizeSuffix extended case ${idx + 1}`, () => {
    assert.equal(mainUtils.sanitizeSuffix(input), expected);
  });
});

[
  { section: '-20 Degree', location: { storageType: 'freezer', freezer: 'F1', rack: 'R1', box: 'B1', position: 'A1' }, node: 'location:F1 -> R1 -> B1 -> A1' },
  { section: '4 Degree', location: { storageType: 'fridge', fridge: 'FR1', shelf: 'S2' }, node: 'location:FR1 -> S2' },
  { section: 'Room Temp', location: { storageType: 'desiccator', desiccator: 'DS1', position: 'P2' }, node: 'location:DS1 -> P2' },
  { section: 'Room Temp', location: { storageType: 'cabinet', cabinet: 'CAB1', slot: 'SLOT3' }, node: 'location:CAB1 -> SLOT3' },
  { section: 'Room Temp', location: { storageType: 'other', text: 'Bench A' }, node: null },
  { section: 'Room Temp', location: {}, node: null }
].forEach((scenario, idx) => {
  test(`[EDGE] rebuildObjectGraph location normalization case ${idx + 1}`, () => {
    const state = buildObjectGraphFixture();
    state.samples = [{
      id: `s-${idx + 1}`,
      code: `S-${idx + 1}`,
      name: `Sample ${idx + 1}`,
      location: scenario.location,
      chemicalLinks: [],
      inventoryLink: null
    }];
    const graph = objectGraph.rebuildObjectGraph(state);
    if (!scenario.node) {
      assert.equal(Object.keys(graph.nodes).some((key) => key.startsWith('location:')), false);
      return;
    }
    assert.equal(Boolean(graph.nodes[scenario.node]), true);
  });
});

[
  { relation: 'uses_project', targetType: 'project', targetId: 'p1', expected: ['n1'] },
  { relation: 'uses_protocol', targetType: 'protocol', targetId: 'pr1', expected: ['n1'] },
  { relation: 'uses_instrument', targetType: 'instrument', targetId: 'i1', expected: ['n1'] },
  { relation: 'links_notebook_page', targetType: 'notebook_entry', targetId: 'n1', expected: [] },
  { relation: '', targetType: 'project', targetId: 'p1', expected: [] },
  { relation: 'uses_project', targetType: '', targetId: 'p1', expected: [] },
  { relation: 'uses_project', targetType: 'project', targetId: '', expected: [] },
  { relation: 'uses_project', targetType: 'project', targetId: 'missing', expected: [] },
  { relation: 'uses_sample', targetType: 'sample', targetId: 'missing', expected: [] },
  { relation: 'uses_reagent_lot', targetType: 'reagent_lot', targetId: 'lot-42', expected: ['n1'] },
  { relation: 'performed_by', targetType: 'person', targetId: 'm1', expected: ['n1'] },
  { relation: 'references_paper', targetType: 'paper', targetId: 'pa1', expected: ['n1'] }
].forEach((item, idx) => {
  test(`[EDGE] queryNotebookEntriesByRelation matrix case ${idx + 1}`, () => {
    const state = buildObjectGraphFixture();
    const rows = objectGraph.queryNotebookEntriesByRelation(state, item);
    assert.equal(JSON.stringify(rows.map((row) => row.id)), JSON.stringify(item.expected));
  });
});

[
  ['i1', '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z', 1],
  ['i1', '2026-01-14T23:59:59.000Z', '2026-01-15T00:00:00.000Z', 1],
  ['i1', '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:01.000Z', 1],
  ['i1', '2026-01-15T00:00:01.000Z', '2026-01-16T00:00:00.000Z', 0],
  ['i1', '2026-01-01T00:00:00.000Z', '2026-01-14T23:59:59.000Z', 0],
  ['missing', '2026-01-01T00:00:00.000Z', '2026-01-31T00:00:00.000Z', 0],
  ['i1', '2026-01-31T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0],
  ['i1', 'bad', '2026-01-01T00:00:00.000Z', 0],
  ['i1', '2026-01-01T00:00:00.000Z', 'bad', 0]
].forEach(([instrumentId, startIso, endIso, expectedCount], idx) => {
  test(`[EDGE] queryInstrumentUsageInRange boundary case ${idx + 1}`, () => {
    const state = buildObjectGraphFixture();
    const rows = objectGraph.queryInstrumentUsageInRange(state, instrumentId, startIso, endIso);
    assert.equal(rows.length, expectedCount);
  });
});

test('[EDGE] tool-box internal functions are exposed for unit tests', () => {
  [
    'toNumber',
    'concentrationToM',
    'concentrationFromM',
    'volumeToL',
    'volumeFromL',
    'massToG',
    'massFromG',
    'cleanNucleotideSequence',
    'translateDnaSequence',
    'cleanProteinSequence',
    'parseRestrictionSites',
    'reverseTranslateProteinSequence',
    'oligoTm',
    'linearRegression',
    'peptideStats',
    'renderChemicalOptions',
    'parseCrisprTargetsInput',
    'designCrisprGuides'
  ].forEach((name) => {
    assert.equal(typeof toolBox[name], 'function');
  });
});

test('[EDGE] sequence-viewer internal functions are exposed for unit tests', () => {
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
    'formatSelectedFeatureDetailHtml',
    'computeGcPercent',
    'countAmbiguousBases',
    'summarizeFastqQuality'
  ].forEach((name) => {
    assert.equal(typeof sequenceViewerInternals[name], 'function');
  });
});

test('[EDGE] sequence-viewer parseFastaRecords parses multi-record input', () => {
  const parsed = sequenceViewerInternals.parseFastaRecords(`
>alpha record
ACGTNN
>beta
ttggcc
`);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].name, 'alpha');
  assert.equal(parsed.records[0].sequence, 'ACGTNN');
  assert.equal(parsed.records[1].name, 'beta');
  assert.equal(parsed.records[1].sequence, 'TTGGCC');
});

test('[EDGE] sequence-viewer parseFastqRecords parses reads and validates quality length', () => {
  const parsed = sequenceViewerInternals.parseFastqRecords(`
@read_1
ACGT
+
IIII
@read_2
TTAA
+
####
`);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].name, 'read_1');
  assert.equal(parsed.records[0].quality, 'IIII');
  assert.equal(parsed.records[1].sequence, 'TTAA');

  const invalid = sequenceViewerInternals.parseFastqRecords(`
@bad
ACGT
+
II
`);
  assert.equal(invalid.records.length, 0);
  assert.equal(invalid.errors.length > 0, true);
});

test('[EDGE] sequence-viewer parseGenBankRecords parses ORIGIN and feature locations', () => {
  const parsed = sequenceViewerInternals.parseGenBankRecords(`
LOCUS       TESTSEQ        12 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     CDS             complement(join(10..12,1..3))
                     /label="cds_a"
     promoter        4..8
                     /label="prom_a"
ORIGIN
        1 acgtttggccaa
//
`);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].sequence, 'ACGTTTGGCCAA');
  assert.equal(parsed.records[0].features.length, 2);
  assert.equal(parsed.records[0].features[0].name, 'cds_a');
  assert.equal(parsed.records[0].features[0].strand, -1);
  assert.equal(
    JSON.stringify(parsed.records[0].features[0].segments),
    JSON.stringify([{ start: 9, end: 12 }, { start: 0, end: 3 }])
  );
});

test('[EDGE] sequence-viewer normalizeExternalPayload clamps segments and keeps metadata', () => {
  const normalized = sequenceViewerInternals.normalizeExternalPayload({
    name: 'Example payload',
    sequence: 'acgtacgt',
    topology: 'circular',
    source: 'plannotate',
    features: [
      {
        name: 'hit1',
        type: 'CDS',
        strand: -1,
        source: 'plannotate',
        segments: [{ start: -5, end: 4 }, { start: 6, end: 999 }]
      }
    ]
  });

  assert.equal(normalized.name, 'Example payload');
  assert.equal(normalized.sequence, 'ACGTACGT');
  assert.equal(normalized.topology, 'circular');
  assert.equal(normalized.features.length, 1);
  assert.equal(normalized.features[0].strand, -1);
  assert.equal(
    JSON.stringify(normalized.features[0].segments),
    JSON.stringify([{ start: 0, end: 4 }, { start: 6, end: 8 }])
  );
});

test('[EDGE] sequence-viewer complement mapping handles canonical and ambiguous bases', () => {
  assert.equal(sequenceViewerInternals.complementBase('A'), 'T');
  assert.equal(sequenceViewerInternals.complementBase('C'), 'G');
  assert.equal(sequenceViewerInternals.complementBase('R'), 'Y');
  assert.equal(sequenceViewerInternals.complementBase('Z'), 'N');
  assert.equal(sequenceViewerInternals.complementSequence('ACGTRYN'), 'TGCAYRN');
});

test('[EDGE] sequence-viewer dual-strand renderer shows 5/3 orientation and paired highlights', () => {
  const html = sequenceViewerInternals.renderDualStrandSequenceLinesHtml('ACGTAC', [{ start: 1, end: 4 }]);
  assert.match(html, /sequence-viewer-strand-row-top/);
  assert.match(html, /sequence-viewer-strand-row-bottom/);
  assert.match(html, /5'/);
  assert.match(html, /3'/);
  assert.match(html, /CGT/);
  assert.match(html, /GCA/);
  const highlightCount = (html.match(/sequence-viewer-seq-highlight/g) || []).length;
  assert.equal(highlightCount, 2);
});

test('[EDGE] sequence-viewer feature detail formatter includes core metadata', () => {
  const html = sequenceViewerInternals.formatSelectedFeatureDetailHtml({
    name: 'ori',
    type: 'origin',
    strand: -1,
    identity: 99.12,
    coverage: 87.56,
    source: 'plannotate',
    segments: [{ start: 0, end: 4 }]
  }, 8);
  assert.match(html, /ori/);
  assert.match(html, /origin/);
  assert.match(html, /Strand:<\/strong> -/);
  assert.match(html, /99.12%/);
  assert.match(html, /87.56%/);
});

test('[EDGE] sequence-viewer bottom-track click updates selected feature detail strip', () => {
  const ids = [
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'modules', 'sequence-viewer.js'),
    { document }
  );
  const viewer = moduleWithDom.initSequenceViewer();
  viewer.loadFromExternal({
    name: 'test',
    sequence: 'ACGTACGT',
    source: 'plannotate',
    features: [
      {
        name: 'Feature_A',
        type: 'promoter',
        strand: 1,
        source: 'plannotate',
        segments: [{ start: 1, end: 5 }]
      }
    ]
  });

  const detail = document.getElementById('sequence-viewer-feature-detail');
  assert.match(detail.innerHTML, /Select a feature/);

  trigger(document.getElementById('sequence-viewer-feature-rail-host'), 'click', {
    target: {
      closest() {
        return { dataset: { featureIndex: '0' } };
      }
    }
  });

  assert.match(detail.innerHTML, /Feature_A/);
  assert.match(detail.innerHTML, /promoter/);
});

[
  ['0', 0],
  ['1', 1],
  ['1.5', 1.5],
  ['-2.5', -2.5],
  ['1e3', 1000],
  ['', 0],
  [' ', 0],
  ['abc', 0],
  [null, 0],
  [undefined, 0],
  [NaN, 0],
  [Infinity, 0],
  ['0x10', 16],
  [true, 1],
  [false, 0]
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box toNumber case ${idx + 1}`, () => {
    assert.equal(toolBox.toNumber(input), expected);
  });
});

[
  ['fM', 1e-15],
  ['pM', 1e-12],
  ['nM', 1e-9],
  ['uM', 1e-6],
  ['mM', 1e-3],
  ['M', 1]
].forEach(([unit, factor]) => {
  [-3, -1, 0, 0.25, 2, 10].forEach((value, idx) => {
    test(`[EDGE] tool-box concentration roundtrip ${unit} value case ${idx + 1}`, () => {
      const inM = toolBox.concentrationToM(value, unit);
      assertClose(inM, value * factor, 1e-12);
      const back = toolBox.concentrationFromM(inM, unit);
      assertClose(back, value, 1e-9);
    });
  });
});

[
  ['uL', 1e-6],
  ['mL', 1e-3],
  ['L', 1]
].forEach(([unit, factor]) => {
  [-2, -1, 0, 0.5, 2, 100].forEach((value, idx) => {
    test(`[EDGE] tool-box volume roundtrip ${unit} value case ${idx + 1}`, () => {
      const inL = toolBox.volumeToL(value, unit);
      assertClose(inL, value * factor, 1e-12);
      const back = toolBox.volumeFromL(inL, unit);
      assertClose(back, value, 1e-9);
    });
  });
});

[
  ['ug', 1e-6],
  ['mg', 1e-3],
  ['g', 1],
  ['kg', 1e3]
].forEach(([unit, factor]) => {
  [-1, 0, 0.1, 1, 12.5].forEach((value, idx) => {
    test(`[EDGE] tool-box mass roundtrip ${unit} value case ${idx + 1}`, () => {
      const inG = toolBox.massToG(value, unit);
      assertClose(inG, value * factor, 1e-9);
      const back = toolBox.massFromG(inG, unit);
      assertClose(back, value, 1e-9);
    });
  });
});

[
  ['ACGT', 'DNA', 'ACGT'],
  ['acgt', 'DNA', 'ACGT'],
  ['acgu', 'DNA', 'ACGT'],
  ['acgt', 'RNA', 'ACGU'],
  ['acgu', 'RNA', 'ACGU'],
  ['A C-G_T', 'DNA', 'ACGT'],
  ['NNNACGTNN', 'DNA', 'ACGT'],
  ['NNNACGUNN', 'RNA', 'ACGU'],
  ['ttrryy', 'DNA', 'TT'],
  ['uuxxyy', 'RNA', 'UU'],
  ['123456', 'DNA', ''],
  [null, 'DNA', ''],
  [undefined, 'RNA', ''],
  ['ATUG', 'RNA', 'AUUG'],
  ['ATUG', 'DNA', 'ATTG']
].forEach(([raw, type, expected], idx) => {
  test(`[EDGE] tool-box cleanNucleotideSequence case ${idx + 1}`, () => {
    assert.equal(toolBox.cleanNucleotideSequence(raw, type), expected);
  });
});

[
  ['ATGC', 'GCAT'],
  ['AAAA', 'TTTT'],
  ['CCCC', 'GGGG'],
  ['NNNN', 'NNNN'],
  ['', ''],
  ['ATGX', 'NCAT']
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box reverseComplementDna case ${idx + 1}`, () => {
    assert.equal(toolBox.reverseComplementDna(input), expected);
  });
});

[
  { seq: 'ATGGCC', frame: 1, stopMode: 'star', protein: 'MA', codons: 2, strand: '+', remainder: 0 },
  { seq: 'ATGGCC', frame: 2, stopMode: 'star', protein: 'W', codons: 1, strand: '+', remainder: 2 },
  { seq: 'ATGGCC', frame: 3, stopMode: 'star', protein: 'G', codons: 1, strand: '+', remainder: 1 },
  { seq: 'ATGTAAATG', frame: 1, stopMode: 'trim', protein: 'M', codons: 2, strand: '+', remainder: 0 },
  { seq: 'ATGTAAATG', frame: 1, stopMode: 'star', protein: 'M*M', codons: 3, strand: '+', remainder: 0 },
  { seq: 'ATGAAA', frame: -1, stopMode: 'star', protein: 'FH', codons: 2, strand: '-', remainder: 0 },
  { seq: 'ATGAAA', frame: -2, stopMode: 'star', protein: 'F', codons: 1, strand: '-', remainder: 2 }
].forEach((scenario, idx) => {
  test(`[EDGE] tool-box translateDnaSequence case ${idx + 1}`, () => {
    const result = toolBox.translateDnaSequence(scenario.seq, scenario.frame, scenario.stopMode);
    assert.equal(result.protein, scenario.protein);
    assert.equal(result.codons, scenario.codons);
    assert.equal(result.strand, scenario.strand);
    assert.equal(result.remainderBases, scenario.remainder);
  });
});

[
  ['m k*t1', true, 'MK*T'],
  ['m k*t1', false, 'MKT'],
  ['bjouxz*', true, 'BJOUXZ*'],
  ['', true, ''],
  [null, true, '']
].forEach(([input, allowStop, expected], idx) => {
  test(`[EDGE] tool-box cleanProteinSequence case ${idx + 1}`, () => {
    assert.equal(toolBox.cleanProteinSequence(input, allowStop), expected);
  });
});

[
  ['gaattc AAGCTT ggtctc', ['GAATTC', 'AAGCTT', 'GGTCTC'], []],
  ['EcoRI NNNN atg', ['ATG'], ['ECORI', 'NNNN']],
  ['', [], []]
].forEach(([input, expectedSites, expectedIgnored], idx) => {
  test(`[EDGE] tool-box parseRestrictionSites case ${idx + 1}`, () => {
    const parsed = toolBox.parseRestrictionSites(input);
    assert.equal(JSON.stringify(parsed.sites), JSON.stringify(expectedSites));
    assert.equal(JSON.stringify(parsed.ignoredTokens), JSON.stringify(expectedIgnored));
  });
});

test('[EDGE] tool-box parseRestrictionSites expands reverse complement motifs', () => {
  const parsed = toolBox.parseRestrictionSites('GGTCTC');
  assert.equal(parsed.expandedSites.includes('GGTCTC'), true);
  assert.equal(parsed.expandedSites.includes('GAGACC'), true);
});

test('[EDGE] tool-box reverseTranslateProteinSequence basic translation is valid', () => {
  const result = toolBox.reverseTranslateProteinSequence('MRA', { organism: 'ecoli' });
  assert.equal(result.ok, true);
  assert.equal(result.dna.length, 9);
  assert.equal(toolBox.translateDnaSequence(result.dna, 1, 'star').protein, 'MRA');
});

test('[EDGE] tool-box reverseTranslateProteinSequence reflects organism codon preferences', () => {
  const ecoli = toolBox.reverseTranslateProteinSequence('RRR', { organism: 'ecoli' });
  const yeast = toolBox.reverseTranslateProteinSequence('RRR', { organism: 'yeast' });
  assert.equal(ecoli.ok, true);
  assert.equal(yeast.ok, true);
  assert.notEqual(ecoli.dna, yeast.dna);
});

[
  'mouse',
  'rat',
  'pichia',
  'arabidopsis',
  'drosophila',
  'c_elegans',
  'zebrafish',
  'pseudomonas',
  'salmonella'
].forEach((organismKey, idx) => {
  test(`[EDGE] tool-box reverseTranslateProteinSequence supports extra species case ${idx + 1}`, () => {
    const result = toolBox.reverseTranslateProteinSequence('MRT', { organism: organismKey });
    assert.equal(result.ok, true);
    assert.equal(result.organism, organismKey);
    assert.equal(toolBox.translateDnaSequence(result.dna, 1, 'star').protein, 'MRT');
  });
});

test('[EDGE] tool-box reverseTranslateProteinSequence applies new species codon preferences', () => {
  const ecoli = toolBox.reverseTranslateProteinSequence('KKK', { organism: 'ecoli' });
  const pseudomonas = toolBox.reverseTranslateProteinSequence('KKK', { organism: 'pseudomonas' });
  assert.equal(ecoli.ok, true);
  assert.equal(pseudomonas.ok, true);
  assert.notEqual(ecoli.dna, pseudomonas.dna);
});

test('[EDGE] tool-box reverseTranslateProteinSequence can avoid a requested restriction site', () => {
  const unconstrained = toolBox.reverseTranslateProteinSequence('EF', { organism: 'ecoli' });
  const constrained = toolBox.reverseTranslateProteinSequence('EF', {
    organism: 'ecoli',
    restrictionSites: ['GAATTC']
  });

  assert.equal(unconstrained.ok, true);
  assert.equal(constrained.ok, true);
  assert.equal(unconstrained.dna.includes('GAATTC'), true);
  assert.equal(constrained.dna.includes('GAATTC'), false);
  assert.equal(toolBox.translateDnaSequence(constrained.dna, 1, 'star').protein, 'EF');
});

test('[EDGE] tool-box reverseTranslateProteinSequence reports impossible restriction constraints', () => {
  const blocked = toolBox.reverseTranslateProteinSequence('M', {
    organism: 'ecoli',
    restrictionSites: ['ATG']
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'restriction_conflict');
  assert.equal(blocked.blockedPosition, 1);
});

test('[EDGE] tool-box reverseTranslateProteinSequence appends stop codon when requested', () => {
  const withStop = toolBox.reverseTranslateProteinSequence('MA', {
    organism: 'ecoli',
    appendStopCodon: true
  });
  assert.equal(withStop.ok, true);
  assert.equal(withStop.protein, 'MA*');
  assert.equal(toolBox.translateDnaSequence(withStop.dna, 1, 'star').protein, 'MA*');

  const alreadyStopped = toolBox.reverseTranslateProteinSequence('MA*', {
    organism: 'ecoli',
    appendStopCodon: true
  });
  assert.equal(alreadyStopped.ok, true);
  assert.equal(alreadyStopped.protein, 'MA*');
  assert.equal(toolBox.translateDnaSequence(alreadyStopped.dna, 1, 'star').protein, 'MA*');
});

test('[EDGE] tool-box reverseTranslateProteinSequence rejects unsupported amino acids', () => {
  const result = toolBox.reverseTranslateProteinSequence('MX');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported_residue');
  assert.equal(result.unsupportedResidues.includes('X'), true);
});

[
  ['A', 'DNA', 313.21, 15400],
  ['AT', 'DNA', 617.41, 24100],
  ['AU', 'RNA', 635.38, 25300],
  ['GGCC', 'DNA', (329.21 * 2) + (289.18 * 2), (11500 * 2) + (7400 * 2)]
].forEach(([sequence, type, mwExpected, extExpected], idx) => {
  test(`[EDGE] tool-box oligo properties case ${idx + 1}`, () => {
    assertClose(toolBox.oligoMolecularWeight(sequence, type), mwExpected, 1e-4);
    assert.equal(toolBox.oligoExtinction(sequence, type), extExpected);
  });
});

[
  ['ATGC', 'DNA', 12],
  ['ATGCGCATATGCAT', 'DNA', 64.9 + (41 * (6 - 16.4)) / 14],
  ['AUGC', 'RNA', 12],
  ['', 'DNA', 0]
].forEach(([sequence, type, expected], idx) => {
  test(`[EDGE] tool-box oligoTm case ${idx + 1}`, () => {
    assertClose(toolBox.oligoTm(sequence, type), expected, 1e-6);
  });
});

[
  [[1, 2, 3], [2, 4, 6], { slope: 2, intercept: 0, rSquared: 1 }],
  [[1, 2, 3], [3, 2, 1], { slope: -1, intercept: 4, rSquared: 1 }],
  [[1, 1, 1], [2, 3, 4], null],
  [[1], [2], null],
  [[], [], null]
].forEach(([xValues, yValues, expected], idx) => {
  test(`[EDGE] tool-box linearRegression case ${idx + 1}`, () => {
    const result = toolBox.linearRegression(xValues, yValues);
    if (!expected) {
      assert.equal(result, null);
      return;
    }
    assertClose(result.slope, expected.slope, 1e-9);
    assertClose(result.intercept, expected.intercept, 1e-9);
    assertClose(result.rSquared, expected.rSquared, 1e-9);
  });
});

[
  ['a b-c_d', 'ABCD'],
  ['123abc', 'ABC'],
  ['a\nb\tc', 'ABC'],
  ['', ''],
  [null, '']
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box cleanSequence case ${idx + 1}`, () => {
    assert.equal(toolBox.cleanSequence(input), expected);
  });
});

[
  ['AAAB', { A: 3, B: 1 }],
  ['', {}],
  ['XYZ', { X: 1, Y: 1, Z: 1 }]
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box countResidues case ${idx + 1}`, () => {
    assert.equal(JSON.stringify(toolBox.countResidues(input)), JSON.stringify(expected));
  });
});

[
  ['', 0],
  ['A', 71.08 + 18.015],
  ['AC', 71.08 + 103.15 + 18.015],
  ['Z', 18.015]
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box calculatePeptideMass case ${idx + 1}`, () => {
    assertClose(toolBox.calculatePeptideMass(input), expected, 1e-6);
  });
});

[
  ['KRR', 7, true],
  ['DEE', 7, false],
  ['AAAA', 7, false]
].forEach(([sequence, ph, isPositive], idx) => {
  test(`[EDGE] tool-box calculateNetCharge sign case ${idx + 1}`, () => {
    const charge = toolBox.calculateNetCharge(sequence, ph);
    assert.equal(isPositive ? charge > 0 : charge < 0, true);
  });
});

[
  ['', 0],
  ['KRR', 0],
  ['DEE', 0],
  ['ACDEFGHIKLMNPQRSTVWY', 0]
].forEach(([sequence], idx) => {
  test(`[EDGE] tool-box estimatePI bounds case ${idx + 1}`, () => {
    const value = toolBox.estimatePI(sequence);
    assert.equal(value >= 0, true);
    assert.equal(value <= 14, true);
  });
});

[
  [{ C: 1, A: 2, B: 3 }, 'A:2  B:3  C:1'],
  [{}, '']
].forEach(([counts, expected], idx) => {
  test(`[EDGE] tool-box residueSummary case ${idx + 1}`, () => {
    assert.equal(toolBox.residueSummary(counts), expected);
  });
});

[
  ['ACDE', 4],
  ['WWYYCC', 6],
  ['', 0],
  ['ABCXYZ', 6]
].forEach(([sequence, expectedLength], idx) => {
  test(`[EDGE] tool-box peptideStats case ${idx + 1}`, () => {
    const stats = toolBox.peptideStats(sequence);
    assert.equal(stats.length, expectedLength);
    assert.equal(typeof stats.mass, 'number');
    assert.equal(Array.isArray(stats.invalidResidues), true);
  });
});

test('[EDGE] tool-box renderChemicalOptions includes Custom option', () => {
  const html = toolBox.renderChemicalOptions();
  assert.match(html, /Custom<\/option>/);
  assert.match(html, /<option value="[^"]+">/);
});

test('[EDGE] tool-box parseCrisprTargetsInput parses FASTA entries and normalizes sequence', () => {
  const parsed = toolBox.parseCrisprTargetsInput(`
>Target_A
ACGTNNNN
>Target_B
acgu---
`);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'Target_A');
  assert.equal(parsed[0].sequence, 'ACGTNNNN');
  assert.equal(parsed[1].name, 'Target_B');
  assert.equal(parsed[1].sequence, 'ACGT');
});

test('[EDGE] tool-box collectCrisprPamSites finds forward NGG protospacers', () => {
  const target = {
    id: 'target-1',
    name: 'Target 1',
    sequence: 'ATATATATAGGAAAA'
  };
  const sites = toolBox.collectCrisprPamSites(target, 4, 'NGG');
  assert.equal(sites.length, 1);
  assert.equal(sites[0].strand, '+');
  assert.equal(sites[0].guideSequence, 'ATAT');
  assert.equal(sites[0].pamSequence, 'AGG');
  assert.equal(sites[0].start, 5);
  assert.equal(sites[0].end, 8);
});

test('[EDGE] tool-box computeCrisprOffTargetStats buckets mismatch counts', () => {
  const candidate = {
    key: 'k1',
    guideSequence: 'AAAAAAAAAAAAAAAAAAAA'
  };
  const background = [
    { key: 'k1', guideSequence: 'AAAAAAAAAAAAAAAAAAAA' },
    { key: 'k2', guideSequence: 'AAAAAAAAAAAAAAAAAAAA' },
    { key: 'k3', guideSequence: 'CAAAAAAAAAAAAAAAAAAA' },
    { key: 'k4', guideSequence: 'CCAAAAAAAAAAAAAAAAAA' },
    { key: 'k5', guideSequence: 'CCCAAAAAAAAAAAAAAAAA' },
    { key: 'k6', guideSequence: 'CCCCAAAAAAAAAAAAAAAA' }
  ];
  const stats = toolBox.computeCrisprOffTargetStats(candidate, background, 1);
  assert.equal(stats.mismatchCounts.exact, 1);
  assert.equal(stats.mismatchCounts.mismatch1, 1);
  assert.equal(stats.mismatchCounts.mismatch2, 1);
  assert.equal(stats.mismatchCounts.mismatch3, 1);
  assertClose(stats.offTargetRate, 27.84, 1e-9);
  assertClose(stats.specificityScore, 72.16, 1e-9);
});

test('[EDGE] tool-box designCrisprGuides returns ranked sgRNA candidates', () => {
  const selectedTargets = [{
    id: 'target-1',
    name: 'Target 1',
    sequence: 'ATATATATAGGAAAA'
  }];
  const result = toolBox.designCrisprGuides({
    selectedTargets,
    backgroundTargets: selectedTargets,
    guideLength: 4,
    pamPattern: toolBox.normalizeIupacPattern('NGG'),
    minGc: 0,
    maxGc: 100,
    topCount: 10,
    genomeMultiplier: 1
  });
  assert.equal(result.totalPamMatches, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].guideSequence, 'ATAT');
  assert.equal(result.candidates[0].pamSequence, 'AGG');
  assertClose(result.candidates[0].offTargetRate, 0, 1e-9);
  assertClose(result.candidates[0].specificityScore, 100, 1e-9);
});

test('[EDGE] tool-box designCrisprGuides respects GC filtering', () => {
  const selectedTargets = [{
    id: 'target-1',
    name: 'Target 1',
    sequence: 'ATATATATAGGAAAA'
  }];
  const result = toolBox.designCrisprGuides({
    selectedTargets,
    backgroundTargets: selectedTargets,
    guideLength: 4,
    pamPattern: toolBox.normalizeIupacPattern('NGG'),
    minGc: 50,
    maxGc: 100,
    topCount: 10,
    genomeMultiplier: 1
  });
  assert.equal(result.totalPamMatches, 1);
  assert.equal(result.filteredCandidateCount, 0);
  assert.equal(result.candidates.length, 0);
});

test('[EDGE] gel-analysis internal functions are exposed for unit tests', () => {
  [
    'clamp',
    'round',
    'mean',
    'confidenceLabel',
    'normalizeManualOverrides',
    'safeFilePart',
    'escapeCsv',
    'computeHistogramPercentiles',
    'normalizeArrayRange',
    'buildGaussianKernel',
    'gaussianBlur2d',
    'linearRegression',
    'buildCalibration',
    'applyNormalization',
    'clusterBandsAcrossLanes',
    'computeLaneConfidence',
    'interpretLane'
  ].forEach((name) => {
    assert.equal(typeof gelAnalysisInternals[name], 'function');
  });
});

[
  [0, 0, 10, 0],
  [5, 0, 10, 5],
  [-1, 0, 10, 0],
  [11, 0, 10, 10],
  [3.3, 0, 4, 3.3],
  [NaN, 0, 4, NaN]
].forEach(([value, min, max, expected], idx) => {
  test(`[EDGE] gel-analysis clamp case ${idx + 1}`, () => {
    const result = gelAnalysisInternals.clamp(value, min, max);
    if (Number.isNaN(expected)) {
      assert.equal(Number.isNaN(result), true);
      return;
    }
    assert.equal(result, expected);
  });
});

[
  [1.23456, 2, 1.23],
  [1.23556, 2, 1.24],
  [-1.23556, 2, -1.24],
  [0, 4, 0],
  [Infinity, 2, null],
  [NaN, 2, null]
].forEach(([value, digits, expected], idx) => {
  test(`[EDGE] gel-analysis round case ${idx + 1}`, () => {
    assert.equal(gelAnalysisInternals.round(value, digits), expected);
  });
});

[
  [[], 0],
  [[1], 1],
  [[1, 2, 3], 2],
  [[-1, 1], 0]
].forEach(([values, expected], idx) => {
  test(`[EDGE] gel-analysis mean case ${idx + 1}`, () => {
    assertClose(gelAnalysisInternals.mean(values), expected, 1e-9);
  });
});

[
  [0.9, 'high'],
  [0.75, 'high'],
  [0.74, 'medium'],
  [0.5, 'medium'],
  [0.49, 'low'],
  [0, 'low']
].forEach(([score, expected], idx) => {
  test(`[EDGE] gel-analysis confidenceLabel case ${idx + 1}`, () => {
    assert.equal(gelAnalysisInternals.confidenceLabel(score), expected);
  });
});

test('[EDGE] gel-analysis createEmptyManualOverrides baseline shape', () => {
  const value = gelAnalysisInternals.createEmptyManualOverrides();
  assert.equal(JSON.stringify(Object.keys(value).sort()), JSON.stringify(['addedBands', 'ladderBands', 'ladderBandsDone', 'ladderLane', 'laneSegmentation']));
  assert.equal(Array.isArray(value.laneSegmentation.dividers), true);
  assert.equal(value.laneSegmentation.dividers.length, 0);
});

[
  {
    raw: {
      laneSegmentation: {
        gelLeft: '10.9',
        gelRight: '100.3',
        dividers: [30, '30', 50, -3, 120, 50],
        dividerDone: 'yes',
        bandTop: '5',
        bandBottom: '20'
      },
      addedBands: [{ laneIndex: '2', pixelY: '33.2' }, { laneIndex: -1, pixelY: 5 }],
      ladderLane: '3',
      ladderBands: [{ pixelY: 80.2, mw: 50 }, { pixelY: 10.2, mw: 150 }, { pixelY: 2, mw: 0 }],
      ladderBandsDone: 1
    },
    expectation: (value) => {
      assert.equal(value.laneSegmentation.gelLeft, 10);
      assert.equal(value.laneSegmentation.gelRight, 100);
      assert.equal(JSON.stringify(value.laneSegmentation.dividers), JSON.stringify([30, 50, 120]));
      assert.equal(value.addedBands.length, 2);
      assert.equal(value.ladderLane, 3);
      assert.equal(JSON.stringify(value.ladderBands.map((item) => item.mw)), JSON.stringify([150, 50]));
      assert.equal(value.ladderBandsDone, true);
    }
  },
  {
    raw: null,
    expectation: (value) => {
      assert.deepEqual(value, gelAnalysisInternals.createEmptyManualOverrides());
    }
  }
].forEach((scenario, idx) => {
  test(`[EDGE] gel-analysis normalizeManualOverrides case ${idx + 1}`, () => {
    const value = gelAnalysisInternals.normalizeManualOverrides(scenario.raw);
    scenario.expectation(value);
  });
});

[
  [' file name ', 'fallback', 'file-name'],
  ['***', 'fallback', 'fallback'],
  ['a/b/c', 'fallback', 'a-b-c'],
  ['A__B', 'fallback', 'A__B'],
  ['', 'fallback', 'fallback']
].forEach(([raw, fallback, expected], idx) => {
  test(`[EDGE] gel-analysis safeFilePart case ${idx + 1}`, () => {
    assert.equal(gelAnalysisInternals.safeFilePart(raw, fallback), expected);
  });
});

[
  ['a,b', '"a,b"'],
  ['a"b', '"a""b"'],
  ['line\nbreak', '"line\nbreak"'],
  ['plain', 'plain'],
  [null, '']
].forEach(([value, expected], idx) => {
  test(`[EDGE] gel-analysis escapeCsv case ${idx + 1}`, () => {
    assert.equal(gelAnalysisInternals.escapeCsv(value), expected);
  });
});

[
  new Float32Array(100).fill(0),
  new Float32Array(100).fill(1),
  Float32Array.from({ length: 100 }, (_, i) => i / 99),
  Float32Array.from({ length: 100 }, (_, i) => (i % 2 ? 1 : 0))
].forEach((data, idx) => {
  test(`[EDGE] gel-analysis histogram percentile shape case ${idx + 1}`, () => {
    const { low, high } = gelAnalysisInternals.computeHistogramPercentiles(data, 2, 98);
    assert.equal(low >= 0 && low <= 1, true);
    assert.equal(high >= 0 && high <= 1, true);
    assert.equal(high >= low, true);
  });
});

[
  new Float32Array(32).fill(0.5),
  Float32Array.from({ length: 32 }, (_, i) => i / 31),
  Float32Array.from({ length: 32 }, (_, i) => ((i % 5) / 4))
].forEach((data, idx) => {
  test(`[EDGE] gel-analysis normalizeArrayRange bounds case ${idx + 1}`, () => {
    const out = gelAnalysisInternals.normalizeArrayRange(data);
    assert.equal(out.length, data.length);
    out.forEach((value) => {
      assert.equal(value >= 0 && value <= 1, true);
    });
  });
});

[
  0.01,
  0.1,
  0.5,
  1,
  2
].forEach((sigma, idx) => {
  test(`[EDGE] gel-analysis buildGaussianKernel case ${idx + 1}`, () => {
    const { kernel, radius } = gelAnalysisInternals.buildGaussianKernel(sigma);
    assert.equal(kernel.length, (radius * 2) + 1);
    const sum = [...kernel].reduce((acc, value) => acc + value, 0);
    assertClose(sum, 1, 1e-5);
  });
});

[
  { width: 4, height: 4, sigma: 1.2, value: 0.7 },
  { width: 5, height: 3, sigma: 0.8, value: 0.2 }
].forEach((scenario, idx) => {
  test(`[EDGE] gel-analysis gaussianBlur2d preserves constant field case ${idx + 1}`, () => {
    const data = new Float32Array(scenario.width * scenario.height).fill(scenario.value);
    const out = gelAnalysisInternals.gaussianBlur2d(data, scenario.width, scenario.height, scenario.sigma);
    out.forEach((value) => {
      assertClose(value, scenario.value, 1e-5);
    });
  });
});

[
  [[1, 2, 3], [2, 4, 6], 2, 0],
  [[1, 2, 3], [3, 2, 1], -1, 4],
  [[1], [2], null, null],
  [[1, 1, 1], [2, 3, 4], null, null]
].forEach(([xValues, yValues, slope, intercept], idx) => {
  test(`[EDGE] gel-analysis linearRegression case ${idx + 1}`, () => {
    const value = gelAnalysisInternals.linearRegression(xValues, yValues);
    if (slope === null) {
      assert.equal(value, null);
      return;
    }
    assertClose(value.slope, slope, 1e-9);
    assertClose(value.intercept, intercept, 1e-9);
    assert.equal(value.r2 >= 0 && value.r2 <= 1, true);
  });
});

test('[EDGE] gel-analysis buildCalibration supports manual ladder bands', () => {
  const result = gelAnalysisInternals.buildCalibration(
    [],
    1,
    [250, 150, 100],
    200,
    [
      { pixelY: 10, mw: 250 },
      { pixelY: 50, mw: 150 },
      { pixelY: 90, mw: 100 }
    ]
  );
  assert.equal(result.ok, true);
  assert.equal(result.manual, true);
  assert.equal(result.matchedPoints.length, 3);
});

test('[EDGE] gel-analysis buildCalibration auto-ladder fallback and failure modes', () => {
  const lanes = [
    {
      index: 0,
      bands: [
        { pixelY: 10 },
        { pixelY: 40 },
        { pixelY: 80 }
      ]
    }
  ];
  const ok = gelAnalysisInternals.buildCalibration(lanes, 1, [250, 150, 100], 200, []);
  assert.equal(ok.ok, true);
  assert.equal(ok.manual, false);

  const fail = gelAnalysisInternals.buildCalibration([], 1, [250, 150, 100], 200, []);
  assert.equal(fail.ok, false);
});

test('[EDGE] gel-analysis applyCalibrationToBands sets estimatedMw', () => {
  const lanes = [{ bands: [{ pixelY: 10 }, { pixelY: 50 }] }];
  gelAnalysisInternals.applyCalibrationToBands(lanes, { ok: true, slope: -1, intercept: 2 }, 100);
  assert.equal(Number.isFinite(lanes[0].bands[0].estimatedMw), true);
  assert.equal(Number.isFinite(lanes[0].bands[1].estimatedMw), true);
});

[
  'max',
  'total-lane'
].forEach((mode, idx) => {
  test(`[EDGE] gel-analysis applyNormalization mode case ${idx + 1}`, () => {
    const lanes = [{
      bands: [
        { rawIntensity: 2 },
        { rawIntensity: 6 }
      ]
    }];
    gelAnalysisInternals.applyNormalization(lanes, mode);
    lanes[0].bands.forEach((band) => {
      assert.equal(band.normalizedIntensity === null || (band.normalizedIntensity >= 0 && band.normalizedIntensity <= 1), true);
    });
  });
});

[
  {
    hasMwCalibration: true,
    lanes: [
      { index: 0, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: 100, pixelY: 20 }] },
      { index: 1, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: 103, pixelY: 30 }] }
    ],
    minGroups: 1
  },
  {
    hasMwCalibration: false,
    lanes: [
      { index: 0, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: null, pixelY: 20 }] },
      { index: 1, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: null, pixelY: 22 }] },
      { index: 2, imageHeight: 100, bands: [{ bandIndex: 0, estimatedMw: null, pixelY: 80 }] }
    ],
    minGroups: 2
  }
].forEach((scenario, idx) => {
  test(`[EDGE] gel-analysis clusterBandsAcrossLanes case ${idx + 1}`, () => {
    const groups = gelAnalysisInternals.clusterBandsAcrossLanes(scenario.lanes, scenario.hasMwCalibration);
    assert.equal(groups.length >= scenario.minGroups, true);
    scenario.lanes.forEach((lane) => {
      lane.bands.forEach((band) => {
        assert.equal(typeof band.groupId, 'string');
        assert.equal(typeof band.groupLabel, 'string');
      });
    });
  });
});

test('[EDGE] gel-analysis computeLaneConfidence handles empty and populated lanes', () => {
  const empty = gelAnalysisInternals.computeLaneConfidence({ bands: [] }, 0.5);
  assertClose(empty.score, 0.25, 1e-9);
  assert.equal(empty.label, 'low');

  const populated = gelAnalysisInternals.computeLaneConfidence({
    bands: [
      { sharpness: 0.2, snr: 10, saturationFraction: 0.01 },
      { sharpness: 0.15, snr: 8, saturationFraction: 0.02 }
    ]
  }, 0.95);
  assert.equal(populated.score > 0.5, true);
  assert.equal(['medium', 'high'].includes(populated.label), true);
});

[
  {
    analysisType: 'sds-page',
    lane: { bands: [{ rawIntensity: 10 }, { rawIntensity: 9 }], rowActivityFraction: 0.5 },
    expectWarning: true
  },
  {
    analysisType: 'western',
    lane: { bands: [{ rawIntensity: 10, normalizedIntensity: 0.1 }], rowActivityFraction: 0.5 },
    expectWarning: true
  },
  {
    analysisType: 'agarose',
    lane: { bands: [{ rawIntensity: 10 }], rowActivityFraction: 0.1 },
    expectWarning: false
  }
].forEach((scenario, idx) => {
  test(`[EDGE] gel-analysis interpretLane case ${idx + 1}`, () => {
    const result = gelAnalysisInternals.interpretLane(scenario);
    assert.equal(Array.isArray(result.notes), true);
    assert.equal(Array.isArray(result.warnings), true);
    assert.equal(result.warnings.length > 0, scenario.expectWarning);
  });
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
