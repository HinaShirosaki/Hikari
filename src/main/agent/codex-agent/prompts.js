'use strict';

const path = require('path');

const {
  asArray,
  defaultCleanText,
  ensureObject
} = require('./runtime-utils.js');
const {
  buildHikariCodexMcpToolName
} = require('../mcp-contract/instructions.js');

function summarizeAttachments(cleanText, attachments = []) {
  return asArray(attachments)
    .map((attachment, index) => {
      const source = attachment && typeof attachment === 'object' ? attachment : {};
      const name = cleanText(source.name, 240) || `attachment-${index + 1}`;
      const kind = cleanText(source.kind, 40);
      const mimeType = cleanText(source.mimeType || source.mime_type, 160);
      const size = Number.isFinite(Number(source.size)) ? Number(source.size) : 0;
      return `- ${name}${kind ? ` (${kind})` : ''}${mimeType ? ` ${mimeType}` : ''}${size ? ` ${size} bytes` : ''}`;
    })
    .join('\n');
}

function resolveTransformedMarkdownPath({
  storagePath = '',
  relativePath = ''
} = {}, cleanText = defaultCleanText) {
  const normalizedRelativePath = cleanText(relativePath, 2400);
  if (!normalizedRelativePath) {
    return '';
  }
  if (path.isAbsolute(normalizedRelativePath)) {
    return normalizedRelativePath;
  }
  const normalizedStoragePath = cleanText(storagePath, 2400);
  if (!normalizedStoragePath) {
    return normalizedRelativePath;
  }
  return path.join(normalizedStoragePath, normalizedRelativePath);
}

function buildPaperAgentSessionBlock(input = {}, cleanText = defaultCleanText) {
  const snapshot = ensureObject(input.snapshot);
  const paperAgent = ensureObject(snapshot.paper_agent || snapshot.paperAgent);
  const activePaper = ensureObject(snapshot.activePaper || snapshot.active_paper);
  const sessionPrompt = cleanText(
    paperAgent.session_prompt
      || paperAgent.sessionPrompt
      || input.agent?.paperSessionPrompt,
    2400
  );
  const transformedMarkdownRelativePath = cleanText(
    paperAgent.transformed_markdown_relative_path
      || paperAgent.transformedMarkdownRelativePath
      || paperAgent.knowledge_markdown_relative_path
      || activePaper.transformed_markdown_relative_path
      || activePaper.knowledge_markdown_relative_path
      || activePaper.knowledgeMarkdownRelativePath,
    2400
  );
  const activePaperTitle = cleanText(
    paperAgent.active_paper_title
      || paperAgent.activePaperTitle
      || activePaper.title
      || activePaper.paper_title
      || activePaper.paperTitle,
    320
  );
  const activePaperId = cleanText(
    paperAgent.active_paper_id
      || paperAgent.activePaperId
      || activePaper.id
      || activePaper.paper_id
      || activePaper.paperId,
    220
  );
  if (!sessionPrompt && !transformedMarkdownRelativePath && !activePaperTitle && !activePaperId) {
    return '';
  }
  const storagePath = cleanText(snapshot.settings?.storagePath || snapshot.storagePath, 2400);
  const transformedMarkdownPath = resolveTransformedMarkdownPath({
    storagePath,
    relativePath: transformedMarkdownRelativePath
  }, cleanText);
  const paperContext = {
    active_paper_id: activePaperId,
    active_paper_title: activePaperTitle,
    transformed_markdown_relative_path: transformedMarkdownRelativePath,
    transformed_markdown_path: transformedMarkdownPath,
    knowledge_status: cleanText(paperAgent.knowledge_status || paperAgent.knowledgeStatus || activePaper.knowledge_status, 80)
  };
  return [
    'Paper agent session:',
    sessionPrompt || 'This chat is scoped to the active paper in the Papers view.',
    '',
    'Active paper context:',
    JSON.stringify(paperContext, null, 2)
  ].join('\n');
}

function normalizePreferredJournalNames(value, cleanText = defaultCleanText) {
  const candidates = [];
  function pushCandidate(candidate) {
    if (Array.isArray(candidate)) {
      candidate.forEach(pushCandidate);
      return;
    }
    if (candidate && typeof candidate === 'object') {
      pushCandidate(candidate.name || candidate.url || candidate.href || '');
      return;
    }
    String(candidate || '')
      .split(/[;\n]+/u)
      .map((item) => cleanText(item, 240).trim())
      .filter(Boolean)
      .forEach((item) => candidates.push(item));
  }
  pushCandidate(value);
  return candidates
    .filter((item, index, list) => {
      const key = item.toLowerCase();
      return key && list.findIndex((candidate) => candidate.toLowerCase() === key) === index;
    })
    .slice(0, 12);
}

