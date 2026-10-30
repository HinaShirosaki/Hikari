import { clampMapZoom } from './sequence-map.js';

// Pointer-anchored zoom gestures for a sequence map, shared by the Vector
// Builder workspace and the library preview.
//
// Zoom scales the SVG's layout box inside a scrolling host rather than
// transforming it. Panning is then native scrolling, and because the viewBox
// never changes, resolveBaseFromPoint stays exact at any zoom or scroll offset.
const ZOOM_WHEEL_SENSITIVITY = 0.0025;

export function attachMapZoomGestures(config = {}) {
  const resolveHost = typeof config?.host === 'function' ? config.host : () => config?.host || null;
  const getZoom = typeof config?.getZoom === 'function' ? config.getZoom : () => 1;
  const setZoom = typeof config?.setZoom === 'function' ? config.setZoom : () => {};

  // Re-applied after every render, since redrawing the map replaces the SVG.
  function apply() {
    const svg = resolveHost()?.querySelector?.('svg');
    if (!svg?.style) {
      return;
    }
    const percent = `${(clampMapZoom(getZoom()) * 100).toFixed(2)}%`;
    svg.style.width = percent;
    svg.style.height = percent;
  }

  // Anchoring on the SVG's own transform rather than on the box's growth ratio.
  // The map is sized as a percentage of the host's content box, and scrollbars
  // appearing changes both that box and its aspect -- which, under
  // preserveAspectRatio, rescales and re-centres the drawing inside the box by a
  // different factor than the box itself grew. Round-tripping a viewBox point
  // through the browser's own matrix sidesteps all of that.
  function toViewBoxPoint(svg, clientX, clientY) {
    if (typeof svg?.getScreenCTM !== 'function' || typeof svg?.createSVGPoint !== 'function') {
      return null;
    }
    const matrix = svg.getScreenCTM();
    if (!matrix || typeof matrix.inverse !== 'function') {
      return null;
    }
    const point = svg.createSVGPoint();
    point.x = Number(clientX) || 0;
    point.y = Number(clientY) || 0;
    return point.matrixTransform(matrix.inverse());
  }

  function toClientPoint(svg, viewBoxPoint) {
    const matrix = svg?.getScreenCTM?.();
    if (!matrix || !viewBoxPoint) {
      return null;
    }
    const point = svg.createSVGPoint();
    point.x = viewBoxPoint.x;
    point.y = viewBoxPoint.y;
    return point.matrixTransform(matrix);
  }

  function zoomBy(factor, pointer = null) {
    const host = resolveHost();
    const previous = clampMapZoom(getZoom());
    const next = clampMapZoom(previous * (Number(factor) || 1));
    if (next === previous) {
      return;
    }

    const svg = host?.querySelector?.('svg') || null;
    const anchor = pointer ? toViewBoxPoint(svg, pointer.x, pointer.y) : null;

    setZoom(next);
    apply();

    if (!anchor) {
      return;
    }
    const moved = toClientPoint(svg, anchor);
    if (!moved) {
      return;
    }
    host.scrollLeft = Math.max(0, host.scrollLeft + (moved.x - pointer.x));
    host.scrollTop = Math.max(0, host.scrollTop + (moved.y - pointer.y));
  }

  function reset() {
    setZoom(1);
    apply();
    const host = resolveHost();
    if (host) {
      host.scrollLeft = 0;
      host.scrollTop = 0;
    }
  }

  function bind() {
    const host = resolveHost();
    if (!host?.addEventListener) {
      return;
    }

    // Trackpad pinch arrives as a wheel event with ctrlKey set (Chromium
    // synthesises it); Ctrl/Cmd+wheel is the mouse equivalent. A plain wheel is
    // left alone so it pans the zoomed map by scrolling.
    host.addEventListener('wheel', (event) => {
      if (!event?.ctrlKey && !event?.metaKey) {
        return;
      }
      event.preventDefault?.();
      const delta = Number(event.deltaY) || 0;
      if (!delta) {
        return;
      }
      zoomBy(Math.exp(-delta * ZOOM_WHEEL_SENSITIVITY), { x: event.clientX, y: event.clientY });
    }, { passive: false });

    host.addEventListener('dblclick', (event) => {
      if (event.target?.closest?.('[data-feature-index]')) {
        return;
      }
      event.preventDefault?.();
      reset();
    });
  }

  return { apply, bind, reset, zoomBy };
}
