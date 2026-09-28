import { getGelAnalyses } from '../../../lib/gel-records.js';
import { uniqueStrings } from '../model.js';
import { buildWorkflowExecutionLayout, computeEntryProgress } from '../execution.js';
import { cloneProtocolSnapshot } from '../../../lib/protocol-snapshot.js';

function createEmptyStepState() {
  return {
    status: 'not_done',
    values: {},
    result: '',
    resultFiles: [],
    resultFileRecords: [],
    notebookEntryId: '',
    assayIds: [],
    gelAnalysisIds: [],
    completedAt: '',
    updatedAt: ''
  };
}

// Per-step execution state on a workflow entry, and the notebook page each
// executed step writes back into.
function createWorkflowStepState({
  state,
  renderer,
  createId,
  getWorkflowById,
  buildWorkflowStepNotebookFolderPath
} = {}) {
  function getWorkflowEntry(workflowId, entryId) {
    const workflow = getWorkflowById(workflowId);
    if (!workflow) {
      return { workflow: null, entry: null };
    }
    const entry = (workflow.entries || []).find((item) => item.id === entryId) || null;
    return { workflow, entry };
  }

  function getPrimaryWorkflowEntry(workflow) {
    return Array.isArray(workflow?.entries) ? workflow.entries[0] || null : null;
  }

  function getPreferredWorkflowBlockId(workflow, entry, fallbackBlockId = '') {
    const layout = buildWorkflowExecutionLayout(workflow);
    const progress = entry ? computeEntryProgress(entry, layout) : null;
    return (
      progress?.nextBlockId
      || String(fallbackBlockId || '').trim()
      || progress?.orderedIds?.[0]
      || workflow?.blocks?.[0]?.id
      || ''
    );
  }

  function ensureEntryStepState(entry, blockId) {
    if (!entry.stepStates || typeof entry.stepStates !== 'object' || Array.isArray(entry.stepStates)) {
      entry.stepStates = {};
    }
    if (!entry.stepStates[blockId]) {
      entry.stepStates[blockId] = createEmptyStepState();
    }
    const stepState = entry.stepStates[blockId];
    if (!stepState.values || typeof stepState.values !== 'object' || Array.isArray(stepState.values)) {
      stepState.values = {};
    }
    if (!Array.isArray(stepState.resultFiles)) {
      stepState.resultFiles = [];
    }
    if (!Array.isArray(stepState.resultFileRecords)) {
      stepState.resultFileRecords = [];
    }
    if (!Array.isArray(stepState.assayIds)) {
      stepState.assayIds = [];
    }
    if (!Array.isArray(stepState.gelAnalysisIds)) {
      stepState.gelAnalysisIds = [];
    }
    return stepState;
  }

  function touchEntry(entry) {
    entry.updatedAt = new Date().toISOString();
  }

  function touchWorkflow(workflow) {
    workflow.updatedAt = new Date().toISOString();
  }

  function upsertNotebookEntryForStep(workflow, entry, block, options = {}) {
    const stepState = ensureEntryStepState(entry, block.id);
    const now = new Date().toISOString();
    const project = (state.projects || []).find((item) => item.id === workflow.projectId) || null;
    const protocol = (state.protocols || []).find((item) => item.id === block.protocolId) || null;
    const existing = stepState.notebookEntryId
      ? (state.notebookEntries || []).find((item) => item.id === stepState.notebookEntryId) || null
      : null;
    const notebookState = options.executed === true
      ? 'executed'
      : (options.executed === false ? 'planned' : (stepState.status === 'completed' ? 'executed' : 'planned'));
    const createdAt = String(existing?.createdAt || '').trim() || now;
    const notebookId = existing?.id || createId();
    const storageFolder = buildWorkflowStepNotebookFolderPath(workflow, entry, notebookId)
      || String(existing?.storageFolder || '').trim();
    const linkedAssayIds = (state.assays || [])
      .filter((item) => item.notebookEntryId === notebookId)
      .map((item) => item.id);
    const linkedGelIds = getGelAnalyses(state)
      .filter((item) => item.notebookEntryId === notebookId)
      .map((item) => item.id);
    const notebookEntry = {
      ...(existing || {}),
      id: notebookId,
      notebookType: 'biology',
      projectId: project?.id || workflow.projectId || '',
      projectName: project?.name || String(existing?.projectName || '').trim(),
      protocolId: protocol?.id || '',
      protocolName: protocol?.name || renderer.titleForBlock?.(block) || 'Workflow Step',
      protocolSnapshot: cloneProtocolSnapshot(protocol) || cloneProtocolSnapshot(existing?.protocolSnapshot),
      values: { ...stepState.values },
      result: String(stepState.result || '').trim(),
      resultFiles: [...stepState.resultFiles],
      resultFileRecords: stepState.resultFileRecords.map((record) => ({ ...record })),
      storageFolder,
      createdAt,
      updatedAt: now,
      notebookState,
      executedAt: notebookState === 'executed'
        ? (String(stepState.completedAt || '').trim() || now)
        : '',
      workflowContext: {
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowEntryId: entry.id,
        workflowEntryName: entry.name,
        workflowBlockId: block.id,
        workflowBlockTitle: renderer.titleForBlock?.(block) || block.id
      },
      assayIds: linkedAssayIds,
      gelAnalysisIds: linkedGelIds
    };

    const index = state.notebookEntries.findIndex((item) => item.id === notebookEntry.id);
    if (index >= 0) {
      state.notebookEntries[index] = notebookEntry;
    } else {
      state.notebookEntries.push(notebookEntry);
    }

    stepState.notebookEntryId = notebookEntry.id;
    stepState.assayIds = uniqueStrings(linkedAssayIds);
    stepState.gelAnalysisIds = uniqueStrings(linkedGelIds);
    workflow.notebookEntryIds = uniqueStrings([...(workflow.notebookEntryIds || []), notebookEntry.id]);
    return notebookEntry;
  }
  return {
    getWorkflowEntry,
    getPrimaryWorkflowEntry,
    getPreferredWorkflowBlockId,
    ensureEntryStepState,
    touchEntry,
    touchWorkflow,
    cloneProtocolSnapshot,
    upsertNotebookEntryForStep
  };
}

export { createWorkflowStepState };
