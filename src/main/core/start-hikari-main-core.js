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
  resolveCodexCliRuntimeHomeDirectory,
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
  defaultLlmEndpointForProvider,
  defaultAgentModelForProvider
} = require('../generated/llm-provider-config.generated.js');
const { defaultCleanText } = require('../helpers/agent/shared/agent-llm-utils.js');
const { appendLogWithRotation } = require('../helpers/agent/shared/agent-observability');
const { createMainAgentServices } = require('../helpers/main/create-main-agent-services.js');
const { createMainAppPaths } = require('../helpers/main/app-paths.js');
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
} = require('../helpers/main/sequence/sequence-library');
const {
  buildCompactIndexedSnapshot
} = require('../helpers/main/data/data-snapshot-utils');
const { createChatLogTransformMonitor } = require('../helpers/main/llm/chat-log-transformer.js');
const { registerMainIpc } = require('../ipc');
const { createAgentLogRuntime } = require('../app/agent-log-runtime');
const { createLlmPromptsRuntime } = require('../app/llm-prompts-runtime');
const { createTelegramRuntime } = require('../app/telegram-runtime');

const DEFAULT_DATA_FILE_NAME = 'hikari-data.json';
const TELEGRAM_CONFIG_FILE_NAME = 'telegram-bot.json';
const AGENT_CHAT_LOG_FILE_NAME = 'agent-chat.log';

function createHikariMainCore({
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
}) {
  const cleanText = defaultCleanText;
  const appIconPath = path.join(projectRoot, 'assets', 'icon.png');
  const llmPromptsFilePath = path.join(projectRoot, 'data', 'llm-prompts.json');
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

  if (!String(processObject.env.HIKARI_CODEX_HOME || processObject.env.ENANA_CODEX_HOME || '').trim()) {
    processObject.env.HIKARI_CODEX_HOME = appPaths.getCodexCliHomePath()
      || resolveCodexCliRuntimeHomeDirectory(appPaths.getCodexCliWorkingDirectory());
    processObject.env.ENANA_CODEX_HOME = processObject.env.HIKARI_CODEX_HOME;
  } else if (!String(processObject.env.HIKARI_CODEX_HOME || '').trim()) {
    processObject.env.HIKARI_CODEX_HOME = processObject.env.ENANA_CODEX_HOME;
  } else if (!String(processObject.env.ENANA_CODEX_HOME || '').trim()) {
    processObject.env.ENANA_CODEX_HOME = processObject.env.HIKARI_CODEX_HOME;
  }

  const chatLogTransformMonitor = createChatLogTransformMonitor({
    fs,
    path,
    cleanText
  });
  const agentLogRuntime = createAgentLogRuntime({
    fs,
    path,
    appendLogWithRotation
  });
  const llmPromptsRuntime = createLlmPromptsRuntime({
    fs,
    promptsFilePath: llmPromptsFilePath
  });
  const telegramRuntime = createTelegramRuntime({
    fs,
    path,
    processObject,
    startTelegramBot,
    getTelegramConfigPath: appPaths.getTelegramConfigPath,
    getMainWindow
  });

  function resolveTrackedAgentChatSessionStoragePath(payload) {
    const storagePath = appPaths.getAgentChatSessionStoragePath(payload);
    if (storagePath) {
      chatLogTransformMonitor.trackStoragePath(storagePath);
    }
    return storagePath;
  }

  const mainDataHelpers = createMainDataHelpers({
    fs,
    path,
    cleanText,
    hasSupportedDataExtension,
    normalizeDataFilePath,
    syncBundleFromSnapshot: async ({ dataFilePath, snapshot, fallbackDataFilePath }) => (
      syncBundleFromSnapshot({
        dataFilePath,
        snapshot,
        fallbackDataFilePath
      })
    ),
    hydrateSnapshotFromBundle: async ({
      dataFilePath,
      snapshot,
      fallbackDataFilePath
    }) => (
      hydrateSnapshotFromBundle({
        dataFilePath,
        snapshot,
        fallbackDataFilePath
      })
    ),
    writeSnapshot: async (filePath, snapshot) => {
      await fs.writeFile(filePath, JSON.stringify(buildCompactIndexedSnapshot(snapshot), null, 2), 'utf8');
    },
    getDefaultDataFilePath: appPaths.getDefaultDataFilePath
  });

  const agentServices = createMainAgentServices({
    LLM_PROVIDERS,
    DEFAULT_LLM_PROVIDER,
    DEFAULT_LLM_ENDPOINTS,
    DEFAULT_AGENT_MODELS,
    inferLlmProviderFromEndpoint,
    normalizeLlmProvider,
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
    syncBundleFromSnapshot
  });

  function registerIpcHandlers() {
    registerMainIpc({
      data: {
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
      },
      agent: {
        ipcMain,
        LLM_PROVIDERS,
        cleanText,
        controllerUtils: agentServices.controllerUtils,
        observability: agentServices.observability,
        setCodexCliModel,
        setCodexCliReasoningEffort,
        protocolNotebookRuntime: agentServices.protocolNotebookRuntime,
        scienceReasoningLoopRuntime: agentServices.scienceReasoningLoopRuntime,
        deepResearchRuntime: agentServices.deepResearchRuntime,
        codexAgentRuntime: agentServices.codexAgentRuntime,
        scienceMainUtils: agentServices.scienceMainUtils,
        agentToolRuntime: agentServices.agentToolRuntime,
        agentChatLogRuntime: agentServices.agentChatLogRuntime,
        agentToolSmokeTestRuntime: agentServices.agentToolSmokeTestRuntime,
        protocolGenerationRuntime: agentServices.protocolGenerationRuntime,
        executeInventoryLookup: agentServices.agentLookupRuntime.executeInventoryLookup,
        executeRecordLookup: agentServices.agentLookupRuntime.executeRecordLookup,
        getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
        getAgentChatLogPath: appPaths.getAgentChatLogPath,
        getAgentChatSessionStoragePath: resolveTrackedAgentChatSessionStoragePath,
        appendAgentChatLogEntry: agentLogRuntime.appendAgentChatLogEntry
      },
      system: {
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
        directLlmRegistry: agentServices.directLlmRegistry,
        getCodexCliWorkingDirectory: appPaths.getCodexCliWorkingDirectory,
        writeSavedTelegramToken: telegramRuntime.writeSavedTelegramToken,
        restartTelegramBot: telegramRuntime.restartTelegramBot,
        getTelegramState: telegramRuntime.getTelegramState,
        setSavedTelegramToken: telegramRuntime.setSavedTelegramToken
      }
    });
  }

  function startChatLogTransformMonitor() {
    const defaultDataFilePath = cleanText(appPaths.getDefaultDataFilePath(), 2400);
    chatLogTransformMonitor.start({
      storagePaths: defaultDataFilePath ? [path.dirname(defaultDataFilePath)] : []
    });
  }

  return {
    agentLogRuntime,
    appIconPath,
    appPaths,
    chatLogTransformMonitor,
    codexAgentMcpHost: agentServices.codexAgentMcpHost,
    llmPromptsRuntime,
    registerIpcHandlers,
    startChatLogTransformMonitor,
    telegramRuntime
  };
}

module.exports = {
  createHikariMainCore,
  createMainRuntime: createHikariMainCore
};
