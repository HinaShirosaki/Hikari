'use strict';

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
} = require('../../lib/codex-cli-provider');
const {
  ALLOW_API_AGENT,
  LLM_PROVIDERS
} = require('../../generated/llm-provider-config.generated.js');
const {
  hasSupportedDataExtension
} = require('../../lib/main-utils');
const { registerDataIpc } = require('../../ipc/register-data-ipc');
const { registerAgentIpc } = require('../../ipc/register-agent-ipc');
const { registerSystemIpc } = require('../../ipc/register-system-ipc');
const { DEFAULT_DATA_FILE_NAME } = require('./constants');

function createIpcServiceDefinitions(context = {}) {
  const { dialog, ipcMain, shell, fs } = context;

  return [
    {
      key: 'data-ipc',
      dependsOn: ['app-metadata', 'storage'],
      create: () => ({}),
      registerIpc: ({ dependencies }) => {
        const { cleanText } = dependencies['app-metadata'];
        const storage = dependencies.storage;
        registerDataIpc({
          ipcMain,
          dialog,
          shell,
          fs,
          cleanText,
          DEFAULT_DATA_FILE_NAME,
          hasSupportedDataExtension,
          mainDataHelpers: storage.mainDataHelpers,
          discoverPapersFromStorageRoot: storage.discoverPapersFromStorageRoot,
          syncSqliteBundleFromSnapshot: storage.syncSqliteBundleFromSnapshot,
          importStorageRoot: storage.importStorageRoot,
          listSequenceEntries: storage.listSequenceEntries,
          getSequenceEntry: storage.getSequenceEntry,
          upsertSequenceEntry: storage.upsertSequenceEntry,
          promoteSequenceEntry: storage.promoteSequenceEntry,
          deleteSequenceEntry: storage.deleteSequenceEntry,
          annotateSequenceRecord: storage.annotateSequenceRecord,
          searchSequenceFeatures: storage.searchSequenceFeatures,
          listRecognizedBackbones: storage.listRecognizedBackbones,
          upsertRecognizedBackbone: storage.upsertRecognizedBackbone,
          recognizeSequenceBackbone: storage.recognizeSequenceBackbone
        });
      }
    },
    {
      key: 'agent-ipc',
      dependsOn: ['app-metadata', 'agent-logging', 'agent-controllers'],
      create: () => ({}),
      registerIpc: ({ dependencies }) => {
        const { appPaths, cleanText } = dependencies['app-metadata'];
        const agentLogging = dependencies['agent-logging'];
        const agents = dependencies['agent-controllers'];
        registerAgentIpc({
          ipcMain,
          ALLOW_API_AGENT,
          LLM_PROVIDERS,
          cleanText,
          controllerUtils: agents.controllerUtils,
          observability: agents.observability,
          setCodexCliModel,
          setCodexCliReasoningEffort,
          codexAgentRuntime: agents.codexAgentRuntime,
          agentToolRuntime: agents.agentToolRuntime,
          agentChatLogRuntime: agents.agentChatLogRuntime,
          agentToolSmokeTestRuntime: agents.agentToolSmokeTestRuntime,
          protocolGenerationRuntime: agents.protocolGenerationRuntime,
          getDefaultDataFilePath: appPaths.getDefaultDataFilePath,
          getAgentChatLogPath: appPaths.getAgentChatLogPath,
          getAgentChatSessionStoragePath: agentLogging.getAgentChatSessionStoragePath,
          appendAgentChatLogEntry: agentLogging.agentLogRuntime.appendAgentChatLogEntry
        });
      }
    },
    {
      key: 'system-ipc',
      dependsOn: ['app-metadata', 'agent-controllers', 'telegram'],
      create: () => ({}),
      registerIpc: ({ dependencies }) => {
        const { appPaths, cleanText } = dependencies['app-metadata'];
        const agents = dependencies['agent-controllers'];
        const telegram = dependencies.telegram;
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
      }
    }
  ];
}

module.exports = {
  createIpcServiceDefinitions
};
