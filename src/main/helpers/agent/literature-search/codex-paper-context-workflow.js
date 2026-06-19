'use strict';

const fsPromises = require('node:fs/promises');

const {
  attachRelatedCommentsToContextBlocks,
  buildPaperAnnotationContext,
  cloneJson,
  getRelatedCommentsForPaperId,
  normalizeRelatedComments
} = require('../shared/paper-comment-context.js');

const DEFAULT_MAX_CONTEXT_BLOCKS = 50;
const DEFAULT_MAX_LINE_RANGES_PER_SELECTION = 8;
const DEFAULT_MAX_LINES_PER_SELECTION = 120;

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, _maxLength = 4000) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}


function parseJsonObjectFromText(raw = '') {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function normalizeProvider(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, '-');
}

function shouldUseCodexPaperContextWorkflow(input = {}) {
  const source = ensureObject(input);
  if (
    source.use_codex_paper_context === true
    || source.useCodexPaperContext === true
    || source.codex_paper_context === true
    || source.codexPaperContext === true
  ) {
    return true;
  }
  if (
    source.disable_codex_paper_context === true
    || source.disableCodexPaperContext === true
  ) {
    return false;
  }
  const provider = normalizeProvider(
    source.provider
      || source.llm_provider
      || source.llmProvider
      || source.runtime_provider
      || source.runtimeProvider
  );
  return provider === 'codex' || provider === 'codex-cli' || provider === 'codex-agent';
}

function toPositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveLineNumber(value) {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }
  const raw = String(value || '').trim();
  if (!raw) {
    return 0;
  }
  const match = raw.match(/\d+/);
  const parsed = Number(match?.[0] || raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function addLineRange(ranges, startValue, endValue = startValue) {
  const start = parsePositiveLineNumber(startValue);
  const end = parsePositiveLineNumber(endValue || startValue);
  if (!start || !end) {
    return;
  }
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  ranges.push({ start_line: lower, end_line: upper });
}

function collectLineRanges(value, ranges) {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const raw = String(value || '').trim();
    if (typeof value === 'string' && /[,;]|\d+\s*(?:-|:|–|—)\s*\d+/u.test(raw)) {
      const pattern = /(\d+)(?:\s*(?:-|:|–|—)\s*(\d+))?/gu;
      let match = pattern.exec(raw);
      while (match) {
        addLineRange(ranges, match[1], match[2] || match[1]);
        match = pattern.exec(raw);
      }
      return;
    }
    addLineRange(ranges, value, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectLineRanges(entry, ranges));
    return;
  }
  const source = ensureObject(value);
  if (!Object.keys(source).length) {
    return;
  }

  collectLineRanges(source.line_ranges || source.lineRanges || source.line_range || source.lineRange, ranges);
  collectLineRanges(source.line_numbers || source.lineNumbers || source.line_number || source.lineNumber, ranges);
  collectLineRanges(source.lines, ranges);

  const start = source.start_line
    || source.startLine
    || source.line_start
    || source.lineStart
    || source.from_line
    || source.fromLine
    || source.from
    || source.start;
  const end = source.end_line
    || source.endLine
    || source.line_end
    || source.lineEnd
    || source.to_line
    || source.toLine
    || source.to
    || source.end
    || start;
  if (start) {
    addLineRange(ranges, start, end);
  }
}

function normalizeLineRanges(value, options = {}) {
  const ranges = [];
  collectLineRanges(value, ranges);
  const maxRanges = Math.max(1, Number(options.maxRanges) || DEFAULT_MAX_LINE_RANGES_PER_SELECTION);
  const maxTotalLines = Math.max(1, Number(options.maxTotalLines) || DEFAULT_MAX_LINES_PER_SELECTION);
  const normalized = ranges
    .map((range) => ({
      start_line: parsePositiveLineNumber(range.start_line),
      end_line: parsePositiveLineNumber(range.end_line || range.start_line)
    }))
    .filter((range) => range.start_line && range.end_line)
    .map((range) => ({
      start_line: Math.min(range.start_line, range.end_line),
      end_line: Math.max(range.start_line, range.end_line)
    }))
    .sort((left, right) => {
      if (left.start_line !== right.start_line) {
        return left.start_line - right.start_line;
      }
      return left.end_line - right.end_line;
    });

  const merged = [];
  normalized.forEach((range) => {
    const last = merged[merged.length - 1];
    if (last && range.start_line <= last.end_line + 1) {
      last.end_line = Math.max(last.end_line, range.end_line);
      return;
    }
    merged.push({ ...range });
  });

  const capped = [];
  let remainingLines = maxTotalLines;
  for (const range of merged) {
    if (capped.length >= maxRanges || remainingLines <= 0) {
      break;
    }
    const span = Math.min(range.end_line - range.start_line + 1, remainingLines);
    capped.push({
      start_line: range.start_line,
      end_line: range.start_line + span - 1
    });
    remainingLines -= span;
  }
  return capped;
}

