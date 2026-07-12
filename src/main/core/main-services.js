'use strict';

const startTelegramBot = require('../lib/telegramBot');
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
  ALLOW_API_AGENT,
  inferLlmProviderFromEndpoint,
  normalizeLlmProvider,
  normalizeAgentLlmProvider,
  defaultLlmEndpointForProvider,
  defaultAgentModelForProvider
} = require('../generated/llm-provider-config.generated.js');
const { defaultCleanText } = require('../helpers/agent/shared/agent-llm-utils.js');
const { appendLogWithRotation } = require('../helpers/agent/shared/agent-observability');
const { createMainAppPaths } = require('../helpers/main/app-paths.js');
const { createMainAgentServices } = require('../helpers/main/create-main-agent-services.js');
const { createMainDataHelpers } = require('../helpers/main/data/data-helpers');
const {
  discoverPapersFromStorageRoot,
  getBundlePaths,
  syncBundleFromSnapshot,
  syncSqliteBundleFromSnapshot,
  hydrateSnapshotFromBundle,
  importStorageRoot
} = require('../helpers/main/storage-bundle/index.js');
const {
  listSequenceEntries,
  getSequenceEntry,
  upsertSequenceEntry,
  promoteSequenceEntry,
  deleteSequenceEntry,
  annotateSequenceRecord,
  searchSequenceFeatures,
  listRecognizedBackbones,
  upsertRecognizedBackbone,
  recognizeSequenceBackbone
} = require('../helpers/main/sequence-library');
const { buildCompactIndexedSnapshot } = require('../helpers/main/data/data-snapshot-utils');
const { createChatLogTransformMonitor } = require('../helpers/main/llm/chat-log-transformer.js');
const { createAgentLogRuntime } = require('../app/agent-log-runtime');
const { createLlmPromptsRuntime } = require('../app/llm-prompts-runtime');
const { createTelegramRuntime } = require('../app/telegram-runtime');
const { createNpmUpdaterService } = require('./services/create-npm-updater-service');
const { createMainMcpService } = require('./services/create-mcp-service');
const { createMainCodexService } = require('./services/create-codex-service');
const { registerDataIpc } = require('../ipc/register-data-ipc');
const { registerAgentIpc } = require('../ipc/register-agent-ipc');
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
  const agentLogRuntime = createAgentLogRuntime({ fs, path, appendLogWithRotation });
  const getAgentChatSessionStoragePath = (payload) => {
    const storagePath = appPaths.getAgentChatSessionStoragePath(payload);
    if (storagePath) {
      chatLogTransformMonitor.trackStoragePath(storagePath);
    }
    return storagePath;
  };

  const prompts = createLlmPromptsRuntime({
    fs,
    promptsFilePath: path.join(projectRoot, 'data', 'llm-prompts.json')
  });

  const npmUpdater = createNpmUpdaterService({ app, dialog, shell, getMainWindow });

  const telegram = createTelegramRuntime({
    fs,
    path,
    processObject,
    startTelegramBot,
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
    appendAgentChatLogEntry: agentLogRuntime.appendAgentChatLogEntry,
    requestCodexCliText,
    getCodexCliWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
    getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
    BrowserWindow,
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
    cleanText,
    agentToolRuntime: agents.agentToolRuntime,
    getCodexCliWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
    getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
    getBundlePaths,
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
    discoverPapersFromStorageRoot,
    syncSqliteBundleFromSnapshot,
    importStorageRoot,
    listSequenceEntries,
    getSequenceEntry,
    upsertSequenceEntry,
    promoteSequenceEntry,
    deleteSequenceEntry,
    annotateSequenceRecord,
    searchSequenceFeatures,
    listRecognizedBackbones,
    upsertRecognizedBackbone,
    recognizeSequenceBackbone
  });

  registerAgentIpc({
    ipcMain,
    ALLOW_API_AGENT,
    LLM_PROVIDERS,
    cleanText,
    controllerUtils: agents.controllerUtils,
    observability: agents.observability,
    setCodexCliModel,
    setCodexCliReasoningEffort,
    codexAgentRuntime: codex.codexAgentRuntime,
    agentToolRuntime: agents.agentToolRuntime,
    agentChatLogRuntime: agents.agentChatLogRuntime,
    agentToolSmokeTestRuntime: agents.agentToolSmokeTestRuntime,
    protocolGenerationRuntime: agents.protocolGenerationRuntime,
    getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
    getAgentChatLogPath: appPaths.getAgentChatLogPath,
    getAgentChatSessionStoragePath,
    appendAgentChatLogEntry: agentLogRuntime.appendAgentChatLogEntry
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
      await agentLogRuntime.ensureAgentChatLogFile(appPaths.getAgentChatLogPath());
      const defaultDataFilePath = cleanText(appPaths.getDefaultDataFilePath(), 2400);
      chatLogTransformMonitor.start({
        storagePaths: defaultDataFilePath ? [path.dirname(defaultDataFilePath)] : []
      });
    });
    await bestEffort('prompts', () => prompts.loadLlmPrompts());
    await bestEffort('npm-updater', () => npmUpdater.start());
    await bestEffort('telegram', async () => {
      await telegram.hydrateSavedTelegramToken();
      telegram.restartTelegramBot();
    });
    await bestEffort('mcp', async () => {
      const result = await mcp.initialize({ reason: 'app_ready' });
      if (result?.ok === false) {
        const error = new Error('Hikari MCP initialization did not complete successfully.');
        error.result = result;
        throw error;
      }
    });
  }

  // Reverse start order; each failure is logged without blocking the rest.
  async function shutdown() {
    const stops = [
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
