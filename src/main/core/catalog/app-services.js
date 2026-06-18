'use strict';

const startTelegramBot = require('../../lib/telegramBot');
const {
  hasSupportedDataExtension,
  normalizeDataFilePath
} = require('../../lib/main-utils');
const { defaultCleanText } = require('../../helpers/agent/shared/agent-llm-utils.js');
const { appendLogWithRotation } = require('../../helpers/agent/shared/agent-observability');
const { createMainAppPaths } = require('../../helpers/main/app-paths.js');
const { createMainDataHelpers } = require('../../helpers/main/data/data-helpers');
const {
  discoverPapersFromStorageRoot,
  getBundlePaths,
  syncBundleFromSnapshot,
  syncSqliteBundleFromSnapshot,
  hydrateSnapshotFromBundle,
  importStorageRoot
} = require('../../helpers/main/storage-bundle/index.js');
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
} = require('../../helpers/main/sequence-library');
const {
  buildCompactIndexedSnapshot
} = require('../../helpers/main/data/data-snapshot-utils');
const { createChatLogTransformMonitor } = require('../../helpers/main/llm/chat-log-transformer.js');
const { createAgentLogRuntime } = require('../../app/agent-log-runtime');
const { createLlmPromptsRuntime } = require('../../app/llm-prompts-runtime');
const { createTelegramRuntime } = require('../../app/telegram-runtime');
const { SERVICE_POLICIES } = require('../service-lifecycle');
const {
  AGENT_CHAT_LOG_FILE_NAME,
  DEFAULT_DATA_FILE_NAME,
  TELEGRAM_CONFIG_FILE_NAME
} = require('./constants');

function createAppServiceDefinitions(context = {}) {
  const {
    app,
    fs,
    path,
    processObject,
    projectRoot,
    getMainWindow
  } = context;

  return [
    {
      key: 'app-metadata',
      create: () => {
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
        return {
          appIconPath: path.join(projectRoot, 'assets', 'icon.png'),
          appPaths,
          cleanText,
          llmPromptsFilePath: path.join(projectRoot, 'data', 'llm-prompts.json')
        };
      }
    },
    {
      key: 'storage',
      dependsOn: ['app-metadata'],
      create: ({ dependencies }) => {
        const { appPaths, cleanText } = dependencies['app-metadata'];
        const mainDataHelpers = createMainDataHelpers({
          fs,
          path,
          cleanText,
          hasSupportedDataExtension,
          normalizeDataFilePath,
          syncBundleFromSnapshot: async ({ dataFilePath, snapshot, fallbackDataFilePath }) => (
            syncBundleFromSnapshot({ dataFilePath, snapshot, fallbackDataFilePath })
          ),
          hydrateSnapshotFromBundle: async ({ dataFilePath, snapshot, fallbackDataFilePath }) => (
            hydrateSnapshotFromBundle({ dataFilePath, snapshot, fallbackDataFilePath })
          ),
          writeSnapshot: async (filePath, snapshot) => {
            await fs.writeFile(
              filePath,
              JSON.stringify(buildCompactIndexedSnapshot(snapshot), null, 2),
              'utf8'
            );
          },
          getDefaultDataFilePath: appPaths.getDefaultDataFilePath
        });
        return {
          annotateSequenceRecord,
          deleteSequenceEntry,
          discoverPapersFromStorageRoot,
          getBundlePaths,
          getSequenceEntry,
          hydrateSnapshotFromBundle,
          importStorageRoot,
          listRecognizedBackbones,
          listSequenceEntries,
          mainDataHelpers,
          promoteSequenceEntry,
          recognizeSequenceBackbone,
          searchSequenceFeatures,
          syncBundleFromSnapshot,
          syncSqliteBundleFromSnapshot,
          upsertRecognizedBackbone,
          upsertSequenceEntry
        };
      }
    },
    {
      key: 'agent-logging',
      dependsOn: ['app-metadata'],
      policy: SERVICE_POLICIES.BEST_EFFORT,
      create: ({ dependencies }) => {
        const { appPaths, cleanText } = dependencies['app-metadata'];
        const chatLogTransformMonitor = createChatLogTransformMonitor({ fs, path, cleanText });
        const agentLogRuntime = createAgentLogRuntime({ fs, path, appendLogWithRotation });
        return {
          agentLogRuntime,
          chatLogTransformMonitor,
          getAgentChatSessionStoragePath(payload) {
            const storagePath = appPaths.getAgentChatSessionStoragePath(payload);
            if (storagePath) {
              chatLogTransformMonitor.trackStoragePath(storagePath);
            }
            return storagePath;
          }
        };
      },
      start: async ({ service, dependencies }) => {
        const { appPaths, cleanText } = dependencies['app-metadata'];
        await service.agentLogRuntime.ensureAgentChatLogFile(appPaths.getAgentChatLogPath());
        const defaultDataFilePath = cleanText(appPaths.getDefaultDataFilePath(), 2400);
        service.chatLogTransformMonitor.start({
          storagePaths: defaultDataFilePath ? [path.dirname(defaultDataFilePath)] : []
        });
      },
      stop: ({ service }) => service.chatLogTransformMonitor.stop()
    },
    {
      key: 'prompts',
      dependsOn: ['app-metadata'],
      policy: SERVICE_POLICIES.BEST_EFFORT,
      create: ({ dependencies }) => createLlmPromptsRuntime({
        fs,
        promptsFilePath: dependencies['app-metadata'].llmPromptsFilePath
      }),
      start: ({ service }) => service.loadLlmPrompts()
    },
    {
      key: 'telegram',
      dependsOn: ['app-metadata'],
      policy: SERVICE_POLICIES.BEST_EFFORT,
      create: ({ dependencies }) => createTelegramRuntime({
        fs,
        path,
        processObject,
        startTelegramBot,
        getTelegramConfigPath: dependencies['app-metadata'].appPaths.getTelegramConfigPath,
        getMainWindow
      }),
      start: async ({ service }) => {
        await service.hydrateSavedTelegramToken();
        service.restartTelegramBot();
      },
      stop: ({ service }) => service.stopTelegramBot('app quit')
    }
  ];
}

module.exports = {
  createAppServiceDefinitions
};
