module.exports = function registerAppLabAndProjectSuite(context = {}) {
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
  assert.match(inventorySections.innerHTML, /value="chemical">Chemical/);
  assert.doesNotMatch(inventorySections.innerHTML, />Compound</);

  const existingStructureBtn = inventorySections.querySelector('[data-inventory-sample-structure-open]');
  assert.equal(Boolean(existingStructureBtn.hidden), true);
  const existingTypeInput = inventorySections.querySelector('[data-well-sample-type]');
  existingTypeInput.value = 'chemical';
  trigger(existingTypeInput, 'change');
  assert.equal(Boolean(existingStructureBtn.hidden), false);

  inventorySections.querySelector('[data-well-sample-code]').value = 'S-UPDATED-1';
  inventorySections.querySelector('[data-well-sample-name]').value = 'Updated Sample';
  existingTypeInput.value = 'protein';
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
  assert.match(inventorySections.innerHTML, /value="chemical">Chemical/);
  assert.doesNotMatch(inventorySections.innerHTML, />Compound</);
  const newStructureBtn = inventorySections.querySelector('[data-inventory-sample-structure-open]');
  assert.equal(Boolean(newStructureBtn.hidden), true);
  const newTypeInput = inventorySections.querySelector('[data-well-sample-new-type]');
  newTypeInput.value = 'chemical';
  trigger(newTypeInput, 'change');
  assert.equal(Boolean(newStructureBtn.hidden), false);

  inventorySections.querySelector('[data-well-sample-new-code]').value = 'S-NEW-1';
  inventorySections.querySelector('[data-well-sample-new-name]').value = 'Created Sample';
  newTypeInput.value = 'antibody';
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
  assert.equal(document.getElementById('save-biology-notebook-btn').textContent, 'Save');

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

test('biology-notebook opens workflow-created pages from saved protocol snapshots', () => {
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
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);

  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' }
    ],
    protocols: [],
    notebookEntries: [
      {
        id: 'workflow-page-1',
        notebookType: 'biology',
        projectId: '',
        projectName: '',
        protocolId: 'protocol-missing',
        protocolName: 'IPTG Expression',
        protocolSnapshot: {
          id: 'protocol-missing',
          name: 'IPTG Expression',
          steps: [
            {
              id: 'step-1',
              text: 'Induce with {{ph:iptg}}.',
              placeholders: [
                { id: 'iptg', name: 'IPTG' }
              ]
            }
          ]
        },
        values: {
          'step-1:iptg': '0.5 mM'
        },
        result: 'Prepared from workflow',
        resultFiles: [],
        resultFileRecords: [],
        updatedAt: '2026-04-11T00:00:00.000Z',
        notebookState: 'planned',
        executedAt: '',
        workflowContext: {
          workflowId: 'workflow-1',
          workflowName: 'Histagged protein preparation',
          workflowEntryId: 'entry-1',
          workflowEntryName: 'Clone 12',
          workflowBlockTitle: 'IPTG Expression'
        }
      },
      {
        id: 'workflow-page-2',
        notebookType: 'biology',
        projectId: '',
        projectName: '',
        protocolId: 'protocol-missing-2',
        protocolName: 'Ni-NTA Purification',
        protocolSnapshot: {
          id: 'protocol-missing-2',
          name: 'Ni-NTA Purification',
          steps: []
        },
        values: {},
        result: 'Purified from workflow',
        resultFiles: [],
        resultFileRecords: [],
        updatedAt: '2026-04-11T00:05:00.000Z',
        notebookState: 'executed',
        executedAt: '2026-04-11T00:05:00.000Z',
        workflowContext: {
          workflowId: 'workflow-1',
          workflowName: 'Histagged protein preparation',
          workflowEntryId: 'entry-1',
          workflowEntryName: 'Clone 12',
          workflowBlockTitle: 'Ni-NTA Purification'
        }
      }
    ],
    assays: [],
    gelAnalyses: [],
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
    persist: () => {},
    createId: () => 'new-entry',
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions();
  notebook.openEntry('workflow-page-1');

  assert.equal(document.getElementById('biology-notebook-protocol-title').textContent, 'IPTG Expression');
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /0\.5 mM/);
  assert.equal(document.getElementById('biology-notebook-mark-executed-btn').hidden, false);
  assert.doesNotMatch(document.getElementById('biology-notebook-entry-list').innerHTML, /Untitled Project/);
  assert.equal((document.getElementById('biology-notebook-entry-list').innerHTML.match(/biology-notebook-folder-name">Clone 12</g) || []).length, 1);
  assert.match(document.getElementById('biology-notebook-entry-list').innerHTML, /Ni-NTA Purification/);
});

test('biology-notebook prefers stored protocol snapshots over live protocol records for saved pages', () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-edit-protocol-btn',
    'biology-notebook-apply-protocol-edit-btn',
    'biology-notebook-cancel-protocol-edit-btn',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-protocol-editor',
    'biology-notebook-page-protocol-name',
    'biology-notebook-page-protocol-steps',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);

  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' }
    ],
    protocols: [
      {
        id: 'protocol-1',
        name: 'Live Protocol Name',
        steps: [
          {
            id: 'step-live',
            text: 'Live library step.',
            placeholders: []
          }
        ]
      }
    ],
    notebookEntries: [
      {
        id: 'saved-page-1',
        notebookType: 'biology',
        projectId: 'p1',
        projectName: 'Atlas',
        protocolId: 'protocol-1',
        protocolName: 'Stored Snapshot Name',
        protocolSnapshot: {
          id: 'protocol-1',
          name: 'Stored Snapshot Name',
          steps: [
            {
              id: 'step-saved',
              text: 'Stored notebook step with {{ph:volume}}.',
              placeholders: [
                { id: 'volume', name: 'Volume' }
              ]
            }
          ]
        },
        values: {
          'step-saved:volume': '15 mL'
        },
        result: 'Snapshot-backed page',
        resultFiles: [],
        resultFileRecords: [],
        updatedAt: '2026-04-21T00:00:00.000Z',
        notebookState: 'executed',
        executedAt: '2026-04-21T00:00:00.000Z'
      }
    ],
    assays: [],
    gelAnalyses: [],
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
    persist: () => {},
    createId: () => 'new-entry',
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions();
  notebook.openEntry('saved-page-1');

  assert.equal(document.getElementById('biology-notebook-protocol-title').textContent, 'Stored Snapshot Name');
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /Stored notebook step with/);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /data-nb-key-ref="step-saved:volume"/);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, />15 mL</);
  assert.doesNotMatch(document.getElementById('biology-notebook-steps').innerHTML, /Live library step/);
});

