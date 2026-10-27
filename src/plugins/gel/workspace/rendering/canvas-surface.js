// Keep the source-size preview for saving, and paint the interactive view at
// display resolution. Cropping must not enlarge the editing marks with the image.
export function createGelCanvasSurface(canvas, onResize) {
  const doc = canvas?.ownerDocument;
  const view = doc?.defaultView;
  const shell = canvas?.parentElement;
  const originalOpacity = canvas?.style?.opacity || '';
  const originalPosition = shell?.style?.position || '';
  let display = null;
  let positionedShell = false;

  function hideDisplay() {
    if (display) display.hidden = true;
    if (canvas?.style) canvas.style.opacity = originalOpacity;
  }

  function ensureDisplay() {
    if (display) return display;
    if (!doc?.createElement || !shell || !view) return null;
    const candidate = doc.createElement('canvas');
    if (!candidate.getContext('2d')) return null;
    candidate.className = 'gel-canvas-display';
    candidate.setAttribute('aria-hidden', 'true');
    Object.assign(candidate.style, { position: 'absolute', pointerEvents: 'none' });
    if (view.getComputedStyle(shell).position === 'static') {
      shell.style.position = 'relative';
      positionedShell = true;
    }
    canvas.after(candidate);
    display = candidate;
    return display;
  }

  function paint(image, drawOverlays, hidden = false) {
    const context = canvas?.getContext('2d');
    if (!context || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    context.putImageData(image, 0, 0);

    const bounds = canvas.getBoundingClientRect?.();
    const target = !hidden && bounds?.width > 0 && bounds?.height > 0 ? ensureDisplay() : null;
    let screenContext = null;
    if (target) {
      const parent = shell.getBoundingClientRect();
      const dpr = Math.min(4, Math.max(1, view.devicePixelRatio || 1));
      const width = Math.max(1, Math.round(bounds.width * dpr));
      const height = Math.max(1, Math.round(bounds.height * dpr));
      if (target.width !== width) target.width = width;
      if (target.height !== height) target.height = height;
      Object.assign(target.style, {
        left: `${bounds.left - parent.left - shell.clientLeft}px`,
        top: `${bounds.top - parent.top - shell.clientTop}px`,
        width: `${bounds.width}px`, height: `${bounds.height}px`
      });
      screenContext = target.getContext('2d');
      screenContext.setTransform(1, 0, 0, 1, 0, 0);
      screenContext.clearRect(0, 0, width, height);
      screenContext.setTransform(width / image.width, 0, 0, height / image.height, 0, 0);
      // Copy the image before drawing marks into the source-size preview.
      screenContext.drawImage(canvas, 0, 0);
      target.hidden = false;
      canvas.style.opacity = '0';
    } else hideDisplay();

    drawOverlays(context, 1);
    if (screenContext) drawOverlays(screenContext, image.width / bounds.width);
  }

  const resizeObserver = view?.ResizeObserver ? new view.ResizeObserver(onResize) : null;
  if (canvas) resizeObserver?.observe(canvas);
  view?.addEventListener('resize', onResize);

  return {
    paint,
    clear() {
      if (canvas) { canvas.width = 1; canvas.height = 1; }
      hideDisplay();
    },
    destroy() {
      resizeObserver?.disconnect();
      view?.removeEventListener('resize', onResize);
      display?.remove();
      if (canvas?.style) canvas.style.opacity = originalOpacity;
      if (positionedShell && shell.style.position === 'relative') shell.style.position = originalPosition;
    }
  };
}
