/**
 * Chat log helpers for creating and updating persisted agent chat sessions,
 * converting agent results into renderer-friendly assistant messages, and
 * maintaining a lightweight index of session summaries.
 */
'use strict';

// Node.js filesystem/path utilities used by the chat log runtime.
const fs = require('node:fs/promises');
const path = require('node:path');

// Storage constants shared by the index file and per-session log files.
const CHAT_LOG_FOLDER_NAME = 'chat_log';
const CHAT_LOG_INDEX_FILE_NAME = 'index.json';
const CHAT_LOG_EVENT_TYPES = Object.freeze({
  SESSION_CREATED: 'session-created',
  USER_MESSAGE: 'user-message',
  ASSISTANT_MESSAGE: 'assistant-message',
  AGENT_CHAT_REQUEST: 'agent-chat-request',
  AGENT_CHAT_RESULT: 'agent-chat-result',
  AGENT_CHAT_ERROR: 'agent-chat-error',
  AGENT_LIFECYCLE: 'agent-lifecycle',
  AGENT_LLM_TRACE: 'agent-llm-trace'
});

// Return the input only when it is already an array; otherwise fall back to an empty array.
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Normalize unknown input into a string without trimming or clipping chat fields.
function cleanText(value, _maxLength = 4000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

// Deep-clone JSON-safe values so stored payloads are detached from live objects.
function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

// Convert arbitrary session identifiers into safe file-name fragments.
function sanitizeFileName(value, fallback = 'chat-session') {
  const clean = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return clean || fallback;
}

// Generate a lightweight unique identifier for chat sessions and messages.
function createDefaultId() {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Use the first non-empty line of user text as a human-friendly session title.
function deriveSessionTitle(text, fallback = 'New Chat') {
  const firstLine = cleanText(String(text || '').split('\n').find((line) => String(line || '').trim()) || '', 120);
  return firstLine || fallback;
}

function normalizeSessionBrief(text, fallback = 'New Chat') {
  const normalized = cleanText(String(text || '').replace(/\s+/g, ' '), 160)
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!?;,:\s]+$/g, '')
    .trim();
  return normalized || fallback;
}

function slugText(value, fallback = 'option') {
  const normalized = cleanText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeAgentUserQuestion(value, fallbackQuestion = '') {
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
        id: cleanText(option.id || option.key, 120) || `${slugText(label)}-${index + 1}`,
        label,
        value: valueText,
        description: cleanText(option.description || option.detail || option.reason, 260)
      };
    })
    .filter(Boolean)
    .slice(0, 6);
  const answered = source.answered && typeof source.answered === 'object' && !Array.isArray(source.answered)
    ? {
      answer: cleanText(source.answered.answer || source.answered.value, 1000),
      answered_at: cleanText(source.answered.answered_at || source.answered.answeredAt, 80)
    }
    : null;
  return {
    id: cleanText(source.id || source.question_id || source.questionId, 120) || slugText(question, 'question'),
    question,
    context: cleanText(source.context || source.help_text || source.helpText, 700),
    options,
    allow_custom: source.allow_custom !== false && source.allowCustom !== false,
    placeholder: cleanText(source.placeholder || source.custom_placeholder || source.customPlaceholder, 160)
      || 'Type another answer',
    submit_label: cleanText(source.submit_label || source.submitLabel, 80) || 'Send answer',
    status: cleanText(source.status, 40),
    answered
  };
}

function extractCodexSessionId(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const meta = source.meta && typeof source.meta === 'object' && !Array.isArray(source.meta) ? source.meta : {};
  const codexAgent = source.codex_agent && typeof source.codex_agent === 'object' && !Array.isArray(source.codex_agent)
    ? source.codex_agent
    : (meta.codex_agent && typeof meta.codex_agent === 'object' && !Array.isArray(meta.codex_agent) ? meta.codex_agent : {});
  return cleanText(
    source.codex_session_id
      || source.codexSessionId
      || source.codexSessionID
      || meta.codex_session_id
      || meta.codexSessionId
      || codexAgent.codex_session_id
      || codexAgent.codexSessionId,
    240
  );
}

// Build a concise assistant-facing summary from inventory lookup results.
function summarizeInventoryLookup(lookup) {
  const payload = lookup && typeof lookup === 'object' ? lookup : {};
  const status = cleanText(payload.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ')
      || 'I need more details to run inventory lookup.';
  }
  const query = cleanText(payload.query, 220);
  const items = asArray(payload.items);
  if (status === 'matched' && items.length) {
    const previewLines = items
      .slice(0, 3)
      .map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const label = cleanText(source.name || source.id, 140);
        if (!label) {
          return '';
        }
        const details = [
          cleanText(source.location, 180) ? `location ${cleanText(source.location, 180)}` : '',
          cleanText(source.container_name, 180) ? `container ${cleanText(source.container_name, 180)}` : '',
          Number.isFinite(Number(source.well_index)) ? `well ${Number(source.well_index)}` : '',
          cleanText(source.quantity, 80)
            ? `${cleanText(source.kind, 40) === 'personal_sample' ? 'concentration' : 'quantity'} ${cleanText(source.quantity, 80)}`
            : '',
          cleanText(source.amount, 80) ? `amount ${cleanText(source.amount, 80)}` : '',
          cleanText(source.supplier, 160) ? `supplier ${cleanText(source.supplier, 160)}` : '',
          !cleanText(source.location, 180) && cleanText(source.zone, 120) ? `zone ${cleanText(source.zone, 120)}` : ''
        ].filter(Boolean).slice(0, 4);
        return `${index + 1}. ${label}${details.length ? ` (${details.join('; ')})` : ''}`;
      })
      .filter(Boolean);
    const extraCount = Math.max(0, items.length - previewLines.length);
    return [
      `Found ${items.length} inventory match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}.`,
      ...previewLines,
      extraCount ? `${extraCount} more match${extraCount === 1 ? '' : 'es'} not shown.` : ''
    ].filter(Boolean).join('\n');
  }
  if (status === 'no_match') {
    return `No inventory matches found${query ? ` for "${query}"` : ''}.`;
  }
  return '';
}

