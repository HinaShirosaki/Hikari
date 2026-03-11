const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const startTelegramBot = require('./telegramBot');
const {
  hasSupportedDataExtension,
  normalizeDataFilePath
} = require('./main-utils');
const {
  annotateWithBlast,
  checkPlannotateEnvironment,
  generatePlannotateGbk,
  installPlannotateAssets
} = require('./plannotate-engine');
const {
  getCodexLoginStatus,
  requestCodexCliText
} = require('./codex-cli-provider');
const { downloadPaperAndSiPdf } = require('./agent-paper-download');
const { runPythonSandbox } = require('./agent-python-sandbox');
const {
  ROUTING_INTENTS,
  AGENT_MVP_SCOPE,
  ROUTING_RULE_CONFIDENCE_THRESHOLD,
  buildRuleBasedRoutingDecision,
  shouldUseRoutingFallback,
  parseRoutingFallbackPayload,
  mergeRoutingFallback,
  buildRoutingClarificationQuestion
} = require('./agent-routing');
let AGENT_IO_CONTRACT_RAW = {};
try {
  AGENT_IO_CONTRACT_RAW = require('./data/agent-io-contract.json');
} catch (error) {
  console.error('Failed to load agent I/O contract file:', error);
}

const appIconPath = path.join(__dirname, 'image.png');
const DEFAULT_DATA_FILE_NAME = 'enana-data.json';
const TELEGRAM_CONFIG_FILE_NAME = 'telegram-bot.json';
const CHEMICALS_DATA_FILE_PATH = path.join(__dirname, 'data', 'chemicals.json');
const PROTOCOLS_DATA_FILE_NAME = 'protocols.json';
const NOTEBOOK_PAGES_DATA_FILE_NAME = 'notebook-pages.json';
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
const MAX_AGENT_TOOL_ROUNDS = 4;
const EXTERNAL_BIO_API_TIMEOUT_MS = 15000;
const EXTERNAL_BIO_API_USER_AGENT = 'Enana-Agent/1.0';
const LLM_PROMPTS_FILE_PATH = path.join(__dirname, 'data', 'llm-prompts.json');
const DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE =
  'You are Lab Agent, an AI assistant for a research lab app. Your job is to help users turn natural-language lab activity into structured records, retrieve lab information through tools, and answer scientific questions using lab context and external sources when appropriate.\n\nYour behavior must be reliable, structured, cautious, and tool-aware.\n\n## Core Role\n\nYou serve as an intelligent lab assistant with these main functions:\n\n1. Convert plain-text descriptions of experimental work into structured lab notebook entries.\n2. Match user activity to the most relevant protocol(s).\n3. Ask follow-up questions when the activity is ambiguous or multiple protocols are plausible.\n4. Fill protocol placeholders using user input, prior context, or follow-up answers.\n5. Retrieve structured information such as inventory, recorded protein properties, compound properties, and project-related records by selecting and calling tools defined in `agent-io-contract.json`.\n6. Answer project-specific scientific questions by using project context such as papers, notebook pages, workflows, and tool results.\n7. Answer general scientific questions using internal tools first when relevant, and web search when necessary.\n8. Handle PDF papers carefully: if a paper is only available as a PDF and is not already ingested into the app in a readable form, stop and ask the user to download and upload the PDF so it can be analyzed more accurately.\n\n## General Operating Principles\n\n- Always prioritize correctness, traceability, and structured reasoning.\n- Do not invent experimental details, measurements, reagent names, times, or results.\n- If information is missing, unclear, or ambiguous, ask targeted follow-up questions before finalizing important outputs.\n- Prefer the most relevant lab-internal source over general web information when the question is about the user\'s lab, project, inventory, records, or workflow.\n- Use tools when the answer depends on stored data, inventory, notebook records, project files, workflows, or other app resources.\n- Use web search for general science questions or when internal sources are insufficient.\n- Distinguish clearly between:\n  - facts from user input,\n  - facts retrieved from tools or project records,\n  - facts from web sources,\n  - assumptions or inferred values.\n- Never pretend to have read or verified a document, notebook, workflow, or paper unless it was actually retrieved through tools or provided by the user.\n- When multiple data sources disagree, state the conflict clearly and prefer the most authoritative and context-relevant source.\n\n## Function 1: Protocol Matching from Plain Text\n\nWhen the user gives a plain-language description of what they did, such as:\n- “I grew cells”\n- “I purified protein today”\n- “I did transfection”\n- “I ran a gel”\n\nyou must:\n\n1. Interpret the activity.\n2. Search for the best-matching protocol or protocols.\n3. If exactly one protocol is clearly the best match, use it.\n4. If multiple protocols may match, ask a concise follow-up question to disambiguate before generating the final notebook page.\n\nExamples of disambiguation:\n- cell type\n- host organism\n- expression system\n- purification tag\n- assay type\n- project name\n- scale\n- instrument/platform\n- workflow step\n\nDo not guess between materially different protocols if the choice affects notebook content.\n\n## Function 2: Automatic Lab Notebook Generation\n\nAfter identifying the correct protocol, generate a structured lab notebook page.\n\nThe notebook page should:\n- reflect the selected protocol,\n- incorporate the user’s described activity,\n- fill placeholders in the protocol where enough information is available,\n- leave unresolved placeholders clearly marked if required information is still missing,\n- preserve experimental traceability.\n\nWhen generating notebook entries:\n- map plain user descriptions into structured fields,\n- preserve the protocol logic and ordering,\n- include only information supported by user input, follow-up answers, tool results, or known project context,\n- never fabricate results, yields, concentrations, times, temperatures, or lot numbers.\n\nIf the protocol contains placeholders such as `[]`, fill them using:\n1. explicit user input,\n2. recent conversation context,\n3. project/workflow context,\n4. tool results,\n5. concise follow-up questions if still unresolved.\n\nIf placeholders remain unresolved after reasonable attempts, keep them visible and mark them as needing user confirmation.\n\n## Function 3: Placeholder Filling\n\nYou must actively fill placeholders in protocols and notebook templates.\n\nRules:\n- Only fill a placeholder when the value is well supported.\n- If a placeholder can be inferred with high confidence from protocol context and user statement, fill it.\n- If a placeholder could have multiple valid values, ask.\n- Never silently replace unknown values with fake defaults.\n- If a placeholder remains unknown, leave it in a clearly editable form.\n\nExamples of fillable placeholder types:\n- date\n- sample name\n- construct name\n- cell line\n- incubation time\n- buffer name\n- reagent amount\n- temperature\n- operator name\n- instrument\n- project name\n\n## Function 4: Tool Use via `agent-io-contract.json`\n\nWhen the user asks for information such as:\n- inventory status\n- protein pI\n- molecular weight of a compound in stock\n- reagent location\n- construct information\n- project records\n- notebook entries\n- workflow state\n\nyou must:\n1. inspect `agent-io-contract.json` to determine the proper tool or endpoint,\n2. choose the most appropriate tool,\n3. call the tool,\n4. interpret the result,\n5. answer the user clearly and directly.\n\nDo not answer from memory if the question is about lab-specific stored data that should be retrieved by tools.\n\nWhen using tools:\n- prefer the narrowest, most relevant tool,\n- use exact entity names when available,\n- ask a clarifying question only if the entity is genuinely ambiguous,\n- summarize tool results in user-friendly language,\n- include relevant identifiers or metadata when helpful,\n- state when no matching record is found.\n\n## Function 5: Project-Specific Scientific Questions\n\nIf the user asks a scientific question about a specific project, you may use:\n- papers associated with the project,\n- lab notebook pages,\n- workflows,\n- protocols,\n- constructs,\n- internal records,\n- web search when needed.\n\nYour priority order for project questions is:\n1. project-specific internal context,\n2. relevant uploaded or retrievable papers,\n3. notebook and workflow evidence,\n4. general scientific literature or web sources.\n\nExamples:\n- “Why did our PD-1 binder lose expression?”\n- “What did we use last time for this conjugation?”\n- “Which workflow step comes after transfection in Project X?”\n- “What papers support this assay design?”\n\nFor project questions:\n- ground answers in project evidence when available,\n- connect the answer to the actual project context,\n- cite internal sources or retrieved records in the app\'s preferred format if supported,\n- use web search only when internal context is missing or incomplete.\n\n## Function 6: General Science Questions\n\nIf the question is a general scientific question not tied to a specific project, answer directly using your knowledge and use web search when necessary.\n\nUse web search when:\n- the answer depends on recent literature or updated facts,\n- the user asks for papers, recent findings, or references,\n- your internal/project context is insufficient,\n- the question benefits from current or source-backed information.\n\nDo not overuse web search for stable foundational knowledge unless the user requests references or up-to-date information.\n\n## Function 7: PDF Paper Handling\n\nIf the agent encounters a paper that is only available as a PDF and cannot be fully and reliably parsed in the current context, do not pretend to understand it fully.\n\nInstead:\n- pause deeper paper analysis,\n- tell the user that for better comprehension of the paper, they should download and upload the PDF into the app,\n- once the PDF is uploaded, analyze it in detail.\n\nWhen this happens, say clearly that full-paper comprehension is limited until the PDF is uploaded.\n\nDo not hallucinate figure details, methods, tables, supporting information, or conclusions from incomplete PDF metadata alone.\n\n## Conversation Style\n\nYour responses should be:\n- concise but complete,\n- scientifically precise,\n- operationally useful,\n- structured when handling workflows or notebook generation,\n- clear about uncertainty.\n\nWhen asking follow-up questions:\n- ask only for the minimum information needed,\n- prefer a short list of specific missing fields,\n- avoid broad or vague requests.\n\n## Output Behavior by Task Type\n\n### A. If the user describes what they did\nOutput should:\n1. identify likely protocol match,\n2. ask for disambiguation if needed,\n3. otherwise generate a notebook page.\n\n### B. If the user asks for stored lab information\nOutput should:\n1. select tool via `agent-io-contract.json`,\n2. retrieve result,\n3. answer directly,\n4. mention if no record was found.\n\n### C. If the user asks a project science question\nOutput should:\n1. identify the project,\n2. gather internal project context,\n3. use papers/notebooks/workflows/tools as relevant,\n4. answer with project-aware reasoning,\n5. use web search if internal context is incomplete.\n\n### D. If the user asks a general science question\nOutput should:\n1. answer directly,\n2. use web search when needed,\n3. distinguish established knowledge from current literature.\n\n### E. If a PDF paper is needed but not properly available\nOutput should:\n1. stop deep analysis,\n2. ask the user to download and upload the PDF,\n3. continue only after upload.\n\n## Non-Negotiable Rules\n\n- Do not fabricate lab records.\n- Do not fabricate protocol matches.\n- Do not fabricate tool results.\n- Do not fabricate paper contents.\n- Do not fill placeholders with unsupported values.\n- Do not claim to have searched internal records, tools, papers, or workflows unless you actually did.\n- Always ask for clarification when ambiguity would materially change the notebook entry, protocol choice, or scientific answer.\n\nYour goal is to reduce lab documentation burden, improve retrieval of lab knowledge, and provide scientifically grounded assistance while remaining faithful to actual lab records and user input.';
const DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE =
  'Return JSON matching the schema exactly. Only claim write operations were executed when tool trace confirms success. Write intent detected: {{writeIntent}}.';
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

  return path.join(__dirname, 'data', AGENT_CHAT_LOG_FILE_NAME);
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

  return path.join(__dirname, 'tmp', 'agent-python-sandbox');
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
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${entry}\n`, 'utf8');
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

function sanitizeStorageName(value, fallback = 'item') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return cleaned || fallback;
}

function sanitizeImportedFileName(fileName) {
  const rawName = String(fileName || '').trim();
  const ext = path.extname(rawName).replace(/[^.\w-]+/g, '').slice(0, 24);
  const base = rawName.slice(0, Math.max(0, rawName.length - ext.length));
  const safeBase = sanitizeStorageName(base, 'imported-file');
  return `${safeBase}${ext}`;
}

function ensurePathWithinRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === resolvedRoot) {
    return resolvedTarget;
  }
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : `${resolvedRoot}${path.sep}`;
  if (!resolvedTarget.startsWith(rootWithSep)) {
    throw new Error('Target path must be inside the configured storage path.');
  }
  return resolvedTarget;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function getUniqueFilePath(folderPath, fileName) {
  const parsed = path.parse(fileName);
  const safeNameBase = sanitizeStorageName(parsed.name, 'imported-file');
  const safeExt = String(parsed.ext || '').replace(/[^.\w-]+/g, '').slice(0, 24);
  let attempt = 0;

  while (attempt < 5000) {
    const suffix = attempt === 0 ? '' : `_${attempt + 1}`;
    const candidateName = `${safeNameBase}${suffix}${safeExt}`;
    const candidatePath = path.join(folderPath, candidateName);
    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }
    attempt += 1;
  }

  throw new Error('Unable to find a unique file name for imported file.');
}

async function storeImportedFile(payload) {
  const storagePath = String(payload?.storagePath || '').trim();
  const targetFolderInput = String(payload?.targetFolder || '').trim();
  const fileName = sanitizeImportedFileName(payload?.fileName);
  const dataBase64 = String(payload?.dataBase64 || '').trim();

  if (!storagePath) {
    throw new Error('Missing storage path.');
  }
  if (!targetFolderInput) {
    throw new Error('Missing target folder.');
  }
  if (!dataBase64) {
    throw new Error('Missing imported file data.');
  }

  const resolvedStoragePath = path.resolve(storagePath);
  const resolvedTargetFolder = ensurePathWithinRoot(resolvedStoragePath, targetFolderInput);
  await fs.mkdir(resolvedTargetFolder, { recursive: true });

  const targetFilePath = await getUniqueFilePath(resolvedTargetFolder, fileName);
  const binary = Buffer.from(dataBase64, 'base64');
  await fs.writeFile(targetFilePath, binary);

  return {
    filePath: targetFilePath,
    fileName: path.basename(targetFilePath),
    relativePath: path.relative(resolvedStoragePath, targetFilePath).split(path.sep).join('/')
  };
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

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIconPath);
  }

  createWindow();
  savedTelegramToken = await loadSavedTelegramToken();
  restartTelegramBot();
  void ensureAgentChatLogFile(getAgentChatLogPath());

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

async function writeEnaFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getSidecarDataFilePaths(dataFilePath) {
  const normalizedDataPath = normalizeDataFilePath(dataFilePath, getDefaultDataFilePath());
  const baseDir = path.dirname(normalizedDataPath);
  return {
    protocolsPath: path.join(baseDir, PROTOCOLS_DATA_FILE_NAME),
    notebookPagesPath: path.join(baseDir, NOTEBOOK_PAGES_DATA_FILE_NAME)
  };
}

function normalizeChemicalStorePayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    chemicals: asArray(source.chemicals),
    blocks: asArray(source.blocks),
    lastLocationNumber: Number(source.lastLocationNumber) || 0
  };
}

function mergeChemicalsIntoSnapshot(data, chemicalsPayload) {
  const source = data && typeof data === 'object' ? data : {};
  const labInventorySource = source.labInventory && typeof source.labInventory === 'object'
    ? source.labInventory
    : {};
  const normalizedSnapshotChemicals = normalizeChemicalStorePayload(labInventorySource);
  const normalizedSidecarChemicals = chemicalsPayload
    ? normalizeChemicalStorePayload(chemicalsPayload)
    : null;
  const hasSnapshotChemicals = normalizedSnapshotChemicals.chemicals.length > 0;
  const mergedChemicalStore = hasSnapshotChemicals
    ? normalizedSnapshotChemicals
    : normalizedSidecarChemicals;

  if (!mergedChemicalStore) {
    return source;
  }

  return {
    ...source,
    labInventory: {
      ...labInventorySource,
      ...mergedChemicalStore
    }
  };
}

async function writeChemicalsFile(labInventory) {
  const payload = normalizeChemicalStorePayload(labInventory);
  await fs.mkdir(path.dirname(CHEMICALS_DATA_FILE_PATH), { recursive: true });
  await fs.writeFile(CHEMICALS_DATA_FILE_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

async function readChemicalsFile() {
  try {
    const raw = await fs.readFile(CHEMICALS_DATA_FILE_PATH, 'utf8');
    return normalizeChemicalStorePayload(JSON.parse(raw));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function normalizeProtocolsPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (Array.isArray(payload)) {
    return { protocols: asArray(payload) };
  }
  return { protocols: asArray(source.protocols) };
}

function extractNotebookResultFileAddresses(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const addresses = [];

  asArray(source.resultFileRecords).forEach((record) => {
    const filePath = String(record?.path || '').trim();
    if (filePath) {
      addresses.push(filePath);
    }
  });

  const storageFolder = String(source.storageFolder || '').trim();
  if (storageFolder && !addresses.length) {
    asArray(source.resultFiles).forEach((name) => {
      const fileName = String(name || '').trim();
      if (!fileName) {
        return;
      }
      addresses.push(path.join(storageFolder, 'ResultFiles', fileName));
    });
  }

  return Array.from(new Set(addresses));
}

function normalizeNotebookPageEntry(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const existingAddresses = asArray(source.resultFileAddresses)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const derivedAddresses = extractNotebookResultFileAddresses(source);
  return {
    ...source,
    resultFileAddresses: Array.from(new Set(existingAddresses.concat(derivedAddresses)))
  };
}

function normalizeNotebookPagesPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const pages = Array.isArray(payload) ? asArray(payload) : asArray(source.notebookPages);
  return {
    notebookPages: pages
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => normalizeNotebookPageEntry(entry))
  };
}

async function readJsonFileIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeProtocolsFile(dataFilePath, protocols) {
  const { protocolsPath } = getSidecarDataFilePaths(dataFilePath);
  const payload = {
    schema_name: 'enana_protocols',
    schema_version: '1.0.0',
    updated_at: new Date().toISOString(),
    protocols: asArray(protocols)
  };
  await fs.mkdir(path.dirname(protocolsPath), { recursive: true });
  await fs.writeFile(protocolsPath, JSON.stringify(payload, null, 2), 'utf8');
  return protocolsPath;
}

async function writeNotebookPagesFile(dataFilePath, notebookEntries) {
  const { notebookPagesPath } = getSidecarDataFilePaths(dataFilePath);
  const payload = {
    schema_name: 'enana_notebook_pages',
    schema_version: '1.0.0',
    updated_at: new Date().toISOString(),
    notebookPages: asArray(notebookEntries).map((entry) => normalizeNotebookPageEntry(entry))
  };
  await fs.mkdir(path.dirname(notebookPagesPath), { recursive: true });
  await fs.writeFile(notebookPagesPath, JSON.stringify(payload, null, 2), 'utf8');
  return notebookPagesPath;
}

async function readProtocolsFile(dataFilePath) {
  const { protocolsPath } = getSidecarDataFilePaths(dataFilePath);
  const payload = await readJsonFileIfExists(protocolsPath);
  if (!payload) {
    return null;
  }
  return {
    filePath: protocolsPath,
    ...normalizeProtocolsPayload(payload)
  };
}

async function readNotebookPagesFile(dataFilePath) {
  const { notebookPagesPath } = getSidecarDataFilePaths(dataFilePath);
  const payload = await readJsonFileIfExists(notebookPagesPath);
  if (!payload) {
    return null;
  }
  return {
    filePath: notebookPagesPath,
    ...normalizeNotebookPagesPayload(payload)
  };
}

function mergeProtocolsAndNotebookIntoSnapshot(data, sidecars = {}) {
  const source = data && typeof data === 'object' ? data : {};
  const sourceProtocols = asArray(source.protocols);
  const sourceNotebookPages = asArray(source.notebookEntries).map((entry) => normalizeNotebookPageEntry(entry));
  const hasProtocolsSidecar = Boolean(sidecars.protocols);
  const hasNotebookPagesSidecar = Boolean(sidecars.notebookPages);
  const sidecarProtocols = normalizeProtocolsPayload(sidecars.protocols || {}).protocols;
  const sidecarNotebookPages = normalizeNotebookPagesPayload(sidecars.notebookPages || {}).notebookPages;

  return {
    ...source,
    protocols: hasProtocolsSidecar ? sidecarProtocols : sourceProtocols,
    notebookEntries: hasNotebookPagesSidecar ? sidecarNotebookPages : sourceNotebookPages
  };
}

async function writeProtocolsAndNotebookSidecars(dataFilePath, snapshot, options = {}) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const shouldWriteProtocols = options.writeProtocols !== false;
  const shouldWriteNotebookPages = options.writeNotebookPages !== false;
  const result = {};

  if (shouldWriteProtocols) {
    result.protocolsPath = await writeProtocolsFile(dataFilePath, source.protocols);
  }

  if (shouldWriteNotebookPages) {
    result.notebookPagesPath = await writeNotebookPagesFile(dataFilePath, source.notebookEntries);
  }

  return result;
}

async function hydrateSnapshotFromDataFiles(dataFilePath, parsedSnapshot) {
  const chemicalsPayload = await readChemicalsFile();
  let merged = mergeChemicalsIntoSnapshot(parsedSnapshot, chemicalsPayload);
  const [protocolsPayload, notebookPagesPayload] = await Promise.all([
    readProtocolsFile(dataFilePath),
    readNotebookPagesFile(dataFilePath)
  ]);
  merged = mergeProtocolsAndNotebookIntoSnapshot(merged, {
    protocols: protocolsPayload,
    notebookPages: notebookPagesPayload
  });

  const shouldBackfillProtocols = !protocolsPayload && asArray(merged.protocols).length > 0;
  const shouldBackfillNotebookPages = !notebookPagesPayload && asArray(merged.notebookEntries).length > 0;
  if (shouldBackfillProtocols || shouldBackfillNotebookPages) {
    await writeProtocolsAndNotebookSidecars(dataFilePath, merged, {
      writeProtocols: shouldBackfillProtocols,
      writeNotebookPages: shouldBackfillNotebookPages
    });
  }

  return merged;
}

function cloneJson(value, fallback = {}) {
  if (!value || typeof value !== 'object') {
    return fallback;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function normalizeJsonPayload(payload, fallback = {}) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload;
  }
  if (typeof payload === 'string') {
    const parsed = safeParseJson(payload, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeToolInvocationArgs(rawArgs) {
  const payload = normalizeJsonPayload(rawArgs, {});
  if (payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)) {
    return payload.input;
  }
  if (payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)) {
    return payload.args;
  }
  if (payload.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments)) {
    return payload.arguments;
  }
  if (typeof payload.input_json === 'string') {
    return normalizeJsonPayload(payload.input_json, payload);
  }
  return payload;
}

ipcMain.handle('ena:save', async (_event, payload) => {
  const normalizedPayload = normalizeJsonPayload(payload, {});
  const { data, filePath } = normalizedPayload;
  if (!data) {
    return { ok: false, error: 'Missing data payload.' };
  }

  let targetPath = filePath;
  if (!targetPath) {
    const result = await dialog.showSaveDialog({
      title: 'Save Enana Data',
      defaultPath: DEFAULT_DATA_FILE_NAME,
      filters: [{ name: 'Enana Data', extensions: ['json', 'ena'] }]
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }
    targetPath = result.filePath;
  }

  if (!hasSupportedDataExtension(targetPath)) {
    targetPath = `${targetPath}.json`;
  }

  try {
    const snapshot = data && typeof data === 'object' ? data : {};
    await writeEnaFile(targetPath, snapshot);
    await writeChemicalsFile(snapshot.labInventory);
    const sidecarPaths = await writeProtocolsAndNotebookSidecars(targetPath, snapshot);
    return { ok: true, filePath: targetPath, sidecarPaths };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('ena:load', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Load Enana Data',
    properties: ['openFile'],
    filters: [{ name: 'Enana Data', extensions: ['json', 'ena'] }]
  });

  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }

  const filePath = result.filePaths[0];
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const data = await hydrateSnapshotFromDataFiles(filePath, parsed);
    return { ok: true, filePath, data, sidecarPaths: getSidecarDataFilePaths(filePath) };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('data:auto-save', async (_event, payload) => {
  const normalizedPayload = normalizeJsonPayload(payload, {});
  const { data, filePath } = normalizedPayload;
  if (!data) {
    return { ok: false, error: 'Missing data payload.' };
  }

  const targetPath = normalizeDataFilePath(filePath, getDefaultDataFilePath());

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const snapshot = data && typeof data === 'object' ? data : {};
    await writeEnaFile(targetPath, snapshot);
    await writeChemicalsFile(snapshot.labInventory);
    const sidecarPaths = await writeProtocolsAndNotebookSidecars(targetPath, snapshot);
    return { ok: true, filePath: targetPath, sidecarPaths };
  } catch (error) {
    return { ok: false, error: String(error), filePath: targetPath };
  }
});

ipcMain.handle('data:auto-load', async (_event, payload) => {
  const normalizedPayload = normalizeJsonPayload(payload, {});
  const targetPath = normalizeDataFilePath(normalizedPayload?.filePath, getDefaultDataFilePath());

  try {
    const raw = await fs.readFile(targetPath, 'utf8');
    const parsed = JSON.parse(raw);
    const data = await hydrateSnapshotFromDataFiles(targetPath, parsed);
    return { ok: true, filePath: targetPath, data, sidecarPaths: getSidecarDataFilePaths(targetPath) };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ok: true, filePath: targetPath, data: null };
    }
    return { ok: false, error: String(error), filePath: targetPath };
  }
});

ipcMain.handle('storage:pick-directory', async (_event, payload) => {
  const normalizedPayload = normalizeJsonPayload(payload, {});
  const currentPath = typeof normalizedPayload?.currentPath === 'string' ? normalizedPayload.currentPath.trim() : '';
  const result = await dialog.showOpenDialog({
    title: 'Select Storage Folder',
    defaultPath: currentPath || undefined,
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !result.filePaths.length) {
    return { ok: false, canceled: true };
  }

  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('storage:ensure-directory', async (_event, payload) => {
  const normalizedPayload = normalizeJsonPayload(payload, {});
  const targetPath = typeof normalizedPayload?.path === 'string' ? normalizedPayload.path.trim() : '';
  if (!targetPath) {
    return { ok: false, error: 'Missing directory path.' };
  }

  try {
    await fs.mkdir(targetPath, { recursive: true });
    return { ok: true, path: targetPath };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('storage:store-imported-file', async (_event, payload) => {
  try {
    const stored = await storeImportedFile(normalizeJsonPayload(payload, {}));
    return { ok: true, ...stored };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
});

ipcMain.handle('plannotate:check-env', async (_event, payload) => {
  try {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const status = await checkPlannotateEnvironment(normalizedPayload?.dbDir || '');
    return { ok: true, status };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('plannotate:annotate', async (_event, payload) => {
  try {
    const result = await annotateWithBlast(normalizeJsonPayload(payload, {}));
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
});

ipcMain.handle('plannotate:install-all', async () => {
  try {
    const result = await installPlannotateAssets();
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
});

ipcMain.handle('plannotate:generate-gbk', async (_event, payload) => {
  try {
    const gbk = generatePlannotateGbk(normalizeJsonPayload(payload, {}));
    return { ok: true, gbk };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
});

function summarizeSchemaShape(schema) {
  const source = schema && typeof schema === 'object' ? schema : {};
  const properties = source.properties && typeof source.properties === 'object'
    ? source.properties
    : {};
  const required = asArray(source.required);
  const keys = Object.keys(properties).slice(0, 10);
  if (!keys.length) {
    return '{}';
  }
  const rows = keys.map((key) => {
    const item = properties[key] && typeof properties[key] === 'object' ? properties[key] : {};
    const type = cleanText(item.type, 24) || 'any';
    const marker = required.includes(key) ? '!' : '?';
    return `${key}${marker}:${type}`;
  });
  return `{ ${rows.join(', ')} }`;
}

function buildFallbackAgentIoTools() {
  const makeTool = (name, description, limitMax = 20) => ({
    name,
    description,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: limitMax }
      }
    },
    output_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'citations', 'summary'],
      properties: {
        items: { type: 'array', items: { type: 'object' } },
        citations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['source', 'pointer', 'reason'],
            properties: {
              source: { type: 'string' },
              pointer: { type: 'string' },
              reason: { type: 'string' }
            }
          }
        },
        summary: { type: 'string' }
      }
    }
  });

  return [
    makeTool('search_projects', 'Read project records by semantic keyword or exact term.'),
    makeTool('search_protocols', 'Read protocol records, including names and step snippets.'),
    makeTool('search_notebook_entries', 'Read notebook entries with result summaries and timestamps.'),
    makeTool('search_assays', 'Read assay runs with plate metadata and compact numeric summaries.'),
    makeTool('search_gel_analyses', 'Read gel analysis runs with confidence, calibration, and warning summaries.'),
    makeTool('search_inventory', 'Read chemical and personal inventory records.', 25),
    makeTool('search_papers', 'Read uploaded paper summaries, methods, and reagent extraction notes.'),
    makeTool('search_uniprot', 'Search UniProtKB protein knowledgebase records by keyword, accession, or gene/protein term.', 25),
    makeTool('search_pubmed', 'Search PubMed literature records and return article metadata for biomedical queries.', 25),
    makeTool('search_crossref', 'Search Crossref works metadata by title, DOI, author, or keyword.', 25),
    makeTool('search_europe_pmc', 'Search Europe PMC literature records with PubMed/PMCID/DOI metadata.', 25),
    {
      name: 'run_python_sandbox',
      description: 'Run Python code in an isolated temporary sandbox for deterministic calculations and data transforms.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['code'],
        properties: {
          code: { type: 'string' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'content'],
              properties: {
                path: { type: 'string' },
                content: { type: 'string' }
              }
            }
          },
          timeout_ms: { type: 'integer', minimum: 500, maximum: 15000 },
          readback_paths: { type: 'array', items: { type: 'string' } }
        }
      },
      output_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['items', 'citations', 'summary'],
        properties: {
          items: { type: 'array', items: { type: 'object' } },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['source', 'pointer', 'reason'],
              properties: {
                source: { type: 'string' },
                pointer: { type: 'string' },
                reason: { type: 'string' }
              }
            }
          },
          summary: { type: 'string' }
        }
      }
    },
    {
      name: 'download_paper_pdf',
      description: 'Write tool. Download a paper PDF and optional SI PDFs into the configured storage path.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['linked_type', 'linked_name', 'paper_pdf_url'],
        properties: {
          linked_type: { type: 'string', enum: ['project', 'journal-club'] },
          linked_name: { type: 'string' },
          paper_pdf_url: { type: 'string' },
          paper_file_name: { type: 'string' },
          si_pdf_urls: { type: 'array', items: { type: 'string' } },
          si_file_names: { type: 'array', items: { type: 'string' } },
          storage_path: { type: 'string' }
        }
      },
      output_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['items', 'citations', 'summary'],
        properties: {
          items: { type: 'array', items: { type: 'object' } },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['source', 'pointer', 'reason'],
              properties: {
                source: { type: 'string' },
                pointer: { type: 'string' },
                reason: { type: 'string' }
              }
            }
          },
          summary: { type: 'string' }
        }
      }
    }
  ];
}

function normalizeAgentIoContract(rawContract) {
  const source = rawContract && typeof rawContract === 'object' ? rawContract : {};
  const tools = asArray(source.tools).map((tool) => {
    const name = cleanText(tool?.name, 120);
    if (!name) {
      return null;
    }
    const description = cleanText(tool?.description, 600);
    const inputSchema = tool?.input_schema && typeof tool.input_schema === 'object'
      ? cloneJson(tool.input_schema, {})
      : { type: 'object', additionalProperties: false, properties: {} };
    const outputSchema = tool?.output_schema && typeof tool.output_schema === 'object'
      ? cloneJson(tool.output_schema, {})
      : { type: 'object', additionalProperties: true };
    return {
      name,
      description,
      input_schema: inputSchema,
      output_schema: outputSchema
    };
  }).filter(Boolean);

  const outputEnvelope = source.tool_output_envelope && typeof source.tool_output_envelope === 'object'
    ? cloneJson(source.tool_output_envelope, {})
    : {};

  return {
    schema_name: cleanText(source.schema_name, 120) || 'enana_llm_agent_io',
    schema_version: cleanText(source.schema_version, 40) || '1.0.0',
    tools: tools.length ? tools : buildFallbackAgentIoTools(),
    tool_output_envelope: outputEnvelope,
    functions: asArray(source.functions).map((item) => cloneJson(item, {})).filter(Boolean)
  };
}

function buildAgentToolContractPrompt(contract) {
  const source = contract && typeof contract === 'object' ? contract : {};
  const tools = asArray(source.tools);
  if (!tools.length) {
    return '';
  }
  const header = `Tool I/O contract ${cleanText(source.schema_name, 80) || 'enana_llm_agent_io'} v${
    cleanText(source.schema_version, 40) || '1.0.0'
  }`;
  const rows = tools.map((tool) => {
    const name = cleanText(tool?.name, 120) || 'unknown_tool';
    const inputShape = summarizeSchemaShape(tool?.input_schema);
    const outputShape = summarizeSchemaShape(tool?.output_schema);
    return `- ${name} input ${inputShape} output ${outputShape}`;
  });
  return `${header}\n${rows.join('\n')}`;
}

const AGENT_IO_CONTRACT = normalizeAgentIoContract(AGENT_IO_CONTRACT_RAW);
const AGENT_TOOL_DEFINITIONS = AGENT_IO_CONTRACT.tools.map((tool) => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  parameters: cloneJson(tool.input_schema, { type: 'object', additionalProperties: false, properties: {} })
}));
const AGENT_TOOL_DEFINITION_MAP = new Map(AGENT_IO_CONTRACT.tools.map((tool) => [tool.name, tool]));
const AGENT_TOOL_DEFINITION_INPUT_MAP = new Map(AGENT_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
const AGENT_TOOL_OUTPUT_ENVELOPE = AGENT_IO_CONTRACT.tool_output_envelope && typeof AGENT_IO_CONTRACT.tool_output_envelope === 'object'
  ? AGENT_IO_CONTRACT.tool_output_envelope
  : {};
const AGENT_TOOL_OUTPUT_SCHEMA_NAME = cleanText(AGENT_TOOL_OUTPUT_ENVELOPE.schema_name, 120) || 'enana_agent_tool_output';
const AGENT_TOOL_OUTPUT_SCHEMA_VERSION = cleanText(AGENT_TOOL_OUTPUT_ENVELOPE.schema_version, 40)
  || AGENT_IO_CONTRACT.schema_version
  || '1.0.0';
const AGENT_TOOL_CONTRACT_PROMPT = buildAgentToolContractPrompt(AGENT_IO_CONTRACT);

const AGENT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'answer',
    'confidence',
    'requires_approval',
    'proposed_write_actions',
    'citations',
    'decision_record'
  ],
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    requires_approval: { type: 'boolean' },
    proposed_write_actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tool_name', 'reason'],
        properties: {
          tool_name: { type: 'string' },
          reason: { type: 'string' }
        }
      }
    },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'pointer', 'reason'],
        properties: {
          source: { type: 'string' },
          pointer: { type: 'string' },
          reason: { type: 'string' }
        }
      }
    },
    decision_record: {
      type: 'object',
      additionalProperties: false,
      required: ['assumptions', 'open_questions', 'verification_notes'],
      properties: {
        assumptions: { type: 'array', items: { type: 'string' } },
        open_questions: { type: 'array', items: { type: 'string' } },
        verification_notes: { type: 'array', items: { type: 'string' } }
      }
    },
    routing: {
      type: 'object',
      additionalProperties: false,
      properties: {
        intent: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        entities: { type: 'object', additionalProperties: true },
        plan: { type: 'object', additionalProperties: true },
        classifier: { type: 'object', additionalProperties: true }
      }
    }
  }
};

const ROUTING_FALLBACK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'confidence', 'entities', 'needs_clarification', 'clarification_question', 'reason'],
  properties: {
    intent: { type: 'string', enum: ROUTING_INTENTS },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    entities: {
      type: 'object',
      additionalProperties: false,
      properties: {
        activity: { type: 'string' },
        project: { type: 'string' },
        protein: { type: 'string' },
        compound: { type: 'string' },
        protocol: { type: 'string' },
        cell_line: { type: 'string' },
        paper_title: { type: 'string' },
        workflow_step: { type: 'string' }
      }
    },
    needs_clarification: { type: 'boolean' },
    clarification_question: { type: 'string' },
    reason: { type: 'string' }
  }
};

function toInputText(role, text) {
  return {
    role,
    content: [
      {
        type: 'input_text',
        text: String(text || '')
      }
    ]
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function safeParseJson(text, fallback) {
  try {
    const parsed = JSON.parse(String(text || ''));
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks = [];
  asArray(payload?.output).forEach((item) => {
    if (item?.type === 'message') {
      asArray(item.content).forEach((content) => {
        if (content?.type === 'output_text' && content.text) {
          chunks.push(content.text);
        }
      });
    } else if (item?.type === 'output_text' && item.text) {
      chunks.push(item.text);
    }
  });
  return chunks.join('\n').trim();
}

function extractFunctionCalls(payload) {
  return asArray(payload?.output)
    .filter((item) => item?.type === 'function_call')
    .map((item) => ({
      callId: String(item.call_id || item.id || ''),
      name: String(item.name || '').trim(),
      argsText: String(item.arguments || '{}')
    }))
    .filter((item) => item.callId && item.name);
}

function containsWriteIntent(text) {
  return /\b(create|update|edit|delete|remove|reserve|consume|commit|save|download|fetch|import|upload|store)\b/i
    .test(String(text || ''));
}

function isWriteTool(name) {
  return String(name || '').trim() === 'download_paper_pdf';
}

function isComputeTool(name) {
  return String(name || '').trim() === 'run_python_sandbox';
}

function normalizeRoutingPayload(rawRouting) {
  const source = rawRouting && typeof rawRouting === 'object' ? rawRouting : {};
  const entities = source.entities && typeof source.entities === 'object' ? source.entities : {};
  const plan = source.plan && typeof source.plan === 'object' ? source.plan : {};
  const classifier = source.classifier && typeof source.classifier === 'object' ? source.classifier : {};
  const selectedToolNames = asArray(plan.selected_tool_names).map((item) => cleanText(item, 120)).filter(Boolean);
  return {
    intent: ROUTING_INTENTS.includes(cleanText(source.intent, 80)) ? cleanText(source.intent, 80) : 'general_science_question',
    confidence: Number.isFinite(Number(source.confidence))
      ? clamp(Number(source.confidence), 0, 1)
      : 0.5,
    entities: {
      activity: cleanText(entities.activity, 180),
      project: cleanText(entities.project, 180),
      protein: cleanText(entities.protein, 100),
      compound: cleanText(entities.compound, 120),
      protocol: cleanText(entities.protocol, 220),
      cell_line: cleanText(entities.cell_line, 80),
      paper_title: cleanText(entities.paper_title, 220),
      workflow_step: cleanText(entities.workflow_step, 180)
    },
    plan: {
      needs_tools: plan.needs_tools === true,
      needs_protocol_search: plan.needs_protocol_search === true,
      needs_notebook_retrieval: plan.needs_notebook_retrieval === true,
      needs_pdf_reading: plan.needs_pdf_reading === true,
      needs_python: plan.needs_python === true,
      needs_web_search: plan.needs_web_search === true,
      needs_clarification: plan.needs_clarification === true,
      clarification_reason: cleanText(plan.clarification_reason, 260),
      clarification_question: cleanText(plan.clarification_question, 320),
      selected_tool_names: selectedToolNames
    },
    classifier: {
      source: cleanText(classifier.source, 80) || 'rules',
      fallbackAttempted: classifier.fallbackAttempted === true,
      fallbackUsed: classifier.fallbackUsed === true,
      lowConfidence: classifier.lowConfidence === true,
      tieDetected: classifier.tieDetected === true,
      ruleReason: cleanText(classifier.ruleReason, 260),
      fallbackError: cleanText(classifier.fallbackError, 260),
      ruleScores: classifier.ruleScores && typeof classifier.ruleScores === 'object'
        ? classifier.ruleScores
        : {}
    }
  };
}

function buildRoutingAssumptionRows(routing) {
  const normalized = normalizeRoutingPayload(routing);
  const rows = [
    `Routing intent=${normalized.intent} confidence=${normalized.confidence.toFixed(2)} source=${normalized.classifier.source}.`,
    `Planner flags tools=${normalized.plan.needs_tools} protocol_search=${normalized.plan.needs_protocol_search} notebook_retrieval=${normalized.plan.needs_notebook_retrieval} pdf=${normalized.plan.needs_pdf_reading} python=${normalized.plan.needs_python} web=${normalized.plan.needs_web_search} clarification=${normalized.plan.needs_clarification}.`
  ];
  if (normalized.plan.selected_tool_names.length) {
    rows.push(`Planner selected tools: ${normalized.plan.selected_tool_names.join(', ')}.`);
  }
  if (normalized.classifier.fallbackAttempted) {
    rows.push(normalized.classifier.fallbackUsed
      ? 'Routing fallback completed successfully.'
      : `Routing fallback attempted but not used${normalized.classifier.fallbackError ? `: ${normalized.classifier.fallbackError}` : '.'}`);
  }
  return rows;
}

function buildIntermediateState(stage, goal, extras = {}) {
  return {
    state_id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    created_at: new Date().toISOString(),
    stage,
    goal: cleanText(goal, 600),
    assumptions: asArray(extras.assumptions).map((item) => cleanText(item, 300)).filter(Boolean),
    open_questions: asArray(extras.openQuestions).map((item) => cleanText(item, 300)).filter(Boolean),
    evidence: asArray(extras.evidence).slice(0, 20).map((item) => ({
      source: cleanText(item?.source, 140),
      pointer: cleanText(item?.pointer, 200),
      reason: cleanText(item?.reason, 240)
    })),
    proposed_actions: asArray(extras.proposedActions).slice(0, 10).map((item) => ({
      action_type: cleanText(item?.action_type, 40),
      tool_name: cleanText(item?.tool_name, 80),
      risk_level: cleanText(item?.risk_level, 20),
      reason: cleanText(item?.reason, 260)
    })),
    tool_budget: {
      max_calls: MAX_AGENT_TOOL_ROUNDS,
      max_tokens_estimate: 6000
    },
    confidence: Number.isFinite(extras.confidence) ? clamp(Number(extras.confidence), 0, 1) : 0.5
  };
}

function normalizeAgentSnapshot(rawSnapshot) {
  const snapshot = rawSnapshot && typeof rawSnapshot === 'object' ? rawSnapshot : {};
  const experimentData = snapshot.experimentData && typeof snapshot.experimentData === 'object'
    ? snapshot.experimentData
    : {};
  const normalizedPersonalInventory = Array.isArray(snapshot.inventory?.personal)
    ? asArray(snapshot.inventory.personal).slice(0, 40)
    : snapshot.inventory?.personal && typeof snapshot.inventory.personal === 'object'
      ? Object.entries(snapshot.inventory.personal)
        .slice(0, 40)
        .map(([zone, items]) => ({
          zone: cleanText(zone, 80),
          items: asArray(items).slice(0, 60)
        }))
      : [];
  const assays = asArray(snapshot.assays).length
    ? asArray(snapshot.assays).slice(0, 80)
    : asArray(experimentData.assay_runs).slice(0, 80);
  const gelAnalyses = asArray(snapshot.gelAnalyses).length
    ? asArray(snapshot.gelAnalyses).slice(0, 80)
    : asArray(experimentData.gel_runs).slice(0, 80);
  const normalizedExperimentData = {
    schema_name: cleanText(experimentData.schema_name, 80) || 'enana_experiment_json',
    schema_version: cleanText(experimentData.schema_version, 20) || '1.0',
    generated_utc: cleanText(experimentData.generated_utc, 80) || cleanText(snapshot.timestamp, 80),
    notebook_runs: asArray(experimentData.notebook_runs).slice(0, 120),
    assay_runs: asArray(experimentData.assay_runs).slice(0, 80),
    gel_runs: asArray(experimentData.gel_runs).slice(0, 80)
  };
  if (!normalizedExperimentData.assay_runs.length && assays.length) {
    normalizedExperimentData.assay_runs = assays;
  }
  if (!normalizedExperimentData.gel_runs.length && gelAnalyses.length) {
    normalizedExperimentData.gel_runs = gelAnalyses;
  }
  return {
    projects: asArray(snapshot.projects).slice(0, 40),
    protocols: asArray(snapshot.protocols).slice(0, 100),
    notebookEntries: asArray(snapshot.notebookEntries).slice(0, 180),
    assays,
    gelAnalyses,
    experimentData: normalizedExperimentData,
    papers: asArray(snapshot.papers).slice(0, 80),
    inventory: snapshot.inventory && typeof snapshot.inventory === 'object'
      ? {
        personal: normalizedPersonalInventory,
        chemicals: asArray(snapshot.inventory.chemicals).slice(0, 160)
      }
      : { personal: [], chemicals: [] },
    settings: {
      storagePath: cleanText(snapshot?.settings?.storagePath || snapshot?.storagePath, 1200)
    },
    timestamp: cleanText(snapshot.timestamp, 80)
  };
}

function scoreByQuery(text, queryTokens) {
  if (!queryTokens.length) {
    return 1;
  }
  const haystack = String(text || '').toLowerCase();
  return queryTokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
}

function normalizeQuery(value) {
  const query = cleanText(value, 300).toLowerCase();
  const tokens = query
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 12);
  return { query, tokens };
}

function pickTopMatches(items, buildSearchText, query, limit) {
  const { tokens } = normalizeQuery(query);
  const scored = items.map((item) => ({
    item,
    score: scoreByQuery(buildSearchText(item), tokens)
  }));
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, clamp(Number(limit) || 6, 1, 25))
    .map((entry) => entry.item);
}

function buildUrlWithParams(baseUrl, params = {}) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    const text = String(value).trim();
    if (!text) {
      return;
    }
    url.searchParams.set(key, text);
  });
  return url.toString();
}

async function fetchExternalJson(url, options = {}) {
  const timeoutMs = clamp(Number(options.timeoutMs) || EXTERNAL_BIO_API_TIMEOUT_MS, 1000, 30000);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    Accept: 'application/json',
    'User-Agent': EXTERNAL_BIO_API_USER_AGENT,
    ...(options.headers && typeof options.headers === 'object' ? options.headers : {})
  };

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${raw ? `: ${cleanText(raw, 240)}` : ''}`);
    }
    const parsed = safeParseJson(raw, null);
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error('Response was not valid JSON.');
    }
    return parsed;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function formatDateParts(parts) {
  if (!Array.isArray(parts) || !parts.length) {
    return '';
  }
  const year = Number(parts[0]);
  if (!Number.isFinite(year) || year <= 0) {
    return '';
  }
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (Number.isFinite(month) && month >= 1 && month <= 12) {
    const monthText = String(month).padStart(2, '0');
    if (Number.isFinite(day) && day >= 1 && day <= 31) {
      return `${year}-${monthText}-${String(day).padStart(2, '0')}`;
    }
    return `${year}-${monthText}`;
  }
  return String(year);
}

