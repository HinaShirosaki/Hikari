// Editing view only: canvas units, persisted scenes and previews never change.
export function createCanvasViewport(onChange) {
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
