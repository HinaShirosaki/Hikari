import {
  clampCommentAnchor,
  computePdfAnchorFromClientPoint,
  getPdfCommentPinPosition
} from './pdf-viewer-anchors.js';
import { createPapersPdfViewerContext } from './pdf-viewer-controller-context.js';
import { installPdfViewerDataController } from './pdf-viewer-data-controller.js';
import { installPdfViewerDocumentCleanupController } from './pdf-viewer-document-cleanup-controller.js';
import { installPdfViewerDocumentOpenController } from './pdf-viewer-document-open-controller.js';
import { installPdfViewerDomController } from './pdf-viewer-dom-controller.js';
import { installPdfViewerEventsController } from './pdf-viewer-events-controller.js';
import { installPdfViewerHighlightController } from './pdf-viewer-highlight-controller.js';
import { installPdfViewerPageNavigationController } from './pdf-viewer-page-navigation-controller.js';
import { installPdfViewerPdfNavigationController } from './pdf-viewer-pdf-navigation-controller.js';
import { installPdfViewerRenderController } from './pdf-viewer-render-controller.js';
import {
  buildCurrentPdfSelectionSearchResult,
  buildHighlightCommentPopoverMarkup,
  buildHighlightPopoverMarkup,
  buildPdfSelectionSearchResultFromMatches,
  copyPdfHighlightText,
  countPdfSelectionSearchMatches,
  getPdfSelectionSearchTerms,
  normalizePdfHighlightText,
  normalizePdfSelectionSearchText
} from './pdf-viewer-search.js';
import { installPdfViewerSearchExecutionController } from './pdf-viewer-search-execution-controller.js';
import { installPdfViewerSearchUiController } from './pdf-viewer-search-ui-controller.js';
import { installPdfViewerSelectionActionsController } from './pdf-viewer-selection-actions-controller.js';
import { installPdfViewerSelectionMenuController } from './pdf-viewer-selection-menu-controller.js';
import { installPdfViewerScreenshotSelectionController } from './pdf-viewer-screenshot-selection-controller.js';
import { installPdfViewerToolbarController } from './pdf-viewer-toolbar-controller.js';

export {
  buildCurrentPdfSelectionSearchResult,
  buildHighlightCommentPopoverMarkup,
  buildHighlightPopoverMarkup,
  buildPdfSelectionSearchResultFromMatches,
  clampCommentAnchor,
  computePdfAnchorFromClientPoint,
  copyPdfHighlightText,
  countPdfSelectionSearchMatches,
  getPdfCommentPinPosition,
  getPdfSelectionSearchTerms,
  normalizePdfHighlightText,
  normalizePdfSelectionSearchText
};

function installPdfViewerControllers(ctx) {
  installPdfViewerDomController(ctx);
  installPdfViewerSelectionMenuController(ctx);
  installPdfViewerSearchUiController(ctx);
  installPdfViewerSelectionActionsController(ctx);
  installPdfViewerSearchExecutionController(ctx);
  installPdfViewerHighlightController(ctx);
  installPdfViewerPageNavigationController(ctx);
  installPdfViewerToolbarController(ctx);
  installPdfViewerPdfNavigationController(ctx);
  installPdfViewerRenderController(ctx);
  installPdfViewerDocumentCleanupController(ctx);
  installPdfViewerDocumentOpenController(ctx);
  installPdfViewerDataController(ctx);
  installPdfViewerScreenshotSelectionController(ctx);
  installPdfViewerEventsController(ctx);
}

export function createPapersPdfViewer(elements = {}) {
  const ctx = createPapersPdfViewerContext(elements);
  installPdfViewerControllers(ctx);
  ctx.bindEvents();
  ctx.renderEmptyViewer();

  return {
    openPaper: ctx.openPaper,
    resetViewer: ctx.resetViewer,
    getActivePaperId() {
      return ctx.state.paperId;
    },
    getCurrentPageNumber() {
      return ctx.state.pageNumber;
    },
    hasActiveDocument: ctx.hasActiveDocument,
    hasFillableForm() {
      return Boolean(ctx.state.hasFormFields);
    },
    getFilledPdfBytes: ctx.getFilledPdfBytes,
    startPaperScreenshotSelection: ctx.startPaperScreenshotSelection,
    goToPage: ctx.goToPage,
    openExternalUrl: ctx.openExternalLink,
    setComments: ctx.setComments,
    setHighlights: ctx.setHighlights,
    setSelectedCommentId: ctx.setSelectedCommentId,
    setPlacementMode: ctx.setPlacementMode
  };
}
