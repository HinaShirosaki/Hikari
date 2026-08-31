'use strict';

const path = require('node:path');
const { asArray, ensureObject } = require('../../../../lib/normalize.js');
const { KNOWLEDGE_BASE_ROOT_FOLDER_NAME, PAPER_MARKDOWN_ROOT_FOLDER_NAME } = require('../../../../storage/storage-paths.js');

const INTAKE_SCHEMA_VERSION = 1;
const INTAKE_FILE_NAME = 'intake.json';
const PAPERS_ROOT_REL = path.posix.join(
  KNOWLEDGE_BASE_ROOT_FOLDER_NAME,
  PAPER_MARKDOWN_ROOT_FOLDER_NAME
);

const DOC_TYPES = Object.freeze([
  'research_paper',
  'review',
  'book',
  'book_chapter',
  'other'
]);

function cleanText(value, maxLength = 2000) {
  const text = String(value == null ? '' : value).trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function uniqueStrings(values = [], max = 50) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 240);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key) || out.length >= max) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function normalizeDocType(value) {
  const text = cleanText(value, 40).toLowerCase().replace(/[\s-]+/gu, '_');
  return DOC_TYPES.includes(text) ? text : 'other';
}

function normalizeExperiment(value, index = 0) {
  const source = ensureObject(value);
  const evidence = cleanText(source.evidence || source.source_content || source.sourceContent, 1600);
  return {
    id: cleanText(source.id, 80) || `e${index + 1}`,
    title: cleanText(source.title, 240),
    technique: cleanText(source.technique, 240),
    variables: cleanText(source.variables, 400),
    figure_ref: cleanText(source.figure_ref || source.figureRef, 80),
    outcome: cleanText(source.outcome, 600),
    ...(evidence ? { evidence } : {})
  };
}

function normalizeOutlineEntry(value) {
  const source = ensureObject(value);
  return {
    section: cleanText(source.section, 240),
    summary: cleanText(source.summary, 600)
  };
}

function normalizeClaim(value) {
  const source = ensureObject(value);
  return {
    section: cleanText(source.section, 240),
    claim: cleanText(source.claim, 600)
  };
}

/**
 * Build a fully-normalized intake record from an unstructured input. Safe to
 * call on partial input — missing fields collapse to empty strings/arrays.
 */
function normalizeIntakeRecord(input = {}) {
  const source = ensureObject(input);
  const docType = normalizeDocType(source.doc_type || source.docType);
  return {
    schema_version: INTAKE_SCHEMA_VERSION,
    paper_id: cleanText(source.paper_id || source.paperId, 200),
    doc_type: docType,
    title: cleanText(source.title, 400),
    doi: cleanText(source.doi, 200),
    one_sentence_summary: cleanText(source.one_sentence_summary || source.summary, 800),
    project_ids: uniqueStrings(source.project_ids || source.projectIds, 25),
    experiments: docType === 'research_paper'
      ? asArray(source.experiments).map(normalizeExperiment)
      : [],
    structure_outline: docType === 'research_paper'
      ? []
      : asArray(source.structure_outline || source.structureOutline).map(normalizeOutlineEntry),
    notable_claims: docType === 'research_paper'
      ? []
      : asArray(source.notable_claims || source.notableClaims).map(normalizeClaim),
    source_paths: {
      paper_md: cleanText(source.source_paths?.paper_md, 400),
      figures_dir: cleanText(source.source_paths?.figures_dir, 400),
      pdf_path: cleanText(source.source_paths?.pdf_path, 400)
    },
    created_at: cleanText(source.created_at, 60),
    updated_at: cleanText(source.updated_at, 60)
  };
}

module.exports = {
  DOC_TYPES,
  INTAKE_FILE_NAME,
  INTAKE_SCHEMA_VERSION,
  PAPERS_ROOT_REL,
  cleanText,
  normalizeIntakeRecord,
  uniqueStrings
};
