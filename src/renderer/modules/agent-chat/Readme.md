# Agent Chat Module Structure

`index.js` is the public renderer entry point. It wires dependencies together and keeps the exported contract stable:

- `initAgentChat(...)`
- `mapExperimentDataToLlmJson(...)`

Other features mount their own chat instances through `public-api.js` (`initAgentChat`, `createScopedAgentChatState`): the side rail in Notebook, Plate, and Papers, and Home's **Prepare notebook page** dialog.

The rest of the folder is split by responsibility:

- `dom-bindings.js`: collects DOM nodes for `agent-view.html`.
- `shell-controller.js`: shared UI state, render calls, scroll behavior, status text, and in-flight locking.
- `runtime-state.js`, `render-cycle.js`: per-instance runtime state and the render pass.
- `scoped-state.js`: a scoped view of shared state for rail and Home instances (independent history, scope context).
- `event-bindings.js`: DOM event listeners that connect controls to controllers.
- `composer-attachments.js`: file/image attachment state, rendering, and request text summaries.
- `payload-builder.js`: request envelopes for agent IPC.
- `state-sync.js`: pre-request data autosave and state snapshot creation.
- `agent-request-controller.js`: normal send, stop, live-progress persistence, and assistant response persistence.
- `live-progress-text.js`, `live-progress-state.js`, and `live-progress-clone.js`: live agent progress labels, row updates, and trace row cloning.
- `activity-formatting.js`: requested-activity inference and stage labels for progress rows.
- `assistant-questions.js`: Codex clarification question state and next-turn answer submission.
- `history-actions.js` and `history-notebook-actions.js`: click handlers for rendered chat actions and notebook draft actions.
- `rendering.js`: public `renderHistory(...)` entry point for chat history rendering.
- `html-history.js`: patches the conversation without resetting open disclosures, selection, or live HTML frames.
- `html-artifacts.js`, `image-artifacts.js`, `plotly-artifacts.js`: inline HTML (sandboxed `hikari-html://` frames), image, and Plotly artifact rendering.
- `paper-evidence-card.js` and `paper-evidence-reader.js`: the main Agent chat's right-side Evidence card. Groups `meta.paper_evidence` by paper and section, showing one exact passage with its relevance comment and saved notes at a time. Section tabs and previous/next controls retain the active passage during updates. Paper/card disclosures remain available. The source action validates the active passage against reader evidence and opens the downloaded paper through the shared Papers citation callback. The reader follows the current conversation and stacks below the chat in narrow windows.
- `rendering-drafts.js`, `notebook-draft-list.js`: notebook draft cards and draft lookup.
- `assistant-message-meta.js`: builds persisted assistant response and error messages.
- `icons.js`: the chat's SVG icon set.
- `rendering-attachments.js`: user attachment pill rendering.
- `rendering-empty-state.js`: empty chat prompt rendering.
- `rendering-meta.js`: assistant metadata panels and action sections.
- `rendering-purchase.js`: purchase recommendation tiles.
- `rendering-python.js`: Python sandbox output collection and cards.
- `rendering-question-card.js`: clarification card markup.
- `rendering-time.js`: timestamp formatting.
- `rendering-trace.js`, `rendering-trace-rows.js`, `rendering-trace-normalizers.js`: generated trace rendering and row normalization.
- `response.js` and `response/`: agent result normalization, activity rows, and assistant text summaries.
- `public-api.js`: deliberate surface for other renderer features (chat mounting, response helpers).
- `review-overlay.js` and `review-overlay/`: generic approval/rejection presentation dispatched through feature-owned adapters.
- `session-manager.js`, `session-loading.js`, `session-folders.js`, `session-folder-menu.js`: persistent chat session list, folders (with rename and right-click menu), load, create, and refresh logic.
- `shared.js`, `text.js`: common text, array, mapping, and tool-label helpers.
- `state-snapshot.js`, `context-mappers.js`, `experiment-llm-mapper.js`: thin Hikari state snapshot and experiment-data mapping.
- `markdown.js`: small markdown renderer used by chat output.
- `locales/en.js`, `locales/es.js`, `localization.js`: the `agent` UI catalog, bound markup/status helpers (`agentUi()`
  descriptors, an English-only translator for status-pill tone) and folder disclosure labels.
  Messages, meta, session/folder names, prompts sent to the agent and persisted review reasons
  stay canonical. The bundled Spanish preview has interaction checks
  in `tests/fixtures/i18n/agent-checks.mjs`. Live progress, trace, Python and purchase rendering are a later batch.

Notebook-draft normalization and persistence live in `modules/biology-notebook/agent/`; generated-protocol normalization and persistence live in `modules/protocol/agent/`. Agent Chat renders and dispatches those review items through the feature adapters without owning either record schema.

Citation evidence is collected from paper and record lookup tools before display previews are shortened. The main request handler saves it with assistant messages, including stopped or failed turns, so the card restores when a chat is reopened.

Paper citations support angle-bracket Markdown destinations containing spaces and physical line suffixes (`:42` or `#L42-L44`). A citation to reader-returned evidence renders as a compact numbered button after the supported statement, with the paper title and section in its accessible label and tooltip. Clicks use `onOpenPaperCitation` to navigate inside Papers. `papers/citation-navigation.js` resolves the downloaded PDF from the library record linked to the source folder, which follows library moves, then from `meta.json`, which keeps the ingest location. A paper that is already open keeps its zoom instead of reloading. The PDF viewer finds and temporarily highlights the exact cited text, tolerating line wraps, hyphens and ligatures. Substantial phrase matching handles long paragraphs; unmatched text is reported in the viewer rather than jumping to a keyword. Citation highlights never become saved annotations. Resolution follows the current storage root and earlier assistant evidence in the same chat, including saved chats. Unknown local paths, unreturned line numbers, traversal paths and arbitrary file URLs remain inert. MCP paper result shaping preserves `source_absolute_path` so new answers can cite the reader's actual file without guessing a root.

Protocol and notebook citations use the `citation_target` from `protocol_lookup` or `notebook_lookup`. These links share the numbering and conversation evidence checks used by paper citations. Cited records appear in Evidence with a preview when text is available. The source opens the saved protocol in its detail view or the saved notebook page.

When adding behavior, prefer putting it near the controller that owns the interaction, then importing pure helpers from `shared.js`, `response.js`, or an owning feature's public adapter. Keep `index.js` as composition glue only.
