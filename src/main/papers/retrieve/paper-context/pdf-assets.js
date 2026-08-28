'use strict';

const fsPromises = require('node:fs/promises');

// Paper PDFs reach the LLM either as extracted text or as a data URL; both
// paths share the same local-file / remote-fetch resolution.
function createPaperPdfAssets({
  cleanText,
  asArray,
  fetchBuffer,
  buildPaperPdfUrls,
  pdfTextExtractionRuntime
} = {}) {
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

  return {
    extractPaperPdfText,
    readLocalPdfAsDataUrl,
    fetchPaperPdfDataUrl
  };
}

module.exports = { createPaperPdfAssets };
