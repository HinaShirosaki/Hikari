'use strict';

const { ensureObject } = require('../../lib/normalize.js');
const { createUniqueStrings } = require('../../lib/value-utils.js');

const CONVERSATIONAL_PATTERNS = [
  /\b(?:can|could|would|will)\s+you\b/gi,
  /\b(?:please|kindly)\b/gi,
  /\b(?:i\s+(?:want|need|would\s+like)(?:\s+to)?|help\s+me|show\s+me|tell\s+me|give\s+me|walk\s+me\s+through)\b/gi,
  /\b(?:explain|describe|summarize|outline|search(?:\s+for)?|find|look\s+up|look\s+for|investigate|return|read)\b/gi,
  /\b(?:what|why|how|when|where|which)\b/gi,
  /\b(?:whole|entire|complete|full)\b/gi,
  /\b(?:to\s+me|for\s+me)\b/gi
];

const TARGET_REPHRASING_PATTERNS = [
  /\b(?:stop(?:ped|ping)?\s+responding|no\s+longer\s+respond(?:ing)?|resistan[ct]|become(?:s|ing)?\s+resistant|refractory)\s+to\s+([a-z0-9][a-z0-9\s/+.-]{1,80})/gi
];

const TOKEN_STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'being', 'between', 'by',
  'did', 'do', 'does', 'for', 'from', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or',
  'that', 'the', 'their', 'there', 'these', 'this', 'those', 'to', 'under', 'using',
  'via', 'vs', 'with', 'without'
]);

const GENERIC_QUERY_TERMS = new Set([
  'answer', 'background', 'citation', 'citations', 'context', 'detail', 'details',
  'evidence', 'explanation', 'grounded', 'grounding', 'info', 'information',
  'introduction', 'latest', 'literature', 'literature-backed', 'note', 'notes',
  'overview', 'paper', 'papers', 'procedure', 'procedures', 'question', 'questions',
  'recent', 'reference', 'references', 'research', 'summary', 'targeted', 'uncertain',
  'uncertainty'
]);

const GENERIC_STRUCTURED_TERMS = new Set([
  'latest paper',
  'latest papers',
  'latest literature',
  'paper',
  'papers',
  'recent paper',
  'recent papers',
  'recent literature',
  'references'
]);

function cleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

const uniqueStrings = createUniqueStrings(cleanText, 0);

function applyQueryRephrasings(text) {
  let normalized = cleanText(text);
  TARGET_REPHRASING_PATTERNS.forEach((pattern) => {
    normalized = normalized.replace(pattern, (_match, target) => ` ${String(target || '').trim()} resistance `);
  });
  return normalized;
}