test('biology-notebook edits only the saved page protocol copy and keeps the original protocol unchanged', () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-edit-protocol-btn',
    'biology-notebook-apply-protocol-edit-btn',
    'biology-notebook-cancel-protocol-edit-btn',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-protocol-editor',
    'biology-notebook-page-protocol-name',
    'biology-notebook-page-protocol-steps',
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
        id: 'protocol-1',
        name: 'Source Protocol',
        steps: [
          {
            id: 'step-saved',
            text: 'Add {{ph:volume}} buffer.',
            placeholders: [
              { id: 'volume', name: 'Volume' }
            ]
          }
        ]
      }
    ],
    notebookEntries: [
      {
        id: 'saved-page-1',
        notebookType: 'biology',
        projectId: 'p1',
        projectName: 'Atlas',
        protocolId: 'protocol-1',
        protocolName: 'Source Protocol',
        experimentName: 'Source Protocol',
        protocolSnapshot: {
          id: 'protocol-1',
          name: 'Source Protocol',
          steps: [
            {
              id: 'step-saved',
              text: 'Add {{ph:volume}} buffer.',
              placeholders: [
                { id: 'volume', name: 'Volume' }
              ]
            }
          ]
        },
        values: {
          'step-saved:volume': '15 mL'
        },
        result: 'Snapshot-backed page',
        resultFiles: [],
        resultFileRecords: [],
        updatedAt: '2026-04-21T00:00:00.000Z',
        notebookState: 'executed',
        executedAt: '2026-04-21T00:00:00.000Z'
      }
    ],
    assays: [],
    gelAnalyses: [],
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
      return () => `generated-${index += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {
      notebookChangedCalls += 1;
    }
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions();
  notebook.openEntry('saved-page-1');

  trigger(document.getElementById('biology-notebook-edit-protocol-btn'), 'click');
  assert.equal(document.getElementById('biology-notebook-protocol-editor').hidden, false);
  assert.equal(document.getElementById('biology-notebook-page-protocol-name').value, 'Source Protocol');
  assert.match(document.getElementById('biology-notebook-page-protocol-steps').value, /Add \[Volume\] buffer\./);

  document.getElementById('biology-notebook-page-protocol-name').value = 'Edited Page Copy';
  document.getElementById('biology-notebook-page-protocol-steps').value = '• Add [Sample volume] buffer.\n• Mix thoroughly.';
  trigger(document.getElementById('biology-notebook-apply-protocol-edit-btn'), 'click');

  assert.equal(state.protocols[0].name, 'Source Protocol');
  assert.equal(state.protocols[0].steps.length, 1);
  assert.equal(state.protocols[0].steps[0].text, 'Add {{ph:volume}} buffer.');

  assert.equal(state.notebookEntries[0].protocolName, 'Edited Page Copy');
  assert.equal(state.notebookEntries[0].experimentName, 'Edited Page Copy');
  assert.equal(state.notebookEntries[0].protocolSnapshot.name, 'Edited Page Copy');
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps.length, 2);
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps[0].id, 'step-saved');
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps[0].placeholders[0].id, 'volume');
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps[0].placeholders[0].name, 'Sample volume');
  assert.equal(state.notebookEntries[0].values['step-saved:volume'], '15 mL');
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /Sample volume/);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /Mix thoroughly\./);
  assert.ok(persistCalls >= 1);
  assert.ok(notebookChangedCalls >= 1);
});

test('biology-notebook saves and reopens result tables with Tabulator', async () => {
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
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'biology-notebook-add-table-btn',
    'biology-notebook-add-table-row-btn',
    'biology-notebook-add-table-column-btn',
    'biology-notebook-remove-table-btn',
    'biology-notebook-result-table-wrap',
    'biology-notebook-result-table',
    'biology-notebook-result-table-status',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);

  class MockTabulator {
    static instances = [];

    constructor(host, options = {}) {
      this.host = host;
      this.data = Array.isArray(options.data) ? options.data.map((row) => ({ ...row })) : [];
      this.columns = Array.isArray(options.columns) ? options.columns.map((column) => ({ ...column })) : [];
      this.events = {};
      MockTabulator.instances.push(this);
    }

    destroy() {
      this.destroyed = true;
    }

    getData() {
      return this.data.map((row) => ({ ...row }));
    }

    getColumns() {
      return this.columns.map((column) => ({
        getField: () => column.field,
        getDefinition: () => ({ ...column })
      }));
    }

    on(eventName, handler) {
      this.events[eventName] = handler;
    }
  }

  let persistCalls = 0;
  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' }
    ],
    protocols: [
      {
        id: 'pr1',
        name: 'Expression Readout',
        steps: [
          { id: 's1', text: 'Capture result table.', placeholders: [] }
        ]
      }
    ],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    settings: {
      storagePath: ''
    }
  };

  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook.js'), {
    document,
    window: {
      enanaApi: {},
      Tabulator: MockTabulator
    }
  });
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let index = 0;
      return () => `generated-${index += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions('pr1');

  trigger(document.getElementById('biology-notebook-add-table-btn'), 'click');
  assert.equal(document.getElementById('biology-notebook-result-table-wrap').hidden, false);

  let tableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  const firstField = tableInstance.columns[0].field;
  tableInstance.columns[0].title = 'Sample';
  tableInstance.data[0][firstField] = 'A1';

  trigger(document.getElementById('biology-notebook-add-table-column-btn'), 'click');
  tableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  const lastField = tableInstance.columns[tableInstance.columns.length - 1].field;
  tableInstance.columns[tableInstance.columns.length - 1].title = 'OD600';
  tableInstance.data[0][lastField] = '0.82';

  trigger(document.getElementById('biology-notebook-add-table-row-btn'), 'click');
  tableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  tableInstance.data[tableInstance.data.length - 1][firstField] = 'Control';

  document.getElementById('biology-notebook-result').value = 'Measured expression panel.';
  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();

  assert.equal(state.notebookEntries.length, 1);
  assert.equal(state.notebookEntries[0].resultTable.columns.length, 4);
  assert.equal(state.notebookEntries[0].resultTable.rows.length, 4);
  assert.equal(state.notebookEntries[0].resultTable.columns[0].title, 'Sample');
  assert.equal(state.notebookEntries[0].resultTable.columns[3].title, 'OD600');
  assert.equal(state.notebookEntries[0].resultTable.rows[0][state.notebookEntries[0].resultTable.columns[0].field], 'A1');
  assert.equal(state.notebookEntries[0].resultTable.rows[0][state.notebookEntries[0].resultTable.columns[3].field], '0.82');
  assert.equal(state.notebookEntries[0].resultTable.rows[3][state.notebookEntries[0].resultTable.columns[0].field], 'Control');

  notebook.openEntry(state.notebookEntries[0].id);
  tableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  assert.equal(tableInstance.columns.length, 4);
  assert.equal(tableInstance.columns[0].title, 'Sample');
  assert.equal(tableInstance.columns[3].title, 'OD600');
  assert.equal(tableInstance.data[0][tableInstance.columns[0].field], 'A1');
  assert.equal(tableInstance.data[0][tableInstance.columns[3].field], '0.82');
  assert.match(document.getElementById('biology-notebook-result-table-status').textContent, /4 columns x 4 rows/i);
  assert.ok(persistCalls >= 1);
});

