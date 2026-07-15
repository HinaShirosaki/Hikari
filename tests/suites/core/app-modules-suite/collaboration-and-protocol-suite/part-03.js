module.exports = function registerAppCollaborationAndProtocolSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
    'protocol-sort-menu-btn',
    'protocol-sort-menu'
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
    settings: { personalInfo: { hikariEmail: '' } }
  };

  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol', 'index.js'), {
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
test('protocol-management applies a selected combined sort option from the icon menu', () => {
  const document = createMockDocument([
    'protocol-list',
    'protocol-sort-menu-btn',
    'protocol-sort-menu'
  ]);
  const protocolSortMenu = document.getElementById('protocol-sort-menu');
  protocolSortMenu.hidden = true;
  const state = {
    protocols: [
      {
        id: 'protocol-zulu',
        name: 'Zulu Protocol',
        purpose: '',
        materials: [],
        steps: [],
        troubleshooting: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'protocol-alpha',
        name: 'Alpha Protocol',
        purpose: '',
        materials: [],
        steps: [],
        troubleshooting: '',
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z'
      }
    ],
    notebookEntries: [],
    workflows: [],
    workflowTemplates: [],
    assays: [],
    gelAnalyses: [],
    messages: [],
    members: [],
    settings: { personalInfo: { hikariEmail: '' } }
  };
  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol', 'index.js'), {
    document,
    TextEncoder,
    btoa: btoaPolyfill
  });
  const protocol = protocolModule.initProtocolManagement({
    state,
    persist: () => {},
    createId: () => 'generated-id',
    safeText: shared.safeText,
    onProtocolsChanged: () => {},
    trackGrowthEvent: () => {}
  });

  const sortMenuBtn = document.getElementById('protocol-sort-menu-btn');
  trigger(sortMenuBtn, 'click');
  assert.equal(protocolSortMenu.hidden, false);
  assert.equal(sortMenuBtn.getAttribute('aria-expanded'), 'true');

  trigger(protocolSortMenu, 'click', { target: { dataset: { protocolSort: 'name:asc' } } });
  const protocolList = document.getElementById('protocol-list');
  assert.ok(protocolList.innerHTML.indexOf('Alpha Protocol') < protocolList.innerHTML.indexOf('Zulu Protocol'));
  assert.equal(protocolSortMenu.hidden, true);
  assert.equal(sortMenuBtn.getAttribute('aria-expanded'), 'false');

  trigger(protocolSortMenu, 'click', { target: { dataset: { protocolSort: 'time:desc' } } });
  assert.ok(protocolList.innerHTML.indexOf('Alpha Protocol') < protocolList.innerHTML.indexOf('Zulu Protocol'));

  trigger(protocolSortMenu, 'click', { target: { dataset: { protocolSort: 'time:asc' } } });
  assert.ok(protocolList.innerHTML.indexOf('Zulu Protocol') < protocolList.innerHTML.indexOf('Alpha Protocol'));

  trigger(protocolSortMenu, 'click', { target: { dataset: { protocolSort: 'name:desc' } } });
  assert.ok(protocolList.innerHTML.indexOf('Zulu Protocol') < protocolList.innerHTML.indexOf('Alpha Protocol'));
});
test('protocol polish sends sectioned draft text to the LLM instead of a protocol JSON envelope', async () => {
  const polishModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol', 'polish.js'));
  const sourceDraft = {
    id: 'protocol-draft-1',
    name: '',
    purpose: 'isolate nuclei from a cell pellet',
    materials: ['Cold PBS', 'Dounce homogenizer'],
    steps: [
      { id: 'step-1', text: 'wash pellet with cold PBS', placeholders: [] },
      { id: 'step-2', text: 'incubate on ice for [time]', placeholders: [] }
    ],
    troubleshooting: 'if pellet is loose, centrifuge again',
    createdAt: '2026-04-07T00:00:00.000Z',
    updatedAt: '2026-04-07T00:00:00.000Z'
  };
  let capturedPrompt = '';

  const controller = polishModule.createProtocolPolishController({
    state: { settings: { llm: {} } },
    ui: {
      protocolPolishBtn: { disabled: false, textContent: '' },
      protocolPolishApplyBtn: { disabled: false },
      protocolPolishOverlay: { hidden: true },
      protocolPolishOriginalPreview: { innerHTML: '' },
      protocolPolishResultPreview: { innerHTML: '' },
      protocolPolishStatus: { textContent: '', hidden: true, dataset: {} },
      protocolNameInput: { focus() {} }
    },
    localState: {
      currentProtocolDraft: {
        id: 'protocol-draft-1',
        createdAt: '2026-04-07T00:00:00.000Z',
        updatedAt: '2026-04-07T00:00:00.000Z'
      },
      polishedProtocolDraft: null,
      protocolPolishSourceDraft: null,
      protocolPolishRequestToken: 0,
      isProtocolPolishPending: false
    },
    requestLlmText: async ({ prompt }) => {
      capturedPrompt = String(prompt || '');
      return JSON.stringify({
        name: 'Nuclei Isolation',
        purpose: 'Isolate nuclei from a cell pellet.',
        materials: ['Cold PBS', 'Dounce homogenizer'],
        steps: ['Wash the pellet with cold PBS.', 'Incubate on ice for [time].'],
        troubleshooting: 'If the pellet is loose, centrifuge again.'
      });
    },
    parseJsonFromText: (text) => JSON.parse(text),
    cloneDraftFromProtocol: (draft) => JSON.parse(JSON.stringify(draft)),
    sanitizeIncomingProtocol: (protocol) => ({
      ...protocol,
      materials: Array.isArray(protocol?.materials) ? protocol.materials : [],
      steps: Array.isArray(protocol?.steps)
        ? protocol.steps.map((step, index) => (
          typeof step === 'string'
            ? { id: `step-${index + 1}`, text: step, placeholders: [] }
            : step
        ))
        : []
    }),
    normalizeMaterials: (materials) => (
      Array.isArray(materials)
        ? materials.map((item) => String(item || '').trim()).filter(Boolean)
        : []
    ),
    stepToEditableLine: (step) => String(typeof step === 'string' ? step : step?.text || '').trim(),
    renderProtocolPreviewInto: () => {},
    renderProtocolPolishEmptyState: () => {},
    renderProtocolPolishLoadingState: () => {},
    populateEditorFormFromDraft: () => {},
    buildDraftFromEditorInputs: () => sourceDraft
  });

  await controller.onPolishProtocol();

  assert.match(capturedPrompt, /Protocol draft to polish \(plain-text sections\):\nName:\n\[blank\]/);
  assert.match(capturedPrompt, /Materials:\n- Cold PBS\n- Dounce homogenizer/);
  assert.match(capturedPrompt, /Steps:\n1\. wash pellet with cold PBS\n2\. incubate on ice for \[time\]/);
  assert.equal(/Protocol draft to polish \(plain-text sections\):\n\{/.test(capturedPrompt), false);
});
test('protocol-owned agent adapter normalizes and persists approved generated protocols', () => {
  const agentAdapterModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'protocol',
    'agent',
    'index.js'
  ));
  const state = {
    protocols: [{ id: 'protocol-existing', name: 'Cell Prep' }]
  };
  let protocolsChanged = 0;
  const adapter = agentAdapterModule.createProtocolAgentAdapter({
    state,
    createId: () => 'protocol-generated',
    onProtocolsChanged: () => {
      protocolsChanged += 1;
    }
  });

  const reviewProtocols = adapter.collectReviewProtocols({
    protocol_generation: {
      protocol: {
        id: 'protocol-existing',
        title: 'Cell Prep',
        description: 'Prepare cells for downstream analysis.',
        materials: '- PBS\n- Cell pellet',
        procedure: ['Wash the pellet.', { action: 'Resuspend in PBS.' }]
      }
    }
  });

  assert.equal(reviewProtocols.length, 1);
  assert.equal(reviewProtocols[0].materials.join(','), 'PBS,Cell pellet');
  assert.equal(reviewProtocols[0].steps[1].text, 'Resuspend in PBS.');

  const savedProtocol = adapter.approveGeneratedProtocol(reviewProtocols[0]);
  assert.equal(savedProtocol.id, 'protocol-generated');
  assert.equal(savedProtocol.name, 'Cell Prep (Agent Generated)');
  assert.equal(state.protocols.length, 2);
  assert.equal(state.protocols[1], savedProtocol);
  assert.equal(protocolsChanged, 1);
});
  }
};
