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

function loadEsmStyleModule(filePath, extraGlobals = {}) {
  const source = fs.readFileSync(filePath, 'utf8');
  const exportNames = new Set();

  let transformed = source
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
const mainUtils = require(path.join(__dirname, 'main-utils'));

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
