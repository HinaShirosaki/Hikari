// The selection binding belongs to the text layer's DOM, not to a render task.
// Only call this where the spans themselves go away: dropping the binding while
// they survive makes renderPageRecord believe the layer still needs building, and
// the rebuild wipes the spans a live selection is anchored in.
function releaseTextSelectionBinding(record) {
  if (typeof record?.textSelectionCleanup !== 'function') {
    return;
  }
  try {
    record.textSelectionCleanup();
  } catch {}
  record.textSelectionCleanup = null;
}

function cancelPageRecordRenderTasks(record) {
  if (!record) {
    return;
  }
  if (!record?.renderTask || typeof record.renderTask.cancel !== 'function') {
    record.renderTask = null;
  } else {
    try {
      record.renderTask.cancel();
    } catch {}
    record.renderTask = null;
  }
  if (!record?.textLayerBuilder || typeof record.textLayerBuilder.cancel !== 'function') {
    record.textLayerBuilder = null;
    return;
  }
  try {
    record.textLayerBuilder.cancel();
  } catch {}
  record.textLayerBuilder = null;
}

export function cancelAllRenderTasks(pageRecords = []) {
  pageRecords.forEach((record) => {
    cancelPageRecordRenderTasks(record);
  });
}

export function clearPageRecordRender(record, {
  clearText = true,
  clearLinks = true,
  clearForms = true
} = {}) {
  if (!record) {
    return;
  }
  cancelPageRecordRenderTasks(record);
  if (record.canvas) {
    record.canvas.width = 0;
    record.canvas.height = 0;
  }
  record.renderedScale = 0;
  if (clearText && record.textLayer) {
    releaseTextSelectionBinding(record);
    record.textLayer.innerHTML = '';
    record.renderedTextScale = 0;
  }
  if (clearLinks && record.linkLayer) {
    record.linkLayer.innerHTML = '';
    record.renderedLinkScale = 0;
  }
  // Typed values live in the document's annotationStorage, so dropping the
  // inputs here is safe: re-rendering the layer restores what the user filled.
  if (clearForms && record.formLayer) {
    record.formLayer.innerHTML = '';
    record.renderedForms = false;
  }
}

export function clearPageRecordsOutsideRange({
  pageRecords = [],
  firstPageNumber = 1,
  lastPageNumber = 1
} = {}) {
  const first = Math.max(1, Math.round(Number(firstPageNumber) || 1));
  const last = Math.max(first, Math.round(Number(lastPageNumber) || first));
  pageRecords.forEach((record) => {
    const pageNumber = Math.max(1, Math.round(Number(record?.pageNumber) || 1));
    if (pageNumber < first || pageNumber > last) {
      clearPageRecordRender(record);
    }
  });
}

export function releasePageRecords({ pageLayer, pageRecords = [] } = {}) {
  cancelAllRenderTasks(pageRecords);
  pageRecords.forEach(releaseTextSelectionBinding);
  if (pageLayer) {
    pageLayer.innerHTML = '';
  }
}

