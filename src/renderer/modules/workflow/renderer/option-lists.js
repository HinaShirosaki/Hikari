import { BLOCK_TYPES } from '../constants.js';
import {
  buildAssigneeOptions,
  buildDirectionMaps,
  notebookEntryLabel
} from '../presentation.js';
import { buildWorkflowExecutionLayout, computeEntryProgress } from '../execution.js';

// The select options and rail lists the workflow editor renders: projects,
// notebooks, protocols, blocks, templates, and the workflow runs under one template.
function createWorkflowOptionLists({
  state,
  runtime,
  elements,
  safeText,
  getBlockType,
  uniqueStrings,
  parseTimestamp,
  formatTimestamp,
  titleForBlock,
  labelForBlockType,
  displayLabelForBlock,
  getVisibleTemplates,
  ensureActiveTemplate,
  getWorkflowsForTemplate
} = {}) {
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

  function renderTemplateCreateProjectOptions() {
    if (!elements.workflowTemplateCreateProjectInput) {
      return;
    }
    const selected = elements.workflowTemplateCreateProjectInput.value;
    const options = ['<option value="">Unlinked project</option>'];
    (state.projects || []).forEach((project) => {
      options.push(`<option value="${safeText(project.id)}">${safeText(project.name)}</option>`);
    });
    elements.workflowTemplateCreateProjectInput.innerHTML = options.join('');
    if (selected && (state.projects || []).some((project) => project.id === selected)) {
      elements.workflowTemplateCreateProjectInput.value = selected;
    }
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

  function renderProtocolResults() {
    if (!elements.workflowBlockProtocolResults) {
      return;
    }

    const searchTerm = String(elements.workflowBlockProtocolSearchInput?.value || '').trim().toLowerCase();
    const selectedProtocolId = String(elements.workflowBlockProtocolInput?.value || '');
    const matches = (state.protocols || [])
      .filter((protocol) => String(protocol?.name || '').toLowerCase().includes(searchTerm))
      .slice(0, 60);

    if (!matches.length) {
      elements.workflowBlockProtocolResults.innerHTML = '<p class="workflow-block-protocol-search-empty">No matching protocols.</p>';
      return;
    }

    elements.workflowBlockProtocolResults.innerHTML = matches.map((protocol) => {
      const id = String(protocol?.id || '').trim();
      const selected = id === selectedProtocolId ? ' is-selected' : '';
      return `<button type="button" class="workflow-block-protocol-search-result${selected}" data-workflow-block-protocol-id="${safeText(id)}" role="option" aria-selected="${id === selectedProtocolId ? 'true' : 'false'}">${safeText(protocol?.name || 'Untitled protocol')}</button>`;
    }).join('');
  }

  function renderProtocolPicker() {
    renderProtocolOptions();
    renderProtocolResults();
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
        <p><strong>Blocks:</strong> ${safeText(template.blocks.length)} | <strong>Connections:</strong> ${safeText(template.links.length)} | <strong>Workflows:</strong> ${safeText(getWorkflowsForTemplate(template.id).length)}</p>
        <p><strong>Updated:</strong> ${safeText(formatTimestamp(template.updatedAt || template.createdAt))}</p>
        <div class="card-actions">
          <button type="button" class="ghost-btn" data-workflow-template-use="${safeText(template.id)}">Select</button>
          <button type="button" class="danger-btn" data-workflow-template-delete="${safeText(template.id)}">Delete</button>
        </div>
      </article>
    `).join('');
  }

  function renderWorkflowList() {
    if (!elements.workflowList) {
      return;
    }

    const templates = getVisibleTemplates();
    const activeTemplate = ensureActiveTemplate(templates);

    if (!templates.length) {
      elements.workflowList.innerHTML = '<p class="small-note">No workflow templates match the current search.</p>';
      return;
    }

    elements.workflowList.innerHTML = `
      <div class="workflow-template-name-list">
        ${templates.map((template) => {
          const runs = getWorkflowsForTemplate(template.id);
          const progress = runs
            .map((workflow) => (workflow.entries[0] ? computeEntryProgress(workflow.entries[0], buildWorkflowExecutionLayout(workflow)) : null))
            .filter(Boolean);
          const active = progress.filter((item) => !item.complete && item.completedSteps > 0).length;
          const failed = runs.filter((workflow) => Object.values(workflow.entries[0]?.stepStates || {})
            .some((stepState) => stepState?.status === 'failed')).length;
          const percent = progress.length
            ? Math.round(progress.reduce((sum, item) => sum + item.percentComplete, 0) / progress.length)
            : 0;
          return `
          <button
            type="button"
            class="workflow-template-name-item${template.id === activeTemplate?.id ? ' is-active' : ''}"
            data-workflow-template-open="${safeText(template.id)}"
          >
            <span class="workflow-template-name-label">${safeText(template.name || 'Untitled template')}</span>
            <span class="workflow-template-name-summary">
              <span>${runs.length} run${runs.length === 1 ? '' : 's'}</span>
              <span>${active} active</span>
              ${failed ? `<span class="is-failed">${failed} failed</span>` : ''}
              <span class="workflow-template-name-steps">${buildWorkflowExecutionLayout(template).mainPathIds.length} steps</span>
            </span>
            <span class="workflow-template-name-bar" aria-hidden="true"><i style="width: ${percent}%;"></i></span>
          </button>
        `;
        }).join('')}
      </div>
    `;
  }
  return {
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
  };
}

export { createWorkflowOptionLists };
