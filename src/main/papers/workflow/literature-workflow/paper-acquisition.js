'use strict';

const { cloneJson } = require('../../shared/paper-comment-context.js');
const {
  DEFAULT_DOWNLOAD_CONCURRENCY,
  buildDoiUrl,
  chunkArray,
  defaultEnsureObject
} = require('./helpers.js');

// Everything between "we picked these papers" and "their text is on disk":
// identity assignment, metadata enrichment, download, and local-KB partition.
function createPaperAcquisition({
  asArray,
  cleanText,
  uniqueStrings,
  paperContextLoaderRuntime,
  paperDownloadRuntime,
  paperKnowledgeDatabaseRuntime
} = {}) {
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
      ...asArray(metadata.pdf_urls)
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
      linked_type: cleanText(input.linked_type, 80) || 'literature-search',
      // Raw name on purpose: the download runtime owns folder sanitizing, and
      // the knowledge database stores this string as the searchable container.
      linked_name: linkedName || cleanText(input.topic, 240) || cleanText(input.query, 220) || 'Literature Search',
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

  return {
    assignCanonicalPaperIds,
    enrichPaperForDownload,
    downloadSelectedPaper,
    downloadSelectedPapers,
    partitionByLocalKnowledge
  };
}

module.exports = { createPaperAcquisition };