// Build a concise assistant-facing summary from notebook lookup results.
function summarizeNotebookLookup(lookup) {
  const payload = lookup && typeof lookup === 'object' ? lookup : {};
  const status = cleanText(payload.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ')
      || 'I need more details to run notebook lookup.';
  }
  const query = cleanText(payload.query, 220);
  const items = asArray(payload.items);
  if (status === 'matched' && items.length) {
    const previewLines = items
      .slice(0, 3)
      .map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const label = cleanText(source.title || source.id, 140);
        if (!label) {
          return '';
        }
        const recordType = cleanText(source.record_type, 40).replace(/_/g, ' ');
        const details = [
          cleanText(source.project_name, 180) ? `project ${cleanText(source.project_name, 180)}` : '',
          cleanText(source.linked_protocol_name, 180) ? `protocol ${cleanText(source.linked_protocol_name, 180)}` : '',
          cleanText(source.updated_at, 80) ? `updated ${cleanText(source.updated_at, 80)}` : ''
        ].filter(Boolean).slice(0, 3);
        return `${index + 1}. ${recordType ? `${recordType}: ` : ''}${label}${details.length ? ` (${details.join('; ')})` : ''}`;
      })
      .filter(Boolean);
    const extraCount = Math.max(0, items.length - previewLines.length);
    return [
      `Found ${items.length} notebook match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}.`,
      ...previewLines,
      extraCount ? `${extraCount} more match${extraCount === 1 ? '' : 'es'} not shown.` : ''
    ].filter(Boolean).join('\n');
  }
  if (status === 'no_match') {
    return `No notebook matches found${query ? ` for "${query}"` : ''}.`;
  }
  return '';
}

function summarizePurchaseRecommendation(purchaseRecommendation) {
  const payload = purchaseRecommendation && typeof purchaseRecommendation === 'object' ? purchaseRecommendation : {};
  const status = cleanText(payload.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can recommend something to buy.';
  }
  const query = cleanText(payload.query, 220);
  const items = asArray(payload.items);
  const requiredTerms = asArray(payload?.filters?.required_terms).map((item) => cleanText(item, 120)).filter(Boolean);
  const matchMode = cleanText(payload.match_mode, 20);
  if (status === 'matched' && items.length) {
    if (matchMode === 'partial') {
      return `Found ${items.length} likely product match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}, but I could not verify every requested attribute from the vendor pages.`;
    }
    return `Found ${items.length} purchase recommendation${items.length === 1 ? '' : 's'}${query ? ` for "${query}"` : ''}${requiredTerms.length ? ` matching ${requiredTerms.join(', ')}` : ''}.`;
  }
  if (status === 'no_match') {
    return `No purchase recommendations found${query ? ` for "${query}"` : ''}.`;
  }
  return '';
}

function summarizeCodexAgent(codexAgent) {
  const payload = codexAgent && typeof codexAgent === 'object' ? codexAgent : {};
  const status = cleanText(payload.status, 40);
  if (!status) {
    return '';
  }
  const explicitUserQuestion = payload.user_question || payload.userQuestion;
  const userQuestion = explicitUserQuestion
    ? normalizeAgentUserQuestion(explicitUserQuestion, '')
    : null;
  if (status === 'needs_more_info') {
    if (userQuestion?.question) {
      return userQuestion.question;
    }
    return asArray(payload.follow_up_questions).map((item) => cleanText(item, 500)).filter(Boolean).join(' ')
      || cleanText(payload.answer, 12000)
      || 'I need more detail before I can continue.';
  }
  return cleanText(payload.answer || payload.assistant_text, 12000);
}

function summarizeSkillCommand(skillCommand) {
  const payload = skillCommand && typeof skillCommand === 'object' ? skillCommand : {};
  if (!Object.keys(payload).length) {
    return '';
  }
  const summary = cleanText(payload.summary, 12000);
  const result = payload.result && typeof payload.result === 'object' ? payload.result : {};
  const output = cleanText(
    result.output
      || [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? '\n' : ''),
    12000
  );
  if (summary && output && !summary.includes(output)) {
    return `${summary}\n\n${output}`;
  }
  return summary || output;
}

