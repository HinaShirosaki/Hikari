'use strict';

const { normalizeRelatedComments } = require('../../shared/paper-comment-context.js');
const { SEARCH_BATCH_SIZE, chunkArray } = require('./helpers.js');

function createPaperReading({ asArray, cleanText, paperContextLoaderRuntime } = {}) {
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
        downloaded_papers: asArray(input.downloaded_papers),
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

  return { readSelectedPapers };
}

module.exports = { createPaperReading };
