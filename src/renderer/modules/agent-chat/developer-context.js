import * as developerToolsModule from './developer-tools.js';
import { trimText } from './shared.js';

export function createDeveloperContextController({
  api,
  state,
  dom,
  runtime,
  setStatus,
  ensureAgentState,
  buildSyncedStateSnapshot,
  payloadBuilder
}) {
  function invalidate() {
    runtime.developerContextPreview = null;
    runtime.developerContextPreviewText = '';
    if (dom.developerResponseHint) {
      dom.developerResponseHint.textContent = '';
    }
  }

  function render() {
    const enabled = state.settings?.agent?.developerMode === true;
    if (!dom.developerResponseSimulator) {
      return;
    }
    dom.developerResponseSimulator.hidden = !enabled;
    if (!enabled) {
      return;
    }
    dom.developerResponseSimulator.classList?.toggle('is-folded', runtime.developerResponseSimulatorFolded);
    if (dom.developerResponseFoldBtn) {
      dom.developerResponseFoldBtn.textContent = runtime.developerResponseSimulatorFolded ? 'Show' : 'Fold';
      dom.developerResponseFoldBtn.setAttribute?.(
        'aria-expanded',
        runtime.developerResponseSimulatorFolded ? 'false' : 'true'
      );
    }
    if (dom.developerResponseBody) {
      dom.developerResponseBody.hidden = runtime.developerResponseSimulatorFolded;
    }
    const context = runtime.developerContextPreview || payloadBuilder.buildLocalDeveloperContextPreview();
    const contextText = runtime.developerContextPreviewText
      || developerToolsModule.formatDeveloperVisibleContext(context);
    if (dom.developerVisibleContext && dom.developerVisibleContext.value !== contextText) {
      dom.developerVisibleContext.value = contextText;
    }
    const summary = developerToolsModule.summarizeDeveloperVisibleContext(context);
    if (dom.developerResponseSummary) {
      const provider = summary.provider || 'provider';
      const model = summary.model ? ` / ${summary.model}` : '';
      const turns = Number(summary.conversation_turns) || 0;
      dom.developerResponseSummary.textContent = `${provider}${model} | ${turns} turn${turns === 1 ? '' : 's'}`;
    }
    if (dom.developerResponseHint && !trimText(dom.developerResponseHint.textContent, 120)) {
      dom.developerResponseHint.textContent = runtime.developerContextPreview?.local === false
        ? 'Backend context ready.'
        : 'Local context preview.';
    }
  }

  async function refresh() {
    if (state.settings?.agent?.developerMode !== true) {
      setStatus('Enable Agent Developer Mode to inspect agent context.');
      return null;
    }
    ensureAgentState();
    if (dom.developerRefreshContextBtn) {
      dom.developerRefreshContextBtn.disabled = true;
    }
    if (dom.developerResponseHint) {
      dom.developerResponseHint.textContent = 'Refreshing context...';
    }
    try {
      const { projectId } = payloadBuilder.getCurrentProjectDetails();
      const stateSnapshot = await buildSyncedStateSnapshot(projectId);
      const payload = payloadBuilder.buildDeveloperContextPreviewPayload(stateSnapshot);
      const result = api?.agentDeveloperContextPreview
        ? await api.agentDeveloperContextPreview(payload)
        : null;
      const context = result?.ok
        ? { ...result, local: false, updated_at: result.updated_at || new Date().toISOString() }
        : payloadBuilder.buildLocalDeveloperContextPreview();
      runtime.developerContextPreview = context;
      runtime.developerContextPreviewText = developerToolsModule.formatDeveloperVisibleContext(context);
      if (dom.developerResponseHint) {
        dom.developerResponseHint.textContent = result?.ok ? 'Backend context ready.' : 'Local context preview.';
      }
      render();
      setStatus('Developer context refreshed.');
      return context;
    } catch (error) {
      const context = payloadBuilder.buildLocalDeveloperContextPreview();
      runtime.developerContextPreview = {
        ...context,
        error: String(error?.message || error)
      };
      runtime.developerContextPreviewText = developerToolsModule.formatDeveloperVisibleContext(
        runtime.developerContextPreview
      );
      if (dom.developerResponseHint) {
        dom.developerResponseHint.textContent = `Context refresh failed: ${String(error?.message || error)}`;
      }
      render();
      setStatus('Error.');
      return runtime.developerContextPreview;
    } finally {
      if (dom.developerRefreshContextBtn) {
        dom.developerRefreshContextBtn.disabled = runtime.inFlight;
      }
    }
  }

  return {
    invalidate,
    refresh,
    render
  };
}
