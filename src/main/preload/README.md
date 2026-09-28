# Preload bridge

`../preload.js` exposes one object, `window.hikariApi`, through
`contextBridge.exposeInMainWorld`. It is the renderer's only way into the main
process; plugin frames never see it (they use the permission-gated
`postMessage` bridge in `src/renderer/app/plugin-bridge.js`).

`create-preload-api.js` builds the object by spreading one domain API per file
in `api/`, plus `platform` (`process.platform`):

| File | Methods (examples) | Channel group |
| --- | --- | --- |
| `storage-api.js` | `autoSaveDataFile`, `importStorageRoot`, `pickStorageDirectory`, `storeImportedFile`, `readFileBytes`, `transformStoredPaperPdf`, `onProtocolRecordSaved`, `onPaperFileSaved` | `STORAGE` |
| `system-api.js` | `openExternalUrl`, `openLogsFolder`, `openThirdPartyNotices`, `reportError`, `onAppCloseRequested`, `respondToAppClose` | `SYSTEM` |
| `plugin-api.js` | `inspectPluginFolder`, `servePluginFolder`, `readPluginFile`, `writePluginFile`, `exportPluginFile` | `PLUGINS` |
| `chemical-clipboard-api.js` | `readChemicalClipboard`, `writeTextToClipboard` | none (Electron `clipboard` / `nativeImage` in the preload) |
| `assay-api.js` | `parseAssayResultImportFile`, `onAssayPlotRequest`, `respondToAssayPlotRequest` | `ASSAY` |
| `inventory-api.js` | `parseChemicalImportFile` | `INVENTORY` |
| `sequence-library-api.js` | `sequenceLibraryList`, `sequenceLibraryUpsert`, `sequenceLibrarySearchFeatures`, … | `SEQUENCE_LIBRARY` |
| `genome-api.js` | `listGenomes`, `addGenome`, `readGenomeRegion`, … | `GENOME` |
| `bioinformatics-api.js` | `submitBlast`, `getBlastResults`, `searchUniProt`, … | `BIOINFORMATICS` |
| `scheduled-task-api.js` | `listScheduledTasks`, `runScheduledTask`, `createPaperFindingTask`, `schedulePaperFinding`, `downloadFoundPaper`, … | `SCHEDULED_TASK`, `PAPER_FINDING` |
| `llm-api.js` | `getCodexLlmStatus`, `loginCodexLlm`, `setCodexLlmModel`, `getCodexDesktopMcpSetupPrompt`, `runDirectLlmPrompt`, … | `LLM` |
| `python-api.js` | `runPython` | `PYTHON` |
| `agent-api.js` | `agentChat`, `agentChatCancel`, `onAgentProgress`, `agentGenerateProtocol`, `suggestNextExperiment`, `agentHtmlPreview`, … | `AGENT` |

Channel names come from `src/shared/ipc/channels.js`; the main-process handlers
are listed in [docs/main-platform/ipc/ipc-registrars.md](../../../docs/main-platform/ipc/ipc-registrars.md).

Rules:

- One file per domain. A new capability gets a channel in `channels.js`, a
  handler in the owning registrar, and a method here — then a spread in
  `create-preload-api.js` if it is a new file.
- Keep this layer thin: shape the payload and call `ipcRenderer.invoke` (or
  subscribe with `ipcRenderer.on` and return an unsubscribe function). No
  business logic, no filesystem access.
- The preload is split across CommonJS files, which Electron loads because
  the window disables the preload sandbox; the renderer itself stays isolated
  (see `src/main/windows/create-main-window.js`).