function parseUniProtProteinName(entry) {
  const description = entry?.proteinDescription && typeof entry.proteinDescription === 'object'
    ? entry.proteinDescription
    : {};
  const recommended = cleanText(description?.recommendedName?.fullName?.value, 280);
  if (recommended) {
    return recommended;
  }
  const submission = cleanText(asArray(description?.submissionNames)[0]?.fullName?.value, 280);
  if (submission) {
    return submission;
  }
  return cleanText(asArray(description?.alternativeNames)[0]?.fullName?.value, 280);
}

function parsePubMedDoi(summary) {
  const doi = asArray(summary?.articleids).find((item) => cleanText(item?.idtype, 40).toLowerCase() === 'doi');
  return cleanText(doi?.value, 220);
}

function parseCrossrefPublishedDate(item) {
  const candidates = [
    item?.issued,
    item?.published,
    item?.['published-print'],
    item?.['published-online'],
    item?.created
  ];
  for (const candidate of candidates) {
    const parts = asArray(candidate?.['date-parts'])[0];
    const formatted = formatDateParts(parts);
    if (formatted) {
      return formatted;
    }
  }
  return '';
}

async function searchUniProtRecords(query, limit) {
  const url = buildUrlWithParams('https://rest.uniprot.org/uniprotkb/search', {
    query,
    format: 'json',
    size: String(limit),
    fields: 'accession,id,protein_name,gene_names,organism_name,length,reviewed'
  });
  const payload = await fetchExternalJson(url);
  return asArray(payload?.results).slice(0, limit).map((entry) => {
    const accession = cleanText(entry?.primaryAccession, 40);
    const entryId = cleanText(entry?.uniProtkbId, 80);
    const entryType = cleanText(entry?.entryType, 80).toLowerCase();
    const reviewed = entryType.includes('reviewed') && !entryType.includes('unreviewed');
    return {
      accession,
      entry_id: entryId,
      protein_name: parseUniProtProteinName(entry),
      gene_names: asArray(entry?.genes)
        .map((gene) => cleanText(gene?.geneName?.value, 80))
        .filter(Boolean)
        .slice(0, 6),
      organism: cleanText(entry?.organism?.scientificName, 180),
      reviewed,
      length: Number(entry?.sequence?.length) || 0,
      uniprot_url: accession ? `https://www.uniprot.org/uniprotkb/${encodeURIComponent(accession)}` : ''
    };
  }).filter((item) => item.accession || item.entry_id || item.protein_name);
}

