import { EMPTY_PAPER_PDF_METADATA, extractPaperPdfMetadata } from '../pdf-metadata.js';
import { loadPdfJsModule } from './pdf-viewer-loader.js';
import { bindPdfTextLayerSelection } from './pdf-viewer-text-selection.js';

async function loadPageMetrics(pdfDocument) {
  const metrics = [];
  let maxBasePageWidth = 0;
  for (let pageNumber = 1; pageNumber <= (Number(pdfDocument?.numPages) || 0); pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const width = Math.max(Math.ceil(viewport.width || 0), 1);
    const height = Math.max(Math.ceil(viewport.height || 0), 1);
    metrics.push({ width, height });
    maxBasePageWidth = Math.max(maxBasePageWidth, width);
    if (typeof page.cleanup === 'function') {
      try {
        page.cleanup();
      } catch {}
    }
  }
  return {
    metrics,
    maxBasePageWidth
  };
}

async function loadEmbeddedPdfMetadata(pdfDocument) {
  if (!pdfDocument || typeof pdfDocument.getMetadata !== 'function') {
    return EMPTY_PAPER_PDF_METADATA;
  }

  try {
    const metadata = await pdfDocument.getMetadata();
    return extractPaperPdfMetadata(metadata);
  } catch {
    return EMPTY_PAPER_PDF_METADATA;
  }
}

// pdf.js field-object types that carry no user-fillable value.
const NON_FILLABLE_FIELD_TYPES = new Set(['button', 'signature']);

async function loadFillableFieldPresence(pdfDocument) {
  if (typeof pdfDocument?.getFieldObjects !== 'function') {
    return false;
  }
  try {
    const fields = await pdfDocument.getFieldObjects();
    return Object.values(fields || {}).some((group) => (
      Array.isArray(group) && group.some((field) => !NON_FILLABLE_FIELD_TYPES.has(field?.type))
    ));
  } catch {
    return false;
  }
}

function safePageCleanup(page) {
  if (typeof page?.cleanup === 'function') {
    try {
      page.cleanup();
    } catch {}
  }
}

function getViewportScale(viewport) {
  return Math.max(Number(viewport?.scale) || 0, 0);
}

function normalizeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

async function loadDisplayAnnotations(page) {
  if (typeof page?.getAnnotations !== 'function') {
    return [];
  }
  try {
    return await page.getAnnotations({ intent: 'display' });
  } catch {
    return [];
  }
}

// Push buttons are excluded on purpose: pdf.js renders them through its link
// element, which needs a link service this viewer does not run.
function isFillableWidgetAnnotation(annotation = {}, widgetAnnotationType = 0) {
  if (annotation.annotationType !== widgetAnnotationType) {
    return false;
  }
  if (annotation.fieldType === 'Tx' || annotation.fieldType === 'Ch') {
    return true;
  }
  return annotation.fieldType === 'Btn' && Boolean(annotation.checkBox || annotation.radioButton);
}

function getLinkAnnotationUrl(annotation = {}) {
  return normalizeHttpUrl(annotation.url || annotation.unsafeUrl || annotation.href);
}

function getLinkAnnotationRect(annotation = {}, viewport = null) {
  const rect = Array.isArray(annotation.rect) ? annotation.rect : [];
  if (!viewport || rect.length < 4 || typeof viewport.convertToViewportRectangle !== 'function') {
    return null;
  }
  const viewportRect = viewport.convertToViewportRectangle(rect);
  const left = Math.min(Number(viewportRect[0]) || 0, Number(viewportRect[2]) || 0);
  const top = Math.min(Number(viewportRect[1]) || 0, Number(viewportRect[3]) || 0);
  const width = Math.abs((Number(viewportRect[0]) || 0) - (Number(viewportRect[2]) || 0));
  const height = Math.abs((Number(viewportRect[1]) || 0) - (Number(viewportRect[3]) || 0));
  if (!Number.isFinite(left) || !Number.isFinite(top) || width <= 0 || height <= 0) {
    return null;
  }
  return { left, top, width, height };
}

