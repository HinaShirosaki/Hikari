'use strict';

const { ensureObject } = require('../../../lib/normalize.js');

// Prompt limits, text trimming, and the markdown-rewrite prompt used when a
// paper's extracted text is turned into knowledge markdown.
const DEFAULT_MARKDOWN_PROMPT_CHAR_LIMIT = 120000;
// Scratch area for figures extracted before the paper's canonical folder is
// known. Lives beside papers.md so listPaperIds() never enumerates it.
const FIGURE_STAGING_FOLDER_NAME = '.figures-staging';

function asArrayDefault(value) {
  return Array.isArray(value) ? value : [];
}

function limitText(value, maxLength = 4000) {
  const text = String(value || '');
  const numericMax = Number(maxLength);
  if (!text || !Number.isFinite(numericMax) || numericMax <= 0) {
    return text;
  }
  return text.length > numericMax ? text.slice(0, numericMax) : text;
}

function isExplicitFalse(value) {
  if (value === false) {
    return true;
  }
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'no';
}

function guessTitleFromText(text = '') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.length >= 6 && line.length <= 220);
  return lines[0] || '';
}

function buildMarkdownRewritePrompt({ metadata = {}, extraction = {}, extractedText = '', figures = [], maxPromptChars = DEFAULT_MARKDOWN_PROMPT_CHAR_LIMIT } = {}) {
  const promptText = limitText(extractedText, maxPromptChars);
  const sectionSummary = asArrayDefault(extraction.sections)
    .slice(0, 24)
    .map((section) => ({
      label: section?.label || section?.normalized_label || '',
      start_page: section?.start_page || section?.page_number || null,
      end_page: section?.end_page || section?.page_number || null
    }));
  const figureSummary = asArrayDefault(figures)
    .map((figure) => ({
      page_number: figure?.page_number || null,
      relative_path: figure?.relative_path || `figures/${figure?.file_name || ''}`,
      width: figure?.width || null,
      height: figure?.height || null
    }))
    .filter((figure) => figure.relative_path && figure.relative_path !== 'figures/');
  return [
    'Rewrite this scientific paper into dense wiki-form Markdown for a future LLM reader.',
    'Use only the extracted paper text. Do not add outside knowledge.',
    'Make every important claim traceable to a page using citations like `(p. 4)` or `(pp. 4-5)`.',
    'Keep it self-contained, concise, and link-ready. Use `[[doi]]` only for clearly named related papers already present in the text.',
    figureSummary.length
      ? 'Embed extracted figures inline near their captions using `![Figure on page N](relative_path)`; only use the relative paths listed in "Available figures JSON".'
      : '',
    'Return Markdown only with this skeleton:',
    '# <Title>',
    '**Authors:** ...   **Year:** ...   **DOI:** ...',
    '## TL;DR',
    '## Background',
    '## Methods',
    '## Key results',
    '## Figures & tables',
    '## Limitations',
    '## How it relates',
    '## Verbatim quotes',
    '',
    `Metadata JSON:\n${JSON.stringify(metadata, null, 2)}`,
    `Detected sections JSON:\n${JSON.stringify(sectionSummary, null, 2)}`,
    figureSummary.length ? `Available figures JSON:\n${JSON.stringify(figureSummary, null, 2)}` : '',
    `Extracted text with page markers:\n${promptText}`
  ].filter(Boolean).join('\n\n');
}

function extractLlmText(result = {}) {
  if (typeof result === 'string') {
    return result;
  }
  const source = ensureObject(result);
  return String(source.text || source.assistant_message || source.message || source.output_text || '').trim();
}

function normalizeMarkdown(markdown = '') {
  const text = String(markdown || '').trim()
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return text;
}

module.exports = {
  DEFAULT_MARKDOWN_PROMPT_CHAR_LIMIT,
  FIGURE_STAGING_FOLDER_NAME,
  asArrayDefault,
  limitText,
  isExplicitFalse,
  guessTitleFromText,
  buildMarkdownRewritePrompt,
  extractLlmText,
  normalizeMarkdown
};
