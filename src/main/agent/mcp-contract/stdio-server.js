#!/usr/bin/env node
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

const { createAgentMcpGateway } = require('./gateway.js');
const { createAgentMcpHostToolRunner } = require('./host-client.js');
const { getDirectMcpToolDefinitions } = require('./direct-tools/index.js');
const { buildHikariAgentMcpInstructions } = require('./instructions.js');
const { asArray, ensureObject } = require('../../lib/normalize.js');

const SERVER_NAME = 'hikari-agent-mcp';
const SERVER_VERSION = '0.1.0';
const MAX_MODEL_PAPERS = 12;
const MAX_MODEL_CONTEXT_BLOCKS = 8;
// Ceiling for the text block the model actually reads. literature_search shrinks
// itself above; every other tool forwards its app result verbatim, so an oversized
// paper_analysis or paper_download result would otherwise land whole in context.
const MAX_MODEL_TEXT_CHARS = 60000;
const MODEL_TEXT_PREVIEW_CHARS = 40000;

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function compactObject(value = {}) {
  return Object.entries(ensureObject(value)).reduce((out, [key, entryValue]) => {
    if (entryValue === undefined || entryValue === null) {
      return out;
    }
    if (typeof entryValue === 'string' && !entryValue) {
      return out;
    }
    out[key] = entryValue;
    return out;
  }, {});
}

function parseJsonObject(raw = '') {
  try {
    const parsed = JSON.parse(String(raw || ''));
    return ensureObject(parsed);
  } catch {
    return {};
  }
}

function getRequestContextFromEnv(env = process.env) {
  return parseJsonObject(
    env.HIKARI_AGENT_MCP_REQUEST_CONTEXT
      || env.HIKARI_CODEX_REQUEST_CONTEXT
  );
}

function createMcpToolDefinitions() {
  return getDirectMcpToolDefinitions();
}

function countSuccessfulDownloads(downloadedPapers = []) {
  return asArray(downloadedPapers).filter((paper) => paper?.ok === true && paper?.status !== 'reused').length;
}

function compactSelectedPaper(paper = {}) {
  return compactObject({
    paper_id: cleanText(paper.paper_id || paper.paperId, 120),
    paper_title: cleanText(paper.paper_title || paper.paperTitle || paper.title, 320),
    source: cleanText(paper.source, 80),
    journal: cleanText(paper.journal || paper.journal_name || paper.journalName, 220),
    published_at: cleanText(paper.published_at || paper.publishedAt, 80),
    doi: cleanText(paper.doi, 180),
    pmid: cleanText(paper.pmid, 120),
    pmcid: cleanText(paper.pmcid, 120),
    url: cleanText(paper.url, 1200),
    pdf_urls: asArray(paper.pdf_urls || paper.pdfUrls).map((url) => cleanText(url, 1200)).filter(Boolean).slice(0, 4),
    download_available: paper.download_available === true || paper.downloadAvailable === true,
    download_status: cleanText(paper.download_status || paper.downloadStatus, 80),
    score: Number.isFinite(Number(paper.score)) ? Number(paper.score) : undefined,
    summary: cleanText(paper.summary || paper.snippet, 700)
  });
}

function compactDownloadedPaper(paper = {}) {
  return compactObject({
    paper_id: cleanText(paper.paper_id || paper.paperId, 120),
    paper_title: cleanText(paper.paper_title || paper.paperTitle || paper.title, 320),
    ok: paper.ok === true,
    status: cleanText(paper.status, 80),
    file_name: cleanText(paper.file_name || paper.fileName, 240),
    relative_path: cleanText(paper.relative_path || paper.relativePath, 2000),
    knowledge_markdown_relative_path: cleanText(
      paper.knowledge_markdown_relative_path || paper.knowledgeMarkdownRelativePath,
      2000
    ),
    error: cleanText(paper.error, 700)
  });
}

function compactLineRange(range = {}) {
  const startLine = Math.round(Number(range.start_line || range.startLine));
  const endLine = Math.round(Number(range.end_line || range.endLine || startLine));
  if (!Number.isFinite(startLine) || startLine < 1 || !Number.isFinite(endLine) || endLine < startLine) {
    return null;
  }
  return { start_line: startLine, end_line: endLine };
}

