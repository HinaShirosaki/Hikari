import { asArray, trimText } from './shared.js';

const DEFAULT_SCOPE_KEY = 'papers:library';
const DEFAULT_NOTEBOOK_SCOPE_KEY = 'notebook:workspace';
const DEFAULT_ASSAY_SCOPE_KEY = 'assay:workspace';

function buildPaperAgentSessionPrompt(context = {}) {
  const paperId = trimText(context.paperId, 220);
  const paperTitle = trimText(context.paperTitle, 320);
  const markdownPath = trimText(context.knowledgeMarkdownRelativePath, 2400);
  if (!paperId && !paperTitle && !markdownPath) {
    return '';
  }
  const lines = [
    'You are in a Papers right-rail chat session. Treat the active PDF as the default subject when the user says "this paper".',
    'Use the transformed markdown paper.md when it is available; it is the LLM-facing markdown extracted from the PDF.',
    'For paper-specific claims, methods, results, figures, or citations, read the transformed markdown before answering when a markdown path is provided.',
    'If the transformed markdown is unavailable or cannot be read, say so and fall back to the stored summary, highlights, comments, and visible paper metadata.',
    'Do not claim that you read the PDF or transformed markdown unless you actually used the available paper content.'
  ];
  if (paperTitle) {
    lines.push(`Active paper title: ${paperTitle}`);
  }
  if (paperId) {
    lines.push(`Active paper id: ${paperId}`);
  }
  if (markdownPath) {
    lines.push(`Transformed markdown relative path: ${markdownPath}`);
  }
  return lines.join('\n');
}

function buildNotebookAgentSessionPrompt(context = {}) {
  const entryId = trimText(context.notebookEntryId, 220);
  const pageTitle = trimText(context.pageTitle, 320);
  const projectName = trimText(context.projectName, 220);
  const protocolName = trimText(context.protocolName, 220);
  if (!entryId && !pageTitle && !projectName && !protocolName) {
    return '';
  }
  const lines = [
    'You are in a Biology Notebook right-rail chat session. Treat the active notebook page as the default subject when the user says "this page", "this notebook page", or "my current experiment".',
    'Use the hidden notebook page context supplied with each user question as the current page content. It may include unsaved placeholder values, notes, tables, and linked result summaries.',
    'Do not claim that saved notebook data contains unsaved edits unless those edits were supplied in the hidden page context.'
  ];
  if (pageTitle) {
    lines.push(`Active notebook page title: ${pageTitle}`);
  }
  if (entryId) {
    lines.push(`Active notebook entry id: ${entryId}`);
  }
  if (projectName) {
    lines.push(`Project: ${projectName}`);
  }
  if (protocolName) {
    lines.push(`Protocol: ${protocolName}`);
  }
  return lines.join('\n');
}

function buildAssayAgentSessionPrompt(context = {}) {
  const assayId = trimText(context.assayId, 220);
  const assayName = trimText(context.assayName, 320);
  const projectName = trimText(context.projectName, 220);
  const assayMode = trimText(context.assayMode, 80);
  if (!assayId && !assayName && !projectName && !assayMode) {
    return '';
  }
  const lines = [
    'You are in an Assay right-rail chat session. Treat the active assay plate, result table, and analysis output as the default subject when the user says "this assay", "this plate", "these results", or "this graph".',
    'Use the hidden assay context supplied with each user question as the current assay state. It may include unsaved plate mappings, pasted result values, analysis settings, latest summaries, and a small well preview.',
    'For derived tables and custom graphs, prefer the Hikari assay table and Plotly graph MCP tools when available.'
  ];
  if (assayName) {
    lines.push(`Active assay name: ${assayName}`);
  }
  if (assayId) {
    lines.push(`Active assay id: ${assayId}`);
  }
  if (projectName) {
    lines.push(`Project: ${projectName}`);
  }
  if (assayMode) {
    lines.push(`Assay mode: ${assayMode}`);
  }
  return lines.join('\n');
}

