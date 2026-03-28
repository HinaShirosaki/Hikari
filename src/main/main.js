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
  annotateWithBlast,
  checkPlannotateEnvironment,
  generatePlannotateGbk,
  installPlannotateAssets
} = require('./lib/plannotate-engine');
const {
  getCodexCliModel,
  getCodexLoginStatus,
  setCodexCliModel,
  requestCodexCliText
} = require('./lib/codex-cli-provider');
const {
  defaultCleanText,
  defaultSafeParseJson,
  defaultToInputText,
  defaultExtractResponseText,
  defaultExtractClaudeResponseText,
  defaultExtractGeminiResponseText,
  requestOpenAiResponsesWithBackoff,
  requestClaudeMessagesWithBackoff,
  requestGeminiGenerateContentWithBackoff
} = require('./helpers/agent/shared/agent-llm-utils.js');
const {
  runPythonSandbox
} = require('./helpers/agent/tools/agent-python-sandbox.js');
const {
  INTENT_PARSER_RESPONSE_SCHEMA,
  normalizeIntentParserPayload,
  buildIntentParserPrompt,
  buildInventorySearchTerms
} = require('./helpers/agent/intent/agent-intent-parser');
const observability = require('./helpers/agent/shared/agent-observability');
const { createAgentControllerUtils } = require('./helpers/agent/shared/agent-controller-utils');
const { createProtocolNotebookRuntime } = require('./helpers/agent/runtime/agent-protocol-notebook');
const { createAgentLookupRuntime } = require('./helpers/agent/runtime/agent-lookup-runtime');
const { createScienceReasoningLoopRuntime } = require('./helpers/agent/runtime/agent-science-reasoning-loop.js');
const { createDeepResearchRuntime } = require('./helpers/agent/deep-research/index.js');
const { createAgentSessionRuntime } = require('./helpers/agent/runtime/agent-session-runtime.js');
const { createAgentScienceMainUtils } = require('./helpers/agent/runtime/agent-science-main-utils.js');
const { createAgentToolSmokeTestRuntime } = require('./helpers/agent/tools/agent-tool-smoke-test');
const { createAgentChatLogRuntime } = require('./helpers/agent/context/agent-chat-log.js');
const {
  createAgentToolCallRuntime,
  normalizeToolInvocationArgs,
  getToolInputSchemas
} = require('./helpers/agent/tools/agent-tool-call.js');
const { createAgentRuntimeSupport } = require('./helpers/agent/runtime/agent-runtime-support.js');
const { createCodexAgentRuntime } = require('./helpers/agent/runtime/agent-codex-runtime.js');
const { createMainDataHelpers } = require('./helpers/main/data-helpers');
const {
  getBundlePaths,
  syncBundleFromSnapshot,
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
const safeParseJson = defaultSafeParseJson;
const toInputText = defaultToInputText;
const extractResponseText = defaultExtractResponseText;
const extractClaudeResponseText = defaultExtractClaudeResponseText;
const extractGeminiResponseText = defaultExtractGeminiResponseText;

const appIconPath = path.join(PROJECT_ROOT, 'image.png');
const DEFAULT_DATA_FILE_NAME = 'enana-data.json';
const TELEGRAM_CONFIG_FILE_NAME = 'telegram-bot.json';
const CHEMICALS_DATA_FILE_PATH = path.join(PROJECT_ROOT, 'data', 'chemicals.json');
const AGENT_CHAT_LOG_FILE_NAME = 'agent-chat.log';
const LLM_PROVIDERS = Object.freeze({
  OPENAI: 'openai',
  GEMINI: 'gemini',
  CLAUDE: 'claude',
  CODEX: 'codex'
});
const DEFAULT_LLM_PROVIDER = LLM_PROVIDERS.OPENAI;
const DEFAULT_LLM_ENDPOINTS = Object.freeze({
  [LLM_PROVIDERS.OPENAI]: 'https://api.openai.com/v1/responses',
  [LLM_PROVIDERS.GEMINI]: 'https://generativelanguage.googleapis.com/v1beta',
  [LLM_PROVIDERS.CLAUDE]: 'https://api.anthropic.com/v1/messages',
  [LLM_PROVIDERS.CODEX]: 'codex://cli'
});
const DEFAULT_AGENT_MODELS = Object.freeze({
  [LLM_PROVIDERS.OPENAI]: 'gpt-4.1-mini',
  [LLM_PROVIDERS.GEMINI]: 'gemini-2.5-flash',
  [LLM_PROVIDERS.CLAUDE]: 'claude-3-5-sonnet-latest',
  [LLM_PROVIDERS.CODEX]: ''
});
const LLM_PROMPTS_FILE_PATH = path.join(PROJECT_ROOT, 'data', 'llm-prompts.json');

let mainWindow = null;
let telegramBot = null;
let savedTelegramToken = '';
let telegramTokenSource = 'none';
let llmPromptsCache = null;
let llmPromptsPromise = null;

function getCodexCliWorkingDirectory() {
  try {
    const userDataPath = app.getPath('userData');
    if (userDataPath) {
      return userDataPath;
    }
  } catch {
    // App path may be unavailable very early; fall back.
  }
  return process.cwd();
}

function getDefaultDataFilePath() {
  return path.join(app.getPath('userData'), DEFAULT_DATA_FILE_NAME);
}

function getTelegramConfigPath() {
  return path.join(app.getPath('userData'), TELEGRAM_CONFIG_FILE_NAME);
}

function getAgentChatLogPath() {
  const override = String(process.env.ENANA_AGENT_CHAT_LOG_PATH || '').trim();
  if (override) {
    return override;
  }

  try {
    const userDataPath = app.getPath('userData');
    if (userDataPath) {
      return path.join(userDataPath, AGENT_CHAT_LOG_FILE_NAME);
    }
  } catch {
    // App path may be unavailable very early; fall back.
  }

  return path.join(PROJECT_ROOT, 'data', AGENT_CHAT_LOG_FILE_NAME);
}

function getAgentPythonSandboxRoot() {
  const override = String(process.env.ENANA_AGENT_PYTHON_SANDBOX_ROOT || '').trim();
  if (override) {
    return path.resolve(override);
  }

  try {
    const userDataPath = app.getPath('userData');
    if (userDataPath) {
      return path.join(userDataPath, 'agent-python-sandbox');
    }
  } catch {
    // App path may be unavailable very early; fall back.
  }

  return path.join(PROJECT_ROOT, 'tmp', 'agent-python-sandbox');
}

function getAgentChatSessionStoragePath(payload) {
  return cleanText(
    payload?.stateSnapshot?.settings?.storagePath
      || payload?.stateSnapshot?.storagePath
      || payload?.storagePath,
    2000
  );
}

function renderPromptTemplate(template, vars = {}) {
  const source = String(template || '');
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => String(vars[key] ?? ''));
}

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
    await observability.appendLogWithRotation({
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
    fallbackDataFilePath,
    legacyChemicalsPath
  }) => (
    hydrateSnapshotFromBundle({
      dataFilePath,
      snapshot,
      fallbackDataFilePath,
      legacyChemicalsPath
    })
  ),
  writeSnapshot: async (filePath, snapshot) => {
    await fs.writeFile(filePath, JSON.stringify(buildCompactIndexedSnapshot(snapshot), null, 2), 'utf8');
  },
  getDefaultDataFilePath,
  legacyChemicalsPath: CHEMICALS_DATA_FILE_PATH
});