function buildSavedSettingsBlock(input = {}, cleanText = defaultCleanText) {
  const snapshot = ensureObject(input.snapshot);
  const settings = ensureObject(snapshot.settings);
  const preferredJournals = normalizePreferredJournalNames([
    settings.preferredJournals,
    settings.preferred_journals,
    snapshot.preferredJournals,
    snapshot.preferred_journals,
    settings.preferredJournal,
    settings.preferred_journal,
    snapshot.preferredJournal,
    snapshot.preferred_journal
  ], cleanText);
  if (!preferredJournals.length) {
    return '';
  }
  return [
    'Saved Hikari settings:',
    JSON.stringify({
      preferred_journals: preferredJournals
    }, null, 2),
    '',
    'For literature-search requests, these saved preferred journals are already available to the Hikari MCP tools through the request context. Treat them as soft ranking preferences, including when the user says "from my preferred journals" or asks to use saved preferences. Do not call memory just to rediscover these saved settings. Do not pass a hard `journals` filter unless the current request explicitly names a restrictive filter such as "only" or "exclusively" those journals.'
  ].join('\n');
}

function buildCodexAgentPrompt(input = {}, { cleanText = defaultCleanText } = {}) {
  const message = cleanText(input.message, 24000);
  const attachmentText = summarizeAttachments(cleanText, input.attachments);
  const projectId = cleanText(input.projectId, 120);
  const projectName = cleanText(input.projectName, 220);
  const selectionInsight = ensureObject(input.selectionInsight);
  const paperAgentSessionBlock = buildPaperAgentSessionBlock(input, cleanText);
  const savedSettingsBlock = buildSavedSettingsBlock(input, cleanText);
  const protocolGenerationTool = buildHikariCodexMcpToolName('protocol_generation');
  const assayTableTool = buildHikariCodexMcpToolName('assay_table');
  const plotlyGraphTool = buildHikariCodexMcpToolName('plotly_graph');
  const blocks = [
    '# Hikari Codex Chat Turn',
    '',
    'You are handling this Hikari chat turn as the Codex reasoning agent. Own the lifecycle yourself: manage context in this Codex session, clarify if necessary, call prefixed Hikari MCP tools, verify the inference, and synthesize the final user-facing answer.',
    '',
    'The Codex instruction chain contains the durable Hikari Codex agent contract. If this turn is scoped to a selected project, the working directory may also contain project `MEMORY.md` and `.agents/skills`; treat them as the project-specific context and skill layers for this run.',
    '',
    'Hikari provides rendering and the MCP server. Use your Codex session context for continuity, tool choice, intent parsing, synthesis, and normal assistant prose for Hikari to render. Use native Codex search for external web evidence. Live thinking, progress, and tool activity are emitted by the Codex CLI stream.',
    '',
    'For a normal paper-discovery request, make at most one `mcp__hikari__literature_search` call. When a paper request needs both literature APIs and Codex web discovery, use API sources only (`pubmed`, `crossref`, and `europe_pmc`) in that Hikari call, then use native Codex web search separately. Do not include `web` in the Hikari call: that source would start a nested Codex CLI request and stall the current turn.',
    '',
    `Protocol generation handoff: when the user asks to generate, draft, create, prepare, build, or turn paper/method text into an experimental protocol, first author complete protocol JSON from the evidence, then call \`${protocolGenerationTool}\` with \`{ protocol, save: true }\`. After the tool call, summarize that the generated protocol is ready for review.`,
    '',
    `Assay context handoff: when this chat turn contains hidden assay context, retrieve the active assay data by reading the \`Assay plate data (TSV...)\` block inside this same prompt. Parse the TSV lines after the header \`well\\trow\\tcolumn\\tsample\\tconcentration\\tresult\` into explicit row objects, then call \`${assayTableTool}\` with \`action: "create"\` when calculations, regression, derived tables, or graphing are needed. Do not use local lookup tools for active assay plate data. If the TSV title says rows exist but the body rows are absent, report that the assay context was supplied without row data instead of trying lookup fallback paths. Use \`${plotlyGraphTool}\` only after the table or calculation data exists.`,
    '',
    projectId || projectName
      ? `Selected project:\n${JSON.stringify({ id: projectId, name: projectName }, null, 2)}`
      : 'Selected project: none',
    '',
    selectionInsight.actionType || selectionInsight.selectedText
      ? `Selection insight context:\n${JSON.stringify(selectionInsight, null, 2)}`
      : '',
    savedSettingsBlock,
    paperAgentSessionBlock,
    attachmentText ? `Attachments supplied by Hikari:\n${attachmentText}` : '',
    '',
    `Current user request:\n${message}`
  ];
  return blocks.filter((block) => cleanText(block, 1) || block === '').join('\n\n').trim();
}

