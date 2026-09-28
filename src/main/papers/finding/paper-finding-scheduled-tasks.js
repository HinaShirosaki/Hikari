'use strict';

const { ensureObject } = require('../../lib/normalize.js');
const {
  buildPaperFindingInputFromTask,
  buildPaperFindingScheduledTaskInput,
  isPaperFindingTask,
  paperIdentity
} = require('./paper-finding-task.js');

function cleanText(value, maxLength = 2400) {
  return String(value || '').trim().slice(0, maxLength);
}

function paperFindingProjectId(value = {}) {
  const source = ensureObject(value);
  const config = ensureObject(ensureObject(source.metadata).paper_finding);
  const project = ensureObject(source.project);
  return cleanText(project.id || project.project_id || project.projectId || config.project_id, 220);
}

function mergePaperFindingInput(task = {}, updates = {}) {
  const base = buildPaperFindingInputFromTask(task);
  const source = ensureObject(updates);
  return {
    ...base,
    ...source,
    project: { ...ensureObject(base.project), ...ensureObject(source.project) },
    execution: { ...ensureObject(base.execution), ...ensureObject(source.execution) }
  };
}

function paperFindingSchedulesMatch(currentValue = {}, nextValue = {}) {
  const current = ensureObject(currentValue);
  const next = ensureObject(nextValue);
  if (cleanText(current.kind, 40) !== cleanText(next.kind, 40)) return false;
  if (next.kind === 'interval') {
    return Number(current.interval_minutes) === Number(next.interval_minutes);
  }
  if (next.kind !== 'calendar') return false;
  const keys = [
    'interval_value', 'interval_unit', 'time_of_day', 'timezone',
    ...(next.interval_unit === 'week' ? ['day_of_week'] : []),
    ...(next.interval_unit === 'month' ? ['day_of_month'] : [])
  ];
  return keys.every((key) => String(current[key]) === String(next[key]));
}

function safeHttpUrl(value) {
  try {
    const url = new URL(cleanText(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

// The project folder comes from the stored task, never from the renderer.
function paperDownloadInput(task = {}, paper = {}) {
  const source = ensureObject(paper);
  const project = ensureObject(task.project);
  const config = ensureObject(ensureObject(task.metadata).paper_finding);
  return {
    doi: cleanText(source.doi, 240),
    pmid: cleanText(source.pmid, 40),
    pmcid: cleanText(source.pmcid, 40),
    // With a DOI the window opens doi.org (the publisher) instead of the
    // finder's PubMed/PMC link, which sits behind NCBI's bot check.
    page_url: cleanText(source.doi) ? '' : safeHttpUrl(source.url),
    paper_title: cleanText(source.title, 320),
    journal: cleanText(source.journal, 240),
    linked_type: 'project',
    linked_name: cleanText(project.name || config.project_name, 220),
    storage_path: cleanText(project.storage_path)
  };
}

function localFile(saved = {}) {
  return {
    file_path: cleanText(saved.file_path, 4000),
    relative_path: cleanText(saved.relative_path, 2000)
  };
}

// Hikari, not the model, decides what is already saved: a found paper whose PDF
// is already in the project folder is marked already_local when the run ends.
async function markSavedPapers(task, result, paperDownloadRuntime) {
  const source = ensureObject(result);
  if (!Array.isArray(source.papers) || typeof paperDownloadRuntime?.findSavedPaper !== 'function') {
    return result;
  }
  const papers = await Promise.all(source.papers.map(async (paper) => {
    const saved = await paperDownloadRuntime.findSavedPaper(paperDownloadInput(task, paper));
    return saved?.file_path
      ? { ...paper, already_local: true, local_file: localFile(saved) }
      : { ...paper, already_local: false };
  }));
  return { ...source, papers };
}

function createPaperFindingScheduledTasks({ scheduledTaskService, paperDownloadRuntime } = {}) {
  async function listTasks() {
    const tasks = await scheduledTaskService.listTasks();
    return (Array.isArray(tasks) ? tasks : []).filter(isPaperFindingTask);
  }

  function createTask(payload = {}) {
    return scheduledTaskService.createTask(buildPaperFindingScheduledTaskInput(payload));
  }

  async function updateTask(id, updates = {}) {
    const currentTask = await scheduledTaskService.getTask(cleanText(id, 160));
    if (!isPaperFindingTask(currentTask)) return null;
    const payload = buildPaperFindingScheduledTaskInput(mergePaperFindingInput(currentTask, updates));
    if (paperFindingSchedulesMatch(currentTask.schedule, payload.schedule)) delete payload.schedule;
    return scheduledTaskService.updateTask(currentTask.id, payload);
  }

  async function scheduleTask(payload = {}) {
    const projectId = paperFindingProjectId(payload);
    const existing = (await listTasks()).find((task) => (
      projectId && paperFindingProjectId(task) === projectId
    ));
    return existing ? updateTask(existing.id, payload) : createTask(payload);
  }

  async function downloadPaper(taskId, paper = {}) {
    const task = await scheduledTaskService.getTask(cleanText(taskId, 160));
    if (!isPaperFindingTask(task)) return null;
    if (typeof paperDownloadRuntime?.downloadPaper !== 'function') {
      throw new Error('Paper download is unavailable in this build.');
    }
    const result = await paperDownloadRuntime.downloadPaper({
      ...paperDownloadInput(task, paper),
      // Covers the Paper Download window's 2-minute session; indexing may continue after.
      wait_timeout_ms: 180_000
    });
    if (result?.ok === true && result.download_status === 'completed' && result.file_path) {
      // The card stays "Saved" until the next run replaces this run's results.
      const key = paperIdentity(ensureObject(paper));
      // Best-effort: the PDF is already saved even if marking the card fails.
      await Promise.resolve(scheduledTaskService.updateRunResult?.(task.id, task.last_run?.id, (runResult) => ({
        ...runResult,
        papers: (Array.isArray(runResult.papers) ? runResult.papers : []).map((card) => (
          paperIdentity(card) === key ? { ...card, download_status: 'saved', local_file: localFile(result) } : card
        ))
      }))).catch(() => null);
    }
    return result;
  }

  return { listTasks, createTask, updateTask, scheduleTask, downloadPaper };
}

module.exports = {
  createPaperFindingScheduledTasks,
  markSavedPapers,
  mergePaperFindingInput,
  paperFindingProjectId,
  paperFindingSchedulesMatch
};
