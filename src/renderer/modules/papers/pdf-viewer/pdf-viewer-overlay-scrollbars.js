// The app styles every scrollbar as a classic one that takes layout width, and
// Chromium has no CSS overlay scrollbar, so the stage hides its native bars and
// these thumbs float over the pages instead (macOS style: shown while scrolling).
const MIN_THUMB = 36;
const FADE_MS = 900;

export function attachOverlayScrollbars(stage, content = null) {
  const host = stage?.parentElement;
  const doc = stage?.ownerDocument;
  if (!host || !doc) {
    return () => {};
  }
  let fadeTimer = 0;

  const thumbs = ['y', 'x'].map((axis) => {
    const element = doc.createElement('div');
    element.className = `papers-viewer-scroll-thumb is-${axis}`;
    element.setAttribute('aria-hidden', 'true');
    element.hidden = true;
    host.append(element);
    return { axis, element, size: 0 };
  });

  const metrics = (axis) => (axis === 'y'
    ? { view: stage.clientHeight, content: stage.scrollHeight, key: 'scrollTop' }
    : { view: stage.clientWidth, content: stage.scrollWidth, key: 'scrollLeft' });

  // Runs on every scroll frame: read everything first, then write only
  // size (when it changes) and transform, so it never forces a layout.
  function update() {
    const measured = thumbs.map((thumb) => {
      const { view, content, key } = metrics(thumb.axis);
      return { view, content, position: stage[key] };
    });
    thumbs.forEach((thumb, index) => {
      const { view, content, position } = measured[index];
      const { element } = thumb;
      const hidden = content <= view + 1;
      if (element.hidden !== hidden) {
        element.hidden = hidden;
      }
      if (hidden) {
        return;
      }
      const size = Math.round(Math.max((view * view) / content, MIN_THUMB));
      if (size !== thumb.size) {
        thumb.size = size;
        element.style[thumb.axis === 'y' ? 'height' : 'width'] = `${size}px`;
      }
      const offset = ((view - size) * position) / (content - view);
      element.style.transform = thumb.axis === 'y' ? `translateY(${offset}px)` : `translateX(${offset}px)`;
    });
  }

  function flash() {
    host.classList.add('is-scrolling');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => host.classList.remove('is-scrolling'), FADE_MS);
  }

  function handleScroll() {
    update();
    flash();
  }

  thumbs.forEach((thumb) => {
    thumb.element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const { view, content, key } = metrics(thumb.axis);
      const start = thumb.axis === 'y' ? event.clientY : event.clientX;
      const startScroll = stage[key];
      const ratio = (content - view) / Math.max(view - thumb.size, 1);
      try {
        thumb.element.setPointerCapture(event.pointerId);
      } catch {}
      thumb.element.classList.add('is-dragging');
      const move = (moveEvent) => {
        stage[key] = startScroll + (((thumb.axis === 'y' ? moveEvent.clientY : moveEvent.clientX) - start) * ratio);
      };
      const end = () => {
        thumb.element.classList.remove('is-dragging');
        thumb.element.removeEventListener('pointermove', move);
        thumb.element.removeEventListener('pointerup', end);
        thumb.element.removeEventListener('pointercancel', end);
      };
      thumb.element.addEventListener('pointermove', move);
      thumb.element.addEventListener('pointerup', end);
      thumb.element.addEventListener('pointercancel', end);
    });
  });

  stage.addEventListener('scroll', handleScroll, { passive: true });
  // Zoom and page loads change the content size without always scrolling.
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
  observer?.observe(stage);
  if (content) {
    observer?.observe(content);
  }
  update();

  return () => {
    clearTimeout(fadeTimer);
    observer?.disconnect();
    stage.removeEventListener('scroll', handleScroll);
    thumbs.forEach((thumb) => thumb.element.remove());
  };
}