const controllerUtils = createAgentControllerUtils({
  LLM_PROVIDERS,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_ENDPOINTS,
  DEFAULT_AGENT_MODELS,
  asArray: (value) => (Array.isArray(value) ? value : []),
  cleanText,
  appendAgentChatLogEntry,
  buildIntentParserPrompt,
  normalizeIntentParserPayload,
  INTENT_PARSER_RESPONSE_SCHEMA,
  toInputText,
  requestCodexCliText,
  getCodexCliWorkingDirectory,
  requestClaudeMessagesWithBackoff,
  requestGeminiGenerateContentWithBackoff,
  requestOpenAiResponsesWithBackoff,
  extractClaudeResponseText,
  extractGeminiResponseText,
  extractResponseText
});

const agentLookupRuntime = createAgentLookupRuntime({
  asArray: (value) => (Array.isArray(value) ? value : []),
  cleanText,
  uniqueStrings: (values, max = 50) => {
    const seen = new Set();
    const out = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const normalized = cleanText(value, 220);
      if (!normalized) {
        return;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key) || out.length >= max) {
        return;
      }
      seen.add(key);
      out.push(normalized);
    });
    return out;
  },
  getBundlePaths,
  hydrateSnapshotFromBundle,
  syncBundleFromSnapshot,
  buildInventorySearchTerms
});