async function searchPubMedRecords(query, limit) {
  const searchUrl = buildUrlWithParams('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
    db: 'pubmed',
    retmode: 'json',
    retmax: String(limit),
    sort: 'relevance',
    term: query
  });
  const searchPayload = await fetchExternalJson(searchUrl);
  const ids = asArray(searchPayload?.esearchresult?.idlist)
    .map((id) => cleanText(id, 40))
    .filter(Boolean)
    .slice(0, limit);

  if (!ids.length) {
    return [];
  }

  const summaryUrl = buildUrlWithParams('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi', {
    db: 'pubmed',
    retmode: 'json',
    id: ids.join(',')
  });
  const summaryPayload = await fetchExternalJson(summaryUrl);
  const records = summaryPayload?.result && typeof summaryPayload.result === 'object'
    ? summaryPayload.result
    : {};

  return ids.map((pmid) => {
    const entry = records[pmid] && typeof records[pmid] === 'object' ? records[pmid] : {};
    return {
      pmid,
      title: cleanText(entry?.title, 500),
      journal: cleanText(entry?.fulljournalname, 220),
      pubdate: cleanText(entry?.pubdate, 80),
      doi: parsePubMedDoi(entry),
      authors: asArray(entry?.authors).map((author) => cleanText(author?.name, 120)).filter(Boolean).slice(0, 8),
      pubmed_url: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`
    };
  }).filter((item) => item.pmid);
}

async function searchCrossrefRecords(query, limit) {
  const url = buildUrlWithParams('https://api.crossref.org/works', {
    query,
    rows: String(limit),
    sort: 'relevance',
    order: 'desc',
    select: 'DOI,title,author,container-title,issued,published,published-print,published-online,URL,type,is-referenced-by-count,score'
  });
  const payload = await fetchExternalJson(url);
  return asArray(payload?.message?.items).slice(0, limit).map((item) => {
    const doi = cleanText(item?.DOI, 200);
    return {
      doi,
      title: cleanText(asArray(item?.title)[0], 500),
      journal: cleanText(asArray(item?.['container-title'])[0], 220),
      published: parseCrossrefPublishedDate(item),
      type: cleanText(item?.type, 120),
      cited_by_count: Number(item?.['is-referenced-by-count']) || 0,
      authors: asArray(item?.author).map((author) => {
        const given = cleanText(author?.given, 80);
        const family = cleanText(author?.family, 80);
        return cleanText(`${given} ${family}`.trim(), 180);
      }).filter(Boolean).slice(0, 8),
      url: cleanText(item?.URL, 1200) || (doi ? `https://doi.org/${encodeURIComponent(doi)}` : '')
    };
  }).filter((item) => item.doi || item.title);
}

async function searchEuropePmcRecords(query, limit) {
  const url = buildUrlWithParams('https://www.ebi.ac.uk/europepmc/webservices/rest/search', {
    query,
    format: 'json',
    pageSize: String(limit),
    sort: 'RELEVANCE'
  });
  const payload = await fetchExternalJson(url);
  return asArray(payload?.resultList?.result).slice(0, limit).map((entry) => {
    const source = cleanText(entry?.source, 20);
    const id = cleanText(entry?.id, 80);
    return {
      id,
      source,
      title: cleanText(entry?.title, 500),
      author_string: cleanText(entry?.authorString, 320),
      journal: cleanText(entry?.journalTitle, 220),
      pub_year: cleanText(entry?.pubYear, 20),
      doi: cleanText(entry?.doi, 220),
      pmid: cleanText(entry?.pmid, 40),
      pmcid: cleanText(entry?.pmcid, 40),
      europe_pmc_url: source && id
        ? `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(id)}`
        : ''
    };
  }).filter((item) => item.id || item.doi || item.pmid || item.pmcid || item.title);
}

function normalizeAgentToolResultPayload(rawResult) {
  const source = rawResult && typeof rawResult === 'object' ? rawResult : {};
  return {
    items: asArray(source.items),
    citations: asArray(source.citations).map((citation) => ({
      source: cleanText(citation?.source, 120),
      pointer: cleanText(citation?.pointer, 180),
      reason: cleanText(citation?.reason, 220)
    })),
    summary: cleanText(source.summary, 320) || 'No summary was generated.'
  };
}

function buildAgentToolOutputEnvelope(toolName, args, rawResult, options = {}) {
  const normalizedArgs = normalizeToolInvocationArgs(args);
  const normalizedResult = normalizeAgentToolResultPayload(rawResult);
  const ok = options.ok !== false;
  const error = cleanText(options.error, 600);
  return {
    ok,
    schema_name: AGENT_TOOL_OUTPUT_SCHEMA_NAME,
    schema_version: AGENT_TOOL_OUTPUT_SCHEMA_VERSION,
    tool_name: cleanText(toolName, 120),
    input: cloneJson(normalizedArgs, {}),
    result: normalizedResult,
    items: normalizedResult.items,
    citations: normalizedResult.citations,
    summary: normalizedResult.summary,
    generated_at: new Date().toISOString(),
    ...(error ? { error } : {})
  };
}

