'use strict';

function normalizeSectionLabel(rawLabel) {
  const text = String(rawLabel || '')
    .trim()
    .toLowerCase()
    .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
    .replace(/^[ivxlcdm]+\.\s+/, '')
    .replace(/[:.\-—]\s*$/, '')
    .trim();
  if (!text) {
    return '';
  }
  if (/^abstract\b/.test(text)) return 'abstract';
  if (/^(introduction|background)\b/.test(text)) return 'introduction';
  if (/^(materials?\s+and\s+methods?|methods?\s+and\s+materials|methods?|methodology|experimental(?:\s+(?:section|procedures?))?)\b/.test(text)) return 'methods';
  if (/^results?(?:\s+and\s+discussion)?\b/.test(text)) return 'results';
  if (/^(discussion|findings)\b/.test(text)) return 'discussion';
  if (/^(conclusions?|concluding\s+remarks|summary)\b/.test(text)) return 'conclusion';
  if (/^(references|bibliography|works\s+cited|literature\s+cited)\b/.test(text)) return 'references';
  if (/^acknowled?g(?:e)?ments?\b/.test(text)) return 'acknowledgments';
  if (/^funding\b/.test(text)) return 'funding';
  if (/^online\s+content\b/.test(text)) return 'online_content';
  if (/^reporting\s+summary\b/.test(text)) return 'reporting_summary';
  if (/^(competing\s+interests|conflicts?\s+of\s+interest|declarations?)\b/.test(text)) return 'declarations';
  if (/^(supplement(?:ary)?\s+(?:material|information)|supporting\s+information)\b/.test(text)) return 'supplementary';
  if (/^(appendix|appendices)\b/.test(text)) return 'appendix';
  if (/^author\s+(?:contributions?|information)\b/.test(text)) return 'author_contributions';
  if (/^(data|code)\s+availability\b/.test(text)) return 'data_availability';
  return '';
}

function formatDetectedHeadingLabel(label, normalizedLabel) {
  const canonicalLabels = {
    abstract: 'Abstract',
    introduction: 'Introduction',
    methods: 'Methods',
    results: 'Results',
    discussion: 'Discussion',
    conclusion: 'Conclusion',
    references: 'References',
    acknowledgments: 'Acknowledgements',
    funding: 'Funding',
    online_content: 'Online content',
    reporting_summary: 'Reporting summary',
    declarations: 'Declarations',
    supplementary: 'Supplementary information',
    appendix: 'Appendix',
    author_contributions: 'Author contributions',
    data_availability: 'Data availability'
  };
  return canonicalLabels[normalizedLabel] || label;
}

function detectHeadingFromLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.length > 180) {
    return null;
  }
  const stripped = trimmed
    .replace(/^[\d]+(?:\.[\d]+)*\.?\s+/, '')
    .replace(/^[ivxlcdm]+\.\s+/i, '')
    .replace(/[:.\-—]\s*$/, '')
    .trim();
  if (!stripped || stripped.length > 160) {
    return null;
  }
  if (/^[a-z]/.test(stripped)) {
    return null;
  }
  const normalizedLabel = normalizeSectionLabel(stripped);
  if (!normalizedLabel) {
    return null;
  }
  return {
    label: formatDetectedHeadingLabel(trimmed, normalizedLabel),
    normalized_label: normalizedLabel
  };
}

function detectHeadingsFromPages(pages) {
  const headings = [];
  pages.forEach((page) => {
    const pageNumber = Number(page?.page_number);
    if (!Number.isFinite(pageNumber)) {
      return;
    }
    String(page.text || '')
      .split('\n')
      .forEach((line, lineIndex) => {
        const heading = detectHeadingFromLine(line);
        if (!heading) {
          return;
        }
        headings.push({
          page_number: pageNumber,
          line_index: lineIndex,
          label: heading.label,
          normalized_label: heading.normalized_label
        });
      });
  });
  // Drop duplicate canonical headings on the same page, while preserving
  // repeated real sections such as main-text References and Methods References.
  const seen = new Set();
  return headings.filter((heading) => {
    const key = `${heading.normalized_label}:${heading.page_number}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectPageLinesBetween(pages, startPoint, endPoint) {
  const sectionLines = [];
  pages.forEach((page) => {
    const pageNumber = Number(page.page_number);
    if (pageNumber < startPoint.page_number || pageNumber > endPoint.page_number) {
      return;
    }
    const lines = String(page.text || '').split('\n');
    let startIndex = 0;
    let endIndex = lines.length;
    if (pageNumber === startPoint.page_number) {
      startIndex = Math.min(lines.length, Math.max(0, Number(startPoint.line_index) || 0));
    }
    if (pageNumber === endPoint.page_number) {
      endIndex = Math.min(lines.length, Math.max(startIndex, Number(endPoint.line_index) || 0));
    }
    for (let lineIndex = startIndex; lineIndex < endIndex; lineIndex += 1) {
      const line = lines[lineIndex];
      if (line) {
        sectionLines.push(line);
      }
    }
  });
  return sectionLines;
}

function buildSectionsFromHeadings(pages, headings, maxCharsPerSection) {
  if (!Array.isArray(headings) || !headings.length) {
    return [];
  }
  const lastPageNumber = Number(pages[pages.length - 1]?.page_number) || 0;
  const sections = [];
  const firstPageNumber = Number(pages[0]?.page_number) || 1;
  const firstHeading = headings[0];
  const frontMatterLines = collectPageLinesBetween(
    pages,
    { page_number: firstPageNumber, line_index: 0 },
    { page_number: firstHeading.page_number, line_index: firstHeading.line_index }
  );
  if (frontMatterLines.length) {
    const text = frontMatterLines.join('\n');
    const limited = maxCharsPerSection > 0 && text.length > maxCharsPerSection
      ? text.slice(0, maxCharsPerSection)
      : text;
    sections.push({
      label: 'Front matter',
      normalized_label: 'front_matter',
      source: 'heuristic',
      start_page: firstPageNumber,
      end_page: firstHeading.page_number,
      character_count: limited.length,
      text: limited
    });
  }
  headings.forEach((current, index) => {
    const next = headings[index + 1] || null;
    const startPage = current.page_number;
    const endPage = next ? next.page_number : lastPageNumber;
    const sectionLines = collectPageLinesBetween(
      pages,
      { page_number: startPage, line_index: current.line_index + 1 },
      next
        ? { page_number: next.page_number, line_index: next.line_index }
        : { page_number: lastPageNumber, line_index: Number.MAX_SAFE_INTEGER }
    );
    const text = sectionLines.join('\n');
    const limited = maxCharsPerSection > 0 && text.length > maxCharsPerSection
      ? text.slice(0, maxCharsPerSection)
      : text;
    sections.push({
      label: current.label,
      normalized_label: current.normalized_label,
      source: 'heuristic',
      start_page: startPage,
      end_page: endPage,
      character_count: limited.length,
      text: limited
    });
  });
  return sections;
}

module.exports = {
  buildSectionsFromHeadings,
  detectHeadingFromLine,
  detectHeadingsFromPages,
  normalizeSectionLabel
};
