'use strict';

const { SCHEDULED_TASK } = require('../../../shared/ipc/channels');
const {
  buildPaperFindingInputFromTask,
  buildPaperFindingScheduledTaskInput,
  isPaperFindingTask
} = require('../../papers/finding/paper-finding-task.js');

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanText(value, maxLength = 2400) {
  return String(value || '').trim().slice(0, maxLength);
}

function paperFindingProjectId(value = {}) {
  const source = ensureObject(value);
  const config = ensureObject(ensureObject(source.metadata).paper_finding);
  const project = ensureObject(source.project);
  return cleanText(
    project.id
      || project.project_id
      || project.projectId
      || config.project_id,
    220
  );
}

function mergePaperFindingInput(task = {}, updates = {}) {
  const base = buildPaperFindingInputFromTask(task);
  const source = ensureObject(updates);
  const nextProject = {
    ...ensureObject(base.project),
    ...ensureObject(source.project)
  };
  const nextExecution = {
    ...ensureObject(base.execution),
    ...ensureObject(source.execution)
  };
  return {
    ...base,
    ...source,
    project: nextProject,
    execution: nextExecution
  };
}

function createScheduledTaskApi(ipcRenderer) {
  const listScheduledTasks = () => ipcRenderer.invoke(SCHEDULED_TASK.LIST);
  const getScheduledTask = (id) => ipcRenderer.invoke(SCHEDULED_TASK.GET, { id });
  const createScheduledTask = (payload) => ipcRenderer.invoke(SCHEDULED_TASK.CREATE, payload);
  const updateScheduledTask = (id, updates = {}) => ipcRenderer.invoke(SCHEDULED_TASK.UPDATE, {
    ...updates,
    id
  });
  const deleteScheduledTask = (id) => ipcRenderer.invoke(SCHEDULED_TASK.DELETE, { id });
  const runScheduledTask = (id) => ipcRenderer.invoke(SCHEDULED_TASK.RUN, { id });

  async function listPaperFindingTasks() {
    const response = await listScheduledTasks();
    if (response?.ok !== true) {
      return response;
    }
    return {
      ...response,
      tasks: (Array.isArray(response.tasks) ? response.tasks : []).filter(isPaperFindingTask)
    };
  }

  function createPaperFindingTask(payload = {}) {
    return createScheduledTask(buildPaperFindingScheduledTaskInput(payload));
  }

  async function updatePaperFindingTask(id, updates = {}) {
    const currentResponse = await getScheduledTask(id);
    if (currentResponse?.ok !== true || !isPaperFindingTask(currentResponse.task)) {
      return currentResponse?.ok === true
        ? { ok: false, not_found: true, error: 'Paper-finding task was not found.' }
        : currentResponse;
    }
    const currentTask = currentResponse.task;
    const input = mergePaperFindingInput(currentTask, updates);
    const payload = buildPaperFindingScheduledTaskInput(input);
    const currentInterval = Number(currentTask?.schedule?.interval_minutes);
    const nextInterval = Number(payload?.schedule?.interval_minutes);
    if (currentInterval === nextInterval) {
      delete payload.schedule;
    }
    return updateScheduledTask(id, payload);
  }

  async function schedulePaperFinding(payload = {}) {
    const projectId = paperFindingProjectId(payload);
    const listed = await listPaperFindingTasks();
    if (listed?.ok !== true) {
      return listed;
    }
    const existing = (Array.isArray(listed.tasks) ? listed.tasks : []).find((task) => (
      projectId && paperFindingProjectId(task) === projectId
    ));
    if (!existing) {
      return createPaperFindingTask(payload);
    }
    return updatePaperFindingTask(existing.id, payload);
  }

  return {
    listScheduledTasks,
    getScheduledTask,
    createScheduledTask,
    updateScheduledTask,
    deleteScheduledTask,
    runScheduledTask,
    listPaperFindingTasks,
    createPaperFindingTask,
    updatePaperFindingTask,
    schedulePaperFinding,
    deletePaperFindingTask: deleteScheduledTask,
    runPaperFindingTask: runScheduledTask
  };
}

module.exports = {
  createScheduledTaskApi
};
