import { BLOCK_TYPES } from './constants.js';
import {
  assigneeLabelById,
  blockDisplayLabel,
  blockTypeLabel,
  blockTitle,
  buildAssigneeOptions,
  buildDirectionMaps,
  notebookEntryLabel,
  projectNameById
} from './presentation.js';

export function createWorkflowRenderer(config = {}) {
  const state = config?.state || {};
  const runtime = config?.runtime || {};
  const elements = config?.elements || {};
  const safeText = typeof config?.safeText === 'function' ? config.safeText : String;
  const getBlockType = config?.getBlockType || (() => '');
  const normalizePlainTextBlock = config?.normalizePlainTextBlock || ((value) => String(value || '').trim());
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
    const selected = String(elements.workflowBlockTypeInput?.value || '').trim().toLowerCase();
    const blockType = selected === BLOCK_TYPES.TEXT ? BLOCK_TYPES.TEXT : BLOCK_TYPES.PROTOCOL;
    const isProtocol = blockType === BLOCK_TYPES.PROTOCOL;

    if (elements.workflowBlockTypeInput) {
      elements.workflowBlockTypeInput.value = blockType;
    }
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

  function renderProjectOptions() {
    if (!elements.workflowProjectInput) {
      return;
    }
    const options = ['<option value="">Unlinked project</option>'];
    (state.projects || []).forEach((project) => {
      options.push(`<option value="${safeText(project.id)}">${safeText(project.name)}</option>`);
    });
    if (
      runtime.draft?.projectId
      && !(state.projects || []).some((project) => project.id === runtime.draft.projectId)
    ) {
      options.push(`<option value="${safeText(runtime.draft.projectId)}">${safeText(`Missing project (${runtime.draft.projectId})`)}</option>`);
    }
    elements.workflowProjectInput.innerHTML = options.join('');
    elements.workflowProjectInput.value = runtime.draft?.projectId || '';
  }

  function renderNotebookOptions() {
    if (!elements.workflowNotebookPagesInput) {
      return;
    }

    const projectId = elements.workflowProjectInput?.value;
    const selectedNotebookIds = uniqueStrings(runtime.draft?.notebookEntryIds);
    const selectedSet = new Set(selectedNotebookIds);

    const entries = (state.notebookEntries || [])
      .filter((entry) => !projectId || entry.projectId === projectId)
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));

    const options = [];
    entries.forEach((entry) => {
      options.push(`<option value="${safeText(entry.id)}">${safeText(notebookEntryLabel(entry, formatTimestamp))}</option>`);
    });

    selectedNotebookIds.forEach((entryId) => {
      if (entries.some((entry) => entry.id === entryId)) {
        return;
      }
      options.push(`<option value="${safeText(entryId)}">${safeText(`Missing notebook page (${entryId})`)}</option>`);
    });

    if (!options.length) {
      options.push('<option value="" disabled>No notebook pages available</option>');
    }

    elements.workflowNotebookPagesInput.innerHTML = options.join('');
    Array.from(elements.workflowNotebookPagesInput.options).forEach((option) => {
      option.selected = selectedSet.has(option.value);
    });
  }

  function renderProtocolOptions() {
    if (!elements.workflowBlockProtocolInput) {
      return;
    }

    const selectedProtocolId = elements.workflowBlockProtocolInput.value;
    const selectedProtocol = (state.protocols || []).find((protocol) => protocol.id === selectedProtocolId) || null;
    const searchTerm = String(elements.workflowBlockProtocolSearchInput?.value || '').trim().toLowerCase();
    const options = ['<option value="">Select protocol</option>'];
    const filteredProtocols = (state.protocols || []).filter((protocol) => (
      String(protocol.name || '').toLowerCase().includes(searchTerm)
    ));

    if (selectedProtocol && !filteredProtocols.some((protocol) => protocol.id === selectedProtocol.id)) {
      filteredProtocols.unshift(selectedProtocol);
    }
    filteredProtocols.forEach((protocol) => {
      options.push(`<option value="${safeText(protocol.id)}">${safeText(protocol.name)}</option>`);
    });

    elements.workflowBlockProtocolInput.innerHTML = options.join('');
    if (
      selectedProtocolId
      && Array.from(elements.workflowBlockProtocolInput.options).some((option) => option.value === selectedProtocolId)
    ) {
      elements.workflowBlockProtocolInput.value = selectedProtocolId;
    }
  }

  function renderBlockList() {
    if (!elements.workflowBlockList) {
      return;
    }

    const blocks = runtime.draft?.blocks || [];
    const links = runtime.draft?.links || [];
    const { upstream, downstream } = buildDirectionMaps(blocks, links);

    if (!blocks.length) {
      elements.workflowBlockList.innerHTML = '<p class="small-note">No blocks yet. Add a protocol or plain-text block to start.</p>';
      return;
    }

    elements.workflowBlockList.innerHTML = blocks.map((block, index) => {
      const upstreamText = (upstream.get(block.id) || []).map((blockId) => displayLabelForBlock(blockId)).join(' | ') || '-';
      const downstreamText = (downstream.get(block.id) || []).map((blockId) => displayLabelForBlock(blockId)).join(' | ') || '-';
      const type = getBlockType(block);
      const title = titleForBlock(block);
      const typeLabel = labelForBlockType(block);
      const plainTextEditor = type === BLOCK_TYPES.TEXT
        ? `
            <label class="workflow-text-block-field">
              <span>Text</span>
              <input
                data-workflow-block-text="${safeText(block.id)}"
                value="${safeText(block.text)}"
                placeholder="Plain text"
              />
            </label>
          `
        : `<p class="small-note">Protocol: ${safeText(title)}</p>`;
      return `
        <article class="list-row workflow-block-row">
          <div class="workflow-block-meta">
            <strong>${safeText(`Block ${index + 1}: ${title}`)}</strong>
            <p class="small-note">Type: ${safeText(typeLabel)}</p>
            ${plainTextEditor}
            <p class="small-note">Upstream: ${safeText(upstreamText)}</p>
            <p class="small-note">Downstream: ${safeText(downstreamText)}</p>
          </div>
          <div class="workflow-assignee-field">
            <span>Assignee</span>
            <select data-workflow-block-assignee="${safeText(block.id)}">${buildAssigneeOptions(state, safeText, block.assigneeId)}</select>
          </div>
          <div class="list-actions">
            <button type="button" class="danger-btn" data-workflow-block-remove="${safeText(block.id)}">Remove</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderTemplateSourceOptions() {
    if (!elements.workflowTemplateSourceInput) {
      return;
    }
    const selected = elements.workflowTemplateSourceInput.value;
    const options = ['<option value="">Select template</option>'];
    const templates = [...(state.workflowTemplates || [])]
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));

    templates.forEach((template) => {
      options.push(`<option value="${safeText(template.id)}">${safeText(template.name || 'Untitled template')}</option>`);
    });

    elements.workflowTemplateSourceInput.innerHTML = options.join('');
    if (selected && templates.some((template) => template.id === selected)) {
      elements.workflowTemplateSourceInput.value = selected;
    }
  }

  function renderTemplateList() {
    if (!elements.workflowTemplateList) {
      return;
    }

    const templates = [...(state.workflowTemplates || [])]
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));

    if (!templates.length) {
      elements.workflowTemplateList.innerHTML = '<p class="small-note">No workflow templates saved yet.</p>';
      return;
    }

    elements.workflowTemplateList.innerHTML = templates.map((template) => `
      <article class="workflow-card">
        <h3>${safeText(template.name || 'Untitled template')}</h3>
        <p>${safeText(template.description || 'No description')}</p>
        <p><strong>Blocks:</strong> ${safeText(template.blocks.length)} | <strong>Connections:</strong> ${safeText(template.links.length)}</p>
        <p><strong>Updated:</strong> ${safeText(formatTimestamp(template.updatedAt || template.createdAt))}</p>
        <div class="card-actions">
          <button type="button" class="ghost-btn" data-workflow-template-use="${safeText(template.id)}">Use</button>
          <button type="button" class="danger-btn" data-workflow-template-delete="${safeText(template.id)}">Delete</button>
        </div>
      </article>
    `).join('');
  }

  function renderWorkflowList() {
    if (!elements.workflowList) {
      return;
    }

    const workflows = [...(state.workflows || [])]
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));

    if (!workflows.length) {
      elements.workflowList.innerHTML = '<p class="small-note">No workflows saved yet.</p>';
      return;
    }

    elements.workflowList.innerHTML = workflows.map((workflow) => {
      const assigneeLabels = uniqueStrings(workflow.blocks.map((block) => block.assigneeId).filter(Boolean))
        .map((memberId) => labelForAssignee(memberId))
        .join(', ') || 'Unassigned';
      const notebookLabels = workflow.notebookEntryIds
        .slice(0, 3)
        .map((entryId) => {
          const entry = (state.notebookEntries || []).find((item) => item.id === entryId);
          return entry ? notebookEntryLabel(entry, formatTimestamp) : `Missing notebook page (${entryId})`;
        });
      const moreNotebookCount = Math.max(0, workflow.notebookEntryIds.length - notebookLabels.length);
      const notebookSummary = notebookLabels.length
        ? `${notebookLabels.join(' | ')}${moreNotebookCount ? ` | +${moreNotebookCount} more` : ''}`
        : '-';

      return `
        <article class="workflow-card${workflow.id === runtime.draft?.id ? ' workflow-card-editing' : ''}">
          <h3>${safeText(workflow.name || 'Untitled workflow')}</h3>
          <p>${safeText(workflow.description || 'No description')}</p>
          <p><strong>Project:</strong> ${safeText(workflow.projectId ? projectNameById(state, workflow.projectId) : 'Unlinked')}</p>
          <p><strong>Notebook Pages:</strong> ${safeText(notebookSummary)}</p>
          <p><strong>Blocks:</strong> ${safeText(workflow.blocks.length)} | <strong>Connections:</strong> ${safeText(workflow.links.length)}</p>
          <p><strong>Assigned To:</strong> ${safeText(assigneeLabels)}</p>
          <p><strong>Updated:</strong> ${safeText(formatTimestamp(workflow.updatedAt || workflow.createdAt))}</p>
          <div class="card-actions">
            <button type="button" class="ghost-btn" data-workflow-edit="${safeText(workflow.id)}">Edit</button>
            <button type="button" class="danger-btn" data-workflow-delete="${safeText(workflow.id)}">Delete</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function updateSubmitButtonLabel() {
    if (elements.workflowSubmitBtn) {
      elements.workflowSubmitBtn.textContent = runtime.draft?.id ? 'Update Workflow' : 'Save Workflow';
    }
  }

  function renderBlockEditor() {
    renderProtocolOptions();
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
    renderProjectOptions();
    renderNotebookOptions();
    setSelectedValues(elements.workflowNotebookPagesInput, runtime.draft?.notebookEntryIds);
    renderBlockEditor();
    updateSubmitButtonLabel();
  }

  function setWorkflowEntryMode(nextMode) {
    runtime.workflowEntryMode = nextMode === 'create' || nextMode === 'template' || nextMode === 'list'
      ? nextMode
      : 'home';

    const showEditor = runtime.workflowEntryMode === 'create' || runtime.workflowEntryMode === 'template';
    const showTemplates = runtime.workflowEntryMode === 'template';
    const showList = runtime.workflowEntryMode === 'list';
    const showHome = runtime.workflowEntryMode === 'home';
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
    (elements.workflowEditorPanels || []).forEach((panel) => {
      panel.hidden = !showEditor;
    });
    (elements.workflowTemplatePanels || []).forEach((panel) => {
      panel.hidden = !showTemplates;
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
    renderBlockEditor,
    renderBlockList,
    renderNotebookOptions,
    renderProjectOptions,
    renderProtocolOptions,
    renderTemplateList,
    renderTemplateSourceOptions,
    renderWorkflowList,
    setSelectedValues,
    setWorkflowEntryMode,
    syncBlockComposerFields,
    titleForBlock,
    updateSubmitButtonLabel
  };
}
