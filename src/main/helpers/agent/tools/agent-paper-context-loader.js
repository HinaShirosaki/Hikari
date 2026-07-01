'use strict';

const { Buffer } = require('node:buffer');
const fsPromises = require('node:fs/promises');

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');
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

const PDF_TEXT_SECTION_PROMPT_BUDGETS = Object.freeze({
  abstract: 3000,
  introduction: 4000,
  methods: 3000,
  results: 8000,
  discussion: 6000,
  conclusion: 3000,
  acknowledgments: 0,
  funding: 0,
  declarations: 0,
  references: 0,
  supplementary: 1500,
  appendix: 1500,
  author_contributions: 0,
  data_availability: 500,
  '': 2000
});

const DEFAULT_PDF_TEXT_PROMPT_TOTAL_BUDGET = 32000;
const DEFAULT_PDF_TEXT_PLAIN_PROMPT_BUDGET = 30000;

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

  function buildSelectionPrompt(input = {}) {
    const query = cleanText(input.query || input.message, 1200);
    const candidates = asArray(input.candidate_blocks).slice(0, 24);
    return [
      'Select the most relevant paper excerpts for the clarified request.',
      `Return up to ${DEFAULT_MAX_BLOCKS} selected blocks total and no more than ${DEFAULT_MAX_BLOCKS_PER_PAPER} blocks from the same paper.`,
      'Use only the provided block IDs. Do not rewrite excerpts.',
      'Request figure review only when the text evidence is still insufficient and the paper PDF is likely to add relevant figure-level evidence.',
      `Clarified request:\n${query}`,
      'Candidate blocks:',
      ...candidates.map((block) => [
        `Block ID: ${cleanText(block.block_id, 120)}`,
        `Paper ID: ${cleanText(block.paper_id, 120)}`,
        `Paper title: ${cleanText(block.paper_title, 220)}`,
        `Section: ${cleanText(block.section_label, 120)}`,
        `Source: ${cleanText(block.source, 80)}`,
        `Excerpt:\n${cleanText(block.excerpt, 1800)}`,
        asArray(block.related_comments).length
          ? `Related paper comments JSON:\n${JSON.stringify(asArray(block.related_comments).slice(0, 4), null, 2)}`
          : 'Related paper comments JSON: []'
      ].join('\n'))
    ].join('\n\n');
  }

  function buildPdfSelectionPrompt({ query, paper, paperCandidates }) {
    const anchorLines = asArray(paperCandidates).slice(0, 6).map((block) => [
      `- Section: ${cleanText(block.section_label, 120) || 'Section'}`,
      `  Excerpt anchor: ${cleanText(block.excerpt, 400)}`
    ].join('\n')).join('\n');
    const relatedComments = normalizeRelatedComments(paper?.related_comments || paper?.relatedComments, { asArray, cleanText });
    return [
      'You have the full paper PDF attached. Read it before answering.',
      `Select up to ${DEFAULT_MAX_BLOCKS_PER_PAPER_WITH_PDF} short excerpts from the PDF that most directly support the clarified request.`,
      'Prefer concrete results, numerical findings, mechanisms, and conclusions over background or generic statements.',
      'Quote excerpts verbatim from the PDF (keep each under ~1500 characters). Do not paraphrase.',
      'Each excerpt needs a section_label (e.g., "Results", "Discussion", "Figure 2 caption") and a specific relevance_reason.',
      `Clarified request:\n${cleanText(query, 1200)}`,
      `Paper title: ${cleanText(paper?.paper_title, 320)}`,
      relatedComments.length
        ? `Related paper comments JSON:\n${JSON.stringify(relatedComments, null, 2)}`
        : 'Related paper comments JSON: []',
      anchorLines
        ? `Existing abstract-derived excerpts (reference only — you may pick entirely different content from the PDF):\n${anchorLines}`
        : '',
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function selectPdfExcerptsForPaper({ paper, paperCandidates, pdfInput, input }) {
    const query = input.query || input.message;
    const result = await requestStructuredJsonPayload({
      stage: 'paper_context_selection_pdf',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildPdfSelectionPrompt({ query, paper, paperCandidates }),
      schema: PAPER_PDF_EXCERPT_SELECTION_SCHEMA,
      traceContext: input.traceContext || null,
      pdfDataUrl: pdfInput.pdfDataUrl,
      fileName: pdfInput.fileName,
      defaultError: 'Paper PDF context selection is not configured.'
    });
    if (!result?.ok || !result.payload) {
      return [];
    }
    const paperId = cleanText(paper?.paper_id, 120);
    return asArray(result.payload.excerpts)
      .slice(0, DEFAULT_MAX_BLOCKS_PER_PAPER_WITH_PDF)
      .map((entry, index) => ({
        block_id: `${paperId}::pdf-${index + 1}`,
        paper_id: paperId,
        paper_title: cleanText(paper?.paper_title, 320),
        section_label: cleanText(entry?.section_label, 160) || 'From PDF',
        excerpt: cleanText(entry?.excerpt, 1800),
        relevance_reason: cleanText(entry?.relevance_reason, 260)
          || `Excerpt drawn from the attached PDF of ${cleanText(paper?.paper_title, 160) || 'the paper'}.`,
        source: 'llm_pdf_read',
        evidence_kind: 'text'
      }))
      .filter((block) => block.paper_id && block.excerpt);
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

  function formatExtractedTextForPrompt(extractedText, totalBudget = DEFAULT_PDF_TEXT_PROMPT_TOTAL_BUDGET) {
    const sections = asArray(extractedText?.sections);
    if (!sections.length) {
      const plain = cleanText(extractedText?.text, 0);
      if (!plain) {
        return '';
      }
      const cap = Math.min(plain.length, DEFAULT_PDF_TEXT_PLAIN_PROMPT_BUDGET, totalBudget);
      const truncated = plain.length > cap ? `${plain.slice(0, cap)}\n[... truncated ...]` : plain;
      return `[full text]\n${truncated}`;
    }

    const formatted = [];
    let remaining = totalBudget;
    sections.forEach((section) => {
      if (remaining <= 0) {
        return;
      }
      const normalizedKind = cleanText(section?.normalized_label, 40);
      const budgetKey = Object.prototype.hasOwnProperty.call(PDF_TEXT_SECTION_PROMPT_BUDGETS, normalizedKind)
        ? normalizedKind
        : '';
      const sectionBudget = PDF_TEXT_SECTION_PROMPT_BUDGETS[budgetKey];
      if (!sectionBudget) {
        return;
      }
      const text = cleanText(section?.text, 0);
      if (!text) {
        return;
      }
      const cap = Math.min(text.length, sectionBudget, remaining);
      const slice = text.length > cap ? `${text.slice(0, cap)}\n[... truncated ...]` : text;
      const label = cleanText(section?.label, 160) || normalizedKind || 'Section';
      formatted.push(`[${label}${normalizedKind ? ` :: ${normalizedKind}` : ''}]\n${slice}`);
      remaining -= cap;
    });
    return formatted.join('\n\n');
  }

  function buildPdfTextSelectionPrompt({ query, paper, paperCandidates, extractedText }) {
    const sectionsText = formatExtractedTextForPrompt(extractedText);
    const anchorLines = asArray(paperCandidates).slice(0, 4).map((block) => [
      `- Section: ${cleanText(block.section_label, 120) || 'Section'}`,
      `  Excerpt anchor: ${cleanText(block.excerpt, 300)}`
    ].join('\n')).join('\n');
    const relatedComments = normalizeRelatedComments(paper?.related_comments || paper?.relatedComments, { asArray, cleanText });
    return [
      'You are reading the extracted text of a scientific paper. The PDF binary is NOT attached on this turn.',
      `Select up to ${DEFAULT_MAX_BLOCKS_PER_PAPER_WITH_PDF} short excerpts from the extracted text that most directly support the clarified request.`,
      'Quote excerpts verbatim from the extracted text. Each needs section_label (e.g., "Results", "Methods"), a verbatim excerpt, and a specific relevance_reason.',
      `Set request_pdf_review=true ONLY when the relevant evidence is figure-only (microscopy, gels, blots, plots, structures, schematics) AND nothing equivalent appears in the captured text. In that case, set excerpts=[] and put a one-sentence pdf_review_reason. Otherwise set request_pdf_review=false and pdf_review_reason="".`,
      `Clarified request:\n${cleanText(query, 1200)}`,
      `Paper title: ${cleanText(paper?.paper_title, 320)}`,
      relatedComments.length
        ? `Related paper comments JSON:\n${JSON.stringify(relatedComments, null, 2)}`
        : 'Related paper comments JSON: []',
      sectionsText
        ? `Extracted paper text (sections labeled; figures and images are NOT present):\n${sectionsText}`
        : '',
      anchorLines
        ? `Existing abstract-derived excerpts (reference only):\n${anchorLines}`
        : '',
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');
  }

  async function selectPdfTextExcerptsForPaper({ paper, paperCandidates, extractedText, input }) {
    const query = input.query || input.message;
    const result = await requestStructuredJsonPayload({
      stage: 'paper_context_selection_pdf_text',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildPdfTextSelectionPrompt({ query, paper, paperCandidates, extractedText }),
      schema: PAPER_PDF_TEXT_EXCERPT_SELECTION_SCHEMA,
      traceContext: input.traceContext || null,
      defaultError: 'Paper extracted-text context selection is not configured.'
    });
    if (!result?.ok || !result.payload) {
      return { excerpts: [], requestPdfReview: false, pdfReviewReason: '' };
    }
    const paperId = cleanText(paper?.paper_id, 120);
    const excerpts = asArray(result.payload.excerpts)
      .slice(0, DEFAULT_MAX_BLOCKS_PER_PAPER_WITH_PDF)
      .map((entry, index) => ({
        block_id: `${paperId}::pdf-text-${index + 1}`,
        paper_id: paperId,
        paper_title: cleanText(paper?.paper_title, 320),
        section_label: cleanText(entry?.section_label, 160) || 'From extracted text',
        excerpt: cleanText(entry?.excerpt, 1800),
        relevance_reason: cleanText(entry?.relevance_reason, 260)
          || `Excerpt drawn from the extracted text of ${cleanText(paper?.paper_title, 160) || 'the paper'}.`,
        source: 'llm_pdf_text_read',
        evidence_kind: 'text'
      }))
      .filter((block) => block.paper_id && block.excerpt);
    return {
      excerpts,
      requestPdfReview: result.payload.request_pdf_review === true,
      pdfReviewReason: cleanText(result.payload.pdf_review_reason, 260)
    };
  }

  async function selectContextBlocks(input = {}) {
    const candidateBlocks = asArray(input.candidate_blocks);
    const query = input.query || input.message;
    const fallback = buildFallbackSelection(candidateBlocks, query);
    if (typeof requestStructuredJsonPayload !== 'function') {
      return normalizeSelectionResult(fallback, candidateBlocks, query);
    }
    const paperPdfs = input.paper_pdfs instanceof Map ? input.paper_pdfs : new Map();
    const paperPdfTexts = input.paper_pdf_texts instanceof Map ? input.paper_pdf_texts : new Map();
    const papersById = input.papers_by_id instanceof Map ? input.papers_by_id : new Map();

    if (!candidateBlocks.length && !paperPdfs.size && !paperPdfTexts.size) {
      return normalizeSelectionResult(fallback, candidateBlocks, query);
    }

    if (!paperPdfs.size && !paperPdfTexts.size) {
      const result = await requestStructuredJsonPayload({
        stage: 'paper_context_selection',
        systemPrompt: 'Return valid JSON only.',
        userPrompt: buildSelectionPrompt(input),
        schema: PAPER_CONTEXT_SELECTION_SCHEMA,
        traceContext: input.traceContext || null,
        defaultError: 'Paper context selection is not configured.'
      });
      if (!result?.ok || !result.payload) {
        return normalizeSelectionResult(fallback, candidateBlocks, query);
      }
      return normalizeSelectionResult(result.payload, candidateBlocks, query);
    }

    const candidatesByPaper = new Map();
    candidateBlocks.forEach((block) => {
      const paperId = cleanText(block?.paper_id, 120);
      if (!paperId) {
        return;
      }
      if (!candidatesByPaper.has(paperId)) {
        candidatesByPaper.set(paperId, []);
      }
      candidatesByPaper.get(paperId).push(block);
    });
    paperPdfs.forEach((_pdfInput, paperId) => {
      const normalizedPaperId = cleanText(paperId, 120);
      if (normalizedPaperId && !candidatesByPaper.has(normalizedPaperId)) {
        candidatesByPaper.set(normalizedPaperId, []);
      }
    });
    paperPdfTexts.forEach((_textInput, paperId) => {
      const normalizedPaperId = cleanText(paperId, 120);
      if (normalizedPaperId && !candidatesByPaper.has(normalizedPaperId)) {
        candidatesByPaper.set(normalizedPaperId, []);
      }
    });

    const pdfSelectedBlocks = [];
    const pdfPaperIds = new Set();
    for (const [paperId, paperCandidates] of candidatesByPaper.entries()) {
      const pdfInput = paperPdfs.get(paperId);
      const textInput = paperPdfTexts.get(paperId);
      if (!pdfInput && !textInput) {
        continue;
      }
      const paper = papersById.get(paperId) || {
        paper_id: paperId,
        paper_title: cleanText(paperCandidates[0]?.paper_title, 320) || paperId
      };

      let textBlocks = [];
      let needsPdfReview = false;
      if (textInput) {
        const textResult = await selectPdfTextExcerptsForPaper({
          paper,
          paperCandidates,
          extractedText: textInput,
          input
        });
        textBlocks = textResult.excerpts;
        needsPdfReview = textResult.requestPdfReview;
      }

      const shouldRunPdfPath = pdfInput && (!textInput || needsPdfReview || !textBlocks.length);
      const pdfBlocks = shouldRunPdfPath
        ? await selectPdfExcerptsForPaper({ paper, paperCandidates, pdfInput, input })
        : [];

      const combined = pdfBlocks.length ? pdfBlocks : textBlocks;
      if (combined.length) {
        pdfPaperIds.add(paperId);
        pdfSelectedBlocks.push(...combined);
      }
    }

    const nonPdfCandidates = candidateBlocks.filter((block) => {
      const paperId = cleanText(block?.paper_id, 120);
      return !paperPdfs.has(paperId) && !paperPdfTexts.has(paperId);
    });
    let nonPdfSelection = { selected_blocks: [], figure_review_requests: [] };
    if (nonPdfCandidates.length) {
      const result = await requestStructuredJsonPayload({
        stage: 'paper_context_selection',
        systemPrompt: 'Return valid JSON only.',
        userPrompt: buildSelectionPrompt({ ...input, candidate_blocks: nonPdfCandidates }),
        schema: PAPER_CONTEXT_SELECTION_SCHEMA,
        traceContext: input.traceContext || null,
        defaultError: 'Paper context selection is not configured.'
      });
      if (result?.ok && result.payload) {
        nonPdfSelection = normalizeSelectionResult(result.payload, nonPdfCandidates, query);
      } else {
        nonPdfSelection = normalizeSelectionResult(
          buildFallbackSelection(nonPdfCandidates, query),
          nonPdfCandidates,
          query
        );
      }
    }

    const merged = mergeSelectedBlocksWithPdf(
      asArray(nonPdfSelection.selected_blocks),
      pdfSelectedBlocks,
      pdfPaperIds
    );
    return {
      selected_blocks: merged,
      figure_review_requests: asArray(nonPdfSelection.figure_review_requests)
    };
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

  async function reviewFigureEvidence(input = {}) {
    const papersById = input.papers_by_id instanceof Map ? input.papers_by_id : new Map();
    const paperPdfs = input.paper_pdfs instanceof Map ? input.paper_pdfs : new Map();
    const figureRequests = asArray(input.figure_review_requests).slice(0, DEFAULT_MAX_FIGURE_REVIEWS);
    const blocks = [];
    if (!figureRequests.length || typeof requestStructuredJsonPayload !== 'function') {
      return blocks;
    }
    for (const request of figureRequests) {
      const paperId = cleanText(request?.paper_id, 120);
      const paper = papersById.get(paperId);
      if (!paper) {
        continue;
      }
      const pdfInput = paperPdfs.get(paperId) || await fetchPaperPdfDataUrl(paper);
      if (!pdfInput) {
        continue;
      }
      const result = await requestStructuredJsonPayload({
        stage: 'paper_figure_review',
        systemPrompt: 'Return valid JSON only.',
        userPrompt: [
          'Review the paper PDF only for figure-level evidence relevant to the clarified request.',
          'If the figures do not materially improve the answer beyond the selected text evidence, set useful=false.',
          `Clarified request:\n${cleanText(input.query || input.message, 1200)}`,
          `Paper title: ${cleanText(paper.paper_title, 220)}`,
          `Why figure review was requested: ${cleanText(request?.reason, 260) || 'Potential figure-level evidence.'}`
        ].join('\n\n'),
        schema: PAPER_FIGURE_REVIEW_SCHEMA,
        traceContext: input.traceContext || null,
        pdfDataUrl: pdfInput.pdfDataUrl,
        fileName: pdfInput.fileName,
        defaultError: 'Paper figure review is not configured.'
      });
      if (!result?.ok || !result.payload || result.payload.useful !== true) {
        continue;
      }
      const figureSummary = cleanText(result.payload.figure_summary, 1400);
      if (!figureSummary) {
        continue;
      }
      blocks.push({
        block_id: `${paperId}::figure-review`,
        paper_id: paperId,
        paper_title: cleanText(paper.paper_title, 320),
        section_label: 'Figures',
        excerpt: figureSummary,
        relevance_reason: cleanText(result.payload.relevance_reason, 260) || cleanText(request?.reason, 260),
        source: 'figure_review',
        evidence_kind: 'figure_review',
        rank_score: 10000
      });
    }
    return blocks;
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