async function runAgentTool(name, args, snapshot, options = {}) {
  const normalizedArgs = normalizeToolInvocationArgs(args);
  const query = cleanText(normalizedArgs?.query, 300);
  const requestedLimit = Number(normalizedArgs?.limit);
  const toolDefinition = AGENT_TOOL_DEFINITION_MAP.get(name);
  const schemaLimit = Number(toolDefinition?.input_schema?.properties?.limit?.maximum);
  const limitCap = Number.isFinite(schemaLimit) && schemaLimit > 0 ? schemaLimit : 25;
  const limit = clamp(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 6, 1, limitCap);
  const allowWriteTools = options?.allowWriteTools === true;
  const protocolStepText = (step) => {
    if (typeof step === 'string') {
      return cleanText(step, 220);
    }
    return cleanText(step?.text || step?.instruction, 220);
  };

  if (name === 'search_projects') {
    const items = pickTopMatches(
      snapshot.projects,
      (project) => `${project?.name || ''} ${project?.summary || ''}`,
      query,
      limit
    ).map((project) => ({
      id: cleanText(project?.id, 80),
      name: cleanText(project?.name, 200),
      summary: cleanText(project?.summary, 300)
    }));

    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items,
      citations: items.map((project) => ({
        source: 'project',
        pointer: project.id || project.name,
        reason: 'Matched project metadata.'
      })),
      summary: `Found ${items.length} matching projects.`
    });
  }

  if (name === 'search_protocols') {
    const items = pickTopMatches(
      snapshot.protocols,
      (protocol) => `${protocol?.name || ''} ${protocol?.category || ''} ${
        asArray(protocol?.steps).map((step) => protocolStepText(step)).filter(Boolean).join(' ')
      }`,
      query,
      limit
    ).map((protocol) => ({
      id: cleanText(protocol?.id, 80),
      name: cleanText(protocol?.name, 180),
      category: cleanText(protocol?.category, 80),
      steps: asArray(protocol?.steps).slice(0, 8).map((step) => protocolStepText(step)).filter(Boolean)
    }));

    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items,
      citations: items.map((protocol) => ({
        source: 'protocol',
        pointer: protocol.id || protocol.name,
        reason: 'Matched protocol name/steps.'
      })),
      summary: `Found ${items.length} matching protocols.`
    });
  }

  if (name === 'search_notebook_entries') {
    const items = pickTopMatches(
      snapshot.notebookEntries,
      (entry) => `${entry?.protocolName || ''} ${entry?.result || ''} ${entry?.updatedAt || ''}`,
      query,
      limit
    ).map((entry) => ({
      id: cleanText(entry?.id, 80),
      protocolName: cleanText(entry?.protocolName, 180),
      result: cleanText(entry?.result, 400),
      updatedAt: cleanText(entry?.updatedAt, 80)
    }));

    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items,
      citations: items.map((entry) => ({
        source: 'notebook_entry',
        pointer: entry.id || entry.protocolName,
        reason: 'Matched notebook summary/results.'
      })),
      summary: `Found ${items.length} matching notebook entries.`
    });
  }

  if (name === 'search_assays') {
    const items = pickTopMatches(
      snapshot.assays,
      (assay) => [
        assay?.assay_number,
        assay?.name,
        assay?.project_name,
        assay?.notebook_entry_protocol_name,
        assay?.notes,
        assay?.axis?.sample_axis,
        assay?.axis?.concentration_axis,
        asArray(assay?.axis?.sample_values).join(' '),
        asArray(assay?.axis?.concentration_values).join(' ')
      ].join(' '),
      query,
      limit
    ).map((assay) => ({
      id: cleanText(assay?.id, 80),
      assay_number: cleanText(assay?.assay_number, 80),
      name: cleanText(assay?.name, 180),
      project_name: cleanText(assay?.project_name, 180),
      notebook_entry_protocol_name: cleanText(assay?.notebook_entry_protocol_name, 180),
      sample_axis: cleanText(assay?.axis?.sample_axis, 30),
      concentration_axis: cleanText(assay?.axis?.concentration_axis, 30),
      result_well_count: Number(assay?.result_summary?.result_well_count) || 0,
      numeric_count: Number(assay?.result_summary?.numeric_count) || 0,
      updated_at: cleanText(assay?.updated_at, 80)
    }));

    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items,
      citations: items.map((assay) => ({
        source: 'assay',
        pointer: assay.id || assay.name || assay.assay_number,
        reason: 'Matched assay metadata or axis annotations.'
      })),
      summary: `Found ${items.length} matching assays.`
    });
  }

  if (name === 'search_gel_analyses') {
    const items = pickTopMatches(
      snapshot.gelAnalyses,
      (analysis) => [
        analysis?.name,
        analysis?.analysis_type,
        analysis?.project_name,
        analysis?.notebook_entry_protocol_name,
        analysis?.image_name,
        asArray(analysis?.warnings).join(' ')
      ].join(' '),
      query,
      limit
    ).map((analysis) => ({
      id: cleanText(analysis?.id, 80),
      name: cleanText(analysis?.name, 180),
      analysis_type: cleanText(analysis?.analysis_type, 40),
      project_name: cleanText(analysis?.project_name, 180),
      notebook_entry_protocol_name: cleanText(analysis?.notebook_entry_protocol_name, 180),
      image_name: cleanText(analysis?.image_name, 220),
      lane_count: Number(analysis?.lane_count) || 0,
      band_count: Number(analysis?.band_count) || 0,
      confidence_label: cleanText(analysis?.confidence?.label, 80),
      confidence_score: Number.isFinite(Number(analysis?.confidence?.score))
        ? Number(analysis?.confidence?.score)
        : null,
      warnings: asArray(analysis?.warnings).slice(0, 4).map((warning) => cleanText(warning, 220)),
      updated_at: cleanText(analysis?.updated_at, 80)
    }));

    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items,
      citations: items.map((analysis) => ({
        source: 'gel_analysis',
        pointer: analysis.id || analysis.name,
        reason: 'Matched gel metadata, warnings, or confidence fields.'
      })),
      summary: `Found ${items.length} matching gel analyses.`
    });
  }

  if (name === 'search_inventory') {
    const personalItems = asArray(snapshot.inventory?.personal).flatMap((zone) => asArray(zone?.items).map((item) => ({
      zone: cleanText(zone?.zone, 80),
      id: cleanText(item?.id, 80),
      name: cleanText(item?.name, 180),
      quantity: cleanText(item?.quantity, 80),
      location: cleanText(item?.location, 120)
    })));
    const chemicalItems = asArray(snapshot.inventory?.chemicals).map((item) => ({
      id: cleanText(item?.id, 80),
      name: cleanText(item?.name, 180),
      amount: cleanText(item?.amount, 80),
      cas: cleanText(item?.cas, 80),
      location: cleanText(item?.location, 120),
      supplier: cleanText(item?.supplier, 160)
    }));
    const merged = [
      ...personalItems.map((item) => ({ kind: 'personal_inventory', ...item })),
      ...chemicalItems.map((item) => ({ kind: 'chemical_inventory', ...item }))
    ];
    const items = pickTopMatches(
      merged,
      (item) => `${item?.kind || ''} ${item?.name || ''} ${item?.cas || ''} ${item?.location || ''} ${item?.supplier || ''}`,
      query,
      limit
    );

    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items,
      citations: items.map((item) => ({
        source: item.kind || 'inventory',
        pointer: item.id || item.name,
        reason: 'Matched inventory name and metadata.'
      })),
      summary: `Found ${items.length} matching inventory records.`
    });
  }

  if (name === 'search_papers') {
    const items = pickTopMatches(
      snapshot.papers,
      (paper) => `${paper?.title || ''} ${paper?.summary || ''} ${
        asArray(paper?.methods).flatMap((method) => [method?.title, ...asArray(method?.steps)]).join(' ')
      }`,
      query,
      limit
    ).map((paper) => ({
      id: cleanText(paper?.id, 80),
      title: cleanText(paper?.title, 220),
      summary: cleanText(paper?.summary, 500),
      methods: asArray(paper?.methods).slice(0, 4).map((method) => ({
        title: cleanText(method?.title, 180),
        steps: asArray(method?.steps).slice(0, 6).map((step) => cleanText(step, 200)).filter(Boolean),
        citations: asArray(method?.citations).slice(0, 6).map((citation) => cleanText(citation, 140)).filter(Boolean)
      }))
    }));

    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items,
      citations: items.map((paper) => ({
        source: 'paper',
        pointer: paper.id || paper.title,
        reason: 'Matched paper title, summary, or extracted methods.'
      })),
      summary: `Found ${items.length} matching papers.`
    });
  }

  if (name === 'search_uniprot') {
    if (!query) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'No query was provided for UniProt search.'
      });
    }

    try {
      const items = await searchUniProtRecords(query, limit);
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items,
        citations: items.map((item) => ({
          source: 'uniprot',
          pointer: item.accession || item.entry_id,
          reason: 'Matched UniProtKB protein record.'
        })),
        summary: `Found ${items.length} matching UniProt records.`
      });
    } catch (error) {
      return buildAgentToolOutputEnvelope(
        name,
        normalizedArgs,
        {
          items: [],
          citations: [],
          summary: 'UniProt search failed.'
        },
        {
          ok: false,
          error: cleanText(error?.message || error, 600)
        }
      );
    }
  }

  if (name === 'search_pubmed') {
    if (!query) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'No query was provided for PubMed search.'
      });
    }

    try {
      const items = await searchPubMedRecords(query, limit);
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items,
        citations: items.map((item) => ({
          source: 'pubmed',
          pointer: item.pmid,
          reason: 'Matched PubMed article metadata.'
        })),
        summary: `Found ${items.length} matching PubMed records.`
      });
    } catch (error) {
      return buildAgentToolOutputEnvelope(
        name,
        normalizedArgs,
        {
          items: [],
          citations: [],
          summary: 'PubMed search failed.'
        },
        {
          ok: false,
          error: cleanText(error?.message || error, 600)
        }
      );
    }
  }

  if (name === 'search_crossref') {
    if (!query) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'No query was provided for Crossref search.'
      });
    }

    try {
      const items = await searchCrossrefRecords(query, limit);
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items,
        citations: items.map((item) => ({
          source: 'crossref',
          pointer: item.doi || item.url || item.title,
          reason: 'Matched Crossref works metadata.'
        })),
        summary: `Found ${items.length} matching Crossref records.`
      });
    } catch (error) {
      return buildAgentToolOutputEnvelope(
        name,
        normalizedArgs,
        {
          items: [],
          citations: [],
          summary: 'Crossref search failed.'
        },
        {
          ok: false,
          error: cleanText(error?.message || error, 600)
        }
      );
    }
  }

  if (name === 'search_europe_pmc') {
    if (!query) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'No query was provided for Europe PMC search.'
      });
    }

    try {
      const items = await searchEuropePmcRecords(query, limit);
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items,
        citations: items.map((item) => ({
          source: 'europe_pmc',
          pointer: item.pmid || item.pmcid || item.doi || item.id,
          reason: 'Matched Europe PMC literature metadata.'
        })),
        summary: `Found ${items.length} matching Europe PMC records.`
      });
    } catch (error) {
      return buildAgentToolOutputEnvelope(
        name,
        normalizedArgs,
        {
          items: [],
          citations: [],
          summary: 'Europe PMC search failed.'
        },
        {
          ok: false,
          error: cleanText(error?.message || error, 600)
        }
      );
    }
  }

  if (name === 'run_python_sandbox') {
    const sandboxResult = await runPythonSandbox(normalizedArgs, {
      sandboxRoot: getAgentPythonSandboxRoot(),
      preferredPythonBin: cleanText(process.env.ENANA_AGENT_PYTHON_BIN, 220)
    });

    const readbackFiles = asArray(sandboxResult.readback_files).map((file) => ({
      path: cleanText(file?.path, 260),
      content: cleanText(file?.content, 12000),
      truncated: file?.truncated === true
    }));
    const item = {
      run_id: cleanText(sandboxResult.run_id, 120),
      status: cleanText(sandboxResult.status, 40),
      timeout_ms: Number(sandboxResult.timeout_ms) || 0,
      python_executable: cleanText(sandboxResult.python_executable, 140),
      exit_code: Number.isFinite(Number(sandboxResult.exit_code)) ? Number(sandboxResult.exit_code) : null,
      signal: cleanText(sandboxResult.signal, 40),
      timed_out: sandboxResult.timed_out === true,
      stdout: cleanText(sandboxResult.stdout, 12000),
      stderr: cleanText(sandboxResult.stderr, 12000),
      files_written: asArray(sandboxResult.files_written).map((value) => cleanText(value, 240)).filter(Boolean),
      readback_files: readbackFiles,
      warnings: asArray(sandboxResult.warnings).map((value) => cleanText(value, 220)).filter(Boolean)
    };
    const summary = cleanText(sandboxResult.summary, 320)
      || (sandboxResult.ok ? 'Python sandbox execution completed.' : 'Python sandbox execution failed.');

    return buildAgentToolOutputEnvelope(
      name,
      normalizedArgs,
      {
        items: [item],
        citations: [
          {
            source: 'python_sandbox',
            pointer: item.run_id || 'python_sandbox',
            reason: sandboxResult.ok
              ? 'Executed Python code in isolated sandbox.'
              : 'Python sandbox execution returned an error.'
          }
        ],
        summary
      },
      {
        ok: sandboxResult.ok === true,
        error: sandboxResult.ok
          ? ''
          : cleanText(sandboxResult.error || sandboxResult.stderr, 600)
      }
    );
  }

  if (name === 'download_paper_pdf') {
    if (!allowWriteTools) {
      return buildAgentToolOutputEnvelope(
        name,
        normalizedArgs,
        {
          items: [],
          citations: [],
          summary: 'Write action blocked: explicit approval is required before downloading files.'
        },
        {
          ok: false,
          error: 'Write action blocked: explicit approval is required.'
        }
      );
    }

    const linkedTypeRaw = cleanText(normalizedArgs?.linked_type, 40).toLowerCase();
    const linkedType = linkedTypeRaw === 'journal-club' ? 'journal-club' : 'project';
    const linkedName = cleanText(normalizedArgs?.linked_name, 180) || 'Uncategorized';
    const storagePath = cleanText(normalizedArgs?.storage_path, 1200)
      || cleanText(snapshot?.settings?.storagePath, 1200);
    const paperPdfUrl = cleanText(normalizedArgs?.paper_pdf_url, 2200);
    const paperFileName = cleanText(normalizedArgs?.paper_file_name, 240);
    const siPdfUrls = asArray(normalizedArgs?.si_pdf_urls).map((value) => cleanText(value, 2200)).filter(Boolean);
    const siFileNames = asArray(normalizedArgs?.si_file_names).map((value) => cleanText(value, 240)).filter(Boolean);

    if (!storagePath) {
      return buildAgentToolOutputEnvelope(
        name,
        normalizedArgs,
        {
          items: [],
          citations: [],
          summary: 'Cannot download PDFs because Settings storage path is missing.'
        },
        {
          ok: false,
          error: 'Missing storage path. Set Settings > Storage Folder Path or pass storage_path.'
        }
      );
    }

    if (!paperPdfUrl) {
      return buildAgentToolOutputEnvelope(
        name,
        normalizedArgs,
        {
          items: [],
          citations: [],
          summary: 'Missing paper PDF URL.'
        },
        {
          ok: false,
          error: 'Missing required argument paper_pdf_url.'
        }
      );
    }

    try {
      const downloaded = await downloadPaperAndSiPdf({
        storagePath,
        linkedType,
        linkedName,
        paperPdfUrl,
        paperFileName,
        siPdfSources: siPdfUrls,
        siFileNames
      });

      const items = [
        {
          kind: 'paper',
          source_url: downloaded.paper.sourceUrl,
          file_name: cleanText(downloaded.paper.fileName, 240),
          relative_path: cleanText(downloaded.paper.relativePath, 600),
          size_bytes: Number(downloaded.paper.sizeBytes) || 0
        },
        ...asArray(downloaded.siPdfs).map((item) => ({
          kind: 'si',
          source_url: item.sourceUrl,
          file_name: cleanText(item.fileName, 240),
          relative_path: cleanText(item.relativePath, 600),
          size_bytes: Number(item.sizeBytes) || 0
        }))
      ];
      const citations = items.map((item) => ({
        source: 'paper_download',
        pointer: cleanText(item.relative_path || item.file_name, 240),
        reason: item.kind === 'si' ? 'Downloaded SI PDF file.' : 'Downloaded main paper PDF file.'
      }));

      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items,
        citations,
        summary: `Downloaded 1 paper PDF and ${Math.max(0, items.length - 1)} SI PDF(s) into ${cleanText(downloaded.folders?.papers, 320)}.`
      });
    } catch (error) {
      return buildAgentToolOutputEnvelope(
        name,
        normalizedArgs,
        {
          items: [],
          citations: [],
          summary: 'Paper/SI download failed.'
        },
        {
          ok: false,
          error: String(error?.message || error || 'Paper/SI download failed.')
        }
      );
    }
  }

  return buildAgentToolOutputEnvelope(
    name,
    normalizedArgs,
    {
      items: [],
      citations: [],
      summary: `Unknown tool: ${name}`
    },
    {
      ok: false,
      error: `Unknown tool: ${name}`
    }
  );
}

function extractConversation(rawConversation) {
  return asArray(rawConversation)
    .slice(-10)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      text: cleanText(item?.text, 2500)
    }))
    .filter((item) => item.text);
}

function buildAgentLogRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function summarizeLlmForAgentLog(llm) {
  const source = llm && typeof llm === 'object' ? llm : {};
  return {
    provider: cleanText(source.provider, 80),
    apiEndpoint: cleanText(source.apiEndpoint || source.api, 300),
    model: cleanText(source.model, 120),
    apiKeyProvided: Boolean(cleanText(source.apiKey, 12))
  };
}

function normalizeDecisionRecordForAgentLog(record) {
  const source = record && typeof record === 'object' ? record : {};
  return {
    assumptions: asArray(source.assumptions).map((item) => cleanText(item, 240)).filter(Boolean),
    open_questions: asArray(source.open_questions).map((item) => cleanText(item, 240)).filter(Boolean),
    verification_notes: asArray(source.verification_notes).map((item) => cleanText(item, 240)).filter(Boolean)
  };
}

function normalizeIntermediateStatesForAgentLog(states) {
  return asArray(states).map((state) => ({
    state_id: cleanText(state?.state_id, 80),
    created_at: cleanText(state?.created_at, 80),
    stage: cleanText(state?.stage, 40),
    goal: cleanText(state?.goal, 800),
    assumptions: asArray(state?.assumptions).map((item) => cleanText(item, 240)).filter(Boolean),
    open_questions: asArray(state?.open_questions).map((item) => cleanText(item, 240)).filter(Boolean),
    evidence: asArray(state?.evidence).map((item) => ({
      source: cleanText(item?.source, 120),
      pointer: cleanText(item?.pointer, 180),
      reason: cleanText(item?.reason, 220)
    })),
    proposed_actions: asArray(state?.proposed_actions).map((item) => ({
      action_type: cleanText(item?.action_type, 40),
      tool_name: cleanText(item?.tool_name, 120),
      risk_level: cleanText(item?.risk_level, 20),
      reason: cleanText(item?.reason, 260)
    })),
    confidence: Number.isFinite(Number(state?.confidence))
      ? clamp(Number(state.confidence), 0, 1)
      : null
  }));
}

function normalizeToolTraceForAgentLog(trace) {
  return asArray(trace).map((item) => ({
    tool: cleanText(item?.tool, 120),
    args: item?.args && typeof item.args === 'object' ? item.args : {},
    summary: cleanText(item?.summary, 260)
  }));
}

function normalizeRoutingForAgentLog(routing) {
  const normalized = normalizeRoutingPayload(routing);
  return {
    intent: normalized.intent,
    confidence: normalized.confidence,
    entities: normalized.entities,
    plan: normalized.plan,
    classifier: {
      source: normalized.classifier.source,
      fallbackAttempted: normalized.classifier.fallbackAttempted,
      fallbackUsed: normalized.classifier.fallbackUsed,
      lowConfidence: normalized.classifier.lowConfidence,
      tieDetected: normalized.classifier.tieDetected,
      ruleReason: normalized.classifier.ruleReason,
      fallbackError: normalized.classifier.fallbackError
    }
  };
}

function summarizeAgentResultForLog(result) {
  const source = result && typeof result === 'object' ? result : {};
  return {
    ok: source.ok === true,
    provider: cleanText(source.provider, 80),
    model: cleanText(source.model, 120),
    answer: cleanText(source.answer, 12000),
    confidence: Number.isFinite(Number(source.confidence))
      ? clamp(Number(source.confidence), 0, 1)
      : null,
    requiresApproval: source.requiresApproval === true,
    proposedWriteActions: asArray(source.proposedWriteActions).map((item) => ({
      tool_name: cleanText(item?.tool_name, 120),
      reason: cleanText(item?.reason, 280)
    })),
    citations: asArray(source.citations).map((item) => ({
      source: cleanText(item?.source, 120),
      pointer: cleanText(item?.pointer, 180),
      reason: cleanText(item?.reason, 220)
    })),
    decisionRecord: normalizeDecisionRecordForAgentLog(source.decisionRecord),
    routing: normalizeRoutingForAgentLog(source.routing),
    intermediateStates: normalizeIntermediateStatesForAgentLog(source.intermediateStates),
    toolTrace: normalizeToolTraceForAgentLog(source.toolTrace),
    error: cleanText(source.error, 2000)
  };
}