// Extract the main answer or follow-up prompt from a science-question result payload.
function summarizeScienceResult(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const status = cleanText(source.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(source.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can continue.';
  }
  const answer = cleanText(source.answer, 12000);
  if (answer) {
    return answer;
  }
  return asArray(source.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ');
}

// Build a concise assistant-facing summary from notebook draft proposal results.
function summarizeNotebookDraft(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const status = cleanText(source.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(source.follow_up_questions).map((item) => cleanText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can plan the next notebook page.';
  }
  const proposal = source.proposal && typeof source.proposal === 'object' ? source.proposal : {};
  const title = cleanText(proposal.title, 220);
  const purpose = cleanText(proposal.purpose, 320);
  const protocolName = cleanText(source?.selected_protocol?.name, 220);
  if (status === 'proposal_ready') {
    return title && purpose
      ? `Planned notebook draft ready: ${title}. ${purpose}`
      : `Planned notebook draft ready${protocolName ? ` using protocol ${protocolName}` : ''}.`;
  }
  return '';
}

function summarizeProtocolGeneration(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const protocols = asArray(source.protocols).length
    ? asArray(source.protocols)
    : (source.protocol && typeof source.protocol === 'object' ? [source.protocol] : []);
  if (!protocols.length) {
    return '';
  }
  const names = protocols.map((protocol) => cleanText(protocol?.name || protocol?.title, 160)).filter(Boolean);
  const prefix = protocols.length === 1
    ? `Generated protocol ready${names[0] ? `: ${names[0]}` : ''}.`
    : `Generated ${protocols.length} protocols${names.length ? `: ${names.slice(0, 3).join(', ')}` : ''}.`;
  return `${prefix} Review it before adding it to Protocol Module.`;
}

function extractStructuredThinkingTrace(result) {
  const payload = result && typeof result === 'object' ? result : {};
  const candidates = [
    payload.thinking_trace,
    payload.general_science_question?.thinking_trace,
    payload.project_science_question?.thinking_trace,
    payload.result_analysis?.thinking_trace
  ];
  const match = candidates.find((candidate) => (
    candidate
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
  ));
  return match ? cloneJson(match, null) : null;
}

function ensureThinkingTraceMeta(meta) {
  const payload = meta && typeof meta === 'object' ? cloneJson(meta, {}) : {};
  if (payload.thinking_trace && typeof payload.thinking_trace === 'object' && !Array.isArray(payload.thinking_trace)) {
    return payload;
  }
  payload.thinking_trace = extractStructuredThinkingTrace(payload);
  return payload;
}

// Preserve structured agent output in assistant message metadata for later UI use.
function buildAssistantMetaFromResult(result, requestText = '') {
  const payload = result && typeof result === 'object' ? result : {};
  const protocolWorkflow = payload.protocol_to_notebook && typeof payload.protocol_to_notebook === 'object'
    ? payload.protocol_to_notebook
    : null;
  const notebookDraftWorkflow = payload.notebook_draft && typeof payload.notebook_draft === 'object'
    ? payload.notebook_draft
    : null;
  const protocolGeneration = payload.protocol_generation && typeof payload.protocol_generation === 'object'
    ? payload.protocol_generation
    : null;
  const notebookPayload = protocolWorkflow?.notebook && typeof protocolWorkflow.notebook === 'object'
    ? protocolWorkflow.notebook
    : (notebookDraftWorkflow?.notebook && typeof notebookDraftWorkflow.notebook === 'object'
      ? notebookDraftWorkflow.notebook
      : (payload.notebookDraft && typeof payload.notebookDraft === 'object' ? payload.notebookDraft : null));
  const explicitUserQuestion = payload.user_question
    || payload.userQuestion
    || payload.codex_agent?.user_question
    || payload.codex_agent?.userQuestion;
  const codexStatus = cleanText(payload.codex_agent?.status, 40);
  const keepUserQuestion = Boolean(
    explicitUserQuestion
    && (
      codexStatus === 'needs_more_info'
      || codexStatus === 'needs_user_answer'
      || (!payload.codex_agent && payload.parser?.needs_clarification === true)
    )
  );
  return {
    parser: payload.parser && typeof payload.parser === 'object' ? cloneJson(payload.parser, {}) : {},
    codex_session_id: extractCodexSessionId(payload),
    protocol_to_notebook: protocolWorkflow ? cloneJson(protocolWorkflow, null) : null,
    notebook_draft: notebookDraftWorkflow ? cloneJson(notebookDraftWorkflow, null) : null,
    protocol_generation: protocolGeneration ? cloneJson(protocolGeneration, null) : null,
    codex_agent: payload.codex_agent && typeof payload.codex_agent === 'object'
      ? cloneJson(payload.codex_agent, null)
      : null,
    user_question: keepUserQuestion
      ? normalizeAgentUserQuestion(explicitUserQuestion, '')
      : null,
    purchase_recommendation: payload.purchase_recommendation && typeof payload.purchase_recommendation === 'object'
      ? cloneJson(payload.purchase_recommendation, null)
      : null,
    skill_command: payload.skill_command && typeof payload.skill_command === 'object'
      ? cloneJson(payload.skill_command, null)
      : null,
    inventory_lookup: payload.inventory_lookup && typeof payload.inventory_lookup === 'object'
      ? cloneJson(payload.inventory_lookup, null)
      : null,
    notebook_lookup: payload.notebook_lookup && typeof payload.notebook_lookup === 'object'
      ? cloneJson(payload.notebook_lookup, null)
      : null,
    general_science_question: payload.general_science_question && typeof payload.general_science_question === 'object'
      ? cloneJson(payload.general_science_question, null)
      : null,
    project_science_question: payload.project_science_question && typeof payload.project_science_question === 'object'
      ? cloneJson(payload.project_science_question, null)
      : null,
    result_analysis: payload.result_analysis && typeof payload.result_analysis === 'object'
      ? cloneJson(payload.result_analysis, null)
      : null,
    thinking_trace: extractStructuredThinkingTrace(payload),
    notebookDraft: notebookPayload ? cloneJson(notebookPayload, null) : null,
    developer_trace: cloneJson(asArray(payload.developer_trace), []),
    requestText: cleanText(requestText, 3000)
  };
}

// Convert the agent's structured result into the plain assistant text shown in chat.
function buildAssistantTextFromResult(result) {
  const payload = result && typeof result === 'object' ? result : {};
  // Pull the major optional result sections into local variables for easier branching below.
  const protocolWorkflow = payload.protocol_to_notebook && typeof payload.protocol_to_notebook === 'object'
    ? payload.protocol_to_notebook
    : null;
  const notebookDraftWorkflow = payload.notebook_draft && typeof payload.notebook_draft === 'object'
    ? payload.notebook_draft
    : null;
  const protocolGeneration = payload.protocol_generation && typeof payload.protocol_generation === 'object'
    ? payload.protocol_generation
    : null;
  const parser = payload.parser && typeof payload.parser === 'object' ? payload.parser : {};
  const inventoryLookup = payload.inventory_lookup && typeof payload.inventory_lookup === 'object'
    ? payload.inventory_lookup
    : null;
  const notebookLookup = payload.notebook_lookup && typeof payload.notebook_lookup === 'object'
    ? payload.notebook_lookup
    : null;
  const purchaseRecommendation = payload.purchase_recommendation && typeof payload.purchase_recommendation === 'object'
    ? payload.purchase_recommendation
    : null;
  const codexAgent = payload.codex_agent && typeof payload.codex_agent === 'object'
    ? payload.codex_agent
    : null;
  const skillCommand = payload.skill_command && typeof payload.skill_command === 'object'
    ? payload.skill_command
    : null;
  const generalScienceQuestion = payload.general_science_question && typeof payload.general_science_question === 'object'
    ? payload.general_science_question
    : null;
  const projectScienceQuestion = payload.project_science_question && typeof payload.project_science_question === 'object'
    ? payload.project_science_question
    : null;
  const resultAnalysis = payload.result_analysis && typeof payload.result_analysis === 'object'
    ? payload.result_analysis
    : null;
  const protocolStatus = cleanText(protocolWorkflow?.status, 40);
  const followUpQuestions = asArray(protocolWorkflow?.follow_up_questions).map((item) => cleanText(item, 320)).filter(Boolean);
  const completedNotebookText = cleanText(
    protocolWorkflow?.notebook?.entry_template?.result
      || protocolWorkflow?.notebook?.save?.reason
      || '',
    12000
  );
  const inventorySummaryText = summarizeInventoryLookup(inventoryLookup);
  const notebookSummaryText = summarizeNotebookLookup(notebookLookup);
  const purchaseRecommendationText = summarizePurchaseRecommendation(purchaseRecommendation);
  const codexAgentText = summarizeCodexAgent(codexAgent);
  const skillCommandText = summarizeSkillCommand(skillCommand);
  const notebookDraftText = summarizeNotebookDraft(notebookDraftWorkflow);
  const protocolGenerationText = summarizeProtocolGeneration(protocolGeneration);
  const scienceAnswerText = summarizeScienceResult(generalScienceQuestion)
    || summarizeScienceResult(projectScienceQuestion)
    || summarizeScienceResult(resultAnalysis);
  if (notebookDraftText) {
    return notebookDraftText;
  }
  if (protocolGenerationText) {
    return protocolGenerationText;
  }
  if (codexAgentText) {
    return codexAgentText;
  }
  // Prefer notebook completion text when a protocol-to-notebook workflow succeeded.
  if (protocolStatus === 'completed') {
    return completedNotebookText
      || `Notebook draft completed using protocol ${cleanText(protocolWorkflow?.selected_protocol?.name, 220) || 'selection'}.`;
  }
  // Surface follow-up questions when the workflow cannot continue without more user input.
  if (protocolStatus === 'needs_more_info') {
    return followUpQuestions.join(' ') || 'More details are needed to fill the remaining notebook placeholders.';
  }
  // Otherwise fall back through science answers, lookup summaries, parser reasoning, and a generic default.
  return scienceAnswerText
    || skillCommandText
    || purchaseRecommendationText
    || inventorySummaryText
    || notebookSummaryText
    || cleanText(parser.reasoning_summary, 12000)
    || 'Intent parsing completed.';
}

// Create a normalized assistant chat message from a successful agent response payload.
function buildAssistantMessageFromResult({ result, requestText = '', messageId = '', timestamp = '' } = {}) {
  const createdAt = cleanText(timestamp, 80) || new Date().toISOString();
  return {
    id: cleanText(messageId, 120) || createDefaultId(),
    role: 'assistant',
    text: buildAssistantTextFromResult(result),
    createdAt,
    meta: buildAssistantMetaFromResult(result, requestText)
  };
}

// Create a normalized assistant chat message representing an agent failure.
function buildAssistantMessageFromError({ errorMessage = '', requestText = '', messageId = '', timestamp = '' } = {}) {
  const createdAt = cleanText(timestamp, 80) || new Date().toISOString();
  const message = cleanText(errorMessage, 1200) || 'Unknown error';
  return {
    id: cleanText(messageId, 120) || createDefaultId(),
    role: 'assistant',
    text: `Agent failed: ${message}`,
    createdAt,
    meta: {
      parser: {
        primary_intent: 'unclear',
        reasoning_effort: 0,
        direct_answer: null,
        needs_clarification: true,
        clarification_reason: 'agent_error',
        entities: {},
        inventory_search: {
          normalized_query: null,
          candidate_terms: [],
          aliases: [],
          search_mode: null
        },
        protocol_candidates: [],
        reasoning_summary: `Agent failed: ${message}`
      },
      protocol_to_notebook: null,
      notebook_draft: null,
      protocol_generation: null,
      codex_agent: null,
      purchase_recommendation: null,
      inventory_lookup: null,
      notebook_lookup: null,
      general_science_question: null,
      project_science_question: null,
      result_analysis: null,
      thinking_trace: null,
      notebookDraft: null,
      developer_trace: [],
      requestText: cleanText(requestText, 3000)
    }
  };
}

function buildAssistantMessageFromCancellation({ message = '', requestText = '', messageId = '', timestamp = '' } = {}) {
  const createdAt = cleanText(timestamp, 80) || new Date().toISOString();
  const stopMessage = cleanText(message, 1200) || 'Agent request stopped.';
  return {
    id: cleanText(messageId, 120) || createDefaultId(),
    role: 'assistant',
    text: 'Agent stopped.',
    createdAt,
    meta: {
      cancellation: {
        stopped: true,
        message: stopMessage
      },
      thinking_trace: null,
      requestText: cleanText(requestText, 3000)
    }
  };
}

// Normalize one chat-session summary entry as stored in the index file.
function normalizeSessionSummary(rawSummary = {}) {
  const source = rawSummary && typeof rawSummary === 'object' ? rawSummary : {};
  const id = cleanText(source.id || source.session_id || source.sessionId, 120);
  if (!id) {
    return null;
  }
  return {
    id,
    title: cleanText(source.title, 220) || 'New Chat',
    project_id: cleanText(source.project_id || source.projectId, 120),
    project_name: cleanText(source.project_name || source.projectName, 220),
    log_file: cleanText(source.log_file || source.logFile, 240) || `${sanitizeFileName(id)}.log`,
    created_at: cleanText(source.created_at || source.createdAt, 80),
    updated_at: cleanText(source.updated_at || source.updatedAt, 80),
    codex_session_id: extractCodexSessionId(source),
    status: cleanText(source.status, 40) || 'ready',
    message_count: Math.max(0, Number(source.message_count) || 0),
    request_count: Math.max(0, Number(source.request_count) || 0),
    last_message_preview: cleanText(source.last_message_preview, 320),
    last_user_message_preview: cleanText(source.last_user_message_preview, 320),
    response_type: cleanText(source.response_type, 80),
    last_request_id: cleanText(source.last_request_id, 120),
    last_error: cleanText(source.last_error, 400)
  };
}

function normalizeTransformStatus(rawStatus = {}) {
  const source = rawStatus && typeof rawStatus === 'object' ? rawStatus : {};
  const sourceFile = cleanText(source.source_file || source.sourceFile, 240);
  if (!sourceFile) {
    return null;
  }
  return {
    source_file: sourceFile,
    output_file: cleanText(source.output_file || source.outputFile, 400),
    status: cleanText(source.status, 40) || 'pending',
    source_mtime_ms: Number.isFinite(Number(source.source_mtime_ms ?? source.sourceMtimeMs))
      ? Number(source.source_mtime_ms ?? source.sourceMtimeMs)
      : 0,
    source_size: Math.max(0, Number(source.source_size ?? source.sourceSize) || 0),
    source_line_count: Math.max(0, Number(source.source_line_count ?? source.sourceLineCount) || 0),
    trace_count: Math.max(0, Number(source.trace_count ?? source.traceCount) || 0),
    transformed_at: cleanText(source.transformed_at || source.transformedAt, 80),
    error: cleanText(source.error, 2400)
  };
}

function normalizeTransformIndex(rawTransforms = {}) {
  const source = rawTransforms && typeof rawTransforms === 'object' ? rawTransforms : {};
  const filesSource = source.files && typeof source.files === 'object' ? source.files : {};
  const files = {};
  Object.entries(filesSource).forEach(([key, value]) => {
    const normalized = normalizeTransformStatus({
      ...(value && typeof value === 'object' ? value : {}),
      source_file: cleanText(
        value?.source_file || value?.sourceFile || key,
        240
      )
    });
    if (normalized?.source_file) {
      files[normalized.source_file] = normalized;
    }
  });
  return {
    updated_at: cleanText(source.updated_at || source.updatedAt, 80),
    output_folder: cleanText(source.output_folder || source.outputFolder, 120) || 'transformed',
    files
  };
}

function mergeTransformIndexes(primaryTransforms = {}, fallbackTransforms = {}) {
  const primary = normalizeTransformIndex(primaryTransforms);
  const fallback = normalizeTransformIndex(fallbackTransforms);
  return normalizeTransformIndex({
    updated_at: primary.updated_at || fallback.updated_at,
    output_folder: primary.output_folder || fallback.output_folder,
    files: {
      ...fallback.files,
      ...primary.files
    }
  });
}

// Normalize the overall chat index payload loaded from disk.
function normalizeIndexPayload(rawIndex = {}) {
  const source = rawIndex && typeof rawIndex === 'object' ? rawIndex : {};
  return {
    version: 1,
    updated_at: cleanText(source.updated_at || source.updatedAt, 80),
    sessions: asArray(source.sessions).map((item) => normalizeSessionSummary(item)).filter(Boolean),
    transforms: normalizeTransformIndex(source.transforms)
  };
}

// Normalize one log row so event processing can rely on consistent field names.
function normalizeSessionRow(rawRow = {}) {
  const source = rawRow && typeof rawRow === 'object' ? rawRow : {};
  const type = cleanText(source.type, 80);
  const sessionId = cleanText(source.session_id || source.sessionId, 120);
  const timestamp = cleanText(source.timestamp || source.createdAt || source.created_at, 80) || new Date().toISOString();
  if (!type || !sessionId) {
    return null;
  }
  const row = {
    ...cloneJson(source, {}),
    type,
    session_id: sessionId,
    timestamp
  };
  delete row.sessionId;
  return row;
}

// Convert a renderer-style chat message object into a persisted session log row.
function buildMessageRow(message, sessionId) {
  const source = message && typeof message === 'object' ? message : {};
  const role = source.role === 'assistant' ? 'assistant' : 'user';
  return normalizeSessionRow({
    type: role === 'assistant' ? CHAT_LOG_EVENT_TYPES.ASSISTANT_MESSAGE : CHAT_LOG_EVENT_TYPES.USER_MESSAGE,
    session_id: sessionId,
    message_id: cleanText(source.id || source.message_id || source.messageId, 120) || createDefaultId(),
    timestamp: cleanText(source.createdAt || source.timestamp, 80) || new Date().toISOString(),
    text: cleanText(source.text, 24000),
    meta: role === 'assistant' ? cloneJson(source.meta, null) : undefined
  });
}

// Update an in-memory session summary using one appended log entry.
function applyEntryToSummary(summary, entry) {
  const next = normalizeSessionSummary(summary) || null;
  const row = normalizeSessionRow(entry);
  if (!next || !row) {
    return next;
  }
  next.updated_at = row.timestamp;
  // Session creation establishes the initial title/project metadata and resets the status.
  if (row.type === CHAT_LOG_EVENT_TYPES.SESSION_CREATED) {
    next.status = 'ready';
    next.project_id = cleanText(row.project_id || next.project_id, 120) || next.project_id;
    next.project_name = cleanText(row.project_name || next.project_name, 220) || next.project_name;
    next.title = cleanText(row.title, 220) || next.title;
    next.codex_session_id = extractCodexSessionId(row) || next.codex_session_id;
    return next;
  }

  // User messages advance message counters and can rename untitled sessions.
  if (row.type === CHAT_LOG_EVENT_TYPES.USER_MESSAGE) {
    const text = cleanText(row.text, 320);
    next.message_count += 1;
    next.last_message_preview = text;
    next.last_user_message_preview = text;
    next.status = 'active';
    if (!cleanText(next.title, 40) || next.title === 'New Chat') {
      next.title = deriveSessionTitle(text, next.title || 'New Chat');
    }
    return next;
  }

  // Assistant replies update the latest preview and clear any previous error marker.
  if (row.type === CHAT_LOG_EVENT_TYPES.ASSISTANT_MESSAGE) {
    next.message_count += 1;
    next.last_message_preview = cleanText(row.text, 320);
    next.status = 'active';
    next.last_error = '';
    next.codex_session_id = extractCodexSessionId(row) || next.codex_session_id;
    return next;
  }

  // Request events track how many agent calls were made and which project they belonged to.
  if (row.type === CHAT_LOG_EVENT_TYPES.AGENT_CHAT_REQUEST) {
    next.request_count += 1;
    next.last_request_id = cleanText(row.requestId, 120) || next.last_request_id;
    next.project_id = cleanText(row.projectId || row.project_id || next.project_id, 120) || next.project_id;
    next.project_name = cleanText(row.projectName || row.project_name || next.project_name, 220) || next.project_name;
    return next;
  }

  // Result events record the latest response type and clear stale errors.
  if (row.type === CHAT_LOG_EVENT_TYPES.AGENT_CHAT_RESULT) {
    next.response_type = cleanText(row.response_type || row.responseType, 80);
    next.codex_session_id = extractCodexSessionId(row) || next.codex_session_id;
    next.last_error = '';
    return next;
  }

  // Error events preserve the latest failure summary for the session list.
  if (row.type === CHAT_LOG_EVENT_TYPES.AGENT_CHAT_ERROR) {
    next.last_error = cleanText(row.error, 400);
    return next;
  }

  return next;
}

// Reconstruct renderer-facing chat messages from persisted session log rows.
function buildRendererMessages(rows) {
  return asArray(rows).reduce((messages, row) => {
    const entry = normalizeSessionRow(row);
    if (!entry) {
      return messages;
    }
    if (entry.type === CHAT_LOG_EVENT_TYPES.USER_MESSAGE) {
      messages.push({
        id: cleanText(entry.message_id, 120) || createDefaultId(),
        role: 'user',
        text: cleanText(entry.text, 24000),
        createdAt: entry.timestamp
      });
      return messages;
    }
    if (entry.type === CHAT_LOG_EVENT_TYPES.ASSISTANT_MESSAGE) {
      messages.push({
        id: cleanText(entry.message_id, 120) || createDefaultId(),
        role: 'assistant',
        text: cleanText(entry.text, 24000),
        createdAt: entry.timestamp,
        meta: ensureThinkingTraceMeta(entry.meta)
      });
    }
    return messages;
  }, []);
}

// Sort sessions by most recently updated so the newest chats appear first.
function sortSessions(sessions) {
  return asArray(sessions)
    .slice()
    .sort((left, right) => {
      const leftTime = Date.parse(left?.updated_at || left?.created_at || '') || 0;
      const rightTime = Date.parse(right?.updated_at || right?.created_at || '') || 0;
      return rightTime - leftTime;
    });
}

// Create a filesystem-backed runtime for chat session creation, reads, and appends.
function createAgentChatLogRuntime(deps = {}) {
  // Allow filesystem utilities and clock/id helpers to be injected for testing.
  const runtimeFs = deps.fs || fs;
  const runtimePath = deps.path || path;
  const now = typeof deps.now === 'function'
    ? deps.now
    : (() => new Date().toISOString());
  const createId = typeof deps.createId === 'function'
    ? deps.createId
    : createDefaultId;
  const requestAssistantText = typeof deps.requestAssistantText === 'function'
    ? deps.requestAssistantText
    : null;

  async function summarizeFirstUserMessageAsTitle({
    message = '',
    llm = {},
    projectId = '',
    projectName = ''
  } = {}) {
    const prompt = cleanText(message, 6000);
    const fallback = deriveSessionTitle(prompt, 'New Chat');
    if (!prompt || !requestAssistantText) {
      return fallback;
    }
    const provider = cleanText(llm?.provider, 80);
    const endpoint = cleanText(llm?.apiEndpoint || llm?.endpoint, 2400);
    const apiKey = cleanText(llm?.apiKey, 2400);
    const model = cleanText(llm?.model, 160);
    if ((!provider && !endpoint) || !model || !apiKey) {
      return fallback;
    }
    const result = await requestAssistantText({
      source: { provider, endpoint, apiKey, model },
      stage: 'agent_chat_session_brief',
      defaultError: 'Session brief provider is not configured.',
      systemPrompt: [
        'You create short chat sidebar labels.',
        'Summarize the first user message into one brief plain-text label.',
        'Use 3 to 8 words when possible.',
        'Keep concrete nouns and task intent.',
        'No quotes, no markdown, no ending punctuation.'
      ].join(' '),
      userPrompt: [
        projectName ? `Project: ${cleanText(projectName, 220)}` : '',
        projectId && !projectName ? `Project ID: ${cleanText(projectId, 120)}` : '',
        `First user message: ${prompt}`,
        'Return only the label.'
      ].filter(Boolean).join('\n')
    });
    if (result?.ok !== true) {
      return fallback;
    }
    return normalizeSessionBrief(result.text, fallback);
  }

  // Resolve the base storage path plus the chat-log folder and index file locations.
  function resolvePaths(storagePath) {
    const resolvedStoragePath = runtimePath.resolve(cleanText(storagePath, 2400));
    if (!resolvedStoragePath) {
      throw new Error('Missing storage path.');
    }
    const chatLogPath = runtimePath.join(resolvedStoragePath, CHAT_LOG_FOLDER_NAME);
    return {
      storagePath: resolvedStoragePath,
      chatLogPath,
      indexPath: runtimePath.join(chatLogPath, CHAT_LOG_INDEX_FILE_NAME)
    };
  }

  // Create the chat-log folder on demand before any reads or writes.
  async function ensureChatLogRoot(storagePath) {
    const paths = resolvePaths(storagePath);
    await runtimeFs.mkdir(paths.chatLogPath, { recursive: true });
    return paths;
  }

  // Read and normalize the session index, treating a missing file as an empty index.
  async function readIndex(storagePath) {
    const paths = await ensureChatLogRoot(storagePath);
    try {
      const raw = await runtimeFs.readFile(paths.indexPath, 'utf8');
      return {
        paths,
        index: normalizeIndexPayload(JSON.parse(raw))
      };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          paths,
          index: normalizeIndexPayload({})
        };
      }
      throw error;
    }
  }

  // Persist the normalized index back to disk after session metadata changes.
  async function writeIndex(paths, index) {
    let existingTransforms = normalizeTransformIndex({});
    try {
      const existingRaw = await runtimeFs.readFile(paths.indexPath, 'utf8');
      existingTransforms = normalizeIndexPayload(JSON.parse(existingRaw)).transforms;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
    const normalized = normalizeIndexPayload({
      ...index,
      transforms: mergeTransformIndexes(index?.transforms, existingTransforms)
    });
    normalized.updated_at = cleanText(normalized.updated_at, 80) || now();
    await runtimeFs.mkdir(paths.chatLogPath, { recursive: true });
    await runtimeFs.writeFile(paths.indexPath, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
  }

  // Append one or more normalized rows to a session log and refresh the summary index.
  async function appendRows(storagePath, sessionId, rows = [], options = {}) {
    const filteredRows = asArray(rows).map((row) => normalizeSessionRow(row)).filter(Boolean);
    if (!filteredRows.length) {
      const existing = await getSession({ storagePath, sessionId });
      return {
        ok: true,
        session: existing.session,
        appended_count: 0
      };
    }
    const { paths, index } = await readIndex(storagePath);
    const normalizedSessionId = cleanText(sessionId, 120);
    if (!normalizedSessionId) {
      throw new Error('sessionId is required.');
    }
    let session = index.sessions.find((item) => item.id === normalizedSessionId) || null;
    if (!session) {
      session = normalizeSessionSummary({
        id: normalizedSessionId,
        title: 'New Chat',
        project_id: cleanText(filteredRows[0]?.project_id || filteredRows[0]?.projectId, 120),
        project_name: cleanText(filteredRows[0]?.project_name || filteredRows[0]?.projectName, 220),
        created_at: filteredRows[0]?.timestamp || now(),
        updated_at: filteredRows[0]?.timestamp || now(),
        log_file: `${sanitizeFileName(normalizedSessionId)}.log`
      });
      index.sessions.push(session);
    }

    const logPath = runtimePath.join(paths.chatLogPath, session.log_file);
    const titleWasUntitled = !cleanText(session?.title, 40) || session.title === 'New Chat';
    const payload = filteredRows.map((row) => JSON.stringify(row)).join('\n');
    await runtimeFs.appendFile(logPath, `${payload}\n`, 'utf8');
    filteredRows.forEach((row) => {
      session = applyEntryToSummary(session, row);
    });
    if (titleWasUntitled) {
      const firstUserRow = filteredRows.find((row) => row.type === CHAT_LOG_EVENT_TYPES.USER_MESSAGE && cleanText(row.text, 24000));
      if (firstUserRow) {
        session.title = await summarizeFirstUserMessageAsTitle({
          message: firstUserRow.text,
          llm: options?.llm && typeof options.llm === 'object' ? options.llm : {},
          projectId: cleanText(options?.projectId || firstUserRow?.project_id || firstUserRow?.projectId, 120),
          projectName: cleanText(options?.projectName || firstUserRow?.project_name || firstUserRow?.projectName, 220)
        });
      }
    }
    index.sessions = sortSessions(index.sessions.map((item) => item.id === session.id ? session : item));
    await writeIndex(paths, index);
    return {
      ok: true,
      session
    };
  }

  // Create a brand-new session summary and seed its log with a creation event.
  async function createSession(input = {}) {
    const storagePath = cleanText(input.storagePath || input.storage_path, 2400);
    const title = cleanText(input.title, 220) || 'New Chat';
    const projectId = cleanText(input.projectId || input.project_id, 120);
    const projectName = cleanText(input.projectName || input.project_name, 220);
    const sessionId = cleanText(input.sessionId || input.session_id, 120) || createId();
    const timestamp = cleanText(input.created_at || input.createdAt, 80) || now();
    const { paths, index } = await readIndex(storagePath);
    const existing = index.sessions.find((item) => item.id === sessionId);
    if (existing) {
      return {
        ok: true,
        session: existing
      };
    }
    const session = normalizeSessionSummary({
      id: sessionId,
      title,
      project_id: projectId,
      project_name: projectName,
      codex_session_id: input.codex_session_id || input.codexSessionId,
      log_file: `${sanitizeFileName(sessionId)}.log`,
      created_at: timestamp,
      updated_at: timestamp,
      status: 'ready',
      message_count: 0,
      request_count: 0
    });
    index.sessions = sortSessions([session, ...index.sessions]);
    await writeIndex(paths, index);
    await appendRows(storagePath, session.id, [{
      type: CHAT_LOG_EVENT_TYPES.SESSION_CREATED,
      session_id: session.id,
      timestamp,
      title: session.title,
      project_id: session.project_id,
      project_name: session.project_name
    }]);
    return {
      ok: true,
      session
    };
  }

  // Reuse an existing session when possible, otherwise create one from the provided input.
  async function ensureSession(input = {}) {
    const storagePath = cleanText(input.storagePath || input.storage_path, 2400);
    const sessionId = cleanText(input.sessionId || input.session_id, 120);
    if (!sessionId) {
      return createSession(input);
    }
    const { index } = await readIndex(storagePath);
    const existing = index.sessions.find((item) => item.id === sessionId);
    if (existing) {
      return {
        ok: true,
        session: existing
      };
    }
    return createSession({
      ...input,
      sessionId
    });
  }

  // Return the most recent chat sessions for sidebar or picker views.
  async function listSessions(input = {}) {
    const storagePath = cleanText(input.storagePath || input.storage_path, 2400);
    const limit = Math.max(1, Number(input.limit) || 100);
    const { index } = await readIndex(storagePath);
    return {
      ok: true,
      items: sortSessions(index.sessions).slice(0, limit)
    };
  }

  // Load and normalize all persisted rows for a single session log file.
  async function readSessionRows(input = {}) {
    const storagePath = cleanText(input.storagePath || input.storage_path, 2400);
    const sessionId = cleanText(input.sessionId || input.session_id, 120);
    if (!sessionId) {
      throw new Error('sessionId is required.');
    }
    const { paths, index } = await readIndex(storagePath);
    const session = index.sessions.find((item) => item.id === sessionId);
    if (!session) {
      return {
        session: null,
        rows: []
      };
    }
    const logPath = runtimePath.join(paths.chatLogPath, session.log_file);
    try {
      const raw = await runtimeFs.readFile(logPath, 'utf8');
      const rows = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return normalizeSessionRow(JSON.parse(line));
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      return {
        session,
        rows
      };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          session,
          rows: []
        };
      }
      throw error;
    }
  }

  // Return one session summary together with its reconstructed chat messages.
  async function getSession(input = {}) {
    const storagePath = cleanText(input.storagePath || input.storage_path, 2400);
    const sessionId = cleanText(input.sessionId || input.session_id, 120);
    if (!sessionId) {
      throw new Error('sessionId is required.');
    }
    const includeRows = input.include_rows === true || input.includeRows === true;
    const { session, rows } = await readSessionRows({
      storagePath,
      sessionId
    });
    if (!session) {
      return {
        ok: false,
        error: 'Chat session not found.'
      };
    }
    return {
      ok: true,
      session,
      messages: buildRendererMessages(rows),
      rows: includeRows ? rows : undefined
    };
  }

  // Normalize and append a user-authored chat message into the session log.
  async function appendUserMessage(input = {}) {
    const sessionId = cleanText(input.sessionId || input.session_id, 120);
    const message = {
      id: cleanText(input.messageId || input.message_id, 120) || createId(),
      role: 'user',
      text: cleanText(input.text || input.message, 24000),
      createdAt: cleanText(input.createdAt || input.timestamp, 80) || now()
    };
    const row = buildMessageRow(message, sessionId);
    if (row) {
      row.project_id = cleanText(input.projectId || input.project_id, 120);
      row.project_name = cleanText(input.projectName || input.project_name, 220);
    }
    return appendRows(input.storagePath || input.storage_path, sessionId, [row], {
      llm: input?.llm && typeof input.llm === 'object' ? input.llm : {},
      projectId: cleanText(input.projectId || input.project_id, 120),
      projectName: cleanText(input.projectName || input.project_name, 220)
    });
  }

  // Normalize and append an assistant-authored chat message into the session log.
  async function appendAssistantMessage(input = {}) {
    const sessionId = cleanText(input.sessionId || input.session_id, 120);
    const message = input.message && typeof input.message === 'object'
      ? input.message
      : {
        id: cleanText(input.messageId || input.message_id, 120) || createId(),
        role: 'assistant',
        text: cleanText(input.text || input.message_text, 24000),
        createdAt: cleanText(input.createdAt || input.timestamp, 80) || now(),
        meta: cloneJson(input.meta, {})
      };
    return appendRows(input.storagePath || input.storage_path, sessionId, [buildMessageRow(message, sessionId)]);
  }

  // Expose the runtime helpers used by the rest of the agent/chat layer.
  return {
    CHAT_LOG_FOLDER_NAME,
    CHAT_LOG_INDEX_FILE_NAME,
    CHAT_LOG_EVENT_TYPES,
    buildAssistantMetaFromResult,
    buildAssistantTextFromResult,
    buildAssistantMessageFromResult,
    buildAssistantMessageFromCancellation,
    buildAssistantMessageFromError,
    buildRendererMessages,
    ensureChatLogRoot,
    createSession,
    ensureSession,
    listSessions,
    getSession,
    readSessionRows,
    appendRows,
    appendUserMessage,
    appendAssistantMessage
  };
}

// Public module export exposing constants plus the chat-log runtime factory.
module.exports = {
  CHAT_LOG_FOLDER_NAME,
  CHAT_LOG_INDEX_FILE_NAME,
  CHAT_LOG_EVENT_TYPES,
  createAgentChatLogRuntime
};
