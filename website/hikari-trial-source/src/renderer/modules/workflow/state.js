import { createEmptyDraft } from './model.js';

export function createWorkflowRuntime() {
  return {
    draft: createEmptyDraft(),
    activeLinkFromBlockId: '',
    graphPointer: null,
    dragState: null,
    selectionState: null,
    selectedBlockIds: new Set(),
    contextMenuState: null,
    interactionSuppressUntil: 0,
    graphWidth: 0,
    graphHeight: 0,
    workflowEntryMode: 'list',
    activeTemplateId: '',
    activeWorkflowId: '',
    activeEntryId: '',
    activeBlockId: '',
    workflowSearchTerm: '',
    workflowGrouping: 'project'
  };
}

export function resolveDefaultAssigneeId(state = {}) {
  const personal = state.settings?.personalInfo || {};
  const personalEmail = String(personal.hikariEmail || '').trim().toLowerCase();
  if (personalEmail) {
    const byEmail = (state.members || []).find(
      (member) => String(member.hikariEmail || '').trim().toLowerCase() === personalEmail
    );
    if (byEmail) {
      return String(byEmail.id || '').trim();
    }
  }

  const personalName = String(personal.name || '').trim().toLowerCase();
  if (personalName) {
    const byName = (state.members || []).find(
      (member) => String(member.name || '').trim().toLowerCase() === personalName
    );
    if (byName) {
      return String(byName.id || '').trim();
    }
  }

  if ((state.members || []).length === 1) {
    return String(state.members[0].id || '').trim();
  }

  return '';
}

export function ensureWorkflowStateShape(state, normalizers = {}) {
  const normalizeWorkflow = typeof normalizers.normalizeWorkflow === 'function'
    ? normalizers.normalizeWorkflow
    : ((workflow) => workflow);
  const normalizeTemplate = typeof normalizers.normalizeTemplate === 'function'
    ? normalizers.normalizeTemplate
    : ((template) => template);

  if (!Array.isArray(state.workflows)) {
    state.workflows = [];
  }
  if (!Array.isArray(state.workflowTemplates)) {
    state.workflowTemplates = [];
  }

  state.workflows = state.workflows.map((workflow) => normalizeWorkflow(workflow));
  state.workflowTemplates = state.workflowTemplates.map((template) => normalizeTemplate(template));
}

export function cloneWorkflowDraft(workflow, normalizeWorkflow) {
  const normalized = normalizeWorkflow(workflow);
  return {
    ...normalized,
    notebookEntryIds: [...normalized.notebookEntryIds],
    blocks: normalized.blocks.map((block) => ({ ...block })),
    links: normalized.links.map((link) => ({ ...link })),
    entries: normalized.entries.map((entry) => ({
      ...entry,
      activeBranchRootIds: [...entry.activeBranchRootIds],
      stepStates: Object.entries(entry.stepStates || {}).reduce((acc, [blockId, stepState]) => {
        acc[blockId] = {
          ...stepState,
          values: { ...(stepState?.values || {}) },
          resultFiles: [...(stepState?.resultFiles || [])],
          resultFileRecords: Array.isArray(stepState?.resultFileRecords)
            ? stepState.resultFileRecords.map((record) => ({ ...record }))
            : [],
          assayIds: [...(stepState?.assayIds || [])],
          gelAnalysisIds: [...(stepState?.gelAnalysisIds || [])]
        };
        return acc;
      }, {})
    }))
  };
}