function compactSourceLine(line = {}) {
  const lineNumber = Math.round(Number(line.line_number || line.lineNumber));
  if (!Number.isFinite(lineNumber) || lineNumber < 1) {
    return null;
  }
  return {
    line_number: lineNumber,
    content: String(line.content ?? line.text ?? '')
  };
}

function compactRelatedComment(comment = {}) {
  const pageNumber = Math.round(Number(comment.page_number || comment.pageNumber));
  return compactObject({
    id: cleanText(comment.id, 160),
    text: cleanText(comment.text || comment.comment || comment.note, 1200),
    author: cleanText(comment.author, 160),
    page_number: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : undefined,
    highlight_id: cleanText(comment.highlight_id || comment.highlightId, 160),
    highlight_text: cleanText(comment.highlight_text || comment.highlightText, 1200),
    relation: cleanText(comment.relation, 80)
  });
}

function compactPaperAnalysisProtocol(protocol = {}) {
  const source = ensureObject(protocol);
  if (!Object.keys(source).length) {
    return undefined;
  }
  const steps = asArray(source.steps).slice(0, 20).map((step, index) => {
    if (typeof step === 'string') {
      return cleanText(step, 600);
    }
    const row = ensureObject(step);
    return compactObject({
      id: cleanText(row.id, 120) || `step-${index + 1}`,
      text: cleanText(row.text || row.instruction || row.action, 600)
    });
  }).filter((step) => (typeof step === 'string' ? step : step.text));
  return compactObject({
    title: cleanText(source.title || source.name, 220),
    purpose: cleanText(source.purpose, 600),
    method_text: cleanText(source.method_text || source.methodText, 4000),
    materials: asArray(source.materials).map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 20),
    steps,
    notes: cleanText(source.notes || source.troubleshooting, 800)
  });
}

function compactGeneratedProtocolSummary(protocol = {}) {
  const source = ensureObject(protocol);
  if (!Object.keys(source).length) {
    return undefined;
  }
  return compactObject({
    id: cleanText(source.id || source.protocol_id || source.protocolId, 160),
    name: cleanText(source.name || source.title, 220),
    purpose: cleanText(source.purpose, 600),
    status: cleanText(source.status, 80),
    material_count: asArray(source.materials).length,
    step_count: asArray(source.steps).length
  });
}

function compactContextBlock(block = {}) {
  const lineRanges = asArray(block.line_ranges || block.lineRanges).map(compactLineRange).filter(Boolean);
  const sourceLines = asArray(block.source_lines || block.sourceLines).map(compactSourceLine).filter(Boolean);
  const relatedComments = asArray(block.related_comments || block.relatedComments)
    .map(compactRelatedComment)
    .filter((comment) => comment.id && comment.text)
    .slice(0, 4);
  return compactObject({
    paper_id: cleanText(block.paper_id || block.paperId, 120),
    paper_title: cleanText(block.paper_title || block.paperTitle, 320),
    section_label: cleanText(block.section_label || block.sectionLabel, 160),
    source: cleanText(block.source, 80),
    evidence_kind: cleanText(block.evidence_kind || block.evidenceKind, 80),
    relevance_reason: cleanText(block.relevance_reason || block.relevanceReason, 260),
    excerpt: cleanText(block.excerpt, 1000),
    line_ranges: lineRanges.length ? lineRanges : undefined,
    source_lines: sourceLines.length ? sourceLines : undefined,
    source_line_count: Number.isFinite(Number(block.source_line_count || block.sourceLineCount))
      ? Number(block.source_line_count || block.sourceLineCount)
      : undefined,
    source_path: cleanText(block.source_path || block.sourcePath, 2000),
    related_comments: relatedComments.length ? relatedComments : undefined
  });
}

