import {
  buildWorkflowExecutionLayout,
  computeEntryProgress,
  getWorkflowStepState,
  isBranchActiveForEntry,
  isWorkflowStepOpenable
} from '../execution.js';
import { BLOCK_TYPES } from '../constants.js';

const FORK_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><circle cx="3" cy="2.6" r="1.4"></circle><circle cx="3" cy="9.4" r="1.4"></circle><circle cx="9.2" cy="3.6" r="1.4"></circle><path d="M3 4v4M9.2 5a3.6 3.6 0 0 1-3.6 3H3"></path></svg>';
const DAY_MS = 86400000;

// The run ledger under a template: one row per workflow run with an inline
// stepper, plus a drawer for the selected run that lists its steps and the
// controls that act on them.
function createWorkflowTableMarkup({
  state,
  runtime,
  safeText,
  getBlockType,
  titleForBlock,
  classifyWorkflowDot,
  collectProtocolPlaceholderFields,
  parseTimestamp,
  formatTimestamp
} = {}) {
  function formatDay(rawValue) {
    const parsed = parseTimestamp(rawValue);
    return parsed ? new Date(parsed).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  }

  function formatRelative(rawValue) {
    const parsed = parseTimestamp(rawValue);
    if (!parsed) {
      return '-';
    }
    const days = Math.max(0, Math.round((Date.now() - parsed) / DAY_MS));
    return days === 0 ? 'today' : (days === 1 ? 'yesterday' : `${days} d ago`);
  }

  function stepDataAttributes(workflow, entry) {
    return `data-workflow-entry-id="${safeText(entry.id)}" data-workflow-workflow-id="${safeText(workflow.id)}"`;
  }

  function branchNames(layout, branch) {
    return branch.blockIds.map((blockId) => titleForBlock(layout.blockById.get(blockId))).join(' → ');
  }

  function stateChipMarkup(entry, progress) {
    if (progress.complete) {
      return '<span class="workflow-ledger-chip is-ok">Done</span>';
    }
    const failedId = progress.orderedIds.find((blockId) => getWorkflowStepState(entry, blockId).status === 'failed');
    if (failedId) {
      return '<span class="workflow-ledger-chip is-bad">Failed</span>';
    }
    if (!progress.completedSteps) {
      return '<span class="workflow-ledger-chip is-idle">Not started</span>';
    }
    return '<span class="workflow-ledger-chip is-accent">In progress</span>';
  }

  function buildStepperMarkup(workflow, entry, layout, progress, activeBlockId) {
    function nodeMarkup(item, placement = '') {
      const block = layout.blockById.get(item.blockId);
      const stepState = getWorkflowStepState(entry, item.blockId);
      const openable = isWorkflowStepOpenable(entry, layout, item.blockId);
      const dotState = classifyWorkflowDot(stepState, item.blockId, activeBlockId, progress);
      const title = item.kind === 'main' ? `${item.index + 1}. ${titleForBlock(block)}` : `${titleForBlock(block)} (branch)`;
      const hint = openable ? dotState.title : 'Locked — complete earlier steps first';
      return `<button
        type="button" ${placement}
        class="workflow-stepper-node ${dotState.className}${item.kind === 'branch' ? ' is-branch' : ''}${openable ? '' : ' is-locked'}"
        data-workflow-step-open="${safeText(item.blockId)}"
        ${stepDataAttributes(workflow, entry)}
        title="${safeText(`${title}: ${hint}`)}"
        aria-label="${safeText(`${title} for ${workflow.name || 'workflow'}: ${hint}`)}"
        ${openable ? '' : 'disabled aria-disabled="true"'}
      ></button>`;
    }
    function linkMarkup(fromId, toId, placement = '', branch = false) {
      const complete = getWorkflowStepState(entry, fromId).status === 'completed'
        && getWorkflowStepState(entry, toId).status === 'completed';
      return `<span class="workflow-stepper-link${branch ? ' is-branch' : ''}${complete ? ' is-complete' : ''}" ${placement} aria-hidden="true"></span>`;
    }
    const main = layout.mainPathIds.map((blockId, index) => {
      const column = index * 2 + 1;
      const link = index ? linkMarkup(layout.mainPathIds[index - 1], blockId, `style="grid-column: ${column - 1}; grid-row: 1"`) : '';
      return link + nodeMarkup({ kind: 'main', blockId, index }, `style="grid-column: ${column}; grid-row: 1"`);
    }).join('');
    const branches = (layout.branches || []).map((branch, index) => {
      const active = isBranchActiveForEntry(entry, branch);
      const complete = active && branch.blockIds.every((id) => getWorkflowStepState(entry, id).status === 'completed');
      const label = `${active ? 'Branch' : 'Optional branch'}: ${branchNames(layout, branch)}`;
      const nodes = active ? branch.blockIds.map((blockId, stepIndex) => {
        const link = stepIndex ? linkMarkup(branch.blockIds[stepIndex - 1], blockId, '', true) : '';
        return link + nodeMarkup({ kind: 'branch', blockId });
      }).join('') : `<span class="workflow-stepper-fork" role="img" title="${safeText(label)}" aria-label="${safeText(label)}">${FORK_ICON}<span>Optional</span></span>`;
      const column = branch.anchorIndex * 2 + 1;
      const row = index + 2;
      return `<span class="workflow-stepper-stem${complete ? ' is-complete' : ''}" style="grid-column: ${column}; grid-row: 2 / ${row + 1}" aria-hidden="true"></span>
        <div class="workflow-stepper-branch${active ? ' is-active' : ''}${complete ? ' is-complete' : ''}" style="grid-column: ${column} / -1; grid-row: ${row}" role="group" aria-label="${safeText(label)}">${nodes}</div>`;
    }).join('');
    const columns = layout.mainPathIds.length;
    const tracks = columns > 1 ? `repeat(${columns - 1}, 14px minmax(24px, 1fr)) 14px` : '14px';
    return `<div class="workflow-stepper" style="grid-template-columns: ${tracks}">${main}${branches}</div>`;
  }

  function buildRunRowMarkup(workflow, activeWorkflow) {
    const entry = workflow.entries[0] || null;
    const layout = buildWorkflowExecutionLayout(workflow);
    const selected = workflow.id === activeWorkflow?.id;
    if (!entry) {
      return `
        <tr class="workflow-ledger-row${selected ? ' is-selected' : ''}" data-workflow-run-open="${safeText(workflow.id)}">
          <td><div class="workflow-ledger-name">${safeText(workflow.name || 'Untitled workflow')}</div></td>
          <td colspan="3"><span class="small-note">No entry yet.</span></td>
        </tr>
      `;
    }
    const progress = computeEntryProgress(entry, layout);
    const activeBlockId = selected ? runtime.activeBlockId : '';
    const failedId = progress.orderedIds.find((blockId) => getWorkflowStepState(entry, blockId).status === 'failed');
    const nextBlock = layout.blockById.get(failedId || progress.nextBlockId) || null;
    const nextMarkup = progress.complete
      ? stateChipMarkup(entry, progress)
      : (nextBlock
        ? `<span class="workflow-ledger-next">${safeText(titleForBlock(nextBlock))}</span>${failedId ? ' <span class="workflow-ledger-chip is-bad">Failed</span>' : (getWorkflowStepState(entry, nextBlock.id).status === 'pending' ? ' <span class="workflow-ledger-chip is-warn">In progress</span>' : '')}`
        : '<span class="workflow-ledger-chip is-idle">Not started</span>');
    return `
      <tr class="workflow-ledger-row${selected ? ' is-selected' : ''}" data-workflow-run-open="${safeText(workflow.id)}">
        <td>
          <div class="workflow-ledger-name">${safeText(workflow.name || 'Untitled workflow')}</div>
        </td>
        <td class="workflow-ledger-progress-cell">
          <div class="workflow-ledger-progress">
            ${buildStepperMarkup(workflow, entry, layout, progress, activeBlockId)}
            <span class="workflow-ledger-count">${progress.completedSteps}/${progress.totalSteps}</span>
          </div>
        </td>
        <td>${nextMarkup}</td>
        <td class="workflow-ledger-updated" title="${safeText(formatTimestamp(workflow.updatedAt || workflow.createdAt))}">${safeText(formatRelative(workflow.updatedAt || workflow.createdAt))}</td>
      </tr>
    `;
  }

  function buildDrawerStepMarkup(workflow, entry, layout, progress, blockId, options = {}) {
    const block = layout.blockById.get(blockId);
    const stepState = getWorkflowStepState(entry, blockId);
    const openable = isWorkflowStepOpenable(entry, layout, blockId);
    const dotState = classifyWorkflowDot(stepState, blockId, runtime.activeBlockId, progress);
    const protocol = (state.protocols || []).find((item) => item.id === block.protocolId) || null;
    const placeholderFields = collectProtocolPlaceholderFields(protocol);
    const ids = stepDataAttributes(workflow, entry);
    const disabled = openable ? '' : 'disabled';
    const completed = stepState.status === 'completed';
    const failed = stepState.status === 'failed';
    const dateText = completed
      ? `done ${formatDay(stepState.completedAt)}`
      : (failed ? `failed ${formatDay(stepState.updatedAt)}` : (progress.nextBlockId === blockId ? 'next' : ''));
    const statusButton = (status, label, className, description = label) => `
      <button type="button" class="${className}" title="${description}" aria-label="${description}" data-workflow-step-status="${status}" data-workflow-block-id="${safeText(blockId)}" ${ids} ${disabled}>${label}</button>
    `;
    const instructionMarkup = getBlockType(block) === BLOCK_TYPES.TEXT
      ? `<p class="workflow-step-inline-text">${safeText(block.text || 'No text provided.')}</p>`
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
                  data-workflow-block-id="${safeText(blockId)}"
                  ${ids}
                  value="${safeText(stepState.values[field.key] || '')}"
                  placeholder="Enter value"
                  aria-label="${safeText(field.placeholderName)}"
                  ${disabled}
                />
              </td>
            </tr>
          `).join('')}
          </tbody>
        </table>
      `
      : '';
    const filesMarkup = stepState.resultFiles.map((name) => `<span class="workflow-ledger-chip is-idle">${safeText(name)}</span>`).join('');
    const skipBranchMarkup = options.branchRootId
      ? `<button type="button" class="ghost-btn" data-workflow-branch-toggle="${safeText(options.branchRootId)}" ${ids}>Skip branch</button>`
      : '';

    return `
      <div class="workflow-drawer-step${options.first ? ' is-first' : ''}${options.last ? ' is-last' : ''}">
        <div class="workflow-drawer-spine"><span class="workflow-step-dot ${dotState.className}${options.branch ? ' is-branch' : ''}${openable ? '' : ' is-locked'}"></span></div>
        <details class="workflow-drawer-details" ${options.open ? 'open' : ''}>
          <summary ${openable ? `data-workflow-drawer-toggle="${safeText(blockId)}" ${ids}` : ''}>
            <strong>${safeText(titleForBlock(block))}</strong>
            ${getBlockType(block) === BLOCK_TYPES.TEXT ? '<span class="workflow-ledger-chip is-idle">note</span>' : ''}
            ${options.branch ? '<span class="workflow-ledger-chip is-idle">branch</span>' : ''}
            <span class="workflow-drawer-step-meta">${safeText(dateText)}</span>
          </summary>
          <div class="workflow-drawer-step-body">
            ${instructionMarkup}
            ${placeholderMarkup}
            <label class="workflow-drawer-field">
              Result
              <textarea rows="2" data-workflow-step-result-field="${safeText(blockId)}" ${ids} placeholder="What happened?" ${disabled}>${safeText(stepState.result)}</textarea>
            </label>
            ${filesMarkup ? `<div class="workflow-drawer-files" aria-label="Attached files">${filesMarkup}</div>` : ''}
            <div class="workflow-drawer-actions">
              ${completed ? statusButton('not_done', 'Reopen', 'ghost-btn') : statusButton('completed', 'Complete', 'primary-btn', 'Mark complete')}
              ${failed ? statusButton('pending', 'Retry', 'ghost-btn') : statusButton('failed', 'Fail', 'ghost-btn workflow-drawer-danger-btn', 'Mark failed')}
              <button type="button" class="ghost-btn" data-workflow-step-open-notebook="${safeText(blockId)}" ${ids} title="Open notebook page" aria-label="Open notebook page" ${disabled}>Notebook</button>
              <label class="workflow-drawer-file-btn" title="Attach files">
                Attach
                <input type="file" multiple aria-label="Attach files" data-workflow-step-files="${safeText(blockId)}" ${ids} ${disabled} />
              </label>
              ${skipBranchMarkup}
            </div>
          </div>
        </details>
      </div>
    `;
  }

  function buildDrawerMarkup(workflow) {
    const entry = workflow.entries.find((item) => item.id === runtime.activeEntryId) || workflow.entries[0] || null;
    const layout = buildWorkflowExecutionLayout(workflow);
    const project = (state.projects || []).find((item) => item.id === workflow.projectId) || null;
    const progress = entry ? computeEntryProgress(entry, layout) : null;
    const openBlockId = runtime.activeBlockId || progress?.nextBlockId || '';
    const total = progress?.orderedIds.length || 0;
    const rows = [];
    let position = 0;
    if (entry) {
      layout.mainPathIds.forEach((blockId, index) => {
        rows.push(buildDrawerStepMarkup(workflow, entry, layout, progress, blockId, {
          first: position === 0,
          last: position === total - 1,
          open: blockId === openBlockId
        }));
        position += 1;
        (layout.branches || [])
          .filter((branch) => branch.anchorIndex === index)
          .forEach((branch) => {
            if (!isBranchActiveForEntry(entry, branch)) {
              rows.push(`
                <div class="workflow-drawer-fork">
                  <div class="workflow-drawer-spine"><span class="workflow-step-dot is-branch is-empty is-locked"></span></div>
                  <div class="workflow-drawer-fork-card">
                    <span>Optional branch</span>
                    <strong>${safeText(branchNames(layout, branch))}</strong>
                    <button type="button" class="ghost-btn" data-workflow-branch-toggle="${safeText(branch.rootId)}" ${stepDataAttributes(workflow, entry)}>Activate</button>
                  </div>
                </div>
              `);
              return;
            }
            const untouched = branch.blockIds.every((blockId) => getWorkflowStepState(entry, blockId).status !== 'completed');
            branch.blockIds.forEach((blockId, branchIndex) => {
              rows.push(buildDrawerStepMarkup(workflow, entry, layout, progress, blockId, {
                first: position === 0,
                last: position === total - 1,
                open: blockId === openBlockId,
                branch: true,
                branchRootId: branchIndex === 0 && untouched ? branch.rootId : ''
              }));
              position += 1;
            });
          });
      });
    }

    return `
      <aside class="workflow-drawer" aria-label="Selected workflow">
        <div class="workflow-drawer-head">
          <div class="workflow-drawer-title-row">
            <input class="workflow-drawer-name" aria-label="Workflow name" value="${safeText(workflow.name || '')}" data-workflow-run-name="${safeText(workflow.id)}" />
            <button type="button" class="workflow-drawer-close" data-workflow-drawer-close="true" aria-label="Close"><svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </div>
          <div class="workflow-drawer-meta">
            <span>${safeText(project?.name || 'No project')}</span>
            <span>started ${safeText(formatDay(workflow.createdAt) || '-')}</span>
            ${progress ? `<span class="workflow-drawer-meta-state">${stateChipMarkup(entry, progress)}</span>` : ''}
          </div>
          ${progress ? `
            <div class="workflow-drawer-progress">
              <span class="workflow-drawer-progress-bar"><i style="width: ${progress.percentComplete}%;"></i></span>
              <span class="workflow-ledger-count">${progress.completedSteps}/${progress.totalSteps}</span>
            </div>
          ` : ''}
        </div>
        <div class="workflow-drawer-body">${rows.join('')}</div>
      </aside>
    `;
  }

  function buildTemplateWorkflowTableMarkup(activeTemplate, workflows, activeWorkflow) {
    const referenceLayout = buildWorkflowExecutionLayout(activeWorkflow || workflows[0] || {
      blocks: activeTemplate?.blocks || [],
      links: activeTemplate?.links || []
    });

    if (!referenceLayout.mainPath.length) {
      return '<p class="small-note">This template has no protocol blocks yet. Open the template editor to define its structure.</p>';
    }

    if (!workflows.length) {
      return '<p class="small-note">Use New process to start this workflow.</p>';
    }

    const groups = new Map();
    workflows.forEach((workflow) => {
      const key = workflow.projectId || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(workflow);
    });
    const groupedRows = [...groups].map(([projectId, processes]) => {
      const project = (state.projects || []).find((item) => item.id === projectId);
      const name = project?.name || (projectId ? `Missing project (${projectId})` : 'No project');
      return `<tbody><tr class="workflow-project-heading"><th colspan="4" scope="rowgroup">
        <div><span>${safeText(name)}</span><span class="workflow-ledger-count">${processes.length} ${processes.length === 1 ? 'process' : 'processes'}</span>
        ${!projectId || project ? `<button type="button" class="ghost-btn" data-workflow-project-add="${safeText(projectId)}" aria-label="New process in ${safeText(name)}"><svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>New process</button>` : ''}</div>
      </th></tr>${processes.map((workflow) => buildRunRowMarkup(workflow, activeWorkflow)).join('')}</tbody>`;
    }).join('');

    return `
      <div class="workflow-execution-shell">
        <div class="workflow-execution-scroll">
          <table class="workflow-ledger">
            <thead>
              <tr>
                <th>Process</th>
                <th>Progress</th>
                <th>Next step</th>
                <th>Updated</th>
              </tr>
            </thead>
            ${groupedRows}
          </table>
        </div>
        ${activeWorkflow ? buildDrawerMarkup(activeWorkflow) : ''}
      </div>
    `;
  }

  return {
    buildTemplateWorkflowTableMarkup
  };
}

export { createWorkflowTableMarkup };
