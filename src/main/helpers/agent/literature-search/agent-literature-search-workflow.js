'use strict';

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');
const { createAgentSubAgentRuntime } = require('../tools/agent-sub-agent.js');

const SEARCH_BATCH_SIZE = 8;
const DEFAULT_MAX_CANDIDATE_PAPERS = 12;
const DEFAULT_DOWNLOAD_CONCURRENCY = 4;

const PAPER_TOKEN_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to',
  'was', 'were', 'with', 'without'
]);

const SOURCE_ORDER = new Map([
  ['pubmed', 0],
  ['europe_pmc', 1],
  ['crossref', 2],
  ['uniprot', 3],
  ['web', 4]
]);

function defaultEnsureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function parseDateToTimestamp(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueByKey(items, keyFn, max = 50) {
  const seen = new Set();
  const out = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (out.length >= max) {
      return;
    }
    const key = String(typeof keyFn === 'function' ? keyFn(item) : '').trim().toLowerCase();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(item);
  });
  return out;
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

function tokenizeQuery(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !PAPER_TOKEN_STOPWORDS.has(token));
}

function buildCandidateKey(item = {}) {
  return String(
    item.doi
    || item.pmid
    || item.pmcid
    || item.url
    || item.id
    || item.title
    || item.paper_id
    || ''
  ).trim().toLowerCase();
}

function scorePaperCandidate(item = {}, query = '') {
  const source = defaultEnsureObject(item);
  const queryText = String(query || '').trim().toLowerCase();
  const tokens = tokenizeQuery(queryText);
  const haystack = [
    source.title,
    source.summary,
    source.snippet,
    source.journal,
    source.source,
    source.protein_name,
    source.gene_name,
    source.organism
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');

  let score = 0;
  tokens.forEach((token) => {
    if (haystack.includes(token)) {
      score += 3;
    }
  });
  if (queryText && haystack.includes(queryText)) {
    score += 8;
  }
  if (String(source.source || '').toLowerCase() === 'pubmed') {
    score += 1.5;
  } else if (String(source.source || '').toLowerCase() === 'europe_pmc') {
    score += 1;
  }
  const publishedAt = parseDateToTimestamp(source.published_at);
  if (publishedAt) {
    score += publishedAt / 1e14;
  }
  return score;
}

function selectPaperCandidates(items = [], query = '', limit = 12) {
  const ranked = (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      ...defaultEnsureObject(item),
      __index: index,
      __score: scorePaperCandidate(item, query),
      __published_at: parseDateToTimestamp(item?.published_at)
    }))
    .sort((left, right) => {
      if (right.__score !== left.__score) {
        return right.__score - left.__score;
      }
      if (right.__published_at !== left.__published_at) {
        return right.__published_at - left.__published_at;
      }
      const sourceLeft = SOURCE_ORDER.has(String(left.source || '').toLowerCase())
        ? SOURCE_ORDER.get(String(left.source || '').toLowerCase())
        : 999;
      const sourceRight = SOURCE_ORDER.has(String(right.source || '').toLowerCase())
        ? SOURCE_ORDER.get(String(right.source || '').toLowerCase())
        : 999;
      if (sourceLeft !== sourceRight) {
        return sourceLeft - sourceRight;
      }
      return left.__index - right.__index;
    });

  return uniqueByKey(ranked, buildCandidateKey, Math.max(1, Number(limit) || 12))
    .map((item) => {
      const normalized = { ...item };
      delete normalized.__index;
      delete normalized.__score;
      delete normalized.__published_at;
      return normalized;
    });
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
  const createSubAgentRuntime = typeof deps.createSubAgentRuntime === 'function'
    ? deps.createSubAgentRuntime
    : createAgentSubAgentRuntime;
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
        source.preferred_literature_source || source.preferredLiteratureSource,
        80
      ),
      preferred_web_source: cleanText(
        source.preferred_web_source || source.preferredWebSource,
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

  function buildSubAgentSystemPrompt() {
    return [
      'You are a delegated literature search sub-agent.',
      'Use the copied main-agent context to search for candidate papers, select the most useful ones, download selected PDFs into the literature-search folder when possible, and read the selected papers in batches.',
      'Return only grounded context that can be loaded back into the main agent.',
      'Never invent citations or claim that a download succeeded unless the download tool reported success.'
    ].join(' ');
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
          paper_id: cleanText(candidate.paper_id || candidate.id, 120),
          paper_title: cleanText(candidate.title, 320),
          ok: downloadResult.ok === true,
          status: cleanText(downloadResult.status, 80),
          file_name: cleanText(downloadResult.file_name, 240),
          file_path: cleanText(downloadResult.file_path, 4000),
          relative_path: cleanText(downloadResult.relative_path, 2000),
          error: cleanText(downloadResult.error, 1200)
        });
      });
    }

    return downloadedPapers;
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
        items: batch
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
          evidence_kind: cleanText(block?.evidence_kind, 40)
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

    const rawSearchResult = candidateResult && candidateResult.ok === true
      ? candidateResult
      : await searchFn({
        ...source,
        query,
        limit: searchLimit,
        max_per_source: searchMaxPerSource
      });

    if (!rawSearchResult?.ok) {
      return rawSearchResult;
    }

    const selectedCandidates = selectPaperCandidates(
      asArray(rawSearchResult.items),
      query,
      desiredSelectionCount
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

    const downloadPromise = downloadSelectedPapers(enrichedCandidates, {
      ...source,
      storage_path: copiedContext.storage_path
    }, linkedName);
    const readPromise = readSelectedPapers(enrichedCandidates, {
      ...source,
      query
    });
    const [downloadedPapers, readResult] = await Promise.all([downloadPromise, readPromise]);

    const selectedPapers = enrichedCandidates.map((candidate) => ({
      paper_id: cleanText(candidate.paper_id || candidate.id, 120),
      paper_title: cleanText(candidate.title, 320),
      source: cleanText(candidate.source, 80),
      summary: cleanText(candidate.summary || candidate.snippet, 1200),
      url: cleanText(candidate.url, 1200),
      doi: cleanText(candidate.doi, 180),
      pmid: cleanText(candidate.pmid, 120),
      pmcid: cleanText(candidate.pmcid, 120),
      pdf_urls: uniqueStrings(asArray(candidate.pdf_urls), 8),
      published_at: cleanText(candidate.published_at, 80),
      score: scorePaperCandidate(candidate, query)
    }));

    const contextBlockCount = asArray(readResult.loaded_context_blocks).length;
    const downloadCount = downloadedPapers.filter((paper) => paper.ok === true).length;
    const candidateCount = asArray(rawSearchResult.items).length;
    const summary = [
      candidateCount ? `Found ${candidateCount} candidate paper${candidateCount === 1 ? '' : 's'}.` : 'No candidate papers were found.',
      selectedPapers.length ? `Selected ${selectedPapers.length} paper${selectedPapers.length === 1 ? '' : 's'} for deeper reading.` : 'No papers were selected for deeper reading.',
      downloadCount ? `Downloaded ${downloadCount} selected PDF${downloadCount === 1 ? '' : 's'} into the literature-search folder.` : 'No paper PDFs were downloaded.',
      contextBlockCount ? `Loaded ${contextBlockCount} bounded context block${contextBlockCount === 1 ? '' : 's'} from the selected papers.` : 'No bounded context blocks were loaded.'
    ].join(' ');

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
      sub_agent_context: copiedContext,
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
      system_prompt: buildSubAgentSystemPrompt(),
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
  createLiteratureSearchWorkflowRuntime,
  selectPaperCandidates,
  scorePaperCandidate
};
