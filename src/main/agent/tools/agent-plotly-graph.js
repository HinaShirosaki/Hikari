'use strict';

const { asArray, cloneJson, ensureObject } = require('../../lib/normalize.js');

const {
  MAX_NAME_LENGTH,
  MAX_SOURCE_LENGTH,
  cleanText,
  inspectFigure,
  mergeObjects,
  normalizeFigure,
  normalizeTrace,
  serializeGraph
} = require('./agent-plotly-figure.js');
const PLOTLY_GRAPH_ACTIONS = Object.freeze([
  'create',
  'read',
  'list',
  'update',
  'inspect',
  'delete',
  'clear'
]);

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
