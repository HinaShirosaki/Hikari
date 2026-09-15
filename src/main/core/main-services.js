'use strict';

const {
  hasSupportedDataExtension,
  normalizeDataFilePath
} = require('../lib/main-utils');
const {
  clearCodexCliStoredLogin,
  getCodexCliCatalog,
  launchCodexCliLogin,
  getCodexCliModel,
  getCodexCliReasoningEffort,
  getCodexLoginStatus,
  setCodexCliModel,
  setCodexCliReasoningEffort,
  requestCodexCliText
} = require('../lib/codex-cli-provider');
const {
  LLM_PROVIDERS,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_ENDPOINTS,
  DEFAULT_AGENT_MODELS,
  inferLlmProviderFromEndpoint,
  normalizeLlmProvider,
  normalizeAgentLlmProvider,
  defaultLlmEndpointForProvider,
  defaultAgentModelForProvider
} = require('../generated/codex-model-catalog.generated.js');
const { defaultCleanText } = require('../lib/llm/runtime-helpers.js');
const { appendLogWithRotation } = require('../agent/shared/agent-observability');
const { createMainAppPaths } = require('../lib/app-paths.js');
const { createErrorReporting } = require('../lib/error-reporting.js');
const { createMainAgentServices } = require('./services/create-agent-services.js');
const { createMainDataHelpers } = require('../data/data-helpers');
const {
  discoverPapersFromStorageRoot,
  getBundlePaths,
  syncBundleFromSnapshot: syncBundleFromSnapshotBase,
  syncSqliteBundleFromSnapshot,
  hydrateSnapshotFromBundle,
  importStorageRoot
} = require('../storage/index.js');
const {
  releaseOfficialMcpSkillsForWorkspace
} = require('../agent/codex-agent/official-mcp-skills.js');
const {
  transformPaperRecordsToMarkdown
} = require('../papers/parse/paper-markdown-import.js');
const {
  normalizePaperFindingRunResult
} = require('../papers/finding/paper-finding-task.js');
const {
  listSequenceEntries,
  getSequenceEntry,
  upsertSequenceEntry,
  promoteSequenceEntry,
  deleteSequenceEntry,
  upsertSequenceFolder,
  deleteSequenceFolder,
  moveSequenceEntryToFolder,
  annotateSequenceRecord,
  searchSequenceFeatures,
  listRecognizedBackbones,
  upsertRecognizedBackbone,
  recognizeSequenceBackbone
} = require('../../renderer/modules/sequence-viewer/main-process/sequence-library');
const { buildCompactIndexedSnapshot } = require('../data/data-snapshot-utils');
const { createChatLogTransformMonitor } = require('../lib/llm/chat-log-transformer.js');
const { createBioinformaticsService } = require('../bioinformatics');
const { createAgentLogService } = require('./services/create-agent-log-service');
const { createNpmUpdaterService } = require('./services/create-npm-updater-service');
const { createMainMcpService } = require('./services/create-mcp-service');
const { createMainCodexService } = require('./services/create-codex-service');
const { createGenomeService } = require('./services/create-genome-service');
const { createNotebookSuggestionService } = require('./services/create-notebook-suggestion-service');
const { createScheduledTaskService } = require('./services/create-scheduled-task-service');
const { registerDataIpc } = require('../ipc/register-data-ipc');
const { registerAgentIpc } = require('../ipc/register-agent-ipc');
const { registerBioinformaticsIpc } = require('../ipc/register-bioinformatics-ipc');
const { registerGenomeIpc } = require('../ipc/register-genome-ipc');
const { registerPythonIpc } = require('../ipc/register-python-ipc');
const { registerScheduledTaskIpc } = require('../ipc/register-scheduled-task-ipc');
const { registerSystemIpc } = require('../ipc/register-system-ipc');
const { runPythonSandbox } = require('../agent/tools/agent-python-sandbox.js');

const AGENT_CHAT_LOG_FILE_NAME = 'agent-chat.log';
const DEFAULT_DATA_FILE_NAME = 'hikari-data.json';
const PROJECT_MEMORY_NOTEBOOK_MODEL = 'gpt-5.4-mini';

