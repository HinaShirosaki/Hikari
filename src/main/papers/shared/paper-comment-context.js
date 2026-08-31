'use strict';

const { cloneJson, ensureObject } = require('../../lib/normalize.js');

const DEFAULT_MAX_COMMENTS_PER_PAPER = 16;
const DEFAULT_MAX_RELATED_COMMENTS = 4;

function defaultAsArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultCleanText(value, maxLength = 4000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (!maxLength || maxLength <= 0) {
    return text;
  }
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function createHelpers(helpers = {}) {
  return {
    asArray: typeof helpers.asArray === 'function' ? helpers.asArray : defaultAsArray,
    cleanText: typeof helpers.cleanText === 'function' ? helpers.cleanText : defaultCleanText
  };
}

function normalizeComparableText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s./:-]+/gu, '');
}

function normalizeIdentifier(value = '') {
  return normalizeComparableText(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '')
    .replace(/\s+/g, '');
}

function normalizeRelativePath(value = '') {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase();
}

function normalizePaperHighlight(highlight = {}, helpers = {}) {
  const { cleanText } = createHelpers(helpers);
  const source = ensureObject(highlight);
  const id = cleanText(source.id, 160);
  const text = cleanText(source.text, 1200);
  const pageNumber = Math.round(Number(source.pageNumber || source.page_number));
  if (!id || !text) {
    return null;
  }
  return {
    id,
    page_number: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : null,
    text,
    kind: cleanText(source.kind || source.type, 40) || 'highlight',
    created_at: cleanText(source.createdAt || source.created_at, 80),
    updated_at: cleanText(source.updatedAt || source.updated_at, 80)
  };
}

function normalizePaperComment(comment = {}, highlightsById = new Map(), helpers = {}) {
  const { cleanText } = createHelpers(helpers);
  const source = ensureObject(comment);
  const id = cleanText(source.id, 160);
  const text = cleanText(source.text || source.comment || source.note, 1200);
  const pageNumber = Math.round(Number(source.pageNumber || source.page_number));
  const highlightId = cleanText(source.highlightId || source.highlight_id, 160);
  const highlight = highlightId ? highlightsById.get(highlightId) || null : null;
  if (!id || !text) {
    return null;
  }
  return {
    id,
    page_number: Number.isFinite(pageNumber) && pageNumber > 0
      ? pageNumber
      : (highlight?.page_number || null),
    text,
    author: cleanText(source.author, 160) || 'Local user',
    highlight_id: highlightId,
    highlight_text: cleanText(source.highlightText || source.highlight_text || highlight?.text, 1200),
    created_at: cleanText(source.createdAt || source.created_at, 80),
    updated_at: cleanText(source.updatedAt || source.updated_at, 80)
  };
}

function normalizeRelatedComments(comments = [], helpers = {}) {
  const { asArray, cleanText } = createHelpers(helpers);
  return asArray(comments)
    .map((comment) => {
      const source = ensureObject(comment);
      const id = cleanText(source.id, 160);
      const text = cleanText(source.text || source.comment || source.note, 1200);
      if (!id || !text) {
        return null;
      }
      const pageNumber = Math.round(Number(source.page_number || source.pageNumber));
      return {
        id,
        text,
        author: cleanText(source.author, 160) || 'Local user',
        ...(Number.isFinite(pageNumber) && pageNumber > 0 ? { page_number: pageNumber } : {}),
        ...(cleanText(source.highlight_id || source.highlightId, 160)
          ? { highlight_id: cleanText(source.highlight_id || source.highlightId, 160) }
          : {}),
        ...(cleanText(source.highlight_text || source.highlightText, 1200)
          ? { highlight_text: cleanText(source.highlight_text || source.highlightText, 1200) }
          : {}),
        ...(cleanText(source.relation, 80) ? { relation: cleanText(source.relation, 80) } : {}),
        ...(cleanText(source.created_at || source.createdAt, 80)
          ? { created_at: cleanText(source.created_at || source.createdAt, 80) }
          : {}),
        ...(cleanText(source.updated_at || source.updatedAt, 80)
          ? { updated_at: cleanText(source.updated_at || source.updatedAt, 80) }
          : {})
      };
    })
    .filter(Boolean)
    .slice(0, DEFAULT_MAX_RELATED_COMMENTS);
}