test('notebook pdf export includes linked page content and omits notebook type plus storage folder metadata', async () => {
  class MockJsPdf {
    static instances = [];

    constructor() {
      this.textCalls = [];
      this.imageCalls = [];
      this.savedFileName = '';
      this.internal = {
        pageSize: {
          getWidth: () => 612,
          getHeight: () => 792
        }
      };
      MockJsPdf.instances.push(this);
    }

    setFont() {}

    setFontSize() {}

    splitTextToSize(text) {
      return String(text || '').split('\n');
    }

    text(value) {
      this.textCalls.push(Array.isArray(value) ? value.join(' ') : String(value || ''));
    }

    addPage() {}

    addImage(dataUrl, format, x, y, width, height) {
      this.imageCalls.push({ dataUrl, format, x, y, width, height });
    }

    rect() {}

    setFillColor() {}

    setDrawColor() {}

    save(fileName) {
      this.savedFileName = String(fileName || '');
    }
  }

  class MockImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.width = 240;
      this.height = 120;
      this.naturalWidth = 240;
      this.naturalHeight = 120;
    }

    set src(_value) {
      if (typeof this.onload === 'function') {
        this.onload();
      }
    }
  }

  const mockDocument = {
    createElement(tagName) {
      if (tagName !== 'canvas') {
        return {};
      }
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            fillStyle: '#ffffff',
            fillRect() {},
            drawImage() {}
          };
        },
        toDataURL() {
          return 'data:image/png;base64,MOCKPNG';
        }
      };
    }
  };

  const pdfExportModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'pdf-export.js'), {
    window: {
      jspdf: {
        jsPDF: MockJsPdf
      },
      alert() {}
    },
    document: mockDocument,
    Image: MockImage
  });

  const exportResult = await pdfExportModule.exportNotebookEntryPdf({
    entry: {
      id: 'notebook-1',
      notebookType: 'biology',
      projectName: 'Atlas',
      protocolName: 'Expression Readout',
      experimentName: 'Expression Panel A',
      notebookState: 'executed',
      updatedAt: '2026-04-22T14:30:00.000Z',
      executedAt: '2026-04-22T13:45:00.000Z',
      storageFolder: '/tmp/not-used',
      result: 'Final expression notes.',
      resultTable: {
        columns: [
          { field: 'sample', title: 'Sample' },
          { field: 'od600', title: 'OD600' }
        ],
        rows: [
          { id: 'row-1', sample: 'Clone 12', od600: '0.82' }
        ]
      },
      resultFiles: ['gel.png', 'assay.csv'],
      values: {
        'step-1:buffer': 'PBS'
      }
    },
    protocol: {
      id: 'protocol-1',
      steps: [
        {
          id: 'step-1',
          text: 'Wash with {{ph:buffer}}.',
          placeholders: [
            { id: 'buffer', name: 'Buffer' }
          ]
        }
      ]
    },
    linkedGel: {
      name: 'Expression Gel',
      analysisType: 'sds-page',
      updatedAt: '2026-04-22T14:10:00.000Z'
    },
    linkedGelPreviewImage: 'data:image/png;base64,GELPREVIEW',
    linkedAssay: {
      id: 'assay-1',
      name: 'Expression Assay',
      assayNumber: 'A-001',
      plateLabel: '96 well plate',
      plateType: '96',
      updatedAt: '2026-04-22T14:12:00.000Z',
      wellLayout: [
        { well: 'A1', sampleId: 'Clone 12', concentration: '1 uM' }
      ],
      sampleAxis: 'row',
      concentrationAxis: 'column',
      sampleAxisValues: ['Clone 12'],
      concentrationAxisValues: ['1 uM'],
      serialDilutionSummary: {
        volumePerWellUl: 100,
        feedbackMessages: [
          { text: 'Dilution plan validated.', type: 'note' }
        ],
        initialDilutionRows: [
          { sample: 'Clone 12', stockVolume: '10 uL', bufferVolume: '90 uL' }
        ],
        followingDilutionRows: [
          {
            step: '1',
            targetConcentration: '0.1 uM',
            fromPreviousWell: '10 uL',
            bufferVolume: '90 uL',
            transferOrDiscard: 'Transfer 10 uL',
            finalVolume: '100 uL'
          }
        ],
        hasValidPlans: true
      },
      latestAnalysis: {
        method: 'standard_curve_line',
        summary: 'Good fit',
        chartDataUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%22240%22%20height%3D%22120%22%3E%3C/svg%3E'
      }
    }
  });

  assert.equal(exportResult, true);
  const pdf = MockJsPdf.instances[0];
  const allText = pdf.textCalls.join('\n');

  assert.match(allText, /Project: Atlas/);
  assert.match(allText, /Experiment: Expression Panel A/);
  assert.match(allText, /Linked Results/);
  assert.match(allText, /Serial Dilution/);
  assert.match(allText, /Initial Dilution/);
  assert.match(allText, /Following Dilution/);
  assert.match(allText, /Result Table/);
  assert.doesNotMatch(allText, /Mapped Wells/);
  assert.doesNotMatch(allText, /Mapped Well Definitions/);
  assert.doesNotMatch(allText, /Notebook Type:/);
  assert.doesNotMatch(allText, /Storage Folder:/);
  assert.equal(pdf.imageCalls.length, 2);
  assert.match(pdf.savedFileName, /Expression-Panel-A/i);
});

