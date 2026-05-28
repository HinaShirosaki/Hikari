'use strict';

const { callProtocolGeneration } = require('../mcp-contract/direct-tools/protocol-generation.js');
const {
  buildDirectProtocolGenerationFallbackArgs,
  buildProtocolGenerationAggregate,
  looksLikeDirectToolMaterializationFailure,
  normalizeProtocolGenerationArtifact
} = require('./artifacts.js');
const {
  defaultCleanText,
  ensureObject
} = require('./runtime-utils.js');
const {
  buildCodexMcpContext
} = require('./prompts.js');

async function resolveProtocolGenerationArtifact({
  codexAgent = {},
  input = {},
  cwd = '',
  model = '',
  rawText = '',
  cleanText = defaultCleanText,
  lifecycleRecorder = null,
  recordLifecycleEvent = () => {},
  runTool = null,
  streamedProtocolGenerationPayloads = [],
  traceContext = null
} = {}) {
  let protocolGenerationArtifact = buildProtocolGenerationAggregate(streamedProtocolGenerationPayloads);
  if (protocolGenerationArtifact || !runTool || codexAgent.status === 'needs_more_info') {
    return protocolGenerationArtifact;
  }

  const fallbackArgs = buildDirectProtocolGenerationFallbackArgs(input.message, { cleanText });
  if (!fallbackArgs || !looksLikeDirectToolMaterializationFailure(`${rawText}\n${codexAgent.answer}`)) {
    return null;
  }

  recordLifecycleEvent(lifecycleRecorder, {
    stage: 'codex_agent_direct_tool_fallback',
    status: 'started',
    routing_intent: 'codex_agent',
    tool_name: 'protocol_generation',
    message: 'Recovering direct protocol_generation call after Codex could not materialize the named MCP tool.'
  });
  try {
    const directToolContext = {
      ...buildCodexMcpContext({ ...input, cwd, model }, { cleanText }),
      snapshot: ensureObject(input.snapshot),
      traceContext,
      lifecycleRecorder
    };
    const fallbackResult = await callProtocolGeneration(fallbackArgs, directToolContext, { runTool });
    const fallbackArtifact = normalizeProtocolGenerationArtifact(fallbackResult, { cleanText });
    if (fallbackArtifact?.protocol) {
      streamedProtocolGenerationPayloads.push(fallbackArtifact);
      protocolGenerationArtifact = buildProtocolGenerationAggregate(streamedProtocolGenerationPayloads);
      codexAgent.status = 'completed';
      codexAgent.answer = fallbackArtifact.save_requested || fallbackArtifact.requires_user_approval
        ? 'The protocol is ready for review.'
        : (cleanText(codexAgent.answer, 120000) || 'The protocol was normalized.');
      codexAgent.follow_up_questions = [];
      codexAgent.user_question = null;
      codexAgent.reasoning_summary = 'Recovered by directly executing the named Hikari protocol_generation tool after Codex could not materialize it.';
      recordLifecycleEvent(lifecycleRecorder, {
        stage: 'codex_agent_direct_tool_fallback',
        status: 'ok',
        routing_intent: 'codex_agent',
        tool_name: 'protocol_generation',
        message: cleanText(fallbackArtifact.summary, 320) || 'Direct protocol_generation fallback completed.',
        meta: {
          save_requested: fallbackArtifact.save_requested === true,
          protocol_name: cleanText(fallbackArtifact.protocol?.name || fallbackArtifact.protocol?.title, 220)
        }
      });
      return protocolGenerationArtifact;
    }
    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'codex_agent_direct_tool_fallback',
      status: 'failed',
      routing_intent: 'codex_agent',
      tool_name: 'protocol_generation',
      message: cleanText(fallbackResult?.error || fallbackResult?.status, 320)
        || 'Direct protocol_generation fallback did not return a protocol.'
    });
  } catch (error) {
    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'codex_agent_direct_tool_fallback',
      status: 'failed',
      routing_intent: 'codex_agent',
      tool_name: 'protocol_generation',
      message: cleanText(error?.message, 320) || 'Direct protocol_generation fallback failed.'
    });
  }
  return null;
}

module.exports = {
  resolveProtocolGenerationArtifact
};
