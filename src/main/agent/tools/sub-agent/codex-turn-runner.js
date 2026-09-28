'use strict';

const { buildCodexMcpContext } = require('../../codex-agent/runtime.js');
const { buildCodexSubAgentPrompt } = require('./helpers.js');

function ensurePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function createCodexSubAgentTurnRunner({
  cleanText,
  requestCodexCliText,
  getCodexCliWorkingDirectory,
  workspaceInitializer
} = {}) {
  if (
    typeof cleanText !== 'function'
    || typeof requestCodexCliText !== 'function'
    || typeof getCodexCliWorkingDirectory !== 'function'
    || typeof workspaceInitializer?.initialize !== 'function'
  ) {
    throw new Error('Codex sub-agent execution is not configured.');
  }

  return async function runSubAgentTurn(turnInput = {}) {
    const turnMetadata = ensurePlainObject(turnInput.metadata);
    const agentMetadata = ensurePlainObject(turnInput?.agent?.metadata);
    const requestedTimeout = [turnMetadata.timeout_ms, turnMetadata.timeoutMs,
      agentMetadata.timeout_ms, agentMetadata.timeoutMs].find((value) => value !== undefined);
    const timeoutMs = Number(requestedTimeout);
    const cwd = cleanText(
      turnMetadata.cwd || agentMetadata.cwd || getCodexCliWorkingDirectory(),
      2400
    );
    const model = cleanText(turnMetadata.model || agentMetadata.model, 120);
    const reasoningEffort = cleanText(
      turnMetadata.reasoning_effort
        || turnMetadata.reasoningEffort
        || agentMetadata.reasoning_effort
        || agentMetadata.reasoningEffort,
      40
    );
    const project = ensurePlainObject(
      Object.keys(ensurePlainObject(turnMetadata.project)).length
        ? turnMetadata.project
        : agentMetadata.project
    );
    const traceContext = {
      requestId: cleanText(
        turnMetadata.parent_request_id
          || turnMetadata.parentRequestId
          || agentMetadata.parent_request_id
          || agentMetadata.parentRequestId,
        160
      )
    };
    const sourceSnapshot = ensurePlainObject(
      turnInput.snapshot
        || turnInput.stateSnapshot
        || turnInput.state_snapshot
        || turnMetadata.snapshot
        || turnMetadata.stateSnapshot
        || turnMetadata.state_snapshot
        || agentMetadata.snapshot
        || agentMetadata.stateSnapshot
        || agentMetadata.state_snapshot
    );
    const dataFilePath = cleanText(
      turnMetadata.data_file_path
        || turnMetadata.dataFilePath
        || agentMetadata.data_file_path
        || agentMetadata.dataFilePath
        || sourceSnapshot.data_file_path
        || sourceSnapshot.dataFilePath,
      2000
    );
    const fallbackDataFilePath = cleanText(
      turnMetadata.fallback_data_file_path
        || turnMetadata.fallbackDataFilePath
        || agentMetadata.fallback_data_file_path
        || agentMetadata.fallbackDataFilePath
        || sourceSnapshot.fallback_data_file_path
        || sourceSnapshot.fallbackDataFilePath
        || dataFilePath,
      2000
    );
    const mcpContextJson = JSON.stringify(buildCodexMcpContext({
      cwd,
      model,
      message: cleanText(turnInput.message, 3200),
      conversation: (Array.isArray(turnInput.messages) ? turnInput.messages : []).map((entry) => ({
        role: cleanText(entry?.role, 40),
        text: cleanText(entry?.text || entry?.content || entry?.message, 3200)
      })),
      projectId: cleanText(
        turnMetadata.project_id
          || turnMetadata.projectId
          || project.id
          || project.projectId
          || agentMetadata.project_id
          || agentMetadata.projectId,
        120
      ),
      projectName: cleanText(
        turnMetadata.project_name
          || turnMetadata.projectName
          || project.name
          || project.projectName
          || agentMetadata.project_name
          || agentMetadata.projectName,
        220
      ),
      ...(dataFilePath ? { dataFilePath } : {}),
      ...(fallbackDataFilePath ? { fallbackDataFilePath } : {}),
      snapshot: sourceSnapshot,
      traceContext
    }, { cleanText }));
    const envOverrides = {
      HIKARI_AGENT_MCP_REQUEST_CONTEXT: mcpContextJson,
      HIKARI_CODEX_REQUEST_CONTEXT: mcpContextJson
    };
    await workspaceInitializer.initialize({ cwd, envOverrides });
    const result = await requestCodexCliText({
      prompt: buildCodexSubAgentPrompt(turnInput),
      cwd,
      model,
      reasoningEffort,
      enableWebSearch: turnMetadata.enable_web_search === true
        || turnMetadata.enableWebSearch === true
        || agentMetadata.enable_web_search === true
        || agentMetadata.enableWebSearch === true,
      timeoutMs: requestedTimeout === null ? null : (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180000),
      resumeSessionId: cleanText(
        agentMetadata.codex_session_id
          || agentMetadata.codexSessionId
          || agentMetadata.session_id
          || agentMetadata.sessionId,
        240
      ),
      returnMetadata: true,
      envOverrides
    });
    const resultMetadata = ensurePlainObject(result?.metadata);
    const assistantMessage = cleanText(
      typeof result === 'string' ? result : (result?.text || result?.assistant_message || result?.message),
      20000
    );
    if (!assistantMessage) {
      throw new Error('Codex sub-agent returned an empty response.');
    }
    const codexSessionId = cleanText(
      resultMetadata.session_id
        || resultMetadata.sessionId
        || resultMetadata.resumed_session_id
        || resultMetadata.resumedSessionId
        || agentMetadata.codex_session_id
        || agentMetadata.codexSessionId,
      240
    );
    return {
      assistant_message: assistantMessage,
      summary: cleanText(assistantMessage, 500),
      metadata: {
        provider: 'codex-cli',
        provider_ok: true,
        real_codex_sub_agent: true,
        codex_session_id: codexSessionId,
        command: cleanText(resultMetadata.command, 80)
      }
    };
  };
}

module.exports = {
  createCodexSubAgentTurnRunner
};
