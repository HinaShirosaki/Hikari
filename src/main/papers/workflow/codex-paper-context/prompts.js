'use strict';

const fsPromises = require('node:fs/promises');
const { ensureObject } = require('../../../lib/normalize.js');
const { attachRelatedCommentsToContextBlocks, cloneJson } = require('../../shared/paper-comment-context.js');
const { inferMarkdownSectionLabel, normalizeLineRanges, readLineRangesFromText } = require('../paper-line-ranges.js');
const { DEFAULT_MAX_CONTEXT_BLOCKS, defaultAsArray, defaultCleanText, toPositiveInteger } = require('./read-targets.js');

function buildCodexPaperContextSystemPrompt() {
  return [
    'You are the Codex paper-context sub-agent for Hikari.',
    'The main Hikari agent already searched paper databases, selected candidate records, downloaded available PDFs, and extracted downloaded PDFs into LLM-facing Markdown.',
    'Your job is to read one provided Markdown file at a time, choose the smallest useful line ranges for the main agent context, and return structured JSON only.',
    'Do not call Hikari paper_analysis, literature_search, or paper_download from this sub-agent task. Re-entering those tools would loop back into the main workflow.',
    'Do not write excerpts or quote paper text in your response. Hikari will retrieve the exact source lines from the provided paper Markdown file after you return line numbers.'
  ].join(' ');
}

function buildCodexPaperContextMessage(input = {}, helpers = {}) {
  const cleanText = typeof helpers.cleanText === 'function' ? helpers.cleanText : defaultCleanText;
  const source = ensureObject(input);
  const maxBlocks = Math.max(
    1,
    Math.min(
      toPositiveInteger(source.max_context_blocks || source.maxContextBlocks || source.max_blocks || source.maxBlocks, DEFAULT_MAX_CONTEXT_BLOCKS),
      DEFAULT_MAX_CONTEXT_BLOCKS
    )
  );
  const responseSchema = {
    ok: true,
    status: 'completed',
    selected_line_ranges: [
      {
        line_ranges: [
          { start_line: 42, end_line: 48 },
          { start_line: 71, end_line: 73 }
        ],
        relevance_reason: 'Why these lines should enter the main context.'
      }
    ],
    notes: [],
    summary: 'Selected 2 line ranges from this paper.'
  };
  const paperTarget = ensureObject(source.paper_target || source.paperTarget);

  return [
    '# Codex Paper Line Selection Task',
    '',
    `Main-agent request:\n${cleanText(source.message || source.query || source.topic, 2400)}`,
    '',
    `Query:\n${cleanText(source.query, 600)}`,
    '',
    `Copied main-agent context JSON:\n${JSON.stringify(ensureObject(source.copied_context || source.copiedContext), null, 2)}`,
    '',
    `Paper target JSON:\n${JSON.stringify(paperTarget, null, 2)}`,
    '',
    'Workflow rules:',
    '- Read the single `download.knowledge_markdown_path`; it is the LLM-facing markdown extracted from this paper PDF.',
    '- Work on this paper only. Because the task is one-paper scoped, do not include paper_id, paper title, or file path in the response.',
    '- Choose only context that directly helps answer the main-agent request.',
    `- Return at most ${maxBlocks} selected line-range objects for this paper.`,
    '- Read the exact `download.knowledge_markdown_path` with a true line-numbered command such as `nl -ba`, or an equivalent reader that shows physical file line numbers.',
    '- Use those 1-based physical line numbers exactly. Do not count visual line wrapping as additional lines.',
    '- Before returning, verify that every start line exists in that Markdown file.',
    '- Use multiple `line_ranges` in one object when the same evidence is split across non-contiguous lines.',
    '- Keep each range narrow enough for prompt context; prefer paragraphs or compact table rows over whole sections.',
    '- Return only line numbers and reasons. Do not include excerpt, text, content, quotes, paper_id, or file path. Hikari retrieves source text.',
    '- Use [] when no line from this paper is relevant. Do not invent line numbers.',
    '- Return JSON only, with no prose or markdown fence.',
    '',
    `Required JSON shape:\n${JSON.stringify(responseSchema, null, 2)}`
  ].join('\n');
}

