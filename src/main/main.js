const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('node:fs/promises');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const startTelegramBot = require('./lib/telegramBot');
const {
  hasSupportedDataExtension,
  normalizeDataFilePath
} = require('./lib/main-utils');
const {
  getCodexCliCatalog,
  getCodexCliModel,
  getCodexCliReasoningEffort,
  getCodexLoginStatus,
  setCodexCliModel,
  setCodexCliReasoningEffort,
  requestCodexCliText
} = require('./lib/codex-cli-provider');
const {
  LLM_PROVIDERS,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_ENDPOINTS,
  DEFAULT_AGENT_MODELS,
  inferLlmProviderFromEndpoint,
  normalizeLlmProvider,
  defaultLlmEndpointForProvider,
  defaultAgentModelForProvider
} = require('./generated/llm-provider-config.generated.js');
const { defaultCleanText } = require('./helpers/agent/shared/agent-llm-utils.js');
const { appendLogWithRotation } = require('./helpers/agent/shared/agent-observability');
const { createMainAgentServices } = require('./helpers/main/create-main-agent-services.js');
const { createMainAppPaths } = require('./helpers/main/app-paths.js');
const { createMainDataHelpers } = require('./helpers/main/data-helpers');
const {
  getBundlePaths,
  syncBundleFromSnapshot,
  syncSqliteBundleFromSnapshot,
  hydrateSnapshotFromBundle,
  importStorageRoot
} = require('./helpers/main/storage-bundle');
const {
  listSequenceEntries,
  getSequenceEntry,
  upsertSequenceEntry,
  promoteSequenceEntry,
  deleteSequenceEntry,
  searchSequenceFeatures,
  recognizeSequenceBackbone
} = require('./helpers/main/sequence-library');
const {
  buildCompactIndexedSnapshot
} = require('./helpers/main/data-snapshot-utils');
const { registerDataIpc } = require('./helpers/main/register-data-ipc');
const { registerAgentIpc } = require('./helpers/main/register-agent-ipc');
const { registerSystemIpc } = require('./helpers/main/register-system-ipc');

const cleanText = defaultCleanText;

const appIconPath = path.join(PROJECT_ROOT, 'image.png');
const DEFAULT_DATA_FILE_NAME = 'enana-data.json';
const TELEGRAM_CONFIG_FILE_NAME = 'telegram-bot.json';
const AGENT_CHAT_LOG_FILE_NAME = 'agent-chat.log';
const LLM_PROMPTS_FILE_PATH = path.join(PROJECT_ROOT, 'data', 'llm-prompts.json');

const {
  getCodexCliWorkingDirectory,
  getDefaultDataFilePath,
  getTelegramConfigPath,
  getAgentChatLogPath,
  getAgentPythonSandboxRoot,
  getAgentChatSessionStoragePath
} = createMainAppPaths({
  app,
  path,
  processObject: process,
  projectRoot: PROJECT_ROOT,
  cleanText,
  defaultDataFileName: DEFAULT_DATA_FILE_NAME,
  telegramConfigFileName: TELEGRAM_CONFIG_FILE_NAME,
  agentChatLogFileName: AGENT_CHAT_LOG_FILE_NAME
});

let mainWindow = null;
let telegramBot = null;
let savedTelegramToken = '';
let telegramTokenSource = 'none';
let llmPromptsCache = null;
let llmPromptsPromise = null;

function normalizeLlmPromptPayload(parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const agent = source.agent && typeof source.agent === 'object' ? source.agent : {};
  return { agent };
}

async function loadLlmPrompts() {
  if (llmPromptsCache) {
    return llmPromptsCache;
  }

  if (!llmPromptsPromise) {
    llmPromptsPromise = fs.readFile(LLM_PROMPTS_FILE_PATH, 'utf8')
      .then((raw) => JSON.parse(raw))
      .then((parsed) => {
        llmPromptsCache = normalizeLlmPromptPayload(parsed);
        return llmPromptsCache;
      })
      .catch((error) => {
        console.error('Failed to load LLM prompts config:', error);
        llmPromptsCache = normalizeLlmPromptPayload({});
        return llmPromptsCache;
      });
  }

  return llmPromptsPromise;
}

async function loadSavedTelegramToken() {
  try {
    const raw = await fs.readFile(getTelegramConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed?.token === 'string' ? parsed.token.trim() : '';
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return '';
    }
    console.error('Failed to read telegram bot config:', error);
    return '';
  }
}

