import { normalizeScopeKey } from '../app-state/agent-chat-normalizer.js';
import { asArray } from './shared.js';

export function createAgentPlotReplay({ state, runtime, onPlotlyGraphArtifact }) {
  let lastSelection = '', lastFigure = '';
  const selection = () => `${normalizeScopeKey(state.agentChatContext || {})}:${state.agentChat.currentSessionId || ''}`;

  function deliver(artifact, payload) {
    const key = selection(), figure = JSON.stringify(artifact);
    if (key === lastSelection && figure === lastFigure) return true;
    // Mark before the callback: rendering can synchronously refresh the rail.
    lastSelection = key;
    lastFigure = figure;
    if (onPlotlyGraphArtifact(artifact, payload) === false) {
      lastFigure = '';
      return false;
    }
    return true;
  }

  function replay() {
    const key = selection();
    if (key !== lastSelection) { lastSelection = key; lastFigure = ''; }
    const context = state.agentChatContext || {};
    if (context.scopeType !== 'assay') return;
    const request = [...(runtime.activeRequests?.values() || [])].find((item) =>
      item.sessionId === state.agentChat.currentSessionId
      && (!item.scopeKey || item.scopeKey === normalizeScopeKey(context)));
    const live = asArray(request?.liveAssistantMessage?.meta?.plotly_graph_artifacts).at(-1);
    const saved = [...asArray(state.agentChat.messages)].reverse()
      .map((message) => asArray(message.meta?.plotly_graph_artifacts).at(-1)).find(Boolean);
    if (live || saved) deliver(live || saved);
  }

  return { deliver, replay };
}