function compactPaperAnalysisSelectedPaper(paper = {}) {
  return compactObject({
    paper_id: cleanText(paper.paper_id || paper.paperId, 0),
    paper_title: cleanText(paper.paper_title || paper.paperTitle || paper.title, 0),
    source: cleanText(paper.source, 0),
    journal: cleanText(paper.journal || paper.journal_name || paper.journalName, 0),
    published_at: cleanText(paper.published_at || paper.publishedAt, 0),
    doi: cleanText(paper.doi, 0),
    pmid: cleanText(paper.pmid, 0),
    pmcid: cleanText(paper.pmcid, 0),
    url: cleanText(paper.url, 0),
    pdf_urls: asArray(paper.pdf_urls || paper.pdfUrls).map((url) => cleanText(url, 0)).filter(Boolean),
    download_available: paper.download_available === true || paper.downloadAvailable === true,
    download_status: cleanText(paper.download_status || paper.downloadStatus, 0),
    score: Number.isFinite(Number(paper.score)) ? Number(paper.score) : undefined,
    summary: cleanText(paper.summary || paper.snippet, 0)
  });
}

function compactPaperAnalysisContextBlock(block = {}) {
  const lineRanges = asArray(block.line_ranges || block.lineRanges).map(compactLineRange).filter(Boolean);
  const sourceLines = asArray(block.source_lines || block.sourceLines).map(compactSourceLine).filter(Boolean);
  const relatedComments = asArray(block.related_comments || block.relatedComments)
    .map((comment = {}) => {
      const pageNumber = Math.round(Number(comment.page_number || comment.pageNumber));
      return compactObject({
        id: cleanText(comment.id, 0),
        text: cleanText(comment.text || comment.comment || comment.note, 0),
        author: cleanText(comment.author, 0),
        page_number: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : undefined,
        highlight_id: cleanText(comment.highlight_id || comment.highlightId, 0),
        highlight_text: cleanText(comment.highlight_text || comment.highlightText, 0),
        relation: cleanText(comment.relation, 0)
      });
    })
    .filter((comment) => comment.text);
  return compactObject({
    block_id: cleanText(block.block_id || block.blockId, 0),
    paper_id: cleanText(block.paper_id || block.paperId, 0),
    paper_title: cleanText(block.paper_title || block.paperTitle, 0),
    section_label: cleanText(block.section_label || block.sectionLabel, 0),
    source: cleanText(block.source, 0),
    evidence_kind: cleanText(block.evidence_kind || block.evidenceKind, 0),
    relevance_reason: cleanText(block.relevance_reason || block.relevanceReason, 0),
    // Exact source lines already carry the excerpt without a second copy.
    excerpt: sourceLines.length ? undefined : cleanText(block.excerpt, 0),
    line_ranges: lineRanges.length ? lineRanges : undefined,
    source_lines: sourceLines.length ? sourceLines : undefined,
    source_line_count: Number.isFinite(Number(block.source_line_count || block.sourceLineCount))
      ? Number(block.source_line_count || block.sourceLineCount)
      : undefined,
    source_path: cleanText(block.source_path || block.sourcePath, 0),
    related_comments: relatedComments.length ? relatedComments : undefined
  });
}

function isLiteratureSearchResult(toolName = '', result = {}) {
  const source = ensureObject(result);
  const output = ensureObject(source.output);
  const nestedResult = ensureObject(output.result);
  return cleanText(toolName, 160) === 'literature_search'
    || cleanText(source.mcp_tool, 160) === 'literature_search'
    || cleanText(source.app_tool, 160) === 'literature-search'
    || cleanText(output.mcp_tool, 160) === 'literature_search'
    || cleanText(output.app_tool, 160) === 'literature-search'
    || cleanText(nestedResult.mcp_tool, 160) === 'literature_search'
    || cleanText(nestedResult.app_tool, 160) === 'literature-search'
    || asArray(output.selected_papers).length > 0
    || asArray(output.loaded_context_blocks).length > 0
    || asArray(nestedResult.selected_papers).length > 0
    || asArray(nestedResult.loaded_context_blocks).length > 0
    || asArray(source.selected_papers).length > 0
    || asArray(source.loaded_context_blocks).length > 0;
}

