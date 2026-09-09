'use strict';

function isNotebookSuggestionContext(context = {}) {
  const task = context.snapshot?.scheduled_task || context.snapshot?.scheduledTask;
  return task?.task_type === 'notebook_suggestion' && Boolean(task.id)
    && task.deny_paper_download === true && Boolean(context.projectId || context.project?.id);
}

const SUGGESTION_TOOLS = new Set([
  'notebook_suggest', 'notebook_lookup', 'protocol_lookup', 'inventory_lookup',
  'chemical_lookup', 'literature_search'
]);

function isToolAllowedForContext(name, context = {}) {
  if (isNotebookSuggestionContext(context)) return SUGGESTION_TOOLS.has(name);
  return name !== 'notebook_suggest';
}

module.exports = { isNotebookSuggestionContext, isToolAllowedForContext };