const agentRuntimeSupport = createAgentRuntimeSupport({
  renderPromptTemplate
});
const genericAgentToolRuntime = createAgentToolCallRuntime({
  asArray: (value) => (Array.isArray(value) ? value : []),
  cleanText
});
const agentToolRuntime = {
  normalizeToolInvocationArgs,
  normalizeAgentSnapshot: agentRuntimeSupport.normalizeAgentSnapshot,
  buildAgentSystemPrompt: agentRuntimeSupport.buildAgentSystemPrompt,
  async runAgentTool(toolName, args, rawSnapshot, options = {}) {
    const normalizedArgs = normalizeToolInvocationArgs(args);
    const snapshot = agentRuntimeSupport.normalizeAgentSnapshot(rawSnapshot);
    const envelope = await genericAgentToolRuntime.executeToolCall(
      {
        tool_name: toolName,
        arguments: normalizedArgs
      },
      {
        ...options,
        snapshot,
        dataFilePath: cleanText(snapshot?.data_file_path, 1600),
        fallbackDataFilePath: getDefaultDataFilePath()
      }
    );
    const normalizedResult = envelope?.result && typeof envelope.result === 'object'
      ? envelope.result
      : {};
    return {
      ...envelope,
      result: normalizedResult,
      items: Array.isArray(envelope?.items) ? envelope.items : [],
      citations: Array.isArray(normalizedResult?.citations) ? normalizedResult.citations : []
    };
  }
};

const scienceMainUtils = createAgentScienceMainUtils({
  asArray: (value) => (Array.isArray(value) ? value : []),
  cleanText,
  uniqueStrings: (values, max = 50) => {
    const seen = new Set();
    const out = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const normalized = cleanText(value, 220);
      if (!normalized) {
        return;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key) || out.length >= max) {
        return;
      }
      seen.add(key);
      out.push(normalized);
    });
    return out;
  },
  clamp: (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min)),
  normalizeRoutingPayload: agentRuntimeSupport.normalizeRoutingPayload,
  normalizeNotebookDraftPayload: (value) => value && typeof value === 'object' ? value : null,
  applyRoutingPlanPatch: (routing, patch = {}) => ({
    ...agentRuntimeSupport.normalizeRoutingPayload(routing),
    plan: {
      ...(agentRuntimeSupport.normalizeRoutingPayload(routing).plan || {}),
      ...(patch && typeof patch === 'object' ? patch : {})
    }
  }),
  pickTopMatches: agentRuntimeSupport.pickTopMatches,
  scoreByQuery: agentRuntimeSupport.scoreByQuery,
  normalizeQuery: agentRuntimeSupport.normalizeQuery
});

const agentSessionRuntime = createAgentSessionRuntime({
  LLM_PROVIDERS,
  requestCodexCliText,
  getCodexCliWorkingDirectory,
  requestClaudeMessagesWithBackoff,
  requestGeminiGenerateContentWithBackoff,
  requestOpenAiResponsesWithBackoff,
  extractClaudeResponseText,
  extractGeminiResponseText,
  extractResponseText,
  toInputText,
  recordAgentLlmTrace: controllerUtils.recordAgentLlmTrace
});

const protocolNotebookRuntime = createProtocolNotebookRuntime({
  LLM_PROVIDERS,
  asArray: (value) => (Array.isArray(value) ? value : []),
  cleanText,
  uniqueStrings: (values, max = 50) => {
    const seen = new Set();
    const out = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const normalized = cleanText(value, 220);
      if (!normalized) {
        return;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key) || out.length >= max) {
        return;
      }
      seen.add(key);
      out.push(normalized);
    });
    return out;
  },
  pickTopMatches: agentRuntimeSupport.pickTopMatches,
  safeParseJson,
  runTool: agentToolRuntime.runAgentTool,
  requestCodexCliText,
  getCodexCliWorkingDirectory,
  requestClaudeMessagesWithBackoff,
  requestGeminiGenerateContentWithBackoff,
  requestOpenAiResponsesWithBackoff,
  extractClaudeResponseText,
  extractGeminiResponseText,
  extractResponseText,
  toInputText,
  recordAgentLlmTrace: controllerUtils.recordAgentLlmTrace,
  recordLifecycleEvent: observability.recordLifecycleEvent
});

