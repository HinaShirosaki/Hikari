'use strict';

function cleanText(value, _maxLength = 1200) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function safeParseJson(rawValue = '', fallback = null) {
  try {
    return JSON.parse(String(rawValue || ''));
  } catch {
    return fallback;
  }
}

module.exports = {
  cleanText,
  safeParseJson
};
