import { normalizePlotElements } from '../../../../shared/assay-plot.mjs';

export function validatePlotElementAxes(elements, axes) {
  for (const element of elements) {
    const positive = (axis, value) => {
      if (axes[axis]?.type === 'log' && (!Number.isFinite(value) || value <= 0)) throw new Error('Elements on logarithmic axes need positive data coordinates.');
    };
    if (element.type === 'label' && element.coordinates === 'data') {
      positive('x', element.x); positive('y', element.y);
    } else if (element.type !== 'label') {
      positive(element.axis, element.type === 'line' ? element.value : element.start);
      if (element.type === 'band') positive(element.axis, element.end);
    }
  }
}

export function buildPlotElements(input, axes) {
  const annotations = [], shapes = [];
  for (const element of normalizePlotElements(input || [])) {
    // An axis can change after an element was created. Keep the saved element,
    // but do not place invalid coordinates on a logarithmic plot.
    try { validatePlotElementAxes([element], axes); } catch { continue; }
    const name = `assay-element-${element.id}`;
    if (element.type === 'label') {
      const paper = element.coordinates === 'plot';
      const coordinate = (axis, value) => !paper && axes[axis]?.type === 'log' ? Math.log10(value) : value;
      annotations.push({
        name, text: element.text, x: coordinate('x', element.x), y: coordinate('y', element.y),
        xref: paper ? 'paper' : 'x', yref: paper ? 'paper' : 'y',
        showarrow: element.arrow, ax: 0, ay: -30, arrowhead: 2, arrowcolor: element.color,
        font: { color: element.color, size: element.fontSize },
        xanchor: 'center', yanchor: 'middle'
      });
    } else {
      const horizontal = element.axis === 'y';
      const start = element.type === 'line' ? element.value : element.start;
      const end = element.type === 'line' ? element.value : element.end;
      shapes.push({
        name, type: element.type === 'line' ? 'line' : 'rect',
        xref: horizontal ? 'paper' : 'x', yref: horizontal ? 'y' : 'paper',
        x0: horizontal ? 0 : start, x1: horizontal ? 1 : end,
        y0: horizontal ? start : 0, y1: horizontal ? end : 1,
        ...(element.type === 'line' ? { line: { color: element.color, width: element.width, dash: element.dash } }
          : { line: { width: 0 }, fillcolor: element.color, opacity: element.opacity, layer: 'below' })
      });
    }
  }
  return { annotations, shapes };
}

export function plotElementEditPatch(event, annotations, elements, axes) {
  let changed = false;
  const next = elements.map((element) => {
    if (element.type !== 'label') return element;
    const index = annotations.findIndex((annotation) => annotation.name === `assay-element-${element.id}`);
    if (index < 0) return element;
    const patch = {};
    for (const key of ['x', 'y', 'text']) {
      const value = event?.[`annotations[${index}].${key}`];
      if (value === undefined) continue;
      patch[key] = key !== 'text' && element.coordinates === 'data' && axes[key]?.type === 'log' ? 10 ** value : value;
    }
    if (!Object.keys(patch).length) return element;
    try {
      const normalized = normalizePlotElements([{ ...element, ...patch }])[0];
      changed = true; return normalized;
    } catch { return element; }
  });
  return changed ? { plotElements: next } : {};
}
