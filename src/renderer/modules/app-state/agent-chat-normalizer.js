import { asArray } from '../../lib/normalize.js';
const DEFAULT_SCOPE_KEY = 'papers:library';
const DEFAULT_NOTEBOOK_SCOPE_KEY = 'notebook:workspace';
const DEFAULT_ASSAY_SCOPE_KEY = 'assay:workspace';

function trimText(value, maxLength = 5000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

export function normalizeAgentChatState(source = {}, defaults = {}) {
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

export function normalizeScopeKey(context = {}) {
  const scopeType = trimText(context.scopeType, 80);
  if (scopeType === 'home') return 'home:experiment-log';
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
  if (
    raw === 'home:experiment-log'
    || raw === DEFAULT_NOTEBOOK_SCOPE_KEY
    || raw === DEFAULT_ASSAY_SCOPE_KEY
    || raw.startsWith('paper:')
    || raw.startsWith('notebook:')
    || raw.startsWith('assay:')
  ) {
    return raw;
  }
  return normalizePaperScopeKey(raw);
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