function isPaperAnalysisResult(toolName = '', result = {}) {
  const source = ensureObject(result);
  const output = ensureObject(source.output);
  const nestedResult = ensureObject(output.result);
  return cleanText(toolName, 160) === 'paper_analysis'
    || cleanText(source.mcp_tool, 160) === 'paper_analysis'
    || cleanText(source.app_tool, 160) === 'paper-analysis'
    || cleanText(output.mcp_tool, 160) === 'paper_analysis'
    || cleanText(output.app_tool, 160) === 'paper-analysis'
    || cleanText(nestedResult.mcp_tool, 160) === 'paper_analysis'
    || cleanText(nestedResult.app_tool, 160) === 'paper-analysis';
}

function getToolResultPayload(result = {}) {
  const source = ensureObject(result);
  const output = ensureObject(source.output);
  const nestedResult = ensureObject(output.result);
  if (Object.keys(nestedResult).length) {
    return nestedResult;
  }
  if (Object.keys(output).length) {
    return output;
  }
  return source;
}

function buildLiteratureSearchModelPayload(toolName = '', result = {}) {
  const source = ensureObject(result);
  const output = getToolResultPayload(source);
  const selectedPapers = asArray(output.selected_papers);
  const downloadedPapers = asArray(output.downloaded_papers);
  const loadedContextBlocks = asArray(output.loaded_context_blocks);
  return {
    ok: source.ok !== false && output.ok !== false,
    status: cleanText(output.status || source.status, 80),
    mcp_tool: cleanText(source.mcp_tool || toolName, 160),
    app_tool: cleanText(source.app_tool || output.app_tool || 'literature-search', 160),
    summary: cleanText(output.summary || source.summary, 1200),
    error: cleanText(output.error || source.error, 1200),
    query: cleanText(output.query || source.query, 600),
    counts: {
      candidate_count: asArray(output.items).length,
      selected_count: selectedPapers.length,
      downloaded_count: countSuccessfulDownloads(downloadedPapers),
      downloaded_result_count: downloadedPapers.length,
      context_block_count: loadedContextBlocks.length,
      papers_read_count: Number(output.papers_read_count) || 0
    },
    source_counts: ensureObject(output.source_counts),
    source_errors: ensureObject(output.source_errors),
    selected_papers: selectedPapers.slice(0, MAX_MODEL_PAPERS).map(compactSelectedPaper),
    downloaded_papers: downloadedPapers.slice(0, MAX_MODEL_PAPERS).map(compactDownloadedPaper),
    loaded_context_blocks: loadedContextBlocks.slice(0, MAX_MODEL_CONTEXT_BLOCKS).map(compactContextBlock),
    omitted: {
      selected_papers: Math.max(0, selectedPapers.length - MAX_MODEL_PAPERS),
      downloaded_papers: Math.max(0, downloadedPapers.length - MAX_MODEL_PAPERS),
      loaded_context_blocks: Math.max(0, loadedContextBlocks.length - MAX_MODEL_CONTEXT_BLOCKS)
    },
    // The source_lines / related_comments / link-label rules live in the server
    // instructions, which are sent once per session instead of on every call.
    model_note: 'Use selected_papers, downloaded_papers, and loaded_context_blocks above as the source of truth.'
  };
}

