// Result windows stay anchored within the image stage. Opening a window never
// changes the viewer's dimensions or the saved gel and its undo history.
export function createFloatingWindows({ documentObject, onOpen = {}, onClose = {} }) {
  const main = documentObject.querySelector?.('.gel-main');
  const stage = documentObject.getElementById('gel-viewer-stage');
  const view = documentObject.defaultView;
  if (!main || !stage) return { open() {}, close() {}, closeAll() {}, destroy() {} };

  const layer = documentObject.createElement('div');
  layer.className = 'gel-floating-layer';
  main.append(layer);
  // Band results may overlap the docked lane table; a thin image row must not
  // reduce the graph and table to a title bar. The peak editor keeps its bounds.
  const intensityLayer = documentObject.createElement('div');
  intensityLayer.className = 'gel-floating-layer gel-floating-layer--intensity';
  main.append(intensityLayer);
  const triggers = { peak: 'gel-open-peak-editor-btn', intensity: 'gel-open-band-intensity-btn' };
  const windows = new Map();
  const disposers = [];
  let order = 0;
  let destroyed = false;

  function listen(target, event, callback, options) {
    target?.addEventListener(event, callback, options);
    disposers.push(() => target?.removeEventListener(event, callback, options));
  }

  function raise(entry) {
    entry.node.style.zIndex = String(++order);
    entry.layer.style.zIndex = String(5 + order);
  }

  function position(entry) {
    const { node, layer: bounds } = entry;
    if (node.hidden) return;
    node.style.left = `${Math.max(0, Math.min(12, bounds.clientWidth - node.offsetWidth))}px`;
    node.style.top = `${Math.max(0, Math.min(12, bounds.clientHeight - node.offsetHeight))}px`;
    node.style.right = 'auto';
    node.style.bottom = 'auto';
  }

  function sync(entry) {
    const visible = !entry.node.hidden;
    entry.trigger?.setAttribute('aria-expanded', String(visible));
    entry.trigger?.classList.toggle('is-active', visible);
    if (visible && !entry.visible) {
      raise(entry);
      position(entry);
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
    position(entry);
    entry.header?.focus({ preventScroll: true });
  }

  function close(key, restoreFocus = true) {
    const entry = windows.get(key);
    if (!entry || entry.node.hidden) return;
    onClose[key]?.();
    entry.node.hidden = true;
    sync(entry);
    if (restoreFocus) entry.trigger?.focus({ preventScroll: true });
  }

  main.querySelectorAll('[data-gel-window]').forEach((node) => {
    const key = node.dataset.gelWindow;
    const header = node.querySelector('[data-gel-window-header]');
    const trigger = documentObject.getElementById(triggers[key]);
    const entry = { node, header, trigger, visible: false, layer: key === 'intensity' ? intensityLayer : layer };
    windows.set(key, entry);
    entry.layer.append(node);
    node.classList.add('gel-floating-window');
    if (header) header.tabIndex = -1;
    listen(trigger, 'click', () => node.hidden ? open(key) : close(key));
    listen(node, 'pointerdown', () => raise(entry));
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
    intensityLayer.style.left = `${Math.max(0, viewport.left - bounds.left)}px`;
    intensityLayer.style.top = `${Math.max(0, viewport.top - bounds.top)}px`;
    intensityLayer.style.width = `${Math.max(0, viewport.width)}px`;
    intensityLayer.style.height = `${Math.max(0, viewport.height)}px`;
    windows.forEach((entry) => { sync(entry); position(entry); });
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
    closeAll() { windows.forEach((_entry, key) => close(key, false)); },
    destroy() {
      destroyed = true;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      disposers.forEach((dispose) => dispose());
      // The caller owns the markup, including the windows, after disposal.
      windows.forEach(({ node }) => main.append(node));
      layer.remove();
      intensityLayer.remove();
    }
  };
}
