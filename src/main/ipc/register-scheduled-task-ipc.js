'use strict';

const { SCHEDULED_TASK } = require('../../shared/ipc/channels');
const { ensureObject } = require('../lib/normalize.js');

function registerScheduledTaskIpc({ ipcMain, scheduledTaskService, cleanText } = {}) {
  const clean = typeof cleanText === 'function'
    ? cleanText
    : ((value, maxLength = 2400) => String(value || '').trim().slice(0, maxLength));

  function failure(error, fallbackMessage) {
    return {
      ok: false,
      error: clean(error?.message || error, 2400) || fallbackMessage,
      code: clean(error?.code, 120),
      ...(error?.scheduledTaskRun ? { run: error.scheduledTaskRun } : {})
    };
  }

  ipcMain.handle(SCHEDULED_TASK.LIST, async () => {
    try {
      const tasks = await scheduledTaskService.listTasks();
      return { ok: true, tasks };
    } catch (error) {
      return { ...failure(error, 'Failed to list scheduled tasks.'), tasks: [] };
    }
  });

  ipcMain.handle(SCHEDULED_TASK.GET, async (_event, payload) => {
    try {
      const input = ensureObject(payload);
      const task = await scheduledTaskService.getTask(clean(input.id, 160));
      return task
        ? { ok: true, task }
        : { ok: false, not_found: true, error: 'Scheduled task was not found.' };
    } catch (error) {
      return failure(error, 'Failed to get scheduled task.');
    }
  });

  ipcMain.handle(SCHEDULED_TASK.CREATE, async (_event, payload) => {
    try {
      const task = await scheduledTaskService.createTask(ensureObject(payload));
      return { ok: true, task };
    } catch (error) {
      return failure(error, 'Failed to create scheduled task.');
    }
  });

  ipcMain.handle(SCHEDULED_TASK.UPDATE, async (_event, payload) => {
    try {
      const input = ensureObject(payload);
      const id = clean(input.id, 160);
      const task = await scheduledTaskService.updateTask(id, input);
      return task
        ? { ok: true, task }
        : { ok: false, not_found: true, error: 'Scheduled task was not found.' };
    } catch (error) {
      return failure(error, 'Failed to update scheduled task.');
    }
  });

  ipcMain.handle(SCHEDULED_TASK.DELETE, async (_event, payload) => {
    try {
      const input = ensureObject(payload);
      const task = await scheduledTaskService.deleteTask(clean(input.id, 160));
      return task
        ? { ok: true, deleted: true, task }
        : { ok: false, not_found: true, error: 'Scheduled task was not found.' };
    } catch (error) {
      return failure(error, 'Failed to delete scheduled task.');
    }
  });

  ipcMain.handle(SCHEDULED_TASK.RUN, async (_event, payload) => {
    try {
      const input = ensureObject(payload);
      const result = await scheduledTaskService.runTask(clean(input.id, 160), { trigger: 'manual' });
      return result
        ? { ok: true, ...result }
        : { ok: false, not_found: true, error: 'Scheduled task was not found.' };
    } catch (error) {
      return failure(error, 'Failed to run scheduled task.');
    }
  });
}

module.exports = {
  registerScheduledTaskIpc
};
