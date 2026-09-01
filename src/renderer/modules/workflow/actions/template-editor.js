import { BLOCK_TYPES } from '../constants.js';
import {
  getBlockType,
  normalizePlainTextBlock,
  suggestedBlockPosition,
  uniqueStrings
} from '../model.js';
import { resolveDefaultAssigneeId } from '../state.js';

// Building and editing a workflow template: the block composer, the draft form,
// saving a template, and creating a workflow run from one.
function createWorkflowTemplateEditor({
  state,
  runtime,
  elements,
  renderer,
  graphController,
  createId,
  normalizeWorkflow,
  normalizeTemplate,
  ensureStateShape,
  renderWorkflowViews,
  persistWorkflowChanges,
  getTemplateById,
  createWorkflowEntryRecord,
  selectTemplate,
  cloneWorkflowIntoDraft,
  resetDraftToEmpty,
  createWorkflowFromTemplateRecord
} = {}) {
  function getBlockComposerType() {
    const selected = String(
      elements.workflowBlockTypeControl
        ?.querySelector?.('input[name="workflow-block-type-option"]:checked')
        ?.value
      || ''
    ).trim().toLowerCase();
    return selected === BLOCK_TYPES.TEXT ? BLOCK_TYPES.TEXT : BLOCK_TYPES.PROTOCOL;
  }

  function onStartCreateWorkflowTemplate() {
    resetDraftToEmpty();
    renderer.setWorkflowEntryMode?.('template');
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
  return {
    getBlockComposerType,
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
  };
}

export { createWorkflowTemplateEditor };
