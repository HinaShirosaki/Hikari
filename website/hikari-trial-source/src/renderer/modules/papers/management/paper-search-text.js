import { getPaperDisplayTitle, normalizePaperPdfMetadata } from '../pdf-metadata.js';

function normalizePaperSelectionSearchText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function pushPaperSearchValue(values, value, { label = '', weight = 1 } = {}) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return;
  }
  values.push({
    label,
    value: text,
    weight: Math.max(1, Number(weight) || 1)
  });
}

function collectStructuredPaperSearchValues(values, source, options = {}, depth = 0) {
  if (depth > 4 || source == null) {
    return;
  }
  if (typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean') {
    pushPaperSearchValue(values, source, options);
    return;
  }
  if (Array.isArray(source)) {
    source.forEach((item) => collectStructuredPaperSearchValues(values, item, options, depth + 1));
    return;
  }
  if (typeof source !== 'object') {
    return;
  }
  Object.entries(source).forEach(([key, value]) => {
    if (/^(?:pdfDataUrl|dataBase64|rawData|bytes|buffer)$/i.test(key)) {
      return;
    }
    collectStructuredPaperSearchValues(values, value, options, depth + 1);
  });
}

function collectPaperBookmarkSearchValues(values, bookmarks = []) {
  (Array.isArray(bookmarks) ? bookmarks : []).forEach((bookmark) => {
    pushPaperSearchValue(values, bookmark?.title, { label: 'Bookmark', weight: 2 });
    collectPaperBookmarkSearchValues(values, bookmark?.items);
  });
}

function collectPaperDatabaseSearchValues(paper = {}) {
  const values = [];
  pushPaperSearchValue(values, paper.title, { label: 'Title', weight: 4 });
  pushPaperSearchValue(values, paper.fileName, { label: 'File', weight: 2 });
  pushPaperSearchValue(values, paper.linkedName, { label: 'Folder', weight: 2 });
  pushPaperSearchValue(values, paper.summary, { label: 'Summary', weight: 3 });

  const metadata = normalizePaperPdfMetadata(paper.pdfMetadata || null);
  Object.values(metadata).forEach((value) => {
    pushPaperSearchValue(values, value, { label: 'PDF metadata', weight: 3 });
  });
  collectStructuredPaperSearchValues(values, paper.summaryStructured, { label: 'Summary', weight: 3 });
  collectStructuredPaperSearchValues(values, paper.methodsExtract, { label: 'Methods', weight: 3 });
  collectStructuredPaperSearchValues(values, paper.keyFigures, { label: 'Figures', weight: 2 });
  collectStructuredPaperSearchValues(values, paper.keyReagents, { label: 'Reagents', weight: 2 });
  collectStructuredPaperSearchValues(values, paper.comments, { label: 'Comments', weight: 2 });
  collectStructuredPaperSearchValues(values, paper.highlights, { label: 'Highlights', weight: 2 });
  collectStructuredPaperSearchValues(values, paper.knowledgeDatabase, { label: 'Knowledge', weight: 1 });
  collectPaperBookmarkSearchValues(values, paper.pdfBookmarks);
  return values;
}

function countQueryTermHits(sourceText = '', terms = []) {
  if (!terms.length) {
    return 0;
  }
  const source = normalizePaperSelectionSearchText(sourceText);
  if (!source) {
    return 0;
  }
  return terms.reduce((count, term) => count + (source.includes(term) ? 1 : 0), 0);
}

function searchPaperDatabaseForSelectedText(papers = [], rawText = '', options = {}) {
  const query = normalizePaperSelectionSearchText(rawText);
  if (!query) {
    return [];
  }
  const terms = [...new Set(query.split(/\s+/).filter((term) => term.length > 2))].slice(0, 12);
  const requiredTermHits = terms.length <= 6
    ? terms.length
    : Math.max(6, Math.ceil(terms.length * 0.75));
  const activePaperId = String(options.activePaperId || '').trim();
  const limit = Math.max(1, Math.min(50, Math.round(Number(options.limit) || 10)));

  return (Array.isArray(papers) ? papers : [])
    .map((paper) => {
      const paperId = String(paper?.id || '').trim();
      if (!paperId) {
        return null;
      }
      const values = collectPaperDatabaseSearchValues(paper);
      let score = 0;
      const matchedLabels = new Set();
      values.forEach((entry) => {
        const source = normalizePaperSelectionSearchText(entry.value);
        if (!source) {
          return;
        }
        const exactMatch = source.includes(query);
        const termHits = exactMatch ? terms.length : countQueryTermHits(source, terms);
        const enoughTermHits = terms.length > 0 && termHits >= requiredTermHits;
        if (!exactMatch && !enoughTermHits) {
          return;
        }
        score += (exactMatch ? 10 : termHits) * entry.weight;
        matchedLabels.add(entry.label || 'Paper');
      });
      if (score <= 0) {
        return null;
      }
      return {
        paperId,
        title: getPaperDisplayTitle(paper),
        folderLabel: String(paper?.linkedName || paper?.linkedType || '').trim(),
        matchCount: matchedLabels.size,
        isActive: paperId === activePaperId,
        score
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit)
    .map(({ score, ...match }) => match);
}

export {
  collectPaperDatabaseSearchValues,
  normalizePaperSelectionSearchText,
  searchPaperDatabaseForSelectedText
};
