'use strict';

const {
  asArray,
  buildReadOnlyToolAnnotations,
  cleanText,
  compactObject,
  ensureObject
} = require('./shared.js');

const ASK_USER_MCP_TOOL = Object.freeze({
  name: 'ask_user',
  description: 'Prepare one blocking user clarification question with suggested options and optional custom text input for Hikari to render.',
  annotations: buildReadOnlyToolAnnotations('Ask user clarification'),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['question', 'options'],
    properties: {
      question: { type: 'string', minLength: 1 },
      context: { type: 'string' },
      options: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          anyOf: [
            { type: 'string' },
            {
              type: 'object',
              additionalProperties: false,
              required: ['label'],
              properties: {
                id: { type: 'string' },
                label: { type: 'string', minLength: 1 },
                value: { type: 'string' },
                description: { type: 'string' }
              }
            }
          ]
        }
      },
      allow_custom: { type: 'boolean' },
      placeholder: { type: 'string' },
      submit_label: { type: 'string' }
    }
  }
});

function slugText(value = '', fallback = 'option') {
  const normalized = cleanText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeQuestionOption(option, index = 0) {
  const source = option && typeof option === 'object' && !Array.isArray(option)
    ? option
    : { label: option };
  const label = cleanText(source.label || source.title || source.text || source.value, 160);
  const value = cleanText(source.value || source.answer || label, 1000);
  if (!label || !value) {
    return null;
  }
  return compactObject({
    id: cleanText(source.id || source.key, 120) || `${slugText(label)}-${index + 1}`,
    label,
    value,
    description: cleanText(source.description || source.detail || source.reason, 260)
  });
}

function normalizeAskUserQuestion(input = {}) {
  const source = ensureObject(input);
  const question = cleanText(source.question || source.prompt || source.title, 600);
  const options = asArray(source.options || source.choices)
    .map((option, index) => normalizeQuestionOption(option, index))
    .filter(Boolean)
    .slice(0, 6);
  if (!question || !options.length) {
    return null;
  }
  return compactObject({
    id: cleanText(source.id || source.question_id || source.questionId, 120) || slugText(question, 'question'),
    question,
    context: cleanText(source.context || source.help_text || source.helpText, 700),
    options,
    allow_custom: source.allow_custom !== false && source.allowCustom !== false,
    placeholder: cleanText(source.placeholder || source.custom_placeholder || source.customPlaceholder, 160)
      || 'Type another answer',
    submit_label: cleanText(source.submit_label || source.submitLabel, 80) || 'Send answer'
  });
}

async function callAskUser(input = {}) {
  const question = normalizeAskUserQuestion(input);
  if (!question) {
    return {
      ok: false,
      status: 'invalid_arguments',
      mcp_tool: ASK_USER_MCP_TOOL.name,
      error: 'ask_user requires a question and at least one answer option.'
    };
  }
  return {
    ok: true,
    status: 'needs_user_answer',
    mcp_tool: ASK_USER_MCP_TOOL.name,
    user_question: question,
    final_response: {
      status: 'needs_more_info',
      assistant_text: question.question,
      follow_up_questions: [question.question],
      user_question: question,
      reasoning_summary: 'Waiting for the user to answer this blocking clarification.',
      citations: []
    },
    summary: 'Return the final_response JSON as the Codex answer so Hikari can render the question and collect the user answer.'
  };
}

module.exports = {
  ASK_USER_MCP_TOOL,
  callAskUser,
  normalizeAskUserQuestion
};