function normalizePaperAnnotationRecord(paper = {}, helpers = {}) {
  const { asArray, cleanText } = createHelpers(helpers);
  const source = ensureObject(paper);
  const highlights = asArray(source.highlights)
    .map((highlight) => normalizePaperHighlight(highlight, { cleanText }))
    .filter(Boolean);
  const highlightsById = new Map(highlights.map((highlight) => [highlight.id, highlight]));
  const comments = asArray(source.comments)
    .map((comment) => normalizePaperComment(comment, highlightsById, { cleanText }))
    .filter(Boolean)
    .slice(0, DEFAULT_MAX_COMMENTS_PER_PAPER);

  return {
    local_paper_id: cleanText(source.id || source.paper_id || source.paperId, 220),
    paper_title: cleanText(source.title || source.paper_title || source.paperTitle || source.fileName, 320),
    doi: normalizeIdentifier(source.doi),
    pmid: normalizeIdentifier(source.pmid),
    pmcid: normalizeIdentifier(source.pmcid),
    url: normalizeIdentifier(source.url || source.sourceUrl || source.source_url),
    stored_relative_path: normalizeRelativePath(source.storedRelativePath || source.stored_relative_path || source.relative_path || source.relativePath),
    file_name: cleanText(source.fileName || source.file_name, 320),
    comments,
    highlights
  };
}

function normalizePaperAnnotationSnapshot(paper = {}, helpers = {}) {
  const { asArray, cleanText } = createHelpers(helpers);
  if (!paper || typeof paper !== 'object' || Array.isArray(paper)) {
    return paper;
  }
  const source = ensureObject(paper);
  const annotation = normalizePaperAnnotationRecord(source, { asArray, cleanText });
  return {
    ...source,
    comments: annotation.comments.map((comment) => ({
      id: comment.id,
      pageNumber: comment.page_number,
      text: comment.text,
      author: comment.author,
      highlightId: comment.highlight_id,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at
    })).filter((comment) => comment.id && comment.text),
    highlights: annotation.highlights.map((highlight) => ({
      id: highlight.id,
      pageNumber: highlight.page_number,
      text: highlight.text,
      kind: highlight.kind,
      createdAt: highlight.created_at,
      updatedAt: highlight.updated_at
    })).filter((highlight) => highlight.id && highlight.text)
  };
}

function scoreRecordMatch(record = {}, paper = {}, download = {}) {
  const source = ensureObject(paper);
  const downloaded = ensureObject(download);
  let score = 0;
  const sourceDoi = normalizeIdentifier(source.doi);
  const sourcePmid = normalizeIdentifier(source.pmid);
  const sourcePmcid = normalizeIdentifier(source.pmcid);
  const sourceUrl = normalizeIdentifier(source.url);
  const sourceTitle = normalizeComparableText(source.paper_title || source.paperTitle || source.title);
  const recordTitle = normalizeComparableText(record.paper_title);
  const sourceId = normalizeComparableText(source.paper_id || source.paperId || source.id);
  const localId = normalizeComparableText(record.local_paper_id);
  const downloadRelativePath = normalizeRelativePath(
    downloaded.relative_path
      || downloaded.relativePath
      || downloaded.storedRelativePath
      || downloaded.stored_relative_path
  );

  if (sourceId && localId && sourceId === localId) score += 180;
  if (sourceDoi && record.doi && sourceDoi === record.doi) score += 220;
  if (sourcePmid && record.pmid && sourcePmid === record.pmid) score += 180;
  if (sourcePmcid && record.pmcid && sourcePmcid === record.pmcid) score += 180;
  if (sourceUrl && record.url && sourceUrl === record.url) score += 120;
  if (downloadRelativePath && record.stored_relative_path && downloadRelativePath === record.stored_relative_path) score += 220;
  if (sourceTitle && recordTitle && sourceTitle === recordTitle) score += 120;
  if (sourceTitle && recordTitle && sourceTitle.length > 12 && recordTitle.includes(sourceTitle)) score += 60;
  if (sourceTitle && recordTitle && recordTitle.length > 12 && sourceTitle.includes(recordTitle)) score += 60;
  return score;
}

function findBestAnnotationRecord(records = [], paper = {}, download = {}) {
  let best = null;
  let bestScore = 0;
  records.forEach((record) => {
    const score = scoreRecordMatch(record, paper, download);
    if (score > bestScore) {
      bestScore = score;
      best = record;
    }
  });
  return bestScore > 0 ? best : null;
}

