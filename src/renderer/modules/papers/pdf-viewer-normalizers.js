import { clampCommentAnchor } from './pdf-viewer-anchors.js';
import {
  boxesToPdfQuadPoints,
  normalizeHighlightBoxes,
  normalizePageDimension,
  normalizeQuadPointList,
  pdfQuadPointsToBoxes
} from './pdf-viewer-geometry.js';

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
      const pageWidth = normalizePageDimension(highlight.pageWidth);
      const pageHeight = normalizePageDimension(highlight.pageHeight);
      const sourceQuadPoints = normalizeQuadPointList(highlight.quadPoints);
      const boxes = normalizeHighlightBoxes(highlight.boxes);
      const derivedBoxes = boxes.length
        ? boxes
        : pdfQuadPointsToBoxes(sourceQuadPoints, { pageWidth, pageHeight });
      const quadPoints = sourceQuadPoints.length
        ? sourceQuadPoints
        : boxesToPdfQuadPoints(derivedBoxes, { pageWidth, pageHeight });
      if (!id || !Number.isFinite(pageNumber) || pageNumber < 1 || !text || !derivedBoxes.length) {
        return null;
      }
      return {
        ...highlight,
        id,
        pageNumber,
        text,
        boxes: derivedBoxes,
        ...(pageWidth ? { pageWidth } : {}),
        ...(pageHeight ? { pageHeight } : {}),
        ...(quadPoints.length ? { quadPoints } : {})
      };
    })
    .filter(Boolean);
}
