function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// A figure owns its dimensions. The workspace is a viewport, so opening a rail
// must not change either the rendered figure or its exported size.
export function fixPlotlyFigureSize(figure = {}, previousLayout = {}) {
  const layout = ensureObject(figure.layout);
  const dimension = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  return {
    ...figure,
    layout: {
      ...layout,
      width: dimension(layout.width) ?? dimension(previousLayout.width) ?? 700,
      height: dimension(layout.height) ?? dimension(previousLayout.height) ?? 500,
      autosize: false
    },
    config: { ...ensureObject(figure.config), responsive: false }
  };
}

export function compactObject(value = {}) {
  return Object.entries(ensureObject(value)).reduce((out, [key, entryValue]) => {
    if (entryValue === undefined || entryValue === null) return out;
    if (typeof entryValue === 'string' && !entryValue) return out;
    if (Array.isArray(entryValue) && !entryValue.length) return out;
    if (entryValue && typeof entryValue === 'object' && !Array.isArray(entryValue)
      && !Object.keys(entryValue).length) return out;
    out[key] = entryValue;
    return out;
  }, {});
}

export function normalizePlotlyFigure(value = {}) {
  const source = ensureObject(value.figure || value.plotly || value);
  return compactObject({
    data: asArray(source.data || source.traces || value.data || value.traces)
      .map((trace) => ensureObject(trace))
      .filter((trace) => Object.keys(trace).length),
    layout: ensureObject(source.layout || value.layout),
    config: ensureObject(source.config || value.config),
    frames: asArray(source.frames || value.frames)
      .map((frame) => ensureObject(frame))
      .filter((frame) => Object.keys(frame).length)
  });
}
