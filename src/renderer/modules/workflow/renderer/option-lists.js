import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("workflow");
import { workflowMessage, workflowText } from '../localization.js';
import { translateTree } from '../../../lib/i18n/dom.js';
import { BLOCK_TYPES } from '../constants.js';
import {
  buildAssigneeOptions,
  buildDirectionMaps,
  notebookEntryLabel,
  notebookEntryDescriptor
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
  displayLabelForBlock,
  getVisibleTemplates,
  ensureActiveTemplate,
  getWorkflowsForTemplate
} = {}) {
  function renderProjectOptions() {
    if (!elements.workflowProjectInput) {
      return;
    }
    const options = ['<option value="" data-i18n="workflow.option.unlinkedProject">Unlinked project</option>'];
    (state.projects || []).forEach((project) => {
      options.push(`<option value="${safeText(project.id)}">${safeText(project.name)}</option>`);
    });
    if (
      runtime.draft?.projectId
      && !(state.projects || []).some((project) => project.id === runtime.draft.projectId)
    ) {
      options.push(`<option value="${safeText(runtime.draft.projectId)}">${i18nUi.render(i18nUi.message("Missing project ({p0})", { p0: runtime.draft.projectId }))}</option>`);
    }
    i18nUi.setHtml(elements.workflowProjectInput, options.join(''));
    translateTree(elements.workflowProjectInput);
    elements.workflowProjectInput.value = runtime.draft?.projectId || '';
  }

  function renderTemplateCreateProjectOptions() {
    if (!elements.workflowTemplateCreateProjectInput) {
      return;
    }
    const selected = elements.workflowTemplateCreateProjectInput.value;
    const options = ['<option value="" data-i18n="workflow.option.unlinkedProject">Unlinked project</option>'];
    (state.projects || []).forEach((project) => {
      options.push(`<option value="${safeText(project.id)}">${safeText(project.name)}</option>`);
    });
    i18nUi.setHtml(elements.workflowTemplateCreateProjectInput, options.join(''));
    translateTree(elements.workflowTemplateCreateProjectInput);
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
      const message = notebookEntryDescriptor(entry, formatTimestamp);
      options.push(`<option value="${safeText(entry.id)}" data-i18n="workflow.${message.key}" data-i18n-params="${safeText(JSON.stringify(message.params))}">${safeText(notebookEntryLabel(entry, formatTimestamp))}</option>`);
    });

    selectedNotebookIds.forEach((entryId) => {
      if (entries.some((entry) => entry.id === entryId)) {
        return;
      }
      options.push(`<option value="${safeText(entryId)}">${i18nUi.render(i18nUi.message("Missing notebook page ({p0})", { p0: entryId }))}</option>`);
    });

    if (!options.length) {
      options.push('<option value="" disabled data-i18n="workflow.option.noNotebooks">No notebook pages available</option>');
    }

    i18nUi.setHtml(elements.workflowNotebookPagesInput, options.join(''));
    translateTree(elements.workflowNotebookPagesInput);
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
    const options = ['<option value="" data-i18n="workflow.option.protocol">Select protocol</option>'];
    const filteredProtocols = (state.protocols || []).filter((protocol) => (
      String(protocol.name || '').toLowerCase().includes(searchTerm)
    ));

    if (selectedProtocol && !filteredProtocols.some((protocol) => protocol.id === selectedProtocol.id)) {
      filteredProtocols.unshift(selectedProtocol);
    }
    filteredProtocols.forEach((protocol) => {
      options.push(`<option value="${safeText(protocol.id)}">${safeText(protocol.name)}</option>`);
    });

    i18nUi.setHtml(elements.workflowBlockProtocolInput, options.join(''));
    translateTree(elements.workflowBlockProtocolInput);
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
      i18nUi.setHtml(elements.workflowBlockProtocolResults, '<p class="workflow-block-protocol-search-empty" data-i18n="workflow.empty.protocols">No matching protocols.</p>');
      translateTree(elements.workflowBlockProtocolResults);
      return;
    }

    i18nUi.setHtml(elements.workflowBlockProtocolResults, matches.map((protocol) => {
      const id = String(protocol?.id || '').trim();
      const selected = id === selectedProtocolId ? ' is-selected' : '';
      return `<button type="button" class="workflow-block-protocol-search-result${selected}" data-workflow-block-protocol-id="${safeText(id)}" role="option" aria-selected="${id === selectedProtocolId ? 'true' : 'false'}">${safeText(protocol?.name || workflowText('fallback.protocol'))}</button>`;
    }).join(''));
    translateTree(elements.workflowBlockProtocolResults);
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
      i18nUi.setHtml(elements.workflowBlockList, '<p class="small-note" data-i18n="workflow.empty.blocks">No blocks yet. Add a protocol or plain-text block to start.</p>');
      translateTree(elements.workflowBlockList);
      return;
    }

    i18nUi.setHtml(elements.workflowBlockList, blocks.map((block, index) => {
      const upstreamText = (upstream.get(block.id) || []).map((blockId) => displayLabelForBlock(blockId)).join(' | ') || '-';
      const downstreamText = (downstream.get(block.id) || []).map((blockId) => displayLabelForBlock(blockId)).join(' | ') || '-';
      const type = getBlockType(block);
      const title = titleForBlock(block);
      const plainTextEditor = type === BLOCK_TYPES.TEXT
        ? `
            <label class="workflow-text-block-field">
              <span data-i18n="workflow.field.text">Text</span>
              <input
                data-workflow-block-text="${safeText(block.id)}"
                value="${safeText(block.text)}"
                placeholder="Plain text" data-i18n-placeholder="workflow.hint.plainText"
              />
            </label>
          `
        : `<p class="small-note">${workflowMessage('field.protocolPrefix')} ${safeText(title)}</p>`;
      return `
        <article class="list-row workflow-block-row">
          <div class="workflow-block-meta">
            <strong>${workflowMessage('block.title', { index: index + 1, title })}</strong>
            <p class="small-note">${workflowMessage('field.typePrefix')} ${workflowMessage(type === BLOCK_TYPES.TEXT ? 'type.text' : 'type.protocol')}</p>
            ${plainTextEditor}
            <p class="small-note">${workflowMessage('field.upstream')} ${safeText(upstreamText)}</p>
            <p class="small-note">${workflowMessage('field.downstream')} ${safeText(downstreamText)}</p>
          </div>
          <div class="workflow-assignee-field">
            <span data-i18n="workflow.field.assignee">Assignee</span>
            <select data-workflow-block-assignee="${safeText(block.id)}">${buildAssigneeOptions(state, safeText, block.assigneeId)}</select>
          </div>
          <div class="list-actions">
            <button type="button" class="danger-btn" data-workflow-block-remove="${safeText(block.id)}" data-i18n="workflow.action.remove">Remove</button>
          </div>
        </article>
      `;
    }).join(''));
    translateTree(elements.workflowBlockList);
  }

  function renderTemplateSourceOptions() {
    if (!elements.workflowTemplateSourceInput) {
      return;
    }
    const selected = elements.workflowTemplateSourceInput.value;
    const options = ['<option value="" data-i18n="workflow.option.template">Select template</option>'];
    const templates = [...(state.workflowTemplates || [])]
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));

    templates.forEach((template) => {
      options.push(`<option value="${safeText(template.id)}">${safeText(template.name || workflowText('fallback.template'))}</option>`);
    });

    i18nUi.setHtml(elements.workflowTemplateSourceInput, options.join(''));
    translateTree(elements.workflowTemplateSourceInput);
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
      i18nUi.setHtml(elements.workflowTemplateList, '<p class="small-note" data-i18n="workflow.empty.templates">No workflow templates saved yet.</p>');
      translateTree(elements.workflowTemplateList);
      return;
    }

    i18nUi.setHtml(elements.workflowTemplateList, templates.map((template) => `
      <article class="workflow-card">
        <h3>${safeText(template.name || workflowText('fallback.template'))}</h3>
        <p>${safeText(template.description || workflowText('fallback.description'))}</p>
        <p><strong data-i18n="workflow.field.blocks">Blocks:</strong> ${safeText(template.blocks.length)} | <strong data-i18n="workflow.field.connections">Connections:</strong> ${safeText(template.links.length)} | <strong data-i18n="workflow.field.workflows">Workflows:</strong> ${safeText(getWorkflowsForTemplate(template.id).length)}</p>
        <p><strong data-i18n="workflow.field.updated">Updated:</strong> ${safeText(formatTimestamp(template.updatedAt || template.createdAt))}</p>
        <div class="card-actions">
          <button type="button" class="ghost-btn" data-workflow-template-use="${safeText(template.id)}" data-i18n="workflow.action.select">Select</button>
          <button type="button" class="danger-btn" data-workflow-template-delete="${safeText(template.id)}" data-i18n="workflow.action.delete">Delete</button>
        </div>
      </article>
    `).join(''));
    translateTree(elements.workflowTemplateList);
  }

  function renderWorkflowList() {
    if (!elements.workflowList) {
      return;
    }

    const templates = getVisibleTemplates();
    const activeTemplate = ensureActiveTemplate(templates);

    if (!templates.length) {
      i18nUi.setHtml(elements.workflowList, '');
      translateTree(elements.workflowList);
      return;
    }

    i18nUi.setHtml(elements.workflowList, `
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
            <span class="workflow-template-name-label">${safeText(template.name || workflowText('fallback.template'))}</span>
            <span class="workflow-template-name-summary">
              <span>${workflowMessage('summary.runs', { count: runs.length })}</span>
              <span>${workflowMessage('summary.active', { count: active })}</span>
              ${failed ? `<span class="is-failed">${workflowMessage('summary.failed', { count: failed })}</span>` : ''}
              <span class="workflow-template-name-steps">${workflowMessage('summary.steps', { count: buildWorkflowExecutionLayout(template).mainPathIds.length })}</span>
            </span>
            <span class="workflow-template-name-bar" aria-hidden="true"><i style="width: ${percent}%;"></i></span>
          </button>
        `;
        }).join('')}
      </div>
    `);
    translateTree(elements.workflowList);
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
