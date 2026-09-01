import {
  createEmptyDraft,
  createEmptyWorkflowEntry,
  uniqueStrings
} from './model.js';
import {
  cloneWorkflowDraft,
  ensureWorkflowStateShape
} from './state.js';
import { createWorkflowArtifactStorage } from './artifact-storage.js';
import { createWorkflowStepState } from './actions/step-state.js';
import { createWorkflowTemplateEditor } from './actions/template-editor.js';
import { createWorkflowExecutionBoard } from './actions/execution-board.js';
import { showTransientNotice } from '../../lib/notify.js';

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

  const {
    onStartCreateWorkflowTemplate,
    onBackToWorkflowEntry,
    onCancelWorkflowEdit,
    onProjectChange,
    onWorkflowSubmit,
    onAddBlock,
    onBlockListClick,
    onBlockListChange,
    onWorkflowListClick,
    onSaveTemplate,
    onCreateFromTemplate,
    onTemplateListClick
  } = createWorkflowTemplateEditor({
    state,
    runtime,
    elements,
    renderer,
    graphController,
    createId,
    normalizeWorkflow,
    normalizeTemplate,
    ensureStateShape: (...args) => ensureStateShape(...args),
    renderWorkflowViews: (...args) => renderWorkflowViews(...args),
    persistWorkflowChanges: (...args) => persistWorkflowChanges(...args),
    getTemplateById: (...args) => getTemplateById(...args),
    createWorkflowEntryRecord: (...args) => createWorkflowEntryRecord(...args),
    selectTemplate: (...args) => selectTemplate(...args),
    cloneWorkflowIntoDraft: (...args) => cloneWorkflowIntoDraft(...args),
    resetDraftToEmpty: (...args) => resetDraftToEmpty(...args),
    createWorkflowFromTemplateRecord: (...args) => createWorkflowFromTemplateRecord(...args)
  });



  const {
    getWorkflowEntry,
    getPrimaryWorkflowEntry,
    getPreferredWorkflowBlockId,
    ensureEntryStepState,
    touchEntry,
    touchWorkflow,
    upsertNotebookEntryForStep
  } = createWorkflowStepState({
    state,
    renderer,
    createId,
    getWorkflowById: (...args) => getWorkflowById(...args),
    buildWorkflowStepNotebookFolderPath
  });


  const {
    onExecutionSearchInput,
    onAddWorkflow,
    onDeleteWorkflow,
    onExecutionBoardClick,
    onExecutionBoardChange
  } = createWorkflowExecutionBoard({
    runtime,
    elements,
    onOpenNotebookEntry,
    onCreateLinkedAssay,
    renderWorkflowViews: (...args) => renderWorkflowViews(...args),
    persistWorkflowChanges: (...args) => persistWorkflowChanges(...args),
    getWorkflowById: (...args) => getWorkflowById(...args),
    getTemplateById: (...args) => getTemplateById(...args),
    deleteWorkflow: (...args) => deleteWorkflow(...args),
    createWorkflowFromTemplateRecord: (...args) => createWorkflowFromTemplateRecord(...args),
    onWorkflowFileInputChange: (...args) => onWorkflowFileInputChange(...args),
    getWorkflowEntry: (...args) => getWorkflowEntry(...args),
    getPrimaryWorkflowEntry: (...args) => getPrimaryWorkflowEntry(...args),
    getPreferredWorkflowBlockId: (...args) => getPreferredWorkflowBlockId(...args),
    ensureEntryStepState: (...args) => ensureEntryStepState(...args),
    touchEntry: (...args) => touchEntry(...args),
    touchWorkflow: (...args) => touchWorkflow(...args),
    upsertNotebookEntryForStep: (...args) => upsertNotebookEntryForStep(...args)
  });



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

  function onBlockTypeKeydown(event) {
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0);
    if (!direction) {
      return;
    }

    const options = Array.from(
      elements.workflowBlockTypeControl
        ?.querySelectorAll?.('input[name="workflow-block-type-option"]')
      || []
    );
    const currentIndex = options.findIndex((option) => option === event.target || option.checked);
    if (currentIndex < 0 || options.length < 2) {
      return;
    }

    event.preventDefault();
    const nextOption = options[(currentIndex + direction + options.length) % options.length];
    nextOption.checked = true;
    nextOption.focus?.();
    renderer.syncBlockComposerFields?.();
  }

  function bindEvents() {
    elements.workflowForm?.addEventListener('submit', onWorkflowSubmit);
    elements.workflowCancelBtn?.addEventListener('click', onCancelWorkflowEdit);
    elements.workflowProjectInput?.addEventListener('change', onProjectChange);
    elements.workflowBlockTypeControl?.addEventListener('change', renderer.syncBlockComposerFields);
    elements.workflowBlockTypeControl?.addEventListener('keydown', onBlockTypeKeydown);
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
