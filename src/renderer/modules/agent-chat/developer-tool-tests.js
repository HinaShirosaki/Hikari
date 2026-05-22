import * as developerToolsModule from './developer-tools.js';
import { asArray, trimText } from './shared.js';

export function createDeveloperToolTestController({
  api,
  state,
  runtime,
  dom,
  createId,
  persist,
  payloadBuilder,
  buildSyncedStateSnapshot,
  ensureAgentState,
  renderHistoryView,
  setStatus,
  updateInFlightState
}) {
  function appendToolResult(result, fallbackText, requestMessage = '') {
    developerToolsModule.appendToolTestAssistantMessage(
      { state, createId, persist, renderHistory: renderHistoryView },
      result,
      fallbackText,
      requestMessage
    );
  }

  function getProjectDetails() {
    const { projectId, projectName } = payloadBuilder.getCurrentProjectDetails();
    return { projectId, projectName };
  }

  async function runDeveloperSingleToolTest() {
    if (runtime.inFlight) {
      return;
    }
    if (state.settings?.agent?.developerMode !== true) {
      setStatus('Enable Agent Developer Mode to run manual tool tests.');
      return;
    }
    if (!api?.agentDeveloperTestTools) {
      setStatus('Developer tool test IPC is unavailable.');
      return;
    }

    ensureAgentState();
    const toolName = trimText(dom.developerToolSelect?.value, 120);
    const requestMessage = trimText(dom.developerToolMessageInput?.value, 3000);
    if (!toolName) {
      setStatus('Select a tool to test.');
      return;
    }
    if (!requestMessage) {
      setStatus('Add a manual test message for the selected tool.');
      return;
    }

    const { projectId, projectName } = getProjectDetails();
    state.agentChat.messages.push({
      id: createId(),
      role: 'user',
      text: `Tool test (${toolName})\n${requestMessage}`,
      createdAt: new Date().toISOString()
    });
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    renderHistoryView({ forceScroll: true });
    updateInFlightState(true);
    setStatus(`Running manual test for ${toolName}...`);

    try {
      const stateSnapshot = await buildSyncedStateSnapshot(projectId);
      const result = await api.agentDeveloperTestTools({
        toolName,
        message: requestMessage,
        projectId,
        projectName,
        stateSnapshot,
        agent: { developerMode: state.settings?.agent?.developerMode === true }
      });
      if (!result?.ok && !asArray(result?.items).length) {
        throw new Error(result?.error || `Manual tool test failed for ${toolName}.`);
      }
      appendToolResult(result, `Manual tool test completed for ${toolName}.`, requestMessage);
      setStatus(result?.ok === true
        ? `Manual tool test complete for ${toolName}.`
        : `Manual tool test completed with failures for ${toolName}.`);
    } catch (error) {
      appendToolResult({
        ok: false,
        run_mode: 'single',
        tool_name: toolName,
        request_message: requestMessage,
        status: 'error',
        tool_count: 1,
        passed_count: 0,
        failed_count: 1,
        summary: `Manual tool test failed for ${toolName}: ${String(error?.message || error)}`,
        items: [{
          tool_name: toolName,
          ok: false,
          status: 'error',
          request_message: requestMessage,
          result_message: `Manual tool test failed for ${toolName}: ${String(error?.message || error)}`,
          summary: `Manual tool test failed for ${toolName}: ${String(error?.message || error)}`,
          error: String(error?.message || error),
          preview: '',
          duration_ms: 0,
          raw_result: {}
        }]
      }, `Manual tool test failed for ${toolName}: ${String(error?.message || error)}`, requestMessage);
      setStatus('Error.');
    } finally {
      updateInFlightState(false);
    }
  }

  async function runDeveloperToolSmokeTest() {
    if (runtime.inFlight) {
      return;
    }
    if (state.settings?.agent?.developerMode !== true) {
      setStatus('Enable Agent Developer Mode to run manual tool smoke tests.');
      return;
    }
    if (!api?.agentDeveloperTestTools) {
      setStatus('Developer tool test IPC is unavailable.');
      return;
    }

    ensureAgentState();
    const { projectId, projectName } = getProjectDetails();
    updateInFlightState(true);
    setStatus('Running manual tool smoke tests...');
    try {
      const stateSnapshot = await buildSyncedStateSnapshot(projectId);
      const result = await api.agentDeveloperTestTools({
        projectId,
        projectName,
        stateSnapshot,
        agent: { developerMode: state.settings?.agent?.developerMode === true }
      });
      if (!result?.ok && !asArray(result?.items).length) {
        throw new Error(result?.error || 'Manual tool smoke test failed.');
      }
      appendToolResult(result, 'Manual tool smoke test completed.');
      setStatus(result?.ok === true ? 'Manual tool smoke test complete.' : 'Manual tool smoke test completed with failures.');
    } catch (error) {
      appendToolResult({
        ok: false,
        run_mode: 'all',
        status: 'error',
        tool_count: 0,
        passed_count: 0,
        failed_count: 0,
        summary: `Manual tool smoke test failed: ${String(error?.message || error)}`,
        items: []
      }, `Manual tool smoke test failed: ${String(error?.message || error)}`);
      setStatus('Error.');
    } finally {
      updateInFlightState(false);
    }
  }

  return {
    runDeveloperSingleToolTest,
    runDeveloperToolSmokeTest
  };
}
