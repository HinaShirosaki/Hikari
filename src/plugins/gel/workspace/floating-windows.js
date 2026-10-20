// Window placement is presentation state. It never enters the saved gel or its
// undo history, and opening a window never changes the viewer's dimensions.
export function createFloatingWindows({ documentObject, onOpen = {}, onClose = {} }) {
  const main = documentObject.querySelector?.('.gel-main');
  const stage = documentObject.getElementById('gel-viewer-stage');
  const view = documentObject.defaultView;
  if (!main || !stage) return { open() {}, close() {}, destroy() {} };

  const layer = documentObject.createElement('div');
  layer.className = 'gel-floating-layer';
  main.append(layer);
  // The peak editor needs ~780 px, so it is the one tool that stays a window;
  // everything else lives in the rail's sections.
  const triggers = { peak: 'gel-open-peak-editor-btn' };
  const windows = new Map();
  const disposers = [];
  let order = 0;
  let drag = null;
  let destroyed = false;

  function listen(target, event, callback, options) {
    target?.addEventListener(event, callback, options);
    disposers.push(() => target?.removeEventListener(event, callback, options));
  }

  function raise(entry) {
    entry.node.style.zIndex = String(++order);
  }

  function clamp(entry, x = entry.node.offsetLeft, y = entry.node.offsetTop) {
    const { node } = entry;
    if (node.hidden) return;
    node.style.left = `${Math.max(0, Math.min(x, layer.clientWidth - node.offsetWidth))}px`;
    node.style.top = `${Math.max(0, Math.min(y, layer.clientHeight - node.offsetHeight))}px`;
    node.style.right = 'auto';
    node.style.bottom = 'auto';
  }

  function sync(entry) {
    const visible = !entry.node.hidden;
    entry.trigger?.setAttribute('aria-expanded', String(visible));
    entry.trigger?.classList.toggle('is-active', visible);
    if (visible && !entry.visible) {
      raise(entry);
      clamp(entry);
    }
    entry.visible = visible;
  }

  function open(key) {
    const entry = windows.get(key);
    if (!entry || entry.trigger?.disabled) return;
    if (onOpen[key]?.() === false) return;
    entry.node.hidden = false;
    sync(entry);
    raise(entry);
    clamp(entry);
    entry.handle?.focus({ preventScroll: true });
  }

  function close(key, restoreFocus = true) {
    const entry = windows.get(key);
    if (!entry || entry.node.hidden) return;
    if (drag?.entry === entry) endDrag();
    onClose[key]?.();
    entry.node.hidden = true;
    sync(entry);
    if (restoreFocus) entry.trigger?.focus({ preventScroll: true });
  }

  function endDrag() {
    if (!drag) return;
    const { handle, pointerId } = drag;
    drag = null;
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
  }

  main.querySelectorAll('[data-gel-window]').forEach((node) => {
    const key = node.dataset.gelWindow;
    const handle = node.querySelector('[data-gel-window-handle]');
    const trigger = documentObject.getElementById(triggers[key]);
    const entry = { node, handle, trigger, visible: false };
    windows.set(key, entry);
    layer.append(node);
    node.classList.add('gel-floating-window');
    if (handle) {
      handle.tabIndex = 0;
      handle.setAttribute('title', 'Drag to move. Use arrow keys when this title bar is focused.');
    }
    listen(trigger, 'click', () => node.hidden ? open(key) : close(key));
    listen(node, 'pointerdown', () => raise(entry));
    listen(handle, 'pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button, input, select, textarea, a')) return;
      event.preventDefault();
      endDrag();
      handle.focus({ preventScroll: true });
      drag = { entry, handle, pointerId: event.pointerId, x: event.clientX,
        y: event.clientY, left: node.offsetLeft, top: node.offsetTop };
      handle.setPointerCapture(event.pointerId);
    });
    listen(handle, 'pointermove', (event) => {
      if (drag?.entry !== entry || drag.pointerId !== event.pointerId) return;
      clamp(entry, drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((event) => listen(handle, event, endDrag));
    listen(handle, 'keydown', (event) => {
      if (event.target !== handle) return;
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!delta) return;
      event.preventDefault();
      const step = event.shiftKey ? 40 : 10;
      clamp(entry, node.offsetLeft + delta[0] * step, node.offsetTop + delta[1] * step);
    });
    node.querySelectorAll('[data-gel-window-close]').forEach((button) => listen(button, 'click', () => close(key)));
  });

  function layout() {
    if (destroyed) return;
    const bounds = main.getBoundingClientRect();
    const viewport = stage.getBoundingClientRect();
    const tablePanel = documentObject.getElementById('gel-lane-table-panel');
    const imageBounds = documentObject.getElementById('gel-image-row')?.getBoundingClientRect();
    const imageRegion = tablePanel && !tablePanel.hidden && imageBounds;
    const top = imageRegion ? imageBounds.top : viewport.top;
    const height = imageRegion ? imageBounds.height : viewport.height;
    layer.style.left = `${Math.max(0, viewport.left - bounds.left)}px`;
    layer.style.top = `${Math.max(0, top - bounds.top)}px`;
    layer.style.width = `${Math.max(0, viewport.width)}px`;
    layer.style.height = `${Math.max(0, height)}px`;
    windows.forEach((entry) => { sync(entry); clamp(entry); });
  }

  listen(main, 'keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const visible = [...windows.entries()].filter(([, entry]) => !entry.node.hidden);
    visible.sort((a, b) => Number(b[1].node.style.zIndex) - Number(a[1].node.style.zIndex));
    if (visible.length) {
      event.preventDefault();
      close(visible[0][0]);
    }
  });
  const mutationObserver = view?.MutationObserver ? new view.MutationObserver(() => {
    windows.forEach(sync);
  }) : null;
  windows.forEach(({ node }) => mutationObserver?.observe(node, { attributes: true, attributeFilter: ['hidden'] }));
  const resizeObserver = view?.ResizeObserver ? new view.ResizeObserver(layout) : null;
  resizeObserver?.observe(stage);
  resizeObserver?.observe(main);
  const imageRow = documentObject.getElementById('gel-image-row');
  if (imageRow) resizeObserver?.observe(imageRow);
  // A growing lane table pushes the image row down without resizing it, and
  // a resize observer misses pure moves; watch the table itself as well.
  const tablePanel = documentObject.getElementById('gel-lane-table-panel');
  if (tablePanel) resizeObserver?.observe(tablePanel);
  windows.forEach(({ node }) => resizeObserver?.observe(node));
  listen(view, 'resize', layout);
  layout();

  return {
    open, close,
    destroy() {
      destroyed = true;
      endDrag();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      disposers.forEach((dispose) => dispose());
      // The caller owns the markup, including the windows, after disposal.
      windows.forEach(({ node }) => main.append(node));
      layer.remove();
    }
  };
}
