'use strict';

const { createWorkspaceFileService } = require('../agent/file-access/service.js');
const { registerAgentFileIpc } = require('../ipc/register-agent-file-ipc.js');
const { FILE_ACCESS, LLM, STORAGE } = require('../../shared/ipc/channels');
const { createCloudDriveService } = require('../cloud-drive/service');
const { registerCloudDriveIpc } = require('../ipc/register-cloud-drive-ipc');

const {
  hasSupportedDataExtension,
  normalizeDataFilePath
} = require('../storage/storage-paths');
const {
  clearCodexCliStoredLogin,
  launchCodexCliLogin,
  getCodexCliModel,
  getCodexCliReasoningEffort,
  getCodexLoginStatus,
  requestCodexCliCatalog,
  requestCodexCliUsage,
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
const { createPaperImportTransformer } = require('./services/create-paper-import-transformer.js');
const {
  normalizePaperFindingRunResult
} = require('../papers/finding/paper-finding-task.js');
const { markSavedPapers } = require('../papers/finding/paper-finding-scheduled-tasks.js');
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
const { createNpmUpdaterService } = require('../updater/create-npm-updater-service');
const { createCodexCliUpdater } = require('../lib/codex-cli-provider/cli-updater');
const { setCodexCliUpdater } = require('../lib/codex-cli-provider/cli-maintenance');
const { invalidateCodexCliCatalog } = require('../lib/codex-cli-provider/catalog');
const { createMainMcpService } = require('./services/create-mcp-service');
const { createMainCodexService } = require('./services/create-codex-service');
const { createGenomeService } = require('../genome/create-genome-service');
const { createNotebookSuggestionService } = require('./services/create-notebook-suggestion-service');
const { createScheduledTaskService } = require('../scheduled-tasks/create-scheduled-task-service');
const { registerDataIpc } = require('../ipc/register-data-ipc');
const { registerAgentIpc } = require('../ipc/register-agent-ipc');
const { registerBioinformaticsIpc } = require('../ipc/register-bioinformatics-ipc');
const { registerGenomeIpc } = require('../ipc/register-genome-ipc');
const { registerPluginIpc } = require('../ipc/register-plugin-ipc');
const { registerPythonIpc } = require('../ipc/register-python-ipc');
const { registerScheduledTaskIpc } = require('../ipc/register-scheduled-task-ipc');
const { registerSystemIpc } = require('../ipc/register-system-ipc');
const { runPythonSandbox } = require('../agent/tools/agent-python-sandbox.js');
const {
  guardHtmlPreviewNavigation,
  installHtmlPreviewService,
  registerHtmlPreviewScheme
} = require('../agent/html-output/preview-service.js');

const AGENT_CHAT_LOG_FILE_NAME = 'agent-chat.log';
const DEFAULT_DATA_FILE_NAME = 'hikari-data.json';

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

  registerHtmlPreviewScheme(context.protocol);

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
  // Windows gets the multi-size .ico (tile-filling); macOS dev runs get the Dock-grid PNG.
  const appIconPath = path.join(projectRoot, 'assets', processObject.platform === 'win32' ? 'icon.ico' : 'icon.png');

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
    requestProjectMemoryConclusion,
    getAgentMemoryFilePath: appPaths.getAgentMemoryFilePath
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

  const npmUpdater = createNpmUpdaterService({ app, dialog, getMainWindow });

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
  requestProjectMemoryConclusion = (input = {}) => agents.directLlmRegistry.requestModuleLlm({
    ...input,
    reasoningEffort: 'low'
  });
  const transformPaperRecordsWithAgentRuntime = createPaperImportTransformer({
    getCodexLoginStatus,
    getCodexCliWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
    paperKnowledgeDatabaseRuntime: agents.paperKnowledgeDatabaseRuntime
  });

  const fileAccess = createWorkspaceFileService({
    getStorageRoot: appPaths.getStorageRoot,
    getStorageRootRevision: appPaths.getStorageRootRevision,
    privateDirectory: appPaths.getCodexCliWorkingDirectory(),
    onChange: () => getMainWindow()?.webContents?.send(FILE_ACCESS.CHANGED)
  });
  registerAgentFileIpc({ ipcMain, fileAccess, getMainWindow, dialog });
  const mcp = createMainMcpService({
    fileAccess,
    agentToolRuntime: agents.agentToolRuntime,
    ipcMain,
    getMainWindow,
    getWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
    processObject
  });

  codex = createMainCodexService({
    fileAccess,
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

  const codexCliUpdater = createCodexCliUpdater({
    env: processObject.env,
    platform: processObject.platform,
    arch: processObject.arch,
    onUpdated: (status) => {
      invalidateCodexCliCatalog();
      const window = getMainWindow();
      if (window && !window.isDestroyed()) window.webContents.send(LLM.CODEX_CLI_UPDATED, status);
    }
  });
  setCodexCliUpdater(codexCliUpdater);

  const scheduledTasks = createScheduledTaskService({
    fs,
    path,
    cleanText,
    getScheduledTasksPath: appPaths.getScheduledTasksPath,
    runCodexTask: codex.runScheduledTask,
    normalizeRunResult: async (task, text, context) => markSavedPapers(
      task,
      normalizePaperFindingRunResult(task, text, context),
      agents.paperDownloadRuntime
    )
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
  const cloudDrive = createCloudDriveService({
    directory: path.join(appPaths.getCodexCliWorkingDirectory(), 'Config', 'cloud-drive'),
    safeStorage: context.safeStorage,
    getStorageRoot: appPaths.getStorageRoot,
    openExternal: url => shell.openExternal(url),
    env: processObject.env,
    onChange: () => {
      const window = getMainWindow();
      if (window && !window.isDestroyed()) window.webContents.send(STORAGE.CLOUD_CHANGED);
    }
  });
  registerCloudDriveIpc({ ipcMain, cloudDrive, getMainWindow });

  registerPluginIpc({
    ipcMain,
    session,
    dialog,
    fs,
    cleanText,
    getBundledPluginPath: (pluginId) => (
      pluginId === 'gel' ? path.join(projectRoot, 'src', 'plugins', 'gel') : ''
    )
  });

  registerDataIpc({
    ipcMain,
    dialog,
    shell,
    fs,
    cleanText,
    DEFAULT_DATA_FILE_NAME,
    hasSupportedDataExtension,
    mainDataHelpers,
    onWorkspaceSaved: cloudDrive.schedule,
    getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
    getStorageRootPointerPath: appPaths.getStorageRootPointerPath,
    getStorageRoot: appPaths.getStorageRoot,
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
    paperDownloadRuntime: agents.paperDownloadRuntime,
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
    requestCodexCliCatalog,
    requestCodexCliUsage,
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
    updater: npmUpdater,
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
    codexCliUpdater.start();
    await bestEffort('html-preview', async () => {
      installHtmlPreviewService({ protocol: context.protocol, ipcMain, getMainWindow });
    });
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
      ['cloud-drive', () => cloudDrive.stop()],
      ['codex-cli-updater', () => codexCliUpdater.stop()],
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

  return { appIconPath, guardHtmlPreviewNavigation, start, shutdown };
}

module.exports = {
  createMainServices
};
