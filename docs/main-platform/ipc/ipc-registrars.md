# IPC Registrars

IPC registration lives in `src/main/ipc/`. The goal is to keep `ipcMain.handle(...)` calls out of the boot file and group them by capability family.

There are eight registrar functions. `src/main/core/main-services.js` imports each one directly and calls it with only the dependencies it needs, so wiring stays explicit:

```js
registerPluginIpc(pluginDependencies);
registerDataIpc(dataDependencies);
registerAgentIpc(agentDependencies);
registerGenomeIpc(genomeDependencies);
registerBioinformaticsIpc(bioinformaticsDependencies);
registerScheduledTaskIpc(scheduledTaskDependencies);
registerPythonIpc(pythonDependencies);
registerSystemIpc(systemDependencies);
```

There is no compatibility aggregator. Three more handlers are installed outside `src/main/ipc/` because they belong to a single service: the agent HTML preview (`AGENT.HTML_PREVIEW`, in `src/main/agent/html-output/preview-service.js`), the assay plot bridge (`ASSAY.PLOT_REQUEST` / `PLOT_RESPONSE`, in `src/main/core/services/assay-plot-bridge.js`), and the plugin canvas bridge that carries `plugin_canvas` MCP calls to plugin frames (`PLUGINS.CANVAS_REQUEST` / `CANVAS_RESPONSE`, in `src/main/core/services/plugin-canvas-bridge.js`).

## Channel source of truth

Channel strings are defined once in [`src/shared/ipc/channels.js`](../../../src/shared/ipc/channels.js) and shared between the main and preload processes. Renderer code does **not** import that module directly — it goes through the typed surface in `src/main/preload/api/*`. A couple of channel names keep legacy prefixes (e.g. `STORAGE.AUTO_SAVE` is the string `data:auto-save`, not `storage:...`, and `AGENT_PROGRESS_EVENT` is `agent-progress`); those quirks are flagged inline in `channels.js`.

## Summary

| Registrar | Channel groups | Preload API | Backing code |
| --- | --- | --- | --- |
| `register-data-ipc.js` (+ `register-data-ipc/`) | `STORAGE`, `INVENTORY`, `ASSAY` (parse), `SEQUENCE_LIBRARY` | `storage-api`, `inventory-api`, `assay-api`, `sequence-library-api` | `data/`, `storage/`, `papers/parse`, `lib/chemical-import-parser.js`, sequence library |
| `register-plugin-ipc.js` | `PLUGINS` | `plugin-api` | `lib/inspect-plugin-folder.js`, `lib/plugin-server.js`, `lib/plugin-files.js` |
| `register-agent-ipc/` | `AGENT` (+ `agent-progress` broadcast) | `agent-api` | `src/main/agent/` |
| `register-genome-ipc.js` | `GENOME` | `genome-api` | `genome/` |
| `register-bioinformatics-ipc.js` | `BIOINFORMATICS` | `bioinformatics-api` | `bioinformatics/` |
| `register-scheduled-task-ipc.js` | `SCHEDULED_TASK`, `PAPER_FINDING` | `scheduled-task-api` | `scheduled-tasks/`, `papers/finding/` |
| `register-python-ipc.js` | `PYTHON` | `python-api` | `agent/tools/agent-python-sandbox/` |
| `register-system-ipc.js` | `LLM`, `SYSTEM` | `llm-api`, `system-api` | `lib/codex-cli-provider/`, `lib/llm/`, `lib/error-reporting.js` |

The preload's `chemical-clipboard-api` has no channel: it calls Electron's `clipboard` directly from the preload script.

## `register-data-ipc.js`

The non-agent application data API. Channels come from the `STORAGE`, `SEQUENCE_LIBRARY`, `INVENTORY`, and `ASSAY` groups.

**Data file + storage helpers (`STORAGE.*`):**

