'use strict';

const { cloneJson } = require('../../shared/paper-comment-context.js');
const {
  normalizePreferredJournals,
  scorePaperCandidate,
  selectPaperCandidates
} = require('../../search/literature-candidates.js');
const {
  runCodexPaperContextSubAgent,
  shouldUseCodexPaperContextWorkflow
} = require('../codex-paper-context-workflow.js');
const {
  defaultEnsureObject,
  firstPositiveInteger,
  isExplicitTrue,
  sanitizeFolderName
} = require('./helpers.js');

// The search -> select -> download -> read pipeline, once a copied context and
// candidate set exist. Every collaborator is injected by the runtime.
function createRunLiteratureWorkflow({
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
} = {}) {
  async function runLiteratureWorkflow(input = {}, copiedContext = {}, candidateResult = null) {
    const source = defaultEnsureObject(input);
    const autoDownloadSelectedPapers = isExplicitTrue(
      source.download_selected_papers
      || source.downloadSelectedPapers
      || source.auto_download_selected_papers
      || source.autoDownloadSelectedPapers
    );
    const query = cleanText(
      source.query
      || source.topic
      || source.message
      || candidateResult?.query
      || '',
      600
    );
    const explicitMaxPapers = firstPositiveInteger([source.max_papers, source.maxPapers], 0);
    const explicitLimit = firstPositiveInteger([source.limit], 0);
    const explicitMaxPerSource = firstPositiveInteger([source.max_per_source, source.maxPerSource], 0);
    // Omitted limits stay omitted all the way through to the source runtimes.
    // A caller can still explicitly bound discovery or selection when needed.
    const desiredSelectionCount = explicitMaxPapers || explicitLimit;
    const searchLimit = explicitLimit || explicitMaxPapers;
    const searchMaxPerSource = explicitMaxPerSource || searchLimit;
    const searchFn = getCandidateSearchRuntime();
    if (!searchFn) {
      return {
        ok: false,
        status: 'error',
        error: 'Literature search runtime is not configured.'
      };
    }
    const preferredLiteratureSource = cleanText(
      source.preferred_literature_source
      || source.preferredLiteratureSource
      || copiedContext.preferred_literature_source,
      80
    );
    const preferredWebSource = cleanText(
      source.preferred_web_source
      || source.preferredWebSource
      || copiedContext.preferred_web_source,
      240
    );
    const searchInput = {
      ...source,
      ...(preferredLiteratureSource ? { preferred_literature_source: preferredLiteratureSource } : {}),
      ...(preferredWebSource ? { preferred_web_source: preferredWebSource } : {}),
      query
    };
    if (searchLimit) {
      searchInput._internal_limit = searchLimit;
    }
    if (searchMaxPerSource) {
      searchInput._internal_max_per_source = searchMaxPerSource;
    }
    if (desiredSelectionCount) {
      searchInput._internal_max_papers = desiredSelectionCount;
    }
    if (explicitLimit) {
      searchInput.limit = searchLimit;
    } else {
      delete searchInput.limit;
    }
    if (explicitMaxPerSource) {
      searchInput.max_per_source = searchMaxPerSource;
    } else {
      delete searchInput.max_per_source;
      delete searchInput.maxPerSource;
    }
    if (explicitMaxPapers) {
      searchInput.max_papers = desiredSelectionCount;
    } else {
      delete searchInput.max_papers;
      delete searchInput.maxPapers;
    }

    const rawSearchResult = candidateResult && candidateResult.ok === true
      ? candidateResult
      : await searchFn(searchInput);

    if (!rawSearchResult?.ok) {
      return rawSearchResult;
    }

    const preferredJournalList = normalizePreferredJournals(copiedContext.preferred_journals);
    const preferredJournal = preferredJournalList.length
      ? preferredJournalList
      : normalizePreferredJournals(copiedContext.preferred_journal);
    const selectedCandidates = selectPaperCandidates(
      asArray(rawSearchResult.items),
      query,
      desiredSelectionCount,
      preferredJournal
    );
    const taskContext = source.snapshot?.scheduled_task || source.snapshot?.scheduledTask;
    if (taskContext?.deny_paper_download === true || taskContext?.denyPaperDownload === true) {
      // Stop before PDF enrichment, acquisition, ingestion, or delegated reading,
      // including when a caller supplies legacy auto-download flags.
      return {
        ...rawSearchResult,
        status: 'completed',
        query,
        selected_papers: selectedCandidates.map(candidate => ({
          paper_title: cleanText(candidate.title, 320),
          source: cleanText(candidate.source, 80),
          journal: cleanText(candidate.journal, 220),
          summary: cleanText(candidate.summary || candidate.snippet, 1200),
          url: cleanText(candidate.url, 1200),
          doi: cleanText(candidate.doi, 180),
          published_at: cleanText(candidate.published_at, 80),
          download_status: 'not_requested'
        })),
        downloaded_papers: [],
        loaded_context_blocks: [],
        papers_read_count: 0,
        summary: `Found ${selectedCandidates.length} paper metadata records for the experiment suggestion.`
      };
    }
    // Papers found for a project belong in that project's Papers folder; a
    // free-standing search gets its own collection folder under Papers/.
    const projectName = cleanText(copiedContext.project?.name, 220);
    const linkedType = projectName ? 'project' : 'literature-search';
    const linkedName = projectName
      || cleanText(source.topic, 240)
      || cleanText(query, 220)
      || 'Literature Search';

    const enrichedCandidates = [];
    for (const candidate of selectedCandidates) {
      enrichedCandidates.push(await enrichPaperForDownload(candidate));
    }
    const workflowCandidates = assignCanonicalPaperIds(enrichedCandidates);
    const selectedPapers = workflowCandidates.map((candidate) => ({
      paper_id: cleanText(candidate.paper_id, 120),
      paper_title: cleanText(candidate.title, 320),
      source: cleanText(candidate.source, 80),
      journal: cleanText(candidate.journal || candidate.journal_name || candidate.journalName, 220),
      summary: cleanText(candidate.summary || candidate.snippet, 1200),
      url: cleanText(candidate.url, 1200),
      doi: cleanText(candidate.doi, 180),
      pmid: cleanText(candidate.pmid, 120),
      pmcid: cleanText(candidate.pmcid, 120),
      pdf_urls: uniqueStrings(asArray(candidate.pdf_urls), 8),
      download_available: Boolean(candidate.url || candidate.doi || asArray(candidate.pdf_urls).length),
      download_status: 'not_requested',
      published_at: cleanText(candidate.published_at, 80),
      score: scorePaperCandidate(candidate, query, preferredJournal)
    }));
    const downloadInput = {
      ...source,
      linked_type: linkedType,
      storage_path: copiedContext.storage_path
    };
    // Compare against the local knowledge database before downloading so papers
    // already ingested are reused instead of re-fetched, re-parsed, and
    // re-summarized. Only the novel candidates are downloaded.
    const { novel: novelCandidates, reused: reusedPapers } = await partitionByLocalKnowledge(
      workflowCandidates,
      copiedContext.storage_path,
      source
    );
    const reusedPaperIds = new Set(reusedPapers.map((paper) => cleanText(paper.paper_id, 120)).filter(Boolean));
    selectedPapers.forEach((paper) => {
      if (reusedPaperIds.has(cleanText(paper.paper_id, 120))) {
        paper.download_status = 'already_ingested';
      }
    });
    const downloadPromise = autoDownloadSelectedPapers
      ? downloadSelectedPapers(novelCandidates, downloadInput, linkedName)
      : Promise.resolve([]);
    const useCodexPaperContext = Boolean(codexSubAgentRuntime)
      && shouldUseCodexPaperContextWorkflow(source)
      && (autoDownloadSelectedPapers || reusedPapers.length > 0);
    let downloadedPapers = reusedPapers.slice();
    let readResult = null;
    let paperContextSubAgent = null;

    if (useCodexPaperContext) {
      downloadedPapers = reusedPapers.concat(asArray(await downloadPromise));
      paperContextSubAgent = await runCodexPaperContextSubAgent({
        subAgentRuntime: codexSubAgentRuntime,
        query,
        message: cleanText(source.message, 1600) || query,
        copiedContext: copiedContext,
        selectedPapers,
        downloadedPapers,
        snapshot: source.snapshot || null,
        source,
        parentRequestId: cleanText(source.traceContext?.requestId || source.request_id, 160),
        cwd: cleanText(source.cwd, 2400),
        model: cleanText(source.model, 120),
        reasoningEffort: cleanText(source.reasoning_effort || source.reasoningEffort, 40),
        name: sanitizeFolderName(
          cleanText(source.sub_agent_name || source.subAgentName, 160)
          || `codex-paper-context-${Date.now()}`
        )
      }, { asArray, cleanText });
      if (!paperContextSubAgent?.ok) {
        return {
          ok: false,
          status: cleanText(paperContextSubAgent?.status, 40) || 'error',
          error: cleanText(paperContextSubAgent?.error, 1200) || 'Codex paper context sub-agent failed.',
          query,
          sources: asArray(rawSearchResult.sources),
          items: asArray(rawSearchResult.items),
          citations: asArray(rawSearchResult.citations),
          source_counts: cloneJson(defaultEnsureObject(rawSearchResult.source_counts), {}),
          source_errors: cloneJson(defaultEnsureObject(rawSearchResult.source_errors), {}),
          selected_papers: selectedPapers,
          downloaded_papers: downloadedPapers,
          loaded_context_blocks: [],
          papers_read_count: 0,
          sub_agent_id: cleanText(paperContextSubAgent?.sub_agent_id, 160),
          sub_agent: paperContextSubAgent?.sub_agent || null,
          sub_agent_context: copiedContext,
          codex_paper_context: true,
          summary: cleanText(paperContextSubAgent?.error, 600) || 'Codex paper context sub-agent failed.'
        };
      }
      readResult = {
        ok: true,
        status: cleanText(paperContextSubAgent.status, 40) || 'completed',
        papers_read_count: Number(paperContextSubAgent.papers_read_count) || 0,
        loaded_context_blocks: asArray(paperContextSubAgent.loaded_context_blocks),
        papers: asArray(paperContextSubAgent.selected_papers),
        summary: cleanText(paperContextSubAgent.summary, 800)
          || `Codex paper context sub-agent loaded ${asArray(paperContextSubAgent.loaded_context_blocks).length} context block(s).`
      };
    } else {
      const readPromise = readSelectedPapers(workflowCandidates, {
        ...source,
        query,
        downloaded_papers: downloadedPapers,
        downloadPromise: autoDownloadSelectedPapers ? downloadPromise : null
      });
      if (autoDownloadSelectedPapers) {
        const [newDownloadedPapers, loadedReadResult] = await Promise.all([downloadPromise, readPromise]);
        downloadedPapers = reusedPapers.concat(asArray(newDownloadedPapers));
        readResult = loadedReadResult;
      } else {
        readResult = await readPromise;
      }
    }

    const contextBlockCount = asArray(readResult.loaded_context_blocks).length;
    const reusedCount = downloadedPapers.filter((paper) => paper.status === 'reused').length;
    const downloadCount = downloadedPapers.filter((paper) => paper.ok === true && paper.status !== 'reused').length;
    const candidateCount = asArray(rawSearchResult.items).length;
    const summary = [
      candidateCount ? `Found ${candidateCount} candidate paper${candidateCount === 1 ? '' : 's'}.` : 'No candidate papers were found.',
      selectedPapers.length ? `Selected ${selectedPapers.length} paper${selectedPapers.length === 1 ? '' : 's'} for deeper reading.` : 'No papers were selected for deeper reading.',
      reusedCount ? `Reused ${reusedCount} paper${reusedCount === 1 ? '' : 's'} already in the local knowledge database.` : '',
      autoDownloadSelectedPapers
        ? (downloadCount ? `Downloaded ${downloadCount} selected PDF${downloadCount === 1 ? '' : 's'} into the literature-search folder.` : 'No new paper PDFs were downloaded.')
        : 'New PDF downloads were not started automatically; use the paper download button or explicit paper-download action to download selected papers.',
      contextBlockCount ? `Loaded ${contextBlockCount} bounded context block${contextBlockCount === 1 ? '' : 's'} from the selected papers.` : 'No bounded context blocks were loaded.'
    ].filter(Boolean).join(' ');

    return {
      ok: true,
      status: 'completed',
      query,
      sources: asArray(rawSearchResult.sources),
      items: asArray(rawSearchResult.items),
      citations: asArray(rawSearchResult.citations),
      source_counts: cloneJson(defaultEnsureObject(rawSearchResult.source_counts), {}),
      source_errors: cloneJson(defaultEnsureObject(rawSearchResult.source_errors), {}),
      selected_papers: selectedPapers,
      downloaded_papers: downloadedPapers,
      loaded_context_blocks: asArray(readResult.loaded_context_blocks),
      papers_read_count: Number(readResult.papers_read_count) || 0,
      sub_agent_id: cleanText(paperContextSubAgent?.sub_agent_id, 160),
      sub_agent: paperContextSubAgent?.sub_agent || null,
      sub_agent_context: copiedContext,
      codex_paper_context: useCodexPaperContext,
      summary
    };
  }

  return { runLiteratureWorkflow };
}

module.exports = { createRunLiteratureWorkflow };