function buildDownloadedPaperMap(downloadedPapers = [], { asArray = defaultAsArray, cleanText = defaultCleanText } = {}) {
  const byId = new Map();
  asArray(downloadedPapers).forEach((paper) => {
    const source = ensureObject(paper);
    const paperId = cleanText(source.paper_id || source.paperId, 120);
    if (paperId) {
      byId.set(paperId, source);
    }
  });
  return byId;
}

function buildPaperReadTargets(selectedPapers = [], downloadedPapers = [], helpers = {}) {
  const asArray = typeof helpers.asArray === 'function' ? helpers.asArray : defaultAsArray;
  const cleanText = typeof helpers.cleanText === 'function' ? helpers.cleanText : defaultCleanText;
  const annotationContext = helpers.annotationContext || helpers.annotation_context || null;
  const downloadsById = buildDownloadedPaperMap(downloadedPapers, { asArray, cleanText });
  return asArray(selectedPapers).map((paper) => {
    const source = ensureObject(paper);
    const paperId = cleanText(source.paper_id || source.paperId, 120);
    const download = downloadsById.get(paperId) || {};
    return {
      paper_id: paperId,
      paper_title: cleanText(source.paper_title || source.paperTitle || source.title, 320),
      source: cleanText(source.source, 80),
      summary: cleanText(source.summary || source.snippet, 1600),
      url: cleanText(source.url, 1200),
      doi: cleanText(source.doi, 180),
      pmid: cleanText(source.pmid, 120),
      pmcid: cleanText(source.pmcid, 120),
      published_at: cleanText(source.published_at || source.publishedAt, 80),
      score: Number.isFinite(Number(source.score)) ? Number(source.score) : null,
      download: {
        ok: download.ok === true,
        status: cleanText(download.status, 80),
        file_path: cleanText(download.file_path || download.filePath, 4000),
        relative_path: cleanText(download.relative_path || download.relativePath, 2000),
        knowledge_markdown_path: cleanText(
          download.knowledge_markdown_path || download.knowledgeMarkdownPath,
          4000
        ),
        knowledge_markdown_relative_path: cleanText(
          download.knowledge_markdown_relative_path || download.knowledgeMarkdownRelativePath,
          2000
        ),
        error: cleanText(download.error, 1200)
      },
      related_comments: normalizeRelatedComments(
        getRelatedCommentsForPaperId(paperId, annotationContext),
        { asArray, cleanText }
      )
    };
  });
}

function buildCodexPaperContextSystemPrompt() {
  return [
    'You are the Codex paper-context sub-agent for Hikari.',
    'The main Hikari agent already searched paper databases, selected candidate records, downloaded available PDFs, and extracted downloaded PDFs into LLM-facing Markdown.',
    'Your job is to read one provided Markdown file at a time, choose the smallest useful line ranges for the main agent context, and return structured JSON only.',
    'Do not call Hikari literature-search or paper-download from this sub-agent task. Re-entering those tools would loop back into the main workflow.',
    'Do not write excerpts or quote paper text in your response. Hikari will retrieve the exact source lines from paper.md after you return line numbers.'
  ].join(' ');
}

function buildCodexPaperContextMessage(input = {}, helpers = {}) {
  const asArray = typeof helpers.asArray === 'function' ? helpers.asArray : defaultAsArray;
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
    '- Use 1-based line numbers exactly as shown by your file reader for paper.md.',
    '- Use multiple `line_ranges` in one object when the same evidence is split across non-contiguous lines.',
    '- Keep each range narrow enough for prompt context; prefer paragraphs or compact table rows over whole sections.',
    '- Return only line numbers and reasons. Do not include excerpt, text, content, quotes, paper_id, or file path. Hikari retrieves source text.',
    '- Use [] when no line from this paper is relevant. Do not invent line numbers.',
    '- Return JSON only, with no prose or markdown fence.',
    '',
    `Required JSON shape:\n${JSON.stringify(responseSchema, null, 2)}`
  ].join('\n');
}

