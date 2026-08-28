'use strict';

const { ensureObject } = require('../../lib/normalize.js');
const { attachRelatedCommentsToContextBlocks, buildPaperAnnotationContext } = require('../shared/paper-comment-context.js');
const { normalizeCodexPaperLinePayload, normalizeSelectedPaper, parseJsonObjectFromText } = require('./codex-payload.js');
const { buildCodexPaperContextMessage, buildCodexPaperContextSystemPrompt, buildSubAgentSummary, getKnowledgeMarkdownPath, hydrateLineSelectionsForPaper } = require('./codex-paper-context/prompts.js');
const { DEFAULT_MAX_CONTEXT_BLOCKS, buildPaperReadTargets, defaultAsArray, defaultCleanText, shouldUseCodexPaperContextWorkflow } = require('./codex-paper-context/read-targets.js');

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
