import { createPresentation } from './i18n.mjs';
import { clearTextBounds, componentSvgSource, element, scene } from './artwork.mjs';

const i18nUi = createPresentation('figura');
const ZOOM_BUTTON_FACTOR = 1.4;
const ZOOM_WHEEL_SENSITIVITY = 0.004;

// Editing view only: canvas units, persisted scenes and previews never change.
function createCanvasViewport(onChange) {
  const views = new Map();
  const view = stage => {
    if (!views.has(stage)) views.set(stage, { zoom: null, scale: 1 });
    return views.get(stage);
  };
  function layout(stage) {
    const svg = stage.querySelector('svg'); if (!svg) return;
    const box = stage.getBoundingClientRect(), css = getComputedStyle(stage);
    const width = box.width - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    const height = box.height - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
    if (width <= 0 || height <= 0) return;
    const current = view(stage), canvas = svg.viewBox.baseVal;
    current.scale = current.zoom ?? Math.min(width / canvas.width, height / canvas.height);
    svg.style.width = `${canvas.width * current.scale}px`;
    svg.style.height = `${canvas.height * current.scale}px`;
    if (current.zoom === null) { stage.scrollLeft = 0; stage.scrollTop = 0; }
    onChange(stage, current);
  }
  function zoom(stage, factor, anchor) {
    const svg = stage.querySelector('svg'), matrix = svg?.getScreenCTM();
    if (!matrix) return;
    const box = stage.getBoundingClientRect();
    const center = anchor ?? { x: box.left + stage.clientWidth / 2, y: box.top + stage.clientHeight / 2 };
    const point = new DOMPoint(center.x, center.y).matrixTransform(matrix.inverse());
    const current = view(stage);
    current.zoom = Math.min(8, Math.max(0.1, current.scale * factor));
    layout(stage);
    const moved = point.matrixTransform(svg.getScreenCTM());
    stage.scrollLeft += moved.x - center.x;
    stage.scrollTop += moved.y - center.y;
  }
  return { layout, zoom, get: view,
    fit(stage) { view(stage).zoom = null; layout(stage); },
    reset() { views.clear(); }
  };
}

function drawTicks(marks, horizontal, origin, scale, length, thickness) {
  // Choose a round label interval with at least 50 screen pixels between labels.
  const target = 50 / scale, power = 10 ** Math.floor(Math.log10(target));
  const multiple = [1, 2, 5, 10].find(value => value * power >= target);
  const divisions = multiple === 2 ? 4 : 5;
  const step = multiple * power / divisions, spacing = step * scale;
  const ticks = [], labels = [];
  for (let index = Math.ceil(-origin / spacing); index <= Math.floor((length - origin) / spacing); index++) {
    const offset = origin + index * spacing, major = index % divisions === 0;
    const depth = major ? 6 : 3;
    ticks.push(horizontal ? `M${offset} ${thickness - depth}v${depth}` : `M${thickness - depth} ${offset}h${depth}`);
    if (!major) continue;
    const value = String(index * step), margin = value.length * 3;
    if (offset < margin || offset > length - margin) continue;
    const anchor = { 'text-anchor': 'middle' };
    labels.push(element('text', horizontal ? { ...anchor, x: offset, y: thickness - 8 }
      : { ...anchor, transform: `translate(${thickness - 8} ${offset}) rotate(-90)` }, value));
  }
  marks.replaceChildren(element('path', { d: ticks.join(' '), fill: 'none' }), ...labels);
}

