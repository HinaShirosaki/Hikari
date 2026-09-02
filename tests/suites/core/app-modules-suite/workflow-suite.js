module.exports = function registerAppWorkflowSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('workflow model normalizes execution entries and prunes invalid step state links', () => {
  let nextId = 0;
  const workflowModel = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'model.js'));
  const { createWorkflowModel } = workflowModel;
  const model = createWorkflowModel({
    createId: () => `generated-${nextId += 1}`,
    resolveDefaultAssigneeId: () => 'm1'
  });

  const normalized = model.normalizeWorkflow({
    id: 'workflow-1',
    templateId: 'template-1',
    name: 'Workflow Run',
    blocks: [
      { id: 'block-a', protocolId: 'protocol-a' },
      { id: 'block-b', type: 'text', text: 'Review colonies' }
    ],
    links: [{ id: 'link-1', fromBlockId: 'block-a', toBlockId: 'block-b' }],
    entries: [
      {
        id: 'entry-1',
        name: 'Clone 12',
        activeBranchRootIds: ['block-b', 'missing-branch'],
        stepStates: {
          'block-a': {
            status: 'completed',
            values: { 'step-1:ph-1': '20 uL' },
            result: 'PCR band present',
            resultFiles: ['gel.png'],
            notebookEntryId: 'nb-1',
            completedAt: '2026-04-09T10:00:00.000Z'
          },
          'missing-block': {
            status: 'completed'
          }
        }
      }
    ]
  });

  assert.equal(normalized.templateId, 'template-1');
  assert.equal(normalized.entries.length, 1);
  assert.deepEqual([...normalized.entries[0].activeBranchRootIds], ['block-b']);
  assert.deepEqual([...Object.keys(normalized.entries[0].stepStates)], ['block-a']);
  assert.equal(normalized.entries[0].stepStates['block-a'].status, 'completed');
  assert.equal(normalized.entries[0].stepStates['block-a'].values['step-1:ph-1'], '20 uL');
  assert.equal(normalized.entries[0].stepStates['block-a'].notebookEntryId, 'nb-1');
});

test('workflow execution layout keeps main path separate from manual branches and computes next step order', () => {
  const execution = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'execution.js'));
  const { buildWorkflowExecutionLayout, computeEntryProgress, isWorkflowStepOpenable } = execution;
  const workflow = {
    id: 'workflow-branch',
    blocks: [
      { id: 'a', protocolId: 'p-a', x: 40, y: 40 },
      { id: 'b', protocolId: 'p-b', x: 240, y: 40 },
      { id: 'c', protocolId: 'p-c', x: 440, y: 40 },
      { id: 'd', protocolId: 'p-d', x: 260, y: 180 },
      { id: 'e', protocolId: 'p-e', x: 460, y: 180 },
      { id: 'f', protocolId: 'p-f', x: 260, y: 300 },
      { id: 'g', protocolId: 'p-g', x: 460, y: 300 }
    ],
    links: [
      { fromBlockId: 'a', toBlockId: 'b' },
      { fromBlockId: 'b', toBlockId: 'c' },
      { fromBlockId: 'b', toBlockId: 'd' },
      { fromBlockId: 'd', toBlockId: 'e' },
      { fromBlockId: 'b', toBlockId: 'f' },
      { fromBlockId: 'f', toBlockId: 'g' }
    ]
  };
  const layout = buildWorkflowExecutionLayout(workflow);
  const inactiveBranchEntry = {
    id: 'entry-1',
    activeBranchRootIds: [],
    stepStates: {
      a: { status: 'completed' },
      b: { status: 'completed' }
    }
  };
  const activeBranchEntry = {
    id: 'entry-2',
    activeBranchRootIds: ['d', 'f'],
    stepStates: {
      a: { status: 'completed' },
      b: { status: 'completed' },
      d: { status: 'completed' }
    }
  };

  const inactiveProgress = computeEntryProgress(inactiveBranchEntry, layout);
  const activeProgress = computeEntryProgress(activeBranchEntry, layout);

  assert.deepEqual([...layout.mainPathIds], ['a', 'b', 'c']);
  assert.equal(layout.branches.length, 2);
  assert.equal(layout.branches[0].rootId, 'd');
  assert.deepEqual([...layout.branches[0].blockIds], ['d', 'e']);
  assert.equal(layout.branches[1].rootId, 'f');
  assert.deepEqual([...layout.branches[1].blockIds], ['f', 'g']);
  assert.equal(inactiveProgress.totalSteps, 3);
  assert.equal(inactiveProgress.nextBlockId, 'c');
  assert.equal(activeProgress.totalSteps, 7);
  assert.equal(activeProgress.completedSteps, 3);
  assert.equal(activeProgress.nextBlockId, 'e');
  assert.equal(activeProgress.percentComplete, 43);
  assert.equal(isWorkflowStepOpenable(activeBranchEntry, layout, 'a'), true);
  assert.equal(isWorkflowStepOpenable(activeBranchEntry, layout, 'e'), true);
  assert.equal(isWorkflowStepOpenable(activeBranchEntry, layout, 'f'), true);
  assert.equal(isWorkflowStepOpenable(activeBranchEntry, layout, 'g'), false);
  assert.equal(isWorkflowStepOpenable(activeBranchEntry, layout, 'c'), true);

  activeBranchEntry.stepStates.d.status = 'failed';
  assert.equal(isWorkflowStepOpenable(activeBranchEntry, layout, 'd'), true);
  assert.equal(isWorkflowStepOpenable(activeBranchEntry, layout, 'e'), false);
  assert.equal(isWorkflowStepOpenable(activeBranchEntry, layout, 'f'), true);
  assert.equal(isWorkflowStepOpenable(activeBranchEntry, layout, 'c'), true);
});

