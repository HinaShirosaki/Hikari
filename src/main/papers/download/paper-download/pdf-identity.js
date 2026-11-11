'use strict';

const { normalizeDoi, titleKey } = require('../../identity/paper-identity.js');
const { createPdfTextExtractionRuntime } = require('../../parse/agent-pdf-text-extraction.js');

const extractor = createPdfTextExtractionRuntime();
const MIN_READABLE_CHARS = 200;
const MIN_TITLE_PAIR_RATIO = 0.5;
const normalizedKey = (value) => titleKey(String(value || '').normalize('NFKC'));

// Word pairs tolerate a few differing words or symbols, while a paper on the
// same topic that only shares vocabulary does not repeat the title's phrasing.
function titleAppears(title, text) {
  const words = title.split(' ');
  if (words.length < 3) return ` ${text} `.includes(` ${title} `);
  const pairs = words.slice(1).map((word, index) => `${words[index]} ${word}`);
  return pairs.filter((pair) => text.includes(pair)).length / pairs.length >= MIN_TITLE_PAIR_RATIO;
}

// An automatic click can land on another paper's PDF, and a valid header says
// nothing about which paper it is. One page keeps the printed DOI footer, which
// running-footer cleanup removes from longer reads.
// ponytail: scanned PDFs have no text to compare, so they pass. Add OCR if wrong
// scans are ever saved.
async function pdfNamesRequestedPaper(filePath, source = {}) {
  const doi = normalizeDoi(source.doi || source.paper_doi || source.paperDoi);
  const title = normalizedKey(source.paper_title || source.paperTitle || source.title);
  if (!doi && !title) return true;
  const parsed = await extractor.extractText({ file_path: filePath, max_pages: 1, include_sections: false })
    .catch(() => null);
  const pageText = String(parsed?.text || '');
  if (!parsed?.ok || pageText.trim().length < MIN_READABLE_CHARS) return true;
  if (doi && pageText.toLowerCase().replace(/[\s​­]/g, '').includes(doi)) return true;
  return Boolean(title) && titleAppears(title, normalizedKey(`${parsed.embedded_metadata?.title || ''} ${pageText}`));
}

module.exports = { pdfNamesRequestedPaper };