function normalizeSelectedPaper(rawPaper = {}, fallback = {}, { cleanText = defaultCleanText } = {}) {
  const source = ensureObject(rawPaper);
  const base = ensureObject(fallback);
  return {
    paper_id: cleanText(source.paper_id || source.paperId || base.paper_id || base.paperId, 120),
    paper_title: cleanText(
      source.paper_title
        || source.paperTitle
        || source.title
        || base.paper_title
        || base.paperTitle
        || base.title,
      320
    ),
    source: cleanText(source.source || base.source, 80),
    summary: cleanText(source.summary || base.summary || base.snippet, 1200),
    url: cleanText(source.url || base.url, 1200),
    doi: cleanText(source.doi || base.doi, 180),
    pmid: cleanText(source.pmid || base.pmid, 120),
    pmcid: cleanText(source.pmcid || base.pmcid, 120),
    pdf_urls: Array.isArray(source.pdf_urls || source.pdfUrls)
      ? (source.pdf_urls || source.pdfUrls).slice(0, 8)
      : (Array.isArray(base.pdf_urls) ? base.pdf_urls.slice(0, 8) : []),
    published_at: cleanText(source.published_at || source.publishedAt || base.published_at || base.publishedAt, 80),
    score: Number.isFinite(Number(source.score)) ? Number(source.score) : (Number.isFinite(Number(base.score)) ? Number(base.score) : 0),
    reason: cleanText(source.reason || source.relevance_reason || source.relevanceReason, 500)
  };
}

function normalizeContextBlock(rawBlock = {}, fallbackById = new Map(), { cleanText = defaultCleanText } = {}) {
  const source = ensureObject(rawBlock);
  const paperId = cleanText(source.paper_id || source.paperId, 120);
  const fallback = ensureObject(fallbackById.get(paperId));
  const excerpt = cleanText(source.excerpt || source.text || source.content, 1800);
  if (!paperId || !excerpt) {
    return null;
  }
  return {
    paper_id: paperId,
    paper_title: cleanText(
      source.paper_title
        || source.paperTitle
        || source.title
        || fallback.paper_title
        || fallback.paperTitle
        || fallback.title,
      320
    ),
    section_label: cleanText(source.section_label || source.sectionLabel || source.section, 160),
    excerpt,
    relevance_reason: cleanText(source.relevance_reason || source.relevanceReason || source.reason, 260),
    source: cleanText(source.source, 80) || 'knowledge_markdown',
    evidence_kind: cleanText(source.evidence_kind || source.evidenceKind, 40) || 'text',
    related_comments: normalizeRelatedComments(source.related_comments || source.relatedComments, { cleanText })
  };
}

function getPayloadLineSelections(payload = {}, helpers = {}) {
  const asArray = typeof helpers.asArray === 'function' ? helpers.asArray : defaultAsArray;
  const source = ensureObject(payload);
  const candidates = [
    source.selected_line_ranges,
    source.selectedLineRanges,
    source.line_selections,
    source.lineSelections,
    source.context_line_selections,
    source.contextLineSelections,
    source.selected_lines,
    source.selectedLines,
    source.context_blocks,
    source.contextBlocks,
    source.loaded_context_blocks,
    source.loadedContextBlocks
  ];
  const rows = candidates.find((candidate) => asArray(candidate).length);
  if (rows) {
    return asArray(rows);
  }
  return normalizeLineRanges(source).length ? [source] : [];
}

function normalizeLineSelection(rawSelection = {}, helpers = {}) {
  const cleanText = typeof helpers.cleanText === 'function' ? helpers.cleanText : defaultCleanText;
  const source = ensureObject(rawSelection);
  const lineRanges = normalizeLineRanges(source);
  if (!lineRanges.length) {
    return null;
  }
  return {
    line_ranges: lineRanges,
    section_label: cleanText(source.section_label || source.sectionLabel || source.section, 160),
    relevance_reason: cleanText(source.relevance_reason || source.relevanceReason || source.reason, 360)
  };
}

