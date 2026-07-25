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
const { createAgentLogService } = require('./services/create-agent-log-service');
const { createTelegramService } = require('./services/create-telegram-service');
const { createNpmUpdaterService } = require('./services/create-npm-updater-service');
const { createMainMcpService } = require('./services/create-mcp-service');
const { createMainCodexService } = require('./services/create-codex-service');
const { createScheduledTaskService } = require('./services/create-scheduled-task-service');
const { registerDataIpc } = require('../ipc/register-data-ipc');
const { registerAgentIpc } = require('../ipc/register-agent-ipc');
const { registerScheduledTaskIpc } = require('../ipc/register-scheduled-task-ipc');
const { registerSystemIpc } = require('../ipc/register-system-ipc');

const AGENT_CHAT_LOG_FILE_NAME = 'agent-chat.log';
const DEFAULT_DATA_FILE_NAME = 'hikari-data.json';
const TELEGRAM_CONFIG_FILE_NAME = 'telegram-bot.json';

// Constructs every main-process service in dependency order and registers all
// IPC handlers. Construction and IPC registration are synchronous so they can
// run before app.whenReady(); async initialization happens in start().
function createMainServices(context = {}) {
  const {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
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
    telegramConfigFileName: TELEGRAM_CONFIG_FILE_NAME,
    agentChatLogFileName: AGENT_CHAT_LOG_FILE_NAME
  });
  const appIconPath = path.join(projectRoot, 'assets', 'icon.png');
  const syncBundleFromSnapshot = (input = {}) => syncBundleFromSnapshotBase({
    ...input,
    releaseOfficialMcpSkillsForWorkspace
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
    writeSnapshot: async (filePath, snapshot) => {
      await fs.writeFile(
        filePath,
        JSON.stringify(buildCompactIndexedSnapshot(snapshot), null, 2),
        'utf8'
      );
    },
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

  const telegram = createTelegramService({
    fs,
    path,
    processObject,
    // ponytail: telegram unwired — swap back to `startTelegramBot` to re-enable.
    startTelegramBot: () => null,
    getTelegramConfigPath: appPaths.getTelegramConfigPath,
    getMainWindow
  });

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

  // IPC registration (before app ready).
  registerDataIpc({
    ipcMain,
    dialog,
    shell,
    fs,
    cleanText,
    DEFAULT_DATA_FILE_NAME,
    hasSupportedDataExtension,
    mainDataHelpers,
    getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
    getStorageRootPointerPath: appPaths.getStorageRootPointerPath,
    getUserDataPath: appPaths.getUserDataPath,
    discoverPapersFromStorageRoot: (input = {}) => discoverPapersFromStorageRoot({
      ...input,
      transformPaperRecordsToMarkdown
    }),
    syncSqliteBundleFromSnapshot,
    importStorageRoot: (input = {}) => importStorageRoot({
      ...input,
      transformPaperRecordsToMarkdown
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
    getAgentChatLogPath: appPaths.getAgentChatLogPath,
    getAgentChatSessionStoragePath,
    appendAgentChatLogEntry: agentLogService.appendAgentChatLogEntry
  });

  registerScheduledTaskIpc({
    ipcMain,
    scheduledTaskService: scheduledTasks,
    cleanText
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
    writeSavedTelegramToken: telegram.writeSavedTelegramToken,
    restartTelegramBot: telegram.restartTelegramBot,
    getTelegramState: telegram.getTelegramState,
    setSavedTelegramToken: telegram.setSavedTelegramToken
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
      const defaultDataFilePath = cleanText(appPaths.getDefaultDataFilePath(), 2400);
      chatLogTransformMonitor.start({
        storagePaths: defaultDataFilePath ? [path.dirname(defaultDataFilePath)] : []
      });
    });
    await bestEffort('npm-updater', () => npmUpdater.start());
    await bestEffort('telegram', async () => {
      await telegram.hydrateSavedTelegramToken();
      telegram.restartTelegramBot();
    });
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
      ['scheduled-tasks', () => scheduledTasks.stop()],
      ['mcp', () => mcp.stop()],
      ['telegram', () => telegram.stopTelegramBot('app quit')],
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
