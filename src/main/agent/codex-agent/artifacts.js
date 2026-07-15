'use strict';

const {
  asArray,
  cloneJson,
  defaultCleanText,
  ensureObject,
  parseJsonObjectFromText
} = require('./runtime-utils.js');
const { normalizeCodexToolName } = require('./payloads.js');

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

function normalizeProtocolGenerationArtifact(payload = {}, { cleanText = defaultCleanText } = {}) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const protocol = source.protocol && typeof source.protocol === 'object' && !Array.isArray(source.protocol)
    ? cloneJson(source.protocol, null)
    : null;
  if (!protocol || !Object.keys(protocol).length) {
    return null;
  }
  return {
    ok: source.ok !== false,
    status: cleanText(source.status, 80) || (source.save_requested === true ? 'awaiting_user_approval' : 'normalized'),
    mcp_tool: cleanText(source.mcp_tool || source.mcpTool, 120) || 'protocol_generation',
    app_tool: cleanText(source.app_tool || source.appTool, 120) || 'protocol-generation',
    summary: cleanText(source.summary || source.result_summary || source.resultSummary, 500),
    save_requested: source.save_requested === true || source.saveRequested === true || source.requires_user_approval === true,
    requires_user_approval: source.requires_user_approval === true || source.requiresUserApproval === true || source.save_requested === true,
    protocol
  };
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

function buildProtocolGenerationAggregate(artifacts = []) {
  const protocols = [];
  const seen = new Set();
  asArray(artifacts).forEach((artifact) => {
    const protocol = artifact?.protocol && typeof artifact.protocol === 'object' ? artifact.protocol : null;
    if (!protocol) {
      return;
    }
    const key = [
      defaultCleanText(protocol.id || protocol.protocol_id || protocol.protocolId, 220),
      defaultCleanText(protocol.name || protocol.title, 220),
      JSON.stringify(asArray(protocol.steps || protocol.procedure).slice(0, 3))
    ].join(':');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    protocols.push(cloneJson(protocol, null));
  });
  if (!protocols.length) {
    return null;
  }
  const lastArtifact = asArray(artifacts).filter(Boolean).at(-1) || {};
  const saveRequested = asArray(artifacts).some((artifact) => (
    artifact?.save_requested === true
    || artifact?.saveRequested === true
    || artifact?.requires_user_approval === true
    || artifact?.requiresUserApproval === true
  ));
  return {
    ok: true,
    status: saveRequested
      ? 'awaiting_user_approval'
      : (defaultCleanText(lastArtifact.status, 80) || 'normalized'),
    mcp_tool: 'protocol_generation',
    app_tool: 'protocol-generation',
    summary: defaultCleanText(lastArtifact.summary, 500),
    save_requested: saveRequested,
    requires_user_approval: saveRequested,
    protocol: protocols[0],
    protocols
  };
}

function textNamesDirectProtocolGenerationTool(rawText = '') {
  const text = String(rawText || '');
  return /\bmcp__[^_\s]+__protocol_generation\b/i.test(text)
    || /\bprotocol_generation\b/i.test(text);
}

function textRequestsProtocolSave(rawText = '') {
  return /\bsave\b\s*(?::|=)?\s*true\b/i.test(String(rawText || ''));
}

function protocolHasSteps(protocol = {}) {
  const source = protocol && typeof protocol === 'object' && !Array.isArray(protocol) ? protocol : {};
  return asArray(source.steps).length > 0 || asArray(source.procedure).length > 0;
}

function buildDirectProtocolGenerationFallbackArgs(rawMessage = '', { cleanText = defaultCleanText } = {}) {
  if (!textNamesDirectProtocolGenerationTool(rawMessage)) {
    return null;
  }
  const parsed = parseJsonObjectFromText(rawMessage);
  const source = ensureObject(parsed);
  const protocol = ensureObject(source.protocol);
  const candidateProtocol = Object.keys(protocol).length ? protocol : source;
  if (!protocolHasSteps(candidateProtocol)) {
    return null;
  }
  const args = {
    protocol: cloneJson(candidateProtocol, {})
  };
  const resultSummary = cleanText(source.result_summary || source.resultSummary || source.summary, 320);
  if (resultSummary) {
    args.result_summary = resultSummary;
  }
  if (source.save === true || textRequestsProtocolSave(rawMessage)) {
    args.save = true;
  }
  if (source.overwrite === true) {
    args.overwrite = true;
  }
  if (source.upsert === true) {
    args.upsert = true;
  }
  return args;
}

function looksLikeDirectToolMaterializationFailure(rawText = '') {
  const text = String(rawText || '').toLowerCase();
  if (!text) {
    return false;
  }
  return [
    /not exposed/,
    /not available/,
    /\bunavailable\b/,
    /not visible/,
    /not found/,
    /couldn['’]?t submit/,
    /could not submit/,
    /cannot submit/,
    /couldn['’]?t call/,
    /could not call/,
    /cannot call/,
    /unable to call/,
    /unable to submit/
  ].some((pattern) => pattern.test(text));
}

module.exports = {
  buildDirectProtocolGenerationFallbackArgs,
  buildProtocolGenerationAggregate,
  extractNotebookDraftArtifactFromToolEvent,
  extractProtocolGenerationArtifactFromToolEvent,
  looksLikeDirectToolMaterializationFailure,
  normalizeNotebookDraftArtifact,
  normalizeProtocolGenerationArtifact
};
