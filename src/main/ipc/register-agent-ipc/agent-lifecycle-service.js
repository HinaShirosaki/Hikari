'use strict';

const { isAgentRequestAbortError } = require('../../lib/llm/request-context.js');
const {
  extractPlotlyGraphArtifactFromToolOutput
} = require('../../agent/runtime/tool-artifacts/plotly-graph.js');

function createAgentLifecycleService({
  cleanText,
  observability,
  controllerUtils,
  agentToolRuntime,
  appendAgentChatLogEntry
} = {}) {
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeJsonPayload(payload, fallback = {}) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload;
    }
    try {
      const parsed = JSON.parse(String(payload || ''));
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function buildAgentProgressPayload({
    lifecycleEvent,
    requestId = '',
    clientRequestId = '',
    chatSessionId = ''
  } = {}) {
    const source = lifecycleEvent && typeof lifecycleEvent === 'object' ? lifecycleEvent : {};
    const stage = cleanText(source.stage, 40);
    if (!stage) {
      return null;
    }
    const toolName = cleanText(source.tool_name, 120);
    const status = cleanText(source.status, 20) || 'ok';
    const meta = source.meta && typeof source.meta === 'object' ? { ...source.meta } : {};
    const plotlyGraphArtifact = extractPlotlyGraphArtifactFromToolOutput(toolName, source.tool_output, { status });
    if (plotlyGraphArtifact?.figure?.data?.length) {
      meta.plotly_graph_artifact = plotlyGraphArtifact;
    }
    return {
      client_request_id: cleanText(clientRequestId, 120),
      request_id: cleanText(requestId || source.requestId, 80),
      chat_session_id: cleanText(chatSessionId, 120),
      timestamp: cleanText(source.timestamp, 80) || new Date().toISOString(),
      routing_intent: cleanText(source.routing_intent, 80),
      stage,
      status,
      tool_name: toolName,
      message: cleanText(source.message, 360),
      meta
    };
  }

  function createLifecycleToolRunner({
    snapshot,
    allowWriteTools = false,
    lifecycleRecorder,
    provider = '',
    endpoint = '',
    apiKey = '',
    model = '',
    message = '',
    conversation = [],
    parserPayload = {},
    traceContext = null,
    project = null,
    sandboxRoot = '',
    preferredPythonBin = '',
    pythonExecutable = ''
  }) {
    return async (toolName, args, options = {}) => {
      const normalizedArgs = typeof agentToolRuntime.normalizeToolInvocationArgs === 'function'
        ? agentToolRuntime.normalizeToolInvocationArgs(args)
        : args;
      const effectiveAllowWrite = options?.allowWriteTools === true || allowWriteTools === true;
      observability.recordLifecycleEvent(lifecycleRecorder, {
        stage: 'tool_call_started',
        status: 'started',
        tool_name: toolName,
        tool_args: normalizedArgs,
        message: `Started tool call for ${cleanText(toolName, 120) || 'unknown_tool'}.`
      });
      try {
        const result = await agentToolRuntime.runAgentTool(toolName, normalizedArgs, snapshot, {
          provider,
          endpoint,
          apiKey,
          model,
          message,
          conversation,
          parserPayload,
          traceContext,
          lifecycleRecorder,
          project,
          sandboxRoot,
          preferredPythonBin,
          pythonExecutable,
          ...options,
          allowWriteTools: effectiveAllowWrite,
          requestId: cleanText(lifecycleRecorder?.requestId, 80)
        });
        if (result?.ok === false) {
          observability.recordLifecycleEvent(lifecycleRecorder, {
            stage: 'tool_call_failed',
            status: 'failed',
            tool_name: toolName,
            tool_args: normalizedArgs,
            tool_output: result,
            message: cleanText(result?.error || result?.summary, 320) || 'Tool call returned an error envelope.'
          });
        } else {
          observability.recordLifecycleEvent(lifecycleRecorder, {
            stage: 'tool_call_completed',
            status: 'ok',
            tool_name: toolName,
            tool_args: normalizedArgs,
            tool_output: result,
            message: cleanText(result?.summary, 280) || 'Tool call completed.'
          });
        }
        return result;
      } catch (error) {
        const message = cleanText(String(error?.message || error), 320) || 'Tool call failed.';
        observability.recordLifecycleEvent(lifecycleRecorder, {
          stage: 'tool_call_failed',
          status: isAgentRequestAbortError(error) ? 'aborted' : 'failed',
          tool_name: toolName,
          tool_args: normalizedArgs,
          message
        });
        throw error;
      }
    };
  }

  async function flushLifecycleRecorderEvents(logPath, lifecycleRecorder) {
    const recorder = lifecycleRecorder && typeof lifecycleRecorder === 'object'
      ? lifecycleRecorder
      : null;
    if (!recorder) {
      return;
    }
    const start = Number.isFinite(Number(recorder.flushed_count))
      ? Number(recorder.flushed_count)
      : 0;
    const events = asArray(recorder.events);
    for (let index = start; index < events.length; index += 1) {
      await appendAgentChatLogEntry(logPath, controllerUtils.formatAgentChatLogEntry(events[index]));
    }
    recorder.flushed_count = events.length;
  }

  return {
    asArray,
    normalizeJsonPayload,
    buildAgentProgressPayload,
    createLifecycleToolRunner,
    flushLifecycleRecorderEvents
  };
}

module.exports = {
  createAgentLifecycleService
};
