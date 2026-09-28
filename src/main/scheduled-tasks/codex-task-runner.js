'use strict';

const path = require('node:path');
const { sanitizeProjectMemoryFolderName } = require('../project-memory');

function ensurePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStringList(value, cleanText, maxItems = 12) {
  const values = [];
  function add(entry) {
    if (Array.isArray(entry)) {
      entry.forEach(add);
      return;
    }
    String(entry || '')
      .split(/[;\n]+/u)
      .map((item) => cleanText(item, 240))
      .filter(Boolean)
      .forEach((item) => values.push(item));
  }
  add(value);
  const seen = new Set();
  return values.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, maxItems);
}

function createCodexScheduledTaskRunner({ cleanText, codexAgentRuntime } = {}) {
  if (typeof cleanText !== 'function' || typeof codexAgentRuntime?.run !== 'function') {
    throw new Error('Codex scheduled-task execution is not configured.');
  }

  return async function runScheduledTask(task = {}) {
    const project = ensurePlainObject(task.project);
    const execution = ensurePlainObject(task.execution);
    const metadata = ensurePlainObject(task.metadata);
    const paperFinding = ensurePlainObject(metadata.paper_finding);
    const projectName = cleanText(project.name, 320);
    const projectDescription = cleanText(
      project.description || paperFinding.project_description,
      12000
    );
    const preferredJournals = normalizeStringList(
      paperFinding.preferred_journals,
      cleanText
    );
    const taskType = cleanText(task.task_type || task.taskType, 80).toLowerCase();
    const dataFilePath = cleanText(project.data_file_path, 2400);
    const storagePath = cleanText(project.storage_path, 2400)
      || (dataFilePath ? path.dirname(path.resolve(dataFilePath)) : '');
    const cwd = cleanText(project.cwd, 2400)
      || (storagePath && projectName
        ? path.join(
          storagePath,
          'Project',
          sanitizeProjectMemoryFolderName(projectName, 'Untitled_Project')
        )
        : '');
    const snapshot = {
      settings: {
        ...(storagePath ? { storagePath } : {}),
        ...(preferredJournals.length
          ? {
            preferredJournals,
            preferredJournal: preferredJournals.join('; ')
          }
          : {})
      },
      projects: project.id || project.name
        ? [{
          ...(cleanText(project.id, 220) ? { id: cleanText(project.id, 220) } : {}),
          name: projectName || 'Untitled Project',
          ...(projectDescription ? { description: projectDescription } : {})
        }]
        : [],
      scheduled_task: {
        id: cleanText(task.id, 160),
        task_type: taskType,
        deny_paper_download: taskType === 'paper_finding'
      },
      ...(dataFilePath ? { data_file_path: dataFilePath } : {})
    };
    return codexAgentRuntime.run({
      message: cleanText(task.prompt, 120000),
      model: cleanText(execution.model, 120),
      reasoningEffort: cleanText(execution.reasoning_effort, 40),
      enableWebSearch: execution.enable_web_search !== false,
      timeoutMs: execution.timeout_ms,
      cwd,
      projectId: cleanText(project.id, 220),
      projectName,
      dataFilePath,
      fallbackDataFilePath: dataFilePath,
      snapshot,
      traceContext: {
        requestId: `scheduled-task:${cleanText(task.id, 160)}`
      }
    });
  };
}

module.exports = {
  createCodexScheduledTaskRunner,
  normalizeStringList
};