test('workflow template instantiation preserves linked project id', () => {
  let nextId = 0;
  const workflowModel = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'model.js'));
  const { createWorkflowModel } = workflowModel;
  const model = createWorkflowModel({
    createId: () => `generated-${nextId += 1}`,
    resolveDefaultAssigneeId: () => 'm1'
  });

  const template = model.normalizeTemplate({
    id: 'template-1',
    name: 'Protein Expression',
    projectId: 'project-1',
    blocks: [
      { id: 'block-a', protocolId: 'protocol-a' }
    ],
    links: []
  });
  const workflow = model.instantiateTemplate(template, 'Protein Expression 1');

  assert.equal(template.projectId, 'project-1');
  assert.equal(workflow.projectId, 'project-1');
  assert.equal(workflow.templateId, 'template-1');
});

test('workflow execution blocks later steps and closes quick fill on blank board clicks', () => {
  const windowObject = {
    addEventListener() {},
    alert() {}
  };
  const actionsModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'actions.js'),
    {
      window: windowObject,
      FileReader: class {}
    }
  );
  const { createWorkflowActions } = actionsModule;
  const workflowExecutionBoard = new MockElement('workflow-execution-board');
  const workflow = {
    id: 'workflow-1',
    templateId: 'template-1',
    name: 'Sequential workflow',
    blocks: [
      { id: 'block-a', protocolId: 'protocol-a', x: 40, y: 40 },
      { id: 'block-b', protocolId: 'protocol-b', x: 240, y: 40 },
      { id: 'block-c', protocolId: 'protocol-c', x: 440, y: 40 }
    ],
    links: [
      { fromBlockId: 'block-a', toBlockId: 'block-b' },
      { fromBlockId: 'block-b', toBlockId: 'block-c' }
    ],
    entries: [{
      id: 'entry-1',
      name: 'Sequential workflow',
      stepStates: {
        'block-a': { status: 'pending' },
        'block-b': { status: 'not_done' },
        'block-c': { status: 'not_done' }
      }
    }]
  };
  const state = {
    workflows: [workflow],
    workflowTemplates: []
  };
  const runtime = {
    activeWorkflowId: 'workflow-1',
    activeEntryId: 'entry-1',
    activeBlockId: '',
    draft: { blocks: [], links: [], entries: [], notebookEntryIds: [] }
  };
  let renderCount = 0;
  const actions = createWorkflowActions({
    state,
    runtime,
    elements: { workflowExecutionBoard },
    renderer: {
      renderExecutionBoard() {
        renderCount += 1;
      }
    },
    graphController: {},
    windowObject
  });
  actions.bindEvents();

  const stepTarget = (blockId) => ({
    closest(selector) {
      return selector === '[data-workflow-step-open]'
        ? {
            dataset: {
              workflowWorkflowId: 'workflow-1',
              workflowEntryId: 'entry-1',
              workflowStepOpen: blockId
            }
          }
        : null;
    }
  });
  const blankTarget = {
    closest() {
      return null;
    }
  };
  workflowExecutionBoard.dispatch('click', { target: stepTarget('block-b') });
  assert.equal(runtime.activeBlockId, '');
  assert.equal(renderCount, 0);

  workflow.entries[0].stepStates['block-a'].status = 'completed';
  workflowExecutionBoard.dispatch('click', { target: stepTarget('block-b') });
  assert.equal(runtime.activeBlockId, 'block-b');
  assert.equal(renderCount, 1);

  workflowExecutionBoard.dispatch('click', { target: blankTarget });
  assert.equal(runtime.activeBlockId, '');
  assert.equal(renderCount, 2);

  workflow.entries[0].stepStates['block-b'].status = 'failed';
  workflowExecutionBoard.dispatch('click', { target: stepTarget('block-c') });
  assert.equal(runtime.activeBlockId, '');
  assert.equal(renderCount, 2);
});

