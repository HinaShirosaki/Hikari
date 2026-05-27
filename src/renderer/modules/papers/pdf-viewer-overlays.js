import { getPdfCommentPinPosition } from './pdf-viewer-anchors.js';
import {
  buildHighlightSvgPath,
  normalizeHighlightBoxes,
  normalizePageDimension,
  pdfQuadPointsToBoxes
} from './pdf-viewer-geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function getHighlightBoxesForRecord(highlight, record) {
  const boxes = normalizeHighlightBoxes(highlight?.boxes);
  if (boxes.length) {
    return boxes;
  }
  const pageWidth = normalizePageDimension(highlight?.pageWidth || record?.metric?.width);
  const pageHeight = normalizePageDimension(highlight?.pageHeight || record?.metric?.height);
  return pdfQuadPointsToBoxes(highlight?.quadPoints, { pageWidth, pageHeight });
}

function getHighlightKind(highlight) {
  return String(highlight?.kind || highlight?.type || '').trim().toLowerCase() === 'underline'
    ? 'underline'
    : 'highlight';
}

function renderHighlightDivFallback({ doc, layer, highlight, boxes }) {
  const kind = getHighlightKind(highlight);
  boxes.forEach((box) => {
    const mark = doc.createElement('div');
    mark.className = `papers-viewer-highlight${highlight.commentId ? ' is-commented' : ''}${kind === 'underline' ? ' is-underline' : ''}`;
    mark.dataset.highlightId = highlight.id;
    if (highlight.commentId) {
      mark.dataset.commentId = highlight.commentId;
    }
    mark.style.left = `${(box.x * 100).toFixed(3)}%`;
    mark.style.top = kind === 'underline'
      ? `${((box.y + box.height) * 100).toFixed(3)}%`
      : `${(box.y * 100).toFixed(3)}%`;
    mark.style.width = `${(box.width * 100).toFixed(3)}%`;
    mark.style.height = `${(box.height * 100).toFixed(3)}%`;
    mark.title = highlight.text;
    layer.appendChild(mark);
  });
}

export function clearPins({ pageRecords = [], placementMode = false } = {}) {
  pageRecords.forEach((record) => {
    if (!record?.overlay) {
      return;
    }
    record.overlay.innerHTML = '';
    record.overlay.style.cursor = placementMode ? 'crosshair' : 'default';
    record.overlay.style.pointerEvents = placementMode ? 'auto' : 'none';
  });
}

export function renderHighlights({ pageRecords = [], highlights = [] } = {}) {
  const highlightsByPage = new Map();
  highlights.forEach((highlight) => {
    if (!highlightsByPage.has(highlight.pageNumber)) {
      highlightsByPage.set(highlight.pageNumber, []);
    }
    highlightsByPage.get(highlight.pageNumber).push(highlight);
  });

  pageRecords.forEach((record) => {
    const highlightLayer = record?.highlightLayer;
    if (!highlightLayer) {
      return;
    }
    highlightLayer.innerHTML = '';
    const pageHighlights = highlightsByPage.get(record.pageNumber) || [];
    if (!pageHighlights.length) {
      return;
    }
    const doc = highlightLayer.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc?.createElement) {
      return;
    }
    const svg = typeof doc.createElementNS === 'function'
      ? doc.createElementNS(SVG_NS, 'svg')
      : null;
    if (svg) {
      svg.classList.add('papers-viewer-highlight-svg');
      svg.setAttribute('viewBox', '0 0 1 1');
      svg.setAttribute('preserveAspectRatio', 'none');
      highlightLayer.appendChild(svg);
    }
    pageHighlights.forEach((highlight) => {
      const boxes = getHighlightBoxesForRecord(highlight, record);
      if (!boxes.length) {
        return;
      }
      if (!svg || getHighlightKind(highlight) === 'underline') {
        renderHighlightDivFallback({ doc, layer: highlightLayer, highlight, boxes });
        return;
      }
      const pathData = buildHighlightSvgPath(boxes);
      if (!pathData) {
        return;
      }
      const path = doc.createElementNS(SVG_NS, 'path');
      path.classList.add('papers-viewer-highlight-path');
      if (highlight.commentId) {
        path.classList.add('is-commented');
        path.dataset.commentId = highlight.commentId;
      }
      path.dataset.highlightId = highlight.id;
      path.setAttribute('d', pathData);
      const title = doc.createElementNS(SVG_NS, 'title');
      title.textContent = highlight.text;
      path.appendChild(title);
      svg.appendChild(path);
    });
  });
}

