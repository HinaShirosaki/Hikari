module.exports = function registerAppModulesSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
  const labManagementModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'lab-management.js'), {
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
  const inventoryModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'personal-inventory.js'), {
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
  const inventoryModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'personal-inventory.js'), {
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

  const projectManagementModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'project-management.js'), {
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

test('project-management renders notebook state labels for project pages', () => {
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
  wireFormReset(projectForm, [
    document.getElementById('project-name'),
    document.getElementById('project-description'),
    document.getElementById('project-id')
  ]);

  const state = {
    projects: [
      { id: 'p1', name: 'Atlas', description: 'Primary' }
    ],
    notebookEntries: [
      {
        id: 'n1',
        projectId: 'p1',
        protocolName: 'Viability Assay',
        notebookState: 'planned',
        updatedAt: '2026-03-01T00:00:00.000Z',
        resultFiles: []
      }
    ],
    assays: [],
    gelAnalyses: [],
    workflows: []
  };

  const projectManagementModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'project-management.js'), {
    document
  });
  const projectManagement = projectManagementModule.initProjectManagement({
    state,
    persist: () => {},
    createId: () => 'project-new',
    safeText: shared.safeText,
    onProjectsChanged: () => {}
  });

  projectManagement.render();
  assert.match(document.getElementById('project-notebook-pages').innerHTML, /State:<\/strong> Planned/);
});