export function buildPageRecords({ doc, pageMetrics = [], onCanvasContextLost = null } = {}) {
  if (!doc?.createElement) {
    return [];
  }

  return pageMetrics.map((metric, index) => {
    const pageNumber = index + 1;
    const pageWidth = Math.max(Number(metric?.width) || 0, 1);
    const pageHeight = Math.max(Number(metric?.height) || 0, 1);
    const pageElement = doc.createElement('div');
    pageElement.className = 'papers-viewer-page';
    pageElement.dataset.pageNumber = String(pageNumber);
    pageElement.dataset.pageWidth = String(pageWidth);
    pageElement.dataset.pageHeight = String(pageHeight);

    const canvas = doc.createElement('canvas');
    canvas.className = 'papers-viewer-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    const highlightLayer = doc.createElement('div');
    highlightLayer.className = 'papers-viewer-highlight-layer';
    highlightLayer.dataset.pageNumber = String(pageNumber);
    highlightLayer.dataset.pageWidth = String(pageWidth);
    highlightLayer.dataset.pageHeight = String(pageHeight);
    highlightLayer.setAttribute('aria-hidden', 'true');

    const textLayer = doc.createElement('div');
    textLayer.className = 'papers-viewer-text-layer textLayer';
    textLayer.dataset.pageNumber = String(pageNumber);
    textLayer.dataset.pageWidth = String(pageWidth);
    textLayer.dataset.pageHeight = String(pageHeight);

    const linkLayer = doc.createElement('div');
    linkLayer.className = 'papers-viewer-link-layer';
    linkLayer.dataset.pageNumber = String(pageNumber);
    linkLayer.dataset.pageWidth = String(pageWidth);
    linkLayer.dataset.pageHeight = String(pageHeight);
    linkLayer.setAttribute('aria-label', `Paper page ${pageNumber} links`);

    const formLayer = doc.createElement('div');
    formLayer.className = 'papers-viewer-form-layer';
    formLayer.dataset.pageNumber = String(pageNumber);
    formLayer.dataset.pageWidth = String(pageWidth);
    formLayer.dataset.pageHeight = String(pageHeight);
    formLayer.setAttribute('aria-label', `Paper page ${pageNumber} form fields`);

    const overlay = doc.createElement('div');
    overlay.className = 'papers-viewer-overlay';
    overlay.dataset.pageNumber = String(pageNumber);
    overlay.dataset.pageWidth = String(pageWidth);
    overlay.dataset.pageHeight = String(pageHeight);
    overlay.setAttribute('aria-label', `Paper page ${pageNumber} comment pins`);

    pageElement.append(canvas, highlightLayer, textLayer, linkLayer, formLayer, overlay);

    const record = {
      pageNumber,
      metric,
      element: pageElement,
      canvas,
      highlightLayer,
      textLayer,
      linkLayer,
      formLayer,
      overlay,
      renderTask: null,
      textLayerBuilder: null,
      textSelectionCleanup: null,
      renderedScale: 0,
      renderedTextScale: 0,
      renderedLinkScale: 0,
      renderedForms: false
    };

    // The browser can drop a 2D canvas backing store under memory pressure. The
    // canvas keeps its size, so the "already rendered" check would skip it, and
    // an alpha:false canvas paints solid black until something redraws it.
    if (typeof onCanvasContextLost === 'function') {
      const handleContextLoss = () => onCanvasContextLost(record);
      canvas.addEventListener('contextlost', handleContextLoss);
      canvas.addEventListener('contextrestored', handleContextLoss);
    }

    return record;
  });
}

export function attachPageRecords({ pageLayer, pageRecords = [] } = {}) {
  if (!pageLayer || !pageRecords.length) {
    if (pageLayer) {
      pageLayer.innerHTML = '';
    }
    return;
  }
  const doc = pageLayer.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc?.createDocumentFragment) {
    pageLayer.innerHTML = '';
    pageRecords.forEach((record) => {
      if (record?.element) {
        pageLayer.appendChild(record.element);
      }
    });
    return;
  }
  const fragment = doc.createDocumentFragment();
  pageRecords.forEach((record) => {
    if (record?.element) {
      fragment.appendChild(record.element);
    }
  });
  pageLayer.replaceChildren(fragment);
}

export function applyPageSizing({ pageRecords = [], scale } = {}) {
  pageRecords.forEach((record) => {
    const width = Math.max(Math.ceil((record.metric?.width || 1) * scale), 1);
    const height = Math.max(Math.ceil((record.metric?.height || 1) * scale), 1);
    record.element.style.setProperty('--total-scale-factor', String(scale));
    record.element.style.setProperty('--scale-round-x', '1px');
    record.element.style.setProperty('--scale-round-y', '1px');
    record.element.style.width = `${width}px`;
    record.element.style.height = `${height}px`;
    record.canvas.style.width = `${width}px`;
    record.canvas.style.height = `${height}px`;
    if (record.textLayer) {
      record.textLayer.style.setProperty('--total-scale-factor', String(scale));
    }
    if (record.linkLayer) {
      record.linkLayer.style.width = `${width}px`;
      record.linkLayer.style.height = `${height}px`;
    }
  });
}
