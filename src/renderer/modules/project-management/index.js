import { summarizeNotebookResultTable } from '../notebook-result-table.js';

const CONTRIBUTION_WEEK_COUNT = 22;

export function initProjectManagement({ state, persist, createId, safeText, onProjectsChanged }) {
  const projectForm = document.getElementById('project-form');
  const projectIdInput = document.getElementById('project-id');
  const projectNameInput = document.getElementById('project-name');
  const projectDescriptionInput = document.getElementById('project-description');
  const projectCancelBtn = document.getElementById('project-cancel-btn');
  const projectList = document.getElementById('project-list');
  const projectDashboard = document.getElementById('project-dashboard');
  const projectNotebookFilter = getOptionalElementById('project-notebook-filter');
  const projectNotebookPages = getOptionalElementById('project-notebook-pages');

  let selectedProjectId = '';

  projectForm.addEventListener('submit', onProjectSubmit);
  projectCancelBtn.addEventListener('click', resetProjectForm);
  projectNotebookFilter?.addEventListener('change', () => selectProject(projectNotebookFilter.value));
  projectDashboard?.addEventListener('click', onDashboardClick);

  function getOptionalElementById(id) {
    return document.getElementById(id);
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function cleanText(value) {
    return String(value || '').trim();
  }

  function normalizeKey(value) {
    return cleanText(value).toLowerCase();
  }

  function getProjectById(projectId) {
    return asArray(state.projects).find((project) => String(project?.id || '') === String(projectId || '')) || null;
  }

  function getActiveProject() {
    ensureSelectedProject();
    return getProjectById(selectedProjectId);
  }

  function ensureSelectedProject() {
    const projects = asArray(state.projects);
    if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) {
      return;
    }
    selectedProjectId = projects[0]?.id || '';
  }

  function selectProject(projectId) {
    if (!getProjectById(projectId)) {
      return;
    }
    selectedProjectId = projectId;
    render();
  }

  function notebookStateLabel(entry) {
    return normalizeNotebookState(entry?.notebookState) === 'planned' ? 'Planned' : 'Executed';
  }

  function normalizeNotebookState(value) {
    return cleanText(value).toLowerCase() === 'planned' ? 'planned' : 'executed';
  }

  async function onProjectSubmit(event) {
    event.preventDefault();

    state.projects = asArray(state.projects);
    const editingId = projectIdInput.value || '';
    const existingProject = getProjectById(editingId);
    const now = new Date().toISOString();
    const project = {
      ...(existingProject || {}),
      id: editingId || createId(),
      name: projectNameInput.value.trim(),
      description: projectDescriptionInput.value.trim(),
      createdAt: existingProject?.createdAt || now,
      updatedAt: now
    };

    if (!project.name) {
      return;
    }

    const index = state.projects.findIndex((item) => item.id === project.id);
    const isNewProject = index < 0;
    if (index >= 0) {
      state.projects[index] = project;
    } else {
      state.projects.push(project);
    }

    selectedProjectId = project.id;
    persist();
    if (isNewProject) {
      await ensureProjectDirectory(project.name);
    }
    resetProjectForm();
    render();
    onProjectsChanged();
  }

  function sanitizeFolderName(value) {
    return String(value || '')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  async function ensureProjectDirectory(projectName) {
    const rootPath = cleanText(state.settings?.storagePath);
    if (!rootPath || !window.enanaApi?.ensureStorageDirectory) {
      return;
    }

    const safeProjectName = sanitizeFolderName(projectName) || 'Untitled_Project';
    const projectFolder = `${rootPath}/Project/${safeProjectName}`;
    try {
      const result = await window.enanaApi.ensureStorageDirectory(projectFolder);
      if (result?.ok !== true) {
        console.warn('Failed to create project directory:', result?.error || projectFolder);
      }
    } catch (error) {
      console.warn('Failed to create project directory:', error);
    }
  }

  function resetProjectForm() {
    projectIdInput.value = '';
    projectForm.reset();
  }

  function editProject(projectId) {
    const project = getProjectById(projectId);
    if (!project) {
      return;
    }

    selectedProjectId = project.id;
    projectIdInput.value = project.id;
    projectNameInput.value = project.name;
    projectDescriptionInput.value = project.description || '';
    render();
  }

  function deleteProject(projectId) {
    const deletedNotebookEntryIds = new Set(
      asArray(state.notebookEntries)
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => entry.id)
    );

    state.projects = asArray(state.projects).filter((item) => item.id !== projectId);
    state.notebookEntries = asArray(state.notebookEntries).filter((entry) => entry.projectId !== projectId);
    state.assays = asArray(state.assays).filter((assay) => assay.projectId !== projectId);
    state.gelAnalyses = asArray(state.gelAnalyses).filter((analysis) => analysis.projectId !== projectId);
    state.workflows = asArray(state.workflows).map((workflow) => ({
      ...workflow,
      projectId: workflow.projectId === projectId ? '' : workflow.projectId,
      notebookEntryIds: asArray(workflow.notebookEntryIds).filter((entryId) => !deletedNotebookEntryIds.has(entryId))
    }));
    if (selectedProjectId === projectId) {
      selectedProjectId = '';
    }
    persist();
    render();
    onProjectsChanged();
  }

  function getRecordProjectIds(record) {
    if (!record || typeof record !== 'object') {
      return [];
    }
    const ids = [
      record.projectId,
      record.project_id,
      record.linkedProjectId,
      record.linked_project_id,
      record.project?.id,
      record.meta?.projectId,
      record.metadata?.projectId
    ];
    if (normalizeKey(record.linkedType) === 'project') {
      ids.push(record.linkedId, record.linked_id);
    }
    return ids.map(cleanText).filter(Boolean);
  }

  function getRecordProjectNames(record) {
    if (!record || typeof record !== 'object') {
      return [];
    }
    return [
      record.projectName,
      record.project_name,
      record.linkedProject,
      record.linkedProjectName,
      record.linked_project,
      record.linked_project_name,
      record.project?.name,
      record.meta?.projectName,
      record.metadata?.projectName,
      normalizeKey(record.linkedType) === 'project' ? (record.linkedName || record.linked_name) : ''
    ].map(normalizeKey).filter(Boolean);
  }

  function recordMatchesProject(record, project) {
    if (!record || !project) {
      return false;
    }
    const projectId = cleanText(project.id);
    const recordProjectIds = getRecordProjectIds(record);
    if (recordProjectIds.length) {
      return Boolean(projectId && recordProjectIds.includes(projectId));
    }

    const projectName = normalizeKey(project.name);
    if (!projectName) {
      return false;
    }
    return getRecordProjectNames(record).includes(projectName);
  }

  function getWorkflowNotebookEntryIds(project) {
    const entryIds = new Set();
    asArray(state.workflows)
      .filter((workflow) => recordMatchesProject(workflow, project))
      .forEach((workflow) => {
        asArray(workflow.notebookEntryIds).forEach((entryId) => {
          if (entryId) {
            entryIds.add(entryId);
          }
        });
        asArray(workflow.entries).forEach((entry) => {
          if (entry?.notebookEntryId) {
            entryIds.add(entry.notebookEntryId);
          }
        });
      });
    return entryIds;
  }

  function getProjectNotebookEntries(project) {
    const workflowEntryIds = getWorkflowNotebookEntryIds(project);
    return asArray(state.notebookEntries)
      .filter((entry) => recordMatchesProject(entry, project) || workflowEntryIds.has(entry.id))
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));
  }

  function getProjectWorkflows(project, notebookEntryIds) {
    return asArray(state.workflows)
      .filter((workflow) => (
        recordMatchesProject(workflow, project)
        || asArray(workflow.notebookEntryIds).some((entryId) => notebookEntryIds.has(entryId))
        || asArray(workflow.entries).some((entry) => notebookEntryIds.has(entry?.notebookEntryId))
      ))
      .sort((a, b) => parseTimestamp(b.updatedAt || b.createdAt) - parseTimestamp(a.updatedAt || a.createdAt));
  }

  function getProjectAssays(project, notebookEntryIds) {
    return asArray(state.assays)
      .filter((assay) => recordMatchesProject(assay, project) || notebookEntryIds.has(assay.notebookEntryId))
      .sort((a, b) => parseTimestamp(b.updatedAt || b.createdAt) - parseTimestamp(a.updatedAt || a.createdAt));
  }

  function getProjectGelAnalyses(project, notebookEntryIds) {
    return asArray(state.gelAnalyses)
      .filter((analysis) => recordMatchesProject(analysis, project) || notebookEntryIds.has(analysis.notebookEntryId))
      .sort((a, b) => parseTimestamp(b.updatedAt || b.createdAt) - parseTimestamp(a.updatedAt || a.createdAt));
  }

  function getNotebookPaperIds(notebookEntries) {
    const ids = new Set();
    notebookEntries.forEach((entry) => {
      asArray(entry?.references?.paperIds).forEach((paperId) => {
        if (paperId) {
          ids.add(paperId);
        }
      });
    });
    return ids;
  }

  function getProjectPapers(project, notebookEntryIds, notebookEntries) {
    const paperIds = getNotebookPaperIds(notebookEntries);
    asArray(state.paperExperimentLinks).forEach((link) => {
      if (recordMatchesProject(link, project) || notebookEntryIds.has(link?.entryId)) {
        paperIds.add(link.paperId);
      }
    });

    return asArray(state.papers)
      .filter((paper) => recordMatchesProject(paper, project) || paperIds.has(paper.id))
      .sort((a, b) => parseTimestamp(b.updatedAt || b.discoveredAt || b.createdAt) - parseTimestamp(a.updatedAt || a.discoveredAt || a.createdAt));
  }

  function getProjectSampleKeys(notebookEntries, assays) {
    const keys = new Set();
    notebookEntries.forEach((entry) => {
      asArray(entry?.references?.sampleIds).forEach((sampleId) => {
        if (sampleId) {
          keys.add(String(sampleId));
        }
      });
    });
    assays.forEach((assay) => {
      asArray(assay?.sampleAxisValues).forEach((sampleId) => {
        if (sampleId) {
          keys.add(String(sampleId));
        }
      });
      asArray(assay?.wellLayout).forEach((well) => {
        if (well?.sampleId) {
          keys.add(String(well.sampleId));
        }
      });
    });
    return keys;
  }

  function sampleMatchesProject(sample, project, sampleKeys) {
    if (recordMatchesProject(sample, project)) {
      return true;
    }
    return [
      sample?.id,
      sample?.code,
      sample?.name
    ].some((value) => value && sampleKeys.has(String(value)));
  }

  function getProjectSamples(project, notebookEntries, assays) {
    const sampleKeys = getProjectSampleKeys(notebookEntries, assays);
    return asArray(state.samples)
      .filter((sample) => sampleMatchesProject(sample, project, sampleKeys))
      .sort((a, b) => parseTimestamp(b.updatedAt || b.createdAt) - parseTimestamp(a.updatedAt || a.createdAt));
  }

  function normalizeSampleType(value) {
    return normalizeKey(value).replace(/\s+/g, '_');
  }

  function getProjectSummary(project) {
    const notebookEntries = getProjectNotebookEntries(project);
    const notebookEntryIds = new Set(notebookEntries.map((entry) => entry.id).filter(Boolean));
    const workflows = getProjectWorkflows(project, notebookEntryIds);
    const assays = getProjectAssays(project, notebookEntryIds);
    const gelAnalyses = getProjectGelAnalyses(project, notebookEntryIds);
    const papers = getProjectPapers(project, notebookEntryIds, notebookEntries);
    const samples = getProjectSamples(project, notebookEntries, assays);
    const plasmids = samples.filter((sample) => normalizeSampleType(sample?.type) === 'plasmid');
    const activeDayMap = collectProjectContributionActivity({
      project,
      notebookEntries,
      workflows,
      assays,
      gelAnalyses,
      papers,
      samples
    });

    return {
      notebookEntries,
      workflows,
      assays,
      gelAnalyses,
      papers,
      samples,
      plasmids,
      activeDayMap
    };
  }

  function createContributionBucket() {
    return {
      projectLogs: 0,
      completedProtocols: 0,
      dataUploads: 0,
      analysisNotes: 0,
      papers: 0,
      samples: 0,
      total: 0
    };
  }

  function addContributionActivity(dayMap, timestamp, kind, weight = 1) {
    const dayKey = dayKeyFromTimestamp(timestamp);
    if (!dayKey) {
      return;
    }
    const amount = Math.max(1, Math.round(Number(weight) || 1));
    const bucket = dayMap.get(dayKey) || createContributionBucket();
    if (!Object.prototype.hasOwnProperty.call(bucket, kind)) {
      return;
    }
    bucket[kind] += amount;
    bucket.total += amount;
    dayMap.set(dayKey, bucket);
  }

  function collectFileRecordActivity(dayMap, records, fallbackTimestamp) {
    asArray(records).forEach((record) => {
      addContributionActivity(
        dayMap,
        record?.importedAt || record?.updatedAt || fallbackTimestamp,
        'dataUploads'
      );
    });
  }

  function resultTableHasContent(table) {
    const rows = asArray(table?.rows);
    return rows.some((row) => Object.entries(row || {}).some(([key, value]) => (
      key !== 'id' && cleanText(value)
    )));
  }

  function collectProjectContributionActivity({ project, notebookEntries, workflows, assays, gelAnalyses, papers, samples }) {
    const dayMap = new Map();

    addContributionActivity(dayMap, project?.updatedAt || project?.createdAt, 'projectLogs');

    notebookEntries.forEach((entry) => {
      const entryTimestamp = entry?.updatedAt || entry?.executedAt || entry?.createdAt;
      addContributionActivity(dayMap, entryTimestamp, 'projectLogs');

      const isExecuted = normalizeNotebookState(entry?.notebookState) !== 'planned';
      if (isExecuted && (entry?.protocolId || entry?.protocolName || entry?.executedAt)) {
        addContributionActivity(dayMap, entry?.executedAt || entryTimestamp, 'completedProtocols');
      }

      const resultFileRecords = asArray(entry?.resultFileRecords);
      collectFileRecordActivity(dayMap, resultFileRecords, entryTimestamp);
      if (!resultFileRecords.length && asArray(entry?.resultFiles).length) {
        addContributionActivity(dayMap, entryTimestamp, 'dataUploads', entry.resultFiles.length);
      }

      if (cleanText(entry?.result) || resultTableHasContent(entry?.resultTable) || asArray(entry?.selectionInsights).length) {
        addContributionActivity(dayMap, entryTimestamp, 'analysisNotes');
      }
    });

    workflows.forEach((workflow) => {
      asArray(workflow?.entries).forEach((entry) => {
        const stepStates = entry?.stepStates && typeof entry.stepStates === 'object' && !Array.isArray(entry.stepStates)
          ? entry.stepStates
          : {};
        Object.values(stepStates).forEach((stepState) => {
          const stepTimestamp = stepState?.updatedAt || stepState?.completedAt || workflow?.updatedAt || workflow?.createdAt;
          if (normalizeKey(stepState?.status) === 'completed' || stepState?.completedAt) {
            addContributionActivity(dayMap, stepState?.completedAt || stepTimestamp, 'completedProtocols');
          }
          collectFileRecordActivity(dayMap, stepState?.resultFileRecords, stepTimestamp);
          if (!asArray(stepState?.resultFileRecords).length && asArray(stepState?.resultFiles).length) {
            addContributionActivity(dayMap, stepTimestamp, 'dataUploads', stepState.resultFiles.length);
          }
          if (cleanText(stepState?.result)) {
            addContributionActivity(dayMap, stepTimestamp, 'analysisNotes');
          }
        });
      });
    });

    assays.forEach((assay) => {
      const timestamp = assay?.updatedAt || assay?.createdAt;
      if (assay?.resultValues && typeof assay.resultValues === 'object' && Object.keys(assay.resultValues).length) {
        addContributionActivity(dayMap, timestamp, 'dataUploads');
      }
      if (assay?.latestAnalysis && typeof assay.latestAnalysis === 'object') {
        addContributionActivity(dayMap, assay.latestAnalysis.updatedAt || timestamp, 'analysisNotes');
      }
    });

    gelAnalyses.forEach((analysis) => {
      const timestamp = analysis?.updatedAt || analysis?.createdAt;
      if (analysis?.imageName || analysis?.report || analysis?.previewImagePath || analysis?.previewImageDataUrl) {
        addContributionActivity(dayMap, timestamp, 'dataUploads');
      }
      addContributionActivity(dayMap, timestamp, 'analysisNotes');
    });

    papers.forEach((paper) => {
      addContributionActivity(dayMap, paper?.updatedAt || paper?.discoveredAt || paper?.createdAt, 'papers');
    });

    samples.forEach((sample) => {
      addContributionActivity(dayMap, sample?.updatedAt || sample?.createdAt, 'samples');
    });

    return dayMap;
  }

  function parseTimestamp(raw) {
    const value = Date.parse(String(raw || ''));
    return Number.isFinite(value) ? value : 0;
  }

  function formatTimestamp(raw) {
    const value = parseTimestamp(raw);
    if (!value) {
      return '-';
    }
    return new Date(value).toLocaleString();
  }

  function formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function dayKeyFromTimestamp(timestamp) {
    const parsed = new Date(cleanText(timestamp));
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    return formatDateLocal(parsed);
  }

  function startOfWeek(date) {
    const clone = new Date(date);
    clone.setHours(0, 0, 0, 0);
    clone.setDate(clone.getDate() - clone.getDay());
    return clone;
  }

  function addDays(date, days) {
    const clone = new Date(date);
    clone.setDate(clone.getDate() + days);
    return clone;
  }

  function contributionLevel(total) {
    const count = Number(total) || 0;
    if (count <= 0) {
      return 0;
    }
    if (count === 1) {
      return 1;
    }
    if (count <= 3) {
      return 2;
    }
    if (count <= 6) {
      return 3;
    }
    return 4;
  }

  function buildContributionDays(dayMap) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = startOfWeek(today);
    start.setDate(start.getDate() - ((CONTRIBUTION_WEEK_COUNT - 1) * 7));
    return Array.from({ length: CONTRIBUTION_WEEK_COUNT * 7 }, (_item, index) => {
      const date = addDays(start, index);
      const dayKey = formatDateLocal(date);
      const bucket = dayMap.get(dayKey) || createContributionBucket();
      return {
        date,
        dayKey,
        bucket,
        level: contributionLevel(bucket.total),
        isFuture: date.getTime() > today.getTime()
      };
    });
  }

  function formatContributionDate(date) {
    return date.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  function formatContributionPart(count, label) {
    const value = Number(count) || 0;
    if (!value) {
      return '';
    }
    return `${value} ${label}${value === 1 ? '' : 's'}`;
  }

  function contributionCellLabel(day) {
    const total = Number(day.bucket.total) || 0;
    const dateLabel = formatContributionDate(day.date);
    if (!total) {
      return `No project activity on ${dateLabel}`;
    }
    const parts = [
      formatContributionPart(day.bucket.projectLogs, 'project log'),
      formatContributionPart(day.bucket.completedProtocols, 'completed protocol'),
      formatContributionPart(day.bucket.dataUploads, 'data upload'),
      formatContributionPart(day.bucket.analysisNotes, 'analysis note'),
      formatContributionPart(day.bucket.papers, 'paper'),
      formatContributionPart(day.bucket.samples, 'sample update')
    ].filter(Boolean);
    return `${total} project activit${total === 1 ? 'y' : 'ies'} on ${dateLabel}: ${parts.join(', ')}`;
  }

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
      <span class="project-contribution-month-label" style="grid-column: ${label.column} / span 3;">${safeText(label.label)}</span>
    `).join('');
  }

  function renderContributionHeatmap(dayMap) {
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
      <section class="panel project-contribution-panel" aria-labelledby="project-contribution-heading">
        <div class="project-panel-head">
          <div class="project-panel-copy">
            <h3 id="project-contribution-heading">Contribution Heatmap</h3>
            <p class="small-note">${safeText(summary)}</p>
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
                  title="${safeText(contributionCellLabel(day))}"
                  aria-label="${safeText(contributionCellLabel(day))}"
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

  function formatLinkedAssays(notebookEntryId) {
    const assays = asArray(state.assays)
      .filter((assay) => assay.notebookEntryId === notebookEntryId)
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));
    if (!assays.length) {
      return '-';
    }
    return assays.map((assay) => assay.name || assay.id).join(', ');
  }

  function formatLinkedGels(notebookEntryId) {
    const analyses = asArray(state.gelAnalyses)
      .filter((analysis) => analysis.notebookEntryId === notebookEntryId)
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));
    if (!analyses.length) {
      return '-';
    }
    return analyses.map((analysis) => analysis.name || analysis.id).join(', ');
  }

  function renderNotebookPageItems(notebookEntries) {
    const entries = Array.isArray(notebookEntries)
      ? notebookEntries
      : getProjectNotebookEntries(getActiveProject());

    if (!entries.length) {
      return '<p class="small-note">No notebook pages for this project yet.</p>';
    }

    return entries.map((entry) => `
      <article class="project-notebook-item">
        <h3>${safeText(entry.protocolName || '-')}</h3>
        <p><strong>State:</strong> ${safeText(notebookStateLabel(entry))}</p>
        <p><strong>Updated:</strong> ${safeText(formatTimestamp(entry.updatedAt))}</p>
        <p><strong>Result:</strong> ${safeText(entry.result || '-')}</p>
        <p><strong>Result Table:</strong> ${safeText(summarizeNotebookResultTable(entry.resultTable) || '-')}</p>
        <p><strong>Files:</strong> ${safeText(asArray(entry.resultFiles).join(', ') || '-')}</p>
        <p><strong>Linked Assays:</strong> ${safeText(formatLinkedAssays(entry.id))}</p>
        <p><strong>Linked Gels:</strong> ${safeText(formatLinkedGels(entry.id))}</p>
      </article>
    `).join('');
  }

  function renderStatCard({ label, value, note }) {
    return `
      <article class="project-stat-card">
        <span>${safeText(label)}</span>
        <strong>${safeText(value)}</strong>
        <p>${safeText(note)}</p>
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

  function renderProjectList() {
    ensureSelectedProject();
    const projects = asArray(state.projects);
    if (!projectList) {
      return;
    }
    projectList.classList.remove('cards', 'list-table');
    projectList.classList.add('project-rail-list');

    if (!projects.length) {
      projectList.innerHTML = '<p class="small-note">No projects yet.</p>';
      return;
    }

    projectList.innerHTML = projects.map((project) => {
      const summary = getProjectSummary(project);
      const isActive = project.id === selectedProjectId;
      const meta = `${summary.samples.length} samples | ${summary.papers.length} papers`;
      return `
        <article class="project-rail-item${isActive ? ' is-active' : ''}">
          <button
            type="button"
            class="project-rail-main-btn"
            data-project-select="${safeText(project.id)}"
            ${isActive ? 'aria-current="true"' : ''}
          >
            <span class="project-rail-title">${safeText(project.name)}</span>
            <span class="project-rail-meta">${safeText(meta)}</span>
          </button>
          <div class="project-rail-actions">
            <button type="button" class="ghost-btn" data-project-edit="${safeText(project.id)}">Edit</button>
            <button type="button" class="danger-btn" data-project-delete="${safeText(project.id)}">Delete</button>
          </div>
        </article>
      `;
    }).join('');

    projectList.querySelectorAll('[data-project-select]').forEach((button) => {
      button.addEventListener('click', () => selectProject(button.dataset.projectSelect));
    });

    projectList.querySelectorAll('[data-project-edit]').forEach((button) => {
      button.addEventListener('click', () => editProject(button.dataset.projectEdit));
    });

    projectList.querySelectorAll('[data-project-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteProject(button.dataset.projectDelete));
    });
  }

  function renderDashboard() {
    const project = getActiveProject();
    if (!projectDashboard) {
      return;
    }
    if (!project) {
      projectDashboard.innerHTML = `
        <section class="panel project-empty-panel">
          <h3>No Project Selected</h3>
          <p class="small-note">Create a project in the left rail to start tracking project-specific activity.</p>
        </section>
      `;
      return;
    }

    const summary = getProjectSummary(project);
    projectDashboard.innerHTML = `
      <section class="panel project-dashboard-hero">
        <div class="project-dashboard-title">
          <span class="project-eyebrow">Project Activity</span>
          <h2>Dashboard</h2>
          <p class="small-note">${safeText(project.description || 'No description yet.')}</p>
        </div>
        <div class="project-dashboard-actions">
          <button type="button" class="ghost-btn" data-project-edit="${safeText(project.id)}">Edit Project</button>
        </div>
      </section>
      ${renderStats(summary)}
      ${renderContributionHeatmap(summary.activeDayMap)}
    `;
  }

  function renderProjectFilterOptions() {
    if (!projectNotebookFilter) {
      return;
    }
    ensureSelectedProject();
    const selected = selectedProjectId;
    const options = ['<option value="">Select project</option>'];
    asArray(state.projects).forEach((project) => {
      const isSelected = selected === project.id ? ' selected' : '';
      options.push(`<option value="${safeText(project.id)}"${isSelected}>${safeText(project.name)}</option>`);
    });
    projectNotebookFilter.innerHTML = options.join('');
    projectNotebookFilter.value = selected || '';
  }

  function renderLegacyNotebookPages() {
    if (!projectNotebookPages) {
      return;
    }
    projectNotebookPages.classList?.remove?.('cards');
    projectNotebookPages.classList?.add?.('project-notebook-list');
    const project = getActiveProject();
    projectNotebookPages.innerHTML = project
      ? renderNotebookPageItems(getProjectNotebookEntries(project))
      : '<p class="small-note">Select a project to view related lab notebook pages.</p>';
  }

  function onDashboardClick(event) {
    const editButton = event.target.closest('[data-project-edit]');
    if (editButton) {
      editProject(editButton.dataset.projectEdit);
    }
  }

  function render() {
    ensureSelectedProject();
    renderProjectFilterOptions();
    renderProjectList();
    renderDashboard();
    renderLegacyNotebookPages();
  }

  return {
    render,
    renderNotebookPages: renderLegacyNotebookPages
  };
}
