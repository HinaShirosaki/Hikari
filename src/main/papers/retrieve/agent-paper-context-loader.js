'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../lib/llm/runtime-helpers.js');
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
  splitMarkdownIntoSections,
  createPaperContextText
} = require('./paper-context-text.js');
const { createPaperContextSelection } = require('./paper-context-selection.js');
const { createPaperContextLlm } = require('./paper-context-llm.js');
const {
  PAPER_CONTEXT_SOURCE_ORDER,
  DEFAULT_MAX_PAPERS,
  DEFAULT_MAX_BLOCKS,
  DEFAULT_MAX_BLOCKS_PER_PAPER,
  DEFAULT_MAX_BLOCKS_PER_PAPER_WITH_PDF,
  DEFAULT_MAX_FIGURE_REVIEWS,
  PAPER_CONTEXT_SELECTION_SCHEMA,
  PAPER_FIGURE_REVIEW_SCHEMA,
  PAPER_PDF_EXCERPT_SELECTION_SCHEMA,
  PAPER_PDF_TEXT_EXCERPT_SELECTION_SCHEMA
} = require('./paper-context/schemas.js');
const { createPaperContextSourceFetchers } = require('./paper-context/source-fetchers.js');
const { createPaperPdfAssets } = require('./paper-context/pdf-assets.js');

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

  const {
    fetchBuffer,
    normalizePaperItem,
    readLocalMarkdownSections,
    fetchEuropePmcMetadataForItem,
    fetchEuropePmcFullTextByPmcid,
    fetchPubMedAbstractByPmid,
    fetchCrossrefAbstractByDoi
  } = createPaperContextSourceFetchers({
    fetchImpl,
    cleanText,
    asArray,
    uniqueStrings,
    parseEuropePmcFullTextSections,
    parsePubMedAbstractSections,
    parseEuropePmcMetadata
  });

  const {
    extractPaperPdfText,
    readLocalPdfAsDataUrl,
    fetchPaperPdfDataUrl
  } = createPaperPdfAssets({
    cleanText,
    asArray,
    fetchBuffer,
    buildPaperPdfUrls,
    pdfTextExtractionRuntime
  });

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
