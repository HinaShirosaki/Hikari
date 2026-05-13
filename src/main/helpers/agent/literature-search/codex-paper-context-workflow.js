'use strict';

const DEFAULT_MAX_CONTEXT_BLOCKS = 50;

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

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
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
      }
    };
  });
}

function buildCodexPaperContextSystemPrompt() {
  return [
    'You are the Codex paper-context sub-agent for Hikari.',
    'The main Hikari agent already searched paper databases, selected candidate records, downloaded available PDFs, and extracted downloaded PDFs into LLM-facing Markdown.',
    'Your job is to read the provided Markdown files, choose the smallest useful set of grounded excerpts for the main agent context, and return structured JSON only.',
    'Do not call Hikari literature-search or paper-download from this sub-agent task. Re-entering those tools would loop back into the main workflow.',
    'Use the paper_id values exactly as provided. Do not invent citations, paper ids, downloaded files, or full-text evidence.'
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
    selected_papers: [
      {
        paper_id: 'paper-1',
        paper_title: 'Paper title',
        reason: 'Why this paper is useful for the request.'
      }
    ],
    loaded_context_blocks: [
      {
        paper_id: 'paper-1',
        paper_title: 'Paper title',
        section_label: 'Methods',
        excerpt: 'Short verbatim or tightly paraphrased excerpt from the markdown.',
        relevance_reason: 'Why this block should enter the main context.',
        source: 'knowledge_markdown',
        evidence_kind: 'text'
      }
    ],
    papers_read_count: 1,
    notes: [],
    summary: 'Read 1 extracted paper markdown file and loaded 1 context block.'
  };

  return [
    '# Codex Paper Context Selection Task',
    '',
    `Main-agent request:\n${cleanText(source.message || source.query || source.topic, 2400)}`,
    '',
    `Query:\n${cleanText(source.query, 600)}`,
    '',
    `Copied main-agent context JSON:\n${JSON.stringify(ensureObject(source.copied_context || source.copiedContext), null, 2)}`,
    '',
    `Paper read targets JSON:\n${JSON.stringify(asArray(source.paper_targets || source.paperTargets), null, 2)}`,
    '',
    'Workflow rules:',
    '- First read each available `download.knowledge_markdown_path`; it is the LLM-facing markdown extracted from the downloaded PDF.',
    '- If a markdown path is unavailable or unreadable, use only the supplied paper summary/abstract metadata and mark returned block source as `paper_summary`.',
    '- Choose only context that directly helps answer the main-agent request.',
    `- Return at most ${maxBlocks} loaded_context_blocks total.`,
    '- Keep each excerpt concise enough for prompt context and preserve section labels when the markdown exposes them.',
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
    evidence_kind: cleanText(source.evidence_kind || source.evidenceKind, 40) || 'text'
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

  const loadedBlocks = asArray(source.loaded_context_blocks || source.loadedContextBlocks || source.context_blocks || source.contextBlocks)
    .map((block) => normalizeContextBlock(block, fallbackById, { cleanText }))
    .filter(Boolean);
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
  const paperTargets = buildPaperReadTargets(selectedPapers, downloadedPapers, { asArray, cleanText });
  const copiedContext = ensureObject(input.copiedContext || input.copied_context);
  const message = buildCodexPaperContextMessage({
    ...ensureObject(input.source),
    query,
    message: cleanText(input.message || input.source?.message, 2400),
    copied_context: copiedContext,
    paper_targets: paperTargets
  }, { asArray, cleanText });
  const name = cleanText(input.name, 160) || `codex-paper-context-${Date.now()}`;
  const metadata = {
    task_type: 'codex-paper-context',
    parent_request_id: cleanText(input.parentRequestId || input.parent_request_id, 160),
    query,
    tags: ['literature', 'papers', 'context', 'codex'],
    copied_context: copiedContext,
    paper_target_count: paperTargets.length,
    cwd: cleanText(input.cwd || input.source?.cwd, 2400),
    model: cleanText(input.model || input.source?.model, 120),
    reasoning_effort: cleanText(input.reasoningEffort || input.reasoning_effort || input.source?.reasoning_effort || input.source?.reasoningEffort, 40),
    enable_web_search: false
  };

  const created = await subAgentRuntime.createSubAgent({
    name,
    system_prompt: buildCodexPaperContextSystemPrompt(),
    message,
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
  const rawResponse = cleanText(
    agentAfterCreate?.last_response?.assistant_message
      || created?.agent?.last_response?.assistant_message
      || created?.summary,
    120000
  );
  const parsed = parseJsonObjectFromText(rawResponse);
  if (!parsed) {
    if (agentId && typeof subAgentRuntime.failSubAgentTask === 'function') {
      try {
        subAgentRuntime.failSubAgentTask({
          agent_id: agentId,
          summary: 'Codex paper context sub-agent returned non-JSON output.',
          error: cleanText(rawResponse, 1200),
          metadata: { query }
        });
      } catch {
        // Keep task bookkeeping best-effort.
      }
    }
    return {
      ok: false,
      status: 'parse_error',
      error: 'Codex paper context sub-agent returned non-JSON output.',
      raw_response: cleanText(rawResponse, 4000),
      sub_agent_id: agentId,
      sub_agent: buildSubAgentSummary(
        agentId && typeof subAgentRuntime.getSubAgent === 'function'
          ? subAgentRuntime.getSubAgent({ agent_id: agentId })?.agent
          : agentAfterCreate
      )
    };
  }

  const normalized = normalizeCodexPaperContextPayload(parsed, {
    selected_papers: selectedPapers
  }, { asArray, cleanText });
  if (normalized.ok === false) {
    if (agentId && typeof subAgentRuntime.failSubAgentTask === 'function') {
      try {
        subAgentRuntime.failSubAgentTask({
          agent_id: agentId,
          summary: normalized.summary || 'Codex paper context sub-agent failed.',
          error: cleanText(parsed.error, 1200),
          metadata: { query }
        });
      } catch {
        // Keep task bookkeeping best-effort.
      }
    }
  } else if (agentId && typeof subAgentRuntime.completeSubAgentTask === 'function') {
    try {
      subAgentRuntime.completeSubAgentTask({
        agent_id: agentId,
        summary: normalized.summary || `Loaded ${normalized.loaded_context_blocks.length} paper context block(s).`,
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
        : agentAfterCreate
    ),
    paper_targets: paperTargets
  };
}

module.exports = {
  DEFAULT_MAX_CONTEXT_BLOCKS,
  buildCodexPaperContextMessage,
  buildCodexPaperContextSystemPrompt,
  buildPaperReadTargets,
  normalizeCodexPaperContextPayload,
  parseJsonObjectFromText,
  runCodexPaperContextSubAgent,
  shouldUseCodexPaperContextWorkflow
};