function createCanvasRulers(stage) {
  const window = stage.ownerDocument.defaultView;
  const axes = [...stage.parentElement.querySelectorAll('[data-ruler-axis]')].map(ruler => ({
    ruler, horizontal: ruler.dataset.rulerAxis === 'x', marks: ruler.querySelector('.canvas-ruler-marks'),
    cursor: ruler.querySelector('.canvas-ruler-cursor'), geometry: []
  }));
  let frame = 0, pointer = null;
  function render() {
    frame = 0;
    const matrix = stage.querySelector(':scope > svg')?.getScreenCTM();
    const bounds = stage.getBoundingClientRect(), width = stage.clientWidth, height = stage.clientHeight;
    const x = pointer ? pointer.x - bounds.left : -1, y = pointer ? pointer.y - bounds.top : -1;
    const showCursor = matrix && x >= 0 && x < width && y >= 0 && y < height && !stage.inert;
    for (const axis of axes) {
      const { horizontal, ruler, marks, cursor } = axis;
      cursor.toggleAttribute('hidden', !showCursor);
      if (!matrix || !width || !height) continue;
      const origin = horizontal ? matrix.e - bounds.left : matrix.f - bounds.top;
      const scale = horizontal ? matrix.a : matrix.d;
      const length = horizontal ? width : height;
      const thickness = horizontal ? ruler.clientHeight : ruler.clientWidth;
      const geometry = [origin, scale, length, thickness];
      if (scale > 0 && thickness > 0 && geometry.some((value, index) => value !== axis.geometry[index])) {
        drawTicks(marks, horizontal, ...geometry);
        axis.geometry = geometry;
      }
      if (showCursor) cursor.setAttribute('d', horizontal ? `M${x} 0V${thickness}` : `M0 ${y}H${thickness}`);
    }
  }
  function update() {
    if (!frame) frame = window.requestAnimationFrame(render);
  }
  function track(event) {
    if (!event.isPrimary || event.pointerType === 'touch') return;
    pointer = { x: event.clientX, y: event.clientY };
    update();
  }
  function clear() { pointer = null; update(); }
  stage.addEventListener('pointerenter', track);
  stage.addEventListener('pointermove', track);
  stage.addEventListener('pointerleave', clear);
  stage.addEventListener('pointercancel', clear);
  stage.addEventListener('scroll', update, { passive: true });
  window.addEventListener('blur', clear);
  return { update };
}

