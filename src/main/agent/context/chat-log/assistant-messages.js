'use strict';

const { asArray, cloneJson } = require('../../../lib/normalize.js');
const { cleanText, createDefaultId } = require('./text-utils.js');
const { normalizeAgentUserQuestion } = require('./agent-questions.js');
const { extractCodexSessionId } = require('./codex-session.js');
const {
  summarizeInventoryLookup,
  summarizeNotebookLookup,
  summarizePurchaseRecommendation,
  summarizeCodexAgent,
  summarizeSkillCommand,
  summarizeScienceResult,
  summarizeNotebookDraft,
  summarizeNotebookAppend,
  summarizeProtocolGeneration,
  extractStructuredThinkingTrace
} = require('./result-summaries.js');

// Preserve structured agent output in assistant message metadata for later UI use.
function buildAssistantMetaFromResult(result, requestText = '') {
  const payload = result && typeof result === 'object' ? result : {};
  const protocolWorkflow = payload.protocol_to_notebook && typeof payload.protocol_to_notebook === 'object'
    ? payload.protocol_to_notebook
    : null;
  const notebookDraftWorkflow = payload.notebook_draft && typeof payload.notebook_draft === 'object'
    ? payload.notebook_draft
    : null;
  const notebookAppendWorkflow = payload.notebook_append && typeof payload.notebook_append === 'object'
    ? payload.notebook_append
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
  const codexStatus = cleanText(payload.codex_agent?.status);
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
    notebook_append: notebookAppendWorkflow ? cloneJson(notebookAppendWorkflow, null) : null,
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
    notebookDrafts: cloneJson(payload.notebookDrafts || notebookDraftWorkflow?.notebooks || (notebookPayload ? [notebookPayload] : []), []),
    notebookAppend: notebookAppendWorkflow ? cloneJson(notebookAppendWorkflow, null) : null,
    requestText: cleanText(requestText)
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
  const notebookAppendWorkflow = payload.notebook_append && typeof payload.notebook_append === 'object'
    ? payload.notebook_append
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
  const protocolStatus = cleanText(protocolWorkflow?.status);
  const followUpQuestions = asArray(protocolWorkflow?.follow_up_questions).map((item) => cleanText(item)).filter(Boolean);
  const completedNotebookText = cleanText(
    protocolWorkflow?.notebook?.entry_template?.result
      || protocolWorkflow?.notebook?.save?.reason
      || '');
  const inventorySummaryText = summarizeInventoryLookup(inventoryLookup);
  const notebookSummaryText = summarizeNotebookLookup(notebookLookup);
  const purchaseRecommendationText = summarizePurchaseRecommendation(purchaseRecommendation);
  const codexAgentText = summarizeCodexAgent(codexAgent);
  const skillCommandText = summarizeSkillCommand(skillCommand);
  const notebookDraftText = summarizeNotebookDraft(notebookDraftWorkflow);
  const notebookAppendText = summarizeNotebookAppend(notebookAppendWorkflow);
  const protocolGenerationText = summarizeProtocolGeneration(protocolGeneration);
  const scienceAnswerText = summarizeScienceResult(generalScienceQuestion)
    || summarizeScienceResult(projectScienceQuestion)
    || summarizeScienceResult(resultAnalysis);
  if (notebookAppendText) {
    return notebookAppendText;
  }
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
      || `Notebook draft completed using protocol ${cleanText(protocolWorkflow?.selected_protocol?.name) || 'selection'}.`;
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
    || cleanText(parser.reasoning_summary)
    || 'Intent parsing completed.';
}

// Create a normalized assistant chat message from a successful agent response payload.
function buildAssistantMessageFromResult({ result, requestText = '', messageId = '', timestamp = '' } = {}) {
  const createdAt = cleanText(timestamp) || new Date().toISOString();
  return {
    id: cleanText(messageId) || createDefaultId(),
    role: 'assistant',
    text: buildAssistantTextFromResult(result),
    createdAt,
    meta: buildAssistantMetaFromResult(result, requestText)
  };
}

// Create a normalized assistant chat message representing an agent failure.
function buildAssistantMessageFromError({ errorMessage = '', requestText = '', messageId = '', timestamp = '' } = {}) {
  const createdAt = cleanText(timestamp) || new Date().toISOString();
  const message = cleanText(errorMessage) || 'Unknown error';
  return {
    id: cleanText(messageId) || createDefaultId(),
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
          candidate_terms: []
        },
        protocol_candidates: [],
        reasoning_summary: `Agent failed: ${message}`
      },
      protocol_to_notebook: null,
      notebook_draft: null,
      notebook_append: null,
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
      notebookAppend: null,
      requestText: cleanText(requestText)
    }
  };
}

function buildAssistantMessageFromCancellation({ message = '', requestText = '', messageId = '', timestamp = '' } = {}) {
  const createdAt = cleanText(timestamp) || new Date().toISOString();
  const stopMessage = cleanText(message) || 'Agent request stopped.';
  return {
    id: cleanText(messageId) || createDefaultId(),
    role: 'assistant',
    text: 'Agent stopped.',
    createdAt,
    meta: {
      cancellation: {
        stopped: true,
        message: stopMessage
      },
      thinking_trace: null,
      requestText: cleanText(requestText)
    }
  };
}

module.exports = {
  buildAssistantMetaFromResult,
  buildAssistantTextFromResult,
  buildAssistantMessageFromResult,
  buildAssistantMessageFromError,
  buildAssistantMessageFromCancellation
};