test('biology-notebook keeps planned pages distinct, marks them executed, and preserves metadata on save', async () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-page-list-status',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);

  let persistCalls = 0;
  let notebookChangedCalls = 0;
  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' }
    ],
    protocols: [
      {
        id: 'pr1',
        name: 'Viability Assay',
        steps: [
          { id: 's1', text: 'Measure viability.', placeholders: [] }
        ]
      }
    ],
    notebookEntries: [
      {
        id: 'n1',
        notebookType: 'biology',
        projectId: 'p1',
        projectName: 'Atlas',
        protocolId: 'pr1',
        protocolName: 'Viability Assay',
        values: {},
        result: 'Planned page',
        resultFiles: [],
        resultFileRecords: [],
        updatedAt: '2026-03-20T00:00:00.000Z',
        notebookState: 'planned',
        executedAt: '',
        agentDraftStatus: 'needs_review',
        agentDraftMeta: {
          proposalId: 'proposal-1',
          workflowId: 'w1',
          source: 'agent_notebook_draft_v1'
        }
      },
      {
        id: 'n2',
        notebookType: 'biology',
        projectId: 'p1',
        projectName: 'Atlas',
        protocolId: 'pr1',
        protocolName: 'Viability Assay',
        values: {},
        result: 'Executed page',
        resultFiles: [],
        resultFileRecords: [],
        updatedAt: '2026-03-19T00:00:00.000Z',
        notebookState: 'executed',
        executedAt: '2026-03-19T00:00:00.000Z',
        agentDraftStatus: '',
        agentDraftMeta: {}
      }
    ],
    settings: {
      storagePath: ''
    }
  };

  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook.js'), {
    document,
    window: {
      enanaApi: {}
    }
  });
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let index = 0;
      return () => `n-new-${index += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {
      notebookChangedCalls += 1;
    }
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions('pr1');

  assert.match(document.getElementById('biology-notebook-entry-list').innerHTML, /Planned/);
  assert.match(document.getElementById('biology-notebook-entry-list').innerHTML, /Executed/);
  assert.match(document.getElementById('biology-notebook-protocol-meta').textContent, /protocol draft/i);
  assert.equal(document.getElementById('save-biology-notebook-btn').textContent, 'Save Notebook Entry');

  trigger(document.getElementById('biology-notebook-entry-list'), 'click', {
    target: {
      dataset: { notebookEntryId: 'n1' }
    }
  });

  assert.equal(document.getElementById('biology-notebook-mark-executed-btn').hidden, false);
  trigger(document.getElementById('biology-notebook-mark-executed-btn'), 'click');
  assert.equal(state.notebookEntries.find((entry) => entry.id === 'n1').notebookState, 'executed');
  assert.equal(Boolean(state.notebookEntries.find((entry) => entry.id === 'n1').executedAt), true);
  assert.equal(document.getElementById('biology-notebook-mark-executed-btn').hidden, true);

  document.getElementById('biology-notebook-result').value = 'Updated executed notes.';
  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();
  assert.equal(state.notebookEntries.find((entry) => entry.id === 'n1').result, 'Updated executed notes.');
  assert.equal(state.notebookEntries.find((entry) => entry.id === 'n1').agentDraftMeta.proposalId, 'proposal-1');

  trigger(document.getElementById('cancel-biology-notebook-edit-btn'), 'click');
  document.getElementById('biology-notebook-result').value = 'Fresh manual page.';
  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();

  assert.equal(state.notebookEntries.length, 3);
  assert.equal(state.notebookEntries.some((entry) => entry.id === 'n1'), true);
  assert.equal(state.notebookEntries.some((entry) => entry.id === 'n-new-1'), true);
  assert.equal(state.notebookEntries.find((entry) => entry.id === 'n-new-1').notebookState, 'executed');
  assert.ok(persistCalls >= 2);
  assert.ok(notebookChangedCalls >= 2);
});

test('workflow presentation labels include notebook execution state', () => {
  const workflowPresentation = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'presentation.js'));
  const label = workflowPresentation.notebookEntryLabel({
    notebookType: 'biology',
    notebookState: 'planned',
    protocolName: 'Viability Assay',
    updatedAt: '2026-03-01T00:00:00.000Z'
  }, () => 'Mar 1');
  assert.equal(label, 'Biology | Planned | Viability Assay | Mar 1');
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

  const collaborationModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'collaboration-management.js'), {
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

  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol-management.js'), {
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

test('protocol-management shows JSON import on create and hides it on edit', async () => {
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
    'protocol-json-import-panel',
    'protocol-json-import-file',
    'protocol-json-import-input',
    'import-protocol-json-btn',
    'protocol-json-import-status',
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
  wireFormReset(protocolForm, [
    document.getElementById('protocol-name'),
    document.getElementById('protocol-purpose'),
    document.getElementById('protocol-materials'),
    document.getElementById('protocol-steps'),
    document.getElementById('protocol-troubleshooting')
  ]);

  const state = {
    protocols: [],
    notebookEntries: [],
    workflows: [],
    workflowTemplates: [],
    assays: [],
    gelAnalyses: [],
    messages: [],
    members: [],
    settings: { personalInfo: { enanaEmail: '' } }
  };

  let nextId = 0;
  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol-management.js'), {
    document,
    TextEncoder,
    btoa: btoaPolyfill,
    navigator: {
      clipboard: {
        writeText: async () => {}
      }
    }
  });

  const protocol = protocolModule.initProtocolManagement({
    state,
    persist: () => {},
    createId: () => `generated-id-${nextId += 1}`,
    safeText: shared.safeText,
    onProtocolsChanged: () => {},
    trackGrowthEvent: () => {}
  });

  trigger(document.getElementById('create-protocol-btn'), 'click');
  assert.equal(document.getElementById('protocol-json-import-panel').hidden, false);

  document.getElementById('protocol-json-import-input').value = '{"name":"Imported From Create","steps":["Add buffer"]}';
  trigger(document.getElementById('import-protocol-json-btn'), 'click');
  await flushAsync();

  assert.equal(state.protocols.length, 1);
  assert.equal(state.protocols[0].name, 'Imported From Create');
  assert.match(document.getElementById('protocol-json-import-status').textContent, /Imported "Imported From Create"/);

  protocol.renderList();
  const editBtn = document.getElementById('protocol-list').querySelectorAll('[data-protocol-edit]')[0];
  trigger(editBtn, 'click');

  assert.equal(document.getElementById('protocol-json-import-panel').hidden, true);
});

test('protocol-management import accepts external title/action schema without ids (including fenced LLM JSON)', () => {
  const document = createMockDocument([
    'protocol-list-panel',
    'protocol-editor-panel',
    'protocol-view-panel',
    'create-protocol-btn',
    'protocol-editor-back-btn',
    'protocol-cancel-btn',
    'protocol-view-back-btn',
    'protocol-export-pdf-btn',
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
  wireFormReset(protocolForm, [
    document.getElementById('protocol-name'),
    document.getElementById('protocol-purpose'),
    document.getElementById('protocol-materials'),
    document.getElementById('protocol-steps'),
    document.getElementById('protocol-troubleshooting')
  ]);

  const state = {
    protocols: [],
    notebookEntries: [],
    workflows: [],
    workflowTemplates: [],
    assays: [],
    gelAnalyses: [],
    messages: [],
    members: [],
    settings: { personalInfo: { enanaEmail: '' } }
  };

  let nextId = 0;
  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol-management.js'), {
    document,
    TextEncoder,
    btoa: btoaPolyfill,
    navigator: {
      clipboard: {
        writeText: async () => {}
      }
    }
  });

  const protocol = protocolModule.initProtocolManagement({
    state,
    persist: () => {},
    createId: () => `generated-id-${nextId += 1}`,
    safeText: shared.safeText,
    onProtocolsChanged: () => {},
    trackGrowthEvent: () => {}
  });

  const llmPayload = `I extracted one protocol:\n\`\`\`json\n{\n  "title": "Protocol name",\n  "purpose": "What this protocol is used for",\n  "materials": [\n    "material 1",\n    "material 2"\n  ],\n  "steps": [\n    {\n      "step_number": 1,\n      "action": "Describe the step clearly and concisely."\n    },\n    {\n      "step_number": 2,\n      "action": "Add the next step. Use placeholders like [time] or [volume] where needed."\n    }\n  ],\n  "troubleshooting": [\n    {\n      "problem": "Potential issue",\n      "possible_cause": "Why it may happen",\n      "solution": "How to address it"\n    }\n  ]\n}\n\`\`\``;

  const result = protocol.importProtocolsFromJson(llmPayload, {
    notifyChanged: false,
    renderList: false
  });

  assert.equal(result.ok, true);
  assert.equal(result.importedProtocols.length, 1);
  assert.equal(state.protocols.length, 1);

  const imported = state.protocols[0];
  assert.match(imported.id, /^generated-id-/);
  assert.equal(imported.name, 'Protocol name');
  assert.equal(imported.purpose, 'What this protocol is used for');
  assert.deepEqual(imported.materials, ['material 1', 'material 2']);
  assert.equal(imported.steps.length, 2);
  assert.equal(imported.steps[0].placeholders.length, 0);
  assert.match(imported.steps[1].text, /Add the next step/);
  assert.equal(imported.steps[1].placeholders.length, 2);
  assert.equal(imported.steps[1].placeholders[0].name, 'time');
  assert.equal(imported.steps[1].placeholders[1].name, 'volume');
  assert.match(imported.troubleshooting, /Problem: Potential issue/);
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

  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol-management.js'), {
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
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'));
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
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'));
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
  let notebookChangedCalls = 0;
  let payloadSeen = null;
  const autoSaveCalls = [];
  const state = {
    projects: [
      { id: 'p1', name: 'Cancer Study' },
      { id: 'p2', name: 'Protein Screen' }
    ],
    protocols: [{
      id: 'pr1',
      name: 'Cell Prep',
      steps: [
        { id: 's1', text: 'Harvest [cell line] cells', placeholders: [{ id: 'p1', name: 'cell_line' }] },
        'Legacy mix step'
      ]
    }],
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
    workflows: [
      {
        id: 'w1',
        name: 'Cancer Workflow',
        description: 'Recovery workflow after transfection.',
        projectId: 'p1',
        notebookEntryIds: ['n1'],
        blocks: [
          { id: 'b1', protocolId: 'pr1' },
          { id: 'b2', type: 'text', text: 'Verify viability next day' }
        ],
        links: [{ fromBlockId: 'b1', toBlockId: 'b2' }],
        updatedAt: '2026-02-01T00:00:00.000Z'
      },
      {
        id: 'w2',
        name: 'Other Workflow',
        description: 'Other project flow.',
        projectId: 'p2',
        notebookEntryIds: ['n2'],
        blocks: [{ id: 'b3', protocolId: 'pr1' }],
        links: [],
        updatedAt: '2026-02-02T00:00:00.000Z'
      }
    ],
    papers: [
      {
        id: 'paper-1',
        title: 'Atlas Uploaded Paper',
        linkedType: 'project',
        linkedId: 'p1',
        linkedName: 'Cancer Study',
        summary: 'Paper summary text.',
        summaryStructured: {
          important_figures_or_tables: [
            { item: 'Figure 2', summary: 'Expression rescue trend.' }
          ]
        },
        methodsExtract: [
          {
            title: 'Method A',
            steps: [{ action: 'Prepare cells' }]
          }
        ],
        keyReagents: [
          { name: 'Reagent Z', type: 'compound', identifier: 'RZ-1', notes: 'demo' }
        ],
        pdfDataUrl: 'data:application/pdf;base64,AAAA',
        deepReadReady: true,
        availabilityStatus: 'deep_ready',
        ingestionStatus: 'ready',
        ingestionUpdatedAt: '2026-02-01T00:00:00.000Z',
        ingestionErrors: [],
        updatedAt: '2026-02-01T00:00:00.000Z'
      }
    ],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: { projectId: '', messages: [] }
  };

  const window = {
    enanaApi: {
      autoSaveDataFile: async (data, filePath) => {
        autoSaveCalls.push({ data, filePath });
        return {
          ok: true,
          filePath: '/tmp/enana-data.ena.json',
          sidecarPaths: {
            protocolsPath: '/tmp/enana-data.protocols.json',
            notebookPagesPath: '/tmp/enana-data.notebook-pages.json',
            sqlitePath: '/tmp/enana-data.index.sqlite'
          },
          bundlePaths: {
            dataFilePath: '/tmp/enana-data.ena.json',
            protocolsPath: '/tmp/enana-data.protocols.json',
            notebookPagesPath: '/tmp/enana-data.notebook-pages.json',
            sqlitePath: '/tmp/enana-data.index.sqlite'
          }
        };
      },
      agentChat: async (payload) => {
        payloadSeen = payload;
        return {
          ok: true,
          parser: {
            primary_intent: 'protocol_to_notebook',
            needs_clarification: false,
            clarification_reason: null,
            entities: {
              activity_type: 'cell prep',
              project_name: 'Cancer Study',
              protocol_name: 'Cell Prep',
              protein_name: null,
              compound_name: null,
              inventory_item: null,
              cell_line: 'HEK293',
              paper_title: null,
              workflow_step: null,
              requested_output: 'next steps'
            },
            inventory_search: {
              normalized_query: null,
              candidate_terms: [],
              aliases: [],
              search_mode: null
            },
            protocol_candidates: ['Cell Prep'],
            reasoning_summary: 'Use protocol Cell Prep and verify culture viability.'
          },
          protocol_to_notebook: {
            status: 'completed',
            candidate_matches: [
              { id: 'pr1', name: 'Cell Prep', score: 120 }
            ],
            selected_protocol: {
              id: 'pr1',
              name: 'Cell Prep',
              selection_method: 'deterministic',
              rationale: 'Exact name match.'
            },
            missing_placeholders: [],
            follow_up_questions: [],
            project_name: 'Cancer Study',
            notebook: {
              protocol: { id: 'pr1', name: 'Cell Prep' },
              project: { id: 'p1', name: 'Cancer Study', resolution_source: 'payload_project_id' },
              notebook_type: 'biology',
              rendered_steps: ['Harvest HEK293 cells'],
              placeholder_values: [
                {
                  step_id: 's1',
                  placeholder_id: 'p1',
                  placeholder_key: 's1:p1',
                  display: 'cell_line',
                  value: 'HEK293',
                  source: 'resolved',
                  source_type: 'agent_protocol_v2'
                }
              ],
              unresolved_placeholders: [],
              save: {
                mode: 'auto_save_draft',
                applied: false,
                status: 'ready_for_save',
                reason: 'Draft is ready for notebook auto-save.'
              },
              entry_template: {
                notebookType: 'biology',
                projectId: 'p1',
                projectName: 'Cancer Study',
                protocolId: 'pr1',
                protocolName: 'Cell Prep',
                values: { 's1:p1': 'HEK293' },
                result: 'Notebook draft completed for Cell Prep.',
                updatedAt: '2026-03-11T12:00:00.000Z',
                resultFiles: [],
                resultFileRecords: [],
                agentDraftStatus: 'draft_ready',
                agentDraftMeta: { source: 'agent_protocol_v2', unresolvedCount: 0 }
              }
            }
          },
          developer_trace: [
            {
              stage: 'intent_parser',
              provider: 'openai',
              model: 'gpt-5',
              summary: 'Intent parsed.',
              timestamp: '2026-03-11T12:00:00.000Z'
            }
          ]
        };
      }
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
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
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {
      notebookChangedCalls += 1;
    }
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
  assert.equal(payloadSeen.agent.developerMode, false);
  assert.equal(payloadSeen.agent.deepResearchEnabled, false);
  assert.equal(payloadSeen.projectId, 'p1');
  assert.equal(payloadSeen.stateSnapshot.snapshot_mode, 'thin');
  assert.equal(payloadSeen.stateSnapshot.data_file_path, '/tmp/enana-data.ena.json');
  assert.equal(payloadSeen.stateSnapshot.protocols.length, 1);
  assert.equal(payloadSeen.stateSnapshot.protocols[0].name, 'Cell Prep');
  assert.equal(payloadSeen.stateSnapshot.protocols[0].steps.length, 2);
  assert.equal(payloadSeen.stateSnapshot.notebookEntries.length, 0);
  assert.equal(payloadSeen.stateSnapshot.context_counts.protocols, 1);
  assert.equal(payloadSeen.stateSnapshot.context_counts.notebookEntries, 1);
  assert.equal(payloadSeen.stateSnapshot.workflows.length, 1);
  assert.equal(payloadSeen.stateSnapshot.workflows[0].projectId, 'p1');
  assert.equal(payloadSeen.stateSnapshot.workflows[0].notebookEntryIds[0], 'n1');
  assert.equal(payloadSeen.stateSnapshot.workflows[0].blocks.length, 2);
  assert.equal(payloadSeen.stateSnapshot.workflows[0].blocks[0].protocolId, 'pr1');
  assert.equal(payloadSeen.stateSnapshot.workflows[0].links.length, 1);
  assert.equal(payloadSeen.stateSnapshot.workflows[0].links[0].toBlockId, 'b2');
  assert.equal(payloadSeen.stateSnapshot.papers.length, 1);
  assert.equal(payloadSeen.stateSnapshot.papers[0].availability_status, 'deep_ready');
  assert.equal(payloadSeen.stateSnapshot.papers[0].deep_read_ready, true);
  assert.equal(Array.isArray(payloadSeen.stateSnapshot.papers[0].key_figures), true);
  assert.equal(payloadSeen.stateSnapshot.papers[0].key_figures.length > 0, true);
  assert.equal(payloadSeen.stateSnapshot.assays.length, 1);
  assert.equal(payloadSeen.stateSnapshot.assays[0].project_id, 'p1');
  assert.equal(payloadSeen.stateSnapshot.gelAnalyses.length, 1);
  assert.equal(payloadSeen.stateSnapshot.gelAnalyses[0].project_id, 'p1');
  assert.equal(payloadSeen.stateSnapshot.experimentData.schema_name, 'enana_experiment_json');
  assert.equal(payloadSeen.stateSnapshot.experimentData.notebook_runs[0].notebook_state, 'executed');
  assert.equal(payloadSeen.stateSnapshot.experimentData.notebook_runs[0].executed_at, '');
  assert.equal(payloadSeen.stateSnapshot.experimentData.notebook_runs[0].agent_draft_status, '');
  assert.equal(payloadSeen.stateSnapshot.experimentData.assay_runs.length, 1);
  assert.equal(payloadSeen.stateSnapshot.experimentData.gel_runs.length, 1);
  assert.equal(autoSaveCalls.length, 1);
  assert.equal(autoSaveCalls[0].filePath, '');
  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[0].role, 'user');
  assert.equal(state.agentChat.messages[1].role, 'assistant');
  assert.equal(state.agentChat.messages[1].meta.parser.primary_intent, 'protocol_to_notebook');
  assert.equal(state.agentChat.messages[1].meta.parser.needs_clarification, false);
  assert.equal(state.agentChat.messages[1].meta.parser.protocol_candidates[0], 'Cell Prep');
  assert.equal(state.agentChat.messages[1].meta.protocol_to_notebook.status, 'completed');
  assert.match(state.agentChat.messages[1].text, /Notebook draft completed for Cell Prep\./);
  assert.equal(state.notebookEntries.length, 3);
  assert.equal(notebookChangedCalls, 1);
  assert.match(history.innerHTML, /Assistant/);
  assert.match(history.innerHTML, /Intent Parser/);
  assert.match(history.innerHTML, /Protocol Workflow/);
  assert.match(history.innerHTML, /protocol_to_notebook/);
  assert.match(history.innerHTML, /Entities/);
  assert.match(history.innerHTML, /Reasoning Summary/);
  assert.equal(/Developer Trace/.test(history.innerHTML), false);

  state.settings.agent.developerMode = true;
  agent.render();
  assert.equal(/Developer Trace/.test(history.innerHTML), true);
  assert.equal(sendBtn.disabled, false);
  assert.equal(clearBtn.disabled, false);
  assert.equal(projectSelect.disabled, false);
  assert.equal(messageInput.disabled, false);
  assert.equal(status.textContent, 'Ready.');
  assert.ok(persistCalls >= 3);

  trigger(clearBtn, 'click');
  assert.equal(state.agentChat.messages.length, 0);
  assert.equal(status.textContent, 'New chat ready.');
});

