'use strict';

const { SCHEDULED_TASK } = require('../../../shared/ipc/channels');

function createScheduledTaskApi(ipcRenderer) {
  return {
    listScheduledTasks: () => ipcRenderer.invoke(SCHEDULED_TASK.LIST),
    getScheduledTask: (id) => ipcRenderer.invoke(SCHEDULED_TASK.GET, { id }),
    createScheduledTask: (payload) => ipcRenderer.invoke(SCHEDULED_TASK.CREATE, payload),
    updateScheduledTask: (id, updates = {}) => ipcRenderer.invoke(SCHEDULED_TASK.UPDATE, {
      ...updates,
      id
    }),
    deleteScheduledTask: (id) => ipcRenderer.invoke(SCHEDULED_TASK.DELETE, { id }),
    runScheduledTask: (id) => ipcRenderer.invoke(SCHEDULED_TASK.RUN, { id })
  };
}

module.exports = {
  createScheduledTaskApi
};