function normalizeAgentChatState(source = {}, defaults = {}) {
  const value = source && typeof source === 'object' ? source : {};
  const hasProjectId = Object.prototype.hasOwnProperty.call(value, 'projectId');
  return {
    projectId: trimText(hasProjectId ? value.projectId : defaults.projectId, 120),
    currentSessionId: trimText(value.currentSessionId, 120),
    sessions: asArray(value.sessions),
    messages: asArray(value.messages)
  };
}

function normalizePaperScopeKey(value) {
  const raw = trimText(value, 220);
  return raw ? `paper:${raw}` : DEFAULT_SCOPE_KEY;
}

function normalizeNotebookScopeKey(context = {}) {
  const entryId = trimText(context.notebookEntryId, 220);
  if (entryId) {
    return `notebook:${entryId}`;
  }
  const projectId = trimText(context.projectId, 120);
  const protocolId = trimText(context.protocolId, 120);
  if (projectId || protocolId) {
    return `notebook:draft:${projectId || 'project'}:${protocolId || 'protocol'}`;
  }
  return DEFAULT_NOTEBOOK_SCOPE_KEY;
}

function normalizeAssayScopeKey(context = {}) {
  const assayId = trimText(context.assayId, 220);
  if (assayId) {
    return `assay:${assayId}`;
  }
  const projectId = trimText(context.projectId, 120);
  if (projectId) {
    return `assay:draft:${projectId}`;
  }
  return DEFAULT_ASSAY_SCOPE_KEY;
}

function normalizeScopeKey(context = {}) {
  const scopeType = trimText(context.scopeType, 80);
  if (scopeType === 'notebook') {
    return normalizeNotebookScopeKey(context);
  }
  if (scopeType === 'assay') {
    return normalizeAssayScopeKey(context);
  }
  return normalizePaperScopeKey(context.paperId);
}

function normalizeStoredScopeKey(value) {
  const raw = trimText(value, 260);
  if (!raw || raw === DEFAULT_SCOPE_KEY) {
    return DEFAULT_SCOPE_KEY;
  }
  if (raw === DEFAULT_NOTEBOOK_SCOPE_KEY || raw === DEFAULT_ASSAY_SCOPE_KEY || raw.startsWith('paper:') || raw.startsWith('notebook:') || raw.startsWith('assay:')) {
    return raw;
  }
  return normalizePaperScopeKey(raw);
}

function ensurePaperAgentChatSessions(rootState) {
  if (!rootState.paperAgentChatSessions || typeof rootState.paperAgentChatSessions !== 'object' || Array.isArray(rootState.paperAgentChatSessions)) {
    rootState.paperAgentChatSessions = {};
  }
  return rootState.paperAgentChatSessions;
}

export function normalizePaperAgentChatSessions(source = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(source).map(([scopeKey, chatState]) => [
      normalizeStoredScopeKey(scopeKey),
      normalizeAgentChatState(chatState)
    ])
  );
}

function normalizeHiddenContext(context = {}) {
  const source = context && typeof context === 'object' ? context : {};
  const text = trimText(source.text, 4000);
  if (!text) {
    return null;
  }
  return {
    kind: trimText(source.kind || 'selection', 80),
    label: trimText(source.label || 'Hidden context', 120),
    text,
    paperId: trimText(source.paperId, 220),
    paperTitle: trimText(source.paperTitle, 320),
    pageNumber: Number.isFinite(Number(source.pageNumber))
      ? Math.max(1, Math.round(Number(source.pageNumber)))
      : 0,
    notebookEntryId: trimText(source.notebookEntryId, 220),
    projectName: trimText(source.projectName, 220),
    protocolName: trimText(source.protocolName, 220),
    assayId: trimText(source.assayId, 220),
    assayName: trimText(source.assayName, 320)
  };
}