test('agent-chat keeps notebook-draft proposals confirm-first and creates one planned page on click', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-chat-history',
    'agent-message-input',
    'agent-deep-research-toggle-btn',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const projectSelect = document.getElementById('agent-project-select');
  const history = document.getElementById('agent-chat-history');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');
  const status = document.getElementById('agent-status');

  const state = {
    projects: [
      { id: 'p1', name: 'Atlas', description: 'Planning project' }
    ],
    protocols: [
      {
        id: 'pr1',
        name: 'Viability Assay',
        projectId: 'p1',
        projectName: 'Atlas',
        steps: [
          {
            id: 's1',
            text: 'Measure viability for {{ph:sample_name}}.',
            placeholders: [{ id: 'sample_name', name: 'sample name' }]
          }
        ]
      }
    ],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [
      {
        id: 'w1',
        name: 'Atlas Workflow',
        description: 'Next step planning',
        projectId: 'p1',
        notebookEntryIds: [],
        blocks: [{ id: 'b1', protocolId: 'pr1' }],
        links: [],
        updatedAt: '2026-03-20T00:00:00.000Z'
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
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: { projectId: '', messages: [] }
  };

  const window = {
    enanaApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/enana-data.ena.json'
      }),
      agentChat: async () => ({
        ok: true,
        parser: {
          primary_intent: 'notebook_draft',
          needs_clarification: false,
          clarification_reason: null,
          entities: {
            project_name: 'Atlas',
            workflow_step: 'next experiment'
          },
          inventory_search: {
            normalized_query: null,
            candidate_terms: [],
            aliases: [],
            search_mode: null
          },
          protocol_candidates: ['Viability Assay'],
          reasoning_summary: 'Plan the next notebook page.'
        },
        notebook_draft: {
          status: 'proposal_ready',
          project_name: 'Atlas',
          selected_protocol: {
            id: 'pr1',
            name: 'Viability Assay',
            selection_method: 'workflow'
          },
          source_workflow: {
            id: 'w1',
            name: 'Atlas Workflow',
            block_id: 'b1',
            block_title: 'Viability Assay'
          },
          missing_placeholders: [
            {
              placeholder_key: 's1:sample_name',
              display: 'sample name',
              reason: 'Leave visible for the planned draft.'
            }
          ],
          follow_up_questions: ['Please provide sample name.'],
          proposal_summary: 'Viability Assay After Cell Prep',
          proposal: {
            proposal_id: 'proposal-1',
            title: 'Viability Assay After Cell Prep',
            purpose: 'Measure whether the prepared cells remain viable.',
            rationale: 'This is the next workflow step.',
            planned_materials: ['Prepared cells', 'Viability plate'],
            checkpoints: ['Confirm cells are ready.', 'Record viability observations.'],
            workflow: {
              id: 'w1',
              name: 'Atlas Workflow',
              block_id: 'b1',
              block_title: 'Viability Assay'
            }
          },
          notebook: {
            protocol: { id: 'pr1', name: 'Viability Assay' },
            project: { id: 'p1', name: 'Atlas', resolution_source: 'tool_project_id' },
            notebook_type: 'biology',
            rendered_steps: ['Measure viability for [sample name].'],
            unresolved_placeholders: [
              {
                step_id: 's1',
                placeholder_id: 'sample_name',
                placeholder_key: 's1:sample_name',
                display: 'sample name',
                reason: 'Leave visible for the planned draft.'
              }
            ],
            save: {
              mode: 'confirm_before_save',
              applied: false,
              status: 'awaiting_user_confirmation',
              reason: 'Planned notebook draft is ready to create after confirmation.'
            },
            proposal: {
              proposal_id: 'proposal-1',
              title: 'Viability Assay After Cell Prep',
              purpose: 'Measure whether the prepared cells remain viable.',
              rationale: 'This is the next workflow step.',
              planned_materials: ['Prepared cells', 'Viability plate'],
              checkpoints: ['Confirm cells are ready.', 'Record viability observations.'],
              workflow: {
                id: 'w1',
                name: 'Atlas Workflow',
                block_id: 'b1',
                block_title: 'Viability Assay'
              }
            },
            entry_template: {
              notebookType: 'biology',
              projectId: 'p1',
              projectName: 'Atlas',
              protocolId: 'pr1',
              protocolName: 'Viability Assay',
              values: {},
              result: 'Planned Experiment: Viability Assay After Cell Prep',
              updatedAt: '2026-03-21T12:00:00.000Z',
              notebookState: 'planned',
              executedAt: '',
              resultFiles: [],
              resultFileRecords: [],
              agentDraftStatus: 'needs_review',
              agentDraftMeta: {
                source: 'agent_notebook_draft_v1',
                proposalId: 'proposal-1',
                workflowId: 'w1'
              }
            }
          }
        },
        notebookDraft: {
          protocol: { id: 'pr1', name: 'Viability Assay' },
          project: { id: 'p1', name: 'Atlas', resolution_source: 'tool_project_id' },
          notebook_type: 'biology',
          rendered_steps: ['Measure viability for [sample name].'],
          unresolved_placeholders: [
            {
              step_id: 's1',
              placeholder_id: 'sample_name',
              placeholder_key: 's1:sample_name',
              display: 'sample name',
              reason: 'Leave visible for the planned draft.'
            }
          ],
          save: {
            mode: 'confirm_before_save',
            applied: false,
            status: 'awaiting_user_confirmation',
            reason: 'Planned notebook draft is ready to create after confirmation.'
          },
          proposal: {
            proposal_id: 'proposal-1',
            title: 'Viability Assay After Cell Prep',
            purpose: 'Measure whether the prepared cells remain viable.',
            rationale: 'This is the next workflow step.',
            planned_materials: ['Prepared cells', 'Viability plate'],
            checkpoints: ['Confirm cells are ready.', 'Record viability observations.'],
            workflow: {
              id: 'w1',
              name: 'Atlas Workflow',
              block_id: 'b1',
              block_title: 'Viability Assay'
            }
          },
          entry_template: {
            notebookType: 'biology',
            projectId: 'p1',
            projectName: 'Atlas',
            protocolId: 'pr1',
            protocolName: 'Viability Assay',
            values: {},
            result: 'Planned Experiment: Viability Assay After Cell Prep',
            updatedAt: '2026-03-21T12:00:00.000Z',
            notebookState: 'planned',
            executedAt: '',
            resultFiles: [],
            resultFileRecords: [],
            agentDraftStatus: 'needs_review',
            agentDraftMeta: {
              source: 'agent_notebook_draft_v1',
              proposalId: 'proposal-1',
              workflowId: 'w1'
            }
          }
        }
      })
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  projectSelect.value = 'p1';
  trigger(projectSelect, 'change');
  messageInput.value = 'Draft tomorrow’s next experiment.';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].meta.parser.primary_intent, 'notebook_draft');
  assert.equal(state.agentChat.messages[1].meta.notebook_draft.status, 'proposal_ready');
  assert.equal(state.notebookEntries.length, 0);
  assert.match(history.innerHTML, /Create Planned Page/);
  assert.match(history.innerHTML, /Planned Notebook Draft/);

  const createButtons = history.querySelectorAll('[data-agent-create-planned-page]');
  assert.equal(createButtons.length, 1);
  trigger(history, 'click', { target: createButtons[0] });

  assert.equal(state.notebookEntries.length, 1);
  assert.equal(state.notebookEntries[0].notebookState, 'planned');
  assert.equal(state.notebookEntries[0].executedAt, '');
  assert.equal(state.notebookEntries[0].agentDraftMeta.proposalId, 'proposal-1');
  assert.match(history.innerHTML, /Planned Page Created/);
  assert.equal(status.textContent, 'Planned notebook page created.');

  trigger(history, 'click', { target: createButtons[0] });
  assert.equal(state.notebookEntries.length, 1);
});

