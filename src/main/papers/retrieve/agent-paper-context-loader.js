'use strict';

const { Buffer } = require('node:buffer');
const fsPromises = require('node:fs/promises');

const { createAgentLlmRuntimeHelpers } = require('../../helpers/agent/shared/agent-llm-utils.js');
const {
  attachRelatedCommentsToContextBlocks,
  buildPaperAnnotationContext,
  getRelatedCommentsForPaperId,
  normalizeRelatedComments
} = require('../shared/paper-comment-context.js');
const {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  ensureObject,
  stripHtml,
  safeUrl,
  splitMarkdownIntoSections,
  createPaperContextText
} = require('./paper-context-text.js');
const { createPaperContextSelection } = require('./paper-context-selection.js');
const { createPaperContextLlm } = require('./paper-context-llm.js');

const PAPER_CONTEXT_SOURCE_ORDER = Object.freeze([
  'europe_pmc_full_text',
  'pubmed_abstract',
  'europe_pmc_abstract',
  'crossref_abstract',
  'search_result_summary'
]);

const DEFAULT_MAX_PAPERS = 8;
const DEFAULT_MAX_BLOCKS = 50;
const DEFAULT_MAX_BLOCKS_PER_PAPER = 2;
const DEFAULT_MAX_BLOCKS_PER_PAPER_WITH_PDF = 4;
const DEFAULT_MAX_FIGURE_REVIEWS = 2;

const PAPER_CONTEXT_SELECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['selected_blocks', 'figure_review_requests'],
  properties: {
    selected_blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['block_id', 'relevance_reason'],
        properties: {
          block_id: { type: 'string' },
          relevance_reason: { type: 'string' }
        }
      }
    },
    figure_review_requests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['paper_id', 'reason'],
        properties: {
          paper_id: { type: 'string' },
          reason: { type: 'string' }
        }
      }
    }
  }
};

const PAPER_FIGURE_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['useful', 'figure_summary', 'relevance_reason'],
  properties: {
    useful: { type: 'boolean' },
    figure_summary: { type: 'string' },
    relevance_reason: { type: 'string' }
  }
};

const PAPER_PDF_EXCERPT_SELECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['excerpts'],
  properties: {
    excerpts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section_label', 'excerpt', 'relevance_reason'],
        properties: {
          section_label: { type: 'string' },
          excerpt: { type: 'string' },
          relevance_reason: { type: 'string' }
        }
      }
    }
  }
};

const PAPER_PDF_TEXT_EXCERPT_SELECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['excerpts', 'request_pdf_review', 'pdf_review_reason'],
  properties: {
    excerpts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section_label', 'excerpt', 'relevance_reason'],
        properties: {
          section_label: { type: 'string' },
          excerpt: { type: 'string' },
          relevance_reason: { type: 'string' }
        }
      }
    },
    request_pdf_review: { type: 'boolean' },
    pdf_review_reason: { type: 'string' }
  }
};

function createPaperContextLoaderRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestStructuredJsonPayload
  } = createAgentLlmRuntimeHelpers(deps);
  // Tokenizer / chunker / scorer / PubMed + Europe PMC parsers, bound to the
  // same runtime helpers they used inline before the split.
  const {
    scoreTextAgainstQuery,
    chunkSectionText,
    parseEuropePmcFullTextSections,
    parsePubMedAbstractSections,
    parseEuropePmcMetadata,
    buildPaperPdfUrls
  } = createPaperContextText({ cleanText, asArray, uniqueStrings });
  // Deterministic block selection/merge algebra, bound to the same limits.
  const {
    messageLikelyNeedsFigureReview,
    buildFallbackSelection,
    normalizeSelectionResult,
    mergeSelectedBlocksWithPdf,
    mergeFigureBlocks,
    normalizeLoadedContextBlocks
  } = createPaperContextSelection({
    cleanText,
    asArray,
    ensureObject,
    normalizeRelatedComments,
    maxBlocks: DEFAULT_MAX_BLOCKS,
    maxBlocksPerPaper: DEFAULT_MAX_BLOCKS_PER_PAPER,
    maxBlocksPerPaperWithPdf: DEFAULT_MAX_BLOCKS_PER_PAPER_WITH_PDF,
    maxFigureReviews: DEFAULT_MAX_FIGURE_REVIEWS
  });
  // LLM-orchestrated selection (abstract/candidate, extracted PDF text, PDF
  // binary) + figure review, bound to the same LLM helper, selection algebra,
  // PDF fetch helper, schemas, and limits. fetchPaperPdfDataUrl is a hoisted
  // closure function declared below.
  const {
    selectContextBlocks,
    reviewFigureEvidence
  } = createPaperContextLlm({
    requestStructuredJsonPayload,
    cleanText,
    asArray,
    normalizeRelatedComments,
    buildFallbackSelection,
    normalizeSelectionResult,
    mergeSelectedBlocksWithPdf,
    fetchPaperPdfDataUrl: (paper) => fetchPaperPdfDataUrl(paper),
    maxBlocks: DEFAULT_MAX_BLOCKS,
    maxBlocksPerPaper: DEFAULT_MAX_BLOCKS_PER_PAPER,
    maxBlocksPerPaperWithPdf: DEFAULT_MAX_BLOCKS_PER_PAPER_WITH_PDF,
    maxFigureReviews: DEFAULT_MAX_FIGURE_REVIEWS,
    selectionSchema: PAPER_CONTEXT_SELECTION_SCHEMA,
    pdfExcerptSchema: PAPER_PDF_EXCERPT_SELECTION_SCHEMA,
    pdfTextSchema: PAPER_PDF_TEXT_EXCERPT_SELECTION_SCHEMA,
    figureReviewSchema: PAPER_FIGURE_REVIEW_SCHEMA
  });
  const fetchImpl = typeof deps.fetch === 'function'
    ? deps.fetch
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const pdfTextExtractionRuntime = deps.pdfTextExtractionRuntime
    && typeof deps.pdfTextExtractionRuntime.extractText === 'function'
    ? deps.pdfTextExtractionRuntime
    : null;

  function requireFetch() {
    if (!fetchImpl) {
      throw new Error('Paper context loading requires fetch support.');
    }
    return fetchImpl;
  }

  async function readResponseText(response) {
    if (typeof response?.text === 'function') {
      return String(await response.text());
    }
    if (typeof response?.json === 'function') {
      return JSON.stringify(await response.json());
    }
    return '';
  }

  async function fetchJson(url, options = {}) {
    const response = await requireFetch()(url, options);
    const failed = response?.ok === false || Number(response?.status) >= 400;
    if (failed) {
      const body = await readResponseText(response);
      throw new Error(`Paper context request failed (${Number(response?.status) || 'request'}): ${cleanText(body, 300) || 'no response body'}`);
    }
    if (typeof response?.json === 'function') {
      return response.json();
    }
    const raw = await readResponseText(response);
    return JSON.parse(String(raw || '{}'));
  }

  async function fetchText(url, options = {}) {
    const response = await requireFetch()(url, options);
    const failed = response?.ok === false || Number(response?.status) >= 400;
    if (failed) {
      const body = await readResponseText(response);
      throw new Error(`Paper context request failed (${Number(response?.status) || 'request'}): ${cleanText(body, 300) || 'no response body'}`);
    }
    return readResponseText(response);
  }

  async function fetchBuffer(url, options = {}) {
    const response = await requireFetch()(url, options);
    const failed = response?.ok === false || Number(response?.status) >= 400;
    if (failed) {
      const body = await readResponseText(response);
      throw new Error(`Paper PDF request failed (${Number(response?.status) || 'request'}): ${cleanText(body, 300) || 'no response body'}`);
    }
    if (typeof response?.arrayBuffer === 'function') {
      return Buffer.from(await response.arrayBuffer());
    }
    const raw = await readResponseText(response);
    return Buffer.from(String(raw || ''), 'utf8');
  }


  function normalizePaperItem(item = {}) {
    const source = ensureObject(item);
    const paperId = cleanText(
      source.paper_id || source.id || source.pmid || source.pmcid || source.doi || source.url || source.title,
      220
    );
    return {
      paper_id: paperId,
      paper_title: cleanText(source.title || source.paper_title, 320) || paperId || 'Untitled paper',
      summary: cleanText(source.summary || source.snippet, 12000),
      url: safeUrl(source.url),
      doi: cleanText(source.doi, 180),
      pmid: cleanText(source.pmid, 120),
      pmcid: cleanText(source.pmcid, 120),
      source: cleanText(source.source, 80),
      markdown_path: cleanText(
        source.markdown_path
        || source.knowledge_markdown_path
        || source.knowledge_markdown_file_path,
        4000
      ),
      pdf_urls: uniqueStrings(asArray(source.pdf_urls).map((entry) => safeUrl(entry)).filter(Boolean), 8)
    };
  }

  /**
   * Read a previously-ingested paper.md from disk and split it into sections.
   * This is the canonical reuse path: a paper already in the knowledge database
   * loads its saved full-paper markdown instead of falling back to an abstract.
   * Returns [] when no path is given or the file cannot be read.
   */
  async function readLocalMarkdownSections(markdownPath) {
    const normalizedPath = cleanText(markdownPath, 4000);
    if (!normalizedPath) {
      return [];
    }
    try {
      const markdown = await fsPromises.readFile(normalizedPath, 'utf8');
      return splitMarkdownIntoSections(markdown)
        .map((section) => ({ label: cleanText(section.label, 160), text: cleanText(section.text, 12000) }))
        .filter((section) => section.text);
    } catch {
      return [];
    }
  }

  async function fetchEuropePmcArticle(sourceName, identifier) {
    const source = cleanText(sourceName, 20).toUpperCase();
    const id = cleanText(identifier, 240);
    if (!source || !id) {
      return {};
    }
    return fetchJson(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}?format=json`
    );
  }

  async function fetchEuropePmcMetadataForItem(item = {}) {
    const normalized = normalizePaperItem(item);
    try {
      if (normalized.pmcid) {
        return parseEuropePmcMetadata(await fetchEuropePmcArticle('PMC', normalized.pmcid));
      }
      if (normalized.pmid) {
        return parseEuropePmcMetadata(await fetchEuropePmcArticle('MED', normalized.pmid));
      }
      if (normalized.doi) {
        return parseEuropePmcMetadata(await fetchEuropePmcArticle('DOI', normalized.doi));
      }
    } catch {
      return {};
    }
    return {};
  }

  async function fetchEuropePmcFullTextByPmcid(pmcid) {
    const normalized = cleanText(pmcid, 120);
    if (!normalized) {
      return [];
    }
    try {
      const xml = await fetchText(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(normalized)}/fullTextXML`
      );
      return parseEuropePmcFullTextSections(xml);
    } catch {
      return [];
    }
  }

  async function fetchPubMedAbstractByPmid(pmid) {
    const normalized = cleanText(pmid, 120);
    if (!normalized) {
      return [];
    }
    try {
      const xml = await fetchText(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${encodeURIComponent(normalized)}`
      );
      return parsePubMedAbstractSections(xml);
    } catch {
      return [];
    }
  }

  async function fetchCrossrefAbstractByDoi(doi) {
    const normalized = cleanText(doi, 180);
    if (!normalized) {
      return [];
    }
    try {
      const payload = await fetchJson(
        `https://api.crossref.org/works/${encodeURIComponent(normalized)}`
      );
      const abstractText = cleanText(stripHtml(payload?.message?.abstract || ''), 12000);
      return abstractText
        ? [{ label: 'Abstract', text: abstractText }]
        : [];
    } catch {
      return [];
    }
  }

  async function readPaperContext(item = {}) {
    const normalized = normalizePaperItem(item);

    // Reuse the locally-saved paper.md when available before any network call;
    // this is the full-paper context the dedup step is trying to reuse.
    const localMarkdownSections = await readLocalMarkdownSections(normalized.markdown_path);
    if (localMarkdownSections.length) {
      return {
        ...normalized,
        pdf_urls: buildPaperPdfUrls(normalized),
        read_source: 'local_markdown',
        sections: localMarkdownSections
      };
    }

    const europePmcMetadata = await fetchEuropePmcMetadataForItem(normalized);
    const merged = {
      ...normalized,
      pmid: cleanText(europePmcMetadata.pmid, 120) || normalized.pmid,
      pmcid: cleanText(europePmcMetadata.pmcid, 120) || normalized.pmcid,
      doi: cleanText(europePmcMetadata.doi, 180) || normalized.doi,
      pdf_urls: buildPaperPdfUrls({
        ...normalized,
        ...europePmcMetadata
      })
    };

    const fullTextSections = await fetchEuropePmcFullTextByPmcid(merged.pmcid);
    if (fullTextSections.length) {
      return {
        ...merged,
        read_source: 'europe_pmc_full_text',
        sections: fullTextSections
      };
    }

    const pubMedAbstractSections = await fetchPubMedAbstractByPmid(merged.pmid);
    if (pubMedAbstractSections.length) {
      return {
        ...merged,
        read_source: 'pubmed_abstract',
        sections: pubMedAbstractSections
      };
    }

    const europePmcAbstractSections = asArray(europePmcMetadata.abstract_sections)
      .map((section) => ({
        label: cleanText(section?.label, 160) || 'Abstract',
        text: cleanText(section?.text, 12000)
      }))
      .filter((section) => section.text);
    if (europePmcAbstractSections.length) {
      return {
        ...merged,
        read_source: 'europe_pmc_abstract',
        sections: europePmcAbstractSections
      };
    }

    const crossrefAbstractSections = await fetchCrossrefAbstractByDoi(merged.doi);
    if (crossrefAbstractSections.length) {
      return {
        ...merged,
        read_source: 'crossref_abstract',
        sections: crossrefAbstractSections
      };
    }

    const fallbackText = cleanText(merged.summary, 12000);
    return {
      ...merged,
      read_source: 'search_result_summary',
      sections: fallbackText
        ? [{ label: 'Summary', text: fallbackText }]
        : []
    };
  }

  function buildCandidateBlocks(papers = [], query = '', options = {}) {
    const candidates = [];
    const annotationContext = options?.annotationContext || options?.annotation_context || null;
    asArray(papers).forEach((paper) => {
      const sectionCandidates = [];
      asArray(paper.sections).forEach((section, sectionIndex) => {
        const sectionLabel = cleanText(section?.label, 160) || 'Section';
        chunkSectionText(section?.text, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP).forEach((chunk, chunkIndex) => {
          const block = {
            block_id: `${cleanText(paper.paper_id, 160)}::${sectionIndex + 1}-${chunkIndex + 1}`,
            paper_id: cleanText(paper.paper_id, 160),
            paper_title: cleanText(paper.paper_title, 320),
            section_label: sectionLabel,
            excerpt: cleanText(chunk, DEFAULT_CHUNK_SIZE + 120),
            relevance_reason: '',
            source: cleanText(paper.read_source, 80),
            evidence_kind: 'text',
            rank_score: scoreTextAgainstQuery(query, chunk, sectionLabel),
            pdf_urls: asArray(paper.pdf_urls)
          };
          sectionCandidates.push(attachRelatedCommentsToContextBlocks(
            [block],
            annotationContext,
            { asArray, cleanText }
          )[0]);
        });
      });
      sectionCandidates
        .sort((left, right) => {
          if (right.rank_score !== left.rank_score) {
            return right.rank_score - left.rank_score;
          }
          return left.block_id.localeCompare(right.block_id);
        })
        .slice(0, 3)
        .forEach((candidate) => candidates.push(candidate));
    });
    return candidates.sort((left, right) => {
      if (right.rank_score !== left.rank_score) {
        return right.rank_score - left.rank_score;
      }
      return left.block_id.localeCompare(right.block_id);
    });
  }

  async function extractPaperPdfText({ filePath, paperTitle }) {
    if (!pdfTextExtractionRuntime) {
      return null;
    }
    const normalizedPath = cleanText(filePath, 4000);
    if (!normalizedPath) {
      return null;
    }
    try {
      const result = await pdfTextExtractionRuntime.extractText({
        action: 'extract',
        file_path: normalizedPath,
        include_pages: false,
        include_sections: true
      });
      if (!result?.ok) {
        return null;
      }
      const text = cleanText(result.text, 0);
      const sections = asArray(result.sections);
      if (!text && !sections.length) {
        return null;
      }
      return {
        text,
        sections,
        sections_source: cleanText(result.sections_source, 40),
        page_count: Number(result.page_count) || 0,
        truncated: result.truncated === true,
        fileName: `${cleanText(paperTitle, 180).replace(/[^a-z0-9]+/gi, '_') || 'paper'}.pdf`,
        filePath: normalizedPath
      };
    } catch {
      return null;
    }
  }

  async function readLocalPdfAsDataUrl(filePath, paperTitle = '') {
    const normalizedPath = cleanText(filePath, 4000);
    if (!normalizedPath) {
      return null;
    }
    try {
      const buffer = await fsPromises.readFile(normalizedPath);
      if (!buffer.length) {
        return null;
      }
      if (buffer.subarray(0, 5).toString('utf8') !== '%PDF-') {
        return null;
      }
      return {
        pdfDataUrl: `data:application/pdf;base64,${buffer.toString('base64')}`,
        fileName: `${cleanText(paperTitle, 180).replace(/[^a-z0-9]+/gi, '_') || 'paper'}.pdf`,
        source: 'local_download'
      };
    } catch {
      return null;
    }
  }

  async function fetchPaperPdfDataUrl(paper = {}) {
    const urls = buildPaperPdfUrls(paper);
    for (const url of urls) {
      try {
        const buffer = await fetchBuffer(url, {
          headers: {
            Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1'
          }
        });
        if (!buffer.length) {
          continue;
        }
        if (buffer.subarray(0, 5).toString('utf8') !== '%PDF-') {
          continue;
        }
        return {
          pdfDataUrl: `data:application/pdf;base64,${buffer.toString('base64')}`,
          fileName: `${cleanText(paper.paper_title, 180).replace(/[^a-z0-9]+/gi, '_') || 'paper'}.pdf`,
          resolvedUrl: url
        };
      } catch {
        // Try the next URL.
      }
    }
    return null;
  }

  async function loadPaperContexts(input = {}) {
    const maxPapers = Math.max(1, Math.min(DEFAULT_MAX_PAPERS, Number(input.max_papers) || DEFAULT_MAX_PAPERS));
    const items = asArray(input.items).slice(0, maxPapers).map((item) => normalizePaperItem(item));
    const query = cleanText(input.query || input.message || input.topic, 1200);
    const papers = [];
    for (const item of items) {
      const paper = await readPaperContext(item);
      papers.push(paper);
    }
    let annotationContext = buildPaperAnnotationContext({
      snapshot: input.snapshot,
      selectedPapers: items,
      downloadedPapers: input.downloaded_papers
    }, { asArray, cleanText });
    const candidateBlocks = buildCandidateBlocks(papers, query, { annotationContext });
    const papersById = new Map(papers.map((paper) => [cleanText(paper.paper_id, 120), paper]));

    let downloadedPapers = asArray(input.downloaded_papers);
    if (input.download_promise && typeof input.download_promise.then === 'function') {
      try {
        const awaited = await input.download_promise;
        if (Array.isArray(awaited) && awaited.length) {
          downloadedPapers = awaited;
        }
      } catch {
        // Ignore — we'll proceed without attached PDFs.
      }
    }
    annotationContext = buildPaperAnnotationContext({
      snapshot: input.snapshot,
      selectedPapers: items,
      downloadedPapers
    }, { asArray, cleanText });
    papersById.forEach((paper, paperId) => {
      papersById.set(paperId, {
        ...paper,
        related_comments: normalizeRelatedComments(
          getRelatedCommentsForPaperId(paperId, annotationContext),
          { asArray, cleanText }
        )
      });
    });
    const paperPdfs = new Map();
    const paperPdfTexts = new Map();
    for (const entry of downloadedPapers) {
      if (!entry?.ok || !entry?.file_path) {
        continue;
      }
      const paperId = cleanText(entry.paper_id, 120);
      if (!paperId || !papersById.has(paperId) || paperPdfs.has(paperId)) {
        continue;
      }
      const paperTitle = papersById.get(paperId)?.paper_title || '';
      const pdfInput = await readLocalPdfAsDataUrl(entry.file_path, paperTitle);
      if (pdfInput) {
        paperPdfs.set(paperId, pdfInput);
      }
      if (pdfTextExtractionRuntime) {
        const textInput = await extractPaperPdfText({
          filePath: entry.file_path,
          paperTitle
        });
        if (textInput) {
          paperPdfTexts.set(paperId, textInput);
        }
      }
    }

    const selection = await selectContextBlocks({
      ...input,
      query,
      candidate_blocks: candidateBlocks,
      paper_pdfs: paperPdfs,
      paper_pdf_texts: paperPdfTexts,
      papers_by_id: papersById
    });
    const selectedBlocks = asArray(selection.selected_blocks);
    const figureReviewRequests = asArray(selection.figure_review_requests).length
      ? asArray(selection.figure_review_requests)
      : (
        messageLikelyNeedsFigureReview(query)
          ? selectedBlocks
            .filter((block) => asArray(papersById.get(cleanText(block?.paper_id, 120))?.pdf_urls).length > 0)
            .slice(0, DEFAULT_MAX_FIGURE_REVIEWS)
            .map((block) => ({
              paper_id: cleanText(block?.paper_id, 120),
              reason: 'The clarified request appears to depend on figure-level evidence.'
            }))
          : []
      );
    const figureBlocks = figureReviewRequests.length
      ? await reviewFigureEvidence({
        ...input,
        query,
        papers_by_id: papersById,
        paper_pdfs: paperPdfs,
        figure_review_requests: figureReviewRequests
      })
      : [];
    const loadedContextBlocks = normalizeLoadedContextBlocks(
      attachRelatedCommentsToContextBlocks(
        mergeFigureBlocks(selectedBlocks, figureBlocks),
        annotationContext,
        { asArray, cleanText }
      )
    );
    const readPaperIds = new Set(
      papers
        .filter((paper) => asArray(paper.sections).length > 0)
        .map((paper) => cleanText(paper.paper_id, 120))
        .filter(Boolean)
    );
    loadedContextBlocks.forEach((block) => {
      const blockSource = cleanText(block?.source, 80);
      if (
        blockSource === 'llm_pdf_read'
        || blockSource === 'llm_pdf_text_read'
        || blockSource === 'figure_review'
        || cleanText(block?.evidence_kind, 40) === 'figure_review'
      ) {
        const paperId = cleanText(block?.paper_id, 120);
        if (paperId) {
          readPaperIds.add(paperId);
        }
      }
    });
    const papersReadCount = readPaperIds.size;
    return {
      ok: true,
      status: 'completed',
      papers_read_count: papersReadCount,
      selected_context_block_count: loadedContextBlocks.length,
      figure_review_count: figureBlocks.length,
      papers: papers.map((paper) => ({
        paper_id: cleanText(paper.paper_id, 120),
        paper_title: cleanText(paper.paper_title, 320),
        read_source: cleanText(paper.read_source, 80),
        section_count: asArray(paper.sections).length
      })),
      loaded_context_blocks: loadedContextBlocks,
      summary: loadedContextBlocks.length
        ? `Read ${papersReadCount} paper(s) and loaded ${loadedContextBlocks.length} context block(s).`
        : (papers.length
          ? `Read ${papersReadCount} paper(s) but did not load any bounded context blocks.`
          : 'No paper context could be loaded from the literature results.')
    };
  }

  return {
    PAPER_CONTEXT_SOURCE_ORDER,
    PAPER_CONTEXT_SELECTION_SCHEMA,
    PAPER_FIGURE_REVIEW_SCHEMA,
    PAPER_PDF_EXCERPT_SELECTION_SCHEMA,
    PAPER_PDF_TEXT_EXCERPT_SELECTION_SCHEMA,
    chunkSectionText,
    parseEuropePmcFullTextSections,
    parsePubMedAbstractSections,
    fetchEuropePmcMetadataForItem,
    fetchEuropePmcFullTextByPmcid,
    fetchPubMedAbstractByPmid,
    fetchCrossrefAbstractByDoi,
    readPaperContext,
    buildCandidateBlocks,
    loadPaperContexts
  };
}

module.exports = {
  PAPER_CONTEXT_SOURCE_ORDER,
  PAPER_CONTEXT_SELECTION_SCHEMA,
  PAPER_FIGURE_REVIEW_SCHEMA,
  PAPER_PDF_EXCERPT_SELECTION_SCHEMA,
  PAPER_PDF_TEXT_EXCERPT_SELECTION_SCHEMA,
  splitMarkdownIntoSections,
  createPaperContextLoaderRuntime
};