- `data:auto-save` (legacy prefix), `storage:sync-sqlite-bundle` (chemicals index only)
- `storage:pick-directory`, `storage:ensure-directory`, `storage:import-root`, `storage:last-root`
- `storage:store-imported-file`, `storage:move-stored-file`, `storage:write-json-file`, `storage:open-file`
- `storage:read-file-bytes`, `storage:read-file-base64`
- `storage:transform-paper-pdf` (PDF → Markdown under `KnowledgeBase/papers.md/`), `storage:discover-papers`
- `storage:append-notebook-page-log`

`storage:import-root` calls `importStorageRoot(...)` from `storage/`, producing a merged summary plus a `recognized` flag (whether the folder already has Hikari's layout), `lastSavedAt` (newest snapshot's mtime), and any `alerts` (for example, an unreadable chemicals index that was moved aside). `storage:last-root` reads the `Config/last-storage-root.json` pointer in the app-data folder so startup can find the workspace after renderer storage is cleared.

Two `STORAGE` channels are main → renderer broadcasts rather than handlers. The agent services send them when a tool writes app data: `storage:protocol-record-saved` (a protocol the agent saved) and `storage:paper-file-saved` (a paper PDF the agent downloaded).

The filesystem work behind these handlers (storage-root confinement through `lib/path-safety.js`, the last-root pointer, stored-file moves, and the paper PDF → Markdown transform) lives in `register-data-ipc/storage-files.js`.

**Import parsers:**

- `inventory:parse-chemical-import` → `lib/chemical-import-parser.js`
- `assay:parse-result-import` → assay result-import detection

**Sequence library (`register-data-ipc/register-sequence-library-ipc.js`, `SEQUENCE_LIBRARY.*`):**

- `sequence-library:list`, `:get`, `:upsert`, `:promote`, `:delete`, `:agent-artifact`
- `sequence-library:upsert-folder`, `:delete-folder`, `:move-entry`
- `sequence-library:search-features`, `:annotate`
- `sequence-library:list-backbones`, `:upsert-backbone`, `:recognize-backbone`

The sequence endpoint group has its own registrar file so the top-level data registrar stays readable. It validates payloads while domain logic lives in `src/renderer/modules/sequence-viewer/main-process/sequence-library/`.

## `register-plugin-ipc.js`

Plugin folder inspection, serving, and file access (`PLUGINS.*`):

- `plugins:inspect-folder` — validates a folder against the manifest contract (`lib/inspect-plugin-folder.js`)
- `plugins:serve-folder` — serves a plugin folder on its own loopback origin (`lib/plugin-server.js`)
- `plugins:read-file`, `plugins:write-file` — read and write files confined to `Plugins/<plugin-id>/` under the storage root; `..`, absolute paths, and symlinks are rejected (`lib/plugin-files.js`)
- `plugins:export-file` — save a plugin-produced file through a native save dialog

The renderer's plugin bridge (`src/renderer/app/plugin-bridge.js`) is the only caller; plugin iframes never see the preload API. See [docs/plugins/](../../plugins/README.md).

## `register-agent-ipc/`

A folder (`src/main/ipc/register-agent-ipc/`), not a single file. Its internal logic belongs to the agent subsystem. Channels come from the `AGENT` group:

- `agent:chat`, `agent:chat:cancel`
- `agent:list-skills`, `agent:generate-protocol`, `agent:suggest-experiment`
- `agent:chat-log:create-session`, `:list-sessions`, `:get-session`
- `agent:logs:list-requests`, `agent:logs:replay`
- plus the `agent-progress` one-way broadcast (main → renderer), sent from `src/main/agent/runtime/agent-chat-request.js`

`index.js` composes the handlers from `agent-lifecycle-service.js`, `agent-controller-core.js`, `agent-chat-handler.js`, and `agent-log-handlers.js`. Use the dedicated walkthrough at [agent/architecture/request-lifecycle.md](../../agent/architecture/request-lifecycle.md) for the request flow.

## `register-genome-ipc.js`

`genome:list`, `:get`, `:add`, `:remove`, `:read-region` (`GENOME.*`). `genome:add` opens a native file dialog in main, so a genome path never comes from the renderer. The registry is `Config/genome-library.json` in the storage root, and `genome/fasta-index.js` builds the index used for region reads. No renderer feature calls these channels today.