test('agent-chat toggles deep research mode and sends it in the chat payload', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-chat-history',
    'agent-message-input',
    'agent-deep-research-toggle-btn',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const messageInput = document.getElementById('agent-message-input');
  const toggleBtn = document.getElementById('agent-deep-research-toggle-btn');
  const sendBtn = document.getElementById('agent-send-btn');

  let payloadSeen = null;
  const state = {
    projects: [],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: {
      projectId: '',
      deepResearchEnabled: false,
      messages: []
    }
  };

  const window = {
    enanaApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/enana-data.ena.json'
      }),
      agentChat: async (payload) => {
        payloadSeen = payload;
        return {
          ok: true,
          parser: {
            primary_intent: 'general_science_question',
            needs_clarification: false,
            clarification_reason: null,
            entities: {},
            inventory_search: {
              normalized_query: null,
              candidate_terms: [],
              aliases: [],
              search_mode: null
            },
            protocol_candidates: [],
            reasoning_summary: 'Use deep research.'
          },
          general_science_question: {
            status: 'completed',
            answer: 'Deep research answer.',
            execution_mode: 'deep_research',
            citations: [],
            decision_record: {
              assumptions: [],
              open_questions: [],
              verification_notes: []
            },
            rounds_executed: 1,
            follow_up_questions: []
          },
          developer_trace: []
        };
      }
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  assert.equal(toggleBtn.textContent, 'Deep Research: Off');

  trigger(toggleBtn, 'click');
  assert.equal(state.agentChat.deepResearchEnabled, true);
  assert.equal(toggleBtn.textContent, 'Deep Research: On');

  messageInput.value = 'Why did the yield drop?';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(payloadSeen.agent.developerMode, false);
  assert.equal(payloadSeen.agent.deepResearchEnabled, true);
  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].meta.general_science_question.execution_mode, 'deep_research');
});