function hasPdfLinkTarget(annotation = {}) {
  return Boolean(
    getLinkAnnotationUrl(annotation)
    || annotation.dest
    || annotation.action
  );
}

async function renderPageLinkLayer({
  page,
  viewport,
  record,
  annotations = null,
  onExternalLink,
  onDestination,
  onNamedAction,
  isLinkActivationEnabled = () => true,
  isStale = () => false
} = {}) {
  if (!record?.linkLayer || !page) {
    return;
  }

  record.linkLayer.innerHTML = '';
  const cssWidth = Math.max(Math.ceil(viewport.width), 1);
  const cssHeight = Math.max(Math.ceil(viewport.height), 1);
  record.linkLayer.style.width = `${cssWidth}px`;
  record.linkLayer.style.height = `${cssHeight}px`;
  record.renderedLinkScale = getViewportScale(viewport);

  const pageAnnotations = annotations || await loadDisplayAnnotations(page);
  if (isStale()) {
    return;
  }

  const doc = record.linkLayer.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc?.createElement) {
    return;
  }

  const fragment = doc.createDocumentFragment();
  pageAnnotations
    .filter(hasPdfLinkTarget)
    .forEach((annotation) => {
      const rect = getLinkAnnotationRect(annotation, viewport);
      if (!rect) {
        return;
      }

      const url = getLinkAnnotationUrl(annotation);
      const linkButton = doc.createElement('button');
      linkButton.type = 'button';
      linkButton.className = 'papers-viewer-link';
      linkButton.style.left = `${rect.left}px`;
      linkButton.style.top = `${rect.top}px`;
      linkButton.style.width = `${rect.width}px`;
      linkButton.style.height = `${rect.height}px`;
      linkButton.setAttribute('aria-label', url ? `Open external website: ${url}` : 'Open PDF link');
      linkButton.title = url || 'PDF link';
      linkButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isLinkActivationEnabled() === false) {
          return;
        }
        if (url && typeof onExternalLink === 'function') {
          void onExternalLink(url);
          return;
        }
        if (annotation.dest && typeof onDestination === 'function') {
          void onDestination(annotation.dest);
          return;
        }
        if (annotation.action && typeof onNamedAction === 'function') {
          onNamedAction(annotation.action);
        }
      });
      fragment.appendChild(linkButton);
    });

  record.linkLayer.replaceChildren(fragment);
}

async function renderPageFormLayer({
  pdfDocument,
  page,
  viewport,
  record,
  annotations = null,
  isStale = () => false
} = {}) {
  if (!record?.formLayer || !page) {
    return;
  }

  const pdfjsLib = await loadPdfJsModule();
  const pageAnnotations = annotations || await loadDisplayAnnotations(page);
  if (isStale()) {
    return;
  }

  record.formLayer.replaceChildren();
  record.renderedForms = true;
  const widgets = pageAnnotations.filter(
    (annotation) => isFillableWidgetAnnotation(annotation, pdfjsLib.AnnotationType.WIDGET)
  );
  if (!widgets.length) {
    return;
  }

  // Widget positions are percentages of the layer, which is sized from
  // --total-scale-factor, so the filled fields follow zoom without a re-render.
  const annotationLayer = new pdfjsLib.AnnotationLayer({
    div: record.formLayer,
    page,
    viewport: viewport.clone({ dontFlip: true }),
    annotationStorage: pdfDocument?.annotationStorage
  });
  try {
    await annotationLayer.render({ annotations: widgets, renderForms: true });
  } catch {
    record.formLayer.replaceChildren();
    return;
  }
  if (isStale()) {
    record.formLayer.replaceChildren();
  }
}

