import { asArray, cloneJson, ensureObject } from '../../../lib/normalize.js';
import { compactObject, normalizePlotlyFigure } from '../../../../shared/plotly-figure.mjs';

function getPlotlyTitle(layout = {}) {
  const title = ensureObject(layout).title;
  if (typeof title === 'string') {
    return title.trim();
  }
  return String(ensureObject(title).text || '').trim();
}

function normalizeAgentPlotlyGraphArtifact(value = {}) {
  const source = ensureObject(value);
  const graph = ensureObject(source.graph);
  const itemWithFigure = asArray(source.items)
    .map((item) => ensureObject(item))
    .find((item) => Object.keys(ensureObject(item.figure)).length || asArray(item.data).length);
  const graphSource = Object.keys(graph).length ? graph : ensureObject(itemWithFigure);
  const figure = normalizePlotlyFigure(
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
    status: String(source.status || 'completed').trim(),
    id: String(source.id || graphSource.id || '').trim(),
    name: String(source.name || graphSource.name || getPlotlyTitle(figure.layout) || '').trim(),
    summary: String(source.summary || source.result_summary || source.resultSummary || '').trim(),
    source: String(source.source || graphSource.source || '').trim(),
    inspection: cloneJson(source.inspection || graphSource.inspection, null),
    figure: cloneJson(figure, {})
  });
}

export {
  compactObject,
  normalizePlotlyFigure,
  getPlotlyTitle,
  normalizeAgentPlotlyGraphArtifact
};