test('agent-chat loads saved sessions from chat logs and switches sessions from the sidebar', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-session-status',
    'agent-session-list',
    'agent-new-chat-btn',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const sessionList = document.getElementById('agent-session-list');
  const history = document.getElementById('agent-chat-history');
  const status = document.getElementById('agent-status');

  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      storagePath: '/tmp/enana-storage',
      llm: {
        provider: 'openai',
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: {
      projectId: '',
      currentSessionId: '',
      sessions: [],
      messages: []
    }
  };

  const window = {
    enanaApi: {
      agentChatLogListSessions: async () => ({
        ok: true,
        items: [
          {
            id: 'chat-2',
            title: 'Recent literature search',
            project_id: '',
            project_name: '',
            updated_at: '2026-03-22T18:00:00.000Z',
            created_at: '2026-03-22T18:00:00.000Z',
            message_count: 2,
            last_message_preview: 'Found 3 recent papers.'
          },
          {
            id: 'chat-1',
            title: 'Atlas notebook question',
            project_id: 'p1',
            project_name: 'Cancer Study',
            updated_at: '2026-03-22T17:00:00.000Z',
            created_at: '2026-03-22T17:00:00.000Z',
            message_count: 2,
            last_message_preview: 'I found the notebook entry.'
          }
        ]
      }),
      agentChatLogGetSession: async ({ sessionId }) => ({
        ok: true,
        session: {
          id: sessionId,
          project_id: sessionId === 'chat-1' ? 'p1' : '',
          project_name: sessionId === 'chat-1' ? 'Cancer Study' : '',
          title: sessionId === 'chat-1' ? 'Atlas notebook question' : 'Recent literature search'
        },
        messages: sessionId === 'chat-1'
          ? [
            {
              id: 'u1',
              role: 'user',
              text: 'Where is the Atlas notebook entry?',
              createdAt: '2026-03-22T17:00:00.000Z'
            },
            {
              id: 'a1',
              role: 'assistant',
              text: 'I found the notebook entry.',
              createdAt: '2026-03-22T17:00:05.000Z',
              meta: {
                parser: {
                  primary_intent: 'record_lookup',
                  needs_clarification: false,
                  entities: {},
                  inventory_search: {
                    normalized_query: null,
                    candidate_terms: [],
                    aliases: [],
                    search_mode: null
                  },
                  protocol_candidates: [],
                  reasoning_summary: 'Loaded from disk.'
                },
                record_lookup: {
                  status: 'matched',
                  query: 'Atlas notebook'
                }
              }
            }
          ]
          : [
            {
              id: 'u2',
              role: 'user',
              text: 'Find recent kinase papers.',
              createdAt: '2026-03-22T18:00:00.000Z'
            },
            {
              id: 'a2',
              role: 'assistant',
              text: 'Found 3 recent papers.',
              createdAt: '2026-03-22T18:00:05.000Z',
              meta: {
                parser: {
                  primary_intent: 'general_science_question',
                  needs_clarification: false,
                  entities: {},
                  inventory_search: {
                    normalized_query: null,
                    candidate_terms: [],
                    aliases: [],
                    search_mode: null
                  },
                  protocol_candidates: [],
                  reasoning_summary: 'Loaded from disk.'
                },
                general_science_question: {
                  status: 'answered',
                  answer: 'Found 3 recent papers.'
                }
              }
            }
          ]
      })
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.currentSessionId, 'chat-2');
  assert.equal(state.agentChat.messages.length, 2);
  assert.match(sessionList.innerHTML, /Recent literature search/);
  assert.match(sessionList.innerHTML, /Atlas notebook question/);
  assert.match(history.innerHTML, /Found 3 recent papers/);

  const sessionButtons = sessionList.querySelectorAll('[data-session-id]');
  const atlasSessionButton = sessionButtons.find((item) => item.dataset.sessionId === 'chat-1');
  trigger(sessionList, 'click', { target: atlasSessionButton });
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.currentSessionId, 'chat-1');
  assert.equal(state.agentChat.projectId, 'p1');
  assert.match(history.innerHTML, /Atlas notebook entry/);
  assert.equal(status.textContent, 'Ready.');
});

test('agent-chat session switching honors nested click targets and replays the latest click after an in-flight load', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-session-status',
    'agent-session-list',
    'agent-new-chat-btn',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const sessionList = document.getElementById('agent-session-list');
  const history = document.getElementById('agent-chat-history');
  const status = document.getElementById('agent-status');

  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      storagePath: '/tmp/enana-storage',
      llm: {
        provider: 'openai',
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: {
      projectId: '',
      currentSessionId: '',
      sessions: [],
      messages: []
    }
  };

  let releaseChat2Load = null;
  const window = {
    enanaApi: {
      agentChatLogListSessions: async () => ({
        ok: true,
        items: [
          {
            id: 'chat-2',
            title: 'Initially loaded',
            project_id: '',
            project_name: '',
            updated_at: '2026-03-22T19:00:00.000Z',
            created_at: '2026-03-22T19:00:00.000Z',
            message_count: 2,
            last_message_preview: 'Second session preview.'
          },
          {
            id: 'chat-1',
            title: 'Nested click target',
            project_id: 'p1',
            project_name: 'Cancer Study',
            updated_at: '2026-03-22T18:00:00.000Z',
            created_at: '2026-03-22T18:00:00.000Z',
            message_count: 2,
            last_message_preview: 'First session preview.'
          },
          {
            id: 'chat-3',
            title: 'Queued target',
            project_id: '',
            project_name: '',
            updated_at: '2026-03-22T17:00:00.000Z',
            created_at: '2026-03-22T17:00:00.000Z',
            message_count: 2,
            last_message_preview: 'Third session preview.'
          }
        ]
      }),
      agentChatLogGetSession: ({ sessionId }) => {
        if (sessionId === 'chat-2') {
          return new Promise((resolve) => {
            releaseChat2Load = () => resolve({
              ok: true,
              session: {
                id: 'chat-2',
                project_id: '',
                project_name: '',
                title: 'Initially loaded'
              },
              messages: [
                {
                  id: 'u2',
                  role: 'user',
                  text: 'Load the second session.',
                  createdAt: '2026-03-22T18:00:00.000Z'
                },
                {
                  id: 'a2',
                  role: 'assistant',
                  text: 'Second session loaded.',
                  createdAt: '2026-03-22T18:00:05.000Z'
                }
              ]
            });
          });
        }
        return Promise.resolve({
          ok: true,
          session: {
            id: sessionId,
            project_id: sessionId === 'chat-1' ? 'p1' : '',
            project_name: sessionId === 'chat-1' ? 'Cancer Study' : '',
            title: sessionId === 'chat-1' ? 'Nested click target' : 'Queued target'
          },
          messages: sessionId === 'chat-1'
            ? [
              {
                id: 'u1',
                role: 'user',
                text: 'Open the first session.',
                createdAt: '2026-03-22T17:00:00.000Z'
              },
              {
                id: 'a1',
                role: 'assistant',
                text: 'First session opened.',
                createdAt: '2026-03-22T17:00:05.000Z'
              }
            ]
            : [
              {
                id: 'u3',
                role: 'user',
                text: 'Open the queued third session.',
                createdAt: '2026-03-22T19:00:00.000Z'
              },
              {
                id: 'a3',
                role: 'assistant',
                text: 'Third session opened.',
                createdAt: '2026-03-22T19:00:05.000Z'
              }
            ]
        });
      }
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  await flushAsync();
  await flushAsync();
  assert.equal(typeof releaseChat2Load, 'function');

  const sessionButtons = sessionList.querySelectorAll('[data-session-id]');
  const nestedTargetSession = sessionButtons.find((item) => item.dataset.sessionId === 'chat-1');
  const queuedTargetSession = sessionButtons.find((item) => item.dataset.sessionId === 'chat-3');
  const nestedTitle = nestedTargetSession.querySelector('strong');

  trigger(sessionList, 'click', { target: nestedTitle });
  trigger(sessionList, 'click', { target: queuedTargetSession });

  await flushAsync();
  assert.equal(state.agentChat.currentSessionId, '');

  releaseChat2Load();
  await flushAsync();
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.currentSessionId, 'chat-3');
  assert.match(history.innerHTML, /Third session opened/);
  assert.equal(status.textContent, 'Ready.');
});

