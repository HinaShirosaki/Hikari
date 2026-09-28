import { buildWorkflowExecutionLayout, computeEntryProgress } from '../../workflow/public-api.js';
import { getGelAnalyses } from '../../../lib/gel-records.js';
import { summarizeNotebookResultTables } from '../../../lib/notebook-result-tables.js';
import { createDashboardRecords } from './dashboard-records.js';
import { createDashboardContributions } from './dashboard-contributions.js';

const CONTRIBUTION_WEEK_COUNT = 22;

export function createProjectDashboardRenderer({ state, safeText } = {}) {
  const escapeText = typeof safeText === 'function'
    ? safeText
    : (value) => String(value || '');

  const {
    asArray,
    cleanText,
    normalizeKey,
    getProjectById,
    notebookStateLabel,
    normalizeNotebookState,
    getProjectNotebookEntries,
    getProjectWorkflows,
    getProjectAssays,
    getProjectGelAnalyses,
    getProjectPapers,
    getProjectSamples,
    parseTimestamp
  } = createDashboardRecords({ state });

  const {
    getProjectSummary,
    buildContributionDays,
    contributionCellLabel,
    formatDateLocal,
    normalizeSampleType
  } = createDashboardContributions({
    CONTRIBUTION_WEEK_COUNT,
    asArray,
    cleanText,
    normalizeKey,
    normalizeNotebookState,
    getProjectNotebookEntries,
    getProjectWorkflows,
    getProjectAssays,
    getProjectGelAnalyses,
    getProjectPapers,
    getProjectSamples
  });



  function renderContributionMonthLabels(days) {
    const seenMonths = new Set();
    const labels = [];
    days.forEach((day, index) => {
      const monthKey = `${day.date.getFullYear()}-${day.date.getMonth()}`;
      if (seenMonths.has(monthKey)) {
        return;
      }
      if (index > 0 && day.date.getDate() > 7) {
        return;
      }
      seenMonths.add(monthKey);
      labels.push({
        column: Math.floor(index / 7) + 1,
        label: day.date.toLocaleDateString([], { month: 'short' })
      });
    });
    return labels.map((label) => `
      <span class="project-contribution-month-label" style="grid-column: ${label.column} / span ${Math.min(3, CONTRIBUTION_WEEK_COUNT - label.column + 1)}; grid-row: 1;">${escapeText(label.label)}</span>
    `).join('');
  }

  function renderContributionHeatmap(dayMap, options = {}) {
    const headingId = cleanText(options.headingId) || 'project-contribution-heading';
    const days = buildContributionDays(dayMap);
    const visibleDays = days.filter((day) => !day.isFuture);
    const activeDays = visibleDays.filter((day) => day.bucket.total > 0).length;
    const totalActivity = visibleDays.reduce((sum, day) => sum + day.bucket.total, 0);
    const todayKey = formatDateLocal(new Date());
    const todayTotal = dayMap.get(todayKey)?.total || 0;
    const summary = totalActivity
      ? `${totalActivity} project activit${totalActivity === 1 ? 'y' : 'ies'} across ${activeDays} active day${activeDays === 1 ? '' : 's'} | Today: ${todayTotal}`
      : `No project activity logged in the last ${CONTRIBUTION_WEEK_COUNT} weeks.`;

    return `
      <section class="panel project-contribution-panel" aria-labelledby="${escapeText(headingId)}">
        <div class="project-panel-head">
          <div class="project-panel-copy">
            <h3 id="${escapeText(headingId)}">Contribution Heatmap</h3>
            <p class="small-note">${escapeText(summary)}</p>
          </div>
        </div>
        <div class="project-contribution-map" aria-label="Project contribution heatmap">
          <div class="project-contribution-months" style="grid-template-columns: repeat(${CONTRIBUTION_WEEK_COUNT}, var(--project-contribution-cell-size));" aria-hidden="true">
            ${renderContributionMonthLabels(days)}
          </div>
          <div class="project-contribution-body">
            <div class="project-contribution-weekdays" aria-hidden="true">
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
            </div>
            <div class="project-contribution-grid" role="grid" aria-label="Daily project activity">
              ${days.map((day) => `
                <span
                  class="project-contribution-cell"
                  data-level="${day.isFuture ? 0 : day.level}"
                  role="gridcell"
                  tabindex="0"
                  title="${escapeText(contributionCellLabel(day))}"
                  aria-label="${escapeText(contributionCellLabel(day))}"
                ></span>
              `).join('')}
            </div>
          </div>
          <div class="project-contribution-legend" aria-hidden="true">
            <span>Less</span>
            <span class="project-contribution-legend-cell" data-level="0"></span>
            <span class="project-contribution-legend-cell" data-level="1"></span>
            <span class="project-contribution-legend-cell" data-level="2"></span>
            <span class="project-contribution-legend-cell" data-level="3"></span>
            <span class="project-contribution-legend-cell" data-level="4"></span>
            <span>More</span>
          </div>
        </div>
      </section>
    `;
  }

  function renderProjectDescriptionEditor(project) {
    return `
      <section class="panel project-description-panel" aria-labelledby="project-description-heading">
        <div class="project-panel-copy">
          <h3 id="project-description-heading">Project Description</h3>
        </div>
        <textarea
          class="project-description-input"
          data-project-description="${escapeText(project?.id || '')}"
          rows="6"
          aria-label="Project description"
          placeholder="Add project notes, goals, or context"
        >${escapeText(project?.description || '')}</textarea>
      </section>
    `;
  }

  function renderProjectOverview(project, summary, options = {}) {
    return `
      <section class="project-overview-grid" aria-label="Project overview">
        ${renderProjectDescriptionEditor(project)}
        ${renderContributionHeatmap(summary.activeDayMap, options)}
      </section>
    `;
  }

  function renderProjectPaperFinder(project) {
    const monthDayOptions = Array.from({ length: 31 }, (_, index) => {
      const day = index + 1;
      return `<option value="${day}">${day}</option>`;
    }).join('');
    return `
      <section class="panel project-paper-finder-panel" aria-labelledby="project-paper-finder-heading">
        <div class="project-panel-head project-paper-finder-head">
          <div class="project-panel-copy">
            <h3 id="project-paper-finder-heading">Paper Finder</h3>
            <span class="project-paper-finder-state" data-paper-finder-state data-state="none">Not scheduled</span>
          </div>
          <div class="project-paper-finder-task-actions">
            <button type="button" class="ghost-btn" data-paper-finder-run hidden>Run now</button>
            <button type="button" class="ghost-btn" data-paper-finder-toggle hidden>Pause</button>
            <button type="button" class="ghost-btn danger-btn" data-paper-finder-remove hidden>Remove</button>
          </div>
        </div>
        <form class="project-paper-finder-form" data-paper-finder-form data-project-id="${escapeText(project?.id || '')}">
          <label class="project-paper-finder-requirements">
            <span>Requirements <span class="small-note">(optional)</span></span>
            <textarea
              rows="2"
              maxlength="12000"
              data-paper-finder-requirements
              placeholder="e.g. recent primary research on delivery efficiency and off-target effects"
            ></textarea>
          </label>
          <fieldset class="project-paper-finder-schedule">
            <legend class="sr-only">Schedule</legend>
            <div class="project-paper-finder-schedule-row">
              <label class="project-paper-finder-frequency">
                <span>Every</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value="1"
                  aria-label="Paper finding frequency"
                  data-paper-finder-frequency-value
                  required
                />
                <select aria-label="Paper finding frequency unit" data-paper-finder-frequency-unit>
                  <option value="day">day</option>
                  <option value="week" selected>week</option>
                  <option value="month">month</option>
                </select>
              </label>
              <label class="project-paper-finder-calendar-field" data-paper-finder-weekday-field>
                <span>on</span>
                <select aria-label="Paper finding weekday" data-paper-finder-weekday>
                  <option value="1" selected>Monday</option>
                  <option value="2">Tuesday</option>
                  <option value="3">Wednesday</option>
                  <option value="4">Thursday</option>
                  <option value="5">Friday</option>
                  <option value="6">Saturday</option>
                  <option value="0">Sunday</option>
                </select>
              </label>
              <label class="project-paper-finder-calendar-field" data-paper-finder-monthday-field hidden>
                <span>on day</span>
                <select aria-label="Paper finding day of month" data-paper-finder-monthday>
                  ${monthDayOptions}
                </select>
              </label>
              <label class="project-paper-finder-calendar-field">
                <span>at</span>
                <input
                  type="time"
                  value="09:00"
                  aria-label="Paper finding time"
                  data-paper-finder-time
                  required
                />
              </label>
              <span class="small-note project-paper-finder-timezone" data-paper-finder-timezone>Local time</span>
              <button type="submit" class="primary-btn project-paper-finder-save" data-paper-finder-save>Schedule</button>
            </div>
          </fieldset>
          <span class="small-note project-paper-finder-status" role="status" aria-live="polite" data-paper-finder-status></span>
        </form>
        <div class="project-paper-finder-results" data-paper-finder-results hidden></div>
      </section>
    `;
  }

  function renderStatCard({ label, value, note }) {
    return `
      <article class="project-stat-card">
        <span>${escapeText(label)}</span>
        <strong>${escapeText(value)}</strong>
        <p>${escapeText(note)}</p>
      </article>
    `;
  }

  function renderStats(summary) {
    const cellLineCount = summary.samples.filter((sample) => normalizeSampleType(sample?.type) === 'cell_line').length;
    const deepReadCount = summary.papers.filter((paper) => paper.deepReadReady || normalizeKey(paper.availabilityStatus) === 'deep_ready').length;
    const analysisCount = summary.assays.length + summary.gelAnalyses.length;
    const statCards = [
      {
        label: 'Plasmids',
        value: summary.plasmids.length.toLocaleString(),
        note: 'Linked sample type: plasmid'
      },
      {
        label: 'Samples',
        value: summary.samples.length.toLocaleString(),
        note: `${cellLineCount.toLocaleString()} cell line${cellLineCount === 1 ? '' : 's'}`
      },
      {
        label: 'Papers',
        value: summary.papers.length.toLocaleString(),
        note: `${deepReadCount.toLocaleString()} deep-read ready`
      },
      {
        label: 'Workflows',
        value: summary.workflows.length.toLocaleString(),
        note: 'Project runs and templates'
      },
      {
        label: 'Assay & Gel',
        value: analysisCount.toLocaleString(),
        note: `${summary.assays.length.toLocaleString()} assays, ${summary.gelAnalyses.length.toLocaleString()} gels`
      }
    ];

    return `
      <section class="project-stat-panel" aria-label="Project statistics">
        ${statCards.map(renderStatCard).join('')}
      </section>
    `;
  }

  function formatTimestamp(raw) {
    const value = parseTimestamp(raw);
    if (!value) {
      return '-';
    }
    return new Date(value).toLocaleString();
  }

  function formatLinkedAssays(notebookEntryId) {
    const assays = asArray(state?.assays)
      .filter((assay) => assay.notebookEntryId === notebookEntryId)
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));
    if (!assays.length) {
      return '-';
    }
    return assays.map((assay) => assay.name || assay.id).join(', ');
  }

  function formatLinkedGels(notebookEntryId) {
    const analyses = asArray(getGelAnalyses(state))
      .filter((analysis) => analysis.notebookEntryId === notebookEntryId)
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));
    if (!analyses.length) {
      return '-';
    }
    return analyses.map((analysis) => analysis.name || analysis.id).join(', ');
  }

  function renderNotebookPageItems(notebookEntries) {
    const entries = Array.isArray(notebookEntries) ? notebookEntries : [];

    if (!entries.length) {
      return '<p class="small-note">No notebook pages for this project yet.</p>';
    }

    return entries.map((entry) => `
      <article class="project-notebook-item">
        <h3>${escapeText(entry.protocolName || '-')}</h3>
        <p><strong>State:</strong> ${escapeText(notebookStateLabel(entry))}</p>
        <p><strong>Updated:</strong> ${escapeText(formatTimestamp(entry.updatedAt))}</p>
        <p><strong>Result:</strong> ${escapeText(entry.result || '-')}</p>
        <p><strong>Result Table:</strong> ${escapeText(summarizeNotebookResultTables(entry.resultTables, entry.resultTable) || '-')}</p>
        <p><strong>Files:</strong> ${escapeText(asArray(entry.resultFiles).join(', ') || '-')}</p>
        <p><strong>Linked Assays:</strong> ${escapeText(formatLinkedAssays(entry.id))}</p>
        <p><strong>Linked Gels:</strong> ${escapeText(formatLinkedGels(entry.id))}</p>
      </article>
    `).join('');
  }

  function renderProcesses(project) {
    const groups = new Map();
    asArray(state.workflows).filter((process) => process.projectId === project.id).forEach((process) => {
      const key = process.templateId || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(process);
    });
    return `<section class="panel project-processes" aria-label="Project processes">
      <div class="project-panel-head"><h3>Processes</h3></div>
      ${groups.size ? [...groups].map(([templateId, processes]) => {
        const template = asArray(state.workflowTemplates).find((item) => item.id === templateId);
        return `<div class="project-process-group"><div class="project-panel-head"><h4>${escapeText(template?.name || 'Archived workflow template')}</h4>
          ${template ? `<button type="button" class="ghost-btn" data-project-workflow-add="${escapeText(project.id)}" data-process-template="${escapeText(templateId)}"><svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>New process</button>` : ''}</div>
          ${processes.map((process) => {
            const entry = process.entries?.[0];
            const progress = computeEntryProgress(entry, buildWorkflowExecutionLayout(process));
            const statuses = progress.orderedIds.map((id) => entry?.stepStates?.[id]?.status);
            const status = progress.complete ? 'Done' : statuses.includes('failed') ? 'Failed'
              : progress.completedSteps || statuses.includes('pending') ? 'In progress' : 'Not started';
            return `<button type="button" class="project-process-row" data-project-process-open="${escapeText(process.id)}">
              <span>${escapeText(process.name || 'Untitled process')}</span>
              <progress max="100" value="${progress.percentComplete}" aria-label="Process progress"></progress>
              <span class="workflow-ledger-count">${progress.completedSteps}/${progress.totalSteps}</span>
              <span>${status}</span>
            </button>`;
          }).join('')}</div>`;
      }).join('') : '<p class="small-note">Choose Workflow in New Experiment to start the first process in this project.</p>'}
    </section>`;
  }

  function renderDashboard(projectId, options = {}) {
    const project = typeof projectId === 'object' && projectId
      ? projectId
      : getProjectById(projectId);
    if (!project) {
      const emptyCopy = cleanText(options.emptyCopy)
        || 'Create a project in the left rail to start tracking project-specific activity.';
      return `
        <section class="panel project-empty-panel">
          <h3>No Project Selected</h3>
          <p class="small-note">${escapeText(emptyCopy)}</p>
        </section>
      `;
    }

    const summary = getProjectSummary(project);
    const includeEditAction = options.includeEditAction !== false;
    const heading = cleanText(options.heading) || 'Dashboard';
    const contributionHeadingId = cleanText(options.contributionHeadingId) || 'project-contribution-heading';
    return `
      <section class="panel project-dashboard-hero">
        <div class="project-dashboard-title">
          <span class="project-eyebrow">Project Activity</span>
          <h2>${escapeText(heading)}</h2>
        </div>
        <div class="project-dashboard-actions">
          <div class="project-experiment-suggestions">
            <button type="button" class="ghost-btn hikari-agent-action" data-suggest-experiment="${escapeText(project.id)}">Suggest next experiment</button>
          </div>
          ${includeEditAction ? `
            <button type="button" class="ghost-btn" data-project-edit="${escapeText(project.id)}">Edit Project</button>
          ` : ''}
        </div>
        <span class="small-note project-experiment-suggestion-status" role="status" aria-live="polite" data-experiment-suggestion-status></span>
      </section>
      ${renderProcesses(project)}
      ${renderStats(summary)}
      ${renderProjectOverview(project, summary, { headingId: contributionHeadingId })}
      ${renderProjectPaperFinder(project)}
    `;
  }

  function renderDashboardInto(hostEl, projectId, options = {}) {
    if (!hostEl) {
      return;
    }
    hostEl.innerHTML = renderDashboard(projectId, options);
  }

  return {
    getProjectById,
    getProjectSummary,
    getProjectNotebookEntries,
    renderDashboard,
    renderDashboardInto,
    renderNotebookPageItems
  };
}
