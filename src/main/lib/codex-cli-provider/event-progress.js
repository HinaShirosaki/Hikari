'use strict';

const { extractHtmlArtifactFromToolOutput } = require('../../agent/runtime/tool-artifacts/html-output.js');
const { extractImageArtifactFromToolOutput } = require('../../agent/runtime/tool-artifacts/image-output.js');

const {
  getCodexJsonEventDescriptor,
  isCodexThinkingEvent,
  isCodexToolEvent
} = require('./event-descriptor');
const {
  collectTextFromCodexEventValue,
  stringifyCodexEventValue
} = require('./event-values');
const { summarizeCodexToolCallForProgress } = require('./event-tool-summary');
const { cleanText } = require('./utils');
const {
  extractPlotlyGraphArtifactFromToolOutput
} = require('../../agent/runtime/tool-artifacts/plotly-graph.js');

function extractCodexJsonEventThinking(event = {}) {
  if (!isCodexThinkingEvent(event)) {
    return null;
  }
  const { source, item, type, phase } = getCodexJsonEventDescriptor(event);
  const text = collectTextFromCodexEventValue(
    source.delta
      || source.text_delta
      || source.textDelta
      || source.summary_delta
      || source.summaryDelta
      || source.thinking_delta
      || source.thinkingDelta
      || source.reasoning_delta
      || source.reasoningDelta
      || source.text
      || source.summary
      || source.thinking
      || source.reasoning
      || source.message
      || item.summary
      || item.content
      || item.text,
    4000
  );
  if (!text) {
    return null;
  }
  return {
    type: 'codex_thinking',
    event_type: phase ? `${type}:${phase}` : type,
    thinking_text: text
  };
}

function inferCodexToolStatus(type = '') {
  const text = cleanText(type, 160).toLowerCase();
  if (/fail|error|errored|rejected/u.test(text)) {
    return 'failed';
  }
  if (/function_call_output|tool_result|tool_result_end|mcp_tool_call_end|call_output/u.test(text)) {
    return 'completed';
  }
  if (/complete|completed|done|end|ended|finish|finished|success|succeeded/u.test(text)) {
    return 'completed';
  }
  if (/delta|output|stdout|stderr|stream/u.test(text)) {
    return 'streaming';
  }
  return 'started';
}

function extractCodexJsonEventToolCall(event = {}) {
  if (!isCodexToolEvent(event)) {
    return null;
  }
  const { source, item, invocation, call, type, name } = getCodexJsonEventDescriptor(event);
  const toolName = cleanText(
    source.tool_name
      || source.toolName
      || source.name
      || invocation.tool
      || invocation.name
      || item.name
      || item.tool
      || item.tool_name
      || item.toolName
      || call.name
      || call.tool
      || name,
    160
  ) || 'codex-tool';
  const argumentValue = source.arguments
    || source.args
    || source.input
    || source.command
    || source.arguments_delta
    || source.argumentsDelta
    || source.delta
    || invocation.arguments
    || invocation.args
    || invocation.input
    || item.arguments
    || item.args
    || item.input
    || item.command
    || call.arguments
    || call.args
    || call.input;
  const argsText = stringifyCodexEventValue(argumentValue, 2000);
  const outputValue = source.output
    || source.result
    || source.stdout
    || source.stderr
    || invocation.output
    || invocation.result
    || item.output
    || item.result
    || call.output
    || call.result;
  const outputText = collectTextFromCodexEventValue(outputValue, 12000)
    || stringifyCodexEventValue(outputValue, 12000);
  const directText = collectTextFromCodexEventValue(
    source.text
      || source.message
      || source.summary
      || item.text
      || item.summary
      || item.content,
    2000
  );
  const status = inferCodexToolStatus(type);
  const detailText = directText
    || ((status === 'completed' || status === 'streaming') && outputText ? outputText : '')
    || argsText
    || outputText;
  const toolCallText = summarizeCodexToolCallForProgress({
    toolName,
    status,
    argumentValue,
    outputText,
    directText: detailText
  });
  const htmlArtifact = extractHtmlArtifactFromToolOutput(toolName, outputValue);
  const imageArtifact = extractImageArtifactFromToolOutput(toolName, outputValue);
  const plotlyGraphArtifact = extractPlotlyGraphArtifactFromToolOutput(toolName, outputValue, { status });
  return {
    type: 'codex_tool_call',
    event_type: type,
    status,
    tool_name: toolName,
    call_id: cleanText(source.call_id || source.callId || item.call_id || item.callId || call.call_id || call.callId, 160),
    tool_call_text: toolCallText,
    tool_output_text: outputText,
    ...(htmlArtifact ? { html_artifact: htmlArtifact } : {}),
    ...(imageArtifact ? { image_artifact: imageArtifact } : {}),
    ...(plotlyGraphArtifact ? { plotly_graph_artifact: plotlyGraphArtifact } : {})
  };
}

function extractCodexJsonEventProgress(event = {}) {
  return [
    extractCodexJsonEventThinking(event),
    extractCodexJsonEventToolCall(event)
  ].filter(Boolean);
}

function buildCodexProgressEventKey(event = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return '';
  }
  return [
    cleanText(event.type, 80),
    cleanText(event.event_type || event.eventType, 160),
    cleanText(event.status, 80),
    cleanText(event.tool_name || event.toolName, 160),
    cleanText(event.tool_call_text || event.toolCallText || event.thinking_text || event.thinkingText, 4000)
  ].join('\u0001');
}

module.exports = {
  buildCodexProgressEventKey,
  extractCodexJsonEventProgress,
  extractCodexJsonEventThinking,
  extractCodexJsonEventToolCall
};
