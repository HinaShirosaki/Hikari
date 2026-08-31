'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { normalizePmcid, normalizePmid } = require('../../identity/paper-identity.js');
const { createIntakePipeline } = require('../intake/intake-pipeline.js');
const { ensureObject } = require('../../../lib/normalize.js');
const {
  extractDoiFromText,
  isLikelyJunkPdfTitle,
  normalizeDoi,
  normalizeYear
} = require('../paper-knowledge-paths.js');
const { guessTitleFromText, isExplicitFalse } = require('./helpers.js');

// Runs the intake pipeline for a freshly stored paper, settles its figure
// directory, and normalizes the metadata the index rows are built from.
function createPaperIntakeSteps({
  asArray,
  cleanText,
  injectedPaperIntakePipeline,
  deps
} = {}) {
  async function runPaperIntake({ source = {}, storagePath = '', paperFolderName = '', metadata = {} } = {}) {
    if (!paperFolderName || isExplicitFalse(source.paper_intake) || isExplicitFalse(source.paperIntake)) {
      return null;
    }
    const pipeline = injectedPaperIntakePipeline || createIntakePipeline({
      ...deps,
      workspacePath: storagePath,
      fs: fsPromises
    });
    if (!pipeline || typeof pipeline.runIntakeForPaper !== 'function') {
      return {
        ok: false,
        status: 'executor_unavailable',
        error: 'Paper intake pipeline is unavailable.'
      };
    }
    return pipeline.runIntakeForPaper({
      paperId: paperFolderName,
      title: metadata.title,
      doi: metadata.doi,
      traceContext: source.traceContext || null
    }).catch((error) => ({
      ok: false,
      status: 'failed',
      error: cleanText(error?.message || error, 1200) || 'Paper intake pipeline failed.'
    }));
  }

  async function reconcileFiguresDir({ provisionalDir, canonicalDir, paperFolderPath, figures } = {}) {
    const descriptors = Array.isArray(figures) ? figures : [];
    if (!descriptors.length || !canonicalDir) {
      return descriptors.map((figure) => ({ ...figure }));
    }
    let activeDir = canonicalDir;
    if (provisionalDir && provisionalDir !== canonicalDir) {
      try {
        await fsPromises.mkdir(paperFolderPath, { recursive: true });
        try {
          await fsPromises.rm(canonicalDir, { recursive: true, force: true });
        } catch {
          // ignore — target may not exist
        }
        await fsPromises.rename(provisionalDir, canonicalDir);
      } catch {
        // If rename fails, keep figures where they landed.
        activeDir = provisionalDir;
      }
    }
    return descriptors.map((figure) => {
      const fileName = figure?.file_name || '';
      return {
        ...figure,
        file_path: fileName ? path.join(activeDir, fileName) : (figure?.file_path || '')
      };
    });
  }

  function normalizeMetadata(input = {}, extraction = {}, pdfSha256 = '') {
    const source = ensureObject(input);
    const embeddedMetadata = ensureObject(extraction.embedded_metadata || extraction.embeddedMetadata);
    const extractedText = String(extraction.text || '');
    const doi = normalizeDoi(
      source.doi
      || source.paper_doi
      || source.paperDoi
      || extractDoiFromText(extractedText)
    );
    const authors = asArray(source.authors || source.paper_authors || source.paperAuthors)
      .map((author) => cleanText(typeof author === 'string' ? author : (author?.name || author?.family || ''), 240))
      .filter(Boolean)
      .slice(0, 80);
    const embeddedTitle = isLikelyJunkPdfTitle(embeddedMetadata.title) ? '' : embeddedMetadata.title;
    const title = cleanText(
      embeddedTitle
      || source.title
      || source.paper_title
      || source.paperTitle
      || source.file_name
      || guessTitleFromText(extractedText),
      320
    );
    return {
      doi,
      pmid: normalizePmid(source.pmid || source.paper_pmid || source.paperPmid),
      pmcid: normalizePmcid(source.pmcid || source.paper_pmcid || source.paperPmcid),
      title,
      abstract: cleanText(source.abstract || source.paper_abstract || source.paperAbstract, 12000),
      authors,
      journal: cleanText(source.journal || source.paper_journal || source.paperJournal, 320),
      year: normalizeYear(source.year || source.published_at || source.publishedAt || source.date),
      url: cleanText(source.url || source.page_url || source.pageUrl || source.paper_url || source.paperUrl, 2000),
      pdf_sha256: pdfSha256,
      source: cleanText(source.source, 80) || 'agent',
      notes: cleanText(source.notes, 4000)
    };
  }

  return {
    runPaperIntake,
    reconcileFiguresDir,
    normalizeMetadata
  };
}

module.exports = { createPaperIntakeSteps };