// paper_analysis returns query-selected, line-backed evidence. Keep one compact
// copy of every selected block, exact source line, relevance comment, and saved
// annotation. The stdio response intentionally omits the duplicate full
// structuredContent object for this tool, so transport size stays proportional
// to the evidence without imposing an arbitrary character or item limit.
function buildPaperAnalysisModelPayload(toolName = '', result = {}) {
  const source = ensureObject(result);
  const output = getToolResultPayload(source);
  const selectedPapers = asArray(output.selected_papers);
  const rawContextBlocks = asArray(output.loaded_context_blocks);
  const compactedContextBlocks = rawContextBlocks.map(compactPaperAnalysisContextBlock);
  const totalSourceLines = rawContextBlocks.reduce((count, block) => (
    count + asArray(block?.source_lines || block?.sourceLines).length
  ), 0);
  const analysisComments = compactedContextBlocks
    .map((block) => compactObject({
      block_id: block.block_id,
      section_label: block.section_label,
      comment: block.relevance_reason
    }))
    .filter((comment) => comment.comment);
  return {
    ok: source.ok !== false && output.ok !== false,
    status: cleanText(output.status || source.status, 0),
    mcp_tool: cleanText(source.mcp_tool || toolName, 0),
    app_tool: cleanText(source.app_tool || output.app_tool || 'paper-analysis', 0),
    summary: cleanText(output.summary || source.summary, 0),
    error: cleanText(output.error || source.error, 0),
    query: cleanText(output.query || source.query, 0),
    paper_title: cleanText(output.paper_title || output.paperTitle, 0),
    brief_summary: cleanText(output.brief_summary || output.briefSummary, 0),
    key_findings: asArray(output.key_findings || output.keyFindings)
      .map((finding) => cleanText(finding, 0))
      .filter(Boolean),
    method_overview: cleanText(output.method_overview || output.methodOverview, 0),
    protocol_extraction: compactPaperAnalysisProtocol(
      output.protocol_extraction || output.protocolExtraction
    ),
    generated_protocol: compactGeneratedProtocolSummary(
      output.generated_protocol || output.generatedProtocol
    ),
    counts: {
      selected_count: selectedPapers.length,
      context_block_count: rawContextBlocks.length,
      source_line_count: totalSourceLines,
      papers_read_count: Number(output.papers_read_count) || 0
    },
    selected_papers: selectedPapers.map(compactPaperAnalysisSelectedPaper),
    loaded_context_blocks: compactedContextBlocks,
    analysis_comments: analysisComments,
    notes: asArray(output.notes).map((note) => cleanText(note, 0)).filter(Boolean),
    model_note: rawContextBlocks.length
      ? 'Use loaded_context_blocks.source_lines as paper evidence. analysis_comments are the sub-agent relevance comments explaining why those lines were selected. related_comments are saved user annotations. When asked about notes or comments, report these two categories separately and never claim there are no comments when analysis_comments is non-empty.'
      : 'Use brief_summary, key_findings, method_overview, and protocol_extraction as the paper-analysis result.'
  };
}

// Keep the spine and as much of the result as fits, rather than dropping the
// payload outright: the model still needs the head of the data to answer, and
// structuredContent carries the untruncated result for clients that read it.
function buildTruncatedModelPayload(payload = {}, text = '', resultPreview = '') {
  const source = ensureObject(payload);
  return compactObject({
    ok: source.ok !== false,
    status: cleanText(source.status, 80),
    mcp_tool: cleanText(source.mcp_tool, 160),
    app_tool: cleanText(source.app_tool, 160),
    summary: cleanText(source.summary, 1200),
    error: cleanText(source.error, 1200),
    truncated: {
      reason: 'result_exceeded_model_text_budget',
      original_chars: text.length,
      max_chars: MAX_MODEL_TEXT_CHARS
    },
    result_preview: resultPreview,
    model_note: 'result_preview is the leading slice of this tool result as JSON text, cut mid-document and not parseable on its own. Use it only when it fully covers the requested fact; otherwise report that the result was truncated rather than guessing at the omitted tail.'
  });
}

function serializeTruncatedModelPayload(payload = {}, text = '') {
  let previewLength = Math.min(MODEL_TEXT_PREVIEW_CHARS, text.length);
  while (previewLength > 0) {
    const candidate = JSON.stringify(
      buildTruncatedModelPayload(payload, text, text.slice(0, previewLength)),
      null,
      2
    );
    if (candidate.length <= MAX_MODEL_TEXT_CHARS) {
      return candidate;
    }
    previewLength = Math.floor(previewLength * 0.8);
  }
  return JSON.stringify(buildTruncatedModelPayload(payload, text), null, 2);
}