function normalizeCodexPaperLinePayload(payload = {}, helpers = {}) {
  const asArray = typeof helpers.asArray === 'function' ? helpers.asArray : defaultAsArray;
  const cleanText = typeof helpers.cleanText === 'function' ? helpers.cleanText : defaultCleanText;
  const source = ensureObject(payload);
  return {
    ok: source.ok === false ? false : true,
    status: cleanText(source.status, 40) || (source.ok === false ? 'failed' : 'completed'),
    selected_line_ranges: getPayloadLineSelections(source, { asArray })
      .map((selection) => normalizeLineSelection(selection, { cleanText }))
      .filter(Boolean)
      .slice(0, DEFAULT_MAX_CONTEXT_BLOCKS),
    notes: asArray(source.notes).map((note) => cleanText(note, 500)).filter(Boolean).slice(0, 12),
    summary: cleanText(source.summary, 800),
    error: cleanText(source.error, 1200)
  };
}

function normalizeCodexPaperContextPayload(payload = {}, fallback = {}, helpers = {}) {
  const asArray = typeof helpers.asArray === 'function' ? helpers.asArray : defaultAsArray;
  const cleanText = typeof helpers.cleanText === 'function' ? helpers.cleanText : defaultCleanText;
  const source = ensureObject(payload);
  const fallbackPapers = asArray(fallback.selected_papers || fallback.selectedPapers);
  const fallbackById = new Map();
  fallbackPapers.forEach((paper) => {
    const paperId = cleanText(paper?.paper_id || paper?.paperId, 120);
    if (paperId) {
      fallbackById.set(paperId, paper);
    }
  });
  const selectedRaw = asArray(source.selected_papers || source.selectedPapers);
  const selectedPapers = (selectedRaw.length ? selectedRaw : fallbackPapers)
    .map((paper) => {
      const paperId = cleanText(paper?.paper_id || paper?.paperId, 120);
      return normalizeSelectedPaper(paper, fallbackById.get(paperId) || {}, { cleanText });
    })
    .filter((paper) => paper.paper_id && paper.paper_title);

  const annotationContext = fallback.paper_annotation_context || fallback.paperAnnotationContext || null;
  const loadedBlocks = attachRelatedCommentsToContextBlocks(asArray(source.loaded_context_blocks || source.loadedContextBlocks || source.context_blocks || source.contextBlocks)
    .map((block) => normalizeContextBlock(block, fallbackById, { cleanText }))
    .filter(Boolean), annotationContext, { asArray, cleanText });
  const readCount = toPositiveInteger(
    source.papers_read_count || source.papersReadCount,
    loadedBlocks.length
      ? new Set(loadedBlocks.map((block) => block.paper_id)).size
      : selectedPapers.length
  );

  return {
    ok: source.ok === false ? false : true,
    status: cleanText(source.status, 40) || (source.ok === false ? 'failed' : 'completed'),
    selected_papers: selectedPapers,
    loaded_context_blocks: loadedBlocks,
    papers_read_count: readCount,
    notes: asArray(source.notes).map((note) => cleanText(note, 500)).filter(Boolean).slice(0, 12),
    summary: cleanText(source.summary, 800)
  };
}

function buildSubAgentSummary(agent = null) {
  const source = ensureObject(agent);
  if (!source.id) {
    return null;
  }
  return {
    id: defaultCleanText(source.id, 160),
    name: defaultCleanText(source.name, 160),
    status: defaultCleanText(source.status, 40),
    created_at: defaultCleanText(source.created_at, 80),
    updated_at: defaultCleanText(source.updated_at, 80),
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
      || source.knowledgeMarkdownPath,
    4000
  );
}

function getKnowledgeMarkdownRelativePath(paperTarget = {}) {
  const source = ensureObject(paperTarget);
  const download = ensureObject(source.download);
  return defaultCleanText(
    download.knowledge_markdown_relative_path
      || download.knowledgeMarkdownRelativePath
      || source.knowledge_markdown_relative_path
      || source.knowledgeMarkdownRelativePath,
    2000
  );
}

