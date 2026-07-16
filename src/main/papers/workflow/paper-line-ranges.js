'use strict';

/**
 * Line-range parsing + Markdown line extraction for the Codex paper-context
 * workflow. The Codex sub-agent returns 1-based line ranges into paper.md;
 * these pure helpers normalize those (parse, validate, merge, cap), pull the
 * verbatim lines back out, and infer a section label from the nearest heading.
 *
 * Split out of codex-paper-context-workflow.js so this parity-sensitive
 * "hydrate exact source lines" logic has one home and is unit-testable.
 */

const DEFAULT_MAX_LINE_RANGES_PER_SELECTION = 8;
const DEFAULT_MAX_LINES_PER_SELECTION = 120;

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanText(value, _maxLength = 4000) {
  return String(value || '');
}

function parsePositiveLineNumber(value) {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }
  const raw = String(value || '').trim();
  if (!raw) {
    return 0;
  }
  const match = raw.match(/\d+/);
  const parsed = Number(match?.[0] || raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function addLineRange(ranges, startValue, endValue = startValue) {
  const start = parsePositiveLineNumber(startValue);
  const end = parsePositiveLineNumber(endValue || startValue);
  if (!start || !end) {
    return;
  }
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  ranges.push({ start_line: lower, end_line: upper });
}

function collectLineRanges(value, ranges) {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const raw = String(value || '').trim();
    if (typeof value === 'string' && /[,;]|\d+\s*(?:-|:|–|—)\s*\d+/u.test(raw)) {
      const pattern = /(\d+)(?:\s*(?:-|:|–|—)\s*(\d+))?/gu;
      let match = pattern.exec(raw);
      while (match) {
        addLineRange(ranges, match[1], match[2] || match[1]);
        match = pattern.exec(raw);
      }
      return;
    }
    addLineRange(ranges, value, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectLineRanges(entry, ranges));
    return;
  }
  const source = ensureObject(value);
  if (!Object.keys(source).length) {
    return;
  }

  collectLineRanges(source.line_ranges || source.lineRanges || source.line_range || source.lineRange, ranges);
  collectLineRanges(source.line_numbers || source.lineNumbers || source.line_number || source.lineNumber, ranges);
  collectLineRanges(source.lines, ranges);

  const start = source.start_line
    || source.startLine
    || source.line_start
    || source.lineStart
    || source.from_line
    || source.fromLine
    || source.from
    || source.start;
  const end = source.end_line
    || source.endLine
    || source.line_end
    || source.lineEnd
    || source.to_line
    || source.toLine
    || source.to
    || source.end
    || start;
  if (start) {
    addLineRange(ranges, start, end);
  }
}

function normalizeLineRanges(value, options = {}) {
  const ranges = [];
  collectLineRanges(value, ranges);
  const maxRanges = Math.max(1, Number(options.maxRanges) || DEFAULT_MAX_LINE_RANGES_PER_SELECTION);
  const maxTotalLines = Math.max(1, Number(options.maxTotalLines) || DEFAULT_MAX_LINES_PER_SELECTION);
  const normalized = ranges
    .map((range) => ({
      start_line: parsePositiveLineNumber(range.start_line),
      end_line: parsePositiveLineNumber(range.end_line || range.start_line)
    }))
    .filter((range) => range.start_line && range.end_line)
    .map((range) => ({
      start_line: Math.min(range.start_line, range.end_line),
      end_line: Math.max(range.start_line, range.end_line)
    }))
    .sort((left, right) => {
      if (left.start_line !== right.start_line) {
        return left.start_line - right.start_line;
      }
      return left.end_line - right.end_line;
    });

  const merged = [];
  normalized.forEach((range) => {
    const last = merged[merged.length - 1];
    if (last && range.start_line <= last.end_line + 1) {
      last.end_line = Math.max(last.end_line, range.end_line);
      return;
    }
    merged.push({ ...range });
  });

  const capped = [];
  let remainingLines = maxTotalLines;
  for (const range of merged) {
    if (capped.length >= maxRanges || remainingLines <= 0) {
      break;
    }
    const span = Math.min(range.end_line - range.start_line + 1, remainingLines);
    capped.push({
      start_line: range.start_line,
      end_line: range.start_line + span - 1
    });
    remainingLines -= span;
  }
  return capped;
}

function inferMarkdownSectionLabel(lines = [], startLine = 1, fallback = '') {
  const safeLines = Array.isArray(lines) ? lines : [];
  const startIndex = Math.max(0, Math.min(safeLines.length - 1, parsePositiveLineNumber(startLine) - 1));
  for (let index = startIndex; index >= 0; index -= 1) {
    const line = String(safeLines[index] || '').trim();
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading?.[1]) {
      return cleanText(heading[1].replace(/\s*\(pp?\.\s*[^)]+\)\s*$/i, ''), 160);
    }
  }
  return cleanText(fallback, 160) || 'Paper lines';
}

function readLineRangesFromText(text = '', ranges = []) {
  const lines = String(text || '').split(/\r?\n/);
  const rejectedRanges = [];
  const parts = normalizeLineRanges(ranges).map((range) => {
    if (range.start_line > lines.length) {
      rejectedRanges.push({
        ...range,
        reason: 'start_line_out_of_range'
      });
      return null;
    }
    const start = range.start_line;
    const end = Math.max(start, Math.min(range.end_line, lines.length));
    const sourceLines = lines.slice(start - 1, end).map((content, index) => ({
      line_number: start + index,
      content
    }));
    return {
      start_line: start,
      end_line: end,
      text: sourceLines.map((line) => line.content).join('\n').trim(),
      source_lines: sourceLines
    };
  }).filter((part) => part && part.text);
  return {
    line_count: lines.length,
    parts,
    source_lines: parts.flatMap((part) => part.source_lines),
    rejected_ranges: rejectedRanges,
    excerpt: parts.map((part) => part.text).join('\n\n[... omitted source lines ...]\n\n').trim()
  };
}

module.exports = {
  DEFAULT_MAX_LINE_RANGES_PER_SELECTION,
  DEFAULT_MAX_LINES_PER_SELECTION,
  parsePositiveLineNumber,
  normalizeLineRanges,
  inferMarkdownSectionLabel,
  readLineRangesFromText
};