## `register-bioinformatics-ipc.js`

`bioinformatics:blast-submit`, `:blast-status`, `:blast-results`, `:uniprot-search`, `:uniprot-get` (`BIOINFORMATICS.*`). Each handler forwards to `bioinformatics/` (NCBI BLAST and UniProt REST clients) and wraps failures in a fixed user-facing message. No renderer feature calls these channels today; the agent tool smoke test exercises them.

## `register-scheduled-task-ipc.js`

Generic scheduled Codex tasks (`SCHEDULED_TASK.*`: `scheduled-task:list`, `:get`, `:create`, `:update`, `:delete`, `:run`) and the paper-finding tasks built on them (`PAPER_FINDING.*`: `paper-finding:list`, `:create`, `:update`, `:schedule`, `:download`). Task definitions persist in `Config/scheduled-tasks.json` in the storage root. The Home **Paper finder** widget and the Notebook project paper finder are the callers.

## `register-python-ipc.js`

One channel, `python:run` (`PYTHON.*`), exposed to the renderer as `hikariApi.runPython({ code, files, readback_paths, timeout_ms })`.

It hands the payload to the same sandbox runner the agent's `run_python_sandbox` tool uses (`agent/tools/agent-python-sandbox/runner.js`), so a run gets its own throwaway directory under the sandbox root and that directory is deleted when the run ends. `files` and `readback_paths` are resolved inside that directory — the channel never accepts a filesystem path, and plugins do not reach it, since the plugin bridge exposes its own verb table rather than the preload surface. Covered by `tests/python-ipc-selfcheck.mjs`.

## `register-system-ipc.js`

Settings/system endpoints from the `LLM` and `SYSTEM` groups.

**Codex CLI + direct LLM (`LLM.*`):**

- `llm:codex-status`, `llm:codex-catalog`, `llm:codex-login`, `llm:codex-clear-login`
- `llm:codex-set-model`, `llm:codex-set-reasoning-effort`, `llm:codex-generate`
- `llm:codex-desktop-mcp-prompt` — writes the live Hikari MCP config block and returns the prompt that **Settings > Codex > Connect Codex Desktop** copies (`agent/codex-agent/desktop-mcp-prompt.js`)
- `llm:direct-modules`, `llm:direct-generate`

The Codex endpoints wrap the Codex CLI provider helpers. The direct endpoints expose the registered module-level LLM surface (`lib/llm/direct-llm-module-registry.js`) for app modules that need provider-backed text/file generation without entering the agent chat controller.

**System (`SYSTEM.*`):**

- `system:open-external-url`
- `system:report-error` (one-way; appends renderer errors to `Logs/errors.log` through `lib/error-reporting.js`)
- `system:open-logs-folder`, `system:open-third-party-notices`
- `system:update-status`, `system:check-for-updates`, `system:install-update` — **Settings > Updates**, backed by the npm updater (`updater/create-npm-updater-service.js`). A manual check never shows the update dialog; install builds what the last check found and restarts the app, so it only resolves if the build fails
- `system:app-close-requested` / `system:app-close-response` — the unsaved-changes quit handshake, driven from `app/start-main-app.js`

## Practical takeaway

When adding a renderer-facing capability, the first question is “which registrar owns this family?”:

- data / storage / import parsers → `register-data-ipc.js`; sequence endpoints → its `register-data-ipc/` child package
- plugin folders and plugin file access → `register-plugin-ipc.js`
- chat / assistant / log replay → `register-agent-ipc/`
- scheduled Codex tasks or paper finding → `register-scheduled-task-ipc.js`
- reference genomes → `register-genome-ipc.js`; remote BLAST/UniProt → `register-bioinformatics-ipc.js`
- Codex CLI, direct LLM, error reporting, or OS integrations → `register-system-ipc.js`
- running Python → `register-python-ipc.js`

Then add the channel to `src/shared/ipc/channels.js`, wire the typed preload surface in `src/main/preload/api/`, and spread it in `preload/create-preload-api.js`.
