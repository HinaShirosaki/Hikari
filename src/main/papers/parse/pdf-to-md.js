'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { isMarkdownTableLine } = require('./pdf-text-layout.js');

const PDF_TO_MD_FORMAT = 'hikari-pdf-to-md-v1';
const DEFAULT_MAX_SECTION_CHARS = 0;
const DEFAULT_MAX_PAGE_CHARS = 0;

function cleanText(value, maxLength = 4000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const numericMax = Number(maxLength);
  if (!Number.isFinite(numericMax) || numericMax <= 0) {
    return text;
  }
  return text.length > numericMax ? text.slice(0, numericMax) : text;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeDoi(value) {
  return String(value || '')
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/\s+/g, '');
}

function normalizeYear(value) {
  const direct = String(value || '').trim();
  if (/^\d{4}$/.test(direct)) {
    return direct;
  }
  const match = direct.match(/\b(19|20)\d{2}\b/);
  return match?.[0] || '';
}

function extractDoiFromText(value) {
  const match = String(value || '').match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return normalizeDoi(match?.[0] ? match[0].replace(/[),.;\]]+$/g, '') : '');
}

function guessTitleFromText(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.length >= 6 && line.length <= 220)
    .find((line) => !/^doi\b/i.test(line)) || '';
}

function normalizeMarkdownHeading(value, fallback = 'Untitled paper') {
  return cleanText(value, 240)
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
}

function normalizeAuthors(value) {
  return asArray(value)
    .map((author) => {
      if (typeof author === 'string') {
        return cleanText(author, 240);
      }
      const source = ensureObject(author);
      return cleanText(source.name || source.fullName || source.family || source.given, 240);
    })
    .filter(Boolean)
    .slice(0, 80);
}

function normalizePdfMarkdownMetadata(input = {}, extraction = {}, extractedText = '') {
  const source = ensureObject(input);
  const extractionText = String(extractedText || extraction.text || '');
  const title = cleanText(
    source.title
      || source.paper_title
      || source.paperTitle
      || source.file_name
      || source.fileName
      || guessTitleFromText(extractionText),
    320
  );
  return {
    title,
    authors: normalizeAuthors(source.authors || source.paper_authors || source.paperAuthors),
    doi: normalizeDoi(source.doi || source.paper_doi || source.paperDoi || extractDoiFromText(extractionText)),
    journal: cleanText(source.journal || source.paper_journal || source.paperJournal, 320),
    year: normalizeYear(source.year || source.published_at || source.publishedAt || source.date),
    url: cleanText(source.url || source.page_url || source.pageUrl || source.paper_url || source.paperUrl, 2000),
    source_pdf_path: cleanText(source.source_pdf_path || source.sourcePdfPath, 2400),
    source_pdf_relative_path: cleanText(source.source_pdf_relative_path || source.sourcePdfRelativePath, 2400)
  };
}

function limitBlock(value, maxChars) {
  const text = String(value || '').trim();
  const numericMax = Number(maxChars);
  if (!text || !Number.isFinite(numericMax) || numericMax <= 0 || text.length <= numericMax) {
    return text;
  }
  return `${text.slice(0, numericMax).trim()}\n\n[... truncated ...]`;
}

function normalizeBodyLine(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isReferenceStart(line) {
  return /^\(?\d{1,4}\)?[.)]\s+/.test(line);
}

function isCaptionStart(line) {
  return /^(?:extended\s+data\s+)?(?:fig(?:ure)?|table)\.?\s+\d+/i.test(line);
}

function shouldBreakBeforeLine(line, currentParagraph) {
  if (!currentParagraph) {
    return false;
  }
  return isReferenceStart(line) || isCaptionStart(line) || /^\[\[page:\d+\]\]$/i.test(line);
}

function shouldBreakAfterLine(line, currentParagraph) {
  if (currentParagraph.length < 900) {
    return false;
  }
  return /[.!?)](?:\s*\d+)?$/.test(line);
}

