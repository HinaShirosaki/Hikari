import { clamp, clampCommentAnchor } from './pdf-viewer-anchors.js';

export function normalizeCommentList(comments) {
  return (Array.isArray(comments) ? comments : [])
    .map((comment) => {
      if (!comment || typeof comment !== 'object') {
        return null;
      }
      const id = String(comment.id || '').trim();
      const pageNumber = Math.round(Number(comment.pageNumber));
      const anchorX = clampCommentAnchor(comment.anchorX);
      const anchorY = clampCommentAnchor(comment.anchorY);
      if (!id || !Number.isFinite(pageNumber) || pageNumber < 1 || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
        return null;
      }
      return {
        ...comment,
        id,
        pageNumber,
        anchorX,
        anchorY,
        author: String(comment.author || 'Local user').trim() || 'Local user'
      };
    })
    .filter(Boolean);
}

export function normalizeHighlightList(highlights) {
  return (Array.isArray(highlights) ? highlights : [])
    .map((highlight) => {
      if (!highlight || typeof highlight !== 'object') {
        return null;
      }
      const id = String(highlight.id || '').trim();
      const pageNumber = Math.round(Number(highlight.pageNumber));
      const text = String(highlight.text || '').trim();
      const boxes = (Array.isArray(highlight.boxes) ? highlight.boxes : [])
        .map((box) => {
          if (!box || typeof box !== 'object') {
            return null;
          }
          const left = clamp(Number(box.x) || 0, 0, 1);
          const top = clamp(Number(box.y) || 0, 0, 1);
          const width = clamp(Number(box.width) || 0, 0, 1);
          const height = clamp(Number(box.height) || 0, 0, 1);
          if (width <= 0 || height <= 0) {
            return null;
          }
          const right = clamp(left + width, 0, 1);
          const bottom = clamp(top + height, 0, 1);
          if (right <= left || bottom <= top) {
            return null;
          }
          return {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top
          };
        })
        .filter(Boolean);
      if (!id || !Number.isFinite(pageNumber) || pageNumber < 1 || !text || !boxes.length) {
        return null;
      }
      return {
        ...highlight,
        id,
        pageNumber,
        text,
        boxes
      };
    })
    .filter(Boolean);
}
