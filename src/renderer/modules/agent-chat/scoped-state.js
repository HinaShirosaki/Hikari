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
    'Read the complete hidden notebook-page context before answering or using lookup tools. It is the current page content and may include unsaved placeholder values, notes, tables, calculations, result files, linked samples, and linked result summaries.',
    'When asked to enrich the page, search only for information that is directly useful to this experiment. Use inventory_lookup with exact linked sample or protein ids or codes, and chemical_lookup for local reagent stock. Use native web search for authoritative preparation guidance when needed; reserve literature_search for claims that require research-paper evidence.',
    'A failed local lookup means only that no saved stock record was found. When a required material is a standard, independently preparable laboratory solution and its identity is sufficiently defined, provide a clearly labeled reference preparation that is not represented as an inventory record. State the assumed chemical form, purity when relevant, target concentration, final volume, solvent, calculation, preparation steps, handling or sterilization, storage, stability, and safety-critical uncertainty.',
    'Make each reference preparation executable from materials recorded on the page, found locally, or available in an ordinary source form. Do not stop at diluting an unverified stock or undefined base solution: include the missing stock or base formula with mass or volume arithmetic and any molecular-weight, density, or purity assumption needed, or identify it as a missing prerequisite and ask one focused question. Prefer one complete formulation over several partial recipes.',
    'Never present an assumption, calculated recipe, or external reference as locally recorded data. If chemical form, concentration, compatibility, or another safety-critical parameter could materially change the preparation, state the assumption or ask one focused blocking question. Do not improvise preparations for proprietary mixtures, biological materials, or insufficiently identified substances.',
    'Make content_markdown concise and bench-ready: include only new actionable information, do not repeat the page title or existing protocol steps, and do not repeat section_title as a heading. Use at most three short subsections and six bullets, with no tables, nested lists, tool names, search queries, failed-lookup transcripts, internal reasoning, or Sources heading. Keep it under about 180 words unless additional safety information is necessary.',
    'Put decision-relevant lookup gaps in rationale as one short sentence. Pass one to three unique, useful local records or authoritative URLs in sources; do not use failed searches or hidden page context as sources, and keep source labels and details compact.',
    'Use notebook_append once only when useful new content is ready for explicit review. Use the active entry id, page title, project, protocol, and Updated at timestamp from hidden context. If nothing safe and useful can be added, explain that briefly in chat without proposing an append. Do not create a new page, replace existing notes, or claim the append was saved before Hikari confirms it.',
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
    'Use the hidden assay context supplied with each user question as the current assay state. It may include unsaved plate mappings, pasted result values, analysis settings, latest summaries, and an `Assay plate data (TSV...)` block.',
    'To retrieve active assay data, parse the TSV rows in that hidden context after the header `well\trow\tcolumn\tsample\tconcentration\tresult`, then create an `assay_table` from those rows for calculations or graphing.',
    'Do not use local lookup tools for active assay plate/result data; they are not the source for the current assay.',
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

function ensurePaperAgentChatSessions(rootState) {
  if (!rootState.paperAgentChatSessions || typeof rootState.paperAgentChatSessions !== 'object' || Array.isArray(rootState.paperAgentChatSessions)) {
    rootState.paperAgentChatSessions = {};
  }
  return rootState.paperAgentChatSessions;
}

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