const scienceReasoningLoopRuntime = createScienceReasoningLoopRuntime({
  asArray: (value) => (Array.isArray(value) ? value : []),
  cleanText,
  uniqueStrings: (values, max = 50) => {
    const seen = new Set();
    const out = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const normalized = cleanText(value, 220);
      if (!normalized) {
        return;
      }
      const key = normalized.toLowerCase();
      if (seen.has(key) || out.length >= max) {
        return;
      }
      seen.add(key);
      out.push(normalized);
    });
    return out;
  },
  safeParseJson,
  clamp: (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min)),
  LLM_PROVIDERS,
  requestCodexCliText,
  getCodexCliWorkingDirectory,
  requestClaudeMessagesWithBackoff,
  requestGeminiGenerateContentWithBackoff,
  requestOpenAiResponsesWithBackoff,
  extractClaudeResponseText,
  extractGeminiResponseText,
  extractResponseText,
  toInputText,
  recordAgentLlmTrace: controllerUtils.recordAgentLlmTrace,
  startAgentSession: agentSessionRuntime.startAgentSession,
  extractAgentSessionFunctionCalls: agentSessionRuntime.extractAgentSessionFunctionCalls,
  extractAgentSessionText: agentSessionRuntime.extractAgentSessionText,
  continueAgentSessionWithToolOutputs: agentSessionRuntime.continueAgentSessionWithToolOutputs,
  continueAgentSessionWithUserMessage: agentSessionRuntime.continueAgentSessionWithUserMessage,
  applyResponseLayerToOutput: scienceMainUtils.applyResponseLayerToOutput,
  applyValidationGateToOutput: scienceMainUtils.applyValidationGateToOutput,
  recordLifecycleEvent: observability.recordLifecycleEvent
});

const deepResearchRuntime = createDeepResearchRuntime({
  asArray: (value) => (Array.isArray(value) ? value : []),
  cleanText,
  safeParseJson,
  clamp: (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min)),
  LLM_PROVIDERS,
  requestCodexCliText,
  getCodexCliWorkingDirectory,
  requestClaudeMessagesWithBackoff,
  requestGeminiGenerateContentWithBackoff,
  requestOpenAiResponsesWithBackoff,
  extractClaudeResponseText,
  extractGeminiResponseText,
  extractResponseText,
  toInputText,
  recordAgentLlmTrace: controllerUtils.recordAgentLlmTrace,
  resolveToolDefinitions: (selectedToolNames = []) => getToolInputSchemas(selectedToolNames).map((tool) => ({
    name: cleanText(tool?.name, 120),
    description: cleanText(tool?.detailed_description || tool?.description, 2400),
    parameters: tool?.input_schema && typeof tool.input_schema === 'object'
      ? tool.input_schema
      : { type: 'object', additionalProperties: true, properties: {} }
  })),
  applyResponseLayerToOutput: scienceMainUtils.applyResponseLayerToOutput,
  applyValidationGateToOutput: scienceMainUtils.applyValidationGateToOutput,
  recordLifecycleEvent: observability.recordLifecycleEvent
});

const codexRuntime = createCodexAgentRuntime({
  requestCodexCliText,
  getCodexCliWorkingDirectory,
  recordAgentLlmTrace: controllerUtils.recordAgentLlmTrace,
  runAgentTool: agentToolRuntime.runAgentTool,
  buildAgentSystemPrompt: agentRuntimeSupport.buildAgentSystemPrompt,
  buildAgentSynthesisPrompt: agentRuntimeSupport.buildAgentSynthesisPrompt,
  normalizeAgentOutput: agentRuntimeSupport.normalizeAgentOutput,
  toPromptConversationTranscript: agentRuntimeSupport.toPromptConversationTranscript,
  applyResponseLayerToOutput: scienceMainUtils.applyResponseLayerToOutput,
  applyValidationGateToOutput: scienceMainUtils.applyValidationGateToOutput,
  normalizeRoutingPayload: agentRuntimeSupport.normalizeRoutingPayload
});
void codexRuntime;

const agentToolSmokeTestRuntime = createAgentToolSmokeTestRuntime({
  runPythonSandbox,
  pythonSandboxRoot: getAgentPythonSandboxRoot()
});
const agentChatLogRuntime = createAgentChatLogRuntime();

registerDataIpc({
  ipcMain,
  dialog,
  shell,
  fs,
  cleanText,
  DEFAULT_DATA_FILE_NAME,
  hasSupportedDataExtension,
  mainDataHelpers,
  importStorageRoot,
  listSequenceEntries,
  getSequenceEntry,
  upsertSequenceEntry,
  promoteSequenceEntry,
  deleteSequenceEntry,
  searchSequenceFeatures,
  recognizeSequenceBackbone,
  checkPlannotateEnvironment,
  annotateWithBlast,
  installPlannotateAssets,
  generatePlannotateGbk
});

registerAgentIpc({
  ipcMain,
  LLM_PROVIDERS,
  cleanText,
  controllerUtils,
  observability,
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
  cleanText,
  getCodexLoginStatus,
  getCodexCliModel,
  setCodexCliModel,
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
