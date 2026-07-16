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
    workflowExecutionStatus: { textContent: '' },
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
  assert.equal(elements.workflowExecutionStatus.textContent, '1 specific workflow created from this template.');
  assert.match(board.innerHTML, /workflow-execution-shell/);
  assert.match(board.innerHTML, /workflow-progress-track-line/);
  assert.doesNotMatch(board.innerHTML, /workflow-progress-connector/);
  assert.match(board.innerHTML, /data-workflow-step-open="block-c"[\s\S]*disabled aria-disabled="true"/);
  assert.match(board.innerHTML, /data-workflow-step-popover="true"/);
  assert.match(board.innerHTML, /workflow-placeholder-field-label">amount/);
  assert.match(board.innerHTML, /workflow-placeholder-field[\s\S]*value="10 mL"[\s\S]*placeholder="Enter value"/);
  assert.doesNotMatch(board.innerHTML, /workflow-placeholder-field-context|workflow-step-editor-header|workflow-step-status-picker/);
  assert.doesNotMatch(board.innerHTML, /workflow-placeholder-table/);
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
    workflowExecutionStatus: { textContent: '' },
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

  }
};
