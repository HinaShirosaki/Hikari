import { normalizeRecordEvidence } from './record-citations.mjs';

const rows = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const positiveInteger = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;

// Shared by transport, saved messages, and the card. Preserve source whitespace;
// paper text and researcher comments are data, never executable markup.
export function normalizePaperEvidence(block) {
  if (!block || typeof block !== 'object') return null;
  const sourceLines = rows(block.source_lines || block.sourceLines).map(line => ({
    line_number: positiveInteger(line?.line_number ?? line?.lineNumber),
    content: String(line?.content ?? line?.text ?? '')
  })).filter(line => line.line_number);
  const lineRanges = rows(block.line_ranges || block.lineRanges).map(range => ({
    start_line: positiveInteger(range?.start_line ?? range?.startLine),
    end_line: positiveInteger(range?.end_line ?? range?.endLine ?? range?.start_line ?? range?.startLine)
  })).filter(range => range.start_line && range.end_line >= range.start_line);
  const excerpt = text(block.excerpt);
  if (!sourceLines.length && !excerpt) return null;
  return {
    block_id: text(block.block_id),
    paper_id: text(block.paper_id || block.paperId),
    paper_title: text(block.paper_title || block.paperTitle),
    section_label: text(block.section_label || block.sectionLabel),
    source_path: text(block.source_path || block.sourcePath),
    source_absolute_path: text(block.source_absolute_path || block.sourceAbsolutePath),
    line_ranges: lineRanges,
    source_lines: sourceLines,
    // Exact source lines already carry the excerpt without a second copy.
    excerpt: sourceLines.length ? '' : excerpt,
    relevance_reason: text(block.relevance_reason || block.relevanceReason),
    related_comments: rows(block.related_comments || block.relatedComments).map(comment => ({
      text: text(comment?.text || comment?.comment || comment?.note),
      author: text(comment?.author)
    })).filter(comment => comment.text)
  };
}

export function paperEvidenceText(block) {
  return block.excerpt || block.source_lines.map(line => line.content).join('\n');
}

export function paperEvidenceKey(block) {
  return JSON.stringify([block.paper_id, block.source_path || block.source_absolute_path,
    block.paper_title, block.section_label, block.line_ranges, block.source_lines,
    block.excerpt, block.relevance_reason]);
}

export function mergePaperEvidence(...collections) {
  return mergeEvidence(false, collections);
}

// The existing paper_evidence wire field also carries typed record evidence.
export function mergeSourceEvidence(...collections) {
  return mergeEvidence(true, collections);
}

function mergeEvidence(includeRecords, collections) {
  const unique = new Map();
  for (const source of collections.flatMap(rows)) {
    if (source?.source_type) {
      const record = includeRecords && normalizeRecordEvidence(source);
      if (record) unique.set(record.target, record);
    } else {
      const block = normalizePaperEvidence(source);
      if (block) unique.set(paperEvidenceKey(block), block);
    }
  }
  return [...unique.values()];
}