function buildSubAgentSummary(agent = null) {
  const source = ensureObject(agent);
  if (!source.id) {
    return null;
  }
  return {
    id: defaultCleanText(source.id),
    name: defaultCleanText(source.name),
    status: defaultCleanText(source.status),
    created_at: defaultCleanText(source.created_at),
    updated_at: defaultCleanText(source.updated_at),
    message_count: defaultAsArray(source.messages).length,
    metadata: cloneJson(ensureObject(source.metadata), {}),
    task: cloneJson(ensureObject(source.task), null),
    last_response: cloneJson(ensureObject(source.last_response), null)
  };
}

function getKnowledgeMarkdownPath(paperTarget = {}) {
  const source = ensureObject(paperTarget);
  const download = ensureObject(source.download);
  return defaultCleanText(
    download.knowledge_markdown_path
      || download.knowledgeMarkdownPath
      || source.knowledge_markdown_path
      || source.knowledgeMarkdownPath);
}

function getKnowledgeMarkdownRelativePath(paperTarget = {}) {
  const source = ensureObject(paperTarget);
  const download = ensureObject(source.download);
  return defaultCleanText(
    download.knowledge_markdown_relative_path
      || download.knowledgeMarkdownRelativePath
      || source.knowledge_markdown_relative_path
      || source.knowledgeMarkdownRelativePath);
}

async function hydrateLineSelectionsForPaper({
  paperTarget = {},
  linePayload = {},
  annotationContext = null,
  helpers = {}
} = {}) {
  const asArray = typeof helpers.asArray === 'function' ? helpers.asArray : defaultAsArray;
  const cleanText = typeof helpers.cleanText === 'function' ? helpers.cleanText : defaultCleanText;
  const markdownPath = getKnowledgeMarkdownPath(paperTarget);
  if (!markdownPath) {
    return {
      blocks: [],
      notes: ['No knowledge_markdown_path was available for this paper.']
    };
  }

  let markdown = '';
  try {
    markdown = await fsPromises.readFile(markdownPath, 'utf8');
  } catch (error) {
    return {
      blocks: [],
      notes: [`Could not read paper Markdown: ${cleanText(error?.message || error, 300)}`]
    };
  }

  const lines = String(markdown || '').split(/\r?\n/);
  const paperId = cleanText(paperTarget.paper_id || paperTarget.paperId, 120);
  const paperTitle = cleanText(paperTarget.paper_title || paperTarget.paperTitle || paperTarget.title, 320);
  const relativePath = getKnowledgeMarkdownRelativePath(paperTarget);
  const notes = [];
  const blocks = asArray(linePayload.selected_line_ranges)
    .slice(0, DEFAULT_MAX_CONTEXT_BLOCKS)
    .map((selection, index) => {
      const lineRanges = normalizeLineRanges(selection.line_ranges || selection.lineRanges || selection);
      if (!lineRanges.length) {
        return null;
      }
      const hydrated = readLineRangesFromText(markdown, lineRanges);
      if (hydrated.rejected_ranges.length) {
        notes.push(
          `Ignored ${hydrated.rejected_ranges.length} line range(s) beyond the ${hydrated.line_count}-line paper Markdown for ${paperTitle || paperId || 'paper'}.`
        );
      }
      if (!hydrated.excerpt) {
        return null;
      }
      const firstRange = hydrated.parts[0] || lineRanges[0];
      return {
        block_id: `${paperId || 'paper'}::lines-${index + 1}`,
        paper_id: paperId,
        paper_title: paperTitle,
        section_label: cleanText(selection.section_label || selection.sectionLabel, 160)
          || inferMarkdownSectionLabel(lines, firstRange.start_line, 'Paper lines'),
        excerpt: hydrated.excerpt,
        relevance_reason: cleanText(selection.relevance_reason || selection.relevanceReason || selection.reason, 360),
        source: 'knowledge_markdown',
        evidence_kind: 'text',
        line_ranges: hydrated.parts.map((part) => ({
          start_line: part.start_line,
          end_line: part.end_line
        })),
        source_lines: hydrated.source_lines,
        source_line_count: hydrated.line_count,
        ...(relativePath ? { source_path: relativePath } : {}),
        ...(markdownPath ? { source_absolute_path: markdownPath } : {})
      };
    })
    .filter((block) => block && block.paper_id && block.excerpt);

  return {
    blocks: attachRelatedCommentsToContextBlocks(blocks, annotationContext, { asArray, cleanText }),
    notes
  };
}

module.exports = {
  buildCodexPaperContextMessage,
  buildCodexPaperContextSystemPrompt,
  buildSubAgentSummary,
  getKnowledgeMarkdownPath,
  hydrateLineSelectionsForPaper
};