function buildMcpToolResponseContent(toolName = '', result = {}) {
  const paperAnalysisResult = isPaperAnalysisResult(toolName, result);
  const payload = paperAnalysisResult
    ? buildPaperAnalysisModelPayload(toolName, result)
    : (isLiteratureSearchResult(toolName, result)
      ? buildLiteratureSearchModelPayload(toolName, result)
      : ensureObject(result));
  const text = JSON.stringify(payload, null, 2);
  if (paperAnalysisResult) {
    return text;
  }
  if (text.length <= MAX_MODEL_TEXT_CHARS) {
    return text;
  }
  return serializeTruncatedModelPayload(payload, text);
}

function createAgentMcpStdioServer(deps = {}) {
  const env = deps.env && typeof deps.env === 'object' ? deps.env : process.env;
  const runTool = typeof deps.runTool === 'function'
    ? deps.runTool
    : createAgentMcpHostToolRunner(deps);
  const gateway = deps.gateway || createAgentMcpGateway({
    ...deps,
    ...(runTool ? { runTool } : {})
  });

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: buildHikariAgentMcpInstructions()
    }
  );
  let literatureSearchCalls = 0;
  let literatureSearchTurnKey = null;

  // The one-literature_search-per-turn budget is keyed on the request context's
  // turn id, not on process lifetime. Codex respawns this stdio server per request
  // today, so a bare counter happens to reset; keying it explicitly means a reused
  // server cannot carry a spent budget into the next turn and reject every later
  // search with a message that claims the current turn already used one.
  function claimLiteratureSearchCall(turnKey) {
    if (turnKey !== literatureSearchTurnKey) {
      literatureSearchTurnKey = turnKey;
      literatureSearchCalls = 0;
    }
    if (literatureSearchCalls >= 1) {
      return false;
    }
    literatureSearchCalls += 1;
    return true;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: createMcpToolDefinitions()
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const params = ensureObject(request?.params);
    const toolName = cleanText(params.name, 160);
    const requestContext = getRequestContextFromEnv(env);
    const turnKey = cleanText(requestContext.traceRequestId || requestContext.codexSessionId, 240);
    if (toolName === 'literature_search' && !claimLiteratureSearchCall(turnKey)) {
      const result = {
        ok: false,
        status: 'rejected',
        mcp_tool: toolName,
        app_tool: 'literature-search',
        error: 'This Codex turn already completed one literature_search request. Use its structured result to answer, or ask the user to start a refinement turn.'
      };
      return {
        content: [{
          type: 'text',
          text: buildMcpToolResponseContent(toolName, result)
        }],
        structuredContent: result,
        isError: true
      };
    }
    const result = await gateway.callGatewayTool(
      toolName,
      ensureObject(params.arguments),
      {
        ...requestContext,
        mcpRequest: request
      }
    );
    const response = {
      content: [{
        type: 'text',
        text: buildMcpToolResponseContent(toolName, result)
      }],
      isError: result?.ok === false
    };
    // paper_analysis already carries every selected line and comment in its one
    // compact text payload. Repeating the full gateway result here made Codex
    // serialize two copies and truncate the otherwise-valid response.
    if (!isPaperAnalysisResult(toolName, result)) {
      response.structuredContent = ensureObject(result);
    }
    return response;
  });

  let transport = null;

  async function connect(externalTransport) {
    transport = externalTransport;
    await server.connect(externalTransport);
    return server;
  }

  async function start() {
    if (transport) {
      return server;
    }
    transport = new StdioServerTransport();
    await server.connect(transport);
    return server;
  }

  async function close() {
    await server.close();
    transport = null;
  }

  return {
    server,
    gateway,
    connect,
    start,
    close
  };
}

if (require.main === module) {
  createAgentMcpStdioServer().start().catch((error) => {
    process.stderr.write(`Hikari MCP stdio server failed to start: ${error?.message || error}\n`);
    process.exit(1);
  });
}

const createCodexAgentMcpStdioServer = createAgentMcpStdioServer;

module.exports = {
  createMcpToolDefinitions,
  createAgentMcpStdioServer,
  createCodexAgentMcpStdioServer,
  getRequestContextFromEnv,
  buildMcpToolResponseContent
};
