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
    'renderChemicalOptions'
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
const mainUtils = require(path.join(__dirname, 'main-utils'));
const telegramBot = require(path.join(__dirname, 'telegramBot.js'));
const forgeConfig = require(path.join(__dirname, 'forge.config.js'));
const packageManifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

const LEGACY_CHEMISTRY_DRAFT_KEY = 'enana_synthesis_chemistry_draft_v1';

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

  protocolLinkInput.value = 'invalid-link';
  trigger(importProtocolLinkBtn, 'click');
  assert.match(protocolLinkStatus.textContent, /Invalid protocol link/);
  assert.ok(persistCalls >= 3);
});

test('protocol-management supports draft creation, sharing, and delete cascades', () => {
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

  let persistCalls = 0;
  let importedCalls = 0;
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
    btoa: btoaPolyfill
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

test('view constants and index navigation stay in sync', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const viewValues = Object.values(shared.VIEWS);
  const sectionViews = new Set([...html.matchAll(/<section id=\"([^\"]+)\" class=\"view\"/g)].map((match) => match[1]));
  const navViews = new Set([...html.matchAll(/data-view=\"([^\"]+)\"/g)].map((match) => match[1]));

  const nonHomeViews = viewValues.filter((value) => value !== shared.VIEWS.HOME);
  const missingSections = nonHomeViews.filter((value) => !sectionViews.has(value));
  const missingNav = nonHomeViews.filter((value) => !navViews.has(value));
  const unknownNav = [...navViews].filter((value) => !viewValues.includes(value));

  assert.deepEqual(missingSections, []);
  assert.deepEqual(missingNav, []);
  assert.deepEqual(unknownNav, []);
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

test('[P1] normalizeState migrates legacy endpoint from llm.api URL', () => {
  const normalized = shared.normalizeState({ settings: { llm: { api: 'https://example.com/v1' } } });
  assert.equal(normalized.settings.llm.apiEndpoint, 'https://example.com/v1');
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
  ['modules/shared.js', /LAB_NOTEBOOK/],
  ['telegramBot.js', /telegram-message/],
  ['preload.js', /onTelegramMessage/],
  ['ketcher-embedded.html', /\/Users\//],
  ['ketcher-embedded.html', /file:\/\//],
  ['index.html', /lab-notebook-view/],
  ['renderer.js', /VIEWS\.LAB_NOTEBOOK/],
  ['Readme.md', /project_root\//],
  ['forge.config.js', /enana-data/],
  ['package.json', /"dist": "electron-forge make"/],
  ['package.json', /"package:app": "electron-forge package"/],
  ['modules/agent-chat.js', /apiKey: String\(state\.settings\?\.llm\?\.apiKey/]
];

removedCodeGuards.forEach(([relativePath, pattern], idx) => {
  test(`[P1] regression guard case ${idx + 1} (${relativePath})`, () => {
    const source = readSource(relativePath);
    if (idx <= 7) {
      assert.equal(pattern.test(source), false);
      return;
    }
    assert.equal(pattern.test(source), true);
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

nonHomeViews.forEach((viewId) => {
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

[
  ['Readme.md', /npm install/],
  ['Readme.md', /npm test/],
  ['Readme.md', /npm run dist/],
  ['Readme.md', /Installer outputs are generated under `out\/make\/`/],
  ['Readme.md', /Static frontend assets are loaded with app-relative paths/]
].forEach(([relativePath, pattern], idx) => {
  test(`[P2] docs install guidance case ${idx + 1}`, () => {
    assert.match(readSource(relativePath), pattern);
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
    'oligoTm',
    'linearRegression',
    'peptideStats',
    'renderChemicalOptions'
  ].forEach((name) => {
    assert.equal(typeof toolBox[name], 'function');
  });
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
