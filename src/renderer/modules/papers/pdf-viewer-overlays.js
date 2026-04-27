import { getHighlightMarkerBox, getPdfCommentPinPosition } from './pdf-viewer-anchors.js';

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
    pageHighlights.forEach((highlight) => {
      highlight.boxes.forEach((box) => {
        const markerBox = getHighlightMarkerBox(box);
        if (!markerBox) {
          return;
        }
        const mark = doc.createElement('div');
        mark.className = 'papers-viewer-highlight';
        mark.dataset.highlightId = highlight.id;
        mark.style.left = `${(markerBox.left * 100).toFixed(3)}%`;
        mark.style.top = `${(markerBox.top * 100).toFixed(3)}%`;
        mark.style.width = `${(markerBox.width * 100).toFixed(3)}%`;
        mark.style.height = `${(markerBox.height * 100).toFixed(3)}%`;
        mark.title = highlight.text;
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
