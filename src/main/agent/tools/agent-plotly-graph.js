'use strict';

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

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
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

function normalizeFigure(input = {}) {
  const source = ensureObject(input.figure || input.plotly || input);
  return {
    data: asArray(source.data || source.traces || input.data || input.traces)
      .map((trace) => ensureObject(trace))
      .slice(0, MAX_TRACES),
    layout: ensureObject(source.layout || input.layout),
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

function traceType(trace = {}) {
  return cleanText(trace.type, 40) || 'scatter';
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
    const figure = normalizeFigure(input);
    if (!figure.data.length) {
      return {
        ok: false,
        status: 'invalid_figure',
        error: 'plotly-graph create requires at least one trace in data or traces.'
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
    const figure = normalizeFigure(input);
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
    graph.name = cleanText(input.name || input.new_name || input.newName || graph.name, MAX_NAME_LENGTH);
    graph.source = cleanText(input.source || graph.source, MAX_SOURCE_LENGTH);
    graph.updated_at = now();
    return {
      ok: true,
      status: 'updated',
      graph: serializeGraph(graph),
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
