module.exports = function registerAppLabAndProjectSuiteNotebookProjects(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const {
    assert,
    path,
    loadEsmStyleModule,
    createMockDocument,
    wireFormReset,
    trigger,
    flushAsync,
    test,
    shared
  } = scope;
test('biology-notebook project context menu creates a project', async () => {
  const document = createMockDocument([
    'biology-notebook-rail',
    'biology-notebook-project-context-menu',
    'biology-notebook-add-project-btn',
    'biology-notebook-project-dialog-overlay',
    'biology-notebook-project-form',
    'biology-notebook-project-name',
    'biology-notebook-project-description',
    'biology-notebook-project-dialog-close-btn',
    'biology-notebook-project-cancel-btn'
  ]);
  const projectForm = document.getElementById('biology-notebook-project-form');
  const projectNameInput = document.getElementById('biology-notebook-project-name');
  const projectDescriptionInput = document.getElementById('biology-notebook-project-description');
  wireFormReset(projectForm, [projectNameInput, projectDescriptionInput]);
  let persistCalls = 0;
  let projectsChangedCalls = 0;
  let createdProject = null;
  const state = { projects: [], settings: {} };
  const projectControllerModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'biology-notebook',
    'project',
    'project-controller.js'
  ));
  projectControllerModule.createNotebookProjectController({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: () => 'project-new',
    safeText: shared.safeText,
    onProjectsChanged: () => {
      projectsChangedCalls += 1;
    },
    onProjectCreated: (project) => {
      createdProject = project;
    },
    railEl: document.getElementById('biology-notebook-rail'),
    contextMenuEl: document.getElementById('biology-notebook-project-context-menu'),
    addProjectBtn: document.getElementById('biology-notebook-add-project-btn'),
    dialogOverlay: document.getElementById('biology-notebook-project-dialog-overlay'),
    dialogForm: projectForm,
    projectNameInput,
    projectDescriptionInput,
    dialogCloseBtn: document.getElementById('biology-notebook-project-dialog-close-btn'),
    dialogCancelBtn: document.getElementById('biology-notebook-project-cancel-btn'),
    windowRef: {}
  });

  const contextMenu = document.getElementById('biology-notebook-project-context-menu');
  const dialogOverlay = document.getElementById('biology-notebook-project-dialog-overlay');
  contextMenu.hidden = true;
  dialogOverlay.hidden = true;

  trigger(document.getElementById('biology-notebook-rail'), 'contextmenu', { clientX: 24, clientY: 48 });
  assert.equal(contextMenu.hidden, false);
  assert.equal(contextMenu.style.left, '24px');
  assert.equal(contextMenu.style.top, '48px');

  trigger(document.getElementById('biology-notebook-add-project-btn'), 'click');
  assert.equal(contextMenu.hidden, true);
  assert.equal(dialogOverlay.hidden, false);

  projectNameInput.value = 'Atlas';
  projectDescriptionInput.value = 'Protein stability study';
  trigger(projectForm, 'submit');
  await flushAsync();

  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].id, 'project-new');
  assert.equal(state.projects[0].name, 'Atlas');
  assert.equal(state.projects[0].description, 'Protein stability study');
  assert.equal(createdProject?.id, 'project-new');
  assert.equal(dialogOverlay.hidden, true);
  assert.equal(persistCalls, 1);
  assert.equal(projectsChangedCalls, 1);
});

