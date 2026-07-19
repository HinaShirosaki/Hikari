'use strict';

const {
  asArray,
  cloneJson,
  defaultCleanText,
  parseJsonObjectFromText
} = require('./runtime-utils.js');
const { normalizeCodexToolName } = require('./payloads.js');
const {
  normalizeProtocolGenerationArtifact
} = require('../runtime/tool-artifacts/protocol-generation.js');

function collectToolEventObjects(streamEvent = {}) {
  const source = streamEvent && typeof streamEvent === 'object' && !Array.isArray(streamEvent)
    ? streamEvent
    : {};
  const objectCandidates = [
    source.tool_result,
    source.toolResult,
    source.tool_output,
    source.toolOutput,
    source.result,
    source.output,
    source.arguments,
    source.args
  ].filter((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
  const textCandidates = [
    source.tool_output_text,
    source.toolOutputText,
    source.output_text,
    source.outputText,
    source.tool_call_text,
    source.toolCallText,
    source.text,
    source.message
  ];
  textCandidates.forEach((candidate) => {
    const parsed = parseJsonObjectFromText(candidate);
    if (parsed) {
      objectCandidates.push(parsed);
    }
  });
  return objectCandidates;
}

function extractProtocolGenerationArtifactFromToolEvent(streamEvent = {}) {
  const source = streamEvent && typeof streamEvent === 'object' && !Array.isArray(streamEvent)
    ? streamEvent
    : {};
  const toolName = normalizeCodexToolName(source.tool_name || source.toolName, { cleanText: defaultCleanText });
  if (toolName !== 'protocol_generation') {
    return null;
  }
  const rawStatus = defaultCleanText(source.status, 40).trim();
  const hasResultPayload = Boolean(
    source.tool_result
    || source.toolResult
    || source.tool_output
    || source.toolOutput
    || source.result
    || source.output
    || source.tool_output_text
    || source.toolOutputText
    || source.output_text
    || source.outputText
  );
  if (rawStatus && !['completed', 'done', 'ok'].includes(rawStatus) && !hasResultPayload) {
    return null;
  }
  for (const candidate of collectToolEventObjects(source)) {
    const artifact = normalizeProtocolGenerationArtifact(candidate, { cleanText: defaultCleanText });
    if (artifact?.protocol) {
      return artifact;
    }
  }
  return null;
}

function normalizeNotebookDraftArtifact(payload = {}, { cleanText = defaultCleanText } = {}) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const notebook = source.notebook && typeof source.notebook === 'object' && !Array.isArray(source.notebook)
    ? cloneJson(source.notebook, null)
    : null;
  if (!notebook || !Object.keys(notebook).length) {
    return null;
  }
  return {
    ok: source.ok !== false,
    status: cleanText(source.status, 80) || 'proposal_ready',
    mcp_tool: cleanText(source.mcp_tool || source.mcpTool, 120) || 'notebook_draft',
    app_tool: cleanText(source.app_tool || source.appTool, 120) || 'notebook-draft',
    summary: cleanText(source.summary, 500),
    project_name: cleanText(source.project_name || source.projectName, 220),
    selected_protocol: cloneJson(source.selected_protocol || source.selectedProtocol, null),
    source_workflow: cloneJson(source.source_workflow || source.sourceWorkflow, null),
    missing_placeholders: asArray(source.missing_placeholders || source.missingPlaceholders),
    follow_up_questions: asArray(source.follow_up_questions || source.followUpQuestions)
      .map((item) => cleanText(item, 500))
      .filter(Boolean)
      .slice(0, 10),
    proposal_summary: cleanText(source.proposal_summary || source.proposalSummary, 600),
    proposal: cloneJson(source.proposal, null),
    notebook
  };
}

function extractNotebookDraftArtifactFromToolEvent(streamEvent = {}) {
  const source = streamEvent && typeof streamEvent === 'object' && !Array.isArray(streamEvent)
    ? streamEvent
    : {};
  const toolName = normalizeCodexToolName(source.tool_name || source.toolName, { cleanText: defaultCleanText });
  if (toolName !== 'notebook_draft') {
    return null;
  }
  const rawStatus = defaultCleanText(source.status, 40).trim();
  const hasResultPayload = Boolean(
    source.tool_result
    || source.toolResult
    || source.tool_output
    || source.toolOutput
    || source.result
    || source.output
    || source.tool_output_text
    || source.toolOutputText
    || source.output_text
    || source.outputText
  );
  if (rawStatus && !['completed', 'done', 'ok'].includes(rawStatus) && !hasResultPayload) {
    return null;
  }
  for (const candidate of collectToolEventObjects(source)) {
    const artifact = normalizeNotebookDraftArtifact(candidate, { cleanText: defaultCleanText });
    if (artifact?.notebook) {
      return artifact;
    }
  }
  return null;
}

function extractSequenceEditProposalFromToolEvent(streamEvent = {}) {
  const source = streamEvent && typeof streamEvent === 'object' && !Array.isArray(streamEvent)
    ? streamEvent
    : {};
  const toolName = normalizeCodexToolName(source.tool_name || source.toolName, { cleanText: defaultCleanText });
  if (toolName !== 'sequence_edit') {
    return null;
  }
  for (const candidate of collectToolEventObjects(source)) {
    if (candidate?.pending_approval === true && candidate?.approvalToken) {
      return cloneJson(candidate, null);
    }
  }
  return null;
}

module.exports = {
  extractNotebookDraftArtifactFromToolEvent,
  extractProtocolGenerationArtifactFromToolEvent,
  extractSequenceEditProposalFromToolEvent
};
