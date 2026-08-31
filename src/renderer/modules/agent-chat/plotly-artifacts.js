import { asArray, trimText } from './shared.js';
import { cloneJson, ensureObject } from '../../lib/normalize.js';

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
    if (
      entryValue
      && typeof entryValue === 'object'
      && !Array.isArray(entryValue)
      && !Object.keys(entryValue).length
    ) {
      return out;
    }
    out[key] = entryValue;
    return out;
  }, {});
}

function normalizeFigure(value = {}) {
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

export function normalizeAgentPlotlyGraphArtifact(value = {}) {
  const source = ensureObject(value);
  const graph = ensureObject(source.graph);
  const itemWithFigure = asArray(source.items)
    .map((item) => ensureObject(item))
    .find((item) => Object.keys(ensureObject(item.figure)).length || asArray(item.data).length);
  const graphSource = Object.keys(graph).length ? graph : ensureObject(itemWithFigure);
  const figure = normalizeFigure(
    source.figure
      || graphSource.figure
      || source.plotly
      || (asArray(source.data).length ? source : null)
      || (asArray(graphSource.data).length ? graphSource : null)
      || {}
  );
  if (!asArray(figure.data).length) {
    return null;
  }
  return compactObject({
    type: 'plotly_graph',
    tool_name: trimText(source.tool_name || source.toolName || 'plotly_graph', 120),
    status: trimText(source.status, 80) || 'completed',
    id: trimText(source.id || graphSource.id, 80),
    name: trimText(source.name || graphSource.name, 220),
    summary: trimText(source.summary || source.result_summary || source.resultSummary, 700),
    source: trimText(source.source || graphSource.source, 1200),
    inspection: cloneJson(source.inspection || graphSource.inspection, null),
    figure: cloneJson(figure, {})
  });
}

export function extractPlotlyGraphArtifactFromProgressEvent(eventPayload = {}) {
  const source = ensureObject(eventPayload);
  const meta = ensureObject(source.meta);
  const candidates = [
    meta.plotly_graph_artifact,
    meta.plotlyGraphArtifact,
    source.plotly_graph_artifact,
    source.plotlyGraphArtifact
  ];
  for (const candidate of candidates) {
    const artifact = normalizeAgentPlotlyGraphArtifact(candidate);
    if (artifact?.figure?.data?.length) {
      return artifact;
    }
  }
  return null;
}
