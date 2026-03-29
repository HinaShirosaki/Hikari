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

  }
};
