# Agent Chat Module Structure

`index.js` is the public renderer entry point. It wires dependencies together and keeps the exported contract stable:

- `initAgentChat(...)`
- `mapExperimentDataToLlmJson(...)`

The rest of the folder is split by responsibility:

- `dom-bindings.js`: collects DOM nodes for `agent-view.html`.
- `shell-controller.js`: shared UI state, render calls, scroll behavior, status text, and in-flight locking.
- `event-bindings.js`: DOM event listeners that connect controls to controllers.
- `composer-attachments.js`: file/image attachment state, rendering, and request text summaries.
- `payload-builder.js`: request envelopes for agent IPC and developer context previews.
- `state-sync.js`: pre-request data autosave and state snapshot creation.
- `agent-request-controller.js`: normal send, stop, live-progress persistence, and assistant response persistence.
- `live-progress-text.js` and `live-progress-state.js`: live agent progress labels, row updates, and trace row cloning.
- `assistant-questions.js`: Codex clarification question state and next-turn answer submission.
- `history-actions.js` and `history-notebook-actions.js`: click handlers for rendered chat actions and notebook draft actions.
- `developer-context.js`: developer context preview rendering and backend refresh.
- `developer-mock-response.js`: developer-mode mock response injection.
- `developer-tool-tests.js`: developer-mode manual tool smoke tests.
- `developer-tools.js`: pure helpers for developer previews and tool-test message rendering.
- `rendering.js`: public `renderHistory(...)` entry point for chat history rendering.
- `rendering-attachments.js`: user attachment pill rendering.
- `rendering-empty-state.js`: empty chat prompt rendering.
- `rendering-meta.js`: assistant metadata panels and action sections.
- `rendering-purchase.js`: purchase recommendation tiles.
- `rendering-python.js`: Python sandbox output collection and cards.
- `rendering-question-card.js`: clarification card markup.
- `rendering-time.js`: timestamp formatting.
- `rendering-trace.js`, `rendering-trace-rows.js`, `rendering-trace-normalizers.js`: generated trace rendering and row normalization.
- `response.js`: agent result normalization and assistant text summaries.
- `session-manager.js`: persistent chat session list, load, create, and refresh logic.
- `shared.js`: common text, array, mapping, and tool-label helpers.
- `state-snapshot.js`: thin Hikari state snapshot and experiment-data mapping.
- `markdown.js`: small markdown renderer used by chat output.
- `notebook-drafts.js`: notebook draft normalization and persistence helpers.

When adding behavior, prefer putting it near the controller that owns the interaction, then importing pure helpers from `shared.js`, `response.js`, or the existing domain helper file. Keep `index.js` as composition glue only.