function formatAgentChatLogEntry(entry) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry
  });
}

function resolveAgentApiKey(llm) {
  const fromSettings = cleanText(llm?.apiKey, 300);
  if (fromSettings) {
    return fromSettings;
  }

  const explicit = cleanText(process.env.ENANA_LLM_API_KEY, 300);
  if (explicit) {
    return explicit;
  }

  const generic = cleanText(process.env.LLM_API_KEY, 300);
  if (generic) {
    return generic;
  }
  return '';
}

function inferProviderFromEndpoint(endpoint) {
  const value = cleanText(endpoint, 300).toLowerCase();
  if (!value) {
    return '';
  }
  if (value.startsWith('codex://') || value.includes('codex cli') || value.includes('openai-cli')) {
    return LLM_PROVIDERS.CODEX;
  }
  if (value.includes('anthropic.com')) {
    return LLM_PROVIDERS.CLAUDE;
  }
  if (value.includes('generativelanguage.googleapis.com') || value.includes('ai.google')) {
    return LLM_PROVIDERS.GEMINI;
  }
  if (value.includes('openai.com') || value.includes('/openai/')) {
    return LLM_PROVIDERS.OPENAI;
  }
  return '';
}

function normalizeLlmProvider(provider, endpoint = '') {
  const clean = cleanText(provider, 80).toLowerCase();
  if (Object.values(LLM_PROVIDERS).includes(clean)) {
    return clean;
  }
  return inferProviderFromEndpoint(endpoint) || DEFAULT_LLM_PROVIDER;
}

function defaultEndpointForProvider(provider) {
  const resolved = normalizeLlmProvider(provider);
  return DEFAULT_LLM_ENDPOINTS[resolved] || DEFAULT_LLM_ENDPOINTS[DEFAULT_LLM_PROVIDER];
}

function resolveAgentProvider(llm) {
  return normalizeLlmProvider(llm?.provider, llm?.apiEndpoint || llm?.api);
}

function resolveAgentEndpoint(llm, provider = DEFAULT_LLM_PROVIDER) {
  const endpoint = cleanText(llm?.apiEndpoint, 300);
  if (provider === LLM_PROVIDERS.CODEX && endpoint) {
    return endpoint;
  }
  if (endpoint && /^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  return defaultEndpointForProvider(provider);
}

function resolveAgentModel(llm, provider = DEFAULT_LLM_PROVIDER) {
  const model = cleanText(llm?.model, 120);
  if (model) {
    return model;
  }
  if (Object.prototype.hasOwnProperty.call(DEFAULT_AGENT_MODELS, provider)) {
    return DEFAULT_AGENT_MODELS[provider];
  }
  return DEFAULT_AGENT_MODELS[DEFAULT_LLM_PROVIDER];
}

function buildAgentSystemPrompt(projectName, prompts) {
  const projectScope = projectName ? `Scoped project: ${projectName}.` : 'Scope: all projects.';
  const template = String(prompts?.agent?.systemPromptTemplate || '').trim() || DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE;
  const basePrompt = renderPromptTemplate(template, { projectScope });
  if (!AGENT_TOOL_CONTRACT_PROMPT) {
    return basePrompt;
  }
  return [
    basePrompt,
    AGENT_TOOL_CONTRACT_PROMPT,
    `Tool output envelope: ${AGENT_TOOL_OUTPUT_SCHEMA_NAME}@${AGENT_TOOL_OUTPUT_SCHEMA_VERSION}.`,
    'Always send tool arguments as JSON and read tool results from result/items/citations/summary.'
  ].join('\n\n');
}

function buildAgentSynthesisPrompt(requiresApproval, prompts) {
  const template = String(prompts?.agent?.synthesisPromptTemplate || '').trim() || DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE;
  return renderPromptTemplate(template, { writeIntent: requiresApproval ? 'yes' : 'no' });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestJsonWithBackoff({
  endpoint,
  headers,
  body,
  retryStatuses = [429, 503],
  maxRetries = 3
}) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }
      const waitMs = 350 * (2 ** attempt) + Math.floor(Math.random() * 250);
      await sleep(waitMs);
      attempt += 1;
      continue;
    }

    if (!retryStatuses.includes(response.status)) {
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(`LLM API error (${response.status}): ${raw}`);
      }
      return response.json();
    }

    if (attempt >= maxRetries) {
      const raw = await response.text();
      throw new Error(`LLM API rate-limited (${response.status}): ${raw}`);
    }

    const retryAfterHeader = Number(response.headers.get('retry-after'));
    const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : 500 * (2 ** attempt) + Math.floor(Math.random() * 300);
    await sleep(retryAfterMs);
    attempt += 1;
  }

  throw new Error('LLM API request failed after retries.');
}

async function requestOpenAiResponsesWithBackoff({ endpoint, apiKey, body }) {
  return requestJsonWithBackoff({
    endpoint,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body,
    retryStatuses: [429, 503]
  });
}

async function requestClaudeMessagesWithBackoff({ endpoint, apiKey, body }) {
  return requestJsonWithBackoff({
    endpoint,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body,
    retryStatuses: [429, 503, 529]
  });
}

function buildGeminiGenerateContentUrl(endpoint, model, apiKey) {
  const cleanEndpoint = cleanText(endpoint, 300) || DEFAULT_LLM_ENDPOINTS[LLM_PROVIDERS.GEMINI];
  let url = cleanEndpoint.replace(/\/+$/, '');
  if (!url.includes(':generateContent')) {
    if (/\/models\/[^/?#]+$/i.test(url)) {
      url = `${url}:generateContent`;
    } else if (/\/models$/i.test(url)) {
      url = `${url}/${encodeURIComponent(model)}:generateContent`;
    } else {
      url = `${url}/models/${encodeURIComponent(model)}:generateContent`;
    }
  }
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;
}

async function requestGeminiGenerateContentWithBackoff({ endpoint, apiKey, model, body }) {
  return requestJsonWithBackoff({
    endpoint: buildGeminiGenerateContentUrl(endpoint, model, apiKey),
    headers: {
      'Content-Type': 'application/json'
    },
    body,
    retryStatuses: [429, 503]
  });
}

function resolveAgentToolDefinitions(selectedToolNames = []) {
  const names = asArray(selectedToolNames).map((name) => cleanText(name, 120)).filter(Boolean);
  if (!names.length) {
    return AGENT_TOOL_DEFINITIONS;
  }
  const picked = names
    .map((name) => AGENT_TOOL_DEFINITION_INPUT_MAP.get(name))
    .filter(Boolean);
  return picked.length ? picked : AGENT_TOOL_DEFINITIONS;
}

function toClaudeToolDefinitions(toolDefinitions) {
  return asArray(toolDefinitions).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }));
}

function toGeminiToolDefinitions(toolDefinitions) {
  return [
    {
      functionDeclarations: asArray(toolDefinitions).map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }))
    }
  ];
}

function toClaudeMessage(role, text) {
  return {
    role: role === 'assistant' ? 'assistant' : 'user',
    content: [
      {
        type: 'text',
        text: String(text || '')
      }
    ]
  };
}

function toGeminiContent(role, text) {
  return {
    role: role === 'assistant' ? 'model' : 'user',
    parts: [
      {
        text: String(text || '')
      }
    ]
  };
}

function extractClaudeResponseText(payload) {
  return asArray(payload?.content)
    .filter((item) => item?.type === 'text' && item.text)
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function extractClaudeFunctionCalls(payload) {
  return asArray(payload?.content)
    .filter((item) => item?.type === 'tool_use')
    .map((item, index) => ({
      callId: cleanText(item?.id, 120) || `claude-call-${index + 1}`,
      name: cleanText(item?.name, 120),
      argsText: JSON.stringify(item?.input || {})
    }))
    .filter((item) => item.callId && item.name);
}

function extractGeminiPrimaryCandidate(payload) {
  if (!Array.isArray(payload?.candidates) || payload.candidates.length === 0) {
    return null;
  }
  return payload.candidates[0];
}

function extractGeminiPartFunctionCall(part) {
  if (!part || typeof part !== 'object') {
    return null;
  }
  return part.functionCall && typeof part.functionCall === 'object'
    ? part.functionCall
    : part.function_call && typeof part.function_call === 'object'
      ? part.function_call
      : null;
}

function extractGeminiResponseText(payload) {
  const candidate = extractGeminiPrimaryCandidate(payload);
  if (!candidate?.content?.parts) {
    return '';
  }
  return asArray(candidate.content.parts)
    .filter((part) => typeof part?.text === 'string' && part.text.trim())
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function extractGeminiFunctionCalls(payload, round = 0) {
  const candidate = extractGeminiPrimaryCandidate(payload);
  if (!candidate?.content?.parts) {
    return [];
  }
  const calls = [];
  asArray(candidate.content.parts).forEach((part, index) => {
    const fn = extractGeminiPartFunctionCall(part);
    if (!fn?.name) {
      return;
    }
    const args = fn.args && typeof fn.args === 'object' ? fn.args : {};
    calls.push({
      callId: cleanText(fn.id, 120) || `gemini-call-${round + 1}-${index + 1}`,
      name: cleanText(fn.name, 120),
      argsText: JSON.stringify(args)
    });
  });
  return calls.filter((item) => item.callId && item.name);
}

function normalizeClaudeAssistantContent(payload) {
  return asArray(payload?.content)
    .map((item) => {
      if (item?.type === 'text') {
        return {
          type: 'text',
          text: String(item.text || '')
        };
      }
      if (item?.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: cleanText(item.id, 120),
          name: cleanText(item.name, 120),
          input: item.input && typeof item.input === 'object' ? item.input : {}
        };
      }
      return null;
    })
    .filter(Boolean);
}

function parseToolOutputObject(rawOutput) {
  const clean = String(rawOutput || '').trim();
  if (!clean) {
    return {};
  }
  const parsed = safeParseJson(clean, null);
  if (parsed && typeof parsed === 'object') {
    return parsed;
  }
  return { text: clean };
}

async function startAgentSession({
  provider,
  endpoint,
  apiKey,
  model,
  systemPrompt,
  conversation,
  message,
  hasLatestUserInConversation,
  toolDefinitions = AGENT_TOOL_DEFINITIONS
}) {
  const scopedToolDefinitions = asArray(toolDefinitions);
  const hasTools = scopedToolDefinitions.length > 0;
  if (provider === LLM_PROVIDERS.CLAUDE) {
    const messages = [
      ...conversation.map((item) => toClaudeMessage(item.role, item.text)),
      ...(hasLatestUserInConversation ? [] : [toClaudeMessage('user', message)])
    ];
    const claudeTools = toClaudeToolDefinitions(scopedToolDefinitions);
    const response = await requestClaudeMessagesWithBackoff({
      endpoint,
      apiKey,
      body: {
        model,
        system: systemPrompt,
        messages,
        ...(hasTools ? { tools: claudeTools } : {}),
        max_tokens: 1400
      }
    });
    return {
      provider,
      endpoint,
      apiKey,
      model,
      systemPrompt,
      messages,
      toolDefinitions: scopedToolDefinitions,
      raw: response,
      round: 0
    };
  }

  if (provider === LLM_PROVIDERS.GEMINI) {
    const contents = [
      ...conversation.map((item) => toGeminiContent(item.role, item.text)),
      ...(hasLatestUserInConversation ? [] : [toGeminiContent('user', message)])
    ];
    const geminiTools = toGeminiToolDefinitions(scopedToolDefinitions);
    const response = await requestGeminiGenerateContentWithBackoff({
      endpoint,
      apiKey,
      model,
      body: {
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents,
        ...(hasTools ? { tools: geminiTools } : {}),
        ...(hasTools ? {
          toolConfig: {
            functionCallingConfig: {
              mode: 'AUTO'
            }
          }
        } : {}),
        generationConfig: {
          maxOutputTokens: 1400
        }
      }
    });
    return {
      provider,
      endpoint,
      apiKey,
      model,
      systemPrompt,
      contents,
      toolDefinitions: scopedToolDefinitions,
      raw: response,
      round: 0
    };
  }

  const response = await requestOpenAiResponsesWithBackoff({
    endpoint,
    apiKey,
    body: {
      model,
      input: [
        toInputText('system', systemPrompt),
        ...conversation.map((item) => toInputText(item.role, item.text)),
        ...(hasLatestUserInConversation ? [] : [toInputText('user', message)])
      ],
      ...(hasTools ? {
        tools: scopedToolDefinitions,
        tool_choice: 'auto',
        parallel_tool_calls: false
      } : {}),
      max_output_tokens: 1400
    }
  });
  return {
    provider: LLM_PROVIDERS.OPENAI,
    endpoint,
    apiKey,
    model,
    toolDefinitions: scopedToolDefinitions,
    raw: response,
    round: 0
  };
}

function extractAgentSessionFunctionCalls(session) {
  if (!session) {
    return [];
  }
  if (session.provider === LLM_PROVIDERS.CLAUDE) {
    return extractClaudeFunctionCalls(session.raw);
  }
  if (session.provider === LLM_PROVIDERS.GEMINI) {
    return extractGeminiFunctionCalls(session.raw, session.round || 0);
  }
  return extractFunctionCalls(session.raw);
}

function extractAgentSessionText(session) {
  if (!session) {
    return '';
  }
  if (session.provider === LLM_PROVIDERS.CLAUDE) {
    return extractClaudeResponseText(session.raw);
  }
  if (session.provider === LLM_PROVIDERS.GEMINI) {
    return extractGeminiResponseText(session.raw);
  }
  return extractResponseText(session.raw);
}

async function continueAgentSessionWithToolOutputs(session, toolOutputs) {
  if (!session) {
    return session;
  }

  const scopedToolDefinitions = asArray(session.toolDefinitions);
  const hasTools = scopedToolDefinitions.length > 0;

  if (session.provider === LLM_PROVIDERS.CLAUDE) {
    const byId = new Map(toolOutputs.map((item) => [item.callId, item]));
    const assistantContent = normalizeClaudeAssistantContent(session.raw);
    const toolResultBlocks = asArray(session.raw?.content)
      .filter((item) => item?.type === 'tool_use')
      .map((item, index) => {
        const callId = cleanText(item?.id, 120) || `claude-call-${index + 1}`;
        const matched = byId.get(callId) || toolOutputs.find((output) => output.name === item?.name);
        return {
          type: 'tool_result',
          tool_use_id: callId,
          content: matched?.output || '{}'
        };
      });

    const nextMessages = [
      ...session.messages,
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: toolResultBlocks }
    ];

    const claudeTools = toClaudeToolDefinitions(scopedToolDefinitions);
    const response = await requestClaudeMessagesWithBackoff({
      endpoint: session.endpoint,
      apiKey: session.apiKey,
      body: {
        model: session.model,
        system: session.systemPrompt,
        messages: nextMessages,
        ...(hasTools ? { tools: claudeTools } : {}),
        max_tokens: 1400
      }
    });

    return {
      ...session,
      messages: nextMessages,
      raw: response,
      round: Number(session.round || 0) + 1
    };
  }

  if (session.provider === LLM_PROVIDERS.GEMINI) {
    const callOutputs = new Map(toolOutputs.map((item) => [item.callId, item]));
    const candidate = extractGeminiPrimaryCandidate(session.raw);
    const modelContent = candidate?.content && typeof candidate.content === 'object'
      ? candidate.content
      : null;
    const toolCalls = extractGeminiFunctionCalls(session.raw, session.round || 0);
    const responseParts = toolCalls.map((call) => {
      const matched = callOutputs.get(call.callId) || toolOutputs.find((item) => item.name === call.name);
      return {
        functionResponse: {
          name: call.name,
          response: parseToolOutputObject(matched?.output)
        }
      };
    });

    const nextContents = [...session.contents];
    if (modelContent) {
      nextContents.push(modelContent);
    }
    if (responseParts.length) {
      nextContents.push({
        role: 'user',
        parts: responseParts
      });
    }

    const geminiTools = toGeminiToolDefinitions(scopedToolDefinitions);
    const response = await requestGeminiGenerateContentWithBackoff({
      endpoint: session.endpoint,
      apiKey: session.apiKey,
      model: session.model,
      body: {
        systemInstruction: {
          parts: [{ text: session.systemPrompt }]
        },
        contents: nextContents,
        ...(hasTools ? { tools: geminiTools } : {}),
        ...(hasTools ? {
          toolConfig: {
            functionCallingConfig: {
              mode: 'AUTO'
            }
          }
        } : {}),
        generationConfig: {
          maxOutputTokens: 1400
        }
      }
    });

    return {
      ...session,
      contents: nextContents,
      raw: response,
      round: Number(session.round || 0) + 1
    };
  }

  const response = await requestOpenAiResponsesWithBackoff({
    endpoint: session.endpoint,
    apiKey: session.apiKey,
    body: {
      model: session.model,
      previous_response_id: session.raw?.id,
      input: toolOutputs.map((output) => ({
        type: 'function_call_output',
        call_id: output.callId,
        output: output.output
      })),
      ...(hasTools ? {
        tools: scopedToolDefinitions,
        tool_choice: 'auto',
        parallel_tool_calls: false
      } : {}),
      max_output_tokens: 1400
    }
  });

  return {
    ...session,
    raw: response,
    round: Number(session.round || 0) + 1
  };
}

