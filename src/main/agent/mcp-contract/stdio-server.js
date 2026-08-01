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

const SERVER_NAME = 'hikari-agent-mcp';
const SERVER_VERSION = '0.1.0';
const MAX_MODEL_PAPERS = 12;
const MAX_MODEL_CONTEXT_BLOCKS = 8;

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

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
    full_result_available_in_structured_content: true,
    model_note: 'Use selected_papers, downloaded_papers, and loaded_context_blocks above as the source of truth. In line-backed context blocks, source_lines are verbatim application-extracted paper Markdown lines selected by line_ranges; do not attribute text that is absent from source_lines. Treat related_comments as local user comments, not paper text. When citing a local source_path, use paper_title as the visible link label instead of the raw Markdown filename.'
  };
}

function buildMcpToolResponseContent(toolName = '', result = {}) {
  const payload = isLiteratureSearchResult(toolName, result)
    ? buildLiteratureSearchModelPayload(toolName, result)
    : ensureObject(result);
  return JSON.stringify(payload, null, 2);
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: createMcpToolDefinitions()
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const params = ensureObject(request?.params);
    const toolName = cleanText(params.name, 160);
    if (toolName === 'literature_search' && literatureSearchCalls >= 1) {
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
    if (toolName === 'literature_search') {
      literatureSearchCalls += 1;
    }
    const result = await gateway.callGatewayTool(
      toolName,
      ensureObject(params.arguments),
      {
        ...getRequestContextFromEnv(env),
        mcpRequest: request
      }
    );
    return {
      content: [{
        type: 'text',
        text: buildMcpToolResponseContent(toolName, result)
      }],
      structuredContent: ensureObject(result),
      isError: result?.ok === false
    };
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