test('workflow execution renderer keeps the active step editor inside the workflow board', () => {
  const rendererModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'renderer.js'),
    {
      window: {
        requestAnimationFrame(callback) {
          if (typeof callback === 'function') {
            callback();
          }
        }
      }
    }
  );
  const { createWorkflowRenderer } = rendererModule;

  const board = {
    innerHTML: '',
    querySelector() {
      return null;
    }
  };
  const elements = {
    workflowExecutionBoard: board,
    workflowExecutionTitle: { textContent: '' },
    workflowAddRunBtn: { disabled: false },
    workflowDeleteRunBtn: { disabled: false },
    workflowSearchInput: { value: '' }
  };
  const renderer = createWorkflowRenderer({
    state: {
      protocols: [
        {
          id: 'protocol-a',
          name: 'Ni-NTA Purification',
          steps: [
            {
              id: 'step-1',
              text: 'Load {{ph:amount}} of clarified lysate onto the column.',
              placeholders: [{ id: 'amount-1', name: 'amount' }]
            },
            {
              id: 'step-2',
              text: 'Elute with {{ph:volume}} of buffer.',
              placeholders: [{ id: 'volume-1', name: 'volume' }]
            }
          ]
        }
      ],
      workflowTemplates: [
        {
          id: 'template-1',
          name: 'NiNTA',
          blocks: [
            { id: 'block-a', protocolId: 'protocol-a', x: 40, y: 40 },
            { id: 'block-b', type: 'text', text: 'Record purification yield', x: 240, y: 40 },
            { id: 'block-c', type: 'text', text: 'Review final yield', x: 440, y: 40 }
          ],
          links: [
            { fromBlockId: 'block-a', toBlockId: 'block-b' },
            { fromBlockId: 'block-b', toBlockId: 'block-c' }
          ]
        }
      ],
      workflows: [
        {
          id: 'workflow-1',
          templateId: 'template-1',
          name: 'NiNTA 1',
          blocks: [
            { id: 'block-a', protocolId: 'protocol-a', x: 40, y: 40 },
            { id: 'block-b', type: 'text', text: 'Record purification yield', x: 240, y: 40 },
            { id: 'block-c', type: 'text', text: 'Review final yield', x: 440, y: 40 }
          ],
          links: [
            { fromBlockId: 'block-a', toBlockId: 'block-b' },
            { fromBlockId: 'block-b', toBlockId: 'block-c' }
          ],
          entries: [
            {
              id: 'entry-1',
              name: 'NiNTA 1',
              stepStates: {
                'block-a': {
                  status: 'completed',
                  values: { 'step-1:amount-1': '10 mL' }
                },
                'block-b': { status: 'pending' }
              }
            }
          ]
        }
      ]
    },
    runtime: {
      activeTemplateId: 'template-1',
      activeWorkflowId: 'workflow-1',
      activeEntryId: 'entry-1',
      activeBlockId: 'block-a'
    },
    elements,
    safeText: (value) => String(value || ''),
    getBlockType: (block) => String(block?.type || (block?.protocolId ? 'protocol' : '')),
    uniqueStrings: (values) => Array.from(new Set(values || []))
  });

  renderer.renderExecutionBoard();

  assert.equal(elements.workflowExecutionTitle.textContent, 'NiNTA');
  assert.match(board.innerHTML, /workflow-execution-shell/);
  assert.match(board.innerHTML, /workflow-progress-track-line/);
  assert.doesNotMatch(board.innerHTML, /workflow-progress-connector/);
  assert.match(board.innerHTML, /data-workflow-step-open="block-c"[\s\S]*disabled aria-disabled="true"/);
  assert.match(board.innerHTML, /data-workflow-step-popover="true"/);
  assert.match(board.innerHTML, /workflow-placeholder-table[\s\S]*<th scope="row">amount<\/th>/);
  assert.match(board.innerHTML, /workflow-placeholder-table[\s\S]*value="10 mL"[\s\S]*placeholder="Enter value"/);
  assert.match(board.innerHTML, /aria-label="Workflow name"[\s\S]*data-workflow-run-name="workflow-1"/);
  assert.doesNotMatch(board.innerHTML, /% complete/);
  assert.doesNotMatch(board.innerHTML, /workflow-placeholder-field-context|workflow-step-editor-header|workflow-step-status-picker/);
  assert.doesNotMatch(board.innerHTML, /workflow-step-detail-panel/);
});