export function renderSearchHighlights({
  pageRecords = [],
  matches = [],
  activeMatchId = '',
  activeTone = 0
} = {}) {
  const matchesByPage = new Map();
  (Array.isArray(matches) ? matches : []).forEach((match) => {
    const pageNumber = Math.max(1, Math.round(Number(match?.pageNumber) || 1));
    if (!matchesByPage.has(pageNumber)) {
      matchesByPage.set(pageNumber, []);
    }
    matchesByPage.get(pageNumber).push(match);
  });

  pageRecords.forEach((record) => {
    const highlightLayer = record?.highlightLayer;
    if (!highlightLayer) {
      return;
    }
    highlightLayer.querySelectorAll?.('.papers-viewer-search-highlight')?.forEach((mark) => {
      mark.remove();
    });
    const pageMatches = matchesByPage.get(record.pageNumber) || [];
    if (!pageMatches.length) {
      return;
    }
    const doc = highlightLayer.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc?.createElement) {
      return;
    }
    pageMatches.forEach((match) => {
      const boxes = normalizeHighlightBoxes(match?.boxes);
      const isActive = String(match?.id || '') === String(activeMatchId || '');
      boxes.forEach((box) => {
        const mark = doc.createElement('div');
        mark.className = `papers-viewer-search-highlight${isActive ? ` is-active is-tone-${Math.max(0, Math.round(Number(activeTone) || 0)) % 4}` : ''}`;
        mark.dataset.searchMatchId = String(match?.id || '');
        mark.dataset.searchTerm = String(match?.term || '');
        mark.style.left = `${(box.x * 100).toFixed(3)}%`;
        mark.style.top = `${(box.y * 100).toFixed(3)}%`;
        mark.style.width = `${(box.width * 100).toFixed(3)}%`;
        mark.style.height = `${(box.height * 100).toFixed(3)}%`;
        mark.title = String(match?.text || match?.term || '');
        highlightLayer.appendChild(mark);
      });
    });
  });
}

export function renderPins({
  pageRecords = [],
  comments = [],
  selectedCommentId = '',
  placementMode = false,
  isActive = false,
  onPinSelect = null
} = {}) {
  clearPins({ pageRecords, placementMode });
  if (!isActive) {
    return;
  }

  const commentsByPage = new Map();
  comments.forEach((comment) => {
    const pageNumber = Math.max(1, Math.round(Number(comment.pageNumber) || 1));
    if (!commentsByPage.has(pageNumber)) {
      commentsByPage.set(pageNumber, []);
    }
    commentsByPage.get(pageNumber).push(comment);
  });

  pageRecords.forEach((record) => {
    const overlay = record.overlay;
    if (!overlay) {
      return;
    }
    const pageComments = commentsByPage.get(record.pageNumber) || [];
    if (!pageComments.length) {
      return;
    }
    const doc = overlay.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc?.createElement) {
      return;
    }
    pageComments.forEach((comment) => {
      if (!Number.isFinite(Number(comment.anchorX)) || !Number.isFinite(Number(comment.anchorY))) {
        return;
      }
      const pin = doc.createElement('button');
      pin.type = 'button';
      pin.className = 'papers-viewer-pin';
      pin.dataset.commentId = comment.id;
      if (comment.id === selectedCommentId) {
        pin.classList.add('is-active');
      }
      const position = getPdfCommentPinPosition(comment.anchorX, comment.anchorY);
      pin.style.left = position.left;
      pin.style.top = position.top;
      pin.setAttribute('aria-label', `Comment by ${comment.author || 'Local user'}`);
      pin.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof onPinSelect === 'function') {
          onPinSelect(comment);
        }
      });
      overlay.appendChild(pin);
    });
  });
}