function normalizeNotebookAgentContext(context = {}) {
  const notebookEntryId = trimText(context.notebookEntryId, 220);
  const projectName = trimText(context.projectName, 220);
  const protocolName = trimText(context.protocolName, 220);
  const pageTitle = trimText(context.pageTitle, 320);
  const hiddenContexts = asArray(context.hiddenContexts)
    .map(normalizeHiddenContext)
    .filter(Boolean);
  const singleHiddenContext = normalizeHiddenContext(context.hiddenContext);
  if (singleHiddenContext) {
    hiddenContexts.unshift(singleHiddenContext);
  }
  return {
    scopeType: 'notebook',
    notebookEntryId,
    pageTitle,
    projectId: trimText(context.projectId, 120),
    projectName,
    protocolId: trimText(context.protocolId, 120),
    protocolName,
    hiddenContexts: hiddenContexts.slice(0, 3),
    sessionPrompt: buildNotebookAgentSessionPrompt({
      notebookEntryId,
      pageTitle,
      projectName,
      protocolName
    })
  };
}

function normalizePaperAgentContext(context = {}) {
  const paperId = trimText(context.paperId, 220);
  const knowledgeMarkdownRelativePath = trimText(context.knowledgeMarkdownRelativePath, 2400);
  const paperTitle = trimText(context.paperTitle, 320);
  return {
    scopeType: 'paper',
    paperId,
    paperTitle,
    projectId: trimText(context.projectId, 120),
    knowledgeMarkdownRelativePath,
    knowledgeExtractedTextRelativePath: trimText(context.knowledgeExtractedTextRelativePath, 2400),
    knowledgeMetaRelativePath: trimText(context.knowledgeMetaRelativePath, 2400),
    knowledgeStatus: trimText(context.knowledgeStatus, 80),
    sessionPrompt: buildPaperAgentSessionPrompt({
      paperId,
      paperTitle,
      knowledgeMarkdownRelativePath
    })
  };
}

function normalizeAssayAgentContext(context = {}) {
  const assayId = trimText(context.assayId, 220);
  const assayName = trimText(context.assayName, 320);
  const projectName = trimText(context.projectName, 220);
  const assayMode = trimText(context.assayMode, 80);
  const hiddenContexts = asArray(context.hiddenContexts)
    .map(normalizeHiddenContext)
    .filter(Boolean);
  const singleHiddenContext = normalizeHiddenContext(context.hiddenContext);
  if (singleHiddenContext) {
    hiddenContexts.unshift(singleHiddenContext);
  }
  return {
    scopeType: 'assay',
    assayId,
    assayName,
    assayMode,
    projectId: trimText(context.projectId, 120),
    projectName,
    hiddenContexts: hiddenContexts.slice(0, 3),
    sessionPrompt: buildAssayAgentSessionPrompt({
      assayId,
      assayName,
      projectName,
      assayMode
    })
  };
}

function normalizeScopeContext(context = {}) {
  const scopeType = trimText(context.scopeType, 80);
  if (scopeType === 'notebook') {
    return normalizeNotebookAgentContext(context);
  }
  if (scopeType === 'assay') {
    return normalizeAssayAgentContext(context);
  }
  return normalizePaperAgentContext(context);
}

export function createScopedAgentChatState(rootState, options = {}) {
  const getRawScopeContext = typeof options.getScopeContext === 'function'
    ? options.getScopeContext
    : () => ({});

  function getScopeContext() {
    return normalizeScopeContext(getRawScopeContext() || {});
  }

  function getScopedAgentChat() {
    const context = getScopeContext();
    const sessions = ensurePaperAgentChatSessions(rootState);
    const scopeKey = normalizeScopeKey(context);
    sessions[scopeKey] = normalizeAgentChatState(sessions[scopeKey], {
      projectId: context.projectId
    });
    return sessions[scopeKey];
  }

  return new Proxy(rootState, {
    get(target, property, receiver) {
      if (property === 'agentChat') {
        return getScopedAgentChat();
      }
      if (property === 'agentChatContext') {
        return getScopeContext();
      }
      if (property === '__agentChatRootState') {
        return rootState;
      }
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (property === 'agentChat') {
        const context = getScopeContext();
        const sessions = ensurePaperAgentChatSessions(rootState);
        sessions[normalizeScopeKey(context)] = normalizeAgentChatState(value, {
          projectId: context.projectId
        });
        return true;
      }
      return Reflect.set(target, property, value, receiver);
    }
  });
}

export { buildAssayAgentSessionPrompt, buildNotebookAgentSessionPrompt, buildPaperAgentSessionPrompt };
