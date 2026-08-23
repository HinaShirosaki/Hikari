'use strict';

const fsPromises = require('node:fs/promises');
const { ensureObject } = require('../../lib/normalize.js');

const {
  attachRelatedCommentsToContextBlocks,
  buildPaperAnnotationContext,
  cloneJson,
  getRelatedCommentsForPaperId,
  normalizeRelatedComments
} = require('../shared/paper-comment-context.js');
const {
  normalizeLineRanges,
  inferMarkdownSectionLabel,
  readLineRangesFromText
} = require('./paper-line-ranges.js');
const {
  parseJsonObjectFromText,
  normalizeSelectedPaper,
  normalizeCodexPaperLinePayload
} = require('./codex-payload.js');

const DEFAULT_MAX_CONTEXT_BLOCKS = 50;

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text;
}

function normalizeProvider(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, '-');
}

function shouldUseCodexPaperContextWorkflow(input = {}) {
  const source = ensureObject(input);
  // Single tristate flag: true forces on, false forces off, absent falls back to the provider default.
  if (source.codex_paper_context === true || source.codexPaperContext === true) {
    return true;
  }
  if (source.codex_paper_context === false || source.codexPaperContext === false) {
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
      notes: ['No downloaded paper Markdown files were available for exact line retrieval.'],
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