test('notebook pdf export paginates wrapped notes and draws result tables as cells', async () => {
  class MockJsPdf {
    static instances = [];

    constructor() {
      this.page = 1;
      this.addPageCalls = 0;
      this.textCalls = [];
      this.rectCalls = [];
      this.savedFileName = '';
      this.internal = {
        pageSize: {
          getWidth: () => 612,
          getHeight: () => 260
        }
      };
      MockJsPdf.instances.push(this);
    }

    setFont() {}

    setFontSize() {}

    setDrawColor() {}

    setFillColor() {}

    splitTextToSize(text) {
      return String(text || '')
        .split('\n')
        .flatMap((line) => line.match(/.{1,32}/g) || ['']);
    }

    text(value, _x, y) {
      const lines = Array.isArray(value) ? value : [value];
      lines.forEach((line) => {
        this.textCalls.push({
          page: this.page,
          y: Number(y),
          value: String(line || '')
        });
      });
    }

    addPage() {
      this.page += 1;
      this.addPageCalls += 1;
    }

    rect(x, y, width, height, style) {
      this.rectCalls.push({ x, y, width, height, style });
    }

    save(fileName) {
      this.savedFileName = String(fileName || '');
    }
  }

  const pdfExportModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'pdf-export.js'), {
    window: {
      jspdf: {
        jsPDF: MockJsPdf
      },
      alert() {}
    }
  });

  const exportResult = await pdfExportModule.exportNotebookEntryPdf({
    entry: {
      id: 'notebook-long',
      projectName: 'Atlas',
      protocolName: 'Expression Readout',
      experimentName: 'Long Notes',
      notebookState: 'planned',
      updatedAt: '2026-04-22T14:30:00.000Z',
      result: Array.from({ length: 18 }, (_unused, index) => (
        `Observation ${index + 1}: this note is intentionally long enough to wrap inside the PDF export.`
      )).join('\n'),
      resultTable: {
        columns: [
          { field: 'sample', title: 'Sample' },
          { field: 'reading', title: 'Reading' }
        ],
        rows: [
          { id: 'row-1', sample: 'Clone 12', reading: '0.82' },
          { id: 'row-2', sample: 'Clone 18', reading: '0.76' }
        ]
      },
      values: {}
    },
    protocol: {
      id: 'protocol-1',
      steps: [
        {
          id: 'step-1',
          text: 'Collect expression readout.',
          placeholders: []
        }
      ]
    }
  });

  assert.equal(exportResult, true);
  const pdf = MockJsPdf.instances[0];
  const allText = pdf.textCalls.map((call) => call.value).join('\n');

  assert.ok(pdf.addPageCalls > 0);
  assert.ok(pdf.textCalls.every((call) => call.y <= 188), 'Expected text baselines to stay inside the visible page body.');
  assert.ok(pdf.rectCalls.length >= 6, 'Expected result table cells to be drawn as bordered rectangles.');
  assert.doesNotMatch(allText, /Sample \| Reading/);
  assert.match(allText, /Clone 12/);
});

