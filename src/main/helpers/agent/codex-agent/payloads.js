'use strict';

const {
  asArray,
  defaultCleanText,
  ensureObject,
  parseJsonObjectFromText
} = require('./runtime-utils.js');

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

module.exports = {
  buildAskUserPayloadFromArguments,
  extractAskUserPayloadFromToolEvent,
  normalizeCodexAgentPayload,
  normalizeCodexToolName,
  normalizeUserQuestion
};