test('workflow execution renderer places branch protocols on a bottom lane anchored to the parent dot', () => {
  const rendererModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'renderer.js'),
    {
      window: {
        requestAnimationFrame(callback) {
          if (typeof callback === 'function') {
            callback();
          }
        }
      }
    }
  );
  const { createWorkflowRenderer } = rendererModule;

  const board = {
    innerHTML: '',
    querySelector() {
      return null;
    }
  };
  const blocks = [
    { id: 'block-a', protocolId: 'protocol-a', x: 40, y: 40 },
    { id: 'block-b', protocolId: 'protocol-b', x: 240, y: 40 },
    { id: 'block-c', protocolId: 'protocol-c', x: 440, y: 40 },
    { id: 'block-d', protocolId: 'protocol-d', x: 260, y: 180 },
    { id: 'block-e', protocolId: 'protocol-e', x: 460, y: 180 }
  ];
  const links = [
    { fromBlockId: 'block-a', toBlockId: 'block-b' },
    { fromBlockId: 'block-b', toBlockId: 'block-c' },
    { fromBlockId: 'block-b', toBlockId: 'block-d' },
    { fromBlockId: 'block-d', toBlockId: 'block-e' }
  ];
  const elements = {
    workflowExecutionBoard: board,
    workflowExecutionTitle: { textContent: '' },
    workflowAddRunBtn: { disabled: false },
    workflowDeleteRunBtn: { disabled: false },
    workflowSearchInput: { value: '' }
  };
  const renderer = createWorkflowRenderer({
    state: {
      protocols: [
        { id: 'protocol-a', name: 'Start' },
        { id: 'protocol-b', name: 'Parent' },
        { id: 'protocol-c', name: 'Finish' },
        { id: 'protocol-d', name: 'Branch Root' },
        { id: 'protocol-e', name: 'Branch Follow-up' }
      ],
      workflowTemplates: [
        {
          id: 'template-branch',
          name: 'Make',
          blocks,
          links
        }
      ],
      workflows: [
        {
          id: 'workflow-make',
          templateId: 'template-branch',
          name: 'Make',
          blocks,
          links,
          entries: [
            {
              id: 'entry-make',
              name: 'Make',
              activeBranchRootIds: [],
              stepStates: {
                'block-a': { status: 'completed' },
                'block-b': { status: 'completed' }
              }
            }
          ]
        }
      ]
    },
    runtime: {
      activeTemplateId: 'template-branch',
      activeWorkflowId: 'workflow-make',
      activeEntryId: 'entry-make',
      activeBlockId: ''
    },
    elements,
    safeText: (value) => String(value || ''),
    getBlockType: (block) => String(block?.type || (block?.protocolId ? 'protocol' : '')),
    uniqueStrings: (values) => Array.from(new Set(values || []))
  });

  renderer.renderExecutionBoard();

  assert.match(board.innerHTML, /workflow-progress-track-grid/);
  assert.match(board.innerHTML, /--workflow-step-count: 3; --workflow-track-row-count: 2;/);
  assert.match(board.innerHTML, /class="workflow-progress-track-line"[\s\S]*--workflow-track-segment-width: 66\.666/);
  assert.match(board.innerHTML, /workflow-progress-main-cell[\s\S]*style="grid-column: 2; grid-row: 1;"[\s\S]*data-workflow-step-open="block-b"/);
  assert.match(board.innerHTML, /workflow-progress-branch-track-line is-inactive/);
  assert.match(board.innerHTML, /class="workflow-progress-cell workflow-progress-branch-cell is-branch-root is-branch-inactive"[\s\S]*style="grid-column: 2; grid-row: 2; --workflow-branch-row-offset: 1;"[\s\S]*data-workflow-branch-parent="block-b"/);
  assert.match(board.innerHTML, /workflow-progress-branch-label">Branch Root<\/span>/);
  assert.match(board.innerHTML, /workflow-progress-branch-label">Branch Follow-up<\/span>/);
  assert.match(board.innerHTML, /data-workflow-branch-toggle="block-d"/);
  assert.match(board.innerHTML, /style="grid-column: 3; grid-row: 2; --workflow-branch-row-offset: 1;"[\s\S]*data-workflow-step-open="block-e"[\s\S]*disabled aria-disabled="true"/);
});

