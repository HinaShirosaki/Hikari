import { BLOCK_TYPES } from './constants.js';
import { createWorkflowTableMarkup } from './renderer/workflow-table-markup.js';
import { createWorkflowOptionLists } from './renderer/option-lists.js';
import {
  assigneeLabelById,
  blockDisplayLabel,
  blockTypeLabel,
  blockTitle
} from './presentation.js';
import {
  buildWorkflowExecutionLayout,
  computeEntryProgress,
  isWorkflowStepOpenable
} from './execution.js';

export function createWorkflowRenderer(config = {}) {
  const state = config?.state || {};
  const runtime = config?.runtime || {};
  const elements = config?.elements || {};
  const safeText = typeof config?.safeText === 'function' ? config.safeText : String;
  const getBlockType = config?.getBlockType || (() => '');
  const uniqueStrings = config?.uniqueStrings || ((values) => values || []);
  const parseTimestamp = config?.parseTimestamp || (() => 0);
  const formatTimestamp = config?.formatTimestamp || (() => '-');
  const getRenderGraphEditor = typeof config?.getRenderGraphEditor === 'function'
    ? config.getRenderGraphEditor
    : (() => null);
  function getSelectedValues(select) {
    if (!select) {
      return [];
    }
    return Array.from(select.selectedOptions || []).map((option) => option.value);
  }

  function setSelectedValues(select, values) {
    if (!select) {
      return;
    }
    const selected = new Set(uniqueStrings(values));
    Array.from(select.options).forEach((option) => {
      option.selected = selected.has(option.value);
    });
  }

  function protocolNameResolver(protocolId) {
    const protocol = (state.protocols || []).find((item) => item.id === protocolId);
    return protocol?.name || `Missing protocol (${protocolId})`;
  }

  function titleForBlock(block) {
    return blockTitle(block, {
      getBlockType,
      protocolNameById: protocolNameResolver
    });
  }

  function collectProtocolPlaceholderFields(protocol) {
    if (!protocol || !Array.isArray(protocol.steps)) {
      return [];
    }
    const fields = [];
    protocol.steps.forEach((step) => {
      const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
      placeholders.forEach((placeholder) => {
        const key = `${step.id}:${placeholder.id}`;
        fields.push({
          key,
          placeholderName: placeholder.name
        });
      });
    });
    return fields;
  }

  function classifyWorkflowDot(stepState, blockId, activeBlockId, progress) {
    if (stepState?.status === 'completed') {
      return {
        className: 'is-finished',
        title: 'Finished'
      };
    }
    if (stepState?.status === 'failed') {
      return {
        className: 'is-failed',
        title: 'Failed'
      };
    }
    if (progress?.nextBlockId === blockId || activeBlockId === blockId) {
      return {
        className: 'is-pending',
        title: 'Pending'
      };
    }
    return {
      className: 'is-empty',
      title: 'Not done'
    };
  }

  function getWorkflowTrackColumnCount(layout) {
    const mainCount = Math.max(1, layout?.mainPath?.length || 0);
    return Math.max(
      mainCount,
      ...((layout?.branches || []).map((branch) => (
        (Number(branch.anchorIndex) || 0) + (branch.blockIds?.length || 0)
      )))
    );
  }

  function workflowTrackSegmentStyle(startIndex, widthColumns, rowOffset, trackColumnCount) {
    const safeColumnCount = Math.max(1, Number(trackColumnCount) || 1);
    const left = ((Number(startIndex) || 0) + 0.5) / safeColumnCount * 100;
    const width = Math.max(0, Number(widthColumns) || 0) / safeColumnCount * 100;
    return [
      `--workflow-track-segment-left: ${left}%;`,
      `--workflow-track-segment-width: ${width}%;`,
      `--workflow-track-row-offset: ${Math.max(0, Number(rowOffset) || 0)};`
    ].join(' ');
  }

  function workflowTrackCellStyle(columnIndex, rowIndex) {
    return `grid-column: ${Math.max(1, Number(columnIndex) || 1)}; grid-row: ${Math.max(1, Number(rowIndex) || 1)};`;
  }

  function templateSearchText(template) {
    return [
      template?.name,
      template?.description,
      ...(Array.isArray(template?.blocks) ? template.blocks.map((block) => titleForBlock(block)) : [])
    ].join(' ').toLowerCase();
  }

  function getVisibleTemplates() {
    const searchTerm = String(elements.workflowSearchInput?.value || runtime.workflowSearchTerm || '').trim().toLowerCase();
    const templates = [...(state.workflowTemplates || [])]
      .sort((a, b) => parseTimestamp(b.updatedAt || b.createdAt) - parseTimestamp(a.updatedAt || a.createdAt))
      .filter((template) => !searchTerm || templateSearchText(template).includes(searchTerm));
    runtime.workflowSearchTerm = searchTerm;
    return templates;
  }

  function ensureActiveTemplate(templates) {
    const currentId = String(runtime.activeTemplateId || '').trim();
    if (currentId && templates.some((template) => template.id === currentId)) {
      return templates.find((template) => template.id === currentId) || null;
    }
    const nextTemplate = templates[0] || null;
    runtime.activeTemplateId = nextTemplate?.id || '';
    if (!nextTemplate) {
      runtime.activeWorkflowId = '';
      runtime.activeEntryId = '';
      runtime.activeBlockId = '';
    }
    return nextTemplate;
  }

  function getWorkflowsForTemplate(templateId) {
    const normalizedTemplateId = String(templateId || '').trim();
    if (!normalizedTemplateId) {
      return [];
    }
    return [...(state.workflows || [])]
      .filter((workflow) => String(workflow.templateId || '').trim() === normalizedTemplateId)
      .sort((a, b) => parseTimestamp(b.updatedAt || b.createdAt) - parseTimestamp(a.updatedAt || a.createdAt));
  }

  function ensureActiveWorkflow(workflows) {
    const currentId = String(runtime.activeWorkflowId || '').trim();
    if (currentId && workflows.some((workflow) => workflow.id === currentId)) {
      return workflows.find((workflow) => workflow.id === currentId) || null;
    }
    runtime.activeWorkflowId = '';
    runtime.activeEntryId = '';
    runtime.activeBlockId = '';
    return null;
  }

  function labelForBlockType(block) {
    return blockTypeLabel(block, getBlockType);
  }

  function labelForAssignee(memberId) {
    return assigneeLabelById(state, memberId);
  }

  function displayLabelForBlock(blockId) {
    return blockDisplayLabel(blockId, runtime.draft?.blocks || [], titleForBlock);
  }

  function syncBlockComposerFields() {
    const selected = String(
      elements.workflowBlockTypeControl
        ?.querySelector?.('input[name="workflow-block-type-option"]:checked')
        ?.value
      || ''
    ).trim().toLowerCase();
    const blockType = selected === BLOCK_TYPES.TEXT ? BLOCK_TYPES.TEXT : BLOCK_TYPES.PROTOCOL;
    const isProtocol = blockType === BLOCK_TYPES.PROTOCOL;

    elements.workflowBlockTypeControl
      ?.querySelectorAll?.('input[name="workflow-block-type-option"]')
      ?.forEach((input) => {
        input.checked = input.value === blockType;
      });
    if (elements.workflowBlockProtocolSearchField) {
      elements.workflowBlockProtocolSearchField.hidden = !isProtocol;
    }
    if (elements.workflowBlockProtocolField) {
      elements.workflowBlockProtocolField.hidden = !isProtocol;
    }
    if (elements.workflowBlockTextField) {
      elements.workflowBlockTextField.hidden = isProtocol;
    }
    if (elements.workflowBlockProtocolInput) {
      elements.workflowBlockProtocolInput.disabled = !isProtocol;
    }
    if (elements.workflowBlockTextInput) {
      elements.workflowBlockTextInput.disabled = isProtocol;
    }
    if (elements.workflowBlockAddBtn) {
      elements.workflowBlockAddBtn.textContent = isProtocol ? 'Add Protocol Block' : 'Add Text Block';
    }
  }

  const {
    renderProjectOptions,
    renderTemplateCreateProjectOptions,
    renderNotebookOptions,
    renderProtocolOptions,
    renderProtocolResults,
    renderProtocolPicker,
    renderBlockList,
    renderTemplateSourceOptions,
    renderTemplateList,
    renderWorkflowList
  } = createWorkflowOptionLists({
    state,
    runtime,
    elements,
    safeText,
    getBlockType,
    uniqueStrings,
    parseTimestamp,
    formatTimestamp,
    titleForBlock: (...args) => titleForBlock(...args),
    labelForBlockType: (...args) => labelForBlockType(...args),
    displayLabelForBlock: (...args) => displayLabelForBlock(...args),
    getVisibleTemplates: (...args) => getVisibleTemplates(...args),
    ensureActiveTemplate: (...args) => ensureActiveTemplate(...args),
    getWorkflowsForTemplate: (...args) => getWorkflowsForTemplate(...args)
  });



  const {
    buildTemplateWorkflowTableMarkup
  } = createWorkflowTableMarkup({
    state,
    runtime,
    safeText,
    getBlockType,
    titleForBlock: (...args) => titleForBlock(...args),
    classifyWorkflowDot: (...args) => classifyWorkflowDot(...args),
    collectProtocolPlaceholderFields: (...args) => collectProtocolPlaceholderFields(...args),
    getWorkflowTrackColumnCount: (...args) => getWorkflowTrackColumnCount(...args),
    workflowTrackSegmentStyle: (...args) => workflowTrackSegmentStyle(...args),
    workflowTrackCellStyle: (...args) => workflowTrackCellStyle(...args)
  });



  function syncExecutionPopoverPosition() {
    if (!elements.workflowExecutionBoard) {
      return;
    }

    const scrollRegion = elements.workflowExecutionBoard.querySelector('.workflow-execution-scroll');
    const popover = elements.workflowExecutionBoard.querySelector('[data-workflow-step-popover]');
    const anchor = elements.workflowExecutionBoard.querySelector('[data-workflow-step-anchor="true"]');
    if (!scrollRegion || !popover || !anchor) {
      if (popover) {
        popover.classList.remove('is-positioned');
      }
      return;
    }

    const scrollRect = scrollRegion.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const baseLeft = (anchorRect.left - scrollRect.left) + scrollRegion.scrollLeft + (anchorRect.width / 2);
    const baseTop = (anchorRect.bottom - scrollRect.top) + scrollRegion.scrollTop + 8;
    const popoverWidth = popover.offsetWidth || 300;
    const minLeft = scrollRegion.scrollLeft + (popoverWidth / 2) + 12;
    const maxLeft = scrollRegion.scrollLeft + scrollRegion.clientWidth - (popoverWidth / 2) - 12;
    const clampedLeft = Math.min(Math.max(baseLeft, minLeft), Math.max(minLeft, maxLeft));

    popover.style.setProperty('--workflow-step-popover-left', `${Math.round(clampedLeft)}px`);
    popover.style.setProperty('--workflow-step-popover-top', `${Math.round(baseTop)}px`);
    popover.classList.add('is-positioned');
  }

  function renderExecutionBoard() {
    if (!elements.workflowExecutionBoard || !elements.workflowExecutionTitle) {
      return;
    }

    const templates = getVisibleTemplates();
    const activeTemplate = ensureActiveTemplate(templates);
    const workflows = getWorkflowsForTemplate(activeTemplate?.id);
    const activeWorkflow = ensureActiveWorkflow(workflows);
    if (activeWorkflow && !activeWorkflow.entries.some((entry) => entry.id === runtime.activeEntryId)) {
      runtime.activeEntryId = activeWorkflow.entries[0]?.id || '';
    }
    if (activeWorkflow) {
      const activeEntry = activeWorkflow.entries.find((entry) => entry.id === runtime.activeEntryId) || activeWorkflow.entries[0] || null;
      const activeLayout = buildWorkflowExecutionLayout(activeWorkflow);
      const activeProgress = activeEntry ? computeEntryProgress(activeEntry, activeLayout) : null;
      const allowedActiveBlockIds = new Set(activeProgress?.orderedIds || activeLayout.mainPathIds);
      if (
        !allowedActiveBlockIds.has(runtime.activeBlockId)
        || !isWorkflowStepOpenable(activeEntry, activeLayout, runtime.activeBlockId)
      ) {
        runtime.activeBlockId = '';
      }
    }

    if (elements.workflowAddRunBtn) {
      elements.workflowAddRunBtn.disabled = !activeTemplate;
    }
    if (elements.workflowDeleteRunBtn) {
      elements.workflowDeleteRunBtn.disabled = !activeWorkflow;
    }

    if (!activeTemplate) {
      elements.workflowExecutionTitle.textContent = 'Select a workflow template';
      elements.workflowExecutionBoard.innerHTML = '<p class="small-note">No workflow template selected.</p>';
      return;
    }

    elements.workflowExecutionTitle.textContent = activeTemplate.name || 'Untitled template';
    elements.workflowExecutionBoard.innerHTML = buildTemplateWorkflowTableMarkup(activeTemplate, workflows, activeWorkflow);
    const executionScroll = elements.workflowExecutionBoard.querySelector('.workflow-execution-scroll');
    if (executionScroll && elements.workflowExecutionBoard.querySelector('[data-workflow-step-popover]')) {
      executionScroll.addEventListener('scroll', syncExecutionPopoverPosition, { passive: true });
      window.requestAnimationFrame(syncExecutionPopoverPosition);
    }
  }

  function updateSubmitButtonLabel() {
    if (elements.workflowSubmitBtn) {
      elements.workflowSubmitBtn.textContent = runtime.draft?.id ? 'Update Workflow' : 'Save Workflow';
    }
  }

  function renderBlockEditor() {
    renderProtocolPicker();
    syncBlockComposerFields();
    renderBlockList();
    const graphRenderer = getRenderGraphEditor();
    if (typeof graphRenderer === 'function') {
      graphRenderer();
    }
  }

  function applyDraftToForm() {
    if (elements.workflowIdInput) {
      elements.workflowIdInput.value = runtime.draft?.id || '';
    }
    if (elements.workflowNameInput) {
      elements.workflowNameInput.value = runtime.draft?.name || '';
    }
    if (elements.workflowDescriptionInput) {
      elements.workflowDescriptionInput.value = runtime.draft?.description || '';
    }
    if (elements.workflowTemplateDescriptionInput) {
      elements.workflowTemplateDescriptionInput.value = runtime.draft?.description || '';
    }
    renderProjectOptions();
    renderTemplateCreateProjectOptions();
    renderNotebookOptions();
    setSelectedValues(elements.workflowNotebookPagesInput, runtime.draft?.notebookEntryIds);
    renderBlockEditor();
    updateSubmitButtonLabel();
  }

  function setWorkflowEntryMode(nextMode) {
    runtime.workflowEntryMode = nextMode === 'create' || nextMode === 'template' || nextMode === 'list'
      ? nextMode
      : 'list';

    const showWorkflowSidebarEditor = runtime.workflowEntryMode === 'create';
    const showMainEditor = runtime.workflowEntryMode === 'create' || runtime.workflowEntryMode === 'template';
    const showTemplateEditor = runtime.workflowEntryMode === 'template';
    const showList = runtime.workflowEntryMode === 'list';
    const showHome = runtime.workflowEntryMode === 'list';
    const hideLinkFields = runtime.workflowEntryMode === 'template';
    if (hideLinkFields && (runtime.draft?.projectId || runtime.draft?.notebookEntryIds?.length)) {
      runtime.draft.projectId = '';
      runtime.draft.notebookEntryIds = [];
      renderProjectOptions();
      renderNotebookOptions();
      setSelectedValues(elements.workflowNotebookPagesInput, runtime.draft.notebookEntryIds);
    }

    if (elements.workflowEntryBackBtn) {
      elements.workflowEntryBackBtn.hidden = showHome;
    }
    if (elements.workflowEntryPanel) {
      elements.workflowEntryPanel.hidden = false;
    }
    if (elements.workflowEntryTemplateBtn) {
      elements.workflowEntryTemplateBtn.hidden = !showHome;
    }
    (elements.workflowSidebarEditorPanels || []).forEach((panel) => {
      panel.hidden = !showWorkflowSidebarEditor;
    });
    (elements.workflowBlockComposerPanels || []).forEach((panel) => {
      panel.hidden = !showMainEditor;
    });
    (elements.workflowMainEditorPanels || []).forEach((panel) => {
      panel.hidden = !showMainEditor;
    });
    (elements.workflowTemplateEditorPanels || []).forEach((panel) => {
      panel.hidden = !showTemplateEditor;
    });
    (elements.workflowListPanels || []).forEach((panel) => {
      panel.hidden = !showList;
    });

    if (elements.workflowProjectField) {
      elements.workflowProjectField.hidden = hideLinkFields;
      elements.workflowProjectField.style.display = hideLinkFields ? 'none' : '';
    }
    if (elements.workflowNotebookPagesField) {
      elements.workflowNotebookPagesField.hidden = hideLinkFields;
      elements.workflowNotebookPagesField.style.display = hideLinkFields ? 'none' : '';
    }
    if (elements.workflowProjectInput) {
      elements.workflowProjectInput.disabled = hideLinkFields;
    }
    if (elements.workflowNotebookPagesInput) {
      elements.workflowNotebookPagesInput.disabled = hideLinkFields;
    }
  }

  return {
    applyDraftToForm,
    displayLabelForBlock,
    getSelectedValues,
    labelForAssignee,
    labelForBlockType,
    renderExecutionBoard,
    renderBlockEditor,
    renderBlockList,
    renderNotebookOptions,
    renderProjectOptions,
    renderProtocolPicker,
    renderProtocolOptions,
    renderProtocolResults,
    renderTemplateCreateProjectOptions,
    renderTemplateList,
    renderTemplateSourceOptions,
    renderWorkflowList,
    setSelectedValues,
    setWorkflowEntryMode,
    syncExecutionPopoverPosition,
    syncBlockComposerFields,
    titleForBlock,
    updateSubmitButtonLabel
  };
}