async function renderPageCanvasToOffscreen({
  pdfDocument,
  record,
  scale,
  outputScale = 1,
  isStale = () => false
} = {}) {
  if (!pdfDocument || !record?.canvas) {
    return null;
  }

  const page = await pdfDocument.getPage(record.pageNumber);
  if (isStale()) {
    safePageCleanup(page);
    return null;
  }

  const viewport = page.getViewport({ scale });
  const effectiveOutputScale = Math.max(Number(outputScale) || 1, 1);
  const cssWidth = Math.max(Math.ceil(viewport.width), 1);
  const cssHeight = Math.max(Math.ceil(viewport.height), 1);
  const bitmapWidth = Math.ceil(viewport.width * effectiveOutputScale);
  const bitmapHeight = Math.ceil(viewport.height * effectiveOutputScale);

  const ownerDocument = record.canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const offscreen = ownerDocument?.createElement?.('canvas');
  if (!offscreen) {
    safePageCleanup(page);
    throw new Error('Canvas element factory is unavailable.');
  }
  offscreen.width = bitmapWidth;
  offscreen.height = bitmapHeight;
  const offscreenContext = typeof offscreen.getContext === 'function'
    ? offscreen.getContext('2d', { alpha: false })
    : null;
  if (!offscreenContext) {
    safePageCleanup(page);
    throw new Error('Canvas context is unavailable.');
  }

  const pdfjsLib = await loadPdfJsModule();
  const renderTask = page.render({
    canvasContext: offscreenContext,
    viewport,
    annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS,
    transform: effectiveOutputScale === 1 ? null : [effectiveOutputScale, 0, 0, effectiveOutputScale, 0, 0]
  });
  record.renderTask = renderTask;
  try {
    await renderTask.promise;
  } finally {
    if (record.renderTask === renderTask) {
      record.renderTask = null;
    }
  }

  if (isStale()) {
    safePageCleanup(page);
    return null;
  }

  return {
    page,
    viewport,
    offscreen,
    cssWidth,
    cssHeight,
    bitmapWidth,
    bitmapHeight
  };
}

function commitOffscreenToVisibleCanvas({ record, offscreen, cssWidth, cssHeight, bitmapWidth, bitmapHeight } = {}) {
  if (!record?.canvas || !offscreen) {
    return;
  }
  // Resize the visible canvas's bitmap and draw the pre-rendered offscreen
  // bitmap in the same synchronous step. The browser does not repaint
  // between these two operations, so the user never sees the canvas blank.
  record.canvas.width = bitmapWidth;
  record.canvas.height = bitmapHeight;
  record.canvas.style.width = `${cssWidth}px`;
  record.canvas.style.height = `${cssHeight}px`;
  if (record.element) {
    record.element.style.width = `${cssWidth}px`;
    record.element.style.height = `${cssHeight}px`;
  }
  const context = typeof record.canvas.getContext === 'function'
    ? record.canvas.getContext('2d', { alpha: false })
    : null;
  if (context) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(offscreen, 0, 0);
  }
}

async function renderPageTextLayer({ page, viewport, record, isStale = () => false } = {}) {
  if (!record?.textLayer || !page) {
    return;
  }
  if (record.textLayerBuilder && typeof record.textLayerBuilder.cancel === 'function') {
    try {
      record.textLayerBuilder.cancel();
    } catch {}
    record.textLayerBuilder = null;
  }
  if (typeof record.textSelectionCleanup === 'function') {
    try {
      record.textSelectionCleanup();
    } catch {}
    record.textSelectionCleanup = null;
  }
  record.textLayer.innerHTML = '';
  const cssWidth = Math.max(Math.ceil(viewport.width), 1);
  const cssHeight = Math.max(Math.ceil(viewport.height), 1);
  record.textLayer.style.width = `${cssWidth}px`;
  record.textLayer.style.height = `${cssHeight}px`;

  const pdfjsLib = await loadPdfJsModule();
  const textContent = await page.getTextContent();
  if (isStale()) {
    return;
  }
  const textLayerBuilder = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: record.textLayer,
    viewport
  });
  record.textLayerBuilder = textLayerBuilder;
  await textLayerBuilder.render();
  if (record.textLayerBuilder === textLayerBuilder) {
    record.textLayerBuilder = null;
  }
  record.textSelectionCleanup = bindPdfTextLayerSelection(record.textLayer);
  record.renderedTextScale = getViewportScale(viewport);
}

