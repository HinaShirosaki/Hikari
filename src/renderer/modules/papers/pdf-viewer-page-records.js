export function cancelAllRenderTasks(pageRecords = []) {
  pageRecords.forEach((record) => {
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
  });
}

export function releasePageRecords({ pageLayer, pageRecords = [] } = {}) {
  cancelAllRenderTasks(pageRecords);
  if (pageLayer) {
    pageLayer.innerHTML = '';
  }
}

export function ensurePageRecords({ pageLayer, pageMetrics = [] } = {}) {
  if (!pageLayer) {
    return [];
  }

  const doc = pageLayer.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc?.createElement) {
    return [];
  }

  pageLayer.innerHTML = '';
  const fragment = doc.createDocumentFragment();
  const records = pageMetrics.map((metric, index) => {
    const pageNumber = index + 1;
    const pageElement = doc.createElement('div');
    pageElement.className = 'papers-viewer-page';
    pageElement.dataset.pageNumber = String(pageNumber);

    const canvas = doc.createElement('canvas');
    canvas.className = 'papers-viewer-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    const highlightLayer = doc.createElement('div');
    highlightLayer.className = 'papers-viewer-highlight-layer';
    highlightLayer.dataset.pageNumber = String(pageNumber);
    highlightLayer.setAttribute('aria-hidden', 'true');

    const textLayer = doc.createElement('div');
    textLayer.className = 'papers-viewer-text-layer';
    textLayer.dataset.pageNumber = String(pageNumber);

    const overlay = doc.createElement('div');
    overlay.className = 'papers-viewer-overlay';
    overlay.dataset.pageNumber = String(pageNumber);
    overlay.setAttribute('aria-label', `Paper page ${pageNumber} comment pins`);

    pageElement.append(canvas, highlightLayer, textLayer, overlay);
    fragment.appendChild(pageElement);

    return {
      pageNumber,
      metric,
      element: pageElement,
      canvas,
      highlightLayer,
      textLayer,
      overlay,
      renderTask: null,
      textLayerBuilder: null,
      renderedScale: 0
    };
  });
  pageLayer.appendChild(fragment);
  return records;
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
  });
}