test('agent-chat exposes developer-only manual tool smoke test action and renders results', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-developer-tools',
    'agent-dev-test-tools-btn',
    'agent-dev-tool-select',
    'agent-dev-tool-message',
    'agent-dev-run-tool-btn',
    'agent-dev-tool-hint',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const developerTools = document.getElementById('agent-developer-tools');
  const developerTestBtn = document.getElementById('agent-dev-test-tools-btn');
  const history = document.getElementById('agent-chat-history');
  const status = document.getElementById('agent-status');

  let payloadSeen = null;
  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        provider: 'openai',
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: { projectId: 'p1', messages: [] }
  };

  const window = {
    enanaApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/enana-data.ena.json'
      }),
      agentDeveloperTestTools: async (payload) => {
        payloadSeen = payload;
        return {
          ok: true,
          status: 'completed',
          tool_count: 2,
          passed_count: 2,
          failed_count: 0,
          summary: 'Manual tool smoke test completed: 2/2 tools passed.',
          items: [
            {
              tool_name: 'inventory-lookup',
              ok: true,
              status: 'matched',
              summary: 'Inventory lookup smoke test passed.',
              preview: 'Atlas construct sample',
              duration_ms: 8
            },
            {
              tool_name: 'python-sandbox',
              ok: true,
              status: 'ok',
              summary: 'Python sandbox smoke test passed.',
              preview: 'out.json',
              duration_ms: 12
            }
          ]
        };
      }
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  assert.equal(Boolean(developerTools.hidden), true);

  state.settings.agent.developerMode = true;
  agent.render();
  assert.equal(Boolean(developerTools.hidden), false);

  trigger(developerTestBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(payloadSeen.projectId, 'p1');
  assert.equal(payloadSeen.projectName, 'Cancer Study');
  assert.equal(payloadSeen.agent.developerMode, true);
  assert.equal(payloadSeen.stateSnapshot.snapshot_mode, 'thin');
  assert.equal(state.agentChat.messages.length, 1);
  assert.equal(state.agentChat.messages[0].role, 'assistant');
  assert.equal(state.agentChat.messages[0].meta.tool_test.tool_count, 2);
  assert.match(history.innerHTML, /Tool Smoke Test/);
  assert.match(history.innerHTML, /inventory-lookup/);
  assert.match(history.innerHTML, /python-sandbox/);
  assert.match(history.innerHTML, /Passed=2/);
  assert.equal(status.textContent, 'Manual tool smoke test complete.');
});

test('agent-chat lets developers run one tool with a manual message and inspect the raw result', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-developer-tools',
    'agent-dev-test-tools-btn',
    'agent-dev-tool-select',
    'agent-dev-tool-message',
    'agent-dev-run-tool-btn',
    'agent-dev-tool-hint',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const developerToolSelect = document.getElementById('agent-dev-tool-select');
  const developerToolMessage = document.getElementById('agent-dev-tool-message');
  const developerRunToolBtn = document.getElementById('agent-dev-run-tool-btn');
  const developerToolHint = document.getElementById('agent-dev-tool-hint');
  const history = document.getElementById('agent-chat-history');
  const status = document.getElementById('agent-status');

  let payloadSeen = null;
  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        provider: 'openai',
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: true
      }
    },
    agentChat: { projectId: 'p1', messages: [] }
  };

  const window = {
    enanaApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/enana-data.ena.json'
      }),
      agentDeveloperTestTools: async (payload) => {
        payloadSeen = payload;
        return {
          ok: true,
          run_mode: 'single',
          status: 'completed',
          tool_name: payload.toolName,
          request_message: payload.message,
          tool_count: 1,
          passed_count: 1,
          failed_count: 0,
          summary: `Manual tool test completed for ${payload.toolName}: Python sandbox completed and wrote out.json.`,
          items: [
            {
              tool_name: payload.toolName,
              ok: true,
              status: 'ok',
              request_message: payload.message,
              result_message: 'Python sandbox completed and wrote out.json.',
              summary: 'Python sandbox completed and wrote out.json.',
              preview: 'out.json',
              duration_ms: 9,
              raw_result: {
                ok: true,
                readback_files: [
                  {
                    path: 'out.json',
                    content: JSON.stringify({ request_message: payload.message })
                  }
                ]
              }
            }
          ]
        };
      }
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  assert.match(developerToolHint.textContent, /inventory lookup output/i);

  developerToolSelect.value = 'python-sandbox';
  trigger(developerToolSelect, 'change');
  developerToolMessage.value = 'Write a JSON file noting this manual tool test.';
  trigger(developerRunToolBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(payloadSeen.toolName, 'python-sandbox');
  assert.equal(payloadSeen.message, 'Write a JSON file noting this manual tool test.');
  assert.equal(payloadSeen.projectId, 'p1');
  assert.equal(payloadSeen.projectName, 'Cancer Study');
  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[0].role, 'user');
  assert.match(state.agentChat.messages[0].text, /Tool test \(python-sandbox\)/);
  assert.equal(state.agentChat.messages[1].role, 'assistant');
  assert.equal(state.agentChat.messages[1].meta.tool_test.run_mode, 'single');
  assert.equal(state.agentChat.messages[1].meta.tool_test.request_message, 'Write a JSON file noting this manual tool test.');
  assert.match(history.innerHTML, /Manual Tool Test/);
  assert.match(history.innerHTML, /Input Message/);
  assert.match(history.innerHTML, /Raw Result/);
  assert.match(history.innerHTML, /request_message/);
  assert.equal(status.textContent, 'Manual tool test complete for python-sandbox.');
});

