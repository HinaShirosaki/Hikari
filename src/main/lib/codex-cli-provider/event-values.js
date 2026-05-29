'use strict';

const { cleanText } = require('./utils');

function collectTextFromCodexEventValue(value, maxLength = 4000) {
  if (typeof value === 'string') {
    return cleanText(value, maxLength);
  }
  if (Array.isArray(value)) {
    return cleanText(value.map((item) => collectTextFromCodexEventValue(item, maxLength)).filter(Boolean).join(''), maxLength);
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  const directText = value.text
    || value.output_text
    || value.outputText
    || value.summary_text
    || value.summaryText
    || value.content
    || value.message
    || value.delta;
  if (typeof directText === 'string' && directText) {
    return cleanText(directText, maxLength);
  }
  if (Array.isArray(value.content) || Array.isArray(value.parts) || Array.isArray(value.summary)) {
    return cleanText([
      collectTextFromCodexEventValue(value.content, maxLength),
      collectTextFromCodexEventValue(value.parts, maxLength),
      collectTextFromCodexEventValue(value.summary, maxLength)
    ].filter(Boolean).join(''), maxLength);
  }
  const wrappedText = collectTextFromCodexEventValue(
    value.Ok
      || value.ok
      || value.Err
      || value.err
      || value.error
      || value.data
      || value.result,
    maxLength
  );
  if (wrappedText) {
    return wrappedText;
  }
  return '';
}

function stringifyCodexEventValue(value, maxLength = 2000) {
  if (typeof value === 'string') {
    return cleanText(value, maxLength);
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return cleanText(JSON.stringify(value), maxLength);
  } catch {
    return cleanText(String(value || ''), maxLength);
  }
}

function looksLikeJsonLine(value = '') {
  const text = String(value || '').trim();
  return text.startsWith('{') || text.startsWith('[');
}

function parseCodexToolArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

module.exports = {
  collectTextFromCodexEventValue,
  looksLikeJsonLine,
  parseCodexToolArguments,
  stringifyCodexEventValue
};