async function renderPageTextLayerRecord({
  pdfDocument,
  record,
  scale,
  isStale = () => false
} = {}) {
  if (!pdfDocument || !record?.textLayer) {
    return;
  }
  if (record.renderedTextScale === scale && record.textLayer.childElementCount > 0) {
    return;
  }
  const page = await pdfDocument.getPage(record.pageNumber);
  if (isStale()) {
    safePageCleanup(page);
    return;
  }
  const viewport = page.getViewport({ scale });
  try {
    await renderPageTextLayer({ page, viewport, record, isStale });
  } finally {
    safePageCleanup(page);
  }
}

async function renderPageRecord({
  pdfDocument,
  record,
  scale,
  outputScale = 1,
  isStale = () => false,
  skipIfRendered = false,
  onExternalLink,
  onDestination,
  onNamedAction,
  isLinkActivationEnabled = () => true
} = {}) {
  if (!pdfDocument || !record?.canvas || !record?.element) {
    return;
  }

  const canvasAlreadyRendered = record.renderedScale === scale && record.canvas.width > 0;
  if (skipIfRendered && canvasAlreadyRendered) {
    const needsTextLayer = record.textLayer
      && (
        record.renderedTextScale !== scale
        || record.textLayer.childElementCount === 0
        || typeof record.textSelectionCleanup !== 'function'
      );
    const needsLinkLayer = record.linkLayer
      && (record.renderedLinkScale !== scale || record.linkLayer.childElementCount === 0);
    const needsFormLayer = Boolean(record.formLayer) && !record.renderedForms;
    if (needsTextLayer || needsLinkLayer || needsFormLayer) {
      const page = await pdfDocument.getPage(record.pageNumber);
      if (isStale()) {
        safePageCleanup(page);
        return;
      }
      const viewport = page.getViewport({ scale });
      try {
        if (needsTextLayer) {
          await renderPageTextLayer({ page, viewport, record, isStale });
        }
        const annotations = needsLinkLayer || needsFormLayer
          ? await loadDisplayAnnotations(page)
          : null;
        if (needsLinkLayer) {
          await renderPageLinkLayer({
            page,
            viewport,
            record,
            annotations,
            onExternalLink,
            onDestination,
            onNamedAction,
            isLinkActivationEnabled,
            isStale
          });
        }
        if (needsFormLayer) {
          await renderPageFormLayer({ pdfDocument, page, viewport, record, annotations, isStale });
        }
      } finally {
        safePageCleanup(page);
      }
    }
    return;
  }

  const result = await renderPageCanvasToOffscreen({
    pdfDocument,
    record,
    scale,
    outputScale,
    isStale
  });
  if (!result) {
    return;
  }
  const { page, viewport, offscreen, cssWidth, cssHeight, bitmapWidth, bitmapHeight } = result;

  commitOffscreenToVisibleCanvas({
    record,
    offscreen,
    cssWidth,
    cssHeight,
    bitmapWidth,
    bitmapHeight
  });

  try {
    await renderPageTextLayer({ page, viewport, record, isStale });
    const annotations = await loadDisplayAnnotations(page);
    await renderPageLinkLayer({
      page,
      viewport,
      record,
      annotations,
      onExternalLink,
      onDestination,
      onNamedAction,
      isLinkActivationEnabled,
      isStale
    });
    if (!record.renderedForms) {
      await renderPageFormLayer({ pdfDocument, page, viewport, record, annotations, isStale });
    }
  } finally {
    record.renderedScale = scale;
    safePageCleanup(page);
  }
}

export {
  isFillableWidgetAnnotation,
  loadFillableFieldPresence,
  loadPageMetrics,
  loadEmbeddedPdfMetadata,
  renderPageRecord,
  renderPageCanvasToOffscreen,
  commitOffscreenToVisibleCanvas,
  renderPageTextLayerRecord,
  renderPageLinkLayer,
  renderPageFormLayer
};