test('workflow template navigation and graph actions use compact accessible icons', () => {
  const viewSource = fs.readFileSync(path.join(__dirname, 'ui', 'html', 'views', 'workflow-management-view.html'), 'utf8');
  const viewCss = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'views', 'workflow-management-view.css'), 'utf8');

  assert.match(viewSource, /id="workflow-entry-back-btn"[^>]*class="workflow-entry-back-icon-btn"[^>]*aria-label="Back to Home"[^>]*>[\s\S]*<svg[\s\S]*<span class="sr-only">Back to Home<\/span>/);
  assert.match(viewSource, /id="workflow-save-template-btn"[^>]*class="primary-btn workflow-template-action-icon-btn"[^>]*aria-label="Save Current Graph"[^>]*>[\s\S]*<svg[\s\S]*<span class="sr-only">Save Current Graph<\/span>/);
  assert.match(viewSource, /id="workflow-template-cancel-btn"[^>]*class="ghost-btn workflow-template-action-icon-btn"[^>]*aria-label="Cancel"[^>]*>[\s\S]*<svg[\s\S]*<span class="sr-only">Cancel<\/span>/);
  assert.match(viewCss, /\.workflow-entry-panel > \.workflow-entry-back-icon-btn \{[\s\S]*?width: 30px;[\s\S]*?height: 30px;[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
  assert.match(viewCss, /\.workflow-template-actions > \.workflow-template-action-icon-btn \{[\s\S]*?width: 30px;[\s\S]*?height: 30px;/);
  assert.match(viewCss, /\.workflow-editor-sidebar-pinned\.left-rail-template__pinned \{[\s\S]*?border-bottom: 0;/);
  assert.match(viewCss, /\.workflow-editor-sidebar-scroll > \.workflow-template-editor-panel,[\s\S]*?\.workflow-editor-sidebar-scroll > \.workflow-block-composer-panel \{[\s\S]*?padding-top: 0;[\s\S]*?border-top: 0;/);
  assert.match(viewCss, /\.workflow-editor-sidebar-scroll\.left-rail-template__scroll \{[\s\S]*?gap: 16px;/);
});

test('workflow template editor omits redundant headings while retaining its controls', () => {
  const viewSource = fs.readFileSync(path.join(__dirname, 'ui', 'html', 'views', 'workflow-management-view.html'), 'utf8');
  const graphRenderingSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'graph', 'rendering.js'), 'utf8');
  const graphControllerSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'graph-controller.js'), 'utf8');

  assert.doesNotMatch(viewSource, /<h3>(?:Template Details|Add Blocks)<\/h3>/);
  assert.match(viewSource, /id="workflow-template-name"/);
  assert.match(viewSource, /id="workflow-template-description"/);
  assert.match(viewSource, /id="workflow-save-template-btn"/);
  assert.match(viewSource, /id="workflow-template-cancel-btn"/);
  assert.match(viewSource, /<fieldset id="workflow-block-type" class="workflow-block-type-switch">/);
  assert.match(viewSource, /name="workflow-block-type-option" value="protocol" checked/);
  assert.match(viewSource, /name="workflow-block-type-option" value="text"/);
  assert.doesNotMatch(viewSource, /<select id="workflow-block-type">/);
  assert.match(viewSource, /id="workflow-block-add-btn"/);
  assert.doesNotMatch(viewSource, /id="workflow-graph-status"/);
  assert.doesNotMatch(graphRenderingSource, /setGraphStatus|Tip: Drag blocks|Connecting from/);
  assert.doesNotMatch(graphControllerSource, /setGraphStatus|Selection cleared\.|Connection created\.|Connection mode canceled\./);
  assert.match(viewSource, /id="workflow-graph-context-menu"/);

  const actionsSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'actions.js'), 'utf8');
  assert.match(actionsSource, /addEventListener\('keydown', onBlockTypeKeydown\)/);
  assert.match(actionsSource, /event\.key === 'ArrowRight'[\s\S]*event\.key === 'ArrowLeft'/);
});

