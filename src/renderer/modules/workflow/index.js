import { createWorkflowProcessDialog } from './process-dialog.js';
import { getWorkflowElements } from './dom.js';
import {
  createWorkflowModel,
  formatTimestamp,
  getBlockType,
  parseTimestamp,
  uniqueStrings
} from './model.js';
import { createWorkflowRenderer } from './renderer.js';
import { createWorkflowGraphController } from './graph-controller.js';
import { createWorkflowActions } from './actions.js';
import { createWorkflowRuntime, resolveDefaultAssigneeId } from './state.js';

// Workflow view: template graph editor (graph-controller), workflow list, and
// the execution board where each entry (run) records step results. Without
// its DOM (e.g. in a test shell) it returns no-op renderers.
export function initWorkflowManagement({
  state,
  persist,
  createId,
  safeText,
  onWorkflowsChanged = () => {},
  onOpenNotebookEntry = () => {},
  onCreateLinkedAssay = () => {},
}) {
  const elements = getWorkflowElements(document);

  if (
    !elements.workflowForm
    || !elements.workflowList
    || !elements.workflowGraphCanvas
    || !elements.workflowGraphBoard
    || !elements.workflowGraphSvg
    || !elements.workflowGraphSelection
    || !elements.workflowGraphNodes
    || !elements.workflowGraphContextMenu
  ) {
    return {
      render: () => {},
      renderProjectOptions: () => {},
      renderNotebookOptions: () => {},
      renderProtocolOptions: () => {}
    };
  }

  const runtime = createWorkflowRuntime();
  const workflowModel = createWorkflowModel({
    createId,
    resolveDefaultAssigneeId: () => resolveDefaultAssigneeId(state)
  });
  const {
    normalizeBlocks,
    normalizeLinks,
    normalizeWorkflow,
    normalizeTemplate,
    instantiateTemplate
  } = workflowModel;

  let graphController = null;

  const renderer = createWorkflowRenderer({
    state,
    runtime,
    elements,
    safeText,
    getBlockType,
    uniqueStrings,
    parseTimestamp,
    formatTimestamp,
    getRenderGraphEditor: () => graphController?.renderGraphEditor
  });

  graphController = createWorkflowGraphController({
    runtime,
    elements,
    safeText,
    createId,
    normalizeBlocks,
    normalizeLinks,
    titleForBlock: renderer.titleForBlock,
    labelForBlockType: renderer.labelForBlockType,
    labelForAssignee: renderer.labelForAssignee,
    getBlockType,
    renderBlockList: renderer.renderBlockList,
    document
  });

  let processDialog;
  const actions = createWorkflowActions({
    openProcessDialog: (options) => processDialog.open(options),
    state,
    runtime,
    elements,
    renderer,
    graphController,
    normalizeBlocks,
    normalizeLinks,
    normalizeWorkflow,
    normalizeTemplate,
    instantiateTemplate,
    persist,
    createId,
    onWorkflowsChanged,
    onOpenNotebookEntry,
    onCreateLinkedAssay,
  });

  function render() {
    actions.ensureStateShape();
    actions.normalizeDraft();
    graphController.pruneSelectedBlockIds();
    renderer.applyDraftToForm();
    renderer.renderTemplateSourceOptions();
    renderer.renderTemplateCreateProjectOptions();
    renderer.renderTemplateList();
    renderer.renderWorkflowList();
    renderer.renderExecutionBoard();
    renderer.setWorkflowEntryMode(runtime.workflowEntryMode || 'list');
  }

  processDialog = createWorkflowProcessDialog({
    state, elements, safeText,
    createProcess: actions.createWorkflowFromTemplateRecord
  });
  actions.bindEvents();
  render();

  return {
    createProcess: ({ templateId, ...options }) => {
      const template = (state.workflowTemplates || []).find((item) => item.id === templateId);
      return template ? actions.createWorkflowFromTemplateRecord(template, options) : null;
    },
    openProcessDialog: (options) => processDialog.open(options),
    openProcess: (id) => {
      if (elements.workflowSearchInput) elements.workflowSearchInput.value = '';
      runtime.workflowSearchTerm = '';
      renderer.setWorkflowEntryMode('list');
      actions.selectWorkflow(id);
    },
    render,
    renderProjectOptions: renderer.renderProjectOptions,
    renderNotebookOptions: renderer.renderNotebookOptions,
    renderProtocolOptions: renderer.renderProtocolOptions
  };
}