test('agent-chat prioritizes inventory lookup summary text and renders lookup metadata panels', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const history = document.getElementById('agent-chat-history');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');

  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        provider: 'openai',
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: { projectId: '', messages: [] }
  };

  const window = {
    enanaApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/enana-data.ena.json'
      }),
      agentChat: async () => ({
        ok: true,
        parser: {
          primary_intent: 'inventory_lookup',
          needs_clarification: false,
          clarification_reason: null,
          entities: {
            inventory_item: 'pET28a-SUMO1'
          },
          inventory_search: {
            normalized_query: 'pet28a-sumo1',
            candidate_terms: ['pet28a-sumo1'],
            aliases: [],
            search_mode: 'mixed'
          },
          protocol_candidates: [],
          reasoning_summary: 'Fallback parser reasoning.'
        },
        inventory_lookup: {
          status: 'matched',
          query: 'pet28a-sumo1',
          terms_used: ['pet28a-sumo1'],
          source: 'sqlite',
          backfilled_sql: false,
          items: [
            {
              kind: 'personal_sample',
              zone: '-20 Degree',
              id: 'sample-1',
              name: 'pET28a-SUMO1',
              location: 'Box A1'
            },
            {
              kind: 'chemical',
              zone: 'Lab Inventory',
              id: 'chem-2',
              name: 'IPTG',
              location: 'Shelf 4'
            }
          ]
        },
        record_lookup: {
          status: 'matched',
          query: 'transformation',
          source: 'sqlite',
          backfilled_sql: false,
          items: [
            {
              record_type: 'notebook',
              id: 'note-1',
              title: 'Transformation Run'
            }
          ]
        },
        developer_trace: []
      })
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  messageInput.value = 'Where is pET28a-SUMO1?';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].meta.inventory_lookup.status, 'matched');
  assert.equal(state.agentChat.messages[1].meta.record_lookup.status, 'matched');
  assert.match(state.agentChat.messages[1].text, /Found 2 inventory matches/);
  assert.equal(/record match/i.test(state.agentChat.messages[1].text), false);
  assert.match(history.innerHTML, /Inventory Lookup/);
  assert.match(history.innerHTML, /Inventory Items/);
  assert.match(history.innerHTML, /Record Lookup/);
});

test('agent-chat uses record lookup summary when inventory lookup payload is absent', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-context-summary',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const history = document.getElementById('agent-chat-history');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');

  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        provider: 'openai',
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {
        developerMode: false
      }
    },
    agentChat: { projectId: '', messages: [] }
  };

  const window = {
    enanaApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/enana-data.ena.json'
      }),
      agentChat: async () => ({
        ok: true,
        parser: {
          primary_intent: 'record_lookup',
          needs_clarification: false,
          clarification_reason: null,
          entities: {
            requested_output: 'transformation record'
          },
          inventory_search: {
            normalized_query: null,
            candidate_terms: [],
            aliases: [],
            search_mode: null
          },
          protocol_candidates: [],
          reasoning_summary: 'Fallback parser reasoning.'
        },
        record_lookup: {
          status: 'no_match',
          query: 'transformation record',
          source: 'sqlite',
          backfilled_sql: false,
          items: []
        },
        developer_trace: []
      })
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  messageInput.value = 'Find my transformation record.';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].meta.record_lookup.status, 'no_match');
  assert.match(state.agentChat.messages[1].text, /No record matches found/);
  assert.match(history.innerHTML, /Record Lookup/);
  assert.equal(/Inventory Lookup/.test(history.innerHTML), false);
});

function buildFakePapersViewerFactory() {
  const controller = {
    activePaperId: '',
    currentPageNumber: 1,
    comments: [],
    selectedCommentId: '',
    placementMode: false,
    callbacks: {}
  };

  return {
    controller,
    create(elements = {}) {
      controller.callbacks = {
        onPageChange: elements.onPageChange,
        onPlacement: elements.onPlacement,
        onPinSelect: elements.onPinSelect,
        onClose: elements.onClose
      };
      return {
        async openPaper({ paper }) {
          controller.activePaperId = paper.id;
          controller.currentPageNumber = 1;
          controller.callbacks.onPageChange?.(1);
          return true;
        },
        async resetViewer() {
          controller.activePaperId = '';
          controller.currentPageNumber = 1;
          controller.callbacks.onClose?.();
          return true;
        },
        getActivePaperId() {
          return controller.activePaperId;
        },
        getCurrentPageNumber() {
          return controller.currentPageNumber;
        },
        hasActiveDocument() {
          return Boolean(controller.activePaperId);
        },
        setComments(comments) {
          controller.comments = Array.isArray(comments) ? comments.slice() : [];
        },
        setSelectedCommentId(commentId) {
          controller.selectedCommentId = String(commentId || '');
        },
        setPlacementMode(enabled) {
          controller.placementMode = Boolean(enabled) && Boolean(controller.activePaperId);
        }
      };
    },
    emitPlacement(payload) {
      controller.callbacks.onPlacement?.(payload);
    },
    emitPageChange(pageNumber) {
      controller.currentPageNumber = pageNumber;
      controller.callbacks.onPageChange?.(pageNumber);
    },
    selectPin(comment) {
      controller.callbacks.onPinSelect?.(comment);
    }
  };
}

function buildPapersManagementHarness({ comments = [], promptResponses = [], confirmResult = true } = {}) {
  const ids = [
    'paper-form',
    'paper-title',
    'paper-pdf',
    'paper-link-type',
    'paper-link-target',
    'paper-upload-trigger',
    'paper-list',
    'papers-library-rail',
    'papers-library-context-menu',
    'papers-context-new-folder',
    'papers-context-delete-folder',
    'paper-folder-selection',
    'paper-upload-target-label',
    'paper-viewer-shell',
    'paper-viewer-empty',
    'paper-viewer-workspace',
    'paper-viewer-stage',
    'paper-viewer-page-layer',
    'paper-viewer-canvas',
    'paper-viewer-overlay',
    'paper-viewer-title',
    'paper-viewer-meta',
    'paper-viewer-status',
    'paper-viewer-toolbar',
    'paper-viewer-prev-btn',
    'paper-viewer-next-btn',
    'paper-viewer-page-input',
    'paper-viewer-page-count',
    'paper-viewer-zoom-out-btn',
    'paper-viewer-zoom-in-btn',
    'paper-viewer-zoom-reset-btn',
    'paper-viewer-fit-width-btn',
    'paper-viewer-summarize-btn',
    'paper-viewer-zoom-label',
    'paper-viewer-open-btn',
    'paper-comment-sidebar',
    'paper-comment-page',
    'paper-comment-count',
    'paper-comment-add-btn',
    'paper-comment-save-btn',
    'paper-comment-cancel-btn',
    'paper-comment-delete-btn',
    'paper-comment-text',
    'paper-comment-status',
    'paper-comment-list',
    'journal-club-list'
  ];
  const document = createMockDocument(ids);
  const paperForm = document.getElementById('paper-form');
  const paperTitle = document.getElementById('paper-title');
  const paperPdf = document.getElementById('paper-pdf');
  const paperLinkType = document.getElementById('paper-link-type');
  wireFormReset(paperForm, [paperTitle, paperPdf]);
  paperLinkType.value = 'project';

  const viewerFactory = buildFakePapersViewerFactory();
  let persistCalls = 0;
  let idCounter = 0;
  const promptQueue = promptResponses.slice();
  const state = {
    journalClubs: [],
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    papers: [
      {
        id: 'paper-1',
        title: 'Atlas Uploaded Paper',
        fileName: 'atlas.pdf',
        linkedType: 'project',
        linkedId: 'p1',
        linkedName: 'Cancer Study',
        summary: 'Paper summary text.',
        summaryStatus: 'idle',
        methodsExtract: [],
        methodsStatus: 'idle',
        keyReagents: [],
        reagentsStatus: 'idle',
        keyFigures: [],
        comments: comments.slice(),
        deepReadReady: false,
        availabilityStatus: 'uploaded_pdf',
        ingestionStatus: 'ready',
        ingestionUpdatedAt: '2026-02-01T00:00:00.000Z',
        ingestionErrors: [],
        updatedAt: '2026-02-01T00:00:00.000Z',
        pdfDataUrl: 'data:application/pdf;base64,AAAA'
      }
    ],
    notebookEntries: [],
    protocols: [],
    paperExperimentLinks: [],
    knowledgeChats: {},
    settings: {
      personalInfo: {
        name: 'Alice Scientist',
        enanaEmail: 'alice@enana.test'
      },
      llm: {}
    }
  };
  const window = {
    alert() {},
    enanaApi: {},
    prompt() {
      return promptQueue.length ? promptQueue.shift() : '';
    },
    confirm() {
      return confirmResult;
    }
  };
  const papersModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'papers-management.js'), {
    document,
    window
  });
  const papers = papersModule.initPapersManagement({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: () => `comment-${idCounter += 1}`,
    safeText: shared.safeText,
    onCreateProtocolDraft: () => {},
    createPdfViewer: (elements) => viewerFactory.create(elements)
  });
  papers.render();

  return {
    document,
    state,
    papers,
    viewerFactory,
    get persistCalls() {
      return persistCalls;
    }
  };
}

