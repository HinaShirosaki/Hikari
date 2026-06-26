const MIN_SELECTION_SIZE = 10;
const MAX_IMAGE_EDGE = 1600;
const MAX_DATA_URL_LENGTH = 380000;

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(Math.max(numeric, min), max);
}

function dataUrlSize(dataUrl = '') {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  if (!base64) {
    return 0;
  }
  const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function sanitizeNamePart(value = '', fallback = 'paper') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    || fallback;
}

function getSelectionRect(startPoint, currentPoint) {
  const left = Math.min(startPoint.x, currentPoint.x);
  const top = Math.min(startPoint.y, currentPoint.y);
  return {
    left,
    top,
    width: Math.abs(currentPoint.x - startPoint.x),
    height: Math.abs(currentPoint.y - startPoint.y)
  };
}

function preventCaptureEvent(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  event?.stopImmediatePropagation?.();
}

export const installPdfViewerScreenshotSelectionController = (ctx) => {
  const { elements, state } = ctx;
  const { shell, pageLayer } = elements;

  function getPageRecordFromEvent(event) {
    const pageElement = event?.target?.closest?.('.papers-viewer-page') || null;
    if (!pageElement || !pageLayer?.contains?.(pageElement)) {
      return null;
    }
    return state.pageRecords.find((record) => record?.element === pageElement) || null;
  }

  function getLocalPoint(record, event) {
    const rect = record?.element?.getBoundingClientRect?.();
    const width = Math.max(Number(rect?.width) || 0, 1);
    const height = Math.max(Number(rect?.height) || 0, 1);
    return {
      x: clamp((Number(event?.clientX) || 0) - (Number(rect?.left) || 0), 0, width),
      y: clamp((Number(event?.clientY) || 0) - (Number(rect?.top) || 0), 0, height)
    };
  }

  function createSelectionBox(record) {
    const doc = record?.element?.ownerDocument || ctx.getDocumentRef?.();
    if (!doc?.createElement || !record?.element) {
      return null;
    }
    const box = doc.createElement('div');
    box.className = 'papers-viewer-screenshot-selection';
    record.element.appendChild(box);
    return box;
  }

  function removeSelectionBox(selection = state.screenshotSelection) {
    const box = selection?.box || null;
    if (box?.parentNode) {
      box.parentNode.removeChild(box);
    }
  }

  function renderSelectionBox() {
    const selection = state.screenshotSelection;
    if (!selection?.box) {
      return;
    }
    const rect = getSelectionRect(selection.startPoint, selection.currentPoint);
    selection.box.style.left = `${Math.round(rect.left)}px`;
    selection.box.style.top = `${Math.round(rect.top)}px`;
    selection.box.style.width = `${Math.round(rect.width)}px`;
    selection.box.style.height = `${Math.round(rect.height)}px`;
  }

  function setScreenshotSelectionMode(active) {
    state.screenshotSelectionMode = Boolean(active);
    shell?.classList?.toggle('is-screenshot-selecting', state.screenshotSelectionMode);
  }

  function resolveScreenshotSelection(result) {
    const resolver = state.screenshotSelectionResolver;
    state.screenshotSelectionResolver = null;
    if (typeof resolver === 'function') {
      resolver(result);
    }
  }

  function finishScreenshotSelection(result) {
    removeSelectionBox();
    state.screenshotSelection = null;
    setScreenshotSelectionMode(false);
    resolveScreenshotSelection(result);
  }

  function cancelScreenshotSelection(options = {}) {
    const message = String(options.error || 'Paper screenshot selection canceled.').trim();
    finishScreenshotSelection({
      ok: false,
      cancelled: true,
      error: message
    });
    if (!options.silent) {
      ctx.setStatus(message);
    }
  }

  function buildCroppedDataUrl({ record, rect } = {}) {
    const sourceCanvas = record?.canvas || null;
    if (!sourceCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
      return null;
    }

    const pageRect = record.element?.getBoundingClientRect?.();
    const cssWidth = Math.max(Number(pageRect?.width) || Number(sourceCanvas.style?.width?.replace('px', '')) || 0, 1);
    const cssHeight = Math.max(Number(pageRect?.height) || Number(sourceCanvas.style?.height?.replace('px', '')) || 0, 1);
    const sourceScaleX = sourceCanvas.width / cssWidth;
    const sourceScaleY = sourceCanvas.height / cssHeight;
    const sx = Math.round(clamp(rect.left * sourceScaleX, 0, sourceCanvas.width - 1));
    const sy = Math.round(clamp(rect.top * sourceScaleY, 0, sourceCanvas.height - 1));
    const sw = Math.round(clamp(rect.width * sourceScaleX, 1, sourceCanvas.width - sx));
    const sh = Math.round(clamp(rect.height * sourceScaleY, 1, sourceCanvas.height - sy));
    const baseScale = Math.min(1, MAX_IMAGE_EDGE / Math.max(sw, sh));
    const doc = sourceCanvas.ownerDocument || ctx.getDocumentRef?.();
    if (!doc?.createElement) {
      return null;
    }

    const drawCrop = (scale, mimeType = 'image/png', quality) => {
      const targetCanvas = doc.createElement('canvas');
      targetCanvas.width = Math.max(1, Math.round(sw * scale));
      targetCanvas.height = Math.max(1, Math.round(sh * scale));
      const targetContext = targetCanvas.getContext?.('2d', { alpha: false });
      if (!targetContext) {
        return null;
      }
      targetContext.fillStyle = '#ffffff';
      targetContext.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
      targetContext.imageSmoothingEnabled = true;
      targetContext.imageSmoothingQuality = 'high';
      targetContext.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, targetCanvas.width, targetCanvas.height);
      return {
        dataUrl: targetCanvas.toDataURL(mimeType, quality),
        width: targetCanvas.width,
        height: targetCanvas.height,
        mimeType
      };
    };

    let output = drawCrop(baseScale, 'image/png');
    if (output?.dataUrl && output.dataUrl.length <= MAX_DATA_URL_LENGTH) {
      return output;
    }

    const jpegAttempts = [
      { scale: baseScale, quality: 0.92 },
      { scale: baseScale * 0.82, quality: 0.86 },
      { scale: baseScale * 0.68, quality: 0.82 },
      { scale: baseScale * 0.54, quality: 0.78 }
    ];
    for (const attempt of jpegAttempts) {
      output = drawCrop(Math.max(0.25, attempt.scale), 'image/jpeg', attempt.quality);
      if (output?.dataUrl && output.dataUrl.length <= MAX_DATA_URL_LENGTH) {
        return output;
      }
    }
    return output;
  }

  function buildAttachmentFromSelection(selection) {
    const rect = getSelectionRect(selection.startPoint, selection.currentPoint);
    const crop = buildCroppedDataUrl({ record: selection.record, rect });
    if (!crop?.dataUrl) {
      return null;
    }
    const pageNumber = Math.max(1, Math.round(Number(selection.record?.pageNumber) || state.pageNumber || 1));
    const extension = crop.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const name = `${sanitizeNamePart(state.paperTitle || 'paper')}-page-${pageNumber}-crop.${extension}`;
    return {
      kind: 'image',
      name,
      mimeType: crop.mimeType,
      size: dataUrlSize(crop.dataUrl),
      dataUrl: crop.dataUrl,
      source: 'paper-region',
      paperId: String(state.paperId || '').trim(),
      paperTitle: String(state.paperTitle || '').trim(),
      pageNumber,
      width: crop.width,
      height: crop.height
    };
  }

  function completeScreenshotSelection() {
    const selection = state.screenshotSelection;
    if (!selection) {
      return;
    }
    const rect = getSelectionRect(selection.startPoint, selection.currentPoint);
    if (rect.width < MIN_SELECTION_SIZE || rect.height < MIN_SELECTION_SIZE) {
      removeSelectionBox(selection);
      state.screenshotSelection = null;
      ctx.setStatus('Drag a larger area of the paper to capture a screenshot.');
      return;
    }
    const attachment = buildAttachmentFromSelection(selection);
    if (!attachment) {
      finishScreenshotSelection({
        ok: false,
        error: 'Unable to capture that paper region.'
      });
      ctx.setStatus('Unable to capture that paper region.', true);
      return;
    }
    finishScreenshotSelection({
      ok: true,
      attachment
    });
    ctx.setStatus(`Captured page ${attachment.pageNumber} screenshot.`);
  }

  function startPaperScreenshotSelection() {
    if (!ctx.hasActiveDocument?.()) {
      return Promise.resolve({
        ok: false,
        error: 'Open a paper before selecting a screenshot.'
      });
    }
    if (state.screenshotSelectionMode) {
      cancelScreenshotSelection({ silent: true });
    }
    ctx.clearSelection?.();
    ctx.hideSelectionSearchPopover?.();
    ctx.hideHighlightCommentPopover?.();
    setScreenshotSelectionMode(true);
    ctx.setStatus('Drag over a visible page to attach a paper screenshot.');
    return new Promise((resolve) => {
      state.screenshotSelectionResolver = resolve;
    });
  }

  function handleScreenshotPointerDown(event) {
    if (!state.screenshotSelectionMode || Number(event?.button) > 0) {
      return;
    }
    preventCaptureEvent(event);
    const record = getPageRecordFromEvent(event);
    if (!record?.canvas || record.canvas.width <= 0 || record.canvas.height <= 0) {
      ctx.setStatus('Wait for the page to finish rendering, then drag over the paper.');
      return;
    }
    removeSelectionBox();
    const point = getLocalPoint(record, event);
    state.screenshotSelection = {
      record,
      pointerId: event.pointerId,
      startPoint: point,
      currentPoint: point,
      box: createSelectionBox(record)
    };
    renderSelectionBox();
    try {
      pageLayer?.setPointerCapture?.(event.pointerId);
    } catch {}
  }

  function handleScreenshotPointerMove(event) {
    const selection = state.screenshotSelection;
    if (!state.screenshotSelectionMode || !selection || event?.pointerId !== selection.pointerId) {
      return;
    }
    preventCaptureEvent(event);
    selection.currentPoint = getLocalPoint(selection.record, event);
    renderSelectionBox();
  }

  function handleScreenshotPointerUp(event) {
    const selection = state.screenshotSelection;
    if (!state.screenshotSelectionMode || !selection || event?.pointerId !== selection.pointerId) {
      return;
    }
    preventCaptureEvent(event);
    selection.currentPoint = getLocalPoint(selection.record, event);
    try {
      pageLayer?.releasePointerCapture?.(event.pointerId);
    } catch {}
    completeScreenshotSelection();
  }

  function handleScreenshotClick(event) {
    if (!state.screenshotSelectionMode) {
      return;
    }
    preventCaptureEvent(event);
  }

  function handleScreenshotKeydown(event) {
    if (!state.screenshotSelectionMode || event?.key !== 'Escape') {
      return;
    }
    preventCaptureEvent(event);
    cancelScreenshotSelection();
  }

  function handleScreenshotWindowBlur() {
    if (!state.screenshotSelectionMode) {
      return;
    }
    cancelScreenshotSelection();
  }

  pageLayer?.addEventListener('pointerdown', handleScreenshotPointerDown, true);
  pageLayer?.addEventListener('pointermove', handleScreenshotPointerMove, true);
  pageLayer?.addEventListener('pointerup', handleScreenshotPointerUp, true);
  pageLayer?.addEventListener('click', handleScreenshotClick, true);
  ctx.getDocumentRef?.()?.addEventListener?.('keydown', handleScreenshotKeydown, true);
  ctx.getWindowRef?.()?.addEventListener?.('pointermove', handleScreenshotPointerMove, true);
  ctx.getWindowRef?.()?.addEventListener?.('pointerup', handleScreenshotPointerUp, true);
  ctx.getWindowRef?.()?.addEventListener?.('blur', handleScreenshotWindowBlur);

  Object.assign(ctx, {
    cancelScreenshotSelection,
    startPaperScreenshotSelection
  });
};