// Constructs every main-process service in dependency order and registers all
// IPC handlers. Construction and IPC registration are synchronous so they can
// run before app.whenReady(); async initialization happens in start().
function createMainServices(context = {}) {
  const {
    app,
    BrowserWindow,
    crashReporter,
    dialog,
    ipcMain,
    session,
    shell,
    fs,
    path,
    processObject,
    projectRoot,
    getMainWindow
  } = context;

  // App metadata and paths.
  const cleanText = defaultCleanText;
  const appPaths = createMainAppPaths({
    app,
    path,
    processObject,
    projectRoot,
    cleanText,
    defaultDataFileName: DEFAULT_DATA_FILE_NAME,
    agentChatLogFileName: AGENT_CHAT_LOG_FILE_NAME
  });
  const appIconPath = path.join(projectRoot, 'assets', 'icon.png');

  // First, so everything constructed below is already covered.
  const errorReporting = createErrorReporting({
    app,
    crashReporter,
    processObject,
    logPath: appPaths.getErrorLogPath(),
    appendLog: appendLogWithRotation,
    getMainWindow,
    dialog
  });
  errorReporting.install();
  let requestProjectMemoryConclusion = null;
  const syncBundleFromSnapshot = (input = {}) => syncBundleFromSnapshotBase({
    ...input,
    releaseOfficialMcpSkillsForWorkspace,
    requestProjectMemoryConclusion
  });

  // Storage.
  const mainDataHelpers = createMainDataHelpers({
    fs,
    path,
    cleanText,
    hasSupportedDataExtension,
    normalizeDataFilePath,
    syncBundleFromSnapshot,
    hydrateSnapshotFromBundle,
    serializeSnapshot: (snapshot) => JSON.stringify(buildCompactIndexedSnapshot(snapshot), null, 2),
    getDefaultDataFilePath: appPaths.getDefaultDataFilePath
  });

  // Agent logging and chat-log monitoring.
  const chatLogTransformMonitor = createChatLogTransformMonitor({ fs, path, cleanText });
  const agentLogService = createAgentLogService({ fs, path, appendLogWithRotation });
  const getAgentChatSessionStoragePath = (payload) => {
    const storagePath = appPaths.getAgentChatSessionStoragePath(payload);
    if (storagePath) {
      chatLogTransformMonitor.trackStoragePath(storagePath);
    }
    return storagePath;
  };

  const npmUpdater = createNpmUpdaterService({ app, dialog, shell, getMainWindow });

  // Provider-neutral agent foundation. Codex is constructed afterwards (it
  // needs the MCP service), so sub-agent delegation resolves it lazily.
  let codex = null;
  const agents = createMainAgentServices({
    LLM_PROVIDERS,
    DEFAULT_LLM_PROVIDER,
    DEFAULT_LLM_ENDPOINTS,
    DEFAULT_AGENT_MODELS,
    inferLlmProviderFromEndpoint,
    normalizeLlmProvider,
    normalizeAgentLlmProvider,
    defaultLlmEndpointForProvider,
    defaultAgentModelForProvider,
    cleanText,
    appendAgentChatLogEntry: agentLogService.appendAgentChatLogEntry,
    requestCodexCliText,
    getCodexCliWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
    getStorageRoot: appPaths.getStorageRoot,
    getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
    BrowserWindow,
    ipcMain,
    getAgentPythonSandboxRoot: appPaths.getAgentPythonSandboxRoot,
    getAgentMemoryFilePath: appPaths.getAgentMemoryFilePath,
    getBundlePaths,
    hydrateSnapshotFromBundle,
    syncBundleFromSnapshot,
    runSubAgentTurn: (input) => {
      if (!codex || typeof codex.runSubAgentTurn !== 'function') {
        throw new Error('Codex service is not ready for delegated sub-agent work.');
      }
      return codex.runSubAgentTurn(input);
    }
  });
  requestProjectMemoryConclusion = async (input = {}) => {
    const result = await agents.directLlmRegistry.requestModuleLlm({
      ...input,
      model: PROJECT_MEMORY_NOTEBOOK_MODEL,
      reasoningEffort: 'low'
    });
    return {
      ...result,
      model: PROJECT_MEMORY_NOTEBOOK_MODEL
    };
  };
  const transformPaperRecordsWithAgentRuntime = (input = {}) => transformPaperRecordsToMarkdown({
    ...input,
    paperKnowledgeDatabaseRuntime: agents.paperKnowledgeDatabaseRuntime
  });

  const mcp = createMainMcpService({
    agentToolRuntime: agents.agentToolRuntime,
    getWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
    processObject
  });

  codex = createMainCodexService({
    cleanText,
    requestCodexCliText,
    getCodexCliWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
    getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
    getCodexCliHomePath: appPaths.getCodexCliHomePath,
    getBundlePaths,
    syncBundleFromSnapshot,
    mcpService: mcp,
    agentFoundation: agents,
    processObject
  });

  const scheduledTasks = createScheduledTaskService({
    fs,
    path,
    cleanText,
    getScheduledTasksPath: appPaths.getScheduledTasksPath,
    runCodexTask: codex.runScheduledTask,
    normalizeRunResult: normalizePaperFindingRunResult
  });

  const genomes = createGenomeService({
    // The service uses fs.promises.*, so it needs the sync module, not fs/promises.
    fs: require('node:fs'),
    path,
    cleanText,
    getGenomeLibraryPath: appPaths.getGenomeLibraryPath,
    // The picker lives here so the service stays testable without Electron, and so a genome path
    // can only ever enter the library through a dialog the user drove themselves.
    pickGenomeFile: async () => {
      const result = await dialog.showOpenDialog({
        title: 'Select Genome FASTA File',
        properties: ['openFile'],
        filters: [
          { name: 'Genome FASTA', extensions: ['fa', 'fasta', 'fna', 'fas', 'ffn', 'seq'] }
        ]
      });
      if (result.canceled || !result.filePaths.length) {
        return { filePath: '' };
      }
      return { filePath: result.filePaths[0] };
    }
  });

  const bioinformatics = createBioinformaticsService({
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null,
    defaultNcbiEmail: cleanText(processObject?.env?.HIKARI_NCBI_EMAIL, 254)
  });

  // IPC registration (before app ready).
  registerDataIpc({
    ipcMain,
    session,
    dialog,
    shell,
    fs,
    cleanText,
    DEFAULT_DATA_FILE_NAME,
    hasSupportedDataExtension,
    mainDataHelpers,
    getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
    getStorageRootPointerPath: appPaths.getStorageRootPointerPath,
    setStorageRoot: async (root) => {
      if (!appPaths.setStorageRoot(root)) {
        return;
      }
      chatLogTransformMonitor.trackStoragePath(root);
      genomes.reload();
      await scheduledTasks.reload().catch((error) => {
        console.error('Failed to reload scheduled tasks from the new storage root:', error);
      });
    },
    getBundledPluginPath: (pluginId) => (
      pluginId === 'gel' ? path.join(projectRoot, 'src', 'plugins', 'gel') : ''
    ),
    paperKnowledgeDatabaseRuntime: agents.paperKnowledgeDatabaseRuntime,
    discoverPapersFromStorageRoot: (input = {}) => discoverPapersFromStorageRoot({
      ...input,
      transformPaperRecordsToMarkdown: transformPaperRecordsWithAgentRuntime
    }),
    syncSqliteBundleFromSnapshot,
    importStorageRoot: (input = {}) => importStorageRoot({
      ...input,
      transformPaperRecordsToMarkdown: transformPaperRecordsWithAgentRuntime
    }),
    listSequenceEntries,
    getSequenceEntry,
    upsertSequenceEntry,
    promoteSequenceEntry,
    deleteSequenceEntry,
    upsertSequenceFolder,
    deleteSequenceFolder,
    moveSequenceEntryToFolder,
    annotateSequenceRecord,
    searchSequenceFeatures,
    listRecognizedBackbones,
    upsertRecognizedBackbone,
    recognizeSequenceBackbone
  });

  registerAgentIpc({
    notebookSuggestionService: createNotebookSuggestionService({
      normalizeSnapshot: agents.agentToolRuntime.normalizeAgentSnapshot,
      codexAgentRuntime: codex.codexAgentRuntime,
      getWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
      getDefaultDataFilePath: appPaths.getDefaultDataFilePath
    }),
    ipcMain,
    LLM_PROVIDERS,
    cleanText,
    controllerUtils: agents.controllerUtils,
    observability: agents.observability,
    setCodexCliModel,
    setCodexCliReasoningEffort,
    codexAgentRuntime: codex.codexAgentRuntime,
    agentToolRuntime: agents.agentToolRuntime,
    agentChatLogRuntime: agents.agentChatLogRuntime,
    protocolGenerationRuntime: agents.protocolGenerationRuntime,
    getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
    getStorageRoot: appPaths.getStorageRoot,
    getAgentChatLogPath: appPaths.getAgentChatLogPath,
    getAgentChatSessionStoragePath,
    appendAgentChatLogEntry: agentLogService.appendAgentChatLogEntry
  });

  registerGenomeIpc({
    ipcMain,
    genomeService: genomes,
    cleanText
  });

  registerBioinformaticsIpc({
    ipcMain,
    bioinformaticsService: bioinformatics,
    cleanText
  });

  registerScheduledTaskIpc({
    ipcMain,
    scheduledTaskService: scheduledTasks,
    cleanText
  });

  registerPythonIpc({
    ipcMain,
    runPythonSandbox,
    getSandboxRoot: appPaths.getAgentPythonSandboxRoot
  });

  registerSystemIpc({
    ipcMain,
    shell,
    cleanText,
    clearCodexCliStoredLogin,
    getCodexLoginStatus,
    getCodexCliCatalog,
    getCodexCliModel,
    getCodexCliReasoningEffort,
    launchCodexCliLogin,
    setCodexCliModel,
    setCodexCliReasoningEffort,
    requestCodexCliText,
    getCodexDesktopMcpSetupPrompt: codex.getCodexDesktopMcpSetupPrompt,
    directLlmRegistry: agents.directLlmRegistry,
    getCodexCliWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
    errorReporting,
    // Packaged builds ship the notices as an extraResource (see forge.config.js);
    // shell.openPath cannot open a file that lives inside app.asar.
    thirdPartyNoticesPath: path.join(app.isPackaged ? processObject.resourcesPath : projectRoot, 'THIRD-PARTY-NOTICES.md')
  });

  // Every startup step below is best-effort: a failed integration is logged
  // and must not prevent the main window from working.
  async function bestEffort(name, work) {
    try {
      await work();
    } catch (error) {
      console.warn(`Main service "${name}" failed to start:`, error);
    }
  }

  async function start() {
    await bestEffort('agent-logging', async () => {
      await agentLogService.ensureAgentChatLogFile(appPaths.getAgentChatLogPath());
      const storageRoot = appPaths.getStorageRoot();
      chatLogTransformMonitor.start({
        storagePaths: storageRoot ? [storageRoot] : []
      });
    });
    await bestEffort('npm-updater', () => npmUpdater.start());
    await bestEffort('mcp', async () => {
      const result = await mcp.initialize({ reason: 'app_ready' });
      if (result?.ok === false) {
        const error = new Error('Hikari MCP host did not start successfully.');
        error.result = result;
        throw error;
      }
    });
    await bestEffort('codex', async () => {
      const result = await codex.initialize({ reason: 'app_ready' });
      if (result?.ok === false) {
        const error = new Error('Codex workspace initialization did not complete successfully.');
        error.result = result;
        throw error;
      }
    });
    await bestEffort('scheduled-tasks', () => scheduledTasks.start());
  }

  // Reverse start order; each failure is logged without blocking the rest.
  async function shutdown() {
    const stops = [
      ['bioinformatics', () => bioinformatics.stop()],
      ['scheduled-tasks', () => scheduledTasks.stop()],
      ['mcp', () => mcp.stop()],
      ['npm-updater', () => npmUpdater.stop()],
      ['agent-logging', () => chatLogTransformMonitor.stop()]
    ];
    for (const [name, stop] of stops) {
      try {
        await stop();
      } catch (error) {
        console.error(`Failed to stop main service "${name}":`, error);
      }
    }
  }

  return { appIconPath, start, shutdown };
}

module.exports = {
  createMainServices
};