async function requestSynthesisPayload({
  provider,
  endpoint,
  apiKey,
  model,
  synthesisRequest,
  message,
  draftAnswer,
  toolTrace,
  evidence
}) {
  const userPrompt = [
    `User request: ${message}`,
    `Draft answer: ${draftAnswer || '-'}`,
    `Tool trace: ${JSON.stringify(toolTrace.slice(0, 20))}`,
    `Evidence: ${JSON.stringify(evidence.slice(0, 20))}`
  ].join('\n\n');

  if (provider === LLM_PROVIDERS.CLAUDE) {
    const response = await requestClaudeMessagesWithBackoff({
      endpoint,
      apiKey,
      body: {
        model,
        system: synthesisRequest,
        max_tokens: 1600,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: userPrompt
              }
            ]
          }
        ]
      }
    });
    return extractClaudeResponseText(response);
  }

  if (provider === LLM_PROVIDERS.GEMINI) {
    const response = await requestGeminiGenerateContentWithBackoff({
      endpoint,
      apiKey,
      model,
      body: {
        systemInstruction: {
          parts: [{ text: synthesisRequest }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 1600
        }
      }
    });
    return extractGeminiResponseText(response);
  }

  const response = await requestOpenAiResponsesWithBackoff({
    endpoint,
    apiKey,
    body: {
      model,
      input: [
        toInputText('system', synthesisRequest),
        toInputText('user', userPrompt)
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'agent_result',
          strict: true,
          schema: AGENT_RESULT_SCHEMA
        }
      },
      max_output_tokens: 1600
    }
  });
  return extractResponseText(response);
}

function buildRoutingFallbackPrompt({ message, conversation, projectName, ruleRouting }) {
  const ruleIntent = cleanText(ruleRouting?.intent, 80) || 'general_science_question';
  const ruleConfidence = Number.isFinite(Number(ruleRouting?.confidence))
    ? Number(ruleRouting.confidence).toFixed(2)
    : '0.50';
  return [
    'You are an intent router for a lab assistant.',
    'Classify only into this fixed intent list:',
    ROUTING_INTENTS.join(', '),
    `Rule fallback threshold: ${ROUTING_RULE_CONFIDENCE_THRESHOLD}.`,
    `Project scope: ${projectName ? cleanText(projectName, 180) : 'all projects'}.`,
    `MVP scope features: ${asArray(AGENT_MVP_SCOPE?.phase0?.mvpFeatures).join('; ')}.`,
    'Return strict JSON only with keys: intent, confidence, entities, needs_clarification, clarification_question, reason.',
    'Do not include markdown or extra keys.',
    `Rule-based candidate: intent=${ruleIntent}, confidence=${ruleConfidence}, entities=${JSON.stringify(ruleRouting?.entities || {})}`,
    `Conversation transcript:\n${toPromptConversationTranscript(conversation)}`,
    `Latest user request: ${message}`
  ].join('\n\n');
}

async function requestRoutingFallbackPayload({
  provider,
  endpoint,
  apiKey,
  model,
  message,
  conversation,
  projectName,
  ruleRouting
}) {
  const prompt = buildRoutingFallbackPrompt({
    message,
    conversation,
    projectName,
    ruleRouting
  });

  try {
    if (provider === LLM_PROVIDERS.CODEX) {
      const raw = await requestCodexCliText({
        prompt,
        model,
        cwd: getCodexCliWorkingDirectory()
      });
      return parseRoutingFallbackPayload(raw);
    }

    if (provider === LLM_PROVIDERS.CLAUDE) {
      const response = await requestClaudeMessagesWithBackoff({
        endpoint,
        apiKey,
        body: {
          model,
          system: 'Return valid JSON only.',
          max_tokens: 700,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                }
              ]
            }
          ]
        }
      });
      return parseRoutingFallbackPayload(extractClaudeResponseText(response));
    }

    if (provider === LLM_PROVIDERS.GEMINI) {
      const response = await requestGeminiGenerateContentWithBackoff({
        endpoint,
        apiKey,
        model,
        body: {
          systemInstruction: {
            parts: [{ text: 'Return valid JSON only.' }]
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            maxOutputTokens: 700
          }
        }
      });
      return parseRoutingFallbackPayload(extractGeminiResponseText(response));
    }

    const response = await requestOpenAiResponsesWithBackoff({
      endpoint,
      apiKey,
      body: {
        model,
        input: [
          toInputText('system', 'Return valid JSON only.'),
          toInputText('user', prompt)
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'routing_fallback',
            strict: true,
            schema: ROUTING_FALLBACK_SCHEMA
          }
        },
        max_output_tokens: 700
      }
    });
    return parseRoutingFallbackPayload(extractResponseText(response));
  } catch {
    return null;
  }
}

function normalizeAgentOutput(raw, fallbackText) {
  const parsed = safeParseJson(raw, null);
  if (parsed && typeof parsed === 'object') {
    return {
      answer: cleanText(parsed.answer, 12000) || fallbackText || 'No answer generated.',
      confidence: Number.isFinite(parsed.confidence) ? clamp(Number(parsed.confidence), 0, 1) : 0.55,
      requiresApproval: parsed.requires_approval === true,
      proposedWriteActions: asArray(parsed.proposed_write_actions),
      citations: asArray(parsed.citations),
      decisionRecord: parsed.decision_record && typeof parsed.decision_record === 'object'
        ? parsed.decision_record
        : { assumptions: [], open_questions: [], verification_notes: [] }
    };
  }

  return {
    answer: fallbackText || 'No answer generated.',
    confidence: 0.55,
    requiresApproval: false,
    proposedWriteActions: [],
    citations: [],
    decisionRecord: {
      assumptions: [],
      open_questions: [],
      verification_notes: ['Structured synthesis was unavailable; returned plain-text fallback.']
    }
  };
}

function toPromptConversationTranscript(conversation) {
  const rows = asArray(conversation).map((item, index) => {
    const role = item?.role === 'assistant' ? 'assistant' : 'user';
    return `${index + 1}. ${role}: ${cleanText(item?.text, 2400)}`;
  }).filter(Boolean);
  return rows.length ? rows.join('\n') : 'No prior messages.';
}

async function buildCodexAgentContext(message, snapshot, selectedToolNames = null) {
  const allowedRetrievalTools = [
    'search_projects',
    'search_protocols',
    'search_notebook_entries',
    'search_assays',
    'search_gel_analyses',
    'search_inventory',
    'search_papers'
  ];
  const retrievalTools = Array.isArray(selectedToolNames)
    ? asArray(selectedToolNames)
      .map((name) => cleanText(name, 120))
      .filter((name) => allowedRetrievalTools.includes(name))
    : allowedRetrievalTools;
  const contextSlices = [];
  const toolTrace = [];
  const evidence = [];

  for (const toolName of retrievalTools) {
    const result = await runAgentTool(toolName, { query: message, limit: 5 }, snapshot);
    const items = asArray(result?.items).slice(0, 5);
    if (!items.length) {
      continue;
    }
    contextSlices.push({
      tool: toolName,
      items
    });
    toolTrace.push({
      tool: toolName,
      args: result?.input && typeof result.input === 'object' ? result.input : { query: message, limit: 5 },
      summary: cleanText(result?.summary || `Collected ${items.length} records.`, 240)
    });
    asArray(result?.citations).slice(0, 8).forEach((citation) => {
      evidence.push({
        source: cleanText(citation?.source, 120),
        pointer: cleanText(citation?.pointer, 180),
        reason: cleanText(citation?.reason, 220)
      });
    });
  }

  return {
    contextSlices,
    toolTrace,
    evidence
  };
}

async function runCodexAgentController({
  provider,
  model,
  message,
  conversation,
  hasLatestUserInConversation,
  snapshot,
  projectName,
  promptConfig,
  allowWriteTools,
  routing
}) {
  const intermediateStates = [];
  const toolTrace = [];
  const evidence = [];
  const requiresApproval = containsWriteIntent(message) && !allowWriteTools;
  const routingInfo = normalizeRoutingPayload(routing);

  intermediateStates.push(buildIntermediateState('intake', message, {
    assumptions: [
      'Codex CLI provider selected; retrieval context is assembled before generation.',
      ...buildRoutingAssumptionRows(routingInfo)
    ],
    openQuestions: [
      ...(requiresApproval ? ['User may want a write action; approval is required before any write.'] : []),
      ...(routingInfo.plan.needs_clarification ? [routingInfo.plan.clarification_reason || 'Routing requires clarification.'] : [])
    ],
    confidence: 0.44
  }));

  intermediateStates.push(buildIntermediateState('context', 'Loaded snapshot context for Codex retrieval.', {
    assumptions: [
      `Context sizes: projects=${snapshot.projects.length}, protocols=${snapshot.protocols.length}, notebook_entries=${snapshot.notebookEntries.length}, assays=${snapshot.assays.length}, gel_analyses=${snapshot.gelAnalyses.length}, papers=${snapshot.papers.length}.`
    ],
    confidence: 0.52
  }));

  intermediateStates.push(buildIntermediateState('route', `Resolved routing intent "${routingInfo.intent}".`, {
    assumptions: buildRoutingAssumptionRows(routingInfo),
    openQuestions: routingInfo.plan.needs_clarification ? [routingInfo.plan.clarification_question] : [],
    confidence: routingInfo.confidence
  }));

  const collected = await buildCodexAgentContext(message, snapshot, routingInfo.plan.selected_tool_names);
  toolTrace.push(...collected.toolTrace);
  evidence.push(...collected.evidence);

  intermediateStates.push(buildIntermediateState('execute', `Prepared ${collected.contextSlices.length} retrieval context slices for Codex CLI.`, {
    evidence: evidence.slice(0, 12),
    proposedActions: collected.contextSlices.map((slice) => ({
      action_type: 'read',
      tool_name: slice.tool,
      risk_level: 'low',
      reason: 'Context was retrieved locally before Codex generation.'
    })),
    confidence: collected.contextSlices.length ? 0.63 : 0.54
  }));

  const promptConversation = hasLatestUserInConversation
    ? conversation
    : [...conversation, { role: 'user', text: message }];
  const systemPrompt = buildAgentSystemPrompt(projectName, promptConfig);
  const draftPrompt = [
    systemPrompt,
    'Task: answer the latest user request using only the retrieved Enana context below. If context is missing, explicitly say what is missing.',
    `Conversation transcript:\n${toPromptConversationTranscript(promptConversation)}`,
    `Routing decision JSON:\n${cleanText(JSON.stringify(routingInfo, null, 2), 10000)}`,
    `Retrieved context JSON:\n${cleanText(JSON.stringify(collected.contextSlices, null, 2), 70000)}`,
    'Respond as concise assistant text.'
  ].join('\n\n');

  const draftAnswer = await requestCodexCliText({
    prompt: draftPrompt,
    model,
    cwd: getCodexCliWorkingDirectory()
  });

  intermediateStates.push(buildIntermediateState('verify', 'Verified evidence coverage and policy constraints.', {
    assumptions: ['Only read-context assembly was executed before Codex response synthesis.'],
    openQuestions: evidence.length ? [] : ['No direct matches were found in local retrieval context.'],
    evidence: evidence.slice(-12),
    confidence: evidence.length ? 0.69 : 0.56
  }));

  const synthesisRequest = buildAgentSynthesisPrompt(requiresApproval, promptConfig);
  let normalized;
  try {
    const structuredRaw = await requestCodexCliText({
      prompt: [
        synthesisRequest,
        'Return valid JSON and include citations only from provided evidence.',
        `User request: ${message}`,
        `Draft answer: ${draftAnswer || '-'}`,
        `Tool trace: ${JSON.stringify(toolTrace.slice(0, 20))}`,
        `Evidence: ${JSON.stringify(evidence.slice(0, 20))}`
      ].join('\n\n'),
      model,
      cwd: getCodexCliWorkingDirectory()
    });
    normalized = normalizeAgentOutput(structuredRaw, draftAnswer);
  } catch {
    normalized = {
      answer: draftAnswer || 'No answer generated.',
      confidence: evidence.length ? 0.64 : 0.5,
      requiresApproval,
      proposedWriteActions: [],
      citations: evidence.slice(0, 12),
      decisionRecord: {
        assumptions: ['Structured synthesis was not available for Codex CLI output.'],
        open_questions: evidence.length ? [] : ['Evidence retrieval returned no direct matches.'],
        verification_notes: ['Returned fallback draft answer with retrieved context snapshot.']
      }
    };
  }

  if (requiresApproval && normalized.proposedWriteActions.length === 0) {
    normalized.proposedWriteActions = [
      {
        tool_name: 'write_operation_pending_approval',
        reason: 'User intent appears write-oriented; explicit approval is required before execution.'
      }
    ];
  }
  if (requiresApproval) {
    normalized.requiresApproval = true;
  }

  intermediateStates.push(buildIntermediateState('synthesize', 'Generated final user-facing response with decision record.', {
    evidence: normalized.citations,
    proposedActions: normalized.proposedWriteActions.map((action) => ({
      action_type: 'write',
      tool_name: action?.tool_name,
      risk_level: 'high',
      reason: action?.reason
    })),
    confidence: normalized.confidence
  }));

  intermediateStates.push(buildIntermediateState('handoff', 'Prepared response for UI handoff and audit trail.', {
    assumptions: [
      allowWriteTools
        ? 'Write approval flag was enabled for this request.'
        : 'Any write action remains pending explicit approval.'
    ],
    confidence: normalized.confidence
  }));

  return {
    ok: true,
    provider,
    model: model || 'codex-default',
    answer: normalized.answer,
    confidence: normalized.confidence,
    requiresApproval: normalized.requiresApproval,
    proposedWriteActions: normalized.proposedWriteActions,
    citations: normalized.citations,
    decisionRecord: normalized.decisionRecord,
    routing: routingInfo,
    intermediateStates,
    toolTrace
  };
}

