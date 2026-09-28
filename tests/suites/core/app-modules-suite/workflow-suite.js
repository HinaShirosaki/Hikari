module.exports = function registerAppWorkflowSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const { assert, fs, path, loadEsmStyleModule, MockElement, test } = scope;
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
            values: { 'ph-1': '20 uL' },
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
  assert.equal(normalized.entries[0].stepStates['block-a'].values['ph-1'], '20 uL');
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

test('workflow template instantiation leaves project assignment to each process', () => {
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
  assert.equal(workflow.projectId, '');
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

test('workflow execution renderer lists runs as a ledger and opens the selected run in a drawer', () => {
  const rendererModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'renderer.js'),
    { window: {} }
  );
  const { createWorkflowRenderer } = rendererModule;

  const board = { innerHTML: '' };
  const elements = {
    workflowExecutionBoard: board,
    workflowExecutionTitle: { textContent: '' },
    workflowAddRunBtn: { disabled: false },
    workflowDeleteRunBtn: { disabled: false },
    workflowSearchInput: { value: '' }
  };
  const blocks = [
    { id: 'block-a', protocolId: 'protocol-a', x: 40, y: 40 },
    { id: 'block-b', type: 'text', text: 'Record purification yield', x: 240, y: 40 },
    { id: 'block-c', type: 'text', text: 'Review final yield', x: 440, y: 40 }
  ];
  const links = [
    { fromBlockId: 'block-a', toBlockId: 'block-b' },
    { fromBlockId: 'block-b', toBlockId: 'block-c' }
  ];
  const renderer = createWorkflowRenderer({
    state: {
      projects: [{ id: 'project-1', name: 'GFP reporter panel' }],
      protocols: [
        {
          id: 'protocol-a',
          name: 'Ni-NTA Purification',
          steps: [
            {
              text: 'Load {{ph:amount}} of clarified lysate onto the column.',
              placeholders: [{ id: 'amount-1', name: 'amount' }]
            }
          ]
        }
      ],
      workflowTemplates: [{ id: 'template-1', name: 'NiNTA', blocks, links }],
      workflows: [
        {
          id: 'workflow-1',
          templateId: 'template-1',
          name: 'NiNTA 1',
          projectId: 'project-1',
          blocks,
          links,
          entries: [
            {
              id: 'entry-1',
              name: 'NiNTA 1',
              stepStates: {
                'block-a': { status: 'completed', values: { 'amount-1': '10 mL' } },
                'block-b': { status: 'pending' }
              }
            }
          ]
        },
        {
          id: 'workflow-2',
          templateId: 'template-1',
          name: 'NiNTA 2',
          blocks,
          links,
          entries: [{ id: 'entry-2', name: 'NiNTA 2', stepStates: {} }]
        }
      ]
    },
    runtime: {
      activeTemplateId: 'template-1',
      activeWorkflowId: 'workflow-1',
      activeEntryId: 'entry-1',
      activeBlockId: ''
    },
    elements,
    safeText: (value) => String(value || ''),
    getBlockType: (block) => String(block?.type || (block?.protocolId ? 'protocol' : '')),
    uniqueStrings: (values) => Array.from(new Set(values || [])),
    parseTimestamp: (value) => Date.parse(String(value || '')) || 0,
    formatTimestamp: (value) => String(value || '-')
  });

  renderer.renderExecutionBoard();

  assert.equal(elements.workflowExecutionTitle.textContent, 'NiNTA');
  assert.match(board.innerHTML, /<table class="workflow-ledger">/);
  assert.match(board.innerHTML, /<th>Process<\/th>\s*<th>Progress<\/th>\s*<th>Next step<\/th>\s*<th>Updated<\/th>/);
  assert.doesNotMatch(board.innerHTML, /Entity|workflow-progress-track|data-workflow-step-popover/);
  // Every run is one row; the selected run is highlighted and its name is not an inline input.
  assert.match(board.innerHTML, /workflow-ledger-row is-selected" data-workflow-run-open="workflow-1"[\s\S]*workflow-ledger-name">NiNTA 1<\/div>/);
  assert.match(board.innerHTML, /workflow-ledger-row" data-workflow-run-open="workflow-2"/);
  assert.match(board.innerHTML, /workflow-project-heading[\s\S]*GFP reporter panel[\s\S]*data-workflow-project-add="project-1"[\s\S]*data-workflow-run-open="workflow-1"/);
  assert.match(board.innerHTML, /workflow-project-heading[\s\S]*No project[\s\S]*data-workflow-run-open="workflow-2"/);
  const ledger = board.innerHTML.slice(0, board.innerHTML.indexOf('<aside class="workflow-drawer"'));
  assert.doesNotMatch(ledger, /data-workflow-run-name=/);
  // Stepper: done, next (pending), locked.
  assert.match(board.innerHTML, /workflow-stepper-node is-finished"[\s\S]*data-workflow-step-open="block-a"/);
  assert.match(board.innerHTML, /workflow-stepper-node is-pending"[\s\S]*data-workflow-step-open="block-b"/);
  assert.match(board.innerHTML, /workflow-stepper-node is-empty is-locked"[\s\S]*data-workflow-step-open="block-c"[\s\S]*disabled aria-disabled="true"/);
  assert.match(board.innerHTML, /workflow-ledger-count">1\/3</);
  assert.match(board.innerHTML, /workflow-ledger-next">Record purification yield<\/span> <span class="workflow-ledger-chip is-warn">In progress/);
  assert.match(board.innerHTML, /data-workflow-run-open="workflow-2"[\s\S]*workflow-ledger-count">0\/3<[\s\S]*workflow-ledger-next">Ni-NTA Purification<\/span><\/td>/);
  // Drawer for the selected run, with the step that is due unfolded and its controls restored.
  const drawer = board.innerHTML.slice(board.innerHTML.indexOf('<aside class="workflow-drawer"'));
  assert.match(drawer, /aria-label="Workflow name" value="NiNTA 1" data-workflow-run-name="workflow-1"/);
  assert.match(drawer, /data-workflow-drawer-close="true"/);
  assert.match(drawer, /workflow-drawer-progress-bar"><i style="width: 33%;">/);
  assert.match(drawer, /<details class="workflow-drawer-details" >\s*<summary data-workflow-drawer-toggle="block-a"[\s\S]*Ni-NTA Purification/);
  assert.match(drawer, /<details class="workflow-drawer-details" open>\s*<summary data-workflow-drawer-toggle="block-b"/);
  assert.match(drawer, /<details class="workflow-drawer-details" >\s*<summary >[\s\S]*Review final yield/);
  assert.match(drawer, /workflow-placeholder-table[\s\S]*<th scope="row">amount<\/th>[\s\S]*data-workflow-step-value="amount-1"[\s\S]*value="10 mL"/);
  assert.match(drawer, /data-workflow-step-status="not_done" data-workflow-block-id="block-a"[\s\S]*>Reopen</);
  assert.match(drawer, /class="primary-btn" title="Mark complete" aria-label="Mark complete" data-workflow-step-status="completed" data-workflow-block-id="block-b" data-workflow-entry-id="entry-1" data-workflow-workflow-id="workflow-1" >Complete</);
  assert.match(drawer, /data-workflow-step-status="failed" data-workflow-block-id="block-b"/);
  assert.match(drawer, /data-workflow-step-result-field="block-b"/);
  assert.match(drawer, /type="file" multiple aria-label="Attach files" data-workflow-step-files="block-b"/);
  assert.match(drawer, /workflow-drawer-actions">[\s\S]*data-workflow-step-open-notebook="block-b"[\s\S]*data-workflow-step-files="block-b"/);
  assert.doesNotMatch(drawer, /data-workflow-step-create-assay/);
  assert.match(drawer, /data-workflow-step-status="completed" data-workflow-block-id="block-c" data-workflow-entry-id="entry-1" data-workflow-workflow-id="workflow-1" disabled/);
});

test('workflow execution renderer keeps main steps continuous with separate anchored branch lanes', () => {
  const rendererModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'workflow', 'renderer.js'),
    { window: {} }
  );
  const { createWorkflowRenderer } = rendererModule;

  const board = { innerHTML: '' };
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
  const runtime = {
    activeTemplateId: 'template-branch',
    activeWorkflowId: 'workflow-make',
    activeEntryId: 'entry-make',
    activeBlockId: ''
  };
  const entry = {
    id: 'entry-make',
    name: 'Make',
    activeBranchRootIds: [],
    stepStates: {
      'block-a': { status: 'completed' },
      'block-b': { status: 'completed' }
    }
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
      workflowTemplates: [{ id: 'template-branch', name: 'Make', blocks, links }],
      workflows: [{ id: 'workflow-make', templateId: 'template-branch', name: 'Make', blocks, links, entries: [entry] }]
    },
    runtime,
    elements,
    safeText: (value) => String(value || ''),
    getBlockType: (block) => String(block?.type || (block?.protocolId ? 'protocol' : '')),
    uniqueStrings: (values) => Array.from(new Set(values || [])),
    parseTimestamp: () => 0,
    formatTimestamp: () => '-'
  });

  renderer.renderExecutionBoard();

  // The main path stays together; the optional lane attaches to the parent column.
  const forkRow = board.innerHTML.slice(0, board.innerHTML.indexOf('<aside'));
  assert.match(forkRow, /data-workflow-step-open="block-b"[\s\S]*data-workflow-step-open="block-c"[\s\S]*workflow-stepper-branch" style="grid-column: 3 \/ -1; grid-row: 2"[\s\S]*workflow-stepper-fork"[^>]*aria-label="Optional branch: Branch Root → Branch Follow-up"/);
  assert.doesNotMatch(forkRow, /data-workflow-step-open="block-d"/);
  assert.match(forkRow, /workflow-ledger-count">2\/3</);
  // Drawer offers the branch as a card at the fork point.
  assert.match(board.innerHTML, /workflow-drawer-fork-card">[\s\S]*Optional branch[\s\S]*<strong>Branch Root → Branch Follow-up<\/strong>[\s\S]*data-workflow-branch-toggle="block-d"[\s\S]*>Activate</);

  entry.activeBranchRootIds = ['block-d'];
  renderer.renderExecutionBoard();

  // Active branch nodes keep their own lane and the existing execution gating.
  const activeRow = board.innerHTML.slice(0, board.innerHTML.indexOf('<aside'));
  assert.match(activeRow, /data-workflow-step-open="block-c"[\s\S]*workflow-stepper-branch is-active" style="grid-column: 3 \/ -1; grid-row: 2"[\s\S]*workflow-stepper-node is-pending is-branch"[\s\S]*data-workflow-step-open="block-d"[\s\S]*workflow-stepper-node is-empty is-branch is-locked"[\s\S]*data-workflow-step-open="block-e"/);
  assert.match(activeRow, /workflow-ledger-count">2\/5</);
  assert.doesNotMatch(activeRow, /workflow-stepper-fork/);
  // The untouched branch root can be skipped again from the drawer.
  assert.match(board.innerHTML, /workflow-step-dot is-pending is-branch"[\s\S]*data-workflow-branch-toggle="block-d"[^>]*>Skip branch</);

  entry.stepStates['block-d'] = { status: 'completed' };
  entry.stepStates['block-e'] = { status: 'completed' };
  renderer.renderExecutionBoard();
  const completedRow = board.innerHTML.slice(0, board.innerHTML.indexOf('<aside'));
  assert.match(completedRow, /workflow-stepper-branch is-active is-complete/);
  assert.match(completedRow, /workflow-stepper-link is-branch is-complete/);
  assert.match(completedRow, /workflow-ledger-count">4\/5</);

  blocks.push({ id: 'block-f', type: 'text', text: 'Second branch', x: 260, y: 300 });
  links.push({ fromBlockId: 'block-b', toBlockId: 'block-f' });
  renderer.renderExecutionBoard();
  const multipleRow = board.innerHTML.slice(0, board.innerHTML.indexOf('<aside'));
  assert.match(multipleRow, /workflow-stepper-branch is-active is-complete" style="grid-column: 3 \/ -1; grid-row: 2"/);
  assert.match(multipleRow, /workflow-stepper-branch" style="grid-column: 3 \/ -1; grid-row: 3"/);
  assert.match(multipleRow, /workflow-ledger-count">4\/5</);
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
  assert.match(viewCss, /\.workflow-editor-sidebar-scroll\.left-rail-template__scroll \{[\s\S]*?gap: var\(--space-16\);/);
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
  assert.match(viewCss, /\.workflow-block-protocol-search-results \{[\s\S]*?gap: var\(--space-2\);[\s\S]*?max-height: min\(34vh, 240px\);[\s\S]*?overflow-y: auto;/);
  assert.match(viewCss, /\.workflow-block-protocol-search-result,[\s\S]*?\.workflow-block-protocol-search-empty \{[\s\S]*?min-height: 2\.25rem;[\s\S]*?padding: var\(--space-6\) var\(--space-8\);[\s\S]*?line-height: 1\.4;[\s\S]*?overflow-wrap: anywhere;/);
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

test('workflow processes share a template across projects without sharing execution state', () => {
  let nextId = 0;
  const model = loadEsmStyleModule(path.join(__dirname, 'src/renderer/modules/workflow/model.js')).createWorkflowModel({ createId: () => `id-${++nextId}` });
  const template = model.normalizeTemplate({ id: 'template', name: 'Screen', projectId: 'legacy', blocks: [{ id: 'a', type: 'text', text: 'Prepare' }], links: [] });
  const state = { workflowTemplates: [template], workflows: [], projects: [{ id: 'p1' }, { id: 'p2' }] };
  let persisted = 0;
  const actions = loadEsmStyleModule(path.join(__dirname, 'src/renderer/modules/workflow/actions.js'), { window: {} }).createWorkflowActions({
    state, runtime: {}, ...model, createId: () => `id-${++nextId}`, persist: () => { persisted++; }
  });
  const first = actions.createWorkflowFromTemplateRecord(template, { projectId: 'p1', workflowName: 'First' });
  const second = actions.createWorkflowFromTemplateRecord(template, { projectId: 'p1' });
  const other = actions.createWorkflowFromTemplateRecord(template, { projectId: 'p2' });
  const unassigned = actions.createWorkflowFromTemplateRecord(template, { projectId: '' });
  assert.equal(persisted, 4);
  assert.equal(first.projectId, 'p1');
  assert.equal(second.projectId, 'p1');
  assert.equal(other.projectId, 'p2');
  assert.equal(unassigned.projectId, '');
  assert.equal(other.templateId, first.templateId);
  first.entries[0].stepStates[first.blocks[0].id] = { status: 'completed' };
  template.blocks[0].text = 'Changed template';
  assert.equal(second.blocks[0].text, 'Prepare');
  assert.equal(Object.keys(second.entries[0].stepStates).length, 0);
  assert.notEqual(first.blocks[0].id, second.blocks[0].id);

  const dashboard = loadEsmStyleModule(path.join(__dirname, 'src/renderer/modules/biology-notebook/project/project-dashboard-renderer.js'))
    .createProjectDashboardRenderer({ state, safeText: (value) => String(value || '') });
  const markup = dashboard.renderDashboard({ id: 'p1', name: 'Project One' });
  assert.match(markup, /data-project-workflow-add="p1"/);
  assert.ok(markup.includes(`data-project-process-open="${first.id}"`));
  assert.ok(markup.includes(`data-project-process-open="${second.id}"`));
  assert.ok(!markup.includes(`data-project-process-open="${other.id}"`));
});

test('workflow process dialog preselects context, cancels safely, and creates with explicit project', () => {
  const listeners = {};
  const control = (key) => ({ value: '', focus() {}, addEventListener(type, fn) { listeners[`${key}:${type}`] = fn; } });
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const elements = { workflowProcessDialog: dialog, workflowProcessForm: control('form'), workflowProcessTemplate: control('template'),
    workflowProcessProject: control('project'), workflowProcessName: control('name'), workflowProcessStatus: {}, workflowProcessCancel: control('cancel') };
  let created = null;
  let navigated = '';
  const state = { workflowTemplates: [{ id: 't1', name: 'Screen', blocks: [{ id: 'a' }] }], projects: [{ id: 'p1', name: 'Project' }] };
  const api = loadEsmStyleModule(path.join(__dirname, 'src/renderer/modules/workflow/process-dialog.js')).createWorkflowProcessDialog({
    state, elements, safeText: (v) => String(v), createProcess: (template, options) => { created = { template, options }; return { id: 'new' }; }
  });
  api.open({ projectId: 'p1' });
  assert.equal(elements.workflowProcessProject.value, 'p1');
  listeners['cancel:click']();
  assert.equal(created, null);
  api.open({ templateId: 't1', projectId: 'p1', onCreated: (process) => { navigated = process.id; } });
  elements.workflowProcessName.value = ' Repeat ';
  listeners['form:submit']({ preventDefault() {} });
  assert.equal(created.options.projectId, 'p1');
  assert.equal(created.options.workflowName, 'Repeat');
  assert.equal(navigated, 'new');
  assert.equal(dialog.open, false);
  api.open({ templateId: 't1' });
  elements.workflowProcessProject.value = 'deleted';
  created = null;
  listeners['form:submit']({ preventDefault() {} });
  assert.equal(created, null);
  assert.equal(dialog.open, true);
});

test('notebook New Experiment starts workflow processes directly and restores selection on cancel', () => {
  const el = () => ({ value: '', hidden: false, innerHTML: '', focus() {}, addEventListener() {}, classList: { toggle() {} } });
  const elements = {};
  ['ProjectSelect', 'ProtocolSelect', 'ProtocolSearchInput', 'ExperimentDialogOverlay', 'ExperimentDialogStatus', 'ExperimentProtocolResults', 'ExperimentStartBtn', 'NewExperimentBtn', 'ExperimentKind', 'ExperimentWorkflow', 'ExperimentProcessName', 'ExperimentProtocolFields', 'ExperimentWorkflowFields'].forEach((key) => { elements['notebook' + key] = el(); });
  elements.notebookExperimentDialogOverlay.hidden = true;
  elements.notebookProjectSelect.value = 'p1';
  elements.notebookProtocolSelect.value = 'protocol';
  const state = { projects: [{ id: 'p1' }], protocols: [{ id: 'protocol', name: 'Protocol' }], workflowTemplates: [{ id: 't1', name: 'Workflow', blocks: [{ id: 'a' }] }] };
  let created = null;
  let opened = '';
  let protocolStarts = 0;
  const api = loadEsmStyleModule(path.join(__dirname, 'src/renderer/modules/biology-notebook/notebook/experiment-dialog.js'), { window: {} }).createExperimentDialog({
    state, elements, safeText: String,
    dropdownRenderer: { renderProjectOptions() {}, renderProtocolOptions(id) { elements.notebookProtocolSelect.value = id; } },
    findSelectedProject: () => state.projects.find((p) => p.id === elements.notebookProjectSelect.value),
    getActiveProjectDashboardId: () => 'p1', syncPageStarterProject() {}, setEditingEntryId() {}, onProtocolChange() { protocolStarts++; },
    onCreateWorkflowProcess(options) { created = options; return { id: 'process' }; }, onOpenWorkflowProcess(id) { opened = id; }
  });
  api.openExperimentDialog({ kind: 'workflow', templateId: 't1' });
  assert.equal(elements.notebookExperimentProtocolFields.hidden, true);
  assert.equal(elements.notebookExperimentStartBtn.disabled, false);
  api.closeExperimentDialog();
  assert.equal(created, null);
  assert.equal(elements.notebookProtocolSelect.value, 'protocol');
  api.openExperimentDialog({ kind: 'workflow', templateId: 't1' });
  elements.notebookExperimentProcessName.value = ' Repeat ';
  api.startExperiment();
  assert.equal(created.projectId, 'p1');
  assert.equal(created.templateId, 't1');
  assert.equal(created.workflowName, 'Repeat');
  assert.equal(opened, 'process');
  assert.equal(protocolStarts, 0);
  assert.equal(elements.notebookExperimentDialogOverlay.hidden, true);
  api.openExperimentDialog();
  assert.equal(elements.notebookExperimentKind.value, 'protocol');
  assert.equal(elements.notebookExperimentWorkflowFields.hidden, true);
});

};
