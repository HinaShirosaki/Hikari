'use strict';

const { asArray, cloneJson, ensureObject } = require('../../lib/normalize.js');

const PLOTLY_GRAPH_ACTIONS = Object.freeze([
  'create',
  'read',
  'list',
  'update',
  'inspect',
  'delete',
  'clear'
]);

const MAX_NAME_LENGTH = 160;
const MAX_SOURCE_LENGTH = 1200;
const MAX_TRACES = 80;
const MAX_FRAMES = 80;

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function compactObject(value = {}) {
  return Object.entries(ensureObject(value)).reduce((out, [key, entryValue]) => {
    if (entryValue === undefined || entryValue === null) {
      return out;
    }
    if (typeof entryValue === 'string' && !entryValue) {
      return out;
    }
    if (Array.isArray(entryValue) && !entryValue.length) {
      return out;
    }
    if (entryValue && typeof entryValue === 'object' && !Array.isArray(entryValue) && !Object.keys(entryValue).length) {
      return out;
    }
    out[key] = entryValue;
    return out;
  }, {});
}

function mergeObjects(baseValue = {}, patchValue = {}) {
  const base = cloneJson(baseValue, {});
  const patch = ensureObject(patchValue);
  Object.entries(patch).forEach(([key, value]) => {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && base[key]
      && typeof base[key] === 'object'
      && !Array.isArray(base[key])
    ) {
      base[key] = mergeObjects(base[key], value);
      return;
    }
    base[key] = cloneJson(value, value);
  });
  return base;
}

function toFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isBlankCell(value) {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

// Plate data reaches the model as TSV text, so doses and results arrive as strings.
// Plotly reads "0.1" as a category label: the axis loses its spacing and a log scale is
// ignored. Convert an array only when every entry is numeric or blank, so genuine
// category labels (sample names, conditions, well ids) survive untouched.
function coerceNumericArray(values) {
  if (!Array.isArray(values)) {
    return values;
  }
  if (values.some((value) => Array.isArray(value))) {
    return values.map((value) => (Array.isArray(value) ? coerceNumericArray(value) : value));
  }
  const out = values.map((value) => (isBlankCell(value) ? null : (toFiniteNumber(value) ?? value)));
  const allNumeric = out.every((value) => value === null || typeof value === 'number');
  const changed = out.some((value, index) => value !== values[index]);
  return allNumeric && changed ? out : values;
}

function traceType(trace = {}) {
  return cleanText(trace.type, 40) || 'scatter';
}

function numericArray(values) {
  return Array.isArray(values) && values.length > 1
    && values.every((value) => typeof value === 'number' && Number.isFinite(value));
}

function isAscending(values = []) {
  return values.every((value, index) => index === 0 || values[index - 1] <= value);
}

function drawsLines(trace = {}) {
  const mode = cleanText(trace.mode, 80).toLowerCase();
  return mode.includes('lines') || (!mode && ['scatter', 'scattergl'].includes(traceType(trace)));
}

function axisIsCategory(layout = {}, prefix = 'x', axisRef = '') {
  const suffix = cleanText(axisRef, 20).replace(/^[xy]/iu, '');
  const axis = ensureObject(ensureObject(layout)[`${prefix}axis${suffix}`]);
  return cleanText(axis.type, 40).toLowerCase() === 'category';
}

// Per-point channels other than x/y: any array as long as x carries one entry per point,
// so a sort has to permute them all together or error bars and hover labels end up on the
// wrong point. These keys are the same length by coincidence rather than per point.
const NON_POINT_ARRAY_KEYS = new Set([
  'colorbar',
  'colorscale',
  'dimensions',
  'selectedpoints',
  'tickvals',
  'ticktext',
  'transforms'
]);

function permuteInPlace(target, order, depth = 0) {
  if (!target || typeof target !== 'object' || depth > 3) {
    return;
  }
  Object.entries(target).forEach(([key, value]) => {
    if (NON_POINT_ARRAY_KEYS.has(key)) {
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === order.length) {
        target[key] = order.map((index) => value[index]);
      }
      return;
    }
    if (value && typeof value === 'object') {
      permuteInPlace(value, order, depth + 1);
    }
  });
}

// A line joins points in array order, so plate rows read out column-wise draw a zig-zag
// across the dose axis that looks like real structure. Sort the whole trace by x.
function sortTraceByX(trace = {}) {
  if (!drawsLines(trace) || !numericArray(trace.x) || isAscending(trace.x)) {
    return trace;
  }
  if (Array.isArray(trace.selectedpoints)) {
    return trace;
  }
  const order = trace.x
    .map((_value, index) => index)
    .sort((left, right) => trace.x[left] - trace.x[right]);
  const out = cloneJson(trace, null);
  if (!out) {
    return trace;
  }
  permuteInPlace(out, order);
  return out;
}

