'use strict';

const { PAPER_FINDING, SCHEDULED_TASK } = require('../../../shared/ipc/channels');

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

  const listPaperFindingTasks = () => ipcRenderer.invoke(PAPER_FINDING.LIST);
  const createPaperFindingTask = (payload = {}) => ipcRenderer.invoke(PAPER_FINDING.CREATE, payload);
  const updatePaperFindingTask = (id, updates = {}) => ipcRenderer.invoke(PAPER_FINDING.UPDATE, { id, updates });
  const schedulePaperFinding = (payload = {}) => ipcRenderer.invoke(PAPER_FINDING.SCHEDULE, payload);
  const downloadFoundPaper = (taskId, paper = {}) => ipcRenderer.invoke(PAPER_FINDING.DOWNLOAD, { task_id: taskId, paper });

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
    downloadFoundPaper,
    deletePaperFindingTask: deleteScheduledTask,
    runPaperFindingTask: runScheduledTask
  };
}

module.exports = {
  createScheduledTaskApi
};