test('biology-notebook project creation resumes experiment setup and prevents duplicate submissions', async () => {
  const document = createMockDocument([
    'project-overlay', 'experiment-overlay', 'form', 'name', 'description',
    'create', 'new-project', 'status', 'details'
  ]);
  const get = (id) => document.getElementById(id);
  const state = { projects: [{ id: 'existing', name: 'Atlas' }], settings: { storagePath: '/lab' } };
  const created = [];
  let finishDirectory;
  let saves = 0;
  get('project-overlay').hidden = true;
  get('experiment-overlay').hidden = false;
  wireFormReset(get('form'), [get('name'), get('description')]);
  const { createNotebookProjectController } = loadEsmStyleModule(path.join(
    __dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'project', 'project-controller.js'
  ));
  const controller = createNotebookProjectController({
    state, createId: () => 'new-project', persist: () => { saves += 1; },
    onProjectCreated: (project, origin) => created.push({ project, origin }),
    dialogOverlay: get('project-overlay'), experimentDialogOverlay: get('experiment-overlay'),
    dialogForm: get('form'), projectNameInput: get('name'), projectDescriptionInput: get('description'),
    dialogCreateBtn: get('create'), dialogStatus: get('status'), projectDetails: get('details'),
    experimentAddProjectBtn: get('new-project'), documentRef: document,
    windowRef: { hikariApi: { ensureStorageDirectory: () => new Promise((resolve) => { finishDirectory = resolve; }) } }
  });
  trigger(get('new-project'), 'click', { currentTarget: get('new-project') });
  assert.equal(get('experiment-overlay').hidden, true);
  assert.equal(get('project-overlay').hidden, false);
  get('name').value = '  ';
  assert.equal(await controller.createProject(), null);
  assert.match(get('status').textContent, /Enter a project name/);
  get('name').value = ' atlas ';
  assert.equal(await controller.createProject(), null);
  assert.match(get('status').textContent, /already exists/);
  assert.equal(saves, 0);

  // Distinct names that land on one Project/<folder> lose the second project's
  // notebooks and papers out of project memory, so creation has to refuse them.
  state.projects.push({ id: 'existing-2', name: 'My Project' });
  for (const collidingName of ['Atlas ', 'My/Project', 'My_Project', 'My  Project']) {
    get('name').value = collidingName;
    assert.equal(await controller.createProject(), null, `${collidingName} must be refused`);
    assert.match(get('status').textContent, /already exists|shares a storage folder/);
  }
  state.projects = state.projects.filter((project) => project.id !== 'existing-2');
  assert.equal(saves, 0);

  get('name').value = '  Protein stability  ';
  get('description').value = 'Screen temperature tolerance.';
  const pending = controller.createProject();
  assert.equal(get('create').disabled, true);
  assert.equal(await controller.createProject(), null);
  controller.closeProjectDialog();
  assert.equal(get('project-overlay').hidden, false);
  finishDirectory({ ok: true });
  await pending;
  assert.equal(saves, 1);
  assert.equal(state.projects.length, 2);
  assert.equal(created[0].project.name, 'Protein stability');
  assert.equal(created[0].project.description, 'Screen temperature tolerance.');
  assert.equal(created[0].origin.fromExperiment, true);
  assert.equal(get('experiment-overlay').hidden, false);
  assert.equal(get('project-overlay').hidden, true);
  assert.equal(get('create').disabled, false);

  controller.openProjectDialog({ currentTarget: get('new-project') });
  controller.closeProjectDialog();
  assert.equal(get('experiment-overlay').hidden, false);
  assert.equal(state.projects.length, 2);
});

