'use strict';

const { asArray, cloneJson, ensureObject } = require('../../lib/normalize.js');
const { parseJsonObjectFromText } = require('../../lib/llm/runtime-helpers.js');
const { isFilesystemRoot } = require('../../lib/path-safety.js');

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

module.exports = {
  asArray,
  cloneJson,
  defaultCleanText,
  ensureObject,
  isFilesystemRoot,
  parseJsonObjectFromText
};