function buildPaperAnnotationContext(input = {}, helpers = {}) {
  const { asArray, cleanText } = createHelpers(helpers);
  const snapshot = ensureObject(input.snapshot);
  const records = asArray(snapshot.papers)
    .map((paper) => normalizePaperAnnotationRecord(paper, { asArray, cleanText }))
    .filter((record) => record.local_paper_id || record.paper_title)
    .filter((record) => record.comments.length);
  const selectedPapers = asArray(input.selectedPapers || input.selected_papers);
  const downloadedPapers = asArray(input.downloadedPapers || input.downloaded_papers);
  const downloadsByPaperId = new Map(
    downloadedPapers
      .map((download) => [cleanText(download?.paper_id || download?.paperId, 120), ensureObject(download)])
      .filter(([paperId]) => paperId)
  );

  if (!selectedPapers.length) {
    return {
      records: records.map((record) => ({
        paper_id: record.local_paper_id,
        paper_title: record.paper_title,
        local_paper_id: record.local_paper_id,
        comments: cloneJson(record.comments, []),
        comment_count: record.comments.length
      }))
    };
  }

  const contextRecords = selectedPapers
    .map((paper) => {
      const source = ensureObject(paper);
      const paperId = cleanText(source.paper_id || source.paperId || source.id, 120);
      const matched = findBestAnnotationRecord(records, source, downloadsByPaperId.get(paperId) || {});
      if (!paperId || !matched) {
        return null;
      }
      return {
        paper_id: paperId,
        paper_title: cleanText(source.paper_title || source.paperTitle || source.title || matched.paper_title, 320),
        local_paper_id: matched.local_paper_id,
        comments: cloneJson(matched.comments, []),
        comment_count: matched.comments.length
      };
    })
    .filter(Boolean);

  return { records: contextRecords };
}

function getAnnotationRecordForPaperId(paperId = '', annotationContext = {}) {
  const normalizedPaperId = defaultCleanText(paperId, 120);
  if (!normalizedPaperId) {
    return null;
  }
  return defaultAsArray(annotationContext?.records)
    .find((record) => defaultCleanText(record?.paper_id, 120) === normalizedPaperId) || null;
}

function wordsForRelation(value = '') {
  return normalizeComparableText(value)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4);
}

function textOverlapScore(left = '', right = '') {
  const leftText = normalizeComparableText(left);
  const rightText = normalizeComparableText(right);
  if (!leftText || !rightText) {
    return 0;
  }
  if (leftText.includes(rightText) || rightText.includes(leftText)) {
    return 100;
  }
  const leftWords = new Set(wordsForRelation(leftText));
  const rightWords = wordsForRelation(rightText);
  if (!leftWords.size || !rightWords.length) {
    return 0;
  }
  const hits = rightWords.filter((word) => leftWords.has(word)).length;
  return hits >= Math.min(3, rightWords.length)
    ? Math.min(80, hits * 12)
    : 0;
}

function scoreCommentForBlock(comment = {}, block = {}) {
  const excerpt = defaultCleanText(block.excerpt || block.text || block.content, 4000);
  const highlightScore = textOverlapScore(excerpt, comment.highlight_text);
  if (highlightScore) {
    return { score: 200 + highlightScore, relation: 'highlight_overlap' };
  }
  const commentScore = textOverlapScore(excerpt, comment.text);
  if (commentScore) {
    return { score: 100 + commentScore, relation: 'comment_overlap' };
  }
  const blockPage = Math.round(Number(block.page_number || block.pageNumber));
  if (Number.isFinite(blockPage) && blockPage > 0 && Number(comment.page_number) === blockPage) {
    return { score: 80, relation: 'same_page' };
  }
  return { score: 1, relation: 'paper_comment' };
}

function getRelatedCommentsForBlock(block = {}, annotationContext = {}, helpers = {}) {
  const { asArray } = createHelpers(helpers);
  const paperId = defaultCleanText(block.paper_id || block.paperId, 120);
  const record = getAnnotationRecordForPaperId(paperId, annotationContext);
  if (!record) {
    return [];
  }
  return asArray(record.comments)
    .map((comment) => {
      const relation = scoreCommentForBlock(comment, block);
      return {
        ...comment,
        relation: relation.relation,
        _score: relation.score
      };
    })
    .sort((left, right) => {
      if (right._score !== left._score) {
        return right._score - left._score;
      }
      return String(right.updated_at || right.created_at || '').localeCompare(String(left.updated_at || left.created_at || ''));
    })
    .slice(0, DEFAULT_MAX_RELATED_COMMENTS)
    .map(({ _score, ...comment }) => comment);
}

function getRelatedCommentsForPaperId(paperId = '', annotationContext = {}) {
  const record = getAnnotationRecordForPaperId(paperId, annotationContext);
  return record ? normalizeRelatedComments(record.comments) : [];
}

function attachRelatedCommentsToContextBlocks(blocks = [], annotationContext = {}, helpers = {}) {
  const { asArray } = createHelpers(helpers);
  return asArray(blocks).map((block) => {
    const source = ensureObject(block);
    const existing = normalizeRelatedComments(source.related_comments || source.relatedComments, helpers);
    const related = existing.length
      ? existing
      : getRelatedCommentsForBlock(source, annotationContext, helpers);
    return {
      ...source,
      related_comments: normalizeRelatedComments(related, helpers)
    };
  });
}

module.exports = {
  attachRelatedCommentsToContextBlocks,
  buildPaperAnnotationContext,
  cloneJson,
  getRelatedCommentsForBlock,
  getRelatedCommentsForPaperId,
  normalizePaperAnnotationRecord,
  normalizePaperAnnotationSnapshot,
  normalizeRelatedComments
};
