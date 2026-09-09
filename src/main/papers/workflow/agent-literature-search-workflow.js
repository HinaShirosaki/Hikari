'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../lib/llm/runtime-helpers.js');
const { cloneJson } = require('../shared/paper-comment-context.js');
const { scorePaperCandidate, selectPaperCandidates } = require('../search/literature-candidates.js');
const { shouldUseCodexPaperContextWorkflow } = require('./codex-paper-context-workflow.js');
const {
  defaultEnsureObject,
  chunkArray,
  sanitizeFolderName
} = require('./literature-workflow/helpers.js');
const { createSearchContext } = require('./literature-workflow/search-context.js');
const { createPaperAcquisition } = require('./literature-workflow/paper-acquisition.js');
const { createPaperReading } = require('./literature-workflow/paper-reading.js');
const { createRunLiteratureWorkflow } = require('./literature-workflow/run-workflow.js');

function createLiteratureSearchWorkflowRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings
  } = createAgentLlmRuntimeHelpers(deps);

  const literatureSearchRuntime = deps.literatureSearchRuntime && typeof deps.literatureSearchRuntime === 'object'
    ? deps.literatureSearchRuntime
    : null;
  const paperContextLoaderRuntime = deps.paperContextLoaderRuntime && typeof deps.paperContextLoaderRuntime === 'object'
    ? deps.paperContextLoaderRuntime
    : null;
  const paperDownloadRuntime = deps.paperDownloadRuntime && typeof deps.paperDownloadRuntime === 'object'
    ? deps.paperDownloadRuntime
    : null;
  const paperKnowledgeDatabaseRuntime = deps.paperKnowledgeDatabaseRuntime
    && typeof deps.paperKnowledgeDatabaseRuntime === 'object'
    ? deps.paperKnowledgeDatabaseRuntime
    : null;
  const createSubAgentRuntime = typeof deps.createSubAgentRuntime === 'function'
    ? deps.createSubAgentRuntime
    : null;
  const codexSubAgentRuntime = deps.subAgentRuntime && typeof deps.subAgentRuntime === 'object'
    ? deps.subAgentRuntime
    : null;
  const subAgentStore = deps.subAgentStore instanceof Map ? deps.subAgentStore : new Map();
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());

  const {
    getCandidateSearchRuntime,
    buildCopiedContext,
    buildSubAgentSystemPrompt,
    buildSubAgentMessage
  } = createSearchContext({
    asArray,
    cleanText,
    uniqueStrings,
    literatureSearchRuntime
  });

  const {
    assignCanonicalPaperIds,
    enrichPaperForDownload,
    downloadSelectedPapers,
    partitionByLocalKnowledge
  } = createPaperAcquisition({
    asArray,
    cleanText,
    uniqueStrings,
    paperContextLoaderRuntime,
    paperDownloadRuntime,
    paperKnowledgeDatabaseRuntime
  });

  const { readSelectedPapers } = createPaperReading({
    asArray,
    cleanText,
    paperContextLoaderRuntime
  });

  const { runLiteratureWorkflow } = createRunLiteratureWorkflow({
    asArray,
    cleanText,
    uniqueStrings,
    codexSubAgentRuntime,
    getCandidateSearchRuntime,
    assignCanonicalPaperIds,
    enrichPaperForDownload,
    downloadSelectedPapers,
    partitionByLocalKnowledge,
    readSelectedPapers
  });


  async function execute(input = {}) {
    const source = defaultEnsureObject(input);
    const query = cleanText(
      source.query
      || (literatureSearchRuntime && typeof literatureSearchRuntime.buildLiteratureQuery === 'function'
        ? literatureSearchRuntime.buildLiteratureQuery(source)
        : '')
      || source.topic
      || source.message,
      600
    );
    if (!query) {
      return {
        ok: false,
        status: 'error',
        error: 'Literature search workflow requires query, topic, or message.'
      };
    }

    const copiedContext = buildCopiedContext(source, query);
    const useCodexPaperContext = Boolean(codexSubAgentRuntime)
      && shouldUseCodexPaperContextWorkflow(source);
    const taskContext = source.snapshot?.scheduled_task || source.snapshot?.scheduledTask;
    const isExperimentSuggestion = taskContext?.task_type === 'notebook_suggestion'
      && taskContext.deny_paper_download === true;
    if (useCodexPaperContext || isExperimentSuggestion) {
      const workflowResult = await runLiteratureWorkflow({
        ...source,
        query,
        message: cleanText(source.message, 1600) || query
      }, copiedContext);
      if (workflowResult?.ok === false) {
        return {
          ok: false,
          status: cleanText(workflowResult.status, 40) || 'error',
          error: cleanText(workflowResult.error, 1200) || `Literature search failed for ${query}.`,
          query,
          sources: asArray(workflowResult.sources),
          items: asArray(workflowResult.items),
          citations: asArray(workflowResult.citations),
          source_counts: cloneJson(defaultEnsureObject(workflowResult.source_counts), {}),
          source_errors: cloneJson(defaultEnsureObject(workflowResult.source_errors), {}),
          selected_papers: asArray(workflowResult.selected_papers),
          downloaded_papers: asArray(workflowResult.downloaded_papers),
          loaded_context_blocks: asArray(workflowResult.loaded_context_blocks),
          papers_read_count: Number(workflowResult.papers_read_count) || 0,
          sub_agent_id: cleanText(workflowResult.sub_agent_id, 160),
          sub_agent: workflowResult.sub_agent || null,
          sub_agent_context: workflowResult.sub_agent_context || copiedContext,
          codex_paper_context: workflowResult.codex_paper_context === true,
          summary: cleanText(workflowResult.summary || workflowResult.error, 600)
            || `Literature search failed for ${query}.`
        };
      }
      return {
        ok: true,
        status: 'completed',
        query,
        sources: asArray(workflowResult.sources),
        items: asArray(workflowResult.items),
        citations: asArray(workflowResult.citations),
        source_counts: cloneJson(defaultEnsureObject(workflowResult.source_counts), {}),
        source_errors: cloneJson(defaultEnsureObject(workflowResult.source_errors), {}),
        selected_papers: asArray(workflowResult.selected_papers),
        downloaded_papers: asArray(workflowResult.downloaded_papers),
        loaded_context_blocks: asArray(workflowResult.loaded_context_blocks),
        papers_read_count: Number(workflowResult.papers_read_count) || 0,
        sub_agent_id: cleanText(workflowResult.sub_agent_id, 160),
        sub_agent: workflowResult.sub_agent || null,
        sub_agent_context: workflowResult.sub_agent_context || copiedContext,
        codex_paper_context: workflowResult.codex_paper_context === true,
        summary: cleanText(workflowResult.summary, 600)
          || `Completed delegated literature search for ${query}.`
      };
    }
    if (!createSubAgentRuntime) {
      return {
        ok: false,
        status: 'error',
        query,
        error: 'Literature workflow requires a sub-agent runtime from the application composition layer.',
        summary: `Literature search could not start for ${query}.`
      };
    }
    const subAgentRuntime = createSubAgentRuntime({
      now,
      store: subAgentStore,
      runSubAgentTurn: async () => {
        const workflowResult = await runLiteratureWorkflow({
          ...source,
          query,
          message: cleanText(source.message, 1600) || query
        }, copiedContext);
        return {
          assistant_message: cleanText(workflowResult?.summary, 1200) || cleanText(workflowResult?.error, 1200),
          summary: cleanText(workflowResult?.summary, 500),
          output: workflowResult,
          metadata: {
            query
          }
        };
      }
    });

    const created = await subAgentRuntime.createSubAgent({
      name: sanitizeFolderName(
        cleanText(source.sub_agent_name || source.subAgentName, 160)
        || `literature-search-${Date.now()}`
      ),
      system_prompt: buildSubAgentSystemPrompt(copiedContext),
      message: buildSubAgentMessage(copiedContext),
      metadata: {
        task_type: 'literature-search',
        parent_request_id: cleanText(source.traceContext?.requestId || source.request_id, 160),
        tags: ['literature', 'papers', 'search'],
        copied_context: copiedContext
      }
    });

    if (!created?.ok) {
      return {
        ok: false,
        status: cleanText(created?.status, 40) || 'error',
        error: cleanText(created?.error, 1200) || 'Failed to create literature search sub-agent.'
      };
    }

    const agentId = cleanText(created?.agent?.id, 160);
    if (agentId) {
      try {
        subAgentRuntime.startSubAgentTask({
          agent_id: agentId,
          task_type: 'literature-search',
          summary: `Searching and reading papers for ${query}.`,
          metadata: {
            query
          }
        });
      } catch {
        // Ignore task bookkeeping failures.
      }
    }

    const subAgentRecord = agentId
      ? subAgentRuntime.getSubAgent({ agent_id: agentId })?.agent
      : (created?.agent || null);
    const workflowResult = defaultEnsureObject(subAgentRecord?.last_response?.output || created?.agent?.last_response?.output);
    if (workflowResult.ok === false) {
      const failureSummary = cleanText(workflowResult.summary || workflowResult.error, 240)
        || `Literature search failed for ${query}.`;
      if (agentId) {
        try {
          subAgentRuntime.failSubAgentTask({
            agent_id: agentId,
            summary: failureSummary,
            error: cleanText(workflowResult.error, 1200),
            metadata: {
              query
            }
          });
        } catch {
          // Ignore task bookkeeping failures.
        }
      }
      const failedSubAgentRecord = agentId
        ? subAgentRuntime.getSubAgent({ agent_id: agentId })?.agent
        : subAgentRecord;
      return {
        ok: false,
        status: cleanText(workflowResult.status, 40) || 'error',
        error: cleanText(workflowResult.error, 1200) || failureSummary,
        query,
        sources: asArray(workflowResult.sources),
        items: asArray(workflowResult.items),
        citations: asArray(workflowResult.citations),
        source_counts: cloneJson(defaultEnsureObject(workflowResult.source_counts), {}),
        source_errors: cloneJson(defaultEnsureObject(workflowResult.source_errors), {}),
        selected_papers: asArray(workflowResult.selected_papers),
        downloaded_papers: asArray(workflowResult.downloaded_papers),
        loaded_context_blocks: asArray(workflowResult.loaded_context_blocks),
        papers_read_count: Number(workflowResult.papers_read_count) || 0,
        sub_agent_id: agentId,
        sub_agent: failedSubAgentRecord
          ? {
            id: cleanText(failedSubAgentRecord.id, 160),
            name: cleanText(failedSubAgentRecord.name, 160),
            status: cleanText(failedSubAgentRecord.status, 40),
            created_at: cleanText(failedSubAgentRecord.created_at, 80),
            updated_at: cleanText(failedSubAgentRecord.updated_at, 80),
            message_count: asArray(failedSubAgentRecord.messages).length,
            task: cloneJson(defaultEnsureObject(failedSubAgentRecord.task), null),
            last_response: cloneJson(defaultEnsureObject(failedSubAgentRecord.last_response), null)
          }
          : null,
        sub_agent_context: workflowResult.sub_agent_context || copiedContext,
        summary: failureSummary
      };
    }

    if (agentId) {
      try {
        subAgentRuntime.completeSubAgentTask({
          agent_id: agentId,
          summary: cleanText(subAgentRecord?.last_response?.summary, 240) || workflowResult.summary || `Completed literature search for ${query}.`,
          metadata: {
            query,
            selected_count: asArray(workflowResult.selected_papers).length,
            downloaded_count: asArray(workflowResult.downloaded_papers).filter((item) => item?.ok === true && item?.status !== 'reused').length,
            context_block_count: asArray(workflowResult.loaded_context_blocks).length
          }
        });
      } catch {
        // Ignore task bookkeeping failures.
      }
    }
    const completedSubAgentRecord = agentId
      ? subAgentRuntime.getSubAgent({ agent_id: agentId })?.agent
      : subAgentRecord;

    const selectedPapers = asArray(workflowResult.selected_papers);
    const downloadedPapers = asArray(workflowResult.downloaded_papers);
    const loadedContextBlocks = asArray(workflowResult.loaded_context_blocks);
    const summary = cleanText(workflowResult.summary || created?.summary, 600)
      || `Completed delegated literature search for ${query}.`;

    return {
      ok: true,
      status: 'completed',
      query,
      sources: asArray(workflowResult.sources),
      items: asArray(workflowResult.items),
      citations: asArray(workflowResult.citations),
      source_counts: cloneJson(defaultEnsureObject(workflowResult.source_counts), {}),
      source_errors: cloneJson(defaultEnsureObject(workflowResult.source_errors), {}),
      selected_papers: selectedPapers,
      downloaded_papers: downloadedPapers,
      loaded_context_blocks: loadedContextBlocks,
      papers_read_count: Number(workflowResult.papers_read_count) || 0,
      sub_agent_id: agentId,
      sub_agent: completedSubAgentRecord
        ? {
          id: cleanText(completedSubAgentRecord.id, 160),
          name: cleanText(completedSubAgentRecord.name, 160),
          status: cleanText(completedSubAgentRecord.status, 40),
          created_at: cleanText(completedSubAgentRecord.created_at, 80),
          updated_at: cleanText(completedSubAgentRecord.updated_at, 80),
          message_count: asArray(completedSubAgentRecord.messages).length,
          task: cloneJson(defaultEnsureObject(completedSubAgentRecord.task), null),
          last_response: cloneJson(defaultEnsureObject(completedSubAgentRecord.last_response), null)
        }
        : null,
      sub_agent_context: workflowResult.sub_agent_context || copiedContext,
      summary
    };
  }

  return {
    execute,
    runLiteratureWorkflow,
    selectPaperCandidates,
    scorePaperCandidate,
    downloadSelectedPapers,
    chunkArray,
    buildCopiedContext
  };
}

module.exports = {
  createLiteratureSearchWorkflowRuntime
};