// Keep decoded artwork across selection redraws and moves. Sampling one source
// pixel avoids retaining a full RGBA copy of every large generated component.
function createArtworkHitTester() {
  const cache = new Map();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = false;

  function prepare(objects) {
    const active = new Set();
    for (const object of objects) {
      if (!object.visible || object.opacity <= 0 || object.type === 'text') continue;
      active.add(object.id);
      const key = object.type === 'raster' ? object.dataUrl
        : JSON.stringify([object.svg, object.width, object.height, object.fill, object.stroke, object.strokeWidth]);
      if (cache.get(object.id)?.key === key) continue;
      const image = new Image(), entry = { key, image, ready: false };
      image.onload = () => { entry.ready = true; };
      image.src = object.type === 'raster' ? object.dataUrl
        : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(componentSvgSource(object))}`;
      cache.set(object.id, entry);
    }
    for (const id of cache.keys()) if (!active.has(id)) cache.delete(id);
  }

  function painted(object, group, event) {
    if (!object || !object.visible || object.opacity <= 0) return false;
    // Text keeps its tight typographic target, including spaces between glyphs.
    if (object.type === 'text') return true;
    const entry = cache.get(object.id), matrix = group.getScreenCTM();
    if (!entry?.ready || !matrix) return false;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    if (point.x < 0 || point.y < 0 || point.x >= object.width || point.y >= object.height) return false;
    const { image } = entry;
    const x = Math.floor(point.x / object.width * image.naturalWidth);
    const y = Math.floor(point.y / object.height * image.naturalHeight);
    context.clearRect(0, 0, 1, 1);
    context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[3] > 0;
  }

  function hit(stage, objects, event, { handles = true } = {}) {
    const seen = new Set(), byId = new Map(objects.map(object => [object.id, object]));
    // DOM order preserves the actual stacking and SVG transforms at any zoom.
    for (const node of document.elementsFromPoint(event.clientX, event.clientY)) {
      if (!stage.contains(node)) continue;
      const target = node.closest('[data-object-id], [data-resize-id], [data-rotate-id], [data-move-id]');
      if (!target || seen.has(target)) continue;
      seen.add(target);
      if (target.dataset.objectId) {
        if (painted(byId.get(target.dataset.objectId), target, event)) return target;
      } else if (handles) return target;
    }
    return null;
  }

  return { prepare, hit };
}

export function createCanvasView({ document, getContext, getDrag, isInteracting, renderSelectionRegion, onZoom, onLayout, onRender, onScroll }) {
  const $ = id => document.getElementById(id);
  const stage = $('main-canvas');
  const artworkHitTester = createArtworkHitTester();

  function syncSelectionSize(stage) {
    const svg = stage.querySelector('svg'), handles = svg?.querySelectorAll('.resize-handle');
    const matrix = svg?.getScreenCTM();
    if (!handles?.length || !matrix || !stage.getBoundingClientRect().width) return;
    const scale = Math.hypot(matrix.a, matrix.b); if (!scale) return;
    const size = 9 / scale;
    for (const handle of handles) {
      handle.setAttribute('width', size); handle.setAttribute('height', size);
      handle.setAttribute('x', Number(handle.dataset.cornerX) - size / 2);
      handle.setAttribute('y', Number(handle.dataset.cornerY) - size / 2);
    }
    const frame = svg.querySelector('.selection'), rotate = frame?.querySelector('.rotation-handle');
    if (!rotate) return;
    const w = Number(frame.dataset.selectionWidth), h = Number(frame.dataset.selectionHeight), gap = 28 / scale;
    const frameMatrix = frame.getScreenCTM(), area = stage.getBoundingClientRect(), margin = 13;
    const candidates = [[w / 2, -gap, w / 2, 0], [w / 2, h + gap, w / 2, h],
      [w + gap, h / 2, w, h / 2], [-gap, h / 2, 0, h / 2], [w / 2, gap, w / 2, 0]];
    const drag = getDrag();
    let placement = drag?.rotating && drag.canvas === stage.dataset.canvas ? drag.handlePlacement : undefined;
    if (!placement) placement = candidates.find(([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(frameMatrix);
      return p.x >= area.left + margin && p.x <= area.left + stage.clientWidth - margin
        && p.y >= area.top + margin && p.y <= area.top + stage.clientHeight - margin;
    });
    if (!placement) {
      const p = new DOMPoint(...candidates[0].slice(0, 2)).matrixTransform(frameMatrix);
      const clamped = new DOMPoint(Math.max(area.left + margin, Math.min(area.left + stage.clientWidth - margin, p.x)),
        Math.max(area.top + margin, Math.min(area.top + stage.clientHeight - margin, p.y))).matrixTransform(frameMatrix.inverse());
      placement = [clamped.x, clamped.y, w / 2, 0];
    }
    const [x, y, anchorX, anchorY] = placement, stem = frame.querySelector('.rotation-stem');
    rotate.setAttribute('transform', `translate(${x} ${y})`); rotate.dataset.placement = JSON.stringify(placement);
    rotate.querySelector('.rotation-hit').setAttribute('r', 12 / scale);
    rotate.querySelector('.rotation-knob').setAttribute('r', 6 / scale);
    for (const [key, value] of Object.entries({ x1: anchorX, y1: anchorY, x2: x, y2: y })) stem.setAttribute(key, value);
  }
  function renderZoom() {
    const view = viewport.get(stage);
    i18nUi.setAttribute($('canvas-zoom'), "aria-label", i18nUi.message("Canvas zoom"));
    i18nUi.setText($('zoom-level'), `${Math.round(view.scale * 100)}%`);
    $('zoom-out').disabled = view.scale <= 0.1;
    $('zoom-in').disabled = view.scale >= 8;
    $('zoom-fit').setAttribute('aria-pressed', String(view.zoom === null));
    onZoom();
  }
  const canvasRulers = createCanvasRulers(stage);
  const viewport = createCanvasViewport(stage => {
    syncSelectionSize(stage); renderZoom(); onLayout(); canvasRulers.update();
  });
  function renderCanvas(canvas, documentState = getContext().state) {
    const { selectedIds, editingGroupId } = getContext();
    const selectedId = selectedIds[0] || '';
    const drag = getDrag();
    const focusedId = document.activeElement?.dataset.objectId,
      focusedRotation = document.activeElement?.dataset.rotateId;
    const pan = { x: stage.scrollLeft, y: stage.scrollTop };
    artworkHitTester.prepare(documentState.objects.filter(object => object.canvas === canvas));
    stage.replaceChildren(scene(documentState, canvas, { interactive: true, selectedId: selectedIds.length === 1 ? selectedId : '', selectedIds }));
    if (editingGroupId) {
      for (const object of stage.querySelectorAll(':scope > svg > [data-object-id]')) {
        if (object.dataset.groupId !== editingGroupId) object.setAttribute('tabindex', '-1');
      }
    }
    stage.classList.toggle('is-rotating', Boolean(drag?.rotating && drag.canvas === canvas));
    viewport.layout(stage);
    if (viewport.get(stage).zoom !== null) { stage.scrollLeft = pan.x; stage.scrollTop = pan.y; }
    syncSelectionSize(stage);
    if (focusedId && selectedIds.includes(focusedId)) stage.querySelector(`[data-object-id="${focusedId}"]`)?.focus({ preventScroll: true });
    if (focusedRotation) stage.querySelector(`[data-rotate-id="${focusedRotation}"]`)?.focus({ preventScroll: true });
    renderSelectionRegion();
    renderSmartGuides(stage);
    onLayout();
    onRender();
  }

  function renderSmartGuides(stage) {
    const drag = getDrag();
    if (!drag?.guides?.length || drag.canvas !== stage.dataset.canvas) return;
    const svg = stage.querySelector('svg'), matrix = svg.getScreenCTM(), scale = Math.hypot(matrix.a, matrix.b);
    const overlay = element('g', { class: 'smart-guides', 'pointer-events': 'none', 'aria-hidden': 'true' });
    const line = (guide, from, to, cross) => {
      const horizontal = guide.axis === 'x';
      overlay.append(element('line', { class: `smart-guide-${guide.kind}`, 'vector-effect': 'non-scaling-stroke',
        x1: horizontal ? from : cross, y1: horizontal ? cross : from,
        x2: horizontal ? to : cross, y2: horizontal ? cross : to }));
    };
    for (const guide of drag.guides) {
      if (guide.kind === 'alignment') {
        // An x alignment is a vertical line, and vice versa.
        line({ ...guide, axis: guide.axis === 'x' ? 'y' : 'x' }, guide.from, guide.to, guide.value);
        continue;
      }
      for (const { from, to } of guide.segments) {
        line(guide, from, to, guide.cross);
        for (const value of [from, to]) line({ ...guide, axis: guide.axis === 'x' ? 'y' : 'x' }, guide.cross - 4 / scale, guide.cross + 4 / scale, value);
        const horizontal = guide.axis === 'x';
        overlay.append(element('text', { class: 'smart-guide-label', 'font-size': 11 / scale, 'stroke-width': 3 / scale,
          'text-anchor': horizontal ? 'middle' : 'start',
          x: horizontal ? (from + to) / 2 : guide.cross + 6 / scale,
          y: horizontal ? guide.cross - 5 / scale : (from + to) / 2 }, String(Math.round((to - from) * 10) / 10)));
      }
    }
    svg.append(overlay);
  }
  document.fonts.addEventListener('loadingdone', () => {
    clearTextBounds();
    if (getContext().state && !isInteracting()) renderCanvas('main');
  });
  for (const [id, factor] of [['zoom-out', 1 / ZOOM_BUTTON_FACTOR], ['zoom-in', ZOOM_BUTTON_FACTOR]]) {
    $(id).addEventListener('click', () => {
      if (isInteracting()) return;
      const selectedId = getContext().selectedIds[0] || '';
      const object = stage.querySelector(`[data-object-id="${selectedId}"]`), box = object?.getBoundingClientRect();
      const area = stage.getBoundingClientRect();
      const visible = box && box.right > area.left && box.left < area.right && box.bottom > area.top && box.top < area.bottom;
      viewport.zoom(stage, factor, visible ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined);
      if (visible) {
        const resized = object.getBoundingClientRect(), margin = 10;
        if (resized.width + margin * 2 <= stage.clientWidth) {
          if (resized.left < area.left + margin) stage.scrollLeft -= area.left + margin - resized.left;
          else if (resized.right > area.left + stage.clientWidth - margin) stage.scrollLeft += resized.right - area.left - stage.clientWidth + margin;
        }
        if (resized.height + margin * 2 <= stage.clientHeight) {
          if (resized.top < area.top + margin) stage.scrollTop -= area.top + margin - resized.top;
          else if (resized.bottom > area.top + stage.clientHeight - margin) stage.scrollTop += resized.bottom - area.top - stage.clientHeight + margin;
        }
      }
    });
  }
  $('zoom-fit').addEventListener('click', () => { if (!isInteracting()) viewport.fit(stage); });
  const pendingCanvasFits = new Set();
  let canvasFitFrame = 0;
  const canvasObserver = new ResizeObserver(entries => {
    entries.forEach(({ target }) => pendingCanvasFits.add(target));
    if (canvasFitFrame) return;
    // Fit on the next frame, outside ResizeObserver's layout delivery cycle.
    canvasFitFrame = requestAnimationFrame(() => {
      canvasFitFrame = 0;
      pendingCanvasFits.forEach(stage => viewport.layout(stage)); pendingCanvasFits.clear();
    });
  });
  canvasObserver.observe(stage);
  stage.addEventListener('scroll', () => { syncSelectionSize(stage); onScroll(); }, { passive: true });
  stage.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (!getContext().state || isInteracting()) return;
    const delta = Math.max(-100, Math.min(100, event.deltaY));
    viewport.zoom(stage, Math.exp(-delta * ZOOM_WHEEL_SENSITIVITY), { x: event.clientX, y: event.clientY });
  }, { passive: false });

  return {
    render: renderCanvas,
    renderZoom,
    reset: viewport.reset,
    hit: (event, options) => artworkHitTester.hit(stage, getContext().state.objects, event, options)
  };
}