function normalizePhraseText(value) {
  let text = applyQueryRephrasings(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, '\'')
    .replace(/[\[\]{}(),;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  CONVERSATIONAL_PATTERNS.forEach((pattern) => {
    text = text.replace(pattern, ' ');
  });
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeToken(token) {
  const text = cleanText(token).replace(/_/g, ' ').trim();
  if (!text) {
    return '';
  }
  if (/^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(text)) {
    return text.toUpperCase();
  }
  if (/^[a-z]{2,6}$/i.test(text) && /[A-Z]{2,}/.test(text)) {
    return text.toUpperCase();
  }
  return text;
}

function shouldSkipToken(token) {
  const lower = String(token || '').toLowerCase();
  if (!lower) {
    return true;
  }
  if (TOKEN_STOPWORDS.has(lower) || GENERIC_QUERY_TERMS.has(lower)) {
    return true;
  }
  if (/^\d+$/.test(lower)) {
    return true;
  }
  if (lower.length === 1 && !/^[ivx]$/i.test(lower)) {
    return true;
  }
  return false;
}

function shouldKeepPhrase(phrase) {
  const text = cleanText(phrase);
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  if (GENERIC_STRUCTURED_TERMS.has(lower)) {
    return false;
  }
  const tokens = lower.split(/\s+/).filter(Boolean);
  return tokens.some((token) => !TOKEN_STOPWORDS.has(token) && !GENERIC_QUERY_TERMS.has(token));
}

function extractKeywordPhrases(value, maxPhrases = null) {
  const text = normalizePhraseText(value);
  if (!text) {
    return [];
  }
  const protectedText = text
    .replace(/\bMHC\s+class\s+([ivx]+)\b/gi, (_match, roman) => `MHC_class_${String(roman || '').toUpperCase()}`)
    .replace(/\bclass\s+([ivx]+)\b/gi, (_match, roman) => `class_${String(roman || '').toUpperCase()}`)
    .replace(/\b([TBNK])\s+cells?\b/g, (_match, letter) => `${String(letter || '').toUpperCase()}_cell`);
  const rawTokens = protectedText.match(/[A-Za-z0-9_]+(?:[./+-][A-Za-z0-9_]+)*/g) || [];
  const phrases = [];
  let current = [];

  const flush = () => {
    if (!current.length) {
      return;
    }
    const phrase = current.join(' ').replace(/\s+/g, ' ').trim();
    current = [];
    if (shouldKeepPhrase(phrase)) {
      phrases.push(phrase);
    }
  };

  rawTokens.forEach((rawToken) => {
    const token = normalizeToken(rawToken);
    if (shouldSkipToken(token)) {
      flush();
      return;
    }
    current.push(token);
    if (current.length >= 6) {
      flush();
    }
  });
  flush();

  const normalizedMaxPhrases = Number(maxPhrases);
  return uniqueStrings(phrases, Number.isFinite(normalizedMaxPhrases) && normalizedMaxPhrases > 0 ? normalizedMaxPhrases : 50);
}

function compactPhraseList(phrases, maxLength = null) {
  const output = [];
  uniqueStrings(phrases, 80).forEach((phrase) => {
    const normalized = phrase.toLowerCase();
    if (output.some((item) => item.toLowerCase() === normalized || item.toLowerCase().includes(normalized))) {
      return;
    }
    for (let index = output.length - 1; index >= 0; index -= 1) {
      const existing = output[index].toLowerCase();
      if (normalized.includes(existing) && normalized !== existing) {
        output.splice(index, 1);
      }
    }
    output.push(phrase);
  });

  const normalizedMaxLength = Number.isFinite(Number(maxLength)) ? Number(maxLength) : 0;
  if (!(normalizedMaxLength > 0)) {
    return output;
  }

  const limited = [];
  let remaining = normalizedMaxLength;
  output.forEach((phrase) => {
    if (!phrase) {
      return;
    }
    const cost = limited.length ? phrase.length + 1 : phrase.length;
    if (cost > remaining) {
      return;
    }
    limited.push(phrase);
    remaining -= cost;
  });
  return limited;
}

function normalizeStructuredPhrase(value) {
  const text = cleanText(value);
  if (!text) {
    return '';
  }
  if (GENERIC_STRUCTURED_TERMS.has(text.toLowerCase())) {
    return '';
  }
  const extracted = extractKeywordPhrases(text, 2);
  if (extracted.length) {
    return extracted[0];
  }
  return shouldKeepPhrase(text) ? text : '';
}

function buildKeywordStyleLiteratureQuery(input = {}, options = {}) {
  const source = ensureObject(input);
  const parserPayload = ensureObject(source.parser_payload || source.parserPayload);
  const entities = ensureObject(parserPayload.entities);
  const phrases = [];

  [
    source.paper_title || source.paperTitle || entities.paper_title,
    source.query,
    source.topic,
    source.message,
    source.protein_name || source.proteinName || entities.protein_name,
    source.compound_name || source.compoundName || entities.compound_name,
    source.activity_type || source.activityType || entities.activity_type,
    source.requested_output || entities.requested_output
  ].forEach((value, index) => {
    if (index === 0) {
      const structuredPhrase = normalizeStructuredPhrase(value);
      if (structuredPhrase) {
        phrases.push(structuredPhrase);
      }
      return;
    }
    phrases.push(...extractKeywordPhrases(value));
  });

  const requestedMaxLength = Number(options.maxLength);
  const normalizedMaxLength = Number.isFinite(requestedMaxLength) && requestedMaxLength > 0 ? requestedMaxLength : 600;
  const compacted = compactPhraseList(phrases.filter(Boolean), normalizedMaxLength);
  const query = cleanText(compacted.join(' '), normalizedMaxLength);
  return query || cleanText(source.query || source.topic || source.message, normalizedMaxLength);
}

module.exports = {
  buildKeywordStyleLiteratureQuery,
  extractKeywordPhrases
};
