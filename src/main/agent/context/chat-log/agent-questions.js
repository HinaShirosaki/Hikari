'use strict';

const { asArray } = require('../../../lib/normalize.js');
const { cleanText, slugText } = require('./text-utils.js');

function normalizeAgentUserQuestion(value, fallbackQuestion = '') {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const question = cleanText(
    source.question
      || source.prompt
      || source.title
      || fallbackQuestion);
  if (!question) {
    return null;
  }
  const options = asArray(source.options || source.choices)
    .map((item, index) => {
      const option = item && typeof item === 'object' && !Array.isArray(item)
        ? item
        : { label: item };
      const label = cleanText(option.label || option.title || option.text || option.value);
      const valueText = cleanText(option.value || option.answer || label);
      if (!label || !valueText) {
        return null;
      }
      return {
        id: cleanText(option.id || option.key) || `${slugText(label)}-${index + 1}`,
        label,
        value: valueText,
        description: cleanText(option.description || option.detail || option.reason)
      };
    })
    .filter(Boolean)
    .slice(0, 6);
  const answered = source.answered && typeof source.answered === 'object' && !Array.isArray(source.answered)
    ? {
      answer: cleanText(source.answered.answer || source.answered.value),
      answered_at: cleanText(source.answered.answered_at || source.answered.answeredAt)
    }
    : null;
  return {
    id: cleanText(source.id || source.question_id || source.questionId) || slugText(question, 'question'),
    question,
    context: cleanText(source.context || source.help_text || source.helpText),
    options,
    allow_custom: source.allow_custom !== false && source.allowCustom !== false,
    placeholder: cleanText(source.placeholder || source.custom_placeholder || source.customPlaceholder)
      || 'Type another answer',
    submit_label: cleanText(source.submit_label || source.submitLabel) || 'Send answer',
    status: cleanText(source.status),
    answered
  };
}

module.exports = { normalizeAgentUserQuestion };