function normalizeTrace(trace = {}, layout = {}, { index = 0, notes = [] } = {}) {
  const out = { ...ensureObject(trace) };
  if (Array.isArray(out.x) && !axisIsCategory(layout, 'x', out.xaxis)) {
    out.x = coerceNumericArray(out.x);
  }
  if (Array.isArray(out.y) && !axisIsCategory(layout, 'y', out.yaxis)) {
    out.y = coerceNumericArray(out.y);
  }
  if (Array.isArray(out.z)) {
    out.z = coerceNumericArray(out.z);
  }
  ['error_x', 'error_y'].forEach((key) => {
    if (!out[key] || typeof out[key] !== 'object' || Array.isArray(out[key])) {
      return;
    }
    const error = { ...out[key] };
    if (Array.isArray(error.array)) {
      error.array = coerceNumericArray(error.array);
    }
    if (Array.isArray(error.arrayminus)) {
      error.arrayminus = coerceNumericArray(error.arrayminus);
    }
    out[key] = error;
  });
  const sorted = sortTraceByX(out);
  if (sorted !== out) {
    notes.push(`Trace ${index + 1} points were reordered by ascending x so the line reads as a series.`);
  }
  return sorted;
}

function normalizeFigure(input = {}, notes = []) {
  const source = ensureObject(input.figure || input.plotly || input);
  const layout = ensureObject(source.layout || input.layout);
  return {
    data: asArray(source.data || source.traces || input.data || input.traces)
      .map((trace, index) => normalizeTrace(trace, layout, { index, notes }))
      .slice(0, MAX_TRACES),
    layout,
    config: ensureObject(source.config || input.config),
    frames: asArray(source.frames || input.frames).map((frame) => ensureObject(frame)).slice(0, MAX_FRAMES)
  };
}

