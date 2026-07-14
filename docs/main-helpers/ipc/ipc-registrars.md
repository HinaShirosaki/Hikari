# IPC Registrars

IPC registration lives in `src/main/ipc/` (it moved out of `src/main/helpers/main`). The goal is the same: keep `ipcMain.handle(...)` calls out of the boot file and group them by capability family.

The three registrar functions remain independently callable. The main service catalog invokes them from dependency-specific IPC adapter services:

```js
registerDataIpc(dataDependencies);
registerAgentIpc(agentDependencies);
registerSystemIpc(systemDependencies);
```

There is no compatibility aggregator. `src/main/core/main-services.js` imports each registrar directly so dependency wiring remains explicit.

## Channel source of truth

Channel strings are defined once in [`src/shared/ipc/channels.js`](../../../src/shared/ipc/channels.js) and shared between the main and preload processes. Renderer code does **not** import that module directly — it goes through the typed surface in `src/main/preload/api/*`. A couple of channel names keep legacy prefixes (e.g. `STORAGE.AUTO_SAVE` is the string `data:auto-save`, not `storage:...`); those quirks are flagged inline in `channels.js`.

## `register-data-ipc.js`

The non-agent application data API. Channels come from the `STORAGE`, `SEQUENCE_LIBRARY`, `INVENTORY`, and `ASSAY` groups.

**Data file + storage helpers (`STORAGE.*`):**

- `data:auto-save` (legacy prefix), `storage:sync-sqlite-bundle`
- `storage:pick-directory`, `storage:ensure-directory`, `storage:import-root`
- `storage:store-imported-file`, `storage:write-json-file`, `storage:open-file`
- `storage:read-file-bytes`, `storage:read-file-base64`
- `storage:append-notebook-page-log`, `storage:discover-papers`
- `storage:protocol-record-saved` (main → renderer notification)

`storage:import-root` calls `importStorageRoot(...)` from `helpers/main/storage-bundle/`, producing a merged summary plus a `hikari-storage-manifest.json` for an existing storage directory.

**Import parsers:**

- `inventory:parse-chemical-import` → `chemical-import-parser.js`
- `assay:parse-result-import` → assay result-import detection

**Sequence library (`register-data-ipc/register-sequence-library-ipc.js`, `SEQUENCE_LIBRARY.*`):**

- `sequence-library:list`, `:get`, `:upsert`, `:promote`, `:delete`
- `sequence-library:search-features`, `:annotate`
- `sequence-library:list-backbones`, `:upsert-backbone`, `:recognize-backbone`

The sequence endpoint group has its own registrar file so the top-level data registrar stays readable. It validates payloads while domain logic lives in `src/renderer/modules/sequence-viewer/main-process/sequence-library/`.

## `register-system-ipc.js`

Settings/system endpoints from the `LLM`, `TELEGRAM`, and `SYSTEM` groups.

**Codex CLI + direct LLM (`LLM.*`):**

- `llm:codex-status`, `llm:codex-catalog`, `llm:codex-login`, `llm:codex-clear-login`
- `llm:codex-set-model`, `llm:codex-set-reasoning-effort`, `llm:codex-generate`
- `llm:direct-modules`, `llm:direct-generate`

The Codex endpoints wrap the Codex CLI provider helpers. The direct endpoints expose the registered module-level LLM surface (`helpers/main/llm/direct-llm-module-registry.js`) for app modules that need provider-backed text/file generation without entering the agent chat controller.

**Telegram (`TELEGRAM.*`):**

- `telegram:get-config`, `telegram:set-token`, `telegram:clear-token`

These coordinate saved token state plus `restartTelegramBot()`; they do not implement the bot.

**System (`SYSTEM.*`):**

- `system:open-external-url`

## `register-agent-ipc/`

Now a folder (`src/main/ipc/register-agent-ipc/`), not a single file. It is the third registrar, but its internal logic belongs to the agent subsystem. Channels come from the `AGENT` group:

- `agent:chat`, `agent:chat:cancel`, `agent:list-skills`, `agent:generate-protocol`
- `agent:chat-log:create-session`, `:list-sessions`, `:get-session`
- `agent:developer:test-tools`, `agent:developer:context-preview`
- `agent:logs:list-requests`, `agent:logs:replay`
- plus the `agent-progress` one-way broadcast (main → renderer)

`index.js` composes the handlers from `agent-lifecycle-service.js`, `agent-controller-core.js`, `agent-chat-handler.js`, and `agent-log-handlers.js`. Use the dedicated walkthrough at [agent/architecture/request-lifecycle.md](../../agent/architecture/request-lifecycle.md) for the request flow.

## Practical takeaway

When adding a renderer-facing capability, the first question is “which registrar owns this family?”:

- data / storage / import parsers → `register-data-ipc.js`; sequence endpoints → its `register-data-ipc/` child package
- chat / assistant / log replay → `register-agent-ipc/`
- Codex CLI, direct LLM, Telegram, or open-external-url → `register-system-ipc.js`

Then add the channel to `src/shared/ipc/channels.js` and wire the typed preload surface.
