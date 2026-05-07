'use strict';

const { AGENT } = require('../../../shared/ipc/channels');

function registerAgentLogHandlers({
  ipcMain,
  cleanText,
  observability,
  agentChatLogRuntime,
  getAgentChatLogPath,
  getAgentChatSessionStoragePath,
  agentToolRuntime,
  agentToolSmokeTestRuntime,
  protocolGenerationRuntime,
  controllerUtils,
  lifecycleService
} = {}) {
  const { normalizeJsonPayload, asArray } = lifecycleService;

  function normalizeProtocolGenerationEditorDraft(rawDraft) {
    const source = rawDraft && typeof rawDraft === 'object'
      ? rawDraft
      : {};
    return {
      title: cleanText(source?.title || source?.name, 220),
      purpose: cleanText(source?.purpose, 600),
      method_text: cleanText(source?.methodText || source?.method_text, 12000),
      materials: asArray(source?.materials).map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 80),
      steps: asArray(source?.steps).map((item) => cleanText(item, 2000)).filter(Boolean).slice(0, 120),
      troubleshooting: cleanText(source?.troubleshooting, 2400)
    };
  }

  ipcMain.handle(AGENT.CHAT_LOG_CREATE_SESSION, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const storagePath = getAgentChatSessionStoragePath(normalizedPayload);
    if (!storagePath) {
      return {
        ok: false,
        error: 'Missing storage path.'
      };
    }
    try {
      return await agentChatLogRuntime.createSession({
        storagePath,
        sessionId: cleanText(normalizedPayload?.sessionId || normalizedPayload?.session_id, 120),
        title: cleanText(normalizedPayload?.title, 220) || 'New Chat',
        projectId: cleanText(normalizedPayload?.projectId || normalizedPayload?.project_id, 120),
        projectName: cleanText(normalizedPayload?.projectName || normalizedPayload?.project_name, 220)
      });
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400)
      };
    }
  });

  ipcMain.handle(AGENT.CHAT_LOG_LIST_SESSIONS, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const storagePath = getAgentChatSessionStoragePath(normalizedPayload);
    if (!storagePath) {
      return {
        ok: true,
        items: []
      };
    }
    try {
      return await agentChatLogRuntime.listSessions({
        storagePath,
        limit: Math.max(1, Number(normalizedPayload?.limit) || 200)
      });
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400)
      };
    }
  });

  ipcMain.handle(AGENT.CHAT_LOG_GET_SESSION, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const storagePath = getAgentChatSessionStoragePath(normalizedPayload);
    const sessionId = cleanText(normalizedPayload?.sessionId || normalizedPayload?.session_id, 120);
    if (!storagePath) {
      return {
        ok: false,
        error: 'Missing storage path.'
      };
    }
    if (!sessionId) {
      return {
        ok: false,
        error: 'sessionId is required.'
      };
    }
    try {
      return await agentChatLogRuntime.getSession({
        storagePath,
        sessionId,
        includeRows: normalizedPayload?.includeRows === true
      });
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400)
      };
    }
  });

  ipcMain.handle(AGENT.DEVELOPER_TEST_TOOLS, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const executionFlags = controllerUtils.resolveAgentExecutionFlags(
      normalizedPayload,
      normalizeJsonPayload(normalizedPayload?.stateSnapshot, {})
    );
    if (executionFlags.developerMode !== true) {
      return {
        ok: false,
        status: 'error',
        tool_count: 0,
        passed_count: 0,
        failed_count: 0,
        items: [],
        summary: 'Agent developer mode must be enabled to run manual tool smoke tests.',
        error: 'Agent developer mode must be enabled to run manual tool smoke tests.'
      };
    }

    try {
      const toolName = cleanText(normalizedPayload?.toolName || normalizedPayload?.tool_name, 120);
      const requestMessage = cleanText(normalizedPayload?.message, 3000);
      if (toolName) {
        return await agentToolSmokeTestRuntime.runTool({
          toolName,
          message: requestMessage,
          stateSnapshot: agentToolRuntime.normalizeAgentSnapshot(normalizeJsonPayload(normalizedPayload?.stateSnapshot, {})),
          projectId: cleanText(normalizedPayload?.projectId, 80),
          projectName: cleanText(normalizedPayload?.projectName, 180)
        });
      }
      return await agentToolSmokeTestRuntime.runAllTools({
        stateSnapshot: agentToolRuntime.normalizeAgentSnapshot(normalizeJsonPayload(normalizedPayload?.stateSnapshot, {})),
        projectId: cleanText(normalizedPayload?.projectId, 80),
        projectName: cleanText(normalizedPayload?.projectName, 180)
      });
    } catch (error) {
      const message = cleanText(error?.message || error, 600) || 'Manual tool smoke test failed.';
      return {
        ok: false,
        status: 'error',
        tool_count: 0,
        passed_count: 0,
        failed_count: 0,
        items: [],
        summary: message,
        error: message
      };
    }
  });

  ipcMain.handle(AGENT.GENERATE_PROTOCOL, async (_event, payload) => {
    if (!protocolGenerationRuntime || typeof protocolGenerationRuntime.generateProtocol !== 'function') {
      return {
        ok: false,
        error: 'Protocol generation runtime is unavailable.'
      };
    }

    const normalizedPayload = normalizeJsonPayload(payload, {});
    const editorDraft = normalizeProtocolGenerationEditorDraft(normalizedPayload?.editorDraft);
    const requestMessage = cleanText(normalizedPayload?.message, 3000);
    const protocolJson = cleanText(normalizedPayload?.protocolJson || normalizedPayload?.protocol_json, 200000);
    const resultSummary = cleanText(
      normalizedPayload?.resultSummary || normalizedPayload?.result_summary || requestMessage,
      3000
    );
    const hasEditorContext = Boolean(
      editorDraft.title
      || editorDraft.purpose
      || editorDraft.method_text
      || editorDraft.materials.length
      || editorDraft.steps.length
      || editorDraft.troubleshooting
    );
    if (!protocolJson && !requestMessage && !hasEditorContext) {
      return {
        ok: false,
        error: 'Provide protocol JSON or editor protocol content before preparing a protocol.'
      };
    }

    try {
      const result = await protocolGenerationRuntime.generateProtocol({
        ...(hasEditorContext ? {
          protocol: {
            name: editorDraft.title,
            purpose: editorDraft.purpose,
            materials: editorDraft.materials,
            steps: editorDraft.steps,
            troubleshooting: editorDraft.troubleshooting
          }
        } : {
          protocol_json: protocolJson || requestMessage
        }),
        result_summary: resultSummary
      });

      if (!result?.ok || !result.protocol) {
        return {
          ok: false,
          error: cleanText(result?.error, 600) || 'Protocol generation failed.'
        };
      }

      return {
        ok: true,
        protocol: result.protocol,
        summary: cleanText(result?.summary, 320)
      };
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 600) || 'Protocol generation failed.'
      };
    }
  });

  ipcMain.handle(AGENT.LOGS_LIST_REQUESTS, async () => {
    try {
      const rows = await observability.readLifecycleLogs({
        logPath: getAgentChatLogPath(),
        limit: 8000
      });
      const byRequest = new Map();

      rows.forEach((row) => {
        const requestId = cleanText(row?.requestId, 80);
        if (!requestId) {
          return;
        }
        const existing = byRequest.get(requestId) || {
          requestId,
          message: '',
          projectId: '',
          projectName: '',
          provider: '',
          model: '',
          response_type: '',
          ok: null,
          failure_reasons: [],
          started_at: '',
          ended_at: '',
          stages: []
        };
        const type = cleanText(row?.type, 80);
        const timestamp = cleanText(row?.timestamp, 80);
        if (!existing.started_at && timestamp) {
          existing.started_at = timestamp;
        }
        if (timestamp) {
          existing.ended_at = timestamp;
        }

        if (type === 'agent-chat-request') {
          existing.message = cleanText(row?.message, 320);
          existing.projectId = cleanText(row?.projectId, 80);
          existing.projectName = cleanText(row?.projectName, 180);
          existing.provider = cleanText(row?.llm?.provider, 80);
        } else if (type === 'agent-chat-result') {
          existing.ok = row?.ok === true;
          existing.model = cleanText(row?.model, 120);
          existing.response_type = cleanText(row?.response_type, 80);
          existing.failure_reasons = Array.from(new Set([...asArray(existing.failure_reasons), ...asArray(row?.failure_reasons)])).slice(0, 20);
        } else if (type === 'agent-chat-error') {
          existing.ok = false;
          existing.failure_reasons = Array.from(new Set([...asArray(existing.failure_reasons), ...asArray(row?.failure_reasons)])).slice(0, 20);
        } else if (type === 'agent-lifecycle') {
          const stage = cleanText(row?.stage, 40);
          if (stage && !existing.stages.includes(stage)) {
            existing.stages.push(stage);
          }
          existing.failure_reasons = Array.from(new Set([...asArray(existing.failure_reasons), ...asArray(row?.failure_reasons)])).slice(0, 20);
        }
        byRequest.set(requestId, existing);
      });

      const items = Array.from(byRequest.values())
        .sort((a, b) => {
          const left = Date.parse(a.ended_at || a.started_at || '') || 0;
          const right = Date.parse(b.ended_at || b.started_at || '') || 0;
          return right - left;
        })
        .slice(0, 200);

      return {
        ok: true,
        items
      };
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400)
      };
    }
  });

  ipcMain.handle(AGENT.LOGS_REPLAY, async (_event, payload) => {
    const requestId = cleanText(payload?.requestId, 80);
    if (!requestId) {
      return {
        ok: false,
        error: 'requestId is required.'
      };
    }
    try {
      return await observability.replayRequestLifecycle({
        requestId,
        logPath: getAgentChatLogPath()
      });
    } catch (error) {
      return {
        ok: false,
        requestId,
        error: cleanText(error?.message || error, 2400)
      };
    }
  });
}

module.exports = {
  registerAgentLogHandlers
};
