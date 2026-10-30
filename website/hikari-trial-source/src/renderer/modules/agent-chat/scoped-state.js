import { asArray, trimText } from './shared.js';
import {
  normalizeAgentChatState,
  normalizePaperAgentChatSessions,
  normalizeScopeKey
} from '../app-state/agent-chat-normalizer.js';

export { normalizePaperAgentChatSessions };

function buildPaperAgentSessionPrompt(context = {}) {
  const paperId = trimText(context.paperId, 220);
  const paperTitle = trimText(context.paperTitle, 320);
  const markdownPath = trimText(context.knowledgeMarkdownRelativePath, 2400);
  if (!paperId && !paperTitle && !markdownPath) {
    return '';
  }
  const lines = [
    'You are in a Papers right-rail chat session. Treat the active PDF as the default subject when the user says "this paper".',
    'Use the transformed title-named Markdown file when it is available; it is the LLM-facing content extracted from the PDF. Legacy records may still use paper.md.',
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
    'You are in an Assay right-rail chat session. Treat the active assay plate, result table, and analysis output as the default subject when the user says "this assay", "this plate", "these results", or "this graph".'
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

function ensurePaperAgentChatSessions(rootState) {
  if (!rootState.paperAgentChatSessions || typeof rootState.paperAgentChatSessions !== 'object' || Array.isArray(rootState.paperAgentChatSessions)) {
    rootState.paperAgentChatSessions = {};
  }
  return rootState.paperAgentChatSessions;
}

// Hidden context is page text sent to the model but not shown in the chat.
// Whole notebook/assay pages get a 40k-char budget, a text selection 4k; at
// most three are kept per request.
function normalizeHiddenContext(context = {}) {
  const source = context && typeof context === 'object' ? context : {};
  const kind = trimText(source.kind || 'selection', 80);
  const textLimit = kind === 'assay-page' || kind === 'assay' || kind === 'notebook-page' || trimText(source.assayId, 220)
    ? 40000
    : 4000;
  const text = trimText(source.text, textLimit);
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
    notebookUpdatedAt: trimText(source.notebookUpdatedAt, 80),
    projectName: trimText(source.projectName, 220),
    protocolName: trimText(source.protocolName, 220),
    assayId: trimText(source.assayId, 220),
    assayName: trimText(source.assayName, 320)
  };
}

function normalizeNotebookAgentContext(context = {}) {
  const notebookEntryId = trimText(context.notebookEntryId, 220);
  const notebookUpdatedAt = trimText(context.notebookUpdatedAt, 80);
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
    notebookUpdatedAt,
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
  if (scopeType === 'plugin') {
    const pluginId = trimText(context.pluginId, 100);
    const pluginContextId = trimText(context.pluginContextId, 100);
    const pluginContextTitle = trimText(context.pluginContextTitle, 200);
    const pluginCanvasIllustrationId = trimText(context.pluginCanvasIllustrationId, 100);
    const readRequest = { action: 'read', ...(pluginCanvasIllustrationId ? { illustration_id: pluginCanvasIllustrationId } : {}) };
    return { scopeType: 'plugin', pluginId, pluginName: trimText(context.pluginName, 200),
      pluginContextId, pluginContextTitle, pluginCanvasIllustrationId,
      sessionPrompt: `You are working in the installed plugin ${trimText(context.pluginName, 200) || pluginId} (${pluginId}). ${pluginContextId ? `This chat belongs only to item ${JSON.stringify(pluginContextId)} (${JSON.stringify(pluginContextTitle)}). ` : ''}Use plugin_canvas with plugin_id:${JSON.stringify(pluginId)} and request:${JSON.stringify(readRequest)} to discover its request schema and instructions before editing. Follow the plugin-owned contract. Render previews to inspect your actual output and iterate. Preserve existing user edits and unrelated objects.` };
  }
  if (scopeType === 'home') {
    return {
      scopeType: 'home',
      sessionPrompt: [
        'This is the Home Experiment log. The user clicked Prepare notebook page: interpret their observation as a request to record an experiment in Biology Notebook.',
        'Use agent judgment to match the experiment to saved protocols and the selected project. Use protocol_lookup and notebook_draft to prepare a structured page for review. Ask a focused question if the project or protocol is ambiguous.',
        'If the user explicitly names an existing notebook page, use notebook_lookup then notebook_append to prepare an append proposal for that page.',
        'Do not redirect to inventory or ask whether to make a notebook entry; that intent is already established. Do not claim a page was saved until the application confirms it.',
        'Preserve exactly what the user reports. Never invent performed steps, conditions, dates, measurements, or outcomes. Protocol defaults describe planned steps, not evidence of completed work. Leave unknown experimental facts unresolved and ask for necessary details.',
        'Use the available notebook tools to produce actual reviewable proposals, not just prose saying a proposal is ready.'
      ].join('\n')
    };
  }
  if (scopeType === 'notebook') {
    return normalizeNotebookAgentContext(context);
  }
  if (scopeType === 'assay') {
    return normalizeAssayAgentContext(context);
  }
  return normalizePaperAgentContext(context);
}

// Lets the same agent-chat code run as a right-rail chat per paper, notebook
// page, assay, or the Home experiment log. It returns a Proxy of the root state
// where `state.agentChat` reads and writes the chat for the current scope
// (rootState.paperAgentChatSessions[scopeKey], despite the name used for all
// scopes) instead of the main Agent view's chat. `agentChatContext` exposes
// the normalized scope, and every other property passes through unchanged.
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
