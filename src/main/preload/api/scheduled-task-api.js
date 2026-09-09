'use strict';

const { SCHEDULED_TASK } = require('../../../shared/ipc/channels');
const { ensureObject } = require('../../lib/normalize.js');
const {
  buildPaperFindingInputFromTask,
  buildPaperFindingScheduledTaskInput,
  isPaperFindingTask
} = require('../../papers/finding/paper-finding-task.js');

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

function paperFindingSchedulesMatch(currentValue = {}, nextValue = {}) {
  const current = ensureObject(currentValue);
  const next = ensureObject(nextValue);
  if (cleanText(current.kind, 40) !== cleanText(next.kind, 40)) {
    return false;
  }
  if (next.kind === 'interval') {
    return Number(current.interval_minutes) === Number(next.interval_minutes);
  }
  if (next.kind !== 'calendar') {
    return false;
  }
  const keys = [
    'interval_value',
    'interval_unit',
    'time_of_day',
    'timezone',
    ...(next.interval_unit === 'week' ? ['day_of_week'] : []),
    ...(next.interval_unit === 'month' ? ['day_of_month'] : [])
  ];
  return keys.every((key) => String(current[key]) === String(next[key]));
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
    if (paperFindingSchedulesMatch(currentTask.schedule, payload.schedule)) {
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
