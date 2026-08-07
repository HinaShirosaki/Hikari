import { getGelAnalyses } from '../../lib/gel-records.js';
import { BLOCK_TYPES } from './constants.js';
import {
  createEmptyDraft,
  createEmptyWorkflowEntry,
  getBlockType,
  normalizePlainTextBlock,
  suggestedBlockPosition,
  uniqueStrings
} from './model.js';
import {
  cloneWorkflowDraft,
  ensureWorkflowStateShape,
  resolveDefaultAssigneeId
} from './state.js';
import {
  buildWorkflowExecutionLayout,
  computeEntryProgress,
  isWorkflowStepOpenable
} from './execution.js';
import { createWorkflowArtifactStorage } from './artifact-storage.js';
import { showTransientNotice } from '../../lib/notify.js';

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

export function createWorkflowActions(config = {}) {
  const state = config?.state || {};
  const runtime = config?.runtime || {};
  const elements = config?.elements || {};
  const renderer = config?.renderer || {};
  const graphController = config?.graphController || {};
  const normalizeBlocks = config?.normalizeBlocks || ((blocks) => blocks || []);
  const normalizeLinks = config?.normalizeLinks || ((links) => links || []);
  const normalizeWorkflow = config?.normalizeWorkflow || ((workflow) => workflow);
  const normalizeTemplate = config?.normalizeTemplate || ((template) => template);
  const instantiateTemplate = config?.instantiateTemplate || ((template) => template);
  const persist = typeof config?.persist === 'function' ? config.persist : () => {};
  const createId = typeof config?.createId === 'function'
    ? config.createId
    : (() => Math.random().toString(36).slice(2));
  const onWorkflowsChanged = typeof config?.onWorkflowsChanged === 'function'
    ? config.onWorkflowsChanged
    : () => {};
  const onOpenNotebookEntry = typeof config?.onOpenNotebookEntry === 'function'
    ? config.onOpenNotebookEntry
    : () => {};
  const onCreateLinkedAssay = typeof config?.onCreateLinkedAssay === 'function'
    ? config.onCreateLinkedAssay
    : () => {};

  function ensureStateShape() {
    ensureWorkflowStateShape(state, {
      normalizeWorkflow,
      normalizeTemplate
    });
  }

  function renderWorkflowViews() {
    renderer.renderTemplateSourceOptions?.();
    renderer.renderTemplateList?.();
    renderer.renderWorkflowList?.();
    renderer.renderExecutionBoard?.();
  }

  function persistWorkflowChanges() {
    persist();
    onWorkflowsChanged();
  }

  function getWorkflowById(workflowId) {
    return (state.workflows || []).find((workflow) => workflow.id === workflowId) || null;
  }

  function getTemplateById(templateId) {
    return (state.workflowTemplates || []).find((template) => template.id === templateId) || null;
  }

  const {
    buildWorkflowStepNotebookFolderPath,
    buildWorkflowStepResultsFolderPath,
    ensureStorageFolderExists,
    persistImportedWorkflowFiles
  } = createWorkflowArtifactStorage({
    state,
    renderer,
    getTemplateById,
    windowObject: config?.windowObject || globalThis?.window || null,
    FileReaderClass: config?.FileReaderClass || globalThis?.FileReader || null
  });

  function getWorkflowsForTemplate(templateId) {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      return [];
    }
    return (state.workflows || []).filter((workflow) => String(workflow.templateId || '').trim() === normalizedTemplateId);
  }

  function buildDefaultEntryName(workflow) {
    const count = Array.isArray(workflow?.entries) ? workflow.entries.length : 0;
    return `Entry ${count + 1}`;
  }

  function buildDefaultWorkflowName(template) {
    const count = getWorkflowsForTemplate(template?.id).length + 1;
    const baseName = String(template?.name || '').trim() || 'Workflow';
    return `${baseName} ${count}`;
  }

  function createWorkflowEntryRecord(workflow, name = '') {
    const now = new Date().toISOString();
    return {
      ...createEmptyWorkflowEntry(),
      id: createId(),
      name: String(name || '').trim() || buildDefaultEntryName(workflow),
      createdAt: now,
      updatedAt: now
    };
  }

  function ensureWorkflowSelection(preferredWorkflowId = '') {
    ensureStateShape();

    let workflow = getWorkflowById(preferredWorkflowId || runtime.activeWorkflowId);
    if (!workflow) {
      workflow = runtime.activeTemplateId
        ? (getWorkflowsForTemplate(runtime.activeTemplateId)[0] || null)
        : ((state.workflows || [])[0] || null);
    }

    runtime.activeWorkflowId = workflow?.id || '';

    if (!workflow) {
      runtime.activeEntryId = '';
      runtime.activeBlockId = '';
      return null;
    }

    runtime.activeTemplateId = String(workflow.templateId || '').trim() || runtime.activeTemplateId;

    if (!Array.isArray(workflow.entries)) {
      workflow.entries = [];
    }

    if (!workflow.entries.some((entry) => entry.id === runtime.activeEntryId)) {
      runtime.activeEntryId = workflow.entries[0]?.id || '';
    }

    if (!(workflow.blocks || []).some((block) => block.id === runtime.activeBlockId)) {
      runtime.activeBlockId = workflow.blocks?.[0]?.id || '';
    }

    return workflow;
  }

  function selectTemplate(templateId, options = {}) {
    const previousTemplateId = String(runtime.activeTemplateId || '').trim();
    const template = getTemplateById(String(templateId || '').trim());
    runtime.activeTemplateId = template?.id || '';

    const templateWorkflows = template ? getWorkflowsForTemplate(template.id) : [];
    const requestedWorkflowId = String(options.workflowId || '').trim();
    if (requestedWorkflowId && templateWorkflows.some((workflow) => workflow.id === requestedWorkflowId)) {
      runtime.activeWorkflowId = requestedWorkflowId;
    } else if (previousTemplateId !== runtime.activeTemplateId) {
      runtime.activeWorkflowId = '';
    } else if (!templateWorkflows.some((workflow) => workflow.id === runtime.activeWorkflowId)) {
      runtime.activeWorkflowId = '';
    }

    if (!runtime.activeWorkflowId) {
      runtime.activeEntryId = '';
      runtime.activeBlockId = '';
    }

    renderWorkflowViews();
    return template;
  }

  function selectWorkflow(workflowId, options = {}) {
    const workflow = ensureWorkflowSelection(workflowId);
    if (!workflow) {
      renderWorkflowViews();
      return null;
    }

    runtime.activeTemplateId = String(workflow.templateId || '').trim() || runtime.activeTemplateId;
    runtime.activeWorkflowId = workflow.id;
    if (options.entryId && workflow.entries.some((entry) => entry.id === options.entryId)) {
      runtime.activeEntryId = options.entryId;
    } else if (!runtime.activeEntryId && workflow.entries.length) {
      runtime.activeEntryId = workflow.entries[0].id;
    }

    if (options.blockId && (workflow.blocks || []).some((block) => block.id === options.blockId)) {
      runtime.activeBlockId = options.blockId;
    } else if (!runtime.activeBlockId && (workflow.blocks || []).length) {
      runtime.activeBlockId = workflow.blocks[0].id;
    }

    renderWorkflowViews();
    return workflow;
  }

  function cloneWorkflowIntoDraft(workflow) {
    runtime.draft = cloneWorkflowDraft(workflow, normalizeWorkflow);
    graphController.resetInteractionState?.();
  }

  function resetDraftToEmpty() {
    runtime.draft = createEmptyDraft();
    graphController.resetInteractionState?.();
    if (elements.workflowTemplateNameInput) {
      elements.workflowTemplateNameInput.value = '';
    }
    renderer.applyDraftToForm?.();
  }

  function createWorkflowFromTemplateRecord(template, options = {}) {
    if (!template) {
      return null;
    }

    const workflowName = String(options.workflowName || '').trim() || buildDefaultWorkflowName(template);
    const workflow = instantiateTemplate(template, workflowName);
    workflow.projectId = String(options.projectId || template?.projectId || '').trim();
    workflow.entries = [createWorkflowEntryRecord(workflow, workflowName)];
    const normalizedWorkflowRecord = normalizeWorkflow(workflow);
    state.workflows.push(normalizedWorkflowRecord);

    persistWorkflowChanges();
    runtime.activeTemplateId = normalizedWorkflowRecord.templateId || template.id;
    runtime.activeWorkflowId = normalizedWorkflowRecord.id;
    runtime.activeEntryId = normalizedWorkflowRecord.entries[0]?.id || '';
    runtime.activeBlockId = normalizedWorkflowRecord.blocks?.[0]?.id || '';
    renderer.setWorkflowEntryMode?.('list');
    renderWorkflowViews();
    return normalizedWorkflowRecord;
  }

  function deleteWorkflow(workflowId) {
    const normalizedWorkflowId = String(workflowId || '').trim();
    if (!normalizedWorkflowId) {
      return;
    }

    state.workflows = (state.workflows || []).filter((workflow) => workflow.id !== normalizedWorkflowId);
    if (runtime.draft.id === normalizedWorkflowId) {
      resetDraftToEmpty();
    }
    if (runtime.activeWorkflowId === normalizedWorkflowId) {
      runtime.activeWorkflowId = '';
      runtime.activeEntryId = '';
      runtime.activeBlockId = '';
    }

    persistWorkflowChanges();
    renderWorkflowViews();
  }

  function getBlockComposerType() {
    const selected = String(elements.workflowBlockTypeInput?.value || '').trim().toLowerCase();
    return selected === BLOCK_TYPES.TEXT ? BLOCK_TYPES.TEXT : BLOCK_TYPES.PROTOCOL;
  }

  function onStartCreateWorkflowTemplate() {
    resetDraftToEmpty();
    renderer.setWorkflowEntryMode?.('template');
  }

  function onStartViewEditWorkflow() {
    renderer.setWorkflowEntryMode?.('list');
    renderWorkflowViews();
  }

  function onBackToWorkflowEntry() {
    resetDraftToEmpty();
    renderer.setWorkflowEntryMode?.('list');
    renderWorkflowViews();
  }

  function onCancelWorkflowEdit() {
    resetDraftToEmpty();
    renderer.setWorkflowEntryMode?.('list');
    renderWorkflowViews();
  }

  function onProjectChange() {
    runtime.draft.projectId = elements.workflowProjectInput?.value || '';
    runtime.draft.notebookEntryIds = [];
    renderer.renderNotebookOptions?.();
  }

  function onWorkflowSubmit(event) {
    event.preventDefault();
    ensureStateShape();

    const name = String(elements.workflowNameInput?.value || '').trim();
    if (!name || !(runtime.draft.blocks || []).length) {
      return;
    }

    const now = new Date().toISOString();
    const isTemplateMode = runtime.workflowEntryMode === 'template';
    const notebookEntryIds = isTemplateMode
      ? []
      : uniqueStrings(renderer.getSelectedValues?.(elements.workflowNotebookPagesInput));
    const projectId = isTemplateMode ? '' : (elements.workflowProjectInput?.value || '');
    const existing = (state.workflows || []).find(
      (workflow) => workflow.id === (elements.workflowIdInput?.value || '')
    );
    const draftEntries = Array.isArray(runtime.draft.entries) ? runtime.draft.entries : [];
    const entries = draftEntries.length
      ? draftEntries
      : (existing?.entries?.length ? existing.entries : [createWorkflowEntryRecord(runtime.draft)]);

    const workflowRecord = normalizeWorkflow({
      ...runtime.draft,
      id: elements.workflowIdInput?.value || runtime.draft.id || createId(),
      templateId: runtime.draft.templateId || existing?.templateId || '',
      name,
      description: String(elements.workflowDescriptionInput?.value || '').trim(),
      projectId,
      notebookEntryIds,
      entries,
      createdAt: existing?.createdAt || runtime.draft.createdAt || now,
      updatedAt: now
    });

    const index = state.workflows.findIndex((workflow) => workflow.id === workflowRecord.id);
    if (index >= 0) {
      state.workflows[index] = workflowRecord;
    } else {
      state.workflows.push(workflowRecord);
    }

    persistWorkflowChanges();
    cloneWorkflowIntoDraft(workflowRecord);
    runtime.activeTemplateId = String(workflowRecord.templateId || '').trim() || runtime.activeTemplateId;
    runtime.activeWorkflowId = workflowRecord.id;
    runtime.activeEntryId = workflowRecord.entries?.[0]?.id || '';
    runtime.activeBlockId = workflowRecord.blocks?.[0]?.id || '';
    renderer.setWorkflowEntryMode?.('list');
    renderWorkflowViews();
  }

  function onAddBlock() {
    const blockType = getBlockComposerType();
    const position = suggestedBlockPosition((runtime.draft?.blocks || []).length);

    if (blockType === BLOCK_TYPES.TEXT) {
      const textContent = normalizePlainTextBlock(elements.workflowBlockTextInput?.value || '');
      if (!textContent) {
        return;
      }

      graphController.hideContextMenu?.();
      runtime.draft.blocks.push({
        id: createId(),
        type: BLOCK_TYPES.TEXT,
        protocolId: '',
        text: textContent,
        assigneeId: resolveDefaultAssigneeId(state),
        x: position.x,
        y: position.y
      });
      if (elements.workflowBlockTextInput) {
        elements.workflowBlockTextInput.value = '';
      }
      renderer.renderBlockEditor?.();
      return;
    }

    const protocolId = String(elements.workflowBlockProtocolInput?.value || '').trim();
    if (!protocolId) {
      return;
    }

    graphController.hideContextMenu?.();
    runtime.draft.blocks.push({
      id: createId(),
      type: BLOCK_TYPES.PROTOCOL,
      protocolId,
      text: '',
      assigneeId: resolveDefaultAssigneeId(state),
      x: position.x,
      y: position.y
    });
    renderer.renderBlockEditor?.();
  }

  function onBlockListClick(event) {
    const removeBtn = event.target.closest('[data-workflow-block-remove]');
    if (!removeBtn) {
      return;
    }
    graphController.removeBlocks?.([removeBtn.dataset.workflowBlockRemove]);
  }

  function onBlockListChange(event) {
    const textInput = event.target.closest('[data-workflow-block-text]');
    if (textInput) {
      const blockId = textInput.dataset.workflowBlockText;
      const block = runtime.draft.blocks.find((item) => item.id === blockId);
      if (!block || getBlockType(block) !== BLOCK_TYPES.TEXT) {
        return;
      }

      const nextText = normalizePlainTextBlock(textInput.value || '');
      if (!nextText) {
        textInput.value = block.text || '';
        return;
      }

      block.type = BLOCK_TYPES.TEXT;
      block.protocolId = '';
      block.text = nextText;
      renderer.renderBlockList?.();
      graphController.renderGraphEditor?.();
      return;
    }

    const assigneeSelect = event.target.closest('[data-workflow-block-assignee]');
    if (!assigneeSelect) {
      return;
    }

    const blockId = assigneeSelect.dataset.workflowBlockAssignee;
    const block = runtime.draft.blocks.find((item) => item.id === blockId);
    if (!block) {
      return;
    }

    block.assigneeId = String(assigneeSelect.value || '').trim();
    renderer.renderBlockList?.();
    graphController.renderGraphEditor?.();
  }

  function onWorkflowListClick(event) {
    const templateOpenBtn = event.target.closest('[data-workflow-template-open]');
    if (templateOpenBtn) {
      selectTemplate(String(templateOpenBtn.dataset.workflowTemplateOpen || '').trim());
      return;
    }
  }

  function onSaveTemplate() {
    const templateName = String(elements.workflowTemplateNameInput?.value || '').trim();
    if (!templateName || !(runtime.draft.blocks || []).length) {
      return;
    }

    const now = new Date().toISOString();
    const template = normalizeTemplate({
      id: createId(),
      name: templateName,
      description: String(
        elements.workflowTemplateDescriptionInput?.value
        || elements.workflowDescriptionInput?.value
        || ''
      ).trim() || runtime.draft.description,
      projectId: String(elements.workflowProjectInput?.value || runtime.draft.projectId || '').trim(),
      blocks: runtime.draft.blocks.map((block) => ({ ...block })),
      links: runtime.draft.links.map((link) => ({ ...link })),
      createdAt: now,
      updatedAt: now
    });

    state.workflowTemplates.push(template);
    runtime.activeTemplateId = template.id;
    if (elements.workflowTemplateNameInput) {
      elements.workflowTemplateNameInput.value = '';
    }
    persistWorkflowChanges();
    renderWorkflowViews();
  }

  function onCreateFromTemplate() {
    const templateId = String(elements.workflowTemplateSourceInput?.value || runtime.activeTemplateId || '').trim();
    const workflowName = String(elements.workflowTemplateCreateNameInput?.value || '').trim();
    if (!templateId) {
      return;
    }

    const template = getTemplateById(templateId);
    if (!template) {
      return;
    }

    createWorkflowFromTemplateRecord(template, {
      workflowName,
      projectId: String(elements.workflowTemplateCreateProjectInput?.value || '').trim()
    });
  }

  function onTemplateListClick(event) {
    const useBtn = event.target.closest('[data-workflow-template-use]');
    if (useBtn) {
      const templateId = useBtn.dataset.workflowTemplateUse;
      selectTemplate(templateId);
      renderer.setWorkflowEntryMode?.('list');
      renderWorkflowViews();
      return;
    }

    const deleteBtn = event.target.closest('[data-workflow-template-delete]');
    if (!deleteBtn) {
      return;
    }

    const templateId = deleteBtn.dataset.workflowTemplateDelete;
    state.workflowTemplates = (state.workflowTemplates || []).filter(
      (template) => template.id !== templateId
    );
    if (runtime.activeTemplateId === templateId) {
      runtime.activeTemplateId = '';
      runtime.activeWorkflowId = '';
      runtime.activeEntryId = '';
      runtime.activeBlockId = '';
    }

    persistWorkflowChanges();
    renderWorkflowViews();
  }

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

  function cloneProtocolSnapshot(protocol) {
    if (!protocol || typeof protocol !== 'object') {
      return null;
    }
    const protocolId = String(protocol.id || '').trim();
    return {
      id: protocolId,
      name: String(protocol.name || '').trim() || 'Untitled Protocol',
      category: String(protocol.category || '').trim(),
      purpose: String(protocol.purpose || '').trim(),
      steps: Array.isArray(protocol.steps)
        ? protocol.steps.map((step, index) => {
          const stepId = String(step?.id || '').trim() || `${protocolId || 'protocol'}_step_${index + 1}`;
          return {
            id: stepId,
            text: String(step?.text || '').trim(),
            placeholders: Array.isArray(step?.placeholders)
              ? step.placeholders.map((placeholder, placeholderIndex) => ({
                id: String(placeholder?.id || '').trim() || `${stepId}_placeholder_${placeholderIndex + 1}`,
                name: String(placeholder?.name || '').trim() || `Value ${placeholderIndex + 1}`
              }))
              : []
          };
        })
        : []
    };
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

  async function onWorkflowFileInputChange(fileInput) {
    const workflowId = String(fileInput.dataset.workflowWorkflowId || '').trim();
    const entryId = String(fileInput.dataset.workflowEntryId || '').trim();
    const blockId = String(fileInput.dataset.workflowStepFiles || '').trim();
    const { workflow, entry } = getWorkflowEntry(workflowId, entryId);
    const block = (workflow?.blocks || []).find((item) => item.id === blockId);
    if (!workflow || !entry || !block) {
      return;
    }

    const selectedFiles = Array.from(fileInput.files || []);
    if (!selectedFiles.length) {
      return;
    }

    try {
      const storageFolder = buildWorkflowStepResultsFolderPath(workflow, entry, block);
      await ensureStorageFolderExists(storageFolder);
      const importedRecords = await persistImportedWorkflowFiles({
        files: selectedFiles,
        storageFolder
      });
      const stepState = ensureEntryStepState(entry, blockId);
      stepState.resultFileRecords = stepState.resultFileRecords.concat(importedRecords);
      stepState.resultFiles = uniqueStrings([
        ...stepState.resultFiles,
        ...importedRecords.map((record) => record.name)
      ]);
      stepState.updatedAt = new Date().toISOString();
      touchEntry(entry);
      touchWorkflow(workflow);
      if (stepState.notebookEntryId) {
        upsertNotebookEntryForStep(workflow, entry, block, {});
      }
      persistWorkflowChanges();
      renderWorkflowViews();
    } catch (error) {
      showTransientNotice(String(error?.message || error || 'Failed to store workflow files.'), { type: 'error' });
    } finally {
      fileInput.value = '';
    }
  }

  function bindEvents() {
    elements.workflowForm?.addEventListener('submit', onWorkflowSubmit);
    elements.workflowCancelBtn?.addEventListener('click', onCancelWorkflowEdit);
    elements.workflowProjectInput?.addEventListener('change', onProjectChange);
    elements.workflowBlockTypeInput?.addEventListener('change', renderer.syncBlockComposerFields);
    elements.workflowBlockProtocolSearchInput?.addEventListener('input', renderer.renderProtocolOptions);
    elements.workflowBlockAddBtn?.addEventListener('click', onAddBlock);
    elements.workflowBlockList?.addEventListener('click', onBlockListClick);
    elements.workflowBlockList?.addEventListener('change', onBlockListChange);
    elements.workflowList?.addEventListener('click', onWorkflowListClick);
    elements.workflowSaveTemplateBtn?.addEventListener('click', onSaveTemplate);
    elements.workflowTemplateCancelBtn?.addEventListener('click', onCancelWorkflowEdit);
    elements.workflowTemplateCreateBtn?.addEventListener('click', onCreateFromTemplate);
    elements.workflowTemplateList?.addEventListener('click', onTemplateListClick);
    elements.workflowEntryTemplateBtn?.addEventListener('click', onStartCreateWorkflowTemplate);
    elements.workflowEntryViewBtn?.addEventListener('click', onStartViewEditWorkflow);
    elements.workflowEntryBackBtn?.addEventListener('click', onBackToWorkflowEntry);
    elements.workflowSearchInput?.addEventListener('input', onExecutionSearchInput);
    elements.workflowAddRunBtn?.addEventListener('click', onAddWorkflow);
    elements.workflowDeleteRunBtn?.addEventListener('click', onDeleteWorkflow);
    elements.workflowExecutionBoard?.addEventListener('click', onExecutionBoardClick);
    elements.workflowExecutionBoard?.addEventListener('change', onExecutionBoardChange);
    window.addEventListener('resize', renderer.syncExecutionPopoverPosition);

    graphController.bindEvents?.();
  }

  function normalizeDraft() {
    runtime.draft.blocks = normalizeBlocks(runtime.draft.blocks);
    runtime.draft.links = normalizeLinks(runtime.draft.links, runtime.draft.blocks);
    runtime.draft.notebookEntryIds = uniqueStrings(runtime.draft.notebookEntryIds);
    runtime.draft.entries = Array.isArray(runtime.draft.entries) ? runtime.draft.entries : [];
  }

  return {
    bindEvents,
    cloneWorkflowIntoDraft,
    ensureStateShape,
    normalizeDraft,
    resetDraftToEmpty,
    selectWorkflow
  };
}