async function writeSavedTelegramToken(token) {
  const cleanToken = String(token || '').trim();
  const configPath = getTelegramConfigPath();
  if (!cleanToken) {
    await fs.rm(configPath, { force: true });
    return;
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({ token: cleanToken }, null, 2), 'utf8');
}

async function appendAgentChatLogEntry(logPath, entry) {
  try {
    await appendLogWithRotation({
      logPath,
      entry
    });
  } catch (error) {
    console.error('Failed to append agent chat log entry:', error);
  }
}

async function ensureAgentChatLogFile(logPath) {
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, '', 'utf8');
  } catch (error) {
    console.error('Failed to initialize agent chat log file:', error);
  }
}

function stopTelegramBot(reason = 'app quit') {
  if (!telegramBot) {
    return;
  }
  telegramBot.stop(reason);
  telegramBot = null;
}

function resolveTelegramBotToken() {
  if (savedTelegramToken) {
    return { token: savedTelegramToken, source: 'app' };
  }

  const envToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (envToken) {
    return { token: envToken, source: 'env' };
  }

  return { token: '', source: 'none' };
}

function restartTelegramBot() {
  stopTelegramBot('reconfigure');
  const { token, source } = resolveTelegramBotToken();
  telegramBot = startTelegramBot(() => mainWindow, token);
  telegramTokenSource = telegramBot ? source : 'none';
}

function getTelegramState() {
  return {
    enabled: Boolean(telegramBot),
    source: telegramTokenSource,
    hasSavedToken: Boolean(savedTelegramToken),
    savedToken: savedTelegramToken
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    title: 'Enana',
    icon: appIconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(PROJECT_ROOT, 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
  getDefaultDataFilePath
});

const {
  observability,
  controllerUtils,
  protocolNotebookRuntime,
  scienceReasoningLoopRuntime,
  deepResearchRuntime,
  scienceMainUtils,
  agentToolRuntime,
  agentChatLogRuntime,
  agentToolSmokeTestRuntime,
  agentLookupRuntime
} = createMainAgentServices({
  LLM_PROVIDERS,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_ENDPOINTS,
  DEFAULT_AGENT_MODELS,
  inferLlmProviderFromEndpoint,
  normalizeLlmProvider,
  defaultLlmEndpointForProvider,
  defaultAgentModelForProvider,
  cleanText,
  appendAgentChatLogEntry,
  requestCodexCliText,
  getCodexCliWorkingDirectory,
  getDefaultDataFilePath,
  BrowserWindow,
  getAgentPythonSandboxRoot,
  getBundlePaths,
  hydrateSnapshotFromBundle,
  syncBundleFromSnapshot
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
  syncSqliteBundleFromSnapshot,
  importStorageRoot,
  listSequenceEntries,
  getSequenceEntry,
  upsertSequenceEntry,
  promoteSequenceEntry,
  deleteSequenceEntry,
  searchSequenceFeatures,
  recognizeSequenceBackbone
});

registerAgentIpc({
  ipcMain,
  LLM_PROVIDERS,
  cleanText,
  controllerUtils,
  observability,
  setCodexCliModel,
  setCodexCliReasoningEffort,
  protocolNotebookRuntime,
  scienceReasoningLoopRuntime,
  deepResearchRuntime,
  scienceMainUtils,
  agentToolRuntime,
  agentChatLogRuntime,
  agentToolSmokeTestRuntime,
  executeInventoryLookup: agentLookupRuntime.executeInventoryLookup,
  executeRecordLookup: agentLookupRuntime.executeRecordLookup,
  getDefaultDataFilePath,
  getAgentChatLogPath,
  getAgentChatSessionStoragePath,
  appendAgentChatLogEntry
});

registerSystemIpc({
  ipcMain,
  shell,
  cleanText,
  getCodexLoginStatus,
  getCodexCliCatalog,
  getCodexCliModel,
  getCodexCliReasoningEffort,
  setCodexCliModel,
  setCodexCliReasoningEffort,
  requestCodexCliText,
  getCodexCliWorkingDirectory,
  writeSavedTelegramToken,
  restartTelegramBot,
  getTelegramState,
  setSavedTelegramToken: (token) => {
    savedTelegramToken = String(token || '').trim();
  }
});

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIconPath);
  }

  createWindow();
  savedTelegramToken = await loadSavedTelegramToken();
  restartTelegramBot();
  void ensureAgentChatLogFile(getAgentChatLogPath());
  void loadLlmPrompts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopTelegramBot('app quit');
});
