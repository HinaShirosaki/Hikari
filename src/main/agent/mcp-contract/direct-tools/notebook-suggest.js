'use strict';

const { NOTEBOOK_DRAFT_MCP_TOOL, callNotebookDraft } = require('./notebook-draft.js');
const { isNotebookSuggestionContext } = require('../notebook-suggestion-policy.js');
const { cleanText } = require('./shared.js');

const NOTEBOOK_SUGGEST_MCP_TOOL = Object.freeze({
  ...NOTEBOOK_DRAFT_MCP_TOOL,
  name: 'notebook_suggest',
  description: 'Only available in the background next-experiment suggestion workflow. Prepare one Suggested experiment using the notebook_draft protocol, placeholder and per-copy step-edit contract. Hikari adds it to the scoped project for review; it becomes Planned only when the user takes it into plan. Supply a concise title and evidence-grounded rationale. Never download papers in this workflow.',
  annotations: { ...NOTEBOOK_DRAFT_MCP_TOOL.annotations, title: 'Suggest next experiment' },
  inputSchema: {
    ...NOTEBOOK_DRAFT_MCP_TOOL.inputSchema,
    properties: {
      ...NOTEBOOK_DRAFT_MCP_TOOL.inputSchema.properties,
      title: { type: 'string', maxLength: 220 },
      rationale: { type: 'string', maxLength: 1500 }
    }
  }
});

async function callNotebookSuggest(input = {}, context = {}, deps = {}) {
  if (!isNotebookSuggestionContext(context)) {
    return { ok: false, status: 'rejected', error: 'notebook_suggest is restricted to background experiment suggestions.' };
  }
  const projectId = context.projectId || context.project.id;
  const projectName = context.projectName || context.project?.name;
  const result = await callNotebookDraft({ ...input, project_name: projectName }, context, deps);
  if (!result.ok || !result.notebook?.entry_template) return { ...result, mcp_tool: 'notebook_suggest' };
  const notebook = result.notebook;
  const template = notebook.entry_template;
  const title = cleanText(input.title || notebook.proposal?.title || template.protocolName, 220);
  const rationale = cleanText(input.rationale || notebook.proposal?.rationale, 1500);
  notebook.project = { id: projectId, name: projectName };
  notebook.save = { mode: 'suggestion_only', applied: false, status: 'suggestion_ready' };
  notebook.entry_template = {
    ...template,
    projectId, projectName,
    experimentName: title,
    notebookState: 'suggested',
    executedAt: '',
    result: [rationale ? `Suggestion rationale: ${rationale}` : '', template.result].filter(Boolean).join('\n\n'),
    agentDraftMeta: {
      ...template.agentDraftMeta,
      source: 'agent_notebook_suggestion_v1',
      suggestionRunId: context.snapshot.scheduled_task.id,
      rationale
    }
  };
  return { ...result, status: 'suggestion_ready', mcp_tool: 'notebook_suggest', notebook };
}

module.exports = { NOTEBOOK_SUGGEST_MCP_TOOL, callNotebookSuggest };