test('assay pdf export omits mapped well text section', () => {
  class MockJsPdf {
    static instances = [];

    constructor() {
      this.textCalls = [];
      this.savedFileName = '';
      this.internal = {
        pageSize: {
          getWidth: () => 612,
          getHeight: () => 792
        }
      };
      MockJsPdf.instances.push(this);
    }

    setFont() {}

    setFontSize() {}

    splitTextToSize(text) {
      return String(text || '').split('\n');
    }

    text(value) {
      this.textCalls.push(Array.isArray(value) ? value.join(' ') : String(value || ''));
    }

    addPage() {}

    rect() {}

    setFillColor() {}

    setDrawColor() {}

    save(fileName) {
      this.savedFileName = String(fileName || '');
    }
  }

  const pdfExportModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'pdf-export.js'), {
    window: {
      jspdf: {
        jsPDF: MockJsPdf
      },
      alert() {}
    }
  });

  const exportResult = pdfExportModule.exportAssayDefinitionPdf({
    id: 'assay-1',
    assayNumber: 'A-001',
    name: 'Expression Assay',
    projectName: 'Atlas',
    plateLabel: '96 well plate',
    plateType: '96',
    sampleAxis: 'row',
    concentrationAxis: 'column',
    updatedAt: '2026-04-22T14:12:00.000Z',
    wellLayout: [
      { well: 'A1', sampleId: 'Clone 12', concentration: '1 uM' }
    ]
  });

  assert.equal(exportResult, true);
  const pdf = MockJsPdf.instances[0];
  const allText = pdf.textCalls.join('\n');

  assert.match(allText, /Well Definition Plot/);
  assert.doesNotMatch(allText, /Mapped Wells/);
  assert.doesNotMatch(allText, /Mapped Well Definitions/);
  assert.match(pdf.savedFileName, /A-001/i);
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

  }
};
