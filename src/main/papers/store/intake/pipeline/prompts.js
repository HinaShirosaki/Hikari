'use strict';

const { asArray } = require('../../../../lib/normalize.js');
const { cleanText } = require('./text-utils.js');

const CLASSIFY_SYSTEM_PROMPT = [
  'You classify a scientific document for a research knowledge base.',
  'Decide exactly one document type from the allowed enum based only on the supplied text.',
  'research_paper = primary report of original experiments or analyses with a methods/experiments section and new results.',
  'review = synthesizes prior literature without new experiments (systematic reviews and meta-analyses are reviews).',
  'book / book_chapter = long-form pedagogical or reference text, monograph, or textbook excerpt.',
  'other = preprint commentary, editorial, perspective, thesis abstract, dataset descriptor, or anything else.',
  'Choose research_paper only when a methods/experiments section is clearly present and new findings are reported.',
  'If unsure between research_paper and review, choose review.',
  'Return JSON only.'
].join(' ');

const RESEARCH_PAGE_SYSTEM_PROMPT = [
  'You inventory experiments from one full extracted paper page at a time.',
  'List every distinct experiment, control, ablation, computational analysis, or supplementary experiment evidenced by the supplied content.',
  'Include only experiments conducted by this paper; exclude background studies, cited prior work, future work, and reference-list entries.',
  'For each experiment, copy a short verbatim evidence excerpt from the supplied content.',
  'Do not paraphrase evidence and do not report an experiment without supporting content.',
  'Set request_next_page to true when another page is available and the paragraph, caption, table, method, result, or experiment continues.',
  'Do not add identifiers, page numbers, line numbers, or source paths. Return JSON only.'
].join(' ');

const RESEARCH_SUMMARY_SYSTEM_PROMPT = [
  'Write exactly one sentence summarizing a research paper from its verified experiment inventory.',
  'Name the system or question, core methods, and headline finding.',
  'Do not add findings absent from the inventory. Return JSON only.'
].join(' ');

const NON_RESEARCH_SYSTEM_PROMPT = [
  'You summarize a non-experimental scientific document (review, book, chapter, or other) for a knowledge base.',
  'This document does not conduct experiments, so do NOT produce an experiment list.',
  'Write exactly ONE sentence describing what the document covers and its central thesis or scope.',
  'Provide the document\'s own section/chapter outline with a one-line description each, in order.',
  'Provide up to five notable claims or cited pieces of evidence, each tagged with the section it appears in.',
  'Return JSON only.'
].join(' ');

function buildClassificationPrompt({ title, doi, markdown }) {
  return [
    'Classify the document below into one of: research_paper, review, book, book_chapter, other.',
    `Title hint: ${title || '-'}`,
    `DOI hint: ${doi || '-'}`,
    'Converted paper Markdown:',
    markdown || '-',
    'Return JSON with doc_type, confidence (0-1), and a short reason.'
  ].join('\n\n');
}

function buildResearchPagePrompt({
  title,
  content,
  hasMore,
  previousPageAnalysis = null,
  previousPageContent = ''
}) {
  return [
    'Inspect this full extracted page and return newly evidenced experiments.',
    `Title: ${title || '-'}`,
    `Another full page is available: ${hasMore ? 'yes' : 'no'}`,
    previousPageContent
      ? `Previous full page content retained because continuation was requested:\n${previousPageContent}`
      : '',
    previousPageAnalysis
      ? `Previous-page analysis for continuation only:\n${JSON.stringify(previousPageAnalysis, null, 2)}`
      : '',
    'Full page content:',
    content || '-',
    'Return JSON with experiments[] (title, technique, variables, figure_ref, outcome, evidence) and request_next_page.'
  ].filter(Boolean).join('\n\n');
}

function buildResearchSummaryPrompt({ title, experiments }) {
  const compactExperiments = asArray(experiments).map((experiment) => ({
    title: cleanText(experiment?.title, 240),
    technique: cleanText(experiment?.technique, 240),
    variables: cleanText(experiment?.variables, 400),
    figure_ref: cleanText(experiment?.figure_ref, 80),
    outcome: cleanText(experiment?.outcome, 600)
  }));
  return [
    'Summarize the verified experiment inventory below.',
    `Title: ${title || '-'}`,
    `Verified experiments JSON:\n${JSON.stringify(compactExperiments, null, 2)}`,
    'Return JSON with one_sentence_summary.'
  ].join('\n\n');
}

function buildNonResearchPrompt({ title, docType, markdown }) {
  return [
    `Summarize the ${docType.replace(/_/gu, ' ')} below. Do not list experiments.`,
    `Title: ${title || '-'}`,
    'Converted paper Markdown:',
    markdown || '-',
    'Return JSON with one_sentence_summary, structure_outline[] (section, summary), and notable_claims[] (section, claim).'
  ].join('\n\n');
}

module.exports = {
  CLASSIFY_SYSTEM_PROMPT,
  NON_RESEARCH_SYSTEM_PROMPT,
  RESEARCH_PAGE_SYSTEM_PROMPT,
  RESEARCH_SUMMARY_SYSTEM_PROMPT,
  buildClassificationPrompt,
  buildNonResearchPrompt,
  buildResearchPagePrompt,
  buildResearchSummaryPrompt
};
