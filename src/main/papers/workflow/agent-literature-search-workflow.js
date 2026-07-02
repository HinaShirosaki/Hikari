'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../helpers/agent/shared/agent-llm-utils.js');
const { cloneJson, normalizeRelatedComments } = require('../shared/paper-comment-context.js');
const { createAgentSubAgentRuntime } = require('../../helpers/agent/tools/agent-sub-agent.js');
const {
  normalizePreferredJournals,
  scorePaperCandidate,
  selectPaperCandidates
} = require('../search/literature-candidates.js');
const {
  runCodexPaperContextSubAgent,
  shouldUseCodexPaperContextWorkflow
} = require('./codex-paper-context-workflow.js');

const SEARCH_BATCH_SIZE = 8;
const DEFAULT_MAX_CANDIDATE_PAPERS = 12;
const DEFAULT_DOWNLOAD_CONCURRENCY = 4;

function defaultEnsureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function chunkArray(items, size) {
  const source = Array.isArray(items) ? items : [];
  const chunkSize = Math.max(1, Number(size) || 1);
  const chunks = [];
  for (let index = 0; index < source.length; index += chunkSize) {
    chunks.push(source.slice(index, index + chunkSize));
  }
  return chunks;
}

function sanitizeFolderName(value, fallback = 'Literature Search') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

