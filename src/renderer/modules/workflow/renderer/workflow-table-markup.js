import {
  buildWorkflowExecutionLayout,
  computeEntryProgress,
  getActiveBranchGroups,
  getWorkflowStepState,
  isWorkflowStepOpenable
} from '../execution.js';
import { BLOCK_TYPES } from '../constants.js';

// The workflow table under a template: one row per workflow run, one cell per step,
// with the branch tracks and progress dots drawn across it.
function createWorkflowTableMarkup({
  state,
  runtime,
  safeText,
  getBlockType,
  titleForBlock,
  classifyWorkflowDot,
  collectProtocolPlaceholderFields,
  getWorkflowTrackColumnCount,
  workflowTrackSegmentStyle,
  workflowTrackCellStyle
} = {}) {
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
        <table class="workflow-placeholder-table" aria-label="Protocol placeholder values">
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
                  placeholder="Enter value"
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
      return '<p class="small-note">Use Add Workflow to create one.</p>';
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
                      <div class="workflow-entry-name-field">
                        <input
                          aria-label="Workflow name"
                          value="${safeText(workflow.name || '')}"
                          data-workflow-run-name="${safeText(workflow.id)}"
                        />
                      </div>
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

  return {
    buildStepCellMarkup,
    buildTemplateWorkflowTableMarkup
  };
}

export { createWorkflowTableMarkup };