test('workflow protocol picker matches the Biology Notebook search-result pattern', () => {
  const viewSource = fs.readFileSync(path.join(__dirname, 'ui', 'html', 'views', 'workflow-management-view.html'), 'utf8');
  const viewCss = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'views', 'workflow-management-view.css'), 'utf8');

  assert.match(viewSource, /Search &amp; Select Protocol/);
  assert.match(viewSource, /id="workflow-block-protocol-search"[^>]*autocomplete="off"[^>]*aria-controls="workflow-block-protocol-search-results"/);
  assert.match(viewSource, /id="workflow-block-protocol-search-results"[^>]*role="listbox"[^>]*aria-label="Matching protocols"/);
  assert.match(viewSource, /id="workflow-block-protocol" hidden aria-hidden="true" tabindex="-1"/);
  assert.match(viewCss, /\.workflow-block-protocol-search-results \{[\s\S]*?max-height: min\(34vh, 240px\);[\s\S]*?overflow-y: auto;/);
  assert.match(viewCss, /\.workflow-block-protocol-search-result:hover,[\s\S]*?\.workflow-block-protocol-search-result\.is-selected \{/);

  const optionListsModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'renderer', 'option-lists.js')
  );
  const results = { innerHTML: '' };
  const search = { value: 'wash' };
  const select = { value: 'protocol-wash' };
  const optionLists = optionListsModule.createWorkflowOptionLists({
    state: {
      protocols: [
        { id: 'protocol-lysis', name: 'Cell Lysis' },
        { id: 'protocol-wash', name: 'Wash Cells' }
      ]
    },
    elements: {
      workflowBlockProtocolResults: results,
      workflowBlockProtocolSearchInput: search,
      workflowBlockProtocolInput: select
    },
    safeText: (value) => String(value || '')
  });

  optionLists.renderProtocolResults();
  assert.doesNotMatch(results.innerHTML, /Cell Lysis/);
  assert.match(results.innerHTML, /data-workflow-block-protocol-id="protocol-wash"/);
  assert.match(results.innerHTML, /class="workflow-block-protocol-search-result is-selected"/);
  assert.match(results.innerHTML, /aria-selected="true"/);

  search.value = 'missing';
  optionLists.renderProtocolResults();
  assert.equal(results.innerHTML, '<p class="workflow-block-protocol-search-empty">No matching protocols.</p>');
});

