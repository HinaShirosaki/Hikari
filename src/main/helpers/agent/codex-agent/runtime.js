'use strict';

const path = require('node:path');
const { throwIfAgentRequestAborted } = require('../shared/agent-request-context.js');
const { callProtocolGeneration } = require('../mcp-contract/direct-tools/protocol-generation.js');

function defaultCleanText(value, _maxLength = 2000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function isFilesystemRoot(directoryPath = '') {
  const text = String(directoryPath || '').trim();
  if (!text) {
    return false;
  }
  try {
    const resolved = path.resolve(text);
    return resolved === path.parse(resolved).root;
  } catch {
    return false;
  }
}

function parseJsonObjectFromText(raw = '') {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function normalizeCitation(cleanText, citation = {}) {
  const source = citation && typeof citation === 'object' ? citation : {};
  return {
    source: cleanText(source.source || source.tool || source.type, 120),
    pointer: cleanText(source.pointer || source.url || source.title || source.id, 320),
    reason: cleanText(source.reason || source.summary, 500)
  };
}

function normalizeCodexToolName(rawToolName = '', { cleanText = defaultCleanText } = {}) {
  return cleanText(rawToolName, 180).trim()
    .replace(/^mcp__[^_]+__/, '')
    .replace(/^hikari__/, '')
    .replace(/^enana__/, '');
}

function slugText(cleanText, value = '', fallback = 'option') {
  const normalized = cleanText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeUserQuestion(cleanText, value = {}, fallbackQuestion = '') {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const question = cleanText(
    source.question
      || source.prompt
      || source.title
      || fallbackQuestion,
    600
  );
  if (!question) {
    return null;
  }
  const options = asArray(source.options || source.choices)
    .map((item, index) => {
      const option = item && typeof item === 'object' && !Array.isArray(item)
        ? item
        : { label: item };
      const label = cleanText(option.label || option.title || option.text || option.value, 160);
      const valueText = cleanText(option.value || option.answer || label, 1000);
      if (!label || !valueText) {
        return null;
      }
      return {
        id: cleanText(option.id || option.key, 120) || `${slugText(cleanText, label)}-${index + 1}`,
        label,
        value: valueText,
        description: cleanText(option.description || option.detail || option.reason, 260)
      };
    })
    .filter(Boolean)
    .slice(0, 6);
  return {
    id: cleanText(source.id || source.question_id || source.questionId, 120) || slugText(cleanText, question, 'question'),
    question,
    context: cleanText(source.context || source.help_text || source.helpText, 700),
    options,
    allow_custom: source.allow_custom !== false && source.allowCustom !== false,
    placeholder: cleanText(source.placeholder || source.custom_placeholder || source.customPlaceholder, 160)
      || 'Type another answer',
    submit_label: cleanText(source.submit_label || source.submitLabel, 80) || 'Send answer'
  };
}

function normalizeCodexAgentPayload(rawPayload = {}, rawText = '', { cleanText = defaultCleanText } = {}) {
  const rawSource = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const finalResponse = ensureObject(rawSource.final_response || rawSource.finalResponse);
  const source = Object.keys(finalResponse).length ? finalResponse : rawSource;
  const followUps = asArray(source.follow_up_questions || source.followUpQuestions)
    .map((item) => cleanText(item, 500))
    .filter(Boolean)
    .slice(0, 6);
  const answer = cleanText(
    source.assistant_text
      || source.assistantText
      || source.answer
      || source.message
      || rawText,
    120000
  );
  const userQuestionSource = source.user_question
    || source.userQuestion
    || source.ask_user
    || source.askUser;
  const userQuestion = userQuestionSource
    ? normalizeUserQuestion(cleanText, userQuestionSource, followUps[0] || '')
    : null;
  const rawStatus = cleanText(source.status, 40);
  const status = rawStatus === 'needs_user_answer'
    ? 'needs_more_info'
    : rawStatus
    || (userQuestion ? 'needs_more_info' : 'completed');
  const keepClarification = status === 'needs_more_info';
  const reasoningSummary = cleanText(
    source.reasoning_summary
      || source.reasoningSummary
      || source.summary,
    4000
  );
  return {
    status,
    answer,
    follow_up_questions: keepClarification
      ? (followUps.length ? followUps : (userQuestion?.question ? [userQuestion.question] : []))
      : followUps,
    user_question: keepClarification ? userQuestion : null,
    reasoning_summary: reasoningSummary,
    citations: asArray(source.citations)
      .map((citation) => normalizeCitation(cleanText, citation))
      .filter((citation) => citation.source || citation.pointer || citation.reason)
      .slice(0, 12)
  };
}

function buildAskUserPayloadFromArguments(args = {}, { cleanText = defaultCleanText } = {}) {
  const source = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const userQuestion = normalizeUserQuestion(cleanText, source, '');
  if (!userQuestion?.question) {
    return null;
  }
  return {
    status: 'needs_more_info',
    answer: userQuestion.question,
    follow_up_questions: [userQuestion.question],
    user_question: userQuestion,
    reasoning_summary: 'Waiting for the user to answer this blocking clarification.',
    citations: []
  };
}

function extractAskUserPayloadFromToolEvent(streamEvent = {}) {
  const source = streamEvent && typeof streamEvent === 'object' && !Array.isArray(streamEvent)
    ? streamEvent
    : {};
  const toolName = normalizeCodexToolName(source.tool_name || source.toolName, { cleanText: defaultCleanText });
  if (toolName !== 'ask_user') {
    return null;
  }
  const objectCandidates = [
    source.arguments,
    source.args,
    source.tool_result,
    source.toolResult,
    source.tool_output,
    source.toolOutput,
    source.result,
    source.output
  ].filter((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
  for (const candidate of objectCandidates) {
    const payload = normalizeCodexAgentPayload(candidate, '', { cleanText: defaultCleanText });
    if (payload.status === 'needs_more_info' && payload.user_question?.question) {
      return payload;
    }
    const argumentPayload = buildAskUserPayloadFromArguments(candidate, { cleanText: defaultCleanText });
    if (argumentPayload?.user_question?.question) {
      return argumentPayload;
    }
  }
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
  for (const candidate of textCandidates) {
    const parsed = parseJsonObjectFromText(candidate);
    if (!parsed) {
      continue;
    }
    const payload = normalizeCodexAgentPayload(parsed, '', { cleanText: defaultCleanText });
    if (payload.status === 'needs_more_info' && payload.user_question?.question) {
      return payload;
    }
    const argumentPayload = buildAskUserPayloadFromArguments(parsed, { cleanText: defaultCleanText });
    if (argumentPayload?.user_question?.question) {
      return argumentPayload;
    }
  }
  return null;
}

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
  return /(?:\bsave\b|\bpersist\b|\bsave_to_protocol_module\b|\bsaveToProtocolModule\b)\s*(?::|=)?\s*true\b/i.test(String(rawText || ''));
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
  if (
    source.save === true
    || source.persist === true
    || source.save_to_protocol_module === true
    || source.saveToProtocolModule === true
    || textRequestsProtocolSave(rawMessage)
  ) {
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

function summarizeAttachments(cleanText, attachments = []) {
  return asArray(attachments)
    .map((attachment, index) => {
      const source = attachment && typeof attachment === 'object' ? attachment : {};
      const name = cleanText(source.name, 240) || `attachment-${index + 1}`;
      const kind = cleanText(source.kind, 40);
      const mimeType = cleanText(source.mimeType || source.mime_type, 160);
      const size = Number.isFinite(Number(source.size)) ? Number(source.size) : 0;
      return `- ${name}${kind ? ` (${kind})` : ''}${mimeType ? ` ${mimeType}` : ''}${size ? ` ${size} bytes` : ''}`;
    })
    .join('\n');
}

function buildCodexAgentPrompt(input = {}, { cleanText = defaultCleanText } = {}) {
  const message = cleanText(input.message, 24000);
  const attachmentText = summarizeAttachments(cleanText, input.attachments);
  const projectId = cleanText(input.projectId, 120);
  const projectName = cleanText(input.projectName, 220);
  const selectionInsight = ensureObject(input.selectionInsight);
  const blocks = [
    '# Hikari Codex Chat Turn',
    '',
    'You are handling this Hikari chat turn as the Codex reasoning agent. Own the lifecycle yourself: manage context in this Codex session, clarify if necessary, discover and call Hikari MCP tools, verify the inference, and synthesize the final user-facing answer.',
    '',
    'AGENTS.md in this workspace contains the durable Hikari Codex agent contract. Follow it together with the request details below.',
    '',
    'Hikari provides rendering and the MCP server. Do not depend on Hikari to replay chat history, choose tools, parse intent, or synthesize for you. Use your Codex session context for continuity and return normal assistant prose for Hikari to render.',
    '',
    'Use the MCP server named `hikari` for Hikari app data, papers, protocols, notebooks, inventory, memory, and structured tool access. Hikari exposes app tools as direct MCP tools such as `mcp__hikari__literature_search`, `mcp__hikari__paper_download`, and `mcp__hikari__protocol_generation`; do not route through `tool_search`, `tool_info`, or generic `tool_call`. Use native Codex search or the Hikari `web_search` tool for external web evidence. Live thinking, progress, and tool activity are emitted by the Codex CLI stream.',
    '',
    'Native Codex `tool_search` is disabled for this run. If a named `mcp__hikari__...` function is not visible, report that the direct Hikari MCP surface is unavailable for that tool. Do not use shell commands or MCP resource reads as a substitute for a named direct tool call.',
    '',
    projectId || projectName
      ? `Selected project:\n${JSON.stringify({ id: projectId, name: projectName }, null, 2)}`
      : 'Selected project: none',
    '',
    selectionInsight.actionType || selectionInsight.selectedText
      ? `Selection insight context:\n${JSON.stringify(selectionInsight, null, 2)}`
      : '',
    attachmentText ? `Attachments supplied by Hikari:\n${attachmentText}` : '',
    '',
    `Current user request:\n${message}`
  ];
  return blocks.filter((block) => cleanText(block, 1) || block === '').join('\n\n').trim();
}

function buildCodexAgentParserPayload(codexAgent = {}, {
  projectId = '',
  projectName = '',
  reasoningEffort = 0,
  cleanText = defaultCleanText
} = {}) {
  const needsClarification = cleanText(codexAgent.status, 40) === 'needs_more_info'
    || Boolean(codexAgent.user_question?.question);
  return {
    primary_intent: 'codex_agent',
    reasoning_effort: Number.isFinite(Number(reasoningEffort)) ? Number(reasoningEffort) : 0,
    direct_answer: needsClarification ? null : cleanText(codexAgent.answer, 12000) || null,
    needs_clarification: needsClarification,
    clarification_reason: needsClarification
      ? cleanText(codexAgent.user_question?.question || codexAgent.follow_up_questions?.[0] || codexAgent.answer, 500) || 'codex_agent_needs_more_info'
      : null,
    entities: {
      project_id: cleanText(projectId, 120),
      project_name: cleanText(projectName, 220)
    },
    inventory_search: {
      normalized_query: null,
      candidate_terms: [],
      aliases: [],
      search_mode: null
    },
    protocol_candidates: [],
    reasoning_summary: cleanText(codexAgent.reasoning_summary, 1200)
      || 'Handled by the Codex-owned agent lifecycle.'
  };
}

function buildCodexMcpContext(input = {}, { cleanText = defaultCleanText } = {}) {
  const snapshot = ensureObject(input.snapshot);
  const dataFilePath = cleanText(
    input.dataFilePath
      || input.data_file_path
      || snapshot?.data_file_path
      || snapshot?.dataFilePath,
    2000
  );
  const fallbackDataFilePath = cleanText(
    input.fallbackDataFilePath
      || input.fallback_data_file_path
      || dataFilePath,
    2000
  );
  return {
    provider: 'codex',
    model: cleanText(input.model, 120),
    cwd: cleanText(input.cwd, 1200),
    chatSessionId: cleanText(input.chatSessionId || input.chat_session_id, 120),
    codexSessionId: cleanText(input.codexSessionId || input.codex_session_id, 240),
    message: cleanText(input.message, 3200),
    conversation: [],
    project: {
      id: cleanText(input.projectId, 120),
      name: cleanText(input.projectName, 220)
    },
    projectId: cleanText(input.projectId, 120),
    projectName: cleanText(input.projectName, 220),
    dataFilePath,
    fallbackDataFilePath,
    traceRequestId: cleanText(input.traceContext?.requestId, 120)
  };
}

function createCodexAgentRuntime(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const requestCodexAgentText = typeof deps.requestCodexAgentText === 'function'
    ? deps.requestCodexAgentText
    : null;
  const recordAgentLlmTrace = typeof deps.recordAgentLlmTrace === 'function'
    ? deps.recordAgentLlmTrace
    : (async () => {});
  const recordLifecycleEvent = typeof deps.recordLifecycleEvent === 'function'
    ? deps.recordLifecycleEvent
    : (() => {});
  const getWorkingDirectory = typeof deps.getWorkingDirectory === 'function'
    ? deps.getWorkingDirectory
    : (() => process.cwd());
  const runTool = typeof deps.runTool === 'function'
    ? deps.runTool
    : null;

  async function run(input = {}) {
    if (!requestCodexAgentText) {
      return {
        ok: false,
        provider: 'codex',
        model: cleanText(input.model, 120),
        error: 'Codex agent runtime is not configured.'
      };
    }
    const inputCwd = cleanText(input.cwd, 2400);
    const fallbackCwd = cleanText(getWorkingDirectory(), 2400);
    const cwd = inputCwd && !isFilesystemRoot(inputCwd)
      ? inputCwd
      : (fallbackCwd || inputCwd || process.cwd());
    const prompt = buildCodexAgentPrompt(input, { cleanText });
    const traceContext = input.traceContext || null;
    const lifecycleRecorder = input.lifecycleRecorder || null;
    const emitAgentProgress = typeof input.emitAgentProgress === 'function'
      ? input.emitAgentProgress
      : null;
    const model = cleanText(input.model, 120);
    const reasoningEffort = cleanText(input.reasoningEffort, 40);
    const resumeSessionId = cleanText(input.codexSessionId || input.codex_session_id, 240);
    let lastStreamText = '';
    let streamedAskUserPayload = null;
    let streamedNotebookDraftPayload = null;
    const streamedProtocolGenerationPayloads = [];

    function publishCodexProgress(progressEvent = {}) {
      const recorded = recordLifecycleEvent(lifecycleRecorder, progressEvent);
      if (!recorded && emitAgentProgress) {
        emitAgentProgress(progressEvent);
      }
    }

    function emitStreamProgress(streamEvent = {}, { force = false } = {}) {
      const eventType = cleanText(streamEvent.type || streamEvent.event_type || streamEvent.eventType, 120);
      if (eventType === 'codex_tool_call') {
        const askUserPayload = extractAskUserPayloadFromToolEvent(streamEvent);
        if (askUserPayload?.user_question?.question) {
          streamedAskUserPayload = askUserPayload;
        }
        const notebookDraftArtifact = extractNotebookDraftArtifactFromToolEvent(streamEvent);
        if (notebookDraftArtifact?.notebook) {
          streamedNotebookDraftPayload = notebookDraftArtifact;
        }
        const protocolGenerationArtifact = extractProtocolGenerationArtifactFromToolEvent(streamEvent);
        if (protocolGenerationArtifact?.protocol) {
          streamedProtocolGenerationPayloads.push(protocolGenerationArtifact);
        }
      }
      if (eventType === 'codex_cli_display') {
        const displayText = cleanText(
          streamEvent.display_text
            || streamEvent.displayText
            || streamEvent.text
            || streamEvent.message,
          4000
        );
        if (!displayText) {
          return;
        }
        publishCodexProgress({
          stage: 'codex_cli_display',
          status: cleanText(streamEvent.status, 40) || 'streaming',
          routing_intent: 'codex_agent',
          tool_name: cleanText(streamEvent.tool_name || streamEvent.toolName, 160),
          message: displayText,
          meta: {
            codex_display_text: displayText,
            codex_display_kind: cleanText(streamEvent.display_kind || streamEvent.displayKind, 80),
            codex_display_stream: cleanText(streamEvent.display_stream || streamEvent.displayStream, 40),
            codex_event_type: cleanText(streamEvent.event_type || streamEvent.eventType, 120)
          }
        });
        return;
      }
      if (!emitAgentProgress) {
        return;
      }
      if (eventType === 'codex_thinking') {
        const thinkingText = cleanText(
          streamEvent.thinking_text
            || streamEvent.thinkingText
            || streamEvent.text
            || streamEvent.message,
          4000
        );
        if (!thinkingText) {
          return;
        }
        emitAgentProgress({
          stage: 'codex_agent_thinking',
          status: 'streaming',
          routing_intent: 'codex_agent',
          message: thinkingText,
          meta: {
            thinking_trace: thinkingText,
            codex_event_type: cleanText(streamEvent.event_type || streamEvent.eventType, 120)
          }
        });
        return;
      }
      if (eventType === 'codex_tool_call') {
        const toolName = cleanText(streamEvent.tool_name || streamEvent.toolName, 160) || 'codex-tool';
        const toolCallText = cleanText(
          streamEvent.tool_call_text
            || streamEvent.toolCallText
            || streamEvent.text
            || streamEvent.message
            || toolName,
          2400
        );
        const rawStatus = cleanText(streamEvent.status, 40);
        const status = rawStatus === 'failed' || rawStatus === 'error'
          ? 'failed'
          : (rawStatus === 'completed' || rawStatus === 'done' || rawStatus === 'ok' ? 'completed' : 'started');
        emitAgentProgress({
          stage: status === 'failed'
            ? 'tool_call_failed'
            : (status === 'completed' ? 'tool_call_completed' : 'tool_call_started'),
          status,
          routing_intent: 'codex_agent',
          tool_name: toolName,
          message: toolCallText,
          meta: {
            tool_call_text: toolCallText,
            thinking_trace: toolCallText,
            codex_event_type: cleanText(streamEvent.event_type || streamEvent.eventType, 120)
          }
        });
        return;
      }
      const streamText = cleanText(
        streamEvent.accumulated_text
          || streamEvent.accumulatedText
          || streamEvent.text
          || lastStreamText,
        120000
      );
      if (!streamText || (!force && streamText === lastStreamText)) {
        return;
      }
      lastStreamText = streamText;
      emitAgentProgress({
        stage: 'codex_agent_stream',
        status: 'streaming',
        routing_intent: 'codex_agent',
        message: streamText,
        meta: {
          stream_text: streamText,
          text_delta: cleanText(streamEvent.text_delta || streamEvent.textDelta, 120000),
          event_type: cleanText(streamEvent.event_type || streamEvent.eventType, 120)
        }
      });
    }

    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'codex_agent_started',
      status: 'started',
      routing_intent: 'codex_agent',
      message: 'Starting Codex-owned agent lifecycle.'
    });
    await recordAgentLlmTrace(traceContext, {
      stage: 'codex_agent_runtime',
      provider: 'codex',
      model,
      summary: 'Started Codex-owned agent lifecycle.',
      request_payload: {
        model,
        reasoning_effort: reasoningEffort,
        prompt,
        attachments: asArray(input.attachments).map((attachment) => ({
          name: cleanText(attachment?.name, 240),
          kind: cleanText(attachment?.kind, 40),
          data: '[omitted]'
        }))
      }
    });

    throwIfAgentRequestAborted('Agent request stopped before starting Codex agent.');
    const mcpContextJson = JSON.stringify(buildCodexMcpContext({
      ...input,
      cwd,
      model
    }, { cleanText }));
    const codexTextResult = await requestCodexAgentText({
      prompt,
      model,
      reasoningEffort,
      cwd,
      enableWebSearch: true,
      disableToolSearch: true,
      attachments: asArray(input.attachments),
      stream: true,
      onStream: emitStreamProgress,
      resumeSessionId,
      returnMetadata: true,
      envOverrides: {
        HIKARI_AGENT_MCP_REQUEST_CONTEXT: mcpContextJson,
        ENANA_AGENT_MCP_REQUEST_CONTEXT: mcpContextJson,
        HIKARI_CODEX_REQUEST_CONTEXT: mcpContextJson,
        ENANA_CODEX_REQUEST_CONTEXT: mcpContextJson
      }
    });
    throwIfAgentRequestAborted('Agent request stopped after Codex agent completed.');

    const rawText = typeof codexTextResult === 'string'
      ? codexTextResult
      : cleanText(codexTextResult?.text, 120000);
    const codexMetadata = codexTextResult && typeof codexTextResult === 'object' && !Array.isArray(codexTextResult)
      ? ensureObject(codexTextResult.metadata)
      : {};
    const codexSessionId = cleanText(
      codexMetadata.session_id
        || codexMetadata.sessionId
        || codexMetadata.resumed_session_id
        || codexMetadata.resumedSessionId
        || resumeSessionId,
      240
    );
    const parsed = parseJsonObjectFromText(rawText);
    if (lastStreamText) {
      emitStreamProgress({ accumulated_text: lastStreamText }, { force: true });
    }
    const codexAgent = normalizeCodexAgentPayload(parsed || {}, rawText, { cleanText });
    if (
      streamedAskUserPayload?.user_question?.question
      && codexAgent.status !== 'needs_more_info'
    ) {
      codexAgent.status = 'needs_more_info';
      codexAgent.answer = cleanText(streamedAskUserPayload.answer || streamedAskUserPayload.user_question.question, 120000);
      codexAgent.follow_up_questions = asArray(streamedAskUserPayload.follow_up_questions).length
        ? streamedAskUserPayload.follow_up_questions
        : [streamedAskUserPayload.user_question.question];
      codexAgent.user_question = streamedAskUserPayload.user_question;
      codexAgent.reasoning_summary = cleanText(
        streamedAskUserPayload.reasoning_summary,
        4000
      ) || 'Waiting for the user to answer this blocking clarification.';
      codexAgent.citations = asArray(streamedAskUserPayload.citations);
    }
    codexAgent.codex_session_id = codexSessionId;
    codexAgent.resumed_codex_session_id = cleanText(
      codexMetadata.resumed_session_id || codexMetadata.resumedSessionId || resumeSessionId,
      240
    );
    let protocolGenerationArtifact = buildProtocolGenerationAggregate(streamedProtocolGenerationPayloads);
    if (!protocolGenerationArtifact && runTool && codexAgent.status !== 'needs_more_info') {
      const fallbackArgs = buildDirectProtocolGenerationFallbackArgs(input.message, { cleanText });
      if (fallbackArgs && looksLikeDirectToolMaterializationFailure(`${rawText}\n${codexAgent.answer}`)) {
        recordLifecycleEvent(lifecycleRecorder, {
          stage: 'codex_agent_direct_tool_fallback',
          status: 'started',
          routing_intent: 'codex_agent',
          tool_name: 'protocol_generation',
          message: 'Recovering direct protocol_generation call after Codex could not materialize the named MCP tool.'
        });
        try {
          const directToolContext = {
            ...buildCodexMcpContext({ ...input, cwd, model }, { cleanText }),
            snapshot: ensureObject(input.snapshot),
            traceContext,
            lifecycleRecorder
          };
          const fallbackResult = await callProtocolGeneration(fallbackArgs, directToolContext, { runTool });
          const fallbackArtifact = normalizeProtocolGenerationArtifact(fallbackResult, { cleanText });
          if (fallbackArtifact?.protocol) {
            streamedProtocolGenerationPayloads.push(fallbackArtifact);
            protocolGenerationArtifact = buildProtocolGenerationAggregate(streamedProtocolGenerationPayloads);
            codexAgent.status = 'completed';
            codexAgent.answer = fallbackArtifact.save_requested || fallbackArtifact.requires_user_approval
              ? 'The protocol is ready for review.'
              : (cleanText(codexAgent.answer, 120000) || 'The protocol was normalized.');
            codexAgent.follow_up_questions = [];
            codexAgent.user_question = null;
            codexAgent.reasoning_summary = 'Recovered by directly executing the named Hikari protocol_generation tool after Codex could not materialize it.';
            recordLifecycleEvent(lifecycleRecorder, {
              stage: 'codex_agent_direct_tool_fallback',
              status: 'ok',
              routing_intent: 'codex_agent',
              tool_name: 'protocol_generation',
              message: cleanText(fallbackArtifact.summary, 320) || 'Direct protocol_generation fallback completed.',
              meta: {
                save_requested: fallbackArtifact.save_requested === true,
                protocol_name: cleanText(fallbackArtifact.protocol?.name || fallbackArtifact.protocol?.title, 220)
              }
            });
          } else {
            recordLifecycleEvent(lifecycleRecorder, {
              stage: 'codex_agent_direct_tool_fallback',
              status: 'failed',
              routing_intent: 'codex_agent',
              tool_name: 'protocol_generation',
              message: cleanText(fallbackResult?.error || fallbackResult?.status, 320)
                || 'Direct protocol_generation fallback did not return a protocol.'
            });
          }
        } catch (error) {
          recordLifecycleEvent(lifecycleRecorder, {
            stage: 'codex_agent_direct_tool_fallback',
            status: 'failed',
            routing_intent: 'codex_agent',
            tool_name: 'protocol_generation',
            message: cleanText(error?.message, 320) || 'Direct protocol_generation fallback failed.'
          });
        }
      }
    }
    const parser = buildCodexAgentParserPayload(codexAgent, {
      projectId: input.projectId,
      projectName: input.projectName,
      reasoningEffort,
      cleanText
    });
    await recordAgentLlmTrace(traceContext, {
      stage: 'codex_agent_completed',
      provider: 'codex',
      model,
      summary: 'Codex-owned agent lifecycle completed.',
      response_payload: parsed || rawText,
      metadata: {
        codex_session_id: codexSessionId,
        resumed_codex_session_id: cleanText(codexAgent.resumed_codex_session_id, 240),
        command: cleanText(codexMetadata.command, 80)
      }
    });
    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'codex_agent_completed',
      status: 'ok',
      routing_intent: 'codex_agent',
      message: cleanText(codexAgent.reasoning_summary || codexAgent.answer, 320)
        || 'Codex-owned agent lifecycle completed.',
      meta: {
        status: codexAgent.status,
        citation_count: asArray(codexAgent.citations).length,
        codex_session_id: codexSessionId,
        resumed_codex_session_id: cleanText(codexAgent.resumed_codex_session_id, 240)
      }
    });

    return {
      ok: true,
      provider: 'codex',
      model,
      codex_session_id: codexSessionId,
      resumed_codex_session_id: cleanText(codexAgent.resumed_codex_session_id, 240),
      parser,
      codex_agent: codexAgent,
      ...(streamedNotebookDraftPayload
        ? {
          notebook_draft: streamedNotebookDraftPayload,
          notebookDraft: streamedNotebookDraftPayload.notebook
        }
        : {}),
      ...(protocolGenerationArtifact ? { protocol_generation: protocolGenerationArtifact } : {}),
      thinking_trace: {
        intent_parse_question: 'Codex owned this request without Hikari parser dispatch.',
        final_synthesize: cleanText(codexAgent.reasoning_summary, 1000)
          || 'Codex synthesized the final response from the evidence it gathered.'
      }
    };
  }

  return {
    run,
    buildPrompt: (input = {}) => buildCodexAgentPrompt(input, { cleanText }),
    parseJsonObjectFromText: (raw = '') => parseJsonObjectFromText(raw),
    normalizePayload: (payload = {}, rawText = '') => normalizeCodexAgentPayload(payload, rawText, { cleanText })
  };
}

module.exports = {
  buildCodexAgentPrompt,
  buildCodexAgentParserPayload,
  buildCodexMcpContext,
  createCodexAgentRuntime,
  normalizeCodexAgentPayload,
  parseJsonObjectFromText
};