function inferMarkdownSectionLabel(lines = [], startLine = 1, fallback = '') {
  const safeLines = Array.isArray(lines) ? lines : [];
  const startIndex = Math.max(0, Math.min(safeLines.length - 1, parsePositiveLineNumber(startLine) - 1));
  for (let index = startIndex; index >= 0; index -= 1) {
    const line = String(safeLines[index] || '').trim();
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading?.[1]) {
      return defaultCleanText(heading[1].replace(/\s*\(pp?\.\s*[^)]+\)\s*$/i, ''), 160);
    }
  }
  return defaultCleanText(fallback, 160) || 'Paper lines';
}

function readLineRangesFromText(text = '', ranges = []) {
  const lines = String(text || '').split(/\r?\n/);
  const parts = normalizeLineRanges(ranges).map((range) => {
    const start = Math.max(1, Math.min(range.start_line, lines.length || 1));
    const end = Math.max(start, Math.min(range.end_line, lines.length || start));
    return {
      start_line: start,
      end_line: end,
      text: lines.slice(start - 1, end).join('\n').trim()
    };
  }).filter((part) => part.text);
  return {
    line_count: lines.length,
    parts,
    excerpt: parts.map((part) => part.text).join('\n\n[... omitted source lines ...]\n\n').trim()
  };
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
      notes: [`Could not read paper.md: ${cleanText(error?.message || error, 300)}`]
    };
  }

  const lines = String(markdown || '').split(/\r?\n/);
  const paperId = cleanText(paperTarget.paper_id || paperTarget.paperId, 120);
  const paperTitle = cleanText(paperTarget.paper_title || paperTarget.paperTitle || paperTarget.title, 320);
  const relativePath = getKnowledgeMarkdownRelativePath(paperTarget);
  const blocks = asArray(linePayload.selected_line_ranges)
    .slice(0, DEFAULT_MAX_CONTEXT_BLOCKS)
    .map((selection, index) => {
      const lineRanges = normalizeLineRanges(selection.line_ranges || selection.lineRanges || selection);
      if (!lineRanges.length) {
        return null;
      }
      const hydrated = readLineRangesFromText(markdown, lineRanges);
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
        source_line_count: hydrated.line_count,
        ...(relativePath ? { source_path: relativePath } : {}),
        ...(markdownPath ? { source_absolute_path: markdownPath } : {})
      };
    })
    .filter((block) => block && block.paper_id && block.excerpt);

  return {
    blocks: attachRelatedCommentsToContextBlocks(blocks, annotationContext, { asArray, cleanText }),
    notes: []
  };
}

