import { EMPTY_PAPER_PDF_METADATA, extractPaperPdfMetadata } from './pdf-metadata.js';
import { loadPdfJsModule } from './pdf-viewer-loader.js';

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

function safePageCleanup(page) {
  if (typeof page?.cleanup === 'function') {
    try {
      page.cleanup();
    } catch {}
  }
}

async function renderPageRecord({
  pdfDocument,
  record,
  scale,
  outputScale = 1,
  isStale = () => false
} = {}) {
  if (!pdfDocument || !record?.canvas || !record?.element) {
    return;
  }

  const page = await pdfDocument.getPage(record.pageNumber);
  if (isStale()) {
    safePageCleanup(page);
    return;
  }

  const viewport = page.getViewport({ scale });
  const effectiveOutputScale = Math.max(Number(outputScale) || 1, 1);
  const context = typeof record.canvas.getContext === 'function'
    ? record.canvas.getContext('2d', { alpha: false })
    : null;
  if (!context) {
    throw new Error('Canvas context is unavailable.');
  }

  const cssWidth = Math.max(Math.ceil(viewport.width), 1);
  const cssHeight = Math.max(Math.ceil(viewport.height), 1);
  if (record.textLayerBuilder && typeof record.textLayerBuilder.cancel === 'function') {
    try {
      record.textLayerBuilder.cancel();
    } catch {}
    record.textLayerBuilder = null;
  }
  if (record.textLayer) {
    record.textLayer.innerHTML = '';
    record.textLayer.style.width = `${cssWidth}px`;
    record.textLayer.style.height = `${cssHeight}px`;
  }
  record.canvas.width = Math.ceil(viewport.width * effectiveOutputScale);
  record.canvas.height = Math.ceil(viewport.height * effectiveOutputScale);
  record.canvas.style.width = `${cssWidth}px`;
  record.canvas.style.height = `${cssHeight}px`;
  record.element.style.width = `${cssWidth}px`;
  record.element.style.height = `${cssHeight}px`;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, record.canvas.width, record.canvas.height);

  const renderTask = page.render({
    canvasContext: context,
    viewport,
    transform: effectiveOutputScale === 1 ? null : [effectiveOutputScale, 0, 0, effectiveOutputScale, 0, 0]
  });
  record.renderTask = renderTask;
  await renderTask.promise;
  if (record.renderTask === renderTask) {
    record.renderTask = null;
  }

  if (isStale()) {
    safePageCleanup(page);
    return;
  }

  if (record.textLayer) {
    const pdfjsLib = await loadPdfJsModule();
    const textContent = await page.getTextContent();
    if (isStale()) {
      safePageCleanup(page);
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
  }
  record.renderedScale = scale;
  safePageCleanup(page);
}

export { loadPageMetrics, loadEmbeddedPdfMetadata, renderPageRecord };
