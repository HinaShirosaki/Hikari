import { BLOCK_TYPES } from './constants.js';
import {
  assigneeLabelById,
  blockDisplayLabel,
  blockTypeLabel,
  blockTitle,
  buildAssigneeOptions,
  buildDirectionMaps,
  notebookEntryLabel
} from './presentation.js';
import {
  buildWorkflowExecutionLayout,
  computeEntryProgress,
  getActiveBranchGroups,
  getWorkflowStepState,
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
  const renderStepPlaceholderRegex = /\{\{ph:[^}]+\}\}/g;

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

  function humanizeProtocolStep(step) {
    const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
    let placeholderIndex = 0;
    const source = String(step?.text || '').trim();
    if (!source) {
      return '';
    }
    const replaced = source.replace(renderStepPlaceholderRegex, () => {
      const placeholder = placeholders[placeholderIndex];
      placeholderIndex += 1;
      return `[${placeholder?.name || 'value'}]`;
    });
    if (placeholders.length && replaced === source) {
      return `${source} ${placeholders.map((placeholder) => `[${placeholder.name}]`).join(' ')}`.trim();
    }
    return replaced;
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
          stepText: humanizeProtocolStep(step),
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
        ${templates.map((template) => `
          <button
            type="button"
            class="workflow-template-name-item${template.id === activeTemplate?.id ? ' is-active' : ''}"
            data-workflow-template-open="${safeText(template.id)}"
          >${safeText(template.name || 'Untitled template')}</button>
        `).join('')}
      </div>
    `;
  }

  function buildStepCellMarkup(workflow, entry, block, options = {}) {
    const stepState = getWorkflowStepState(entry, block.id);
    const protocol = (state.protocols || []).find((item) => item.id === block.protocolId) || null;
    const placeholderFields = collectProtocolPlaceholderFields(protocol);
    const instructionMarkup = getBlockType(block) === BLOCK_TYPES.TEXT
      ? `
        <p class="workflow-step-inline-text">${safeText(block.text || 'No text provided.')}</p>
      `
      : '';
    const placeholderMarkup = protocol && placeholderFields.length
      ? `
        <table class="workflow-placeholder-table">
          <tbody>
            ${placeholderFields.map((field) => `
              <tr>
                <th scope="row">${safeText(field.placeholderName)}</th>
                <td>
                  <input
                    data-workflow-step-value="${safeText(field.key)}"
                    data-workflow-entry-id="${safeText(entry.id)}"
                    data-workflow-workflow-id="${safeText(workflow.id)}"
                    data-workflow-block-id="${safeText(block.id)}"
                    value="${safeText(stepState.values[field.key] || '')}"
                    aria-label="${safeText(field.placeholderName)}"
                  />
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
      : '';
    const emptyMarkup = !instructionMarkup && !placeholderMarkup
      ? '<p class="small-note workflow-step-empty">No placeholders.</p>'
      : '';
    const statusOptions = [
      { value: 'completed', className: 'is-finished', title: 'Finished' },
      { value: 'failed', className: 'is-failed', title: 'Failed' },
      { value: 'pending', className: 'is-pending', title: 'Pending' },
      { value: 'not_done', className: 'is-empty', title: 'Not done' }
    ];
    const currentStatus = stepState.status || 'not_done';

    const classNames = ['workflow-step-inline'];
    if (options.floating) {
      classNames.push('workflow-step-popover');
    }
    if (runtime.activeEntryId === entry.id && runtime.activeBlockId === block.id) {
      classNames.push('is-active');
    }
    if (stepState.status === 'completed') {
      classNames.push('is-complete');
    }

    return `
      <div
        class="${classNames.join(' ')}"
        ${options.floating ? 'data-workflow-step-popover="true"' : ''}
      >
        ${instructionMarkup}
        ${placeholderMarkup}
        ${emptyMarkup}
        <div class="workflow-step-status-picker" aria-label="Set step status">
          ${statusOptions.map((option) => `
            <button
              type="button"
              class="workflow-step-status-option ${option.className}${currentStatus === option.value ? ' is-selected' : ''}"
              data-workflow-step-status="${safeText(option.value)}"
              data-workflow-entry-id="${safeText(entry.id)}"
              data-workflow-workflow-id="${safeText(workflow.id)}"
              data-workflow-block-id="${safeText(block.id)}"
              title="${safeText(option.title)}"
              aria-label="${safeText(option.title)}"
            >
              <span class="workflow-step-status-dot ${option.className}"></span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function buildTemplateWorkflowTableMarkup(activeTemplate, workflows, activeWorkflow) {
    const referenceWorkflow = activeWorkflow || workflows[0] || {
      blocks: activeTemplate?.blocks || [],
      links: activeTemplate?.links || []
    };
    const referenceLayout = buildWorkflowExecutionLayout(referenceWorkflow);
    const workflowLayouts = new Map();
    const layoutForWorkflow = (workflow) => {
      if (!workflowLayouts.has(workflow.id)) {
        workflowLayouts.set(workflow.id, buildWorkflowExecutionLayout(workflow));
      }
      return workflowLayouts.get(workflow.id);
    };
    const activeEntry = activeWorkflow?.entries.find((entry) => entry.id === runtime.activeEntryId)
      || activeWorkflow?.entries[0]
      || null;
    const activeLayout = activeWorkflow ? buildWorkflowExecutionLayout(activeWorkflow) : null;
    const activeBlock = activeEntry && activeLayout?.blockById?.has(runtime.activeBlockId)
      ? activeLayout.blockById.get(runtime.activeBlockId)
      : null;
    const activePopoverMarkup = activeWorkflow && activeEntry && activeBlock
      ? buildStepCellMarkup(activeWorkflow, activeEntry, activeBlock, { floating: true })
      : '';

    if (!referenceLayout.mainPath.length) {
      return '<p class="small-note">This template has no protocol blocks yet. Open the template editor to define its structure.</p>';
    }

    if (!workflows.length) {
      return '<p class="small-note">No specific workflows created from this template yet. Use Add Workflow to create one.</p>';
    }

    const trackColumnCount = Math.max(
      getWorkflowTrackColumnCount(referenceLayout),
      ...workflows.map((workflow) => getWorkflowTrackColumnCount(layoutForWorkflow(workflow)))
    );
    const extraHeaderCount = Math.max(0, trackColumnCount - referenceLayout.mainPath.length);

    return `
      <div class="workflow-execution-shell">
        <div class="workflow-execution-scroll">
          <table class="workflow-execution-table">
            <thead>
              <tr>
                <th class="workflow-entry-column">Entity</th>
                ${referenceLayout.mainPath.map((block) => `<th>${safeText(titleForBlock(block))}</th>`).join('')}
                ${Array.from({ length: extraHeaderCount }).map(() => '<th class="workflow-branch-overflow-heading" aria-hidden="true"></th>').join('')}
              </tr>
            </thead>
            <tbody>
              ${workflows.map((workflow) => {
                const layout = layoutForWorkflow(workflow);
                const entry = workflow.entries[0] || null;
                const progress = entry
                  ? computeEntryProgress(entry, layout)
                  : { percentComplete: 0, nextBlockId: layout.mainPathIds[0] || '', orderedIds: layout.mainPathIds || [] };
                const expanded = workflow.id === activeWorkflow?.id && Boolean(entry);
                const activeBlockId = expanded
                  ? (layout.blockById.has(runtime.activeBlockId)
                      ? runtime.activeBlockId
                      : '')
                  : '';
                const stepCount = trackColumnCount;
                const activeBranchRootIds = new Set(entry
                  ? getActiveBranchGroups(layout, entry).map((branch) => branch.rootId)
                  : []);
                const trackRowCount = Math.max(1, 1 + (layout.branches || []).length);
                const mainTrackMarkup = entry && layout.mainPath.length > 1
                  ? `
                    <span
                      class="workflow-progress-track-line"
                      style="${workflowTrackSegmentStyle(0, layout.mainPath.length - 1, 0, stepCount)}"
                      aria-hidden="true"
                    ></span>
                  `
                  : '';
                const completedTrackMarkup = entry
                  ? layout.mainPath.slice(0, -1).map((block, index) => {
                      const stepState = getWorkflowStepState(entry, block.id);
                      const nextStepState = getWorkflowStepState(entry, layout.mainPath[index + 1].id);
                      if (stepState.status !== 'completed' || nextStepState.status !== 'completed') {
                        return '';
                      }
                      return `
                        <span
                          class="workflow-progress-track-complete"
                          style="${workflowTrackSegmentStyle(index, 1, 0, stepCount)}"
                          aria-hidden="true"
                        ></span>
                      `;
                    }).join('')
                  : '';
                const branchTrackMarkup = entry
                  ? (layout.branches || []).map((branch, branchIndex) => {
                      const branchActive = activeBranchRootIds.has(branch.rootId);
                      const rowOffset = branchIndex + 1;
                      return branch.blockIds.slice(0, -1).map((blockId, index) => {
                        const stepState = getWorkflowStepState(entry, blockId);
                        const nextStepState = getWorkflowStepState(entry, branch.blockIds[index + 1]);
                        const segmentComplete = branchActive
                          && stepState.status === 'completed'
                          && nextStepState.status === 'completed';
                        return `
                          <span
                            class="workflow-progress-branch-track-line${segmentComplete ? ' is-complete' : ''}${branchActive ? '' : ' is-inactive'}"
                            style="${workflowTrackSegmentStyle((Number(branch.anchorIndex) || 0) + index, 1, rowOffset, stepCount)}"
                            aria-hidden="true"
                          ></span>
                        `;
                      }).join('');
                    }).join('')
                  : '';
                const branchCellsMarkup = entry
                  ? (layout.branches || []).map((branch, branchIndex) => {
                      const branchActive = activeBranchRootIds.has(branch.rootId);
                      const rowIndex = branchIndex + 2;
                      const rowOffset = rowIndex - 1;
                      const anchorBlock = layout.blockById.get(branch.anchorBlockId);
                      return branch.blockIds.map((blockId, index) => {
                        const block = layout.blockById.get(blockId);
                        const stepState = getWorkflowStepState(entry, blockId);
                        const isRoot = index === 0;
                        const isActivationNode = isRoot && !branchActive;
                        const isActive = expanded && activeBlockId === blockId;
                        const openable = branchActive ? isWorkflowStepOpenable(entry, layout, blockId) : false;
                        const disabled = branchActive ? !openable : !isActivationNode;
                        const dotState = branchActive
                          ? classifyWorkflowDot(stepState, blockId, activeBlockId, progress)
                          : { className: 'is-empty', title: isActivationNode ? 'Activate branch' : 'Activate the branch root first' };
                        const dotTitle = disabled
                          ? (isActivationNode ? dotState.title : 'Complete earlier steps first')
                          : dotState.title;
                        const branchActionAttributes = isActivationNode
                          ? `
                              data-workflow-branch-toggle="${safeText(branch.rootId)}"
                              data-workflow-entry-id="${safeText(entry.id)}"
                              data-workflow-workflow-id="${safeText(workflow.id)}"
                            `
                          : `
                              data-workflow-step-open="${safeText(blockId)}"
                              data-workflow-entry-id="${safeText(entry.id)}"
                              data-workflow-workflow-id="${safeText(workflow.id)}"
                            `;
                        return `
                          <div
                            class="workflow-progress-cell workflow-progress-branch-cell${isRoot ? ' is-branch-root' : ''}${branchActive ? ' is-branch-active' : ' is-branch-inactive'}${isActive ? ' has-popover' : ''}"
                            style="${workflowTrackCellStyle((Number(branch.anchorIndex) || 0) + index + 1, rowIndex)} --workflow-branch-row-offset: ${rowOffset};"
                            ${isRoot ? `data-workflow-branch-parent="${safeText(branch.anchorBlockId)}"` : ''}
                            data-workflow-branch-root="${safeText(branch.rootId)}"
                          >
                            <button
                              type="button"
                              class="workflow-progress-node workflow-progress-branch-node ${dotState.className}${isActive ? ' is-active' : ''}${disabled ? ' is-locked' : ''}${isActivationNode ? ' is-branch-activation' : ''}"
                              ${isActive ? 'data-workflow-step-anchor="true"' : ''}
                              ${branchActionAttributes}
                              aria-label="${safeText(`${titleForBlock(block)} branch from ${titleForBlock(anchorBlock)} for ${workflow.name || 'workflow'}: ${dotTitle}`)}"
                              title="${safeText(dotTitle)}"
                              ${disabled ? 'disabled aria-disabled="true"' : ''}
                            >
                              <span class="workflow-progress-dot"></span>
                              <span class="workflow-progress-branch-label">${safeText(titleForBlock(block))}</span>
                            </button>
                          </div>
                        `;
                      }).join('');
                    }).join('')
                  : '';
                return `
                  <tr class="workflow-entry-row workflow-run-row${expanded ? ' is-expanded' : ''}" data-workflow-run-open="${safeText(workflow.id)}">
                    <td class="workflow-entry-cell">
                      <label class="workflow-entry-name-field">
                        <span class="small-note">${safeText(`${progress.percentComplete}% complete`)}</span>
                        <input
                          value="${safeText(workflow.name || '')}"
                          data-workflow-run-name="${safeText(workflow.id)}"
                        />
                      </label>
                    </td>
                    <td class="workflow-progress-track-cell" colspan="${stepCount}">
                      <div
                        class="workflow-progress-track-grid"
                        style="--workflow-step-count: ${stepCount}; --workflow-track-row-count: ${trackRowCount};"
                      >
                        ${entry ? `
                          ${mainTrackMarkup}
                          ${completedTrackMarkup}
                          ${branchTrackMarkup}
                        ` : ''}
                        ${layout.mainPath.map((block, index) => {
                          const stepState = entry ? getWorkflowStepState(entry, block.id) : { status: 'pending' };
                          const isActive = expanded && activeBlockId === block.id;
                          const openable = entry ? isWorkflowStepOpenable(entry, layout, block.id) : false;
                          const dotState = classifyWorkflowDot(stepState, block.id, activeBlockId, progress);
                          const dotTitle = openable ? dotState.title : 'Locked — complete earlier steps first';
                          return `
                            <div
                              class="workflow-progress-cell workflow-progress-main-cell${isActive ? ' has-popover' : ''}"
                              style="${workflowTrackCellStyle(index + 1, 1)}"
                            >
                              ${entry ? `
                            <button
                              type="button"
                              class="workflow-progress-node ${dotState.className}${isActive ? ' is-active' : ''}${openable ? '' : ' is-locked'}"
                              ${isActive ? 'data-workflow-step-anchor="true"' : ''}
                              data-workflow-step-open="${safeText(block.id)}"
                              data-workflow-entry-id="${safeText(entry.id)}"
                              data-workflow-workflow-id="${safeText(workflow.id)}"
                              aria-label="${safeText(`${titleForBlock(block)} for ${workflow.name || 'workflow'}: ${dotTitle}`)}"
                              title="${safeText(dotTitle)}"
                              ${openable ? '' : 'disabled aria-disabled="true"'}
                            >
                              <span class="workflow-progress-dot"></span>
                            </button>
                              ` : '<span class="small-note">-</span>'}
                            </div>
                          `;
                        }).join('')}
                        ${branchCellsMarkup}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          ${activePopoverMarkup}
        </div>
      </div>
    `;
  }

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
    const popoverWidth = popover.offsetWidth || 230;
    const minLeft = scrollRegion.scrollLeft + (popoverWidth / 2) + 12;
    const maxLeft = scrollRegion.scrollLeft + scrollRegion.clientWidth - (popoverWidth / 2) - 12;
    const clampedLeft = Math.min(Math.max(baseLeft, minLeft), Math.max(minLeft, maxLeft));

    popover.style.setProperty('--workflow-step-popover-left', `${Math.round(clampedLeft)}px`);
    popover.style.setProperty('--workflow-step-popover-top', `${Math.round(baseTop)}px`);
    popover.classList.add('is-positioned');
  }

  function renderExecutionBoard() {
    if (!elements.workflowExecutionBoard || !elements.workflowExecutionTitle || !elements.workflowExecutionStatus) {
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
      elements.workflowExecutionStatus.textContent = 'Choose a template on the left to manage the workflows created from it.';
      elements.workflowExecutionBoard.innerHTML = '<p class="small-note">No workflow template selected.</p>';
      return;
    }

    elements.workflowExecutionTitle.textContent = activeTemplate.name || 'Untitled template';
    elements.workflowExecutionStatus.textContent = `${workflows.length} specific workflow${workflows.length === 1 ? '' : 's'} created from this template.`;
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
      elements.workflowEntryPanel.hidden = showTemplateEditor;
    }
    (elements.workflowSidebarEditorPanels || []).forEach((panel) => {
      panel.hidden = !showWorkflowSidebarEditor;
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
    renderProtocolOptions,
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
