import * as papersPdfViewer from './papers/pdf-viewer.js';

export function clampCommentAnchor(value) {
  return papersPdfViewer.clampCommentAnchor(value);
}

export function computePdfAnchorFromClientPoint(args = {}) {
  return papersPdfViewer.computePdfAnchorFromClientPoint(args);
}

export function getPdfCommentPinPosition(anchorX, anchorY) {
  return papersPdfViewer.getPdfCommentPinPosition(anchorX, anchorY);
}

export function createPapersPdfViewer(elements = {}) {
  return papersPdfViewer.createPapersPdfViewer(elements);
}
