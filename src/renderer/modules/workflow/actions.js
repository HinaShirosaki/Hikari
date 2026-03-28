import { BLOCK_TYPES } from './constants.js';
import {
  createEmptyDraft,
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

  function ensureStateShape() {
    ensureWorkflowStateShape(state, {
      normalizeWorkflow,
      normalizeTemplate
    });
  }

  function cloneWorkflowIntoDraft(workflow) {
    runtime.draft = cloneWorkflowDraft(workflow, normalizeWorkflow);
    graphController.resetInteractionState?.();
  }

  function resetDraftToEmpty() {
    runtime.draft = createEmptyDraft();
    graphController.resetInteractionState?.();
    renderer.applyDraftToForm?.();
    renderer.renderWorkflowList?.();
  }

  function notifyWorkflowsChanged() {
    onWorkflowsChanged();
  }

  function getBlockComposerType() {
    const selected = String(elements.workflowBlockTypeInput?.value || '').trim().toLowerCase();
    return selected === BLOCK_TYPES.TEXT ? BLOCK_TYPES.TEXT : BLOCK_TYPES.PROTOCOL;
  }

  function onStartCreateWorkflow() {
    resetDraftToEmpty();
    renderer.setWorkflowEntryMode?.('create');
  }

  function onStartCreateWorkflowTemplate() {
    resetDraftToEmpty();
    renderer.setWorkflowEntryMode?.('template');
  }

  function onStartViewEditWorkflow() {
    renderer.setWorkflowEntryMode?.('list');
  }

  function onBackToWorkflowEntry() {
    resetDraftToEmpty();
    renderer.setWorkflowEntryMode?.('home');
  }

  function onCancelWorkflowEdit() {
    resetDraftToEmpty();
    renderer.setWorkflowEntryMode?.('home');
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

    const workflowRecord = normalizeWorkflow({
      ...runtime.draft,
      id: elements.workflowIdInput?.value || runtime.draft.id || createId(),
      name,
      description: String(elements.workflowDescriptionInput?.value || '').trim(),
      projectId,
      notebookEntryIds,
      createdAt: existing?.createdAt || runtime.draft.createdAt || now,
      updatedAt: now
    });

    const index = state.workflows.findIndex((workflow) => workflow.id === workflowRecord.id);
    if (index >= 0) {
      state.workflows[index] = workflowRecord;
    } else {
      state.workflows.push(workflowRecord);
    }

    persist();
    notifyWorkflowsChanged();
    cloneWorkflowIntoDraft(workflowRecord);
    renderer.renderTemplateSourceOptions?.();
    renderer.renderTemplateList?.();
    renderer.renderWorkflowList?.();
    renderer.setWorkflowEntryMode?.('list');
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
    const editBtn = event.target.closest('[data-workflow-edit]');
    if (editBtn) {
      const workflow = (state.workflows || []).find((item) => item.id === editBtn.dataset.workflowEdit);
      if (!workflow) {
        return;
      }

      cloneWorkflowIntoDraft(workflow);
      renderer.applyDraftToForm?.();
      renderer.renderWorkflowList?.();
      renderer.setWorkflowEntryMode?.('create');
      return;
    }

    const deleteBtn = event.target.closest('[data-workflow-delete]');
    if (!deleteBtn) {
      return;
    }

    const workflowId = deleteBtn.dataset.workflowDelete;
    state.workflows = (state.workflows || []).filter((workflow) => workflow.id !== workflowId);
    if (runtime.draft.id === workflowId) {
      resetDraftToEmpty();
    }

    persist();
    notifyWorkflowsChanged();
    renderer.renderWorkflowList?.();
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
      description: String(elements.workflowDescriptionInput?.value || '').trim() || runtime.draft.description,
      blocks: runtime.draft.blocks.map((block) => ({ ...block })),
      links: runtime.draft.links.map((link) => ({ ...link })),
      createdAt: now,
      updatedAt: now
    });

    state.workflowTemplates.push(template);
    if (elements.workflowTemplateNameInput) {
      elements.workflowTemplateNameInput.value = '';
    }
    persist();
    renderer.renderTemplateSourceOptions?.();
    renderer.renderTemplateList?.();
  }

  function onCreateFromTemplate() {
    const templateId = String(elements.workflowTemplateSourceInput?.value || '').trim();
    const workflowName = String(elements.workflowTemplateCreateNameInput?.value || '').trim();
    if (!templateId || !workflowName) {
      return;
    }

    const template = (state.workflowTemplates || []).find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    const workflow = instantiateTemplate(template, workflowName);
    state.workflows.push(workflow);

    persist();
    notifyWorkflowsChanged();
    if (elements.workflowTemplateCreateNameInput) {
      elements.workflowTemplateCreateNameInput.value = '';
    }

    cloneWorkflowIntoDraft(workflow);
    renderer.applyDraftToForm?.();
    renderer.renderWorkflowList?.();
    renderer.setWorkflowEntryMode?.('create');
  }

  function onTemplateListClick(event) {
    const useBtn = event.target.closest('[data-workflow-template-use]');
    if (useBtn) {
      const templateId = useBtn.dataset.workflowTemplateUse;
      const template = (state.workflowTemplates || []).find((item) => item.id === templateId);
      if (elements.workflowTemplateSourceInput) {
        elements.workflowTemplateSourceInput.value = templateId;
      }
      if (
        template
        && !String(elements.workflowTemplateCreateNameInput?.value || '').trim()
        && elements.workflowTemplateCreateNameInput
      ) {
        elements.workflowTemplateCreateNameInput.value = `${template.name} Copy`;
      }
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
    if (elements.workflowTemplateSourceInput?.value === templateId) {
      elements.workflowTemplateSourceInput.value = '';
    }

    persist();
    renderer.renderTemplateSourceOptions?.();
    renderer.renderTemplateList?.();
  }

  function bindEvents() {
    elements.workflowForm.addEventListener('submit', onWorkflowSubmit);
    elements.workflowCancelBtn?.addEventListener('click', onCancelWorkflowEdit);
    elements.workflowProjectInput?.addEventListener('change', onProjectChange);
    elements.workflowBlockTypeInput?.addEventListener('change', renderer.syncBlockComposerFields);
    elements.workflowBlockProtocolSearchInput?.addEventListener('input', renderer.renderProtocolOptions);
    elements.workflowBlockAddBtn?.addEventListener('click', onAddBlock);
    elements.workflowBlockList?.addEventListener('click', onBlockListClick);
    elements.workflowBlockList?.addEventListener('change', onBlockListChange);
    elements.workflowList?.addEventListener('click', onWorkflowListClick);
    elements.workflowSaveTemplateBtn?.addEventListener('click', onSaveTemplate);
    elements.workflowTemplateCreateBtn?.addEventListener('click', onCreateFromTemplate);
    elements.workflowTemplateList?.addEventListener('click', onTemplateListClick);
    elements.workflowEntryCreateBtn?.addEventListener('click', onStartCreateWorkflow);
    elements.workflowEntryTemplateBtn?.addEventListener('click', onStartCreateWorkflowTemplate);
    elements.workflowEntryViewBtn?.addEventListener('click', onStartViewEditWorkflow);
    elements.workflowEntryBackBtn?.addEventListener('click', onBackToWorkflowEntry);

    graphController.bindEvents?.();
  }

  function normalizeDraft() {
    runtime.draft.blocks = normalizeBlocks(runtime.draft.blocks);
    runtime.draft.links = normalizeLinks(runtime.draft.links, runtime.draft.blocks);
    runtime.draft.notebookEntryIds = uniqueStrings(runtime.draft.notebookEntryIds);
  }

  return {
    bindEvents,
    cloneWorkflowIntoDraft,
    ensureStateShape,
    normalizeDraft,
    resetDraftToEmpty
  };
}