function appendBodyLine(paragraph, line) {
  if (!paragraph) {
    return line;
  }
  if (/[A-Za-z]-$/.test(paragraph) && /^[a-z]/.test(line)) {
    return `${paragraph.slice(0, -1)}${line}`;
  }
  return `${paragraph} ${line}`;
}

function formatMarkdownBodyText(value = '') {
  const lines = String(value || '').split(/\r?\n/);
  const paragraphs = [];
  let current = '';
  let tableBuffer = [];

  const flushParagraph = () => {
    const text = current.trim();
    if (text) {
      paragraphs.push(text);
    }
    current = '';
  };

  const flushTable = () => {
    if (tableBuffer.length) {
      paragraphs.push(tableBuffer.join('\n'));
      tableBuffer = [];
    }
  };

  lines.forEach((rawLine) => {
    if (isMarkdownTableLine(rawLine)) {
      flushParagraph();
      tableBuffer.push(rawLine.trim());
      return;
    }
    if (tableBuffer.length) {
      flushTable();
    }
    const line = normalizeBodyLine(rawLine);
    if (!line) {
      flushParagraph();
      return;
    }
    if (shouldBreakBeforeLine(line, current)) {
      flushParagraph();
    }
    current = appendBodyLine(current, line);
    if (shouldBreakAfterLine(line, current)) {
      flushParagraph();
    }
  });
  flushParagraph();
  flushTable();
  return paragraphs.join('\n\n');
}

function formatPageRange(section = {}) {
  const startPage = Number(section.start_page) || Number(section.page_number) || 0;
  const endPage = Number(section.end_page) || startPage;
  if (!startPage) {
    return 'page unknown';
  }
  if (endPage && endPage !== startPage) {
    return `pp. ${startPage}-${endPage}`;
  }
  return `p. ${startPage}`;
}

function buildExtractedTextFile(extraction = {}) {
  const pages = asArray(extraction.pages);
  if (pages.length) {
    return pages.map((page) => [
      `[[page:${Number(page.page_number) || 0}]]`,
      String(page.text || '').trim()
    ].filter(Boolean).join('\n')).join('\n\n');
  }
  return String(extraction.text || '').trim();
}

function normalizeFigureEntry(figure, figuresRelativeDir = 'figures') {
  const source = ensureObject(figure);
  const fileName = cleanText(source.file_name || source.fileName, 320);
  if (!fileName) {
    return null;
  }
  const relative = cleanText(source.relative_path || source.relativePath, 1200)
    || `${figuresRelativeDir}/${fileName}`;
  const pageNumber = Number(source.page_number || source.pageNumber) || 0;
  const width = Number(source.width) || 0;
  const height = Number(source.height) || 0;
  return { fileName, relative, pageNumber, width, height };
}

function figureMarkdownLine(entry) {
  const dimensions = entry.width && entry.height ? ` (${entry.width}×${entry.height} px)` : '';
  const label = entry.pageNumber ? `Figure on page ${entry.pageNumber}${dimensions}` : `Figure${dimensions}`;
  return `![${label}](${entry.relative})`;
}

// Claim each unused figure whose page falls in [startPage, endPage], so it is
// rendered inline once next to the section/page text that references it.
function takeFiguresForRange(figureState, startPage, endPage) {
  if (!figureState || !startPage) {
    return '';
  }
  const matched = [];
  figureState.entries.forEach((entry) => {
    if (figureState.used.has(entry) || !entry.pageNumber) {
      return;
    }
    if (entry.pageNumber >= startPage && entry.pageNumber <= (endPage || startPage)) {
      figureState.used.add(entry);
      matched.push(entry);
    }
  });
  return matched.map(figureMarkdownLine).join('\n\n');
}

