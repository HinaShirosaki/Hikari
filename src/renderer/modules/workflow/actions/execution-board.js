import { buildWorkflowExecutionLayout, isWorkflowStepOpenable } from '../execution.js';

// The execution board: searching workflow runs, adding and deleting them, and the
// click/change routing for every step control on the board.
function createWorkflowExecutionBoard({
  runtime,
  elements,
  onOpenNotebookEntry,
  onCreateLinkedAssay,
  renderWorkflowViews,
  persistWorkflowChanges,
  getWorkflowById,
  getTemplateById,
  deleteWorkflow,
  createWorkflowFromTemplateRecord,
  onWorkflowFileInputChange,
  getWorkflowEntry,
  getPrimaryWorkflowEntry,
  getPreferredWorkflowBlockId,
  ensureEntryStepState,
  touchEntry,
  touchWorkflow,
  upsertNotebookEntryForStep
} = {}) {
  function onExecutionSearchInput() {
    runtime.workflowSearchTerm = String(elements.workflowSearchInput?.value || '').trim().toLowerCase();
    renderWorkflowViews();
  }

  function onAddWorkflow() {
    const template = getTemplateById(runtime.activeTemplateId);
    if (!template) {
      return;
    }
    createWorkflowFromTemplateRecord(template);
  }

  function onDeleteWorkflow() {
    deleteWorkflow(runtime.activeWorkflowId);
  }

  function onExecutionBoardClick(event) {
    const statusBtn = event.target.closest('[data-workflow-step-status]');
    if (statusBtn) {
      const workflowId = String(statusBtn.dataset.workflowWorkflowId || '').trim();
      const entryId = String(statusBtn.dataset.workflowEntryId || '').trim();
      const blockId = String(statusBtn.dataset.workflowBlockId || '').trim();
      const requestedStatus = String(statusBtn.dataset.workflowStepStatus || '').trim().toLowerCase();
      const { workflow, entry } = getWorkflowEntry(workflowId, entryId);
      const block = (workflow?.blocks || []).find((item) => item.id === blockId);
      if (!workflow || !entry || !block) {
        return;
      }

      const nextStatus = requestedStatus === 'completed'
        ? 'completed'
        : (requestedStatus === 'failed'
          ? 'failed'
          : (requestedStatus === 'pending' ? 'pending' : 'not_done'));
      const stepState = ensureEntryStepState(entry, blockId);
      const now = new Date().toISOString();
      stepState.status = nextStatus;
      stepState.completedAt = nextStatus === 'completed' ? now : '';
      stepState.updatedAt = now;
      touchEntry(entry);
      touchWorkflow(workflow);
      upsertNotebookEntryForStep(workflow, entry, block, { executed: nextStatus === 'completed' });
      runtime.activeWorkflowId = workflow.id;
      runtime.activeEntryId = entry.id;
      runtime.activeBlockId = blockId;
      persistWorkflowChanges();
      renderWorkflowViews();
      return;
    }

    const stepOpen = event.target.closest('[data-workflow-step-open]');
    if (stepOpen) {
      const workflowId = String(stepOpen.dataset.workflowWorkflowId || '').trim();
      const entryId = String(stepOpen.dataset.workflowEntryId || '').trim();
      const blockId = String(stepOpen.dataset.workflowStepOpen || '').trim();
      const { workflow, entry } = getWorkflowEntry(workflowId, entryId);
      const layout = workflow ? buildWorkflowExecutionLayout(workflow) : null;
      if (!workflow || !entry || !isWorkflowStepOpenable(entry, layout, blockId)) {
        return;
      }
      runtime.activeWorkflowId = workflowId;
      runtime.activeEntryId = entryId;
      runtime.activeBlockId = blockId;
      renderWorkflowViews();
      return;
    }

    const toggleBtn = event.target.closest('[data-workflow-step-toggle]');
    if (toggleBtn) {
      const workflowId = String(toggleBtn.dataset.workflowWorkflowId || '').trim();
      const entryId = String(toggleBtn.dataset.workflowEntryId || '').trim();
      const blockId = String(toggleBtn.dataset.workflowStepToggle || '').trim();
      const { workflow, entry } = getWorkflowEntry(workflowId, entryId);
      if (!workflow || !entry || !blockId) {
        return;
      }
      const block = (workflow.blocks || []).find((item) => item.id === blockId);
      if (!block) {
        return;
      }
      const stepState = ensureEntryStepState(entry, blockId);
      const now = new Date().toISOString();
      const completed = stepState.status !== 'completed';
      stepState.status = completed ? 'completed' : 'not_done';
      stepState.completedAt = completed ? now : '';
      stepState.updatedAt = now;
      touchEntry(entry);
      touchWorkflow(workflow);
      upsertNotebookEntryForStep(workflow, entry, block, { executed: completed });
      runtime.activeWorkflowId = workflow.id;
      runtime.activeEntryId = entry.id;
      runtime.activeBlockId = completed
        ? getPreferredWorkflowBlockId(workflow, entry, blockId)
        : blockId;
      persistWorkflowChanges();
      renderWorkflowViews();
      return;
    }

    const branchToggleBtn = event.target.closest('[data-workflow-branch-toggle]');
    if (branchToggleBtn) {
      const workflowId = String(branchToggleBtn.dataset.workflowWorkflowId || '').trim();
      const entryId = String(branchToggleBtn.dataset.workflowEntryId || '').trim();
      const branchRootId = String(branchToggleBtn.dataset.workflowBranchToggle || '').trim();
      const { workflow, entry } = getWorkflowEntry(workflowId, entryId);
      if (!workflow || !entry || !branchRootId) {
        return;
      }
      const active = new Set(Array.isArray(entry.activeBranchRootIds) ? entry.activeBranchRootIds : []);
      if (active.has(branchRootId)) {
        active.delete(branchRootId);
      } else {
        active.add(branchRootId);
      }
      entry.activeBranchRootIds = [...active];
      touchEntry(entry);
      touchWorkflow(workflow);
      persistWorkflowChanges();
      renderWorkflowViews();
      return;
    }

    const openNotebookBtn = event.target.closest('[data-workflow-step-open-notebook]');
    if (openNotebookBtn) {
      const workflowId = String(openNotebookBtn.dataset.workflowWorkflowId || '').trim();
      const entryId = String(openNotebookBtn.dataset.workflowEntryId || '').trim();
      const blockId = String(openNotebookBtn.dataset.workflowStepOpenNotebook || '').trim();
      const { workflow, entry } = getWorkflowEntry(workflowId, entryId);
      const block = (workflow?.blocks || []).find((item) => item.id === blockId);
      if (!workflow || !entry || !block) {
        return;
      }
      const notebookEntry = upsertNotebookEntryForStep(workflow, entry, block, {});
      touchEntry(entry);
      touchWorkflow(workflow);
      persistWorkflowChanges();
      onOpenNotebookEntry(notebookEntry.id);
      renderWorkflowViews();
      return;
    }

    const assayBtn = event.target.closest('[data-workflow-step-create-assay]');
    if (assayBtn) {
      const workflowId = String(assayBtn.dataset.workflowWorkflowId || '').trim();
      const entryId = String(assayBtn.dataset.workflowEntryId || '').trim();
      const blockId = String(assayBtn.dataset.workflowStepCreateAssay || '').trim();
      const { workflow, entry } = getWorkflowEntry(workflowId, entryId);
      const block = (workflow?.blocks || []).find((item) => item.id === blockId);
      if (!workflow || !entry || !block) {
        return;
      }
      const notebookEntry = upsertNotebookEntryForStep(workflow, entry, block, { executed: false });
      touchEntry(entry);
      touchWorkflow(workflow);
      persistWorkflowChanges();
      onCreateLinkedAssay({
        notebookEntryId: notebookEntry.id,
        projectId: notebookEntry.projectId,
        notebookType: notebookEntry.notebookType || 'biology'
      });
      renderWorkflowViews();
      return;
    }

    if (event.target.closest('.workflow-step-inline') || event.target.closest('input, textarea, select')) {
      return;
    }

    const runOpenBtn = event.target.closest('[data-workflow-run-open]');
    if (runOpenBtn) {
      const workflowId = String(runOpenBtn.dataset.workflowRunOpen || '').trim();
      const workflow = getWorkflowById(workflowId);
      const entry = getPrimaryWorkflowEntry(workflow);
      runtime.activeWorkflowId = workflowId;
      runtime.activeEntryId = entry?.id || '';
      runtime.activeBlockId = '';
      renderWorkflowViews();
      return;
    }

    if (runtime.activeBlockId) {
      runtime.activeBlockId = '';
      renderWorkflowViews();
    }
  }

  function onExecutionBoardChange(event) {
    const workflowNameInput = event.target.closest('[data-workflow-run-name]');
    if (workflowNameInput) {
      const workflowId = String(workflowNameInput.dataset.workflowRunName || '').trim();
      const workflow = getWorkflowById(workflowId);
      if (!workflow) {
        return;
      }
      workflow.name = String(workflowNameInput.value || '').trim() || 'Untitled workflow';
      if (workflow.entries[0]) {
        workflow.entries[0].name = workflow.name;
        touchEntry(workflow.entries[0]);
      }
      touchWorkflow(workflow);
      persistWorkflowChanges();
      renderWorkflowViews();
      return;
    }

    const stepValueInput = event.target.closest('[data-workflow-step-value]');
    if (stepValueInput) {
      const workflowId = String(stepValueInput.dataset.workflowWorkflowId || '').trim();
      const entryId = String(stepValueInput.dataset.workflowEntryId || '').trim();
      const blockId = String(stepValueInput.dataset.workflowBlockId || '').trim();
      const valueKey = String(stepValueInput.dataset.workflowStepValue || '').trim();
      const { workflow, entry } = getWorkflowEntry(workflowId, entryId);
      const block = (workflow?.blocks || []).find((item) => item.id === blockId);
      if (!workflow || !entry || !block || !valueKey) {
        return;
      }
      const stepState = ensureEntryStepState(entry, blockId);
      const cleanValue = String(stepValueInput.value || '').trim();
      if (cleanValue) {
        stepState.values[valueKey] = cleanValue;
      } else {
        delete stepState.values[valueKey];
      }
      stepState.updatedAt = new Date().toISOString();
      touchEntry(entry);
      touchWorkflow(workflow);
      if (stepState.notebookEntryId) {
        upsertNotebookEntryForStep(workflow, entry, block, {});
      }
      persistWorkflowChanges();
      renderWorkflowViews();
      return;
    }

    const resultField = event.target.closest('[data-workflow-step-result-field]');
    if (resultField) {
      const workflowId = String(resultField.dataset.workflowWorkflowId || '').trim();
      const entryId = String(resultField.dataset.workflowEntryId || '').trim();
      const blockId = String(resultField.dataset.workflowStepResultField || '').trim();
      const { workflow, entry } = getWorkflowEntry(workflowId, entryId);
      const block = (workflow?.blocks || []).find((item) => item.id === blockId);
      if (!workflow || !entry || !block) {
        return;
      }
      const stepState = ensureEntryStepState(entry, blockId);
      stepState.result = String(resultField.value || '').trim();
      stepState.updatedAt = new Date().toISOString();
      touchEntry(entry);
      touchWorkflow(workflow);
      if (stepState.notebookEntryId) {
        upsertNotebookEntryForStep(workflow, entry, block, {});
      }
      persistWorkflowChanges();
      renderWorkflowViews();
      return;
    }

    const fileInput = event.target.closest('[data-workflow-step-files]');
    if (fileInput) {
      void onWorkflowFileInputChange(fileInput);
    }
  }
  return {
    onExecutionSearchInput,
    onAddWorkflow,
    onDeleteWorkflow,
    onExecutionBoardClick,
    onExecutionBoardChange
  };
}

export { createWorkflowExecutionBoard };