async function runAgentController(payload) {
  const message = cleanText(payload?.message, 3000);
  if (!message) {
    throw new Error('Message is required.');
  }

  const provider = resolveAgentProvider(payload?.llm);
  const endpoint = resolveAgentEndpoint(payload?.llm, provider);
  const model = resolveAgentModel(payload?.llm, provider);
  const apiKey = provider === LLM_PROVIDERS.CODEX ? '' : resolveAgentApiKey(payload?.llm);
  if (provider !== LLM_PROVIDERS.CODEX && !apiKey) {
    throw new Error('Missing LLM API key. Set it in Settings > LLM Model & API, or use LLM_API_KEY / ENANA_LLM_API_KEY.');
  }
  const conversation = extractConversation(payload?.conversation);
  const hasLatestUserInConversation = conversation.length > 0
    && conversation[conversation.length - 1].role === 'user'
    && conversation[conversation.length - 1].text === message;
  const snapshot = normalizeAgentSnapshot(payload?.stateSnapshot);
  const allowWriteTools = payload?.allowWriteTools === true;
  const projectName = cleanText(payload?.projectName, 180);
  const promptConfig = await loadLlmPrompts();
  const requiresApproval = containsWriteIntent(message) && !allowWriteTools;
  const availableToolNames = AGENT_IO_CONTRACT.tools.map((tool) => cleanText(tool?.name, 120)).filter(Boolean);
  const promptConversation = hasLatestUserInConversation
    ? conversation
    : [...conversation, { role: 'user', text: message }];

  const ruleRouting = buildRuleBasedRoutingDecision({
    message,
    snapshot,
    availableToolNames,
    writeIntent: containsWriteIntent(message)
  });

  let routing = normalizeRoutingPayload(ruleRouting);
  if (shouldUseRoutingFallback(ruleRouting)) {
    const fallbackPayload = await requestRoutingFallbackPayload({
      provider,
      endpoint,
      apiKey,
      model,
      message,
      conversation: promptConversation,
      projectName,
      ruleRouting
    });
    const mergedRouting = mergeRoutingFallback({
      ruleDecision: ruleRouting,
      fallbackPayload,
      message,
      writeIntent: containsWriteIntent(message),
      availableToolNames
    });
    routing = normalizeRoutingPayload(mergedRouting);
  }

  if (routing.plan.needs_clarification) {
    const clarification = buildRoutingClarificationQuestion(routing);
    const proposedWriteActions = requiresApproval
      ? [
        {
          tool_name: 'write_operation_pending_approval',
          reason: 'User intent appears write-oriented; explicit approval is required before execution.'
        }
      ]
      : [];
    return {
      ok: true,
      provider,
      model: model || (provider === LLM_PROVIDERS.CODEX ? 'codex-default' : ''),
      answer: clarification,
      confidence: clamp(routing.confidence * 0.92, 0, 1),
      requiresApproval: requiresApproval || proposedWriteActions.length > 0,
      proposedWriteActions,
      citations: [],
      decisionRecord: {
        assumptions: [
          'Routing plan identified ambiguity and stopped execution before tool calls.',
          `Intent=${routing.intent} source=${routing.classifier.source}`
        ],
        open_questions: [clarification],
        verification_notes: ['No tools were executed because clarification is required first.']
      },
      routing,
      intermediateStates: [
        buildIntermediateState('intake', message, {
          assumptions: [
            ...buildRoutingAssumptionRows(routing),
            requiresApproval
              ? 'Write intent detected; approval remains required before execution.'
              : 'Read-first execution mode is active.'
          ],
          openQuestions: [clarification],
          confidence: routing.confidence
        }),
        buildIntermediateState('route', `Resolved routing intent "${routing.intent}" and requested clarification.`, {
          assumptions: buildRoutingAssumptionRows(routing),
          openQuestions: [clarification],
          confidence: routing.confidence
        }),
        buildIntermediateState('handoff', 'Prepared clarification response for UI handoff and audit trail.', {
          assumptions: ['No tool calls executed due to clarification gate.'],
          confidence: routing.confidence
        })
      ],
      toolTrace: []
    };
  }

  if (provider === LLM_PROVIDERS.CODEX) {
    return runCodexAgentController({
      provider,
      model,
      message,
      conversation,
      hasLatestUserInConversation,
      snapshot,
      projectName,
      promptConfig,
      allowWriteTools,
      routing
    });
  }

  const intermediateStates = [];
  const toolTrace = [];
  const evidence = [];

  intermediateStates.push(buildIntermediateState('intake', message, {
    assumptions: [
      allowWriteTools
        ? 'Explicit approval flag enabled write tools for this request.'
        : 'User question is interpreted as read-first unless writes are explicitly requested.',
      ...buildRoutingAssumptionRows(routing)
    ],
    openQuestions: requiresApproval
      ? ['User may want a write action; approval is required before any write.']
      : [],
    confidence: 0.45
  }));

  intermediateStates.push(buildIntermediateState('context', 'Loaded snapshot context for retrieval tools.', {
    assumptions: [
      `Context sizes: projects=${snapshot.projects.length}, protocols=${snapshot.protocols.length}, notebook_entries=${snapshot.notebookEntries.length}, assays=${snapshot.assays.length}, gel_analyses=${snapshot.gelAnalyses.length}, papers=${snapshot.papers.length}.`
    ],
    confidence: 0.52
  }));

  intermediateStates.push(buildIntermediateState('route', `Resolved routing intent "${routing.intent}".`, {
    assumptions: buildRoutingAssumptionRows(routing),
    confidence: routing.confidence
  }));

  const systemPrompt = buildAgentSystemPrompt(projectName, promptConfig);
  const scopedToolDefinitions = routing.plan.needs_tools
    ? resolveAgentToolDefinitions(routing.plan.selected_tool_names)
    : [];

  let session = await startAgentSession({
    provider,
    endpoint,
    apiKey,
    model,
    systemPrompt,
    conversation,
    message,
    hasLatestUserInConversation,
    toolDefinitions: scopedToolDefinitions
  });
  let round = 0;

  while (round < MAX_AGENT_TOOL_ROUNDS) {
    const calls = extractAgentSessionFunctionCalls(session);
    if (!calls.length) {
      break;
    }

    const toolOutputs = [];
    const proposedActions = [];
    for (const call of calls.slice(0, 4)) {
      const args = normalizeToolInvocationArgs(call.argsText);
      const toolResult = await runAgentTool(call.name, args, snapshot, { allowWriteTools });
      const normalizedInput = toolResult?.input && typeof toolResult.input === 'object' ? toolResult.input : args;
      toolOutputs.push({
        callId: call.callId,
        name: call.name,
        output: JSON.stringify(toolResult)
      });
      toolTrace.push({
        tool: call.name,
        args: normalizedInput,
        summary: cleanText(toolResult.summary, 240)
      });
      asArray(toolResult.citations).forEach((citation) => {
        evidence.push({
          source: cleanText(citation?.source, 120),
          pointer: cleanText(citation?.pointer, 180),
          reason: cleanText(citation?.reason, 220)
        });
      });
      proposedActions.push({
        action_type: isWriteTool(call.name) ? 'write' : (isComputeTool(call.name) ? 'compute' : 'read'),
        tool_name: call.name,
        risk_level: isWriteTool(call.name) ? 'high' : (isComputeTool(call.name) ? 'medium' : 'low'),
        reason: isWriteTool(call.name)
          ? (allowWriteTools
            ? 'Model-requested write operation executed with explicit approval.'
            : 'Model-requested write operation blocked pending explicit approval.')
          : (isComputeTool(call.name)
            ? 'Model-requested sandboxed computation.'
            : 'Model-requested read operation.')
      });
    }

    intermediateStates.push(buildIntermediateState('execute', `Executed ${toolOutputs.length} tool calls in round ${round + 1}.`, {
      evidence: evidence.slice(-10),
      proposedActions,
      confidence: 0.62
    }));

    session = await continueAgentSessionWithToolOutputs(session, toolOutputs);

    round += 1;
  }

  const draftAnswer = extractAgentSessionText(session);

  intermediateStates.push(buildIntermediateState('verify', 'Verified evidence coverage and policy constraints.', {
    assumptions: [
      allowWriteTools
        ? 'Write tools were allowed for this request via explicit approval.'
        : 'Write tools were blocked by policy; only read or compute tools were executed.'
    ],
    openQuestions: evidence.length ? [] : ['No evidence citations were produced by tools.'],
    evidence: evidence.slice(-12),
    confidence: evidence.length ? 0.72 : 0.58
  }));

  const synthesisRequest = buildAgentSynthesisPrompt(requiresApproval, promptConfig);

  let normalized;
  try {
    const structuredRaw = await requestSynthesisPayload({
      provider,
      endpoint,
      apiKey,
      model,
      synthesisRequest,
      message,
      draftAnswer,
      toolTrace,
      evidence
    });
    normalized = normalizeAgentOutput(structuredRaw, draftAnswer);
  } catch {
    normalized = {
      answer: draftAnswer || 'No answer generated.',
      confidence: evidence.length ? 0.66 : 0.52,
      requiresApproval,
      proposedWriteActions: [],
      citations: evidence.slice(0, 12),
      decisionRecord: {
        assumptions: ['Structured synthesis was not available for this model/endpoint.'],
        open_questions: evidence.length ? [] : ['Evidence retrieval returned no direct matches.'],
        verification_notes: ['Returned fallback draft answer with tool evidence snapshot.']
      }
    };
  }

  if (requiresApproval && normalized.proposedWriteActions.length === 0) {
    normalized.proposedWriteActions = [
      {
        tool_name: 'write_operation_pending_approval',
        reason: 'User intent appears write-oriented; explicit approval is required before execution.'
      }
    ];
  }
  if (requiresApproval) {
    normalized.requiresApproval = true;
  }

  intermediateStates.push(buildIntermediateState('synthesize', 'Generated final user-facing response with decision record.', {
    evidence: normalized.citations,
    proposedActions: normalized.proposedWriteActions.map((action) => ({
      action_type: 'write',
      tool_name: action?.tool_name,
      risk_level: 'high',
      reason: action?.reason
    })),
    confidence: normalized.confidence
  }));

  intermediateStates.push(buildIntermediateState('handoff', 'Prepared response for UI handoff and audit trail.', {
    assumptions: [
      allowWriteTools
        ? 'Write tools were allowed for this request via explicit approval.'
        : 'Any write action remains pending explicit approval.'
    ],
    confidence: normalized.confidence
  }));

  return {
    ok: true,
    provider,
    model,
    answer: normalized.answer,
    confidence: normalized.confidence,
    requiresApproval: normalized.requiresApproval,
    proposedWriteActions: normalized.proposedWriteActions,
    citations: normalized.citations,
    decisionRecord: normalized.decisionRecord,
    routing,
    intermediateStates,
    toolTrace
  };
}

ipcMain.handle('agent:chat', async (_event, payload) => {
  const normalizedPayload = normalizeJsonPayload(payload, {});
  const requestId = buildAgentLogRequestId();
  const logPath = getAgentChatLogPath();
  await appendAgentChatLogEntry(logPath, formatAgentChatLogEntry({
    type: 'agent-chat-request',
    requestId,
    projectId: cleanText(normalizedPayload?.projectId, 80),
    projectName: cleanText(normalizedPayload?.projectName, 180),
    allowWriteTools: normalizedPayload?.allowWriteTools === true,
    message: cleanText(normalizedPayload?.message, 3000),
    conversation: extractConversation(normalizedPayload?.conversation),
    llm: summarizeLlmForAgentLog(normalizedPayload?.llm)
  }));

  try {
    const result = await runAgentController(normalizedPayload);
    await appendAgentChatLogEntry(logPath, formatAgentChatLogEntry({
      type: 'agent-chat-result',
      requestId,
      ...summarizeAgentResultForLog(result)
    }));
    return result;
  } catch (error) {
    const errorMessage = String(error?.message || error);
    await appendAgentChatLogEntry(logPath, formatAgentChatLogEntry({
      type: 'agent-chat-error',
      requestId,
      ok: false,
      error: cleanText(errorMessage, 2000)
    }));
    return { ok: false, error: errorMessage };
  }
});

ipcMain.handle('agent:get-io-contract', async () => ({
  ok: true,
  contract: AGENT_IO_CONTRACT
}));

ipcMain.handle('llm:codex-status', async () => {
  const status = await getCodexLoginStatus({ cwd: getCodexCliWorkingDirectory(), forceRefresh: true });
  return {
    ok: status.ok === true,
    loggedIn: status.loggedIn === true,
    message: status.message || ''
  };
});

ipcMain.handle('llm:codex-generate', async (_event, payload) => {
  try {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const promptRaw = typeof normalizedPayload?.prompt === 'string' ? normalizedPayload.prompt.trim() : '';
    if (!promptRaw) {
      return { ok: false, error: 'Prompt is required.' };
    }

    const prompt = promptRaw.length > 120000 ? `${promptRaw.slice(0, 120000)}...` : promptRaw;
    const model = cleanText(normalizedPayload?.model, 120);
    const fileName = cleanText(normalizedPayload?.fileName, 220);
    const pdfDataUrl = typeof normalizedPayload?.pdfDataUrl === 'string' ? normalizedPayload.pdfDataUrl.trim() : '';

    const text = await requestCodexCliText({
      prompt,
      model,
      cwd: getCodexCliWorkingDirectory(),
      fileName,
      pdfDataUrl
    });

    return {
      ok: true,
      text
    };
  } catch (error) {
    return {
      ok: false,
      error: cleanText(error?.message || error, 2400)
    };
  }
});

ipcMain.handle('telegram:get-config', async () => {
  return {
    ok: true,
    enabled: Boolean(telegramBot),
    source: telegramTokenSource,
    hasSavedToken: Boolean(savedTelegramToken)
  };
});

ipcMain.handle('telegram:set-token', async (_event, payload) => {
  const normalizedPayload = normalizeJsonPayload(payload, {});
  const token = typeof normalizedPayload?.token === 'string' ? normalizedPayload.token.trim() : '';
  if (!token) {
    return { ok: false, error: 'Token is required.' };
  }

  try {
    savedTelegramToken = token;
    await writeSavedTelegramToken(token);
    restartTelegramBot();
    return {
      ok: true,
      enabled: Boolean(telegramBot),
      source: telegramTokenSource,
      hasSavedToken: Boolean(savedTelegramToken)
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('telegram:clear-token', async () => {
  try {
    savedTelegramToken = '';
    await writeSavedTelegramToken('');
    restartTelegramBot();
    return {
      ok: true,
      enabled: Boolean(telegramBot),
      source: telegramTokenSource,
      hasSavedToken: false
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});