function buildSectionMarkdown(sections = [], maxSectionChars = DEFAULT_MAX_SECTION_CHARS, figureState = null) {
  const rows = asArray(sections)
    .map((section) => {
      const text = limitBlock(section?.text, maxSectionChars);
      if (!text) {
        return '';
      }
      const label = normalizeMarkdownHeading(section?.label || section?.normalized_label || 'Section', 'Section');
      const body = formatMarkdownBodyText(text);
      const startPage = Number(section?.start_page) || Number(section?.page_number) || 0;
      const endPage = Number(section?.end_page) || startPage;
      const figures = takeFiguresForRange(figureState, startPage, endPage);
      return [
        `### ${label} (${formatPageRange(section)})`,
        '',
        body,
        ...(figures ? ['', figures] : [])
      ].join('\n');
    })
    .filter(Boolean);
  return rows.join('\n\n');
}

function buildPageMarkdown(pages = [], maxPageChars = DEFAULT_MAX_PAGE_CHARS, figureState = null) {
  return asArray(pages)
    .map((page) => {
      const pageNumber = Number(page?.page_number) || 0;
      const text = limitBlock(page?.text, maxPageChars);
      if (!pageNumber || !text) {
        return '';
      }
      const body = formatMarkdownBodyText(text);
      const figures = takeFiguresForRange(figureState, pageNumber, pageNumber);
      return [
        `### Page ${pageNumber}`,
        '',
        body,
        ...(figures ? ['', figures] : [])
      ].join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

function buildMetadataLines(metadata = {}, extraction = {}) {
  const lines = [
    `- Format: ${PDF_TO_MD_FORMAT}`,
    `- Page count: ${Number(extraction.page_count) || 0}`,
    `- Extracted pages: ${Number(extraction.extracted_page_count) || 0}`
  ];
  if (metadata.doi) lines.push(`- DOI: ${metadata.doi}`);
  if (metadata.journal) lines.push(`- Journal: ${metadata.journal}`);
  if (metadata.year) lines.push(`- Year: ${metadata.year}`);
  if (metadata.url) lines.push(`- URL: ${metadata.url}`);
  if (metadata.source_pdf_relative_path) {
    lines.push(`- Source PDF: ${metadata.source_pdf_relative_path}`);
  } else if (metadata.source_pdf_path) {
    lines.push(`- Source PDF: ${metadata.source_pdf_path}`);
  }
  if (extraction.truncated) {
    lines.push(`- Truncated: ${cleanText(extraction.truncation_reason, 120) || 'yes'}`);
  }
  return lines;
}

function buildFiguresMarkdown(figures = [], { figuresRelativeDir = 'figures' } = {}) {
  const rows = asArray(figures)
    .map((figure) => normalizeFigureEntry(figure, figuresRelativeDir))
    .filter(Boolean)
    .map((entry) => `- ${figureMarkdownLine(entry)}`);
  return rows.join('\n');
}

function buildPdfMarkdownFromExtraction({
  metadata = {},
  extraction = {},
  extractedText = '',
  sourcePdfPath = '',
  sourcePdfRelativePath = '',
  transformedAt = '',
  maxSectionChars = DEFAULT_MAX_SECTION_CHARS,
  maxPageChars = DEFAULT_MAX_PAGE_CHARS,
  includePages,
  figures = [],
  figuresRelativeDir = 'figures'
} = {}) {
  const normalizedExtraction = ensureObject(extraction);
  const normalizedMetadata = normalizePdfMarkdownMetadata({
    ...ensureObject(metadata),
    source_pdf_path: sourcePdfPath || metadata.source_pdf_path || metadata.sourcePdfPath,
    source_pdf_relative_path: sourcePdfRelativePath || metadata.source_pdf_relative_path || metadata.sourcePdfRelativePath
  }, normalizedExtraction, extractedText);
  const title = normalizeMarkdownHeading(normalizedMetadata.title);
  const authors = normalizedMetadata.authors.length ? normalizedMetadata.authors.join(', ') : '-';
  const resolvedFigures = asArray(figures).length
    ? asArray(figures)
    : asArray(normalizedExtraction.figures);
  const figureState = {
    entries: resolvedFigures.map((figure) => normalizeFigureEntry(figure, figuresRelativeDir)).filter(Boolean),
    used: new Set()
  };
  const sectionMarkdown = buildSectionMarkdown(normalizedExtraction.sections, maxSectionChars, figureState);
  const resolvedIncludePages = typeof includePages === 'boolean'
    ? includePages
    : !sectionMarkdown;
  const pageMarkdown = resolvedIncludePages ? buildPageMarkdown(normalizedExtraction.pages, maxPageChars, figureState) : '';
  const rawText = !sectionMarkdown && !pageMarkdown
    ? formatMarkdownBodyText(limitBlock(extractedText || normalizedExtraction.text, maxSectionChars))
    : '';
  const transformedLine = cleanText(transformedAt, 120)
    ? [`- Transformed at: ${cleanText(transformedAt, 120)}`]
    : [];
  // Figures whose page never matched a rendered section/page still get listed,
  // so nothing is silently dropped.
  const leftoverFigures = figureState.entries.filter((entry) => !figureState.used.has(entry));
  const figuresMarkdown = leftoverFigures.map((entry) => `- ${figureMarkdownLine(entry)}`).join('\n');
  const parts = [
    `# ${title}`,
    '',
    `**Authors:** ${authors}`,
    '',
    '## Metadata',
    '',
    ...buildMetadataLines(normalizedMetadata, normalizedExtraction),
    ...transformedLine,
    '',
    '## Sections',
    '',
    sectionMarkdown || '- No section headings were detected.',
  ];
  if (figuresMarkdown) {
    parts.push('', '## Figures', '', figuresMarkdown);
  }
  if (resolvedIncludePages) {
    parts.push('', '## Pages', '', pageMarkdown || rawText || '- No extractable page text was found.');
  } else if (!sectionMarkdown) {
    parts.push('', '## Text', '', rawText || '- No extractable text was found.');
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function transformPdfToMarkdown({
  pdfTextExtractionRuntime,
  pdfInput = {},
  outputPath = '',
  extractedTextPath = '',
  metadata = {},
  now = () => new Date().toISOString()
} = {}) {
  if (!pdfTextExtractionRuntime || typeof pdfTextExtractionRuntime.extractText !== 'function') {
    return {
      ok: false,
      status: 'error',
      error: 'PDF-to-Markdown conversion requires pdfTextExtractionRuntime.extractText.'
    };
  }
  const extraction = await pdfTextExtractionRuntime.extractText({
    ...ensureObject(pdfInput),
    action: 'extract',
    include_pages: true,
    include_sections: true
  });
  if (extraction?.ok !== true) {
    return {
      ok: false,
      status: 'error',
      error: cleanText(extraction?.error, 1200) || 'PDF text extraction failed.',
      extraction
    };
  }

  const extractedText = buildExtractedTextFile(extraction);
  const markdown = buildPdfMarkdownFromExtraction({
    metadata,
    extraction,
    extractedText,
    sourcePdfPath: pdfInput.file_path || pdfInput.filePath || pdfInput.path || '',
    sourcePdfRelativePath: metadata.source_pdf_relative_path || metadata.sourcePdfRelativePath || '',
    transformedAt: now()
  });
  if (outputPath) {
    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
    await fsPromises.writeFile(outputPath, `${markdown}\n`, 'utf8');
  }
  if (extractedTextPath) {
    await fsPromises.mkdir(path.dirname(extractedTextPath), { recursive: true });
    await fsPromises.writeFile(extractedTextPath, extractedText, 'utf8');
  }
  return {
    ok: true,
    status: 'ready',
    format: PDF_TO_MD_FORMAT,
    markdown,
    output_path: outputPath,
    extracted_text_path: extractedTextPath,
    extraction
  };
}

module.exports = {
  PDF_TO_MD_FORMAT,
  buildExtractedTextFile,
  buildFiguresMarkdown,
  buildPdfMarkdownFromExtraction,
  formatMarkdownBodyText,
  normalizePdfMarkdownMetadata,
  transformPdfToMarkdown
};
