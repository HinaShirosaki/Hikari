'use strict';

const { asArray, ensureObject } = require('../../../../lib/normalize.js');
const { DEFAULT_FALLBACK_PAGE_CHARS, cleanText } = require('./text-utils.js');

function normalizeComparableContent(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function contentSupportsEvidence(content = '', evidence = '') {
  const normalizedEvidence = normalizeComparableContent(evidence);
  return normalizedEvidence.length >= 12
    && normalizeComparableContent(content).includes(normalizedEvidence);
}

function normalizeExperiments(value, { sourceContents = [], requireEvidence = false } = {}) {
  return asArray(value)
    .map((item, index) => {
      const source = ensureObject(item);
      const evidence = cleanText(source.evidence || source.source_content || source.sourceContent, 1600);
      if (requireEvidence && !asArray(sourceContents).some((content) => contentSupportsEvidence(content, evidence))) {
        return null;
      }
      return {
        id: `e${index + 1}`,
        title: cleanText(source.title, 240),
        technique: cleanText(source.technique, 240),
        variables: cleanText(source.variables, 400),
        figure_ref: cleanText(source.figure_ref || source.figureRef, 80),
        outcome: cleanText(source.outcome, 600),
        ...(evidence ? { evidence } : {})
      };
    })
    .filter((experiment) => experiment && (experiment.title || experiment.technique));
}

function experimentIdentity(experiment = {}) {
  const source = ensureObject(experiment);
  return [source.figure_ref, source.title, source.technique, source.variables, source.outcome]
    .map((value) => normalizeComparableContent(value))
    .join('|');
}

function mergeExperiments(current = [], incoming = []) {
  const merged = [];
  const seen = new Set();
  [...asArray(current), ...asArray(incoming)].forEach((experiment) => {
    const key = experimentIdentity(experiment);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push({ ...experiment, id: `e${merged.length + 1}` });
  });
  return merged;
}

function splitExtractedTextPages(value = '') {
  const text = String(value || '');
  const markerPattern = /^\[\[page:\s*\d+\s*\]\]\s*$/gimu;
  const markers = [...text.matchAll(markerPattern)];
  if (!markers.length) {
    return [];
  }
  return markers.map((marker, index) => {
    const start = Number(marker.index) + marker[0].length;
    const end = index + 1 < markers.length ? Number(markers[index + 1].index) : text.length;
    return text.slice(start, end).trim();
  }).filter(Boolean);
}

function splitTextIntoPageWindows(value = '', maxChars = DEFAULT_FALLBACK_PAGE_CHARS) {
  const paragraphs = String(value || '').split(/\n{2,}/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const pages = [];
  let current = '';
  paragraphs.forEach((paragraph) => {
    if (current && current.length + paragraph.length + 2 > maxChars) {
      pages.push(current);
      current = '';
    }
    if (paragraph.length > maxChars) {
      if (current) {
        pages.push(current);
        current = '';
      }
      for (let offset = 0; offset < paragraph.length; offset += maxChars) {
        pages.push(paragraph.slice(offset, offset + maxChars));
      }
      return;
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  });
  if (current) {
    pages.push(current);
  }
  return pages;
}

function createPaperPageCursor(pages = []) {
  const contentPages = asArray(pages).map((page) => cleanText(page, 0)).filter(Boolean);
  let index = 0;
  return Object.freeze({
    nextPage() {
      if (index >= contentPages.length) {
        return { content: '', has_more: false };
      }
      const content = contentPages[index];
      index += 1;
      return {
        content,
        has_more: index < contentPages.length
      };
    }
  });
}

function normalizeOutline(value) {
  return asArray(value)
    .map((item) => {
      const source = ensureObject(item);
      return {
        section: cleanText(source.section, 240),
        summary: cleanText(source.summary, 600)
      };
    })
    .filter((entry) => entry.section || entry.summary)
    .slice(0, 40);
}

function normalizeClaims(value) {
  return asArray(value)
    .map((item) => {
      const source = ensureObject(item);
      return {
        section: cleanText(source.section, 240),
        claim: cleanText(source.claim, 600)
      };
    })
    .filter((entry) => entry.claim)
    .slice(0, 5);
}

module.exports = {
  contentSupportsEvidence,
  createPaperPageCursor,
  mergeExperiments,
  normalizeClaims,
  normalizeExperiments,
  normalizeOutline,
  splitExtractedTextPages,
  splitTextIntoPageWindows
};
