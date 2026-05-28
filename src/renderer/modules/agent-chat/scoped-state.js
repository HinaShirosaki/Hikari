import { asArray, trimText } from './shared.js';

const DEFAULT_SCOPE_KEY = 'papers:library';

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

function normalizeAgentChatState(source = {}, defaults = {}) {
  const value = source && typeof source === 'object' ? source : {};
  const hasProjectId = Object.prototype.hasOwnProperty.call(value, 'projectId');
  return {
    projectId: trimText(hasProjectId ? value.projectId : defaults.projectId, 120),
    deepResearchEnabled: value.deepResearchEnabled === true,
    currentSessionId: trimText(value.currentSessionId, 120),
    sessions: asArray(value.sessions),
    messages: asArray(value.messages)
  };
}

function normalizeScopeKey(value) {
  const raw = trimText(value, 220);
  return raw ? `paper:${raw}` : DEFAULT_SCOPE_KEY;
}

function normalizeStoredScopeKey(value) {
  const raw = trimText(value, 260);
  if (!raw || raw === DEFAULT_SCOPE_KEY) {
    return DEFAULT_SCOPE_KEY;
  }
  if (raw.startsWith('paper:')) {
    return raw;
  }
  return normalizeScopeKey(raw);
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

export function createPaperScopedAgentChatState(rootState, options = {}) {
  const getPaperContext = typeof options.getPaperContext === 'function'
    ? options.getPaperContext
    : () => ({});

  function getScopeContext() {
    const context = getPaperContext() || {};
    const paperId = trimText(context.paperId, 220);
    const knowledgeMarkdownRelativePath = trimText(context.knowledgeMarkdownRelativePath, 2400);
    const paperTitle = trimText(context.paperTitle, 320);
    return {
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

  function getScopedAgentChat() {
    const context = getScopeContext();
    const sessions = ensurePaperAgentChatSessions(rootState);
    const scopeKey = normalizeScopeKey(context.paperId);
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
        sessions[normalizeScopeKey(context.paperId)] = normalizeAgentChatState(value, {
          projectId: context.projectId
        });
        return true;
      }
      return Reflect.set(target, property, value, receiver);
    }
  });
}

export { buildPaperAgentSessionPrompt };
