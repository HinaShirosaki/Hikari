'use strict';

/**
 * LLM-orchestrated context selection for the paper context loader: prompt
 * builders + the structured-JSON calls that pick the most relevant excerpts
 * (abstract/candidate text, extracted PDF text, attached PDF binary) and review
 * figure evidence.
 *
 * Split out of agent-paper-context-loader.js as a factory bound to the same
 * injected LLM helper, deterministic selection algebra, PDF fetch helper,
 * schemas, and limits — so behavior is unchanged. The loader keeps candidate
 * building, fetching, and PDF extraction and calls selectContextBlocks /
 * reviewFigureEvidence from here.
 */

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

function createPaperContextLlm({
  requestStructuredJsonPayload,
  cleanText,
  asArray,
  normalizeRelatedComments,
  buildFallbackSelection,
  normalizeSelectionResult,
  mergeSelectedBlocksWithPdf,
  fetchPaperPdfDataUrl,
  maxBlocks,
  maxBlocksPerPaper,
  maxBlocksPerPaperWithPdf,
  maxFigureReviews,
  selectionSchema,
  pdfExcerptSchema,
  pdfTextSchema,
  figureReviewSchema
} = {}) {
  function buildSelectionPrompt(input = {}) {
    const query = cleanText(input.query || input.message, 1200);
    const candidates = asArray(input.candidate_blocks).slice(0, 24);
    return [
      'Select the most relevant paper excerpts for the clarified request.',
      `Return up to ${maxBlocks} selected blocks total and no more than ${maxBlocksPerPaper} blocks from the same paper.`,
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
      `Select up to ${maxBlocksPerPaperWithPdf} short excerpts from the PDF that most directly support the clarified request.`,
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
      schema: pdfExcerptSchema,
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
      .slice(0, maxBlocksPerPaperWithPdf)
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
      `Select up to ${maxBlocksPerPaperWithPdf} short excerpts from the extracted text that most directly support the clarified request.`,
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
      schema: pdfTextSchema,
      traceContext: input.traceContext || null,
      defaultError: 'Paper extracted-text context selection is not configured.'
    });
    if (!result?.ok || !result.payload) {
      return { excerpts: [], requestPdfReview: false, pdfReviewReason: '' };
    }
    const paperId = cleanText(paper?.paper_id, 120);
    const excerpts = asArray(result.payload.excerpts)
      .slice(0, maxBlocksPerPaperWithPdf)
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
        schema: selectionSchema,
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
        schema: selectionSchema,
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

  async function reviewFigureEvidence(input = {}) {
    const papersById = input.papers_by_id instanceof Map ? input.papers_by_id : new Map();
    const paperPdfs = input.paper_pdfs instanceof Map ? input.paper_pdfs : new Map();
    const figureRequests = asArray(input.figure_review_requests).slice(0, maxFigureReviews);
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
        schema: figureReviewSchema,
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

  return {
    selectContextBlocks,
    reviewFigureEvidence
  };
}

module.exports = {
  createPaperContextLlm
};
