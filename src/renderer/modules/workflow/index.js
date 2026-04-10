import { getWorkflowElements } from './dom.js';
import {
  createWorkflowModel,
  formatTimestamp,
  getBlockType,
  normalizePlainTextBlock,
  parseTimestamp,
  uniqueStrings
} from './model.js';
import { createWorkflowRenderer } from './renderer.js';
import { createWorkflowGraphController } from './graph-controller.js';
import { createWorkflowActions } from './actions.js';
import { createWorkflowRuntime, resolveDefaultAssigneeId } from './state.js';

export function initWorkflowManagement({
  state,
  persist,
  createId,
  safeText,
  onWorkflowsChanged = () => {},
  onOpenNotebookEntry = () => {},
  onCreateLinkedAssay = () => {},
  onCreateLinkedGel = () => {}
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
    || !elements.workflowGraphStatus
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
    normalizePlainTextBlock,
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
    displayLabelForBlock: renderer.displayLabelForBlock,
    getBlockType,
    renderBlockList: renderer.renderBlockList,
    document
  });

  const actions = createWorkflowActions({
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
    onCreateLinkedGel
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

  actions.bindEvents();
  render();

  return {
    render,
    renderProjectOptions: renderer.renderProjectOptions,
    renderNotebookOptions: renderer.renderNotebookOptions,
    renderProtocolOptions: renderer.renderProtocolOptions
  };
}
