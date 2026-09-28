'use strict';

const { asArray, cloneJson, ensureObject } = require('../../../lib/normalize.js');
const { parseJsonObjectFromText } = require('../../../lib/llm/runtime-helpers.js');
const { compactObject, normalizePlotlyFigure } = require('../../../../shared/plotly-figure.mjs');

const MAX_TEXT_LENGTH = 2000;

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function normalizePlotlyToolName(rawToolName = '') {
  return cleanText(rawToolName, 180)
    .replace(/^mcp__[^_]+__/u, '')
    .replace(/^hikari__/u, '')
    .replace(/-/gu, '_')
    .toLowerCase();
}

function isPlotlyGraphToolName(rawToolName = '') {
  const normalized = normalizePlotlyToolName(rawToolName);
  return normalized === 'plotly_graph' || normalized === 'plotlygraph';
}

function collectObjectCandidates(value, out = [], depth = 0) {
  if (depth > 5 || value === null || value === undefined) {
    return out;
  }
  if (typeof value === 'string') {
    const parsed = parseJsonObjectFromText(value);
    if (parsed) {
      collectObjectCandidates(parsed, out, depth + 1);
    }
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectObjectCandidates(item, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') {
    return out;
  }

  out.push(value);
  const source = ensureObject(value);
  [
    source.structured_content,
    source.structuredContent,
    source.Ok,
    source.ok,
    source.result,
    source.output,
    source.data,
    source.payload,
    source.body
  ].forEach((candidate) => collectObjectCandidates(candidate, out, depth + 1));

  asArray(source.content).forEach((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      collectObjectCandidates(item.structured_content || item.structuredContent, out, depth + 1);
      collectObjectCandidates(item.text || item.content, out, depth + 1);
    } else {
      collectObjectCandidates(item, out, depth + 1);
    }
  });

  return out;
}

function findGraphPayload(payload = {}) {
  const source = ensureObject(payload);
  const graph = ensureObject(source.graph);
  const itemWithFigure = asArray(source.items)
    .map((item) => ensureObject(item))
    .find((item) => Object.keys(ensureObject(item.figure)).length || asArray(item.data).length);
  const graphWithFigure = Object.keys(graph).length ? graph : ensureObject(itemWithFigure);
  const figureSource = source.figure
    || graphWithFigure.figure
    || source.plotly
    || (asArray(source.data).length ? source : null)
    || (asArray(graphWithFigure.data).length ? graphWithFigure : null)
    || null;
  const figure = normalizePlotlyFigure(figureSource || {});
  if (!asArray(figure.data).length) {
    return null;
  }
  return { source, graph: graphWithFigure, figure };
}

function normalizePlotlyGraphArtifact(payload = {}, { toolName = 'plotly_graph', status = '' } = {}) {
  for (const candidate of collectObjectCandidates(payload, [])) {
    const match = findGraphPayload(candidate);
    if (!match?.figure?.data?.length) {
      continue;
    }
    const { source, graph, figure } = match;
    return compactObject({
      type: 'plotly_graph',
      tool_name: normalizePlotlyToolName(toolName) || 'plotly_graph',
      status: cleanText(source.status || status, 80) || 'completed',
      id: cleanText(source.id || graph.id, 80),
      name: cleanText(source.name || graph.name, 220),
      summary: cleanText(source.summary || source.result_summary || source.resultSummary, 700),
      source: cleanText(source.source || graph.source, 1200),
      inspection: cloneJson(source.inspection || graph.inspection, null),
      figure: cloneJson(figure, {})
    });
  }
  return null;
}

function extractPlotlyGraphArtifactFromToolOutput(toolName = '', output = {}, options = {}) {
  if (!isPlotlyGraphToolName(toolName)) {
    return null;
  }
  return normalizePlotlyGraphArtifact(output, {
    toolName,
    status: options.status
  });
}

function extractPlotlyGraphArtifactFromToolEvent(streamEvent = {}) {
  const source = ensureObject(streamEvent);
  const toolName = source.tool_name || source.toolName;
  if (!isPlotlyGraphToolName(toolName)) {
    return null;
  }
  const rawStatus = cleanText(source.status, 40).toLowerCase();
  const candidates = [
    source.plotly_graph_artifact,
    source.plotlyGraphArtifact,
    ensureObject(source.meta).plotly_graph_artifact,
    ensureObject(source.meta).plotlyGraphArtifact,
    source.tool_result,
    source.toolResult,
    source.tool_output,
    source.toolOutput,
    source.result,
    source.output,
    source.tool_output_text,
    source.toolOutputText,
    source.output_text,
    source.outputText,
    source.tool_call_text,
    source.toolCallText
  ];
  for (const candidate of candidates) {
    const artifact = normalizePlotlyGraphArtifact(candidate, {
      toolName,
      status: rawStatus
    });
    if (artifact?.figure?.data?.length) {
      return artifact;
    }
  }
  return null;
}

module.exports = {
  extractPlotlyGraphArtifactFromToolEvent,
  extractPlotlyGraphArtifactFromToolOutput
};