function axisTitle(axis = {}) {
  const source = ensureObject(axis);
  if (typeof source.title === 'string') {
    return cleanText(source.title, 220);
  }
  return cleanText(ensureObject(source.title).text, 220);
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function inspectTrace(trace = {}, index = 0) {
  const type = traceType(trace);
  const issues = [];
  if (['scatter', 'bar', 'scattergl'].includes(type)) {
    const xLength = arrayLength(trace.x);
    const yLength = arrayLength(trace.y);
    if (!xLength && !yLength) {
      issues.push(`trace ${index + 1} (${type}) has no x or y arrays.`);
    } else if (xLength && yLength && xLength !== yLength) {
      issues.push(`trace ${index + 1} x/y lengths differ (${xLength} vs ${yLength}).`);
    }
  }
  if (type === 'box' && !arrayLength(trace.y) && !arrayLength(trace.x)) {
    issues.push(`trace ${index + 1} (box) has no x or y values.`);
  }
  if ((type === 'heatmap' || type === 'contour') && !arrayLength(trace.z)) {
    issues.push(`trace ${index + 1} (${type}) has no z matrix.`);
  }
  // Error bars are positional: a replicate SD array that is a different length than the
  // means silently attaches SDs to the wrong conditions.
  ['error_x', 'error_y'].forEach((key) => {
    const error = ensureObject(trace[key]);
    const valueLength = arrayLength(key === 'error_x' ? trace.x : trace.y);
    if (Array.isArray(error.array) && valueLength && error.array.length !== valueLength) {
      issues.push(`trace ${index + 1} ${key}.array has ${error.array.length} value(s) but ${key === 'error_x' ? 'x' : 'y'} has ${valueLength}.`);
    }
  });
  // A line joins points in array order, so an unsorted dose or time axis draws a zig-zag
  // that looks like real structure.
  if (drawsLines(trace) && numericArray(trace.x) && !isAscending(trace.x)) {
    issues.push(`trace ${index + 1} draws a line but its x values are not in ascending order.`);
  }
  return {
    type,
    name: cleanText(trace.name, 220),
    x_length: arrayLength(trace.x),
    y_length: arrayLength(trace.y),
    z_length: arrayLength(trace.z),
    mode: cleanText(trace.mode, 80),
    issues
  };
}

function inspectFigure(figure = {}) {
  const data = asArray(figure.data);
  const layout = ensureObject(figure.layout);
  const traceSummaries = data.map(inspectTrace);
  const issueRows = traceSummaries.flatMap((trace) => trace.issues);
  const traceTypes = traceSummaries.reduce((out, trace) => {
    out[trace.type] = Number(out[trace.type] || 0) + 1;
    return out;
  }, {});
  const title = axisTitle({ title: layout.title });
  const xTitle = axisTitle(layout.xaxis);
  const yTitle = axisTitle(layout.yaxis);
  if (!data.length) {
    issueRows.push('figure has no traces in data.');
  }
  if (!title) {
    issueRows.push('layout.title.text is missing.');
  }
  if (data.length && !xTitle && !ensureObject(layout.xaxis).type) {
    issueRows.push('xaxis title/type is not specified.');
  }
  if (data.length && !yTitle && !ensureObject(layout.yaxis).type) {
    issueRows.push('yaxis title/type is not specified.');
  }
  // A log axis drops non-positive values without an error, which is exactly how a
  // zero-dose or vehicle control disappears from a dose-response plot.
  ['x', 'y'].forEach((axis) => {
    if (cleanText(ensureObject(layout[`${axis}axis`]).type, 40).toLowerCase() !== 'log') {
      return;
    }
    const nonPositive = data.reduce((count, trace) => (
      count + asArray(trace[axis]).filter((value) => typeof value === 'number' && value <= 0).length
    ), 0);
    if (nonPositive) {
      issueRows.push(`${axis}axis is log scaled but ${nonPositive} value(s) are zero or negative and will not plot.`);
    }
  });
  const suggestions = [];
  if (!title) {
    suggestions.push('Set layout.title.text to a short assay-specific title.');
  }
  if (!xTitle) {
    suggestions.push('Set layout.xaxis.title.text to the independent variable or grouping field.');
  }
  if (!yTitle) {
    suggestions.push('Set layout.yaxis.title.text to the measured response and unit.');
  }
  if (data.some((trace) => trace.error_y && !trace.error_y.visible)) {
    suggestions.push('Set error_y.visible=true when showing SD/SEM error bars.');
  }
  if (data.length > 1 && data.some((trace) => !cleanText(trace.name, 220))) {
    suggestions.push('Name every trace so the legend identifies each condition.');
  }
  if (issueRows.some((issue) => issue.includes('ascending order'))) {
    suggestions.push('Sort the rows by x and reorder y plus any error arrays together before updating the trace.');
  }
  if (issueRows.some((issue) => issue.includes('log scaled'))) {
    suggestions.push('Drop or separately annotate zero/vehicle controls instead of putting them on a log axis.');
  }
  return {
    trace_count: data.length,
    trace_types: traceTypes,
    traces: traceSummaries,
    layout_title: title,
    xaxis_title: xTitle,
    yaxis_title: yTitle,
    has_legend: layout.showlegend !== false && data.length > 1,
    issues: issueRows,
    suggestions
  };
}

function serializeGraph(graph = {}, options = {}) {
  const includeFigure = options.includeFigure !== false;
  const figure = {
    data: asArray(graph.data),
    layout: ensureObject(graph.layout),
    config: ensureObject(graph.config),
    frames: asArray(graph.frames)
  };
  return compactObject({
    id: cleanText(graph.id, 40),
    name: cleanText(graph.name, MAX_NAME_LENGTH),
    source: cleanText(graph.source, MAX_SOURCE_LENGTH),
    created_at: cleanText(graph.created_at, 80),
    updated_at: cleanText(graph.updated_at, 80),
    inspection: inspectFigure(figure),
    ...(includeFigure ? { figure: cloneJson(figure, {}) } : {})
  });
}

function createAgentPlotlyGraphRuntime(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const graphs = new Map();
  let nextId = 1;

  function allocateId() {
    const id = String(nextId);
    nextId += 1;
    return id;
  }

  function findByName(name = '') {
    const normalized = cleanText(name, MAX_NAME_LENGTH).toLowerCase();
    if (!normalized) {
      return null;
    }
    for (const graph of graphs.values()) {
      if (cleanText(graph.name, MAX_NAME_LENGTH).toLowerCase() === normalized) {
        return graph;
      }
    }
    return null;
  }

  function resolveGraph(input = {}) {
    const id = cleanText(input.id || input.graph_id || input.graphId, 40);
    if (id && graphs.has(id)) {
      return graphs.get(id);
    }
    const name = cleanText(input.name || input.graph_name || input.graphName, MAX_NAME_LENGTH);
    return name ? findByName(name) : null;
  }

  function missingGraph(input = {}) {
    const id = cleanText(input.id || input.graph_id || input.graphId, 40);
    const name = cleanText(input.name || input.graph_name || input.graphName, MAX_NAME_LENGTH);
    return {
      ok: false,
      status: 'not_found',
      error: id
        ? `No Plotly graph exists with id ${id}.`
        : (name ? `No Plotly graph exists named "${name}".` : 'No Plotly graph id or name was provided.')
    };
  }

  function create(input = {}) {
    const notes = [];
    const figure = normalizeFigure(input, notes);
    if (!figure.data.length) {
      return {
        ok: false,
        status: 'invalid_figure',
        error: 'plotly-graph create requires at least one trace in data.'
      };
    }
    const timestamp = now();
    const graph = {
      id: allocateId(),
      name: cleanText(input.name, MAX_NAME_LENGTH),
      source: cleanText(input.source, MAX_SOURCE_LENGTH),
      ...figure,
      created_at: timestamp,
      updated_at: timestamp
    };
    graphs.set(graph.id, graph);
    return {
      ok: true,
      status: 'created',
      graph: serializeGraph(graph),
      ...(notes.length ? { normalization: notes } : {}),
      summary: `Created Plotly graph ${graph.id}${graph.name ? ` (${graph.name})` : ''}.`
    };
  }

  function read(input = {}) {
    const graph = resolveGraph(input);
    if (!graph) {
      return missingGraph(input);
    }
    return {
      ok: true,
      status: 'read',
      graph: serializeGraph(graph),
      summary: `Read Plotly graph ${graph.id}.`
    };
  }

  function list(input = {}) {
    const limit = Math.max(1, Math.min(50, Number(input.limit) || 50));
    const items = [...graphs.values()].slice(0, limit).map((graph) => serializeGraph(graph, {
      includeFigure: false
    }));
    return {
      ok: true,
      status: 'listed',
      items,
      count: items.length,
      total_count: graphs.size,
      summary: `Listed ${items.length} Plotly graph${items.length === 1 ? '' : 's'}.`
    };
  }

  function update(input = {}) {
    const graph = resolveGraph(input);
    if (!graph) {
      return missingGraph(input);
    }
    const replace = input.replace === true;
    const notes = [];
    const figure = normalizeFigure(input, notes);
    if (asArray(input.data || input.traces || input.figure?.data || input.figure?.traces).length) {
      graph.data = figure.data;
    }
    if (Object.keys(ensureObject(input.layout || input.figure?.layout)).length) {
      graph.layout = replace ? figure.layout : mergeObjects(graph.layout, figure.layout);
    }
    if (Object.keys(ensureObject(input.config || input.figure?.config)).length) {
      graph.config = replace ? figure.config : mergeObjects(graph.config, figure.config);
    }
    if (asArray(input.frames || input.figure?.frames).length || replace) {
      graph.frames = figure.frames;
    }
    graph.data = asArray(graph.data).map((trace, index) => normalizeTrace(trace, graph.layout, { index, notes }));
    graph.name = cleanText(input.name || input.new_name || input.newName || graph.name, MAX_NAME_LENGTH);
    graph.source = cleanText(input.source || graph.source, MAX_SOURCE_LENGTH);
    graph.updated_at = now();
    return {
      ok: true,
      status: 'updated',
      graph: serializeGraph(graph),
      ...(notes.length ? { normalization: notes } : {}),
      summary: `Updated Plotly graph ${graph.id}.`
    };
  }

  function inspect(input = {}) {
    const graph = resolveGraph(input);
    if (!graph) {
      return missingGraph(input);
    }
    const figure = {
      data: graph.data,
      layout: graph.layout,
      config: graph.config,
      frames: graph.frames
    };
    return {
      ok: true,
      status: 'inspected',
      id: graph.id,
      inspection: inspectFigure(figure),
      graph: serializeGraph(graph, { includeFigure: false }),
      summary: `Inspected Plotly graph ${graph.id}.`
    };
  }

  function deleteGraph(input = {}) {
    const graph = resolveGraph(input);
    if (!graph) {
      return missingGraph(input);
    }
    graphs.delete(graph.id);
    return {
      ok: true,
      status: 'deleted',
      id: graph.id,
      summary: `Deleted Plotly graph ${graph.id}.`
    };
  }

  function clear() {
    const count = graphs.size;
    graphs.clear();
    return {
      ok: true,
      status: 'cleared',
      count,
      summary: `Cleared ${count} Plotly graph${count === 1 ? '' : 's'}.`
    };
  }

  async function execute(input = {}) {
    const action = cleanText(input.action, 40) || 'list';
    if (!PLOTLY_GRAPH_ACTIONS.includes(action)) {
      return {
        ok: false,
        status: 'invalid_action',
        error: `Unsupported plotly-graph action "${action}".`
      };
    }
    if (action === 'create') {
      return create(input);
    }
    if (action === 'read') {
      return read(input);
    }
    if (action === 'list') {
      return list(input);
    }
    if (action === 'update') {
      return update(input);
    }
    if (action === 'inspect') {
      return inspect(input);
    }
    if (action === 'delete') {
      return deleteGraph(input);
    }
    return clear();
  }

  return {
    execute,
    listGraphs: () => [...graphs.values()].map((graph) => cloneJson(graph, {})),
    getGraph: (input = {}) => {
      const graph = resolveGraph(input);
      return graph ? cloneJson(graph, null) : null;
    }
  };
}

module.exports = {
  PLOTLY_GRAPH_ACTIONS,
  createAgentPlotlyGraphRuntime,
  inspectFigure
};
