'use strict';

const { cloneJson, ensureObject } = require('../../../lib/normalize.js');
const {
  buildKnowledgeDatabasePaths,
  buildLegacyKnowledgeDatabasePaths,
  getPaperScope,
  resolveRelativeStoragePath,
  resolveStoragePath
} = require('../paper-knowledge-paths.js');
const {
  chooseLocation,
  findExistingPaperRow,
  openKnowledgeDatabase,
  pathExists,
  queryRows
} = require('../paper-knowledge-store.js');

// Read path: find a stored paper by identity and resolve its on-disk parts.
function createPaperLookup({
  cleanText
} = {}) {
  async function lookupPaper(input = {}) {
    const source = ensureObject(input);
    const storagePath = resolveStoragePath(source, cleanText);
    if (!storagePath) {
      return {
        ok: false,
        status: 'error',
        error: 'Paper knowledge lookup requires storage_path.'
      };
    }
    const lookupIdentity = {
      storagePath,
      doi: source.doi || source.paper_doi || source.paperDoi,
      title: source.title || source.paper_title || source.paperTitle
    };
    const pathCandidates = [
      buildKnowledgeDatabasePaths(lookupIdentity),
      buildLegacyKnowledgeDatabasePaths(lookupIdentity)
    ];
    let indexAvailable = false;

    for (let index = 0; index < pathCandidates.length; index += 1) {
      const paths = pathCandidates[index];
      if (index > 0 && !(await pathExists(paths.sqlite_path))) {
        continue;
      }
      const db = await openKnowledgeDatabase(paths.sqlite_path).catch(() => null);
      if (!db) {
        continue;
      }
      indexAvailable = true;
      const paper = findExistingPaperRow(db, {
        doi: source.doi || source.paper_doi || source.paperDoi,
        pmid: source.pmid || source.paper_pmid || source.paperPmid,
        pmcid: source.pmcid || source.paper_pmcid || source.paperPmcid,
        title: source.title || source.paper_title || source.paperTitle
      });
      if (!paper) {
        db.close();
        continue;
      }
      let locations = [];
      try {
        locations = queryRows(db, 'SELECT * FROM paper_locations WHERE paper_id = ?', [paper.id]);
      } finally {
        db.close();
      }
      const selectedLocation = chooseLocation(
        locations,
        getPaperScope(source.linked_type || source.linkedType),
        cleanText(source.linked_name || source.linkedName, 220)
      );
      const markdownPath = paper.wiki_path ? resolveRelativeStoragePath(storagePath, paper.wiki_path) : '';
      const pdfPath = selectedLocation?.pdf_path
        ? resolveRelativeStoragePath(storagePath, selectedLocation.pdf_path)
        : '';
      const pdfExists = pdfPath
        ? await pathExists(pdfPath)
        : false;
      const markdownExists = markdownPath
        ? await pathExists(markdownPath)
        : false;
      return {
        ok: true,
        status: 'found',
        paper: {
          id: cleanText(paper.id, 180),
          doi: cleanText(paper.doi, 180),
          pmid: cleanText(paper.pmid, 120),
          pmcid: cleanText(paper.pmcid, 120),
          title: cleanText(paper.title, 320),
          wiki_status: cleanText(paper.wiki_status, 80),
          wiki_path: cleanText(paper.wiki_path, 2000),
          wiki_file_path: markdownPath,
          wiki_exists: markdownExists,
          pdf_sha256: cleanText(paper.pdf_sha256, 120),
          pdf_path: cleanText(selectedLocation?.pdf_path, 2000),
          pdf_file_path: pdfPath,
          pdf_exists: pdfExists,
          location: cloneJson(selectedLocation || {}, null)
        },
        summary: markdownExists
          ? `Found paper knowledge markdown at ${paper.wiki_path}.`
          : 'Found paper record, but the markdown file is missing.'
      };
    }
    if (!indexAvailable) {
      return {
        ok: false,
        status: 'missing',
        error: 'Paper knowledge index is not available.'
      };
    }
    return {
      ok: false,
      status: 'missing',
      summary: 'Paper was not found in the knowledge database.'
    };
  }

  return {
    lookupPaper
  };
}

module.exports = { createPaperLookup };
