module.exports = function registerAppLabAndProjectSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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

  const projectManagementModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'project-management', 'index.js'), {
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

  const projectManagementModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'project-management', 'index.js'), {
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
    'biology-notebook-page-starter',
    'biology-notebook-page-starter-project',
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

  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'), {
    document,
    window: {
      hikariApi: {}
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
    'biology-notebook-page-starter',
    'biology-notebook-page-starter-project',
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

  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'), {
    document,
    window: {
      hikariApi: {}
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
test('biology-notebook project folder click renders the project dashboard in place', () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-page-starter',
    'biology-notebook-page-starter-project',
    'biology-notebook-empty-state',
    'biology-notebook-project-dashboard',
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
      { id: 'p1', name: 'Atlas', description: 'Notebook-visible project.' }
    ],
    protocols: [
      {
        id: 'pr2',
        name: 'Fresh Protocol',
        steps: [
          { id: 's1', text: 'Run the fresh protocol.', placeholders: [] }
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
        result: 'Measured viability.',
        resultFiles: [],
        resultFileRecords: [],
        updatedAt: '2026-03-19T00:00:00.000Z',
        notebookState: 'executed',
        executedAt: '2026-03-19T00:00:00.000Z'
      }
    ],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    samples: [],
    paperExperimentLinks: [],
    settings: {
      storagePath: ''
    }
  };

  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'), {
    document,
    window: {
      hikariApi: {}
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
  notebook.renderProtocolOptions('', { triggerChange: false });
  notebook.renderEntries();

  const entryList = document.getElementById('biology-notebook-entry-list');
  const projectFolder = entryList.querySelector('[data-notebook-project-id]');
  const folderToggle = entryList.querySelector('[data-notebook-folder-toggle]');
  const dashboard = document.getElementById('biology-notebook-project-dashboard');

  let iconClickPrevented = false;
  trigger(entryList, 'click', {
    target: folderToggle,
    preventDefault: () => {
      iconClickPrevented = true;
    }
  });

  assert.equal(iconClickPrevented, false);
  assert.equal(dashboard.hidden, true);
  assert.match(entryList.innerHTML, /biology-notebook-folder biology-notebook-folder--project is-collapsed/);
  assert.match(entryList.innerHTML, /biology-notebook-folder-children biology-notebook-folder-children--pages" hidden/);

  let nameClickPrevented = false;
  trigger(entryList, 'click', {
    target: projectFolder,
    preventDefault: () => {
      nameClickPrevented = true;
    }
  });

  assert.equal(nameClickPrevented, true);
  assert.equal(dashboard.hidden, false);
  assert.equal(document.getElementById('biology-notebook-protocol-area').hidden, true);
  assert.equal(document.getElementById('biology-notebook-empty-state').hidden, true);
  assert.match(dashboard.innerHTML, /Project Activity/);
  assert.match(dashboard.innerHTML, /Notebook-visible project\./);
  assert.match(dashboard.innerHTML, /Contribution Heatmap/);
  assert.doesNotMatch(dashboard.innerHTML, /data-project-edit/);
  assert.equal(document.getElementById('biology-notebook-project-select').value, 'p1');
  assert.equal(document.getElementById('biology-notebook-page-starter-project').textContent, 'Atlas');
  assert.match(entryList.innerHTML, /biology-notebook-folder biology-notebook-folder--project is-active/);

  const protocolSelect = document.getElementById('biology-notebook-protocol-select');
  protocolSelect.value = 'pr2';
  trigger(protocolSelect, 'change');

  assert.equal(dashboard.hidden, true);
  assert.equal(document.getElementById('biology-notebook-protocol-area').hidden, false);
  assert.equal(document.getElementById('biology-notebook-protocol-title').textContent, 'Fresh Protocol');
  assert.match(document.getElementById('biology-notebook-protocol-meta').textContent, /Atlas protocol draft/);
  assert.equal(document.getElementById('biology-notebook-page-starter-project').textContent, 'Atlas');
});
  }
};