function buildDoiUrl(value) {
  const doi = String(value || '').trim();
  if (!doi) {
    return '';
  }
  return `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, '/')}`;
}

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
    : createAgentSubAgentRuntime;
  const codexSubAgentRuntime = deps.subAgentRuntime && typeof deps.subAgentRuntime === 'object'
    ? deps.subAgentRuntime
    : null;
  const subAgentStore = deps.subAgentStore instanceof Map ? deps.subAgentStore : new Map();
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());

  function getCandidateSearchRuntime() {
    if (literatureSearchRuntime && typeof literatureSearchRuntime.searchLiteratureCandidates === 'function') {
      return literatureSearchRuntime.searchLiteratureCandidates.bind(literatureSearchRuntime);
    }
    if (literatureSearchRuntime && typeof literatureSearchRuntime.searchLiterature === 'function') {
      return literatureSearchRuntime.searchLiterature.bind(literatureSearchRuntime);
    }
    return null;
  }

  function buildCopiedContext(input = {}, query = '') {
    const source = defaultEnsureObject(input);
    const snapshot = defaultEnsureObject(source.snapshot);
    const project = defaultEnsureObject(source.project || snapshot.project);
    const settings = defaultEnsureObject(snapshot.settings);
    const parserPayload = defaultEnsureObject(source.parser_payload || source.parserPayload);
    return {
      message: cleanText(source.message, 1200),
      query: cleanText(query || source.query, 600),
      topic: cleanText(source.topic, 240),
      source: cleanText(source.source, 80),
      sources: uniqueStrings(asArray(source.sources).map((item) => cleanText(item, 80)), 8),
      preferred_literature_source: cleanText(
        source.preferred_literature_source
        || source.preferredLiteratureSource
        || settings.preferred_literature_source
        || settings.preferredLiteratureSource
        || snapshot.preferred_literature_source
        || snapshot.preferredLiteratureSource,
        80
      ),
      preferred_web_source: cleanText(
        source.preferred_web_source
        || source.preferredWebSource
        || settings.preferred_web_source
        || settings.preferredWebSource
        || snapshot.preferred_web_source
        || snapshot.preferredWebSource,
        240
      ),
      project: {
        id: cleanText(project.id || project.projectId, 120),
        name: cleanText(project.name || project.projectName, 220)
      },
      storage_path: cleanText(
        source.storage_path
        || source.storagePath
        || settings.storagePath
        || snapshot.storagePath,
        2000
      ),
      preferred_journal: cleanText(
        source.preferred_journal
        || source.preferredJournal
        || settings.preferredJournal
        || snapshot.preferredJournal,
        1200
      ),
      preferred_journals: uniqueStrings(asArray(
        source.preferred_journals
        || source.preferredJournals
        || settings.preferredJournals
        || snapshot.preferredJournals
      ).map((item) => cleanText(item, 240)), 12),
      parser_payload: parserPayload,
      snapshot_summary: {
        project_count: asArray(snapshot.projects).length,
        protocol_count: asArray(snapshot.protocols).length,
        workflow_count: asArray(snapshot.workflows).length,
        notebook_entry_count: asArray(snapshot.notebookEntries).length,
        paper_count: asArray(snapshot.papers).length
      }
    };
  }

  function buildSubAgentSystemPrompt(context = {}) {
    const contextSource = defaultEnsureObject(context);
    const preferredJournals = uniqueStrings(
      asArray(contextSource.preferred_journals).map((item) => cleanText(item, 240)),
      12
    );
    const preferredJournal = preferredJournals.length
      ? preferredJournals.join('; ')
      : cleanText(contextSource.preferred_journal, 1200);
    const preferredJournalLine = preferredJournal
      ? `The user has set preferred journals: "${preferredJournal}". When candidate quality is comparable, prefer papers from these journals (match by URL host or by journal name). Do not exclude other journals; treat them as soft preferences, not filters.`
      : '';
    return [
      'You are a delegated literature search sub-agent.',
      'Use the copied main-agent context to search for candidate papers, select the most useful ones, download selected PDFs into the literature-search folder when possible, and read the selected papers in batches.',
      'Return only grounded context that can be loaded back into the main agent.',
      'Never invent citations or claim that a download succeeded unless the download tool reported success.',
      preferredJournalLine
    ].filter(Boolean).join(' ');
  }

  function buildSubAgentMessage(context = {}) {
    return [
      'Search literature for the current request and prepare main-agent context to load.',
      `Copied context JSON:\n${JSON.stringify(context, null, 2)}`,
      'Use the search results, abstracts, and returned lists to choose the papers that should be fully read.',
      'Download selected papers into the literature-search folder under the configured storage root when a storage path is available.',
      'Read selected papers in batches and return the resulting context blocks, selected paper list, download outcomes, and any useful notes.'
    ].join('\n\n');
  }

  function assignCanonicalPaperIds(items = []) {
    return asArray(items).map((item, index) => ({
      ...defaultEnsureObject(item),
      paper_id: `paper-${index + 1}`
    }));
  }

  async function enrichPaperForDownload(item = {}) {
    const source = defaultEnsureObject(item);
    const metadata = paperContextLoaderRuntime && typeof paperContextLoaderRuntime.fetchEuropePmcMetadataForItem === 'function'
      ? await paperContextLoaderRuntime.fetchEuropePmcMetadataForItem(source).catch(() => ({}))
      : {};
    const pdfUrls = uniqueStrings([
      ...asArray(source.pdf_urls),
      ...asArray(metadata.pdf_urls),
      source.url
    ], 8);
    const abstractSections = asArray(metadata.abstract_sections);
    const summary = cleanText(
      source.summary
      || source.snippet
      || abstractSections[0]?.text
      || '',
      12000
    );
    return {
      ...source,
      pmid: cleanText(metadata?.pmid, 120) || cleanText(source.pmid, 120),
      pmcid: cleanText(metadata?.pmcid, 120) || cleanText(source.pmcid, 120),
      doi: cleanText(metadata?.doi, 180) || cleanText(source.doi, 180),
      summary,
      pdf_urls: pdfUrls
    };
  }

  async function downloadSelectedPaper(item = {}, input = {}, linkedName = '') {
    if (!paperDownloadRuntime || typeof paperDownloadRuntime.downloadPaper !== 'function') {
      return null;
    }
    const source = defaultEnsureObject(item);
    const storagePath = cleanText(
      input.storage_path
      || input.storagePath
      || defaultEnsureObject(input.snapshot).settings?.storagePath
      || defaultEnsureObject(input.snapshot).storagePath,
      2000
    );
    if (!storagePath) {
      return null;
    }

    const doiUrl = buildDoiUrl(source.doi);
    const candidateUrls = uniqueStrings([
      ...asArray(source.pdf_urls),
      source.url,
      doiUrl
    ], 8);
    if (!candidateUrls.length && !source.url && !doiUrl) {
      return null;
    }

    return paperDownloadRuntime.downloadPaper({
      action: 'download',
      message: [
        cleanText(source.title, 320),
        cleanText(source.summary, 1200),
        cleanText(source.doi, 180),
        cleanText(source.url, 1200)
      ].filter(Boolean).join('\n'),
      paper_title: cleanText(source.title, 320),
      doi: cleanText(source.doi, 180),
      page_url: cleanText(source.url, 1200) || doiUrl,
      candidate_urls: candidateUrls,
      paper_pdf_url: candidateUrls.find((url) => /\.(?:pdf)(?:$|[?#])/i.test(String(url || ''))) || '',
      linked_type: 'literature-search',
      linked_name: sanitizeFolderName(linkedName || input.topic || input.query || 'Literature Search'),
      storage_path: storagePath,
      use_browser_fallback: true
    }).catch((error) => ({
      ok: false,
      status: 'failed',
      error: cleanText(error?.message || error, 1200) || 'Paper download failed.'
    }));
  }

  async function downloadSelectedPapers(items = [], input = {}, linkedName = '') {
    const selectedItems = Array.isArray(items) ? items.slice(0, 24) : [];
    if (!selectedItems.length) {
      return [];
    }

    const concurrency = Math.max(
      1,
      Math.min(
        Number.isFinite(Number(input.max_download_concurrency))
          ? Number(input.max_download_concurrency)
          : DEFAULT_DOWNLOAD_CONCURRENCY,
        selectedItems.length
      )
    );
    const batches = chunkArray(selectedItems, concurrency);
    const downloadedPapers = [];

    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async (candidate) => ({
          candidate,
          downloadResult: await downloadSelectedPaper(candidate, input, linkedName)
        }))
      );

      batchResults.forEach(({ candidate, downloadResult }) => {
        if (!downloadResult) {
          return;
        }
        downloadedPapers.push({
          paper_id: cleanText(candidate.paper_id, 120),
          paper_title: cleanText(candidate.title, 320),
          ok: downloadResult.ok === true,
          status: cleanText(downloadResult.status, 80),
          file_name: cleanText(downloadResult.file_name, 240),
          file_path: cleanText(downloadResult.file_path, 4000),
          relative_path: cleanText(downloadResult.relative_path, 2000),
          knowledge_markdown_path: cleanText(downloadResult.knowledge_markdown_path, 4000),
          knowledge_markdown_relative_path: cleanText(downloadResult.knowledge_markdown_relative_path, 2000),
          knowledge_database: downloadResult.knowledge_database && typeof downloadResult.knowledge_database === 'object'
            ? cloneJson(downloadResult.knowledge_database, null)
            : null,
          error: cleanText(downloadResult.error, 1200)
        });
      });
    }

    return downloadedPapers;
  }

  /**
   * Split selected candidates into those already present in the local knowledge
   * database (reuse the existing record, skip the download) and those that are
   * new and must be downloaded + ingested. Dedup is best-effort: if the
   * knowledge runtime or a storage path is unavailable, or the caller opts out
   * with `skip_local_dedup`, every candidate is treated as novel — preserving
   * the previous download-everything behavior.
   *
   * ponytail: one lookupPaper call per candidate (≤24). Batch into a single DB
   * open if the candidate count ever grows past a couple dozen.
   */
  async function partitionByLocalKnowledge(candidates = [], storagePath = '', input = {}) {
    const list = asArray(candidates);
    const source = defaultEnsureObject(input);
    if (
      !paperKnowledgeDatabaseRuntime
      || typeof paperKnowledgeDatabaseRuntime.lookupPaper !== 'function'
      || !cleanText(storagePath, 2000)
      || source.skip_local_dedup === true
      || source.skipLocalDedup === true
    ) {
      return { novel: list, reused: [] };
    }

    const novel = [];
    const reused = [];
    for (const candidate of list) {
      const item = defaultEnsureObject(candidate);
      const lookup = await paperKnowledgeDatabaseRuntime.lookupPaper({
        storage_path: storagePath,
        doi: cleanText(item.doi, 180),
        pmid: cleanText(item.pmid, 120),
        pmcid: cleanText(item.pmcid, 120),
        title: cleanText(item.title, 320)
      }).catch(() => null);

      // Only reuse when the markdown actually exists on disk; a stale index row
      // whose paper.md is gone should be re-ingested, not silently skipped.
      if (lookup?.ok === true && lookup.status === 'found' && lookup.paper?.wiki_exists === true) {
        const markdownPath = cleanText(lookup.paper.wiki_file_path, 4000);
        // Annotate the candidate so the (non-Codex) context loader reads the
        // saved paper.md instead of falling back to the abstract. `item` is the
        // same object the reader receives in workflowCandidates.
        item.markdown_path = markdownPath;
        reused.push({
          paper_id: cleanText(item.paper_id, 120),
          paper_title: cleanText(item.title, 320),
          ok: true,
          status: 'reused',
          knowledge_paper_id: cleanText(lookup.paper.id, 180),
          knowledge_markdown_relative_path: cleanText(lookup.paper.wiki_path, 2000),
          knowledge_markdown_path: markdownPath,
          error: ''
        });
      } else {
        novel.push(item);
      }
    }
    return { novel, reused };
  }

  async function readSelectedPapers(items = [], input = {}) {
    if (!paperContextLoaderRuntime || typeof paperContextLoaderRuntime.loadPaperContexts !== 'function') {
      return {
        ok: true,
        status: 'completed',
        papers_read_count: 0,
        loaded_context_blocks: [],
        papers: [],
        summary: 'Paper context loader is not configured.'
      };
    }

    const selectedItems = Array.isArray(items) ? items.slice(0, 24) : [];
    const batches = chunkArray(selectedItems, SEARCH_BATCH_SIZE);
    const loadedContextBlocks = [];
    const papers = [];
    const blockKeys = new Set();
    let papersReadCount = 0;

    for (const batch of batches) {
      const result = await paperContextLoaderRuntime.loadPaperContexts({
        traceContext: input.traceContext || null,
        message: cleanText(input.message, 1600),
        topic: cleanText(input.topic, 240),
        query: cleanText(input.query, 600),
        figure_policy: cleanText(input.figure_policy, 40) || 'when_needed',
        max_papers: batch.length,
        items: batch,
        snapshot: input.snapshot || null,
        download_promise: input.downloadPromise || null
      }).catch((error) => ({
        ok: false,
        status: 'error',
        error: cleanText(error?.message || error, 600) || 'Paper context loading failed.',
        papers_read_count: 0,
        loaded_context_blocks: [],
        papers: []
      }));

      papersReadCount += Number(result?.papers_read_count) || 0;
      asArray(result?.papers).forEach((paper) => {
        papers.push(paper);
      });
      asArray(result?.loaded_context_blocks).forEach((block) => {
        const normalized = {
          paper_id: cleanText(block?.paper_id, 120),
          paper_title: cleanText(block?.paper_title, 320),
          section_label: cleanText(block?.section_label, 160),
          excerpt: cleanText(block?.excerpt, 1800),
          relevance_reason: cleanText(block?.relevance_reason, 260),
          source: cleanText(block?.source, 80),
          evidence_kind: cleanText(block?.evidence_kind, 40),
          related_comments: normalizeRelatedComments(block?.related_comments || block?.relatedComments, { asArray, cleanText })
        };
        const key = [
          normalized.paper_id,
          normalized.section_label,
          normalized.excerpt
        ].join('|').toLowerCase();
        if (!normalized.paper_id || !normalized.excerpt || blockKeys.has(key)) {
          return;
        }
        blockKeys.add(key);
        loadedContextBlocks.push(normalized);
      });
    }

    return {
      ok: true,
      status: 'completed',
      papers_read_count: papersReadCount,
      loaded_context_blocks: loadedContextBlocks,
      papers,
      summary: loadedContextBlocks.length
        ? `Read ${papersReadCount} paper(s) and loaded ${loadedContextBlocks.length} context block(s).`
        : (papersReadCount
          ? `Read ${papersReadCount} paper(s) but did not load any bounded context blocks.`
          : 'No paper context could be loaded from the selected papers.')
    };
  }

  async function runLiteratureWorkflow(input = {}, copiedContext = {}, candidateResult = null) {
    const source = defaultEnsureObject(input);
    const query = cleanText(
      source.query
      || source.topic
      || source.message
      || candidateResult?.query
      || '',
      600
    );
    const desiredSelectionCount = Math.max(
      1,
      Math.min(
        Number.isFinite(Number(source.max_papers)) ? Number(source.max_papers) : DEFAULT_MAX_CANDIDATE_PAPERS,
        24
      )
    );
    const candidateLimit = Math.max(
      desiredSelectionCount,
      Math.max(1, Number(source.limit) || DEFAULT_MAX_CANDIDATE_PAPERS)
    );
    const searchLimit = Math.min(25, candidateLimit);
    const searchMaxPerSource = Math.min(
      10,
      Math.max(1, Number(source.max_per_source) || Math.min(searchLimit, 5))
    );
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
      query,
      limit: searchLimit,
      max_per_source: searchMaxPerSource
    };

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
    const linkedName = sanitizeFolderName(
      cleanText(copiedContext.project?.name, 220)
      || cleanText(source.topic, 240)
      || cleanText(query, 220)
      || 'Literature Search'
    );

    const enrichedCandidates = [];
    for (const candidate of selectedCandidates) {
      enrichedCandidates.push(await enrichPaperForDownload(candidate));
    }
    const workflowCandidates = assignCanonicalPaperIds(enrichedCandidates);
    const selectedPapers = workflowCandidates.map((candidate) => ({
      paper_id: cleanText(candidate.paper_id, 120),
      paper_title: cleanText(candidate.title, 320),
      source: cleanText(candidate.source, 80),
      summary: cleanText(candidate.summary || candidate.snippet, 1200),
      url: cleanText(candidate.url, 1200),
      doi: cleanText(candidate.doi, 180),
      pmid: cleanText(candidate.pmid, 120),
      pmcid: cleanText(candidate.pmcid, 120),
      pdf_urls: uniqueStrings(asArray(candidate.pdf_urls), 8),
      published_at: cleanText(candidate.published_at, 80),
      score: scorePaperCandidate(candidate, query, preferredJournal)
    }));
    const downloadInput = {
      ...source,
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
    const downloadPromise = downloadSelectedPapers(novelCandidates, downloadInput, linkedName);
    const useCodexPaperContext = Boolean(codexSubAgentRuntime)
      && shouldUseCodexPaperContextWorkflow(source);
    let downloadedPapers = [];
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
        downloadPromise
      });
      [downloadedPapers, readResult] = await Promise.all([downloadPromise, readPromise]);
      downloadedPapers = reusedPapers.concat(asArray(downloadedPapers));
    }

    const contextBlockCount = asArray(readResult.loaded_context_blocks).length;
    const reusedCount = downloadedPapers.filter((paper) => paper.status === 'reused').length;
    const downloadCount = downloadedPapers.filter((paper) => paper.ok === true && paper.status !== 'reused').length;
    const candidateCount = asArray(rawSearchResult.items).length;
    const summary = [
      candidateCount ? `Found ${candidateCount} candidate paper${candidateCount === 1 ? '' : 's'}.` : 'No candidate papers were found.',
      selectedPapers.length ? `Selected ${selectedPapers.length} paper${selectedPapers.length === 1 ? '' : 's'} for deeper reading.` : 'No papers were selected for deeper reading.',
      reusedCount ? `Reused ${reusedCount} paper${reusedCount === 1 ? '' : 's'} already in the local knowledge database.` : '',
      downloadCount ? `Downloaded ${downloadCount} selected PDF${downloadCount === 1 ? '' : 's'} into the literature-search folder.` : 'No new paper PDFs were downloaded.',
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
    if (useCodexPaperContext) {
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
          codex_paper_context: true,
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
        codex_paper_context: true,
        summary: cleanText(workflowResult.summary, 600)
          || `Completed delegated literature search for ${query}.`
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
            downloaded_count: asArray(workflowResult.downloaded_papers).filter((item) => item?.ok === true).length,
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
