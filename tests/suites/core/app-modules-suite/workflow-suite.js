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
  const { buildWorkflowExecutionLayout, computeEntryProgress } = execution;
  const workflow = {
    id: 'workflow-branch',
    blocks: [
      { id: 'a', protocolId: 'p-a', x: 40, y: 40 },
      { id: 'b', protocolId: 'p-b', x: 240, y: 40 },
      { id: 'c', protocolId: 'p-c', x: 440, y: 40 },
      { id: 'd', protocolId: 'p-d', x: 260, y: 180 },
      { id: 'e', protocolId: 'p-e', x: 460, y: 180 }
    ],
    links: [
      { fromBlockId: 'a', toBlockId: 'b' },
      { fromBlockId: 'b', toBlockId: 'c' },
      { fromBlockId: 'b', toBlockId: 'd' },
      { fromBlockId: 'd', toBlockId: 'e' }
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
    activeBranchRootIds: ['d'],
    stepStates: {
      a: { status: 'completed' },
      b: { status: 'completed' },
      d: { status: 'completed' }
    }
  };

  const inactiveProgress = computeEntryProgress(inactiveBranchEntry, layout);
  const activeProgress = computeEntryProgress(activeBranchEntry, layout);

  assert.deepEqual([...layout.mainPathIds], ['a', 'b', 'c']);
  assert.equal(layout.branches.length, 1);
  assert.equal(layout.branches[0].rootId, 'd');
  assert.deepEqual([...layout.branches[0].blockIds], ['d', 'e']);
  assert.equal(inactiveProgress.totalSteps, 3);
  assert.equal(inactiveProgress.nextBlockId, 'c');
  assert.equal(activeProgress.totalSteps, 5);
  assert.equal(activeProgress.completedSteps, 3);
  assert.equal(activeProgress.nextBlockId, 'e');
  assert.equal(activeProgress.percentComplete, 60);
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
      protocols: [],
      workflowTemplates: [
        {
          id: 'template-1',
          name: 'NiNTA',
          blocks: [
            { id: 'block-a', protocolId: 'protocol-a', x: 40, y: 40 },
            { id: 'block-b', type: 'text', text: 'Record purification yield', x: 240, y: 40 }
          ],
          links: [{ fromBlockId: 'block-a', toBlockId: 'block-b' }]
        }
      ],
      workflows: [
        {
          id: 'workflow-1',
          templateId: 'template-1',
          name: 'NiNTA 1',
          blocks: [
            { id: 'block-a', protocolId: 'protocol-a', x: 40, y: 40 },
            { id: 'block-b', type: 'text', text: 'Record purification yield', x: 240, y: 40 }
          ],
          links: [{ fromBlockId: 'block-a', toBlockId: 'block-b' }],
          entries: [
            {
              id: 'entry-1',
              name: 'NiNTA 1',
              stepStates: {
                'block-a': { status: 'completed' },
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
      activeBlockId: 'block-b'
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
  assert.match(board.innerHTML, /data-workflow-step-popover="true"/);
  assert.doesNotMatch(board.innerHTML, /workflow-step-detail-panel/);
});

  }
};
