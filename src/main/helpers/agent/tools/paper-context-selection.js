'use strict';

/**
 * Deterministic context-block selection/merge helpers for the paper context
 * loader — the offline "block algebra" that runs with or without the LLM:
 * fallback selection, LLM-result normalization (with per-paper caps), merging
 * PDF-derived and figure-review blocks, and final block normalization.
 *
 * Split out of agent-paper-context-loader.js as a factory bound to the same
 * runtime helpers + limits the loader already used, so behavior is unchanged.
 * The LLM/prompt-building and fetch code stays in the loader and calls these.
 */

function createPaperContextSelection({
  cleanText,
  asArray,
  ensureObject,
  normalizeRelatedComments,
  maxBlocks,
  maxBlocksPerPaper,
  maxBlocksPerPaperWithPdf,
  maxFigureReviews
} = {}) {
  function messageLikelyNeedsFigureReview(value) {
    return /\b(figure|fig\.|image|images|microscopy|blot|band|gel|stain|structure|localization|plot|plots|spectrum)\b/i
      .test(String(value || ''));
  }

  function buildFallbackSelection(candidateBlocks = [], query = '') {
    const selected = [];
    const perPaperCounts = new Map();
    asArray(candidateBlocks)
      .slice()
      .sort((left, right) => {
        if (right.rank_score !== left.rank_score) {
          return right.rank_score - left.rank_score;
        }
        return left.block_id.localeCompare(right.block_id);
      })
      .forEach((block) => {
        if (selected.length >= maxBlocks) {
          return;
        }
        const paperId = cleanText(block.paper_id, 120);
        const count = perPaperCounts.get(paperId) || 0;
        if (count >= maxBlocksPerPaper) {
          return;
        }
        perPaperCounts.set(paperId, count + 1);
        selected.push({
          block_id: cleanText(block.block_id, 120),
          relevance_reason: cleanText(
            `Selected because it matches the clarified request about ${cleanText(query, 180) || 'the paper topic'}.`,
            240
          )
        });
      });
    return {
      selected_blocks: selected,
      figure_review_requests: []
    };
  }

  function normalizeSelectionResult(rawPayload, candidateBlocks = [], query = '') {
    const source = ensureObject(rawPayload);
    const candidateMap = new Map(
      asArray(candidateBlocks).map((block) => [cleanText(block.block_id, 120), block])
    );
    const selected = [];
    const seenBlocks = new Set();
    const perPaperCounts = new Map();
    asArray(source.selected_blocks).forEach((entry) => {
      const blockId = cleanText(entry?.block_id, 120);
      const block = candidateMap.get(blockId);
      if (!block || seenBlocks.has(blockId) || selected.length >= maxBlocks) {
        return;
      }
      const paperId = cleanText(block.paper_id, 120);
      const count = perPaperCounts.get(paperId) || 0;
      if (count >= maxBlocksPerPaper) {
        return;
      }
      seenBlocks.add(blockId);
      perPaperCounts.set(paperId, count + 1);
      selected.push({
        ...block,
        relevance_reason: cleanText(entry?.relevance_reason, 260)
          || cleanText(`Selected because it directly supports the clarified request about ${cleanText(query, 180) || 'the topic'}.`, 260)
      });
    });
    const reviewedPaperIds = new Set(selected.map((block) => cleanText(block.paper_id, 120)));
    const figureReviewRequests = asArray(source.figure_review_requests)
      .map((entry) => ({
        paper_id: cleanText(entry?.paper_id, 120),
        reason: cleanText(entry?.reason, 260)
      }))
      .filter((entry) => entry.paper_id && reviewedPaperIds.has(entry.paper_id))
      .slice(0, maxFigureReviews);
    return {
      selected_blocks: selected,
      figure_review_requests: figureReviewRequests
    };
  }

  function mergeSelectedBlocksWithPdf(nonPdfBlocks, pdfBlocks, pdfPaperIds) {
    const merged = [];
    const seenBlockIds = new Set();
    const perPaperCounts = new Map();
    const pushBlock = (block) => {
      if (!block) {
        return;
      }
      if (merged.length >= maxBlocks) {
        return;
      }
      const blockId = cleanText(block.block_id, 160);
      if (blockId && seenBlockIds.has(blockId)) {
        return;
      }
      const paperId = cleanText(block.paper_id, 120);
      const cap = pdfPaperIds.has(paperId)
        ? maxBlocksPerPaperWithPdf
        : maxBlocksPerPaper;
      const count = perPaperCounts.get(paperId) || 0;
      if (count >= cap) {
        return;
      }
      perPaperCounts.set(paperId, count + 1);
      if (blockId) {
        seenBlockIds.add(blockId);
      }
      merged.push(block);
    };
    asArray(pdfBlocks).forEach(pushBlock);
    asArray(nonPdfBlocks).forEach(pushBlock);
    return merged;
  }

  function mergeFigureBlocks(selectedBlocks = [], figureBlocks = []) {
    const merged = asArray(selectedBlocks).slice(0, maxBlocks);
    asArray(figureBlocks).forEach((figureBlock) => {
      if (!figureBlock?.paper_id || !figureBlock?.excerpt) {
        return;
      }
      const samePaperIndexes = merged
        .map((block, index) => ({ block, index }))
        .filter((entry) => cleanText(entry.block?.paper_id, 120) === cleanText(figureBlock.paper_id, 120));
      if (samePaperIndexes.length >= maxBlocksPerPaper) {
        const replaceTarget = samePaperIndexes
          .filter((entry) => cleanText(entry.block?.evidence_kind, 40) !== 'figure_review')
          .sort((left, right) => Number(left.block?.rank_score || 0) - Number(right.block?.rank_score || 0))[0];
        if (!replaceTarget) {
          return;
        }
        merged.splice(replaceTarget.index, 1, figureBlock);
        return;
      }
      if (merged.length < maxBlocks) {
        merged.push(figureBlock);
        return;
      }
      const replaceIndex = merged
        .map((block, index) => ({ block, index }))
        .filter((entry) => cleanText(entry.block?.evidence_kind, 40) !== 'figure_review')
        .sort((left, right) => Number(left.block?.rank_score || 0) - Number(right.block?.rank_score || 0))[0]?.index;
      if (Number.isInteger(replaceIndex)) {
        merged.splice(replaceIndex, 1, figureBlock);
      }
    });
    return merged.slice(0, maxBlocks);
  }

  function normalizeLoadedContextBlocks(blocks = []) {
    return asArray(blocks)
      .slice(0, maxBlocks)
      .map((block) => ({
        paper_id: cleanText(block?.paper_id, 120),
        paper_title: cleanText(block?.paper_title, 320),
        section_label: cleanText(block?.section_label, 160) || 'Excerpt',
        excerpt: cleanText(block?.excerpt, 1800),
        relevance_reason: cleanText(block?.relevance_reason, 260),
        source: cleanText(block?.source, 80),
        evidence_kind: cleanText(block?.evidence_kind, 40) || 'text',
        related_comments: normalizeRelatedComments(block?.related_comments || block?.relatedComments, { asArray, cleanText })
      }))
      .filter((block) => block.paper_id && block.excerpt);
  }

  return {
    messageLikelyNeedsFigureReview,
    buildFallbackSelection,
    normalizeSelectionResult,
    mergeSelectedBlocksWithPdf,
    mergeFigureBlocks,
    normalizeLoadedContextBlocks
  };
}

module.exports = {
  createPaperContextSelection
};
