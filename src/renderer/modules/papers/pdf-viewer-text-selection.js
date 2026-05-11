const textLayerBindings = new Map();

let globalAbortController = null;
let isPointerDown = false;
let previousRange = null;

function getLayerDocument(textLayer) {
  return textLayer?.ownerDocument || (typeof document !== 'undefined' ? document : null);
}

function getLayerWindow(textLayer) {
  return getLayerDocument(textLayer)?.defaultView || (typeof window !== 'undefined' ? window : null);
}

function resetEndOfContent(endDiv, textLayer) {
  if (!endDiv || !textLayer) {
    return;
  }
  try {
    textLayer.append(endDiv);
  } catch {}
  endDiv.style.width = '';
  endDiv.style.height = '';
  endDiv.style.userSelect = '';
  endDiv.style.webkitUserSelect = '';
  textLayer.classList.remove('selecting');
}

function resetAllTextLayers() {
  previousRange = null;
  textLayerBindings.forEach(({ endDiv }, textLayer) => {
    resetEndOfContent(endDiv, textLayer);
  });
}

function getRangeAnchor({ range, modifyStart, doc }) {
  let anchor = modifyStart ? range.startContainer : range.endContainer;
  if (anchor?.nodeType === doc.TEXT_NODE) {
    anchor = anchor.parentNode;
  }
  if (anchor?.classList?.contains('highlight')) {
    anchor = anchor.parentNode;
  }
  if (!anchor || anchor.nodeType !== doc.ELEMENT_NODE) {
    return null;
  }
  if (!modifyStart && range.endOffset === 0) {
    do {
      while (anchor && !anchor.previousSibling) {
        anchor = anchor.parentNode;
      }
      anchor = anchor?.previousSibling || null;
    } while (anchor && !anchor.childNodes.length);
  }
  return anchor?.nodeType === doc.ELEMENT_NODE ? anchor : anchor?.parentElement || null;
}

function moveEndOfContentToRangeEdge({ selection, doc, win }) {
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  let modifyStart = false;
  try {
    modifyStart = Boolean(previousRange && (
      range.compareBoundaryPoints(win.Range.END_TO_END, previousRange) === 0
      || range.compareBoundaryPoints(win.Range.START_TO_END, previousRange) === 0
    ));
  } catch {
    modifyStart = false;
  }

  const anchor = getRangeAnchor({ range, modifyStart, doc });
  const parentTextLayer = anchor?.parentElement?.closest?.('.papers-viewer-text-layer, .textLayer') || null;
  const binding = parentTextLayer ? textLayerBindings.get(parentTextLayer) : null;
  if (!binding?.endDiv || !parentTextLayer?.contains(anchor)) {
    previousRange = range.cloneRange();
    return;
  }

  const endDiv = binding.endDiv;
  endDiv.style.width = parentTextLayer.style.width || `${parentTextLayer.offsetWidth || 0}px`;
  endDiv.style.height = parentTextLayer.style.height || `${parentTextLayer.offsetHeight || 0}px`;
  endDiv.style.userSelect = 'text';
  endDiv.style.webkitUserSelect = 'text';
  try {
    anchor.parentElement.insertBefore(endDiv, modifyStart ? anchor : anchor.nextSibling);
  } catch {
    parentTextLayer.append(endDiv);
  }
  previousRange = range.cloneRange();
}

function ensureGlobalSelectionListener(textLayer) {
  if (globalAbortController || !textLayerBindings.size) {
    return;
  }
  const doc = getLayerDocument(textLayer);
  const win = getLayerWindow(textLayer);
  const AbortControllerRef = win?.AbortController || globalThis.AbortController;
  if (!doc?.addEventListener || !win?.addEventListener || !AbortControllerRef) {
    return;
  }

  globalAbortController = new AbortControllerRef();
  const { signal } = globalAbortController;
  const isFirefox = /firefox/i.test(String(win.navigator?.userAgent || ''));

  doc.addEventListener('pointerdown', () => {
    isPointerDown = true;
  }, { signal });
  doc.addEventListener('pointerup', () => {
    isPointerDown = false;
    resetAllTextLayers();
  }, { signal });
  win.addEventListener('blur', () => {
    isPointerDown = false;
    resetAllTextLayers();
  }, { signal });
  doc.addEventListener('keyup', () => {
    if (!isPointerDown) {
      resetAllTextLayers();
    }
  }, { signal });
  doc.addEventListener('selectionchange', () => {
    const selection = doc.getSelection?.();
    if (!selection || selection.rangeCount === 0) {
      resetAllTextLayers();
      return;
    }

    const activeTextLayers = new Set();
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      textLayerBindings.forEach((_, textLayerDiv) => {
        try {
          if (!activeTextLayers.has(textLayerDiv) && range.intersectsNode(textLayerDiv)) {
            activeTextLayers.add(textLayerDiv);
          }
        } catch {}
      });
    }

    textLayerBindings.forEach(({ endDiv }, textLayerDiv) => {
      if (activeTextLayers.has(textLayerDiv)) {
        textLayerDiv.classList.add('selecting');
      } else {
        resetEndOfContent(endDiv, textLayerDiv);
      }
    });

    if (!isFirefox) {
      moveEndOfContentToRangeEdge({ selection, doc, win });
    }
  }, { signal });
}

export function bindPdfTextLayerSelection(textLayer) {
  if (!textLayer?.ownerDocument?.createElement) {
    return () => {};
  }

  textLayerBindings.get(textLayer)?.cleanup?.();

  const doc = getLayerDocument(textLayer);
  const win = getLayerWindow(textLayer);
  const AbortControllerRef = win?.AbortController || globalThis.AbortController;
  const layerAbortController = AbortControllerRef ? new AbortControllerRef() : null;
  const endDiv = doc.createElement('div');
  endDiv.className = 'endOfContent';
  textLayer.append(endDiv);

  const handleMouseDown = () => {
    textLayer.classList.add('selecting');
  };
  if (layerAbortController) {
    textLayer.addEventListener('mousedown', handleMouseDown, { signal: layerAbortController.signal });
  } else {
    textLayer.addEventListener('mousedown', handleMouseDown);
  }

  const cleanup = () => {
    layerAbortController?.abort();
    textLayer.removeEventListener?.('mousedown', handleMouseDown);
    textLayerBindings.delete(textLayer);
    endDiv.remove();
    textLayer.classList.remove('selecting');
    if (textLayerBindings.size === 0) {
      globalAbortController?.abort();
      globalAbortController = null;
      isPointerDown = false;
      previousRange = null;
    }
  };

  textLayerBindings.set(textLayer, { endDiv, cleanup });
  ensureGlobalSelectionListener(textLayer);
  return cleanup;
}