async function runCodexPaperContextSubAgent(input = {}, helpers = {}) {
  const asArray = typeof helpers.asArray === 'function' ? helpers.asArray : defaultAsArray;
  const cleanText = typeof helpers.cleanText === 'function' ? helpers.cleanText : defaultCleanText;
  const subAgentRuntime = input.subAgentRuntime && typeof input.subAgentRuntime === 'object'
    ? input.subAgentRuntime
    : null;
  if (!subAgentRuntime || typeof subAgentRuntime.createSubAgent !== 'function') {
    return {
      ok: false,
      status: 'error',
      error: 'Codex paper context sub-agent runtime is not configured.'
    };
  }

  const query = cleanText(input.query, 600);
  const selectedPapers = asArray(input.selectedPapers || input.selected_papers);
  const downloadedPapers = asArray(input.downloadedPapers || input.downloaded_papers);
  const annotationContext = buildPaperAnnotationContext({
    snapshot: input.snapshot || input.source?.snapshot,
    selectedPapers,
    downloadedPapers
  }, { asArray, cleanText });
  const paperTargets = buildPaperReadTargets(selectedPapers, downloadedPapers, { asArray, cleanText, annotationContext });
  const readablePaperTargets = paperTargets.filter((target) => getKnowledgeMarkdownPath(target));
  const copiedContext = ensureObject(input.copiedContext || input.copied_context);
  const name = cleanText(input.name, 160) || `codex-paper-context-${Date.now()}`;
  const metadata = {
    task_type: 'codex-paper-context',
    parent_request_id: cleanText(input.parentRequestId || input.parent_request_id, 160),
    query,
    tags: ['literature', 'papers', 'context', 'codex'],
    copied_context: copiedContext,
    paper_target_count: paperTargets.length,
    readable_paper_target_count: readablePaperTargets.length,
    cwd: cleanText(input.cwd || input.source?.cwd, 2400),
    model: cleanText(input.model || input.source?.model, 120),
    reasoning_effort: cleanText(input.reasoningEffort || input.reasoning_effort || input.source?.reasoning_effort || input.source?.reasoningEffort, 40),
    enable_web_search: false
  };
  const commentTargetCount = paperTargets.filter((target) => asArray(target.related_comments).length).length;
  if (commentTargetCount) {
    metadata.paper_comment_target_count = commentTargetCount;
  }

  if (!readablePaperTargets.length) {
    return {
      ok: true,
      status: 'completed',
      selected_papers: [],
      loaded_context_blocks: [],
      papers_read_count: 0,
      notes: ['No downloaded paper.md files were available for exact line retrieval.'],
      summary: 'No extracted paper markdown files were available for line-range loading.',
      paper_targets: paperTargets
    };
  }

  const buildMessageForTarget = (paperTarget) => buildCodexPaperContextMessage({
    ...ensureObject(input.source),
    query,
    message: cleanText(input.message || input.source?.message, 2400),
    copied_context: copiedContext,
    paper_target: paperTarget
  }, { asArray, cleanText });

  const firstMessage = buildMessageForTarget(readablePaperTargets[0]);
  const created = await subAgentRuntime.createSubAgent({
    name,
    system_prompt: buildCodexPaperContextSystemPrompt(),
    message: firstMessage,
    metadata
  });
  if (!created?.ok) {
    return {
      ok: false,
      status: cleanText(created?.status, 40) || 'error',
      error: cleanText(created?.error, 1200) || 'Failed to create Codex paper context sub-agent.',
      sub_agent: buildSubAgentSummary(created?.agent)
    };
  }

  const agentId = cleanText(created?.agent?.id, 160);
  if (agentId && typeof subAgentRuntime.startSubAgentTask === 'function') {
    try {
      subAgentRuntime.startSubAgentTask({
        agent_id: agentId,
        task_type: 'codex-paper-context',
        summary: `Reading extracted paper markdown for ${query}.`,
        metadata: {
          query,
          paper_target_count: paperTargets.length
        }
      });
    } catch {
      // Keep task bookkeeping best-effort.
    }
  }

  const agentAfterCreate = agentId && typeof subAgentRuntime.getSubAgent === 'function'
    ? subAgentRuntime.getSubAgent({ agent_id: agentId })?.agent
    : created?.agent;

  let latestAgent = agentAfterCreate || created?.agent;
  const loadedBlocks = [];
  const selectedPaperRows = [];
  const notes = [];
  const rawResponses = [];

  const handlePaperTurn = async ({ paperTarget, turnAgent, turnSummary = '' }) => {
    const rawResponse = cleanText(
      turnAgent?.last_response?.assistant_message
        || turnSummary,
      120000
    );
    rawResponses.push(rawResponse);
    const parsed = parseJsonObjectFromText(rawResponse);
    if (!parsed) {
      return {
        ok: false,
        status: 'parse_error',
        error: 'Codex paper context sub-agent returned non-JSON output.',
        raw_response: cleanText(rawResponse, 4000)
      };
    }
    const linePayload = normalizeCodexPaperLinePayload(parsed, { asArray, cleanText });
    if (linePayload.ok === false) {
      return {
        ok: false,
        status: linePayload.status || 'failed',
        error: linePayload.error || 'Codex paper context sub-agent failed.',
        raw_response: cleanText(rawResponse, 4000)
      };
    }
    const hydrated = await hydrateLineSelectionsForPaper({
      paperTarget,
      linePayload,
      annotationContext,
      helpers: { asArray, cleanText }
    });
    notes.push(...linePayload.notes, ...hydrated.notes);
    if (hydrated.blocks.length) {
      loadedBlocks.push(...hydrated.blocks);
      selectedPaperRows.push(normalizeSelectedPaper({
        ...paperTarget,
        reason: linePayload.summary
          || cleanText(hydrated.blocks[0]?.relevance_reason, 500)
          || 'Selected exact line ranges from extracted paper markdown.'
      }, {}, { cleanText }));
    }
    return { ok: true, status: 'completed' };
  };

  let turnResult = await handlePaperTurn({
    paperTarget: readablePaperTargets[0],
    turnAgent: latestAgent,
    turnSummary: created?.summary
  });
  if (!turnResult.ok) {
    if (agentId && typeof subAgentRuntime.failSubAgentTask === 'function') {
      try {
        subAgentRuntime.failSubAgentTask({
          agent_id: agentId,
          summary: turnResult.error,
          error: cleanText(turnResult.raw_response || turnResult.error, 1200),
          metadata: { query }
        });
      } catch {
        // Keep task bookkeeping best-effort.
      }
    }
    return {
      ok: false,
      status: turnResult.status,
      error: turnResult.error,
      raw_response: turnResult.raw_response,
      sub_agent_id: agentId,
      sub_agent: buildSubAgentSummary(
        agentId && typeof subAgentRuntime.getSubAgent === 'function'
          ? subAgentRuntime.getSubAgent({ agent_id: agentId })?.agent
          : latestAgent
      ),
      paper_targets: paperTargets
    };
  }

  for (let index = 1; index < readablePaperTargets.length; index += 1) {
    if (typeof subAgentRuntime.sendSubAgentMessage !== 'function') {
      notes.push('Sub-agent runtime cannot send follow-up paper messages; remaining papers were not read.');
      break;
    }
    const paperTarget = readablePaperTargets[index];
    const sent = await subAgentRuntime.sendSubAgentMessage({
      agent_id: agentId,
      message: buildMessageForTarget(paperTarget),
      metadata: {
        task_type: 'codex-paper-context',
        query,
        paper_index: index + 1,
        paper_target_count: readablePaperTargets.length
      }
    });
    if (!sent?.ok) {
      notes.push(cleanText(sent?.error, 500) || `Paper ${index + 1} line selection failed.`);
      continue;
    }
    latestAgent = sent?.agent || latestAgent;
    turnResult = await handlePaperTurn({
      paperTarget,
      turnAgent: latestAgent,
      turnSummary: sent?.summary
    });
    if (!turnResult.ok) {
      notes.push(turnResult.error);
    }
    if (loadedBlocks.length >= DEFAULT_MAX_CONTEXT_BLOCKS) {
      break;
    }
  }

  const loadedContextBlocks = attachRelatedCommentsToContextBlocks(
    loadedBlocks.slice(0, DEFAULT_MAX_CONTEXT_BLOCKS),
    annotationContext,
    { asArray, cleanText }
  );
  const selectedPapersNormalized = selectedPaperRows
    .filter((paper, index, list) => paper.paper_id && list.findIndex((entry) => entry.paper_id === paper.paper_id) === index);
  const papersReadCount = new Set(loadedContextBlocks.map((block) => block.paper_id).filter(Boolean)).size;
  const normalized = {
    ok: true,
    status: 'completed',
    selected_papers: selectedPapersNormalized,
    loaded_context_blocks: loadedContextBlocks,
    papers_read_count: papersReadCount,
    notes: notes.filter(Boolean).slice(0, 16),
    summary: loadedContextBlocks.length
      ? `Read ${readablePaperTargets.length} extracted paper markdown file(s) and loaded ${loadedContextBlocks.length} exact line-backed context block(s).`
      : `Read ${readablePaperTargets.length} extracted paper markdown file(s) but did not load any line-backed context blocks.`
  };

  if (agentId && typeof subAgentRuntime.completeSubAgentTask === 'function') {
    try {
      subAgentRuntime.completeSubAgentTask({
        agent_id: agentId,
        summary: normalized.summary,
        metadata: {
          query,
          selected_count: normalized.selected_papers.length,
          context_block_count: normalized.loaded_context_blocks.length,
          papers_read_count: normalized.papers_read_count
        }
      });
    } catch {
      // Keep task bookkeeping best-effort.
    }
  }

  return {
    ...normalized,
    sub_agent_id: agentId,
    sub_agent: buildSubAgentSummary(
      agentId && typeof subAgentRuntime.getSubAgent === 'function'
        ? subAgentRuntime.getSubAgent({ agent_id: agentId })?.agent
        : latestAgent
    ),
    paper_targets: paperTargets,
    raw_responses: rawResponses.map((response) => cleanText(response, 4000)).filter(Boolean)
  };
}

module.exports = {
  runCodexPaperContextSubAgent,
  shouldUseCodexPaperContextWorkflow
};