test('workflow protocol picker clears stale selection on search and selects result rows', () => {
  const windowObject = {
    addEventListener() {},
    alert() {}
  };
  const actionsModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'actions.js'),
    {
      window: windowObject,
      FileReader: class {}
    }
  );
  const listeners = {};
  const protocolInput = { value: 'protocol-lysis' };
  const searchInput = {
    addEventListener(type, handler) {
      listeners[`search:${type}`] = handler;
    }
  };
  const results = {
    addEventListener(type, handler) {
      listeners[`results:${type}`] = handler;
    }
  };
  let renderCount = 0;
  const actions = actionsModule.createWorkflowActions({
    state: {
      protocols: [
        { id: 'protocol-lysis', name: 'Cell Lysis' },
        { id: 'protocol-wash', name: 'Wash Cells' }
      ],
      workflows: [],
      workflowTemplates: []
    },
    runtime: {
      draft: { blocks: [], links: [], entries: [], notebookEntryIds: [] }
    },
    elements: {
      workflowBlockProtocolInput: protocolInput,
      workflowBlockProtocolSearchInput: searchInput,
      workflowBlockProtocolResults: results
    },
    renderer: {
      renderProtocolPicker() {
        renderCount += 1;
      }
    },
    graphController: {},
    windowObject
  });

  actions.bindEvents();
  listeners['search:input']();
  assert.equal(protocolInput.value, '');
  assert.equal(renderCount, 1);

  const resultButton = {
    dataset: { workflowBlockProtocolId: 'protocol-wash' },
    closest() {
      return this;
    }
  };
  listeners['results:click']({ target: resultButton });
  assert.equal(protocolInput.value, 'protocol-wash');
  assert.equal(renderCount, 2);
});

test('workflow block type switch synchronizes protocol and plain-text composer fields', () => {
  const rendererModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'renderer.js')
  );
  const { createWorkflowRenderer } = rendererModule;
  const options = [
    { value: 'protocol', checked: true },
    { value: 'text', checked: false }
  ];
  const blockTypeControl = {
    querySelector() {
      return options.find((option) => option.checked) || null;
    },
    querySelectorAll() {
      return options;
    }
  };
  const elements = {
    workflowBlockTypeControl: blockTypeControl,
    workflowBlockProtocolSearchField: { hidden: false },
    workflowBlockProtocolField: { hidden: false },
    workflowBlockTextField: { hidden: true },
    workflowBlockProtocolInput: { disabled: false },
    workflowBlockTextInput: { disabled: true },
    workflowBlockAddBtn: { textContent: '' }
  };
  const renderer = createWorkflowRenderer({ elements });

  renderer.syncBlockComposerFields();
  assert.equal(elements.workflowBlockProtocolSearchField.hidden, false);
  assert.equal(elements.workflowBlockTextField.hidden, true);
  assert.equal(elements.workflowBlockAddBtn.textContent, 'Add Protocol Block');

  options[0].checked = false;
  options[1].checked = true;
  renderer.syncBlockComposerFields();
  assert.equal(elements.workflowBlockProtocolSearchField.hidden, true);
  assert.equal(elements.workflowBlockProtocolField.hidden, true);
  assert.equal(elements.workflowBlockTextField.hidden, false);
  assert.equal(elements.workflowBlockProtocolInput.disabled, true);
  assert.equal(elements.workflowBlockTextInput.disabled, false);
  assert.equal(elements.workflowBlockAddBtn.textContent, 'Add Text Block');
});

  }
};