async function openPaperInHarness(harness) {
  const journalClubList = harness.document.getElementById('journal-club-list');
  trigger(journalClubList, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-paper-view]') {
          return {
            dataset: {
              paperView: 'paper-1'
            }
          };
        }
        return null;
      }
    }
  });
  await flushAsync();
  await flushAsync();
}

test('papers module renders folder rows with nested paper titles in the library list', () => {
  const harness = buildPapersManagementHarness({
    comments: [
      {
        id: 'comment-1',
        pageNumber: 1,
        anchorX: 0.25,
        anchorY: 0.75,
        text: 'Figure 2 drives the conclusion.',
        author: 'Alice Scientist',
        createdAt: '2026-03-22T17:00:00.000Z',
        updatedAt: '2026-03-22T17:00:00.000Z'
      }
    ]
  });
  const journalClubList = harness.document.getElementById('journal-club-list');

  assert.match(journalClubList.innerHTML, /Cancer Study/);
  assert.match(journalClubList.innerHTML, /Atlas Uploaded Paper/);
});

test('papers module creates a journal club folder from the library context menu', () => {
  const harness = buildPapersManagementHarness({
    promptResponses: ['Weekly Biochem JC']
  });
  const journalClubList = harness.document.getElementById('journal-club-list');
  const papersLibraryRail = harness.document.getElementById('papers-library-rail');
  const contextMenu = harness.document.getElementById('papers-library-context-menu');
  const newFolderBtn = harness.document.getElementById('papers-context-new-folder');

  trigger(papersLibraryRail, 'contextmenu', {
    clientX: 24,
    clientY: 40,
    target: {
      closest() {
        return null;
      }
    }
  });
  assert.equal(contextMenu.hidden, false);

  trigger(newFolderBtn, 'click');

  assert.equal(harness.state.journalClubs.length, 1);
  assert.equal(harness.state.journalClubs[0].name, 'Weekly Biochem JC');
  assert.equal(harness.state.journalClubs[0].description, '');
  assert.match(journalClubList.innerHTML, /Weekly Biochem JC/);
});

test('papers module creates a pinned page comment after placement and save', async () => {
  const harness = buildPapersManagementHarness();
  const addBtn = harness.document.getElementById('paper-comment-add-btn');
  const saveBtn = harness.document.getElementById('paper-comment-save-btn');
  const commentInput = harness.document.getElementById('paper-comment-text');
  const commentStatus = harness.document.getElementById('paper-comment-status');

  await openPaperInHarness(harness);

  trigger(addBtn, 'click');
  assert.equal(harness.viewerFactory.controller.placementMode, true);
  assert.match(commentStatus.textContent, /place a comment pin/i);

  harness.viewerFactory.emitPlacement({
    pageNumber: 1,
    anchorX: 0.25,
    anchorY: 0.75
  });
  commentInput.value = 'Important result near panel C.';
  trigger(commentInput, 'input');
  trigger(saveBtn, 'click');

  assert.equal(harness.state.papers[0].comments.length, 1);
  assert.equal(harness.state.papers[0].comments[0].pageNumber, 1);
  assert.equal(harness.state.papers[0].comments[0].anchorX, 0.25);
  assert.equal(harness.state.papers[0].comments[0].anchorY, 0.75);
  assert.equal(harness.state.papers[0].comments[0].text, 'Important result near panel C.');
  assert.equal(harness.state.papers[0].comments[0].author, 'Alice Scientist');
  assert.equal(harness.viewerFactory.controller.comments.length, 1);
  assert.equal(harness.persistCalls >= 1, true);
});

test('papers module edits an existing pinned page comment from pin selection', async () => {
  const existingComment = {
    id: 'comment-1',
    pageNumber: 1,
    anchorX: 0.15,
    anchorY: 0.45,
    text: 'Original note.',
    author: 'Alice Scientist',
    createdAt: '2026-03-22T17:00:00.000Z',
    updatedAt: '2026-03-22T17:00:00.000Z'
  };
  const harness = buildPapersManagementHarness({
    comments: [existingComment]
  });
  const commentInput = harness.document.getElementById('paper-comment-text');
  const saveBtn = harness.document.getElementById('paper-comment-save-btn');

  await openPaperInHarness(harness);
  harness.viewerFactory.selectPin(existingComment);

  assert.equal(commentInput.value, 'Original note.');
  commentInput.value = 'Updated note from reviewer.';
  trigger(commentInput, 'input');
  trigger(saveBtn, 'click');

  assert.equal(harness.state.papers[0].comments.length, 1);
  assert.equal(harness.state.papers[0].comments[0].text, 'Updated note from reviewer.');
  assert.equal(harness.viewerFactory.controller.selectedCommentId, 'comment-1');
});

test('papers module deletes the selected pinned page comment', async () => {
  const existingComment = {
    id: 'comment-1',
    pageNumber: 1,
    anchorX: 0.15,
    anchorY: 0.45,
    text: 'Delete me.',
    author: 'Alice Scientist',
    createdAt: '2026-03-22T17:00:00.000Z',
    updatedAt: '2026-03-22T17:00:00.000Z'
  };
  const harness = buildPapersManagementHarness({
    comments: [existingComment]
  });
  const deleteBtn = harness.document.getElementById('paper-comment-delete-btn');

  await openPaperInHarness(harness);
  harness.viewerFactory.selectPin(existingComment);
  trigger(deleteBtn, 'click');

  assert.equal(harness.state.papers[0].comments.length, 0);
  assert.equal(harness.viewerFactory.controller.comments.length, 0);
  assert.match(harness.document.getElementById('paper-comment-list').innerHTML, /No comments on page 1 yet/);
});

test('papers module scopes sidebar comments to the active PDF page', async () => {
  const harness = buildPapersManagementHarness({
    comments: [
      {
        id: 'comment-1',
        pageNumber: 1,
        anchorX: 0.15,
        anchorY: 0.45,
        text: 'Page one note.',
        author: 'Alice Scientist',
        createdAt: '2026-03-22T17:00:00.000Z',
        updatedAt: '2026-03-22T17:00:00.000Z'
      },
      {
        id: 'comment-2',
        pageNumber: 2,
        anchorX: 0.55,
        anchorY: 0.65,
        text: 'Page two note.',
        author: 'Alice Scientist',
        createdAt: '2026-03-22T18:00:00.000Z',
        updatedAt: '2026-03-22T18:00:00.000Z'
      }
    ]
  });
  const commentPage = harness.document.getElementById('paper-comment-page');
  const commentCount = harness.document.getElementById('paper-comment-count');
  const commentList = harness.document.getElementById('paper-comment-list');

  await openPaperInHarness(harness);
  assert.equal(commentPage.textContent, 'Page 1');
  assert.equal(commentCount.textContent, '1 comment on this page');
  assert.match(commentList.innerHTML, /Page one note/);
  assert.equal(/Page two note/.test(commentList.innerHTML), false);

  harness.viewerFactory.emitPageChange(2);

  assert.equal(commentPage.textContent, 'Page 2');
  assert.equal(commentCount.textContent, '1 comment on this page');
  assert.match(commentList.innerHTML, /Page two note/);
  assert.equal(/Page one note/.test(commentList.innerHTML), false);
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

  }
};