function buildCodexAgentParserPayload(codexAgent = {}, {
  projectId = '',
  projectName = '',
  reasoningEffort = 0,
  cleanText = defaultCleanText
} = {}) {
  const needsClarification = cleanText(codexAgent.status, 40) === 'needs_more_info'
    || Boolean(codexAgent.user_question?.question);
  return {
    primary_intent: 'codex_agent',
    reasoning_effort: Number.isFinite(Number(reasoningEffort)) ? Number(reasoningEffort) : 0,
    direct_answer: needsClarification ? null : cleanText(codexAgent.answer, 12000) || null,
    needs_clarification: needsClarification,
    clarification_reason: needsClarification
      ? cleanText(codexAgent.user_question?.question || codexAgent.follow_up_questions?.[0] || codexAgent.answer, 500) || 'codex_agent_needs_more_info'
      : null,
    entities: {
      project_id: cleanText(projectId, 120),
      project_name: cleanText(projectName, 220)
    },
    inventory_search: {
      candidate_terms: []
    },
    protocol_candidates: [],
    reasoning_summary: cleanText(codexAgent.reasoning_summary, 1200)
      || 'Handled by the Codex-owned agent lifecycle.'
  };
}

function buildCodexMcpContext(input = {}, { cleanText = defaultCleanText } = {}) {
  const snapshot = ensureObject(input.snapshot);
  const activePaper = ensureObject(snapshot.activePaper || snapshot.active_paper);
  const paperAgent = ensureObject(snapshot.paper_agent || snapshot.paperAgent);
  const dataFilePath = cleanText(
    input.dataFilePath
      || input.data_file_path
      || snapshot?.data_file_path
      || snapshot?.dataFilePath,
    2000
  );
  const fallbackDataFilePath = cleanText(
    input.fallbackDataFilePath
      || input.fallback_data_file_path
      || dataFilePath,
    2000
  );
  const paperAgentRelativePath = cleanText(
    paperAgent.transformed_markdown_relative_path
      || paperAgent.transformedMarkdownRelativePath
      || paperAgent.knowledge_markdown_relative_path
      || activePaper.transformed_markdown_relative_path
      || activePaper.knowledge_markdown_relative_path
      || activePaper.knowledgeMarkdownRelativePath,
    2400
  );
  const paperAgentContext = Object.keys(paperAgent).length || paperAgentRelativePath
    ? {
      ...paperAgent,
      transformed_markdown_path: resolveTransformedMarkdownPath({
        storagePath: snapshot.settings?.storagePath || snapshot.storagePath,
        relativePath: paperAgentRelativePath
      }, cleanText)
    }
    : null;
  const contextSnapshot = {
    ...snapshot,
    ...(dataFilePath ? { data_file_path: dataFilePath } : {}),
    ...(fallbackDataFilePath ? { fallback_data_file_path: fallbackDataFilePath } : {})
  };
  return {
    provider: 'codex',
    model: cleanText(input.model, 120),
    cwd: cleanText(input.cwd, 1200),
    chatSessionId: cleanText(input.chatSessionId || input.chat_session_id, 120),
    codexSessionId: cleanText(input.codexSessionId || input.codex_session_id, 240),
    message: cleanText(input.message, 3200),
    conversation: [],
    project: {
      id: cleanText(input.projectId, 120),
      name: cleanText(input.projectName, 220)
    },
    projectId: cleanText(input.projectId, 120),
    projectName: cleanText(input.projectName, 220),
    activePaper: Object.keys(activePaper).length ? activePaper : null,
    paperAgent: paperAgentContext,
    snapshot: contextSnapshot,
    dataFilePath,
    fallbackDataFilePath,
    traceRequestId: cleanText(input.traceContext?.requestId, 120)
  };
}

module.exports = {
  buildCodexAgentParserPayload,
  buildCodexAgentPrompt,
  buildCodexMcpContext
};
