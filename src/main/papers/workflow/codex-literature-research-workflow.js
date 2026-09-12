'use strict';

const { buildPaperAnnotationContext } = require('../shared/paper-comment-context.js');
const { parseJsonObjectFromText } = require('./codex-payload.js');
const { hydrateLineSelectionsForPaper, buildSubAgentSummary } = require('./codex-paper-context/prompts.js');
const { buildLiteratureResearchSystemPrompt, buildLiteratureResearchMessage } = require('./literature-research-prompts.js');
const { createLiteratureResearchSession, closeLiteratureResearchSession } = require('./literature-research-session.js');

async function runCodexLiteratureResearch(input, copiedContext, subAgentRuntime, options = {}) {
  const session = createLiteratureResearchSession(input);
  session.findLocalPaper = options.findLocalPaper;
  let agent = null;
  let result;
  try {
    const snapshot = {
      ...input.snapshot,
      settings: { ...input.snapshot?.settings, storagePath: copiedContext.storage_path },
      literature_research: { id: session.id }
    };
    const created = await subAgentRuntime.createSubAgent({
      name: `paper-research-${session.id}`,
      system_prompt: buildLiteratureResearchSystemPrompt(),
      message: buildLiteratureResearchMessage(input, copiedContext),
      metadata: {
        task_type: 'codex-literature-research',
        parent_request_id: input.traceContext?.requestId || input.request_id || '',
        snapshot,
        project: copiedContext.project,
        cwd: input.cwd,
        model: input.model,
        reasoning_effort: input.reasoning_effort || input.reasoningEffort,
        enable_web_search: true,
        timeout_ms: null
      }
    });
    agent = created?.agent;
    if (!created?.ok) throw new Error(created?.error || 'Could not start paper research sub-agent.');
    const payload = parseJsonObjectFromText(agent?.last_response?.assistant_message || created.summary || '');
    if (!payload || !Array.isArray(payload.papers)) throw new Error('Paper research sub-agent returned invalid evidence JSON.');
    if (payload.ok === false) throw new Error(payload.error || payload.summary || 'Paper research failed.');

    const downloadedPapers = session.downloads;
    const annotationContext = buildPaperAnnotationContext({
      snapshot: input.snapshot,
      selectedPapers: downloadedPapers,
      downloadedPapers
    });
    const blocks = [];
    const notes = Array.isArray(payload.notes) ? payload.notes.map(String) : [];
    const selectedPapers = [];
    const seen = new Set();
    for (const paper of payload.papers) {
      const download = downloadedPapers.find((record) => record.ok === true
        && record.knowledge_markdown_path
        && record.knowledge_markdown_path === paper?.knowledge_markdown_path);
      if (!download) {
        notes.push('Ignored evidence from a file that was not returned by a successful download in this research session.');
        continue;
      }
      if (seen.has(download.knowledge_markdown_path)) continue;
      seen.add(download.knowledge_markdown_path);
      const hydrated = await hydrateLineSelectionsForPaper({
        paperTarget: { ...download, download },
        linePayload: { selected_line_ranges: paper.selected_line_ranges },
        annotationContext
      });
      notes.push(...hydrated.notes);
      blocks.push(...hydrated.blocks.slice(0, 50 - blocks.length));
      if (hydrated.blocks.length) selectedPapers.push({
        ...download,
        download_status: download.status,
        reason: hydrated.blocks[0].relevance_reason
      });
      if (blocks.length >= 50) break;
    }
    const rejectedEvidence = payload.papers.length > 0 && blocks.length === 0;
    result = {
      ok: !rejectedEvidence,
      status: rejectedEvidence ? 'invalid_evidence' : 'completed',
      ...(rejectedEvidence ? { error: 'None of the returned paper evidence could be validated against downloaded Markdown.' } : {}),
      selected_papers: selectedPapers,
      loaded_context_blocks: blocks,
      papers_read_count: selectedPapers.length,
      notes,
      summary: String(payload.summary || `Loaded ${blocks.length} exact line-backed evidence blocks.`)
    };
  } catch (error) {
    result = {
      ok: false,
      status: 'error',
      error: String(error?.message || error),
      selected_papers: [],
      loaded_context_blocks: [],
      papers_read_count: 0
    };
  } finally {
    closeLiteratureResearchSession(session);
  }

  if (agent?.id) {
    const finish = result.ok ? subAgentRuntime.completeSubAgentTask : subAgentRuntime.failSubAgentTask;
    try {
      finish?.call(subAgentRuntime, {
        agent_id: agent.id,
        summary: result.summary || result.error,
        error: result.error,
        metadata: { search_count: session.searches.length, papers_read_count: result.papers_read_count }
      });
      agent = subAgentRuntime.getSubAgent?.({ agent_id: agent.id })?.agent || agent;
    } catch { /* Task bookkeeping is best effort. */ }
  }
  return {
    ...result,
    query: input.query,
    items: session.searches.flatMap((search) => search.items || []),
    sources: [...new Set(session.searches.flatMap((search) => search.sources || []))],
    source_counts: Object.assign({}, ...session.searches.map((search) => search.source_counts)),
    source_errors: Object.assign({}, ...session.searches.map((search) => search.source_errors)),
    downloaded_papers: session.downloads,
    search_count: session.searches.length,
    sub_agent_id: agent?.id || '',
    sub_agent: buildSubAgentSummary(agent),
    sub_agent_context: copiedContext,
    delegated_research: true
  };
}

module.exports = { runCodexLiteratureResearch };