test('biology-notebook project tree renders projects before they have pages', () => {
  const document = createMockDocument([
    'biology-notebook-entry-list'
  ]);
  const entryListModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'biology-notebook',
    'entry',
    'entry-list-renderer.js'
  ));
  const renderer = entryListModule.createEntryListRenderer({
    listEl: document.getElementById('biology-notebook-entry-list'),
    notebookType: 'biology',
    safeText: shared.safeText,
    getNotebookEntries: () => [],
    getProjects: () => [{ id: 'p1', name: 'Atlas' }],
    getEditingEntryId: () => null
  });

  renderer.renderEntries();
  const html = document.getElementById('biology-notebook-entry-list').innerHTML;
  assert.match(html, /data-notebook-project-id="p1"/);
  assert.match(html, />Atlas</);
  assert.match(html, /No pages yet\./);
});
test('biology-notebook nests project processes and their pages in the project tree', () => {
  const document = createMockDocument(['biology-notebook-entry-list']);
  const entryList = document.getElementById('biology-notebook-entry-list');
  const { createEntryListRenderer } = loadEsmStyleModule(path.join(
    __dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'entry', 'entry-list-renderer.js'
  ));
  const renderer = createEntryListRenderer({
    listEl: entryList,
    notebookType: 'biology',
    safeText: shared.safeText,
    getProjects: () => [{ id: 'p1', name: 'Atlas' }],
    getWorkflows: () => [
      { id: 'w1', projectId: 'p1', name: 'Protein preparation' },
      { id: 'w2', projectId: 'p1', name: 'Purification' }
    ],
    getNotebookEntries: () => [
      { id: 'n1', notebookType: 'biology', projectId: '', protocolName: 'IPTG Expression',
        workflowContext: { workflowId: 'w1', workflowName: 'Old process name', workflowEntryId: 'e1' } },
      { id: 'n2', notebookType: 'biology', projectId: 'p1', protocolName: 'Standalone assay' }
    ],
    getEditingEntryId: () => null
  });

  renderer.renderEntries();
  const html = entryList.innerHTML;
  const projectStart = html.indexOf('data-folder-tree-key="p1"');
  const processStart = html.indexOf('data-folder-tree-key="__process__:w1"');
  const pageStart = html.indexOf('data-notebook-entry-id="n1"');
  const emptyProcessStart = html.indexOf('data-folder-tree-key="__process__:w2"');
  const openDivs = (markup) => (markup.match(/<div\b/g) || []).length - (markup.match(/<\/div>/g) || []).length;
  assert.ok(projectStart >= 0 && processStart > projectStart && pageStart > processStart);
  assert.ok(openDivs(html.slice(projectStart, processStart)) > 0, 'process belongs inside project');
  assert.ok(openDivs(html.slice(processStart, pageStart)) > 0, 'page belongs inside process');
  assert.match(html.slice(processStart, pageStart), /data-notebook-process-id="w1"[\s\S]*?Protein preparation/);
  assert.ok(emptyProcessStart > processStart);
  assert.match(html.slice(emptyProcessStart), /No pages yet\./);
  assert.match(html, /data-notebook-entry-id="n2"/);
  assert.equal((html.match(/data-folder-tree-key="__process__:w1"/g) || []).length, 1);

  renderer.toggleFolder('__process__:w1');
  assert.match(entryList.innerHTML, /data-folder-tree-key="__process__:w1"[\s\S]*?biology-notebook-folder-children[^>]*hidden/);
  assert.match(entryList.innerHTML, /data-folder-tree-key="p1"[\s\S]*?aria-expanded="true"/);
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
    'biology-notebook-new-experiment-btn',
    'biology-notebook-experiment-dialog-overlay',
    'biology-notebook-experiment-form',
    'biology-notebook-experiment-start-btn',
    'biology-notebook-experiment-dialog-status',
    'biology-notebook-protocol-search-results',
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
  assert.equal(document.getElementById('save-biology-notebook-btn').getAttribute('aria-label'), 'Save notebook page');

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

  notebook.openExperimentDialog();
  document.getElementById('biology-notebook-project-select').value = 'p1';
  document.getElementById('biology-notebook-protocol-select').value = 'pr1';
  trigger(document.getElementById('biology-notebook-experiment-form'), 'submit');
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
  let openedProcessId = '';
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {},
    createId: () => 'new-entry',
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {},
    onOpenWorkflowProcess: (id) => { openedProcessId = id; }
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions();
  notebook.openEntry('workflow-page-1');

  assert.equal(document.getElementById('biology-notebook-protocol-title').textContent, 'IPTG Expression');
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /0\.5 mM/);
  assert.equal(document.getElementById('biology-notebook-mark-executed-btn').hidden, false);
  assert.doesNotMatch(document.getElementById('biology-notebook-entry-list').innerHTML, /Untitled Project/);
  assert.equal((document.getElementById('biology-notebook-entry-list').innerHTML.match(/biology-notebook-folder-name[^>]*>Clone 12</g) || []).length, 1);
  assert.match(document.getElementById('biology-notebook-entry-list').innerHTML, /Ni-NTA Purification/);

  state.workflows = [{ id: 'workflow-1', projectId: 'p1', name: 'Histagged protein preparation' }];
  notebook.renderEntries();
  const entryList = document.getElementById('biology-notebook-entry-list');
  assert.match(entryList.innerHTML, /data-notebook-process-id="workflow-1"/);
  trigger(entryList, 'click', { target: entryList.querySelector('[data-notebook-process-id]') });
  assert.equal(openedProcessId, 'workflow-1');
});
test('biology-notebook project folder click renders the project dashboard in place', async () => {
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

  let persistCalls = 0;
  let projectsChangedCalls = 0;
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
    createId: () => 'new-entry',
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {},
    onProjectsChanged: () => {
      projectsChangedCalls += 1;
    }
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
  assert.match(entryList.innerHTML, /biology-notebook-folder-children biology-notebook-folder-children--pages[^>]*folder-tree-template__children[^>]*hidden/);

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
  assert.match(dashboard.innerHTML, /data-project-description="p1"/);
  assert.doesNotMatch(dashboard.innerHTML, /data-project-edit/);
  assert.equal(document.getElementById('biology-notebook-project-select').value, 'p1');
  assert.equal(document.getElementById('biology-notebook-page-starter-project').textContent, 'Atlas');
  assert.match(entryList.innerHTML, /biology-notebook-folder biology-notebook-folder--project[^"']*is-active/);

  const descriptionInput = dashboard.querySelector('[data-project-description]');
  descriptionInput.value = 'Updated project context from overview.';
  trigger(dashboard, 'input', { target: descriptionInput });

  assert.equal(state.projects[0].description, 'Updated project context from overview.');
  assert.equal(typeof state.projects[0].updatedAt, 'string');
  assert.equal(persistCalls, 1);
  assert.equal(projectsChangedCalls, 1);

  const protocolSelect = document.getElementById('biology-notebook-protocol-select');
  protocolSelect.value = 'pr2';
  trigger(protocolSelect, 'change');

  assert.equal(dashboard.hidden, true);
  assert.equal(document.getElementById('biology-notebook-protocol-area').hidden, false);
  assert.equal(document.getElementById('biology-notebook-protocol-title').textContent, 'Fresh Protocol');
  assert.match(document.getElementById('biology-notebook-protocol-meta').textContent, /Atlas protocol draft/);
  assert.equal(document.getElementById('biology-notebook-page-starter-project').textContent, 'Atlas');

  document.getElementById('biology-notebook-result').value = 'Observed healthy cells after setup.';
  const agentContext = notebook.getAgentChatContext();
  assert.equal(agentContext.scopeType, 'notebook');
  assert.equal(agentContext.projectId, 'p1');
  assert.equal(agentContext.protocolId, 'pr2');
  assert.equal(agentContext.hiddenContext.kind, 'notebook-page');
  assert.match(agentContext.hiddenContext.text, /Active biology notebook page/);
  assert.match(agentContext.hiddenContext.text, /Run the fresh protocol/);
  assert.match(agentContext.hiddenContext.text, /Observed healthy cells/);
  assert.match(agentContext.hiddenContext.text, /Entry ID: unsaved draft/);

  const appendResult = await notebook.appendAgentNotebookContent({
    notebook_entry_id: 'unsaved draft',
    page_title: 'Fresh Protocol',
    project_name: 'Atlas',
    protocol_name: 'Fresh Protocol',
    section_title: 'PBS preparation',
    content_markdown: 'Prepare 1 L of 1× PBS and adjust to pH 7.4.',
    sources: [
      { label: 'PBS formulation', detail: 'Agent-prepared routine buffer recipe.' }
    ]
  });
  assert.equal(appendResult.ok, true);
  assert.equal(appendResult.saved, false);
  assert.match(document.getElementById('biology-notebook-result').value, /## PBS preparation/);
  assert.match(document.getElementById('biology-notebook-result').value, /### Sources/);

  // A double-click must not append the same enrichment twice.
  const appendProposal = {
    proposal_id: 'proposal-append-1',
    notebook_entry_id: 'unsaved draft',
    page_title: 'Fresh Protocol',
    project_name: 'Atlas',
    protocol_name: 'Fresh Protocol',
    section_title: 'Wash buffer',
    content_markdown: 'Prepare 500 mL of wash buffer.'
  };
  const [firstAppend, secondAppend] = await Promise.all([
    notebook.appendAgentNotebookContent(appendProposal),
    notebook.appendAgentNotebookContent(appendProposal)
  ]);
  assert.equal(firstAppend.ok, true);
  assert.equal(secondAppend.ok, true);
  assert.equal(secondAppend.summary, 'This notebook enrichment was already appended.');
  assert.equal(
    document.getElementById('biology-notebook-result').value.split('## Wash buffer').length - 1,
    1
  );
});
};
