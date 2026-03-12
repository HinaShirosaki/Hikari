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
  loadToolContract,
  executeToolCall
} = require('./agent-tools');
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
const { resolveProtocolMatch } = require('./agent-protocol-matching');
const { buildNotebookDraft, buildNotebookDraftSummary } = require('./agent-notebook-generation');
const { buildProjectRecordIndex, retrieveProjectEvidence } = require('./agent-project-retrieval');
const { buildPaperSearchableDocs, retrievePaperCandidates, resolvePaperRequest } = require('./agent-paper-analysis');
const { createAgentWorkflowHelpers } = require('./agent-workflow-helpers');
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
    makeTool('search_workflows', 'Read workflow records with project links, block summaries, and recent step previews.'),
    makeTool('search_assays', 'Read assay runs with plate metadata and compact numeric summaries.'),
    makeTool('search_gel_analyses', 'Read gel analysis runs with confidence, calibration, and warning summaries.'),
    makeTool('search_inventory', 'Read chemical and personal inventory records.', 25),
    makeTool('search_papers', 'Read uploaded paper summaries, methods, and reagent extraction notes.'),
    makeTool('search_uniprot', 'Search UniProtKB protein knowledgebase records by keyword, accession, or gene/protein term.', 25),
    makeTool('search_pubmed', 'Search PubMed literature records and return article metadata for biomedical queries.', 25),
    makeTool('search_crossref', 'Search Crossref works metadata by title, DOI, author, or keyword.', 25),
    makeTool('search_europe_pmc', 'Search Europe PMC literature records with PubMed/PMCID/DOI metadata.', 25),
    {
      name: 'toolbox_molarity_calculator',
      description: 'Compute molarity, mass, volume, concentration, or dilution conversions used in the Toolbox Molarity Calculator.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['operation'],
        properties: {
          operation: {
            type: 'string',
            enum: [
              'mass_from_concentration_volume',
              'volume_from_mass_concentration',
              'concentration_from_mass_volume',
              'dilution_c1v1'
            ]
          },
          concentration_value: { type: 'number' },
          concentration_unit: { type: 'string', enum: ['fM', 'pM', 'nM', 'uM', 'mM', 'M'] },
          volume_value: { type: 'number' },
          volume_unit: { type: 'string', enum: ['uL', 'mL', 'L'] },
          mass_value: { type: 'number' },
          mass_unit: { type: 'string', enum: ['ug', 'mg', 'g', 'kg'] },
          molecular_weight_g_mol: { type: 'number' },
          stock_concentration_value: { type: 'number' },
          stock_concentration_unit: { type: 'string', enum: ['fM', 'pM', 'nM', 'uM', 'mM', 'M'] },
          target_concentration_value: { type: 'number' },
          target_concentration_unit: { type: 'string', enum: ['fM', 'pM', 'nM', 'uM', 'mM', 'M'] },
          target_volume_value: { type: 'number' },
          target_volume_unit: { type: 'string', enum: ['uL', 'mL', 'L'] },
          output_unit: { type: 'string' }
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
      name: 'toolbox_peptide_properties',
      description: 'Compute peptide mass, pI, net charge, residue counts, and extinction coefficients.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['sequence_text'],
        properties: {
          sequence_text: { type: 'string' },
          ph: { type: 'number' }
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
      name: 'toolbox_buffer_preparer',
      description: 'Compute required masses or liquid volumes for buffer preparation.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['volume_ml', 'components'],
        properties: {
          volume_ml: { type: 'number' },
          components: { type: 'array', items: { type: 'object' } }
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
      name: 'toolbox_dna_to_protein',
      description: 'Translate DNA/RNA sequence to protein in selected frame and stop mode.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['sequence_text'],
        properties: {
          sequence_text: { type: 'string' },
          sequence_type: { type: 'string', enum: ['DNA', 'RNA'] },
          frame: { type: 'integer', minimum: -3, maximum: 3 },
          stop_mode: { type: 'string', enum: ['star', 'trim'] }
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
      name: 'toolbox_protein_to_dna',
      description: 'Reverse-translate protein sequence to DNA with optional restriction-site constraints.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['protein_sequence'],
        properties: {
          protein_sequence: { type: 'string' },
          organism: { type: 'string' },
          append_stop_codon: { type: 'boolean' },
          restriction_sites: { type: 'array', items: { type: 'string' } }
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
      name: 'toolbox_oligo_properties',
      description: 'Compute oligo molecular weight, extinction coefficient, and Tm.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['sequence_text'],
        properties: {
          sequence_text: { type: 'string' },
          oligo_type: { type: 'string', enum: ['DNA', 'RNA'] }
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
      name: 'toolbox_extinction_coefficient',
      description: 'Compute extinction coefficient for protein/peptide or DNA/RNA sequences.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['sequence_type', 'sequence_text'],
        properties: {
          sequence_type: { type: 'string', enum: ['protein', 'DNA', 'RNA'] },
          sequence_text: { type: 'string' }
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
      name: 'toolbox_qpcr_efficiency',
      description: 'Compute qPCR efficiency from slope or standard-curve points.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          slope: { type: 'number' },
          points: { type: 'array', items: { type: 'object' } }
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
      name: 'toolbox_plannotate',
      description: 'Run pLannotate-like annotation from plain-text sequence input only (no file/blob input).',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['sequence_text'],
        properties: {
          sequence_text: { type: 'string' },
          topology: { type: 'string', enum: ['circular', 'linear'] },
          detailed: { type: 'boolean' },
          min_identity: { type: 'number', minimum: 50, maximum: 100 },
          min_coverage: { type: 'number', minimum: 0.05, maximum: 1 },
          min_hit_length: { type: 'integer', minimum: 12, maximum: 2000 },
          max_hits: { type: 'integer', minimum: 1, maximum: 200 },
          record_name: { type: 'string' }
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
      name: 'toolbox_crispr_sgrna_designer',
      description: 'Design CRISPR sgRNA candidates from target sequence text and scoring parameters.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['targets_text'],
        properties: {
          targets_text: { type: 'string' },
          reference_genome_id: { type: 'string' },
          pam_pattern: { type: 'string' },
          guide_length: { type: 'integer', minimum: 18, maximum: 24 },
          top_count: { type: 'integer', minimum: 1, maximum: 100 },
          min_gc: { type: 'number', minimum: 0, maximum: 100 },
          max_gc: { type: 'number', minimum: 0, maximum: 100 },
          selected_target_ids: { type: 'array', items: { type: 'string' } }
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
const AGENT_TOOL_REGISTRY = loadToolContract(AGENT_IO_CONTRACT);
const AGENT_TOOL_DEFINITIONS = AGENT_IO_CONTRACT.tools.map((tool) => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  parameters: cloneJson(tool.input_schema, { type: 'object', additionalProperties: false, properties: {} })
}));
const AGENT_TOOL_DEFINITION_MAP = AGENT_TOOL_REGISTRY.toolMap;
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

const agentWorkflowHelpers = createAgentWorkflowHelpers({
  cleanText,
  asArray,
  clamp,
  routingIntents: ROUTING_INTENTS,
  buildNotebookDraft
});

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

const TOOLBOX_CONCENTRATION_TO_M = Object.freeze({
  fM: 1e-15,
  pM: 1e-12,
  nM: 1e-9,
  uM: 1e-6,
  mM: 1e-3,
  M: 1
});

const TOOLBOX_VOLUME_TO_L = Object.freeze({
  uL: 1e-6,
  mL: 1e-3,
  L: 1
});

const TOOLBOX_MASS_TO_G = Object.freeze({
  ug: 1e-6,
  mg: 1e-3,
  g: 1,
  kg: 1e3
});

const TOOLBOX_DNA_BASE_MW = Object.freeze({ A: 313.21, T: 304.2, G: 329.21, C: 289.18 });
const TOOLBOX_RNA_BASE_MW = Object.freeze({ A: 329.21, U: 306.17, G: 345.21, C: 305.18 });
const TOOLBOX_DNA_EXTINCTION = Object.freeze({ A: 15400, C: 7400, G: 11500, T: 8700 });
const TOOLBOX_RNA_EXTINCTION = Object.freeze({ A: 15400, C: 7400, G: 11500, U: 9900 });
const TOOLBOX_COMPLEMENT = Object.freeze({ A: 'T', T: 'A', C: 'G', G: 'C' });
const TOOLBOX_CODON_TABLE = Object.freeze({
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G'
});

const TOOLBOX_AA_TO_CODONS = Object.freeze({
  A: ['GCT', 'GCC', 'GCA', 'GCG'],
  C: ['TGT', 'TGC'],
  D: ['GAT', 'GAC'],
  E: ['GAA', 'GAG'],
  F: ['TTT', 'TTC'],
  G: ['GGT', 'GGC', 'GGA', 'GGG'],
  H: ['CAT', 'CAC'],
  I: ['ATT', 'ATC', 'ATA'],
  K: ['AAA', 'AAG'],
  L: ['CTG', 'CTC', 'CTT', 'TTA', 'TTG', 'CTA'],
  M: ['ATG'],
  N: ['AAT', 'AAC'],
  P: ['CCT', 'CCC', 'CCA', 'CCG'],
  Q: ['CAA', 'CAG'],
  R: ['CGT', 'CGC', 'CGG', 'AGA', 'AGG', 'CGA'],
  S: ['TCT', 'TCC', 'TCA', 'TCG', 'AGC', 'AGT'],
  T: ['ACT', 'ACC', 'ACA', 'ACG'],
  V: ['GTG', 'GTT', 'GTC', 'GTA'],
  W: ['TGG'],
  Y: ['TAT', 'TAC'],
  '*': ['TAA', 'TGA', 'TAG']
});

const TOOLBOX_PEPTIDE_RESIDUE_MASS = Object.freeze({
  A: 71.08, R: 156.19, N: 114.1, D: 115.09, C: 103.15,
  E: 129.12, Q: 128.13, G: 57.05, H: 137.14, I: 113.16,
  L: 113.16, K: 128.17, M: 131.19, F: 147.18, P: 97.12,
  S: 87.08, T: 101.11, W: 186.21, Y: 163.18, V: 99.13
});

const TOOLBOX_PEPTIDE_PKA = Object.freeze({
  nTerminus: 9.69,
  cTerminus: 2.34,
  K: 10.54,
  R: 12.48,
  H: 6.04,
  D: 3.9,
  E: 4.07,
  C: 8.37,
  Y: 10.46
});

const TOOLBOX_IUPAC_BASE_MAP = Object.freeze({
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  R: 'AG',
  Y: 'CT',
  S: 'GC',
  W: 'AT',
  K: 'GT',
  M: 'AC',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT'
});

const TOOLBOX_IUPAC_COMPLEMENT_MAP = Object.freeze({
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  D: 'H',
  H: 'D',
  V: 'B',
  N: 'N'
});

const TOOLBOX_REFERENCE_GENOME_MULTIPLIER = Object.freeze({
  'human-hg38': 1.35,
  'mouse-mm39': 1.2,
  'zebrafish-gz11': 1.05,
  'yeast-r64': 0.72,
  'ecoli-k12': 0.58,
  custom: 1
});

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toolboxConcentrationToM(value, unit) {
  return toFiniteNumber(value) * (TOOLBOX_CONCENTRATION_TO_M[unit] || 0);
}

function toolboxConcentrationFromM(valueM, unit) {
  const factor = TOOLBOX_CONCENTRATION_TO_M[unit] || 0;
  return factor ? valueM / factor : 0;
}

function toolboxVolumeToL(value, unit) {
  return toFiniteNumber(value) * (TOOLBOX_VOLUME_TO_L[unit] || 0);
}

function toolboxVolumeFromL(valueL, unit) {
  const factor = TOOLBOX_VOLUME_TO_L[unit] || 0;
  return factor ? valueL / factor : 0;
}

function toolboxMassToG(value, unit) {
  return toFiniteNumber(value) * (TOOLBOX_MASS_TO_G[unit] || 0);
}

function toolboxMassFromG(valueG, unit) {
  const factor = TOOLBOX_MASS_TO_G[unit] || 0;
  return factor ? valueG / factor : 0;
}

function cleanNucleotideSequenceForToolbox(raw, type = 'DNA') {
  const normalized = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (String(type || '').toUpperCase() === 'RNA') {
    return normalized.replace(/T/g, 'U').replace(/[^ACGU]/g, '');
  }
  return normalized.replace(/U/g, 'T').replace(/[^ACGT]/g, '');
}

function countNucleotideResidues(sequence) {
  const counts = {};
  for (const base of String(sequence || '')) {
    counts[base] = (counts[base] || 0) + 1;
  }
  return counts;
}

function reverseComplementDnaForToolbox(sequence) {
  return [...String(sequence || '')]
    .reverse()
    .map((base) => TOOLBOX_COMPLEMENT[base] || 'N')
    .join('');
}

function translateDnaSequenceForToolbox(sequence, frame = 1, stopMode = 'star') {
  const numericFrame = toFiniteNumber(frame, 1);
  const isNegativeStrand = numericFrame < 0;
  const absFrame = Math.max(1, Math.min(3, Math.abs(Math.round(numericFrame)) || 1));
  const startIndex = absFrame - 1;
  const template = isNegativeStrand ? reverseComplementDnaForToolbox(sequence) : sequence;
  const coding = template.slice(startIndex);
  let protein = '';
  let codons = 0;

  for (let i = 0; i + 2 < coding.length; i += 3) {
    const codon = coding.slice(i, i + 3);
    const aa = TOOLBOX_CODON_TABLE[codon] || 'X';
    codons += 1;
    if (aa === '*' && stopMode === 'trim') {
      break;
    }
    protein += aa;
  }

  return {
    protein,
    codons,
    frame: absFrame,
    strand: isNegativeStrand ? '-' : '+',
    remainderBases: coding.length % 3
  };
}

function cleanProteinSequenceForToolbox(raw, allowStop = true) {
  const disallowed = allowStop ? /[^A-Z*]/g : /[^A-Z]/g;
  return String(raw || '').toUpperCase().replace(disallowed, '');
}

function countProteinResidues(sequence) {
  const counts = {};
  for (const aa of String(sequence || '')) {
    counts[aa] = (counts[aa] || 0) + 1;
  }
  return counts;
}

function positiveChargeForToolbox(pH, pKa, count) {
  return count * (1 / (1 + (10 ** (pH - pKa))));
}

function negativeChargeForToolbox(pH, pKa, count) {
  return count * (1 / (1 + (10 ** (pKa - pH))));
}

function calculateNetChargeForToolbox(sequence, pH = 7) {
  const counts = countProteinResidues(sequence);
  const positive =
    positiveChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.nTerminus, 1) +
    positiveChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.K, counts.K || 0) +
    positiveChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.R, counts.R || 0) +
    positiveChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.H, counts.H || 0);
  const negative =
    negativeChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.cTerminus, 1) +
    negativeChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.D, counts.D || 0) +
    negativeChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.E, counts.E || 0) +
    negativeChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.C, counts.C || 0) +
    negativeChargeForToolbox(pH, TOOLBOX_PEPTIDE_PKA.Y, counts.Y || 0);
  return positive - negative;
}

function estimateIsoelectricPointForToolbox(sequence) {
  if (!sequence.length) {
    return 0;
  }
  let low = 0;
  let high = 14;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const charge = calculateNetChargeForToolbox(sequence, mid);
    if (charge > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

function calculatePeptideStatsForToolbox(sequence, ph = 7) {
  const counts = countProteinResidues(sequence);
  const invalidResidues = [...sequence].filter((aa) => !TOOLBOX_PEPTIDE_RESIDUE_MASS[aa]);
  const residueMass = [...sequence].reduce((sum, aa) => sum + (TOOLBOX_PEPTIDE_RESIDUE_MASS[aa] || 0), 0);
  const mass = sequence.length ? residueMass + 18.015 : 0;
  const netCharge = calculateNetChargeForToolbox(sequence, ph);
  const pI = estimateIsoelectricPointForToolbox(sequence);
  const tyr = counts.Y || 0;
  const trp = counts.W || 0;
  const cys = counts.C || 0;
  return {
    counts,
    invalidResidues: [...new Set(invalidResidues)],
    length: sequence.length,
    mass,
    net_charge: netCharge,
    pI,
    extinction_reduced: 5500 * trp + 1490 * tyr,
    extinction_oxidized: 5500 * trp + 1490 * tyr + (125 * Math.floor(cys / 2))
  };
}

function oligoMolecularWeightForToolbox(sequence, type = 'DNA') {
  const map = String(type || '').toUpperCase() === 'RNA'
    ? TOOLBOX_RNA_BASE_MW
    : TOOLBOX_DNA_BASE_MW;
  return [...sequence].reduce((sum, base) => sum + (map[base] || 0), 0);
}

function oligoExtinctionForToolbox(sequence, type = 'DNA') {
  const map = String(type || '').toUpperCase() === 'RNA'
    ? TOOLBOX_RNA_EXTINCTION
    : TOOLBOX_DNA_EXTINCTION;
  return [...sequence].reduce((sum, base) => sum + (map[base] || 0), 0);
}

function oligoTmForToolbox(sequence, type = 'DNA') {
  const counts = countNucleotideResidues(sequence);
  const a = counts.A || 0;
  const g = counts.G || 0;
  const c = counts.C || 0;
  const tOrU = String(type || '').toUpperCase() === 'RNA' ? (counts.U || 0) : (counts.T || 0);
  const n = sequence.length;
  if (!n) {
    return 0;
  }
  if (n < 14) {
    return (2 * (a + tOrU)) + (4 * (g + c));
  }
  return 64.9 + ((41 * ((g + c) - 16.4)) / n);
}

function linearRegressionForToolbox(xValues, yValues) {
  const n = xValues.length;
  if (!n || n !== yValues.length) {
    return null;
  }
  const xMean = xValues.reduce((sum, value) => sum + value, 0) / n;
  const yMean = yValues.reduce((sum, value) => sum + value, 0) / n;
  let ssXX = 0;
  let ssXY = 0;
  let ssYY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xValues[i] - xMean;
    const dy = yValues[i] - yMean;
    ssXX += dx * dx;
    ssXY += dx * dy;
    ssYY += dy * dy;
  }
  if (ssXX === 0) {
    return null;
  }
  const slope = ssXY / ssXX;
  const intercept = yMean - (slope * xMean);
  const rSquared = ssYY === 0 ? 1 : ((ssXY * ssXY) / (ssXX * ssYY));
  return { slope, intercept, rSquared };
}

function normalizeIupacPatternForToolbox(raw) {
  const pattern = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!pattern) {
    return 'NGG';
  }
  return [...pattern].map((base) => (TOOLBOX_IUPAC_BASE_MAP[base] ? base : 'N')).join('');
}

function reverseComplementIupacForToolbox(pattern) {
  return [...String(pattern || '').toUpperCase()]
    .reverse()
    .map((base) => TOOLBOX_IUPAC_COMPLEMENT_MAP[base] || 'N')
    .join('');
}

function matchesIupacPatternForToolbox(sequence, pattern) {
  if (sequence.length !== pattern.length) {
    return false;
  }
  for (let i = 0; i < sequence.length; i += 1) {
    const base = sequence[i];
    const allowed = TOOLBOX_IUPAC_BASE_MAP[pattern[i]] || 'ACGT';
    if (!allowed.includes(base)) {
      return false;
    }
  }
  return true;
}

function parseCrisprTargetsTextForToolbox(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    return [];
  }

  const out = [];
  const pushTarget = (name, sequenceText) => {
    const sequence = String(sequenceText || '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .replace(/U/g, 'T')
      .replace(/[^ACGT]/g, 'N');
    if (sequence.length < 18) {
      return;
    }
    out.push({
      id: `target-${out.length + 1}`,
      name: cleanText(name, 80) || `Target ${out.length + 1}`,
      sequence
    });
  };

  if (/^\s*>/m.test(raw)) {
    const lines = raw.split(/\r?\n/);
    let currentName = '';
    let currentSequenceLines = [];
    const flush = () => {
      if (!currentSequenceLines.length) {
        return;
      }
      pushTarget(currentName || `Target ${out.length + 1}`, currentSequenceLines.join(''));
      currentSequenceLines = [];
    };
    lines.forEach((line) => {
      if (/^\s*>/.test(line)) {
        flush();
        currentName = line.replace(/^\s*>\s*/, '').trim();
      } else if (line.trim()) {
        currentSequenceLines.push(line.trim());
      }
    });
    flush();
    return out;
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 1) {
    lines.forEach((line) => pushTarget(`Target ${out.length + 1}`, line));
    if (out.length) {
      return out;
    }
  }
  pushTarget('Target 1', raw);
  return out;
}

function collectCrisprPamSitesForToolbox(target, guideLength, pamPattern) {
  const sequence = String(target.sequence || '').toUpperCase();
  const pamLength = pamPattern.length;
  const reversePamPattern = reverseComplementIupacForToolbox(pamPattern);
  const windowSize = guideLength + pamLength;
  const sites = [];

  for (let i = 0; i + windowSize <= sequence.length; i += 1) {
    const guideForward = sequence.slice(i, i + guideLength);
    const pamForward = sequence.slice(i + guideLength, i + windowSize);
    if (/^[ACGT]+$/.test(guideForward) && matchesIupacPatternForToolbox(pamForward, pamPattern)) {
      sites.push({
        key: `${target.id}|+|${i + 1}`,
        target_id: target.id,
        target_name: target.name,
        strand: '+',
        start: i + 1,
        end: i + guideLength,
        guide_sequence: guideForward,
        pam_sequence: pamForward
      });
    }

    const pamReverse = sequence.slice(i, i + pamLength);
    const guideReverseWindow = sequence.slice(i + pamLength, i + windowSize);
    if (/^[ACGT]+$/.test(guideReverseWindow) && matchesIupacPatternForToolbox(pamReverse, reversePamPattern)) {
      sites.push({
        key: `${target.id}|-|${i + pamLength + 1}`,
        target_id: target.id,
        target_name: target.name,
        strand: '-',
        start: i + pamLength + 1,
        end: i + windowSize,
        guide_sequence: reverseComplementDnaForToolbox(guideReverseWindow),
        pam_sequence: reverseComplementDnaForToolbox(pamReverse)
      });
    }
  }

  return sites;
}

function countMismatchesForToolbox(left, right, maxMismatch = Infinity) {
  if (left.length !== right.length) {
    return maxMismatch + 1;
  }
  let mismatches = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      mismatches += 1;
      if (mismatches > maxMismatch) {
        return mismatches;
      }
    }
  }
  return mismatches;
}

function calculateGcPercentForToolbox(sequence) {
  if (!sequence.length) {
    return 0;
  }
  const counts = countNucleotideResidues(sequence);
  return (((counts.G || 0) + (counts.C || 0)) / sequence.length) * 100;
}

function scoreCrisprOnTargetForToolbox(guideSequence) {
  if (!guideSequence.length) {
    return 0;
  }
  const gcPercent = calculateGcPercentForToolbox(guideSequence);
  const seed = guideSequence.slice(Math.max(0, guideSequence.length - 10));
  const seedGc = calculateGcPercentForToolbox(seed);
  let score = 70 - (Math.abs(gcPercent - 52) * 1.25);

  if (guideSequence.startsWith('G')) {
    score += 4.5;
  }
  if (guideSequence.endsWith('GG')) {
    score += 2;
  }
  if (/TTTT/.test(guideSequence)) {
    score -= 22;
  }
  if (/(AAAAA|CCCCC|GGGGG|TTTTT)/.test(guideSequence)) {
    score -= 12;
  }
  if (seedGc < 35 || seedGc > 82) {
    score -= 6;
  } else {
    score += 3;
  }
  if (!/^[ACGT]+$/.test(guideSequence)) {
    score -= 30;
  }
  return clamp(score, 0, 100);
}

function computeCrisprOffTargetStatsForToolbox(candidate, backgroundSites, genomeMultiplier = 1) {
  const mismatchCounts = { exact: 0, mismatch1: 0, mismatch2: 0, mismatch3: 0 };
  backgroundSites.forEach((site) => {
    if (site.key === candidate.key) {
      return;
    }
    const mismatches = countMismatchesForToolbox(candidate.guide_sequence, site.guide_sequence, 3);
    if (mismatches > 3) {
      return;
    }
    if (mismatches === 0) {
      mismatchCounts.exact += 1;
    } else if (mismatches === 1) {
      mismatchCounts.mismatch1 += 1;
    } else if (mismatches === 2) {
      mismatchCounts.mismatch2 += 1;
    } else {
      mismatchCounts.mismatch3 += 1;
    }
  });
  const weightedRisk =
    (mismatchCounts.exact * 1.25) +
    (mismatchCounts.mismatch1 * 0.46) +
    (mismatchCounts.mismatch2 * 0.16) +
    (mismatchCounts.mismatch3 * 0.05);
  const offTargetRate = clamp(weightedRisk * 14.5 * genomeMultiplier, 0, 99.9);
  const specificityScore = clamp(100 - offTargetRate, 0, 100);
  return {
    mismatch_counts: mismatchCounts,
    off_target_rate: offTargetRate,
    specificity_score: specificityScore
  };
}

function splitRestrictionSitesForToolbox(rawSites) {
  if (Array.isArray(rawSites)) {
    return rawSites
      .map((value) => String(value || '').toUpperCase().replace(/U/g, 'T').replace(/[^ACGT]/g, ''))
      .filter((value) => value.length >= 3);
  }
  return String(rawSites || '')
    .toUpperCase()
    .replace(/U/g, 'T')
    .split(/[\s,;|]+/)
    .map((token) => token.trim())
    .filter((token) => /^[ACGT]{3,}$/.test(token));
}

function anyRestrictedSiteIntroducedForToolbox(dna, restrictionSites) {
  if (!restrictionSites.length) {
    return false;
  }
  return restrictionSites.some((site) => dna.includes(site) || dna.includes(reverseComplementDnaForToolbox(site)));
}

function reverseTranslateProteinForToolbox(proteinInput, options = {}) {
  const appendStopCodon = options.appendStopCodon === true;
  const restrictionSites = splitRestrictionSitesForToolbox(options.restrictionSites);
  const cleaned = cleanProteinSequenceForToolbox(proteinInput, true);
  const protein = appendStopCodon && cleaned && !cleaned.endsWith('*')
    ? `${cleaned}*`
    : cleaned;
  if (!protein) {
    return {
      ok: false,
      reason: 'empty_protein',
      message: 'Enter a protein sequence to reverse translate.',
      protein: '',
      dna: '',
      codons: []
    };
  }

  const unsupported = [...new Set([...protein].filter((residue) => !TOOLBOX_AA_TO_CODONS[residue]))];
  if (unsupported.length) {
    return {
      ok: false,
      reason: 'unsupported_residue',
      message: `Unsupported residues: ${unsupported.join(', ')}`,
      unsupported_residues: unsupported,
      protein,
      dna: '',
      codons: []
    };
  }

  let dna = '';
  const codons = [];
  for (let i = 0; i < protein.length; i += 1) {
    const residue = protein[i];
    const optionsForResidue = TOOLBOX_AA_TO_CODONS[residue] || [];
    let picked = optionsForResidue[0] || '';
    for (const candidate of optionsForResidue) {
      const next = `${dna}${candidate}`;
      if (!anyRestrictedSiteIntroducedForToolbox(next, restrictionSites)) {
        picked = candidate;
        break;
      }
    }
    dna += picked;
    codons.push(picked);
  }

  if (anyRestrictedSiteIntroducedForToolbox(dna, restrictionSites)) {
    return {
      ok: false,
      reason: 'restriction_conflict',
      message: 'Unable to avoid all restricted motifs with available codon choices.',
      protein,
      dna,
      codons,
      restriction_sites: restrictionSites
    };
  }

  const counts = countNucleotideResidues(dna);
  const gcContent = dna.length ? (((counts.G || 0) + (counts.C || 0)) / dna.length) * 100 : 0;
  return {
    ok: true,
    protein,
    dna,
    codons,
    aa_length: protein.length,
    nt_length: dna.length,
    gc_content: gcContent,
    restriction_sites: restrictionSites
  };
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
  const normalized = String(name || '').trim();
  return [
    'run_python_sandbox',
    'toolbox_molarity_calculator',
    'toolbox_peptide_properties',
    'toolbox_buffer_preparer',
    'toolbox_dna_to_protein',
    'toolbox_protein_to_dna',
    'toolbox_oligo_properties',
    'toolbox_extinction_coefficient',
    'toolbox_qpcr_efficiency',
    'toolbox_plannotate',
    'toolbox_crispr_sgrna_designer'
  ].includes(normalized);
}

function normalizeRoutingPayload(rawRouting) {
  return agentWorkflowHelpers.normalizeRoutingPayload(rawRouting);
}

function buildRoutingAssumptionRows(routing) {
  return agentWorkflowHelpers.buildRoutingAssumptionRows(routing);
}

function normalizeNotebookDraftPayload(rawDraft) {
  return agentWorkflowHelpers.normalizeNotebookDraftPayload(rawDraft);
}

function buildNotebookDraftAssumptionRows(notebookDraft) {
  return agentWorkflowHelpers.buildNotebookDraftAssumptionRows(notebookDraft);
}

function maybeBuildNotebookDraft({
  message,
  conversation,
  routing,
  snapshot,
  projectId = '',
  projectName = '',
  toolResults = []
}) {
  return agentWorkflowHelpers.maybeBuildNotebookDraft({
    message,
    conversation,
    routing,
    snapshot,
    projectId,
    projectName,
    toolResults
  });
}

function maybeCollectProjectEvidence({
  message,
  routing,
  snapshot,
  projectId = '',
  projectName = ''
}) {
  const normalizedRouting = normalizeRoutingPayload(routing);
  if (normalizedRouting.intent !== 'project_science_question') {
    return null;
  }
  if (normalizedRouting.plan.needs_clarification) {
    return null;
  }

  const evidence = retrieveProjectEvidence({
    message,
    entities: normalizedRouting.entities,
    selectedProjectId: cleanText(projectId, 80),
    selectedProjectName: cleanText(projectName, 180),
    snapshot,
    maxPerSource: 3
  });
  if (!evidence || evidence.needs_clarification) {
    return null;
  }
  return evidence;
}

function buildProjectEvidenceAssumptionRows(projectEvidence) {
  const source = projectEvidence && typeof projectEvidence === 'object' ? projectEvidence : {};
  return asArray(source.summary_rows).map((row) => cleanText(row, 260)).filter(Boolean);
}

function maybeCollectPaperEvidence({
  message,
  routing,
  snapshot
}) {
  const normalizedRouting = normalizeRoutingPayload(routing);
  if (normalizedRouting.intent !== 'paper_analysis') {
    return null;
  }
  if (normalizedRouting.plan.needs_clarification) {
    return null;
  }

  const resolved = resolvePaperRequest({
    message,
    entities: normalizedRouting.entities,
    papers: asArray(snapshot.papers),
    projects: asArray(snapshot.projects),
    maxCandidates: 6
  });
  const selected = resolved?.selected && typeof resolved.selected === 'object' ? resolved.selected : {};
  const secondary = resolved?.secondary_selected && typeof resolved.secondary_selected === 'object'
    ? resolved.secondary_selected
    : {};
  const candidates = asArray(resolved?.candidates);

  const summaryRows = [
    `Paper mode=${cleanText(resolved?.mode, 80) || 'general_paper_query'} deep_read=${resolved?.requires_deep_reading === true} compare=${cleanText(resolved?.mode, 80) === 'compare_papers'}.`,
    `Paper selection=${cleanText(selected.paper_title || selected.paper_id, 220) || '-'} availability=${cleanText(resolved?.availability?.availability_status, 80) || 'unknown'} deep_ready=${resolved?.availability?.deep_read_ready === true}.`
  ];
  if (cleanText(secondary.paper_title || secondary.paper_id, 220)) {
    summaryRows.push(
      `Paper comparison target=${cleanText(secondary.paper_title || secondary.paper_id, 220)} `
      + `availability=${cleanText(resolved?.secondary_availability?.availability_status, 80) || 'unknown'} `
      + `deep_ready=${resolved?.secondary_availability?.deep_read_ready === true}.`
    );
  }
  if (cleanText(resolved?.comparison_summary, 1200)) {
    summaryRows.push(cleanText(resolved.comparison_summary, 1200));
  }

  const citations = [];
  const pushCitation = (sourceLabel, paperId, paperTitle, reason) => {
    const pointer = cleanText(paperId || paperTitle, 220);
    if (!pointer) {
      return;
    }
    citations.push({
      source: cleanText(sourceLabel, 120),
      pointer,
      reason: cleanText(reason, 220)
    });
  };

  pushCitation('paper', selected.paper_id, selected.paper_title, 'Resolved as primary paper candidate for current request.');
  pushCitation('paper', secondary.paper_id, secondary.paper_title, 'Resolved as secondary comparison paper candidate.');
  candidates.forEach((candidate) => {
    pushCitation(
      'paper',
      candidate?.paper_id,
      candidate?.paper_title,
      `Phase 7 candidate score=${Number(candidate?.score || 0).toFixed(2)} availability=${cleanText(candidate?.availability_status, 80) || 'unknown'}.`
    );
  });

  return {
    summary_rows: uniqueStrings(summaryRows).filter(Boolean),
    citations
  };
}

function buildPaperEvidenceAssumptionRows(paperEvidence) {
  const source = paperEvidence && typeof paperEvidence === 'object' ? paperEvidence : {};
  return asArray(source.summary_rows).map((row) => cleanText(row, 260)).filter(Boolean);
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
  const normalizedSnapshot = {
    projects: asArray(snapshot.projects).slice(0, 40),
    protocols: asArray(snapshot.protocols).slice(0, 100),
    notebookEntries: asArray(snapshot.notebookEntries).slice(0, 180),
    workflows: asArray(snapshot.workflows).slice(0, 120),
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
  normalizedSnapshot.projectIndex = buildProjectRecordIndex({ snapshot: normalizedSnapshot });
  return normalizedSnapshot;
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

async function runAgentToolDispatchLegacy(name, args, snapshot, options = {}) {
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
    const match = resolveProtocolMatch({
      message: query,
      entities: {},
      protocols: asArray(snapshot.protocols),
      projects: asArray(snapshot.projects),
      notebookEntries: asArray(snapshot.notebookEntries),
      maxCandidates: limit
    });
    const items = asArray(match?.candidates).slice(0, limit).map((candidate) => ({
      id: cleanText(candidate?.protocol_id, 80),
      name: cleanText(candidate?.protocol_name, 180),
      category: cleanText(candidate?.category, 80),
      steps: asArray(candidate?.steps).slice(0, 8).map((step) => protocolStepText(step)).filter(Boolean)
    })).filter((item) => item.name);

    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items,
      citations: items.map((protocol) => ({
        source: 'protocol',
        pointer: protocol.id || protocol.name,
        reason: 'Matched protocol with hybrid keyword and semantic ranking.'
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

  if (name === 'search_workflows') {
    const scopedEvidence = retrieveProjectEvidence({
      message: query,
      entities: {
        project: cleanText(normalizedArgs?.project_name || normalizedArgs?.project, 180),
        workflow_step: cleanText(normalizedArgs?.workflow_step, 180),
        protocol: cleanText(normalizedArgs?.protocol, 180),
        activity: query
      },
      selectedProjectId: cleanText(normalizedArgs?.project_id, 80),
      selectedProjectName: cleanText(normalizedArgs?.project_name, 180),
      snapshot,
      maxPerSource: limit,
      allowAmbiguousScope: true
    });

    const evidenceRows = asArray(scopedEvidence?.packs?.workflows).map((workflow) => ({
      id: cleanText(workflow?.id, 80),
      name: cleanText(workflow?.name, 180),
      project_name: cleanText(workflow?.project_name, 180),
      description: cleanText(workflow?.description, 400),
      block_count: Number(workflow?.block_count) || 0,
      link_count: Number(workflow?.link_count) || 0,
      steps_preview: asArray(workflow?.steps_preview).map((step) => cleanText(step, 220)).filter(Boolean).slice(0, 8),
      updated_at: cleanText(workflow?.updated_at, 80)
    })).filter((workflow) => workflow.id || workflow.name);

    const fallbackRows = pickTopMatches(
      snapshot.workflows,
      (workflow) => [
        workflow?.name,
        workflow?.description,
        asArray(workflow?.blocks).map((block) => block?.text || block?.protocolId).join(' ')
      ].join(' '),
      query,
      limit
    ).map((workflow) => ({
      id: cleanText(workflow?.id, 80),
      name: cleanText(workflow?.name, 180),
      project_name: cleanText(
        asArray(snapshot.projects).find((project) => project.id === cleanText(workflow?.projectId, 80))?.name,
        180
      ),
      description: cleanText(workflow?.description, 400),
      block_count: asArray(workflow?.blocks).length,
      link_count: asArray(workflow?.links).length,
      steps_preview: asArray(workflow?.blocks).map((block) => cleanText(block?.text || block?.protocolId, 220)).filter(Boolean).slice(0, 8),
      updated_at: cleanText(workflow?.updatedAt || workflow?.createdAt, 80)
    }));

    const items = evidenceRows.length ? evidenceRows : fallbackRows;
    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items: items.slice(0, limit),
      citations: items.slice(0, limit).map((workflow) => ({
        source: 'workflow',
        pointer: workflow.id || workflow.name,
        reason: 'Matched workflow graph metadata and step previews.'
      })),
      summary: `Found ${items.slice(0, limit).length} matching workflows.`
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
    const docs = buildPaperSearchableDocs({
      papers: asArray(snapshot.papers),
      projects: asArray(snapshot.projects)
    });
    const ranked = retrievePaperCandidates({
      message: query || 'paper',
      entities: {
        paper_title: cleanText(normalizedArgs?.paper_title || normalizedArgs?.title, 220),
        project: cleanText(normalizedArgs?.project_name || normalizedArgs?.project, 180),
        protein: cleanText(normalizedArgs?.protein, 140),
        compound: cleanText(normalizedArgs?.compound, 140)
      },
      docs,
      maxCandidates: limit
    });
    const items = ranked.slice(0, limit).map((paper) => ({
      id: cleanText(paper?.paper_id, 80),
      title: cleanText(paper?.paper_title, 220),
      summary: cleanText(paper?.summary, 500),
      methods: asArray(paper?.methods).slice(0, 4).map((method) => ({
        title: cleanText(method?.title, 180),
        steps: asArray(method?.steps).slice(0, 6).map((step) => cleanText(step, 200)).filter(Boolean),
        citations: asArray(method?.citations).slice(0, 6).map((citation) => cleanText(citation, 140)).filter(Boolean)
      })),
      availability_status: cleanText(paper?.availability_status, 80),
      deep_read_ready: paper?.deep_read_ready === true,
      ingestion_status: cleanText(paper?.ingestion_status, 80),
      key_figures: asArray(paper?.key_figures).map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 8),
      linked_project_name: cleanText(paper?.linked_project_name, 220),
      updated_at: cleanText(paper?.updated_at, 80)
    }));
    const deepReadyCount = items.filter((item) => item.deep_read_ready === true).length;

    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items,
      citations: items.map((paper) => ({
        source: 'paper',
        pointer: paper.id || paper.title,
        reason: 'Matched paper title, summary, methods, reagents, or key-figure metadata.'
      })),
      summary: `Found ${items.length} matching papers (${deepReadyCount} deep-ready).`
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

  if (name === 'toolbox_molarity_calculator') {
    const operation = cleanText(normalizedArgs?.operation, 80);
    const defaultConcentrationUnit = cleanText(normalizedArgs?.concentration_unit, 8) || 'mM';
    const defaultVolumeUnit = cleanText(normalizedArgs?.volume_unit, 8) || 'mL';
    const defaultMassUnit = cleanText(normalizedArgs?.mass_unit, 8) || 'mg';
    let resultValue = 0;
    let resultUnit = cleanText(normalizedArgs?.output_unit, 16);
    let intermediate = {};
    let summary = '';

    if (operation === 'mass_from_concentration_volume') {
      const concentrationM = toolboxConcentrationToM(normalizedArgs?.concentration_value, defaultConcentrationUnit);
      const volumeL = toolboxVolumeToL(normalizedArgs?.volume_value, defaultVolumeUnit);
      const mw = toFiniteNumber(normalizedArgs?.molecular_weight_g_mol);
      const massG = concentrationM * volumeL * mw;
      resultUnit = resultUnit || defaultMassUnit;
      resultValue = toolboxMassFromG(massG, resultUnit);
      intermediate = { concentration_M: concentrationM, volume_L: volumeL, molecular_weight_g_mol: mw, mass_g: massG };
      summary = `Calculated mass from concentration and volume in ${resultUnit}.`;
    } else if (operation === 'volume_from_mass_concentration') {
      const massG = toolboxMassToG(normalizedArgs?.mass_value, defaultMassUnit);
      const mw = toFiniteNumber(normalizedArgs?.molecular_weight_g_mol);
      const concentrationM = toolboxConcentrationToM(normalizedArgs?.concentration_value, defaultConcentrationUnit);
      const moles = mw > 0 ? (massG / mw) : 0;
      const volumeL = concentrationM > 0 ? (moles / concentrationM) : 0;
      resultUnit = resultUnit || defaultVolumeUnit;
      resultValue = toolboxVolumeFromL(volumeL, resultUnit);
      intermediate = { mass_g: massG, molecular_weight_g_mol: mw, concentration_M: concentrationM, moles, volume_L: volumeL };
      summary = `Calculated volume from mass and concentration in ${resultUnit}.`;
    } else if (operation === 'concentration_from_mass_volume') {
      const massG = toolboxMassToG(normalizedArgs?.mass_value, defaultMassUnit);
      const mw = toFiniteNumber(normalizedArgs?.molecular_weight_g_mol);
      const volumeL = toolboxVolumeToL(normalizedArgs?.volume_value, defaultVolumeUnit);
      const moles = mw > 0 ? (massG / mw) : 0;
      const concentrationM = volumeL > 0 ? (moles / volumeL) : 0;
      resultUnit = resultUnit || defaultConcentrationUnit;
      resultValue = toolboxConcentrationFromM(concentrationM, resultUnit);
      intermediate = { mass_g: massG, molecular_weight_g_mol: mw, volume_L: volumeL, moles, concentration_M: concentrationM };
      summary = `Calculated concentration from mass and volume in ${resultUnit}.`;
    } else if (operation === 'dilution_c1v1') {
      const stockUnit = cleanText(normalizedArgs?.stock_concentration_unit, 8) || 'mM';
      const targetUnit = cleanText(normalizedArgs?.target_concentration_unit, 8) || 'mM';
      const targetVolumeUnit = cleanText(normalizedArgs?.target_volume_unit, 8) || 'mL';
      const stockM = toolboxConcentrationToM(normalizedArgs?.stock_concentration_value, stockUnit);
      const targetM = toolboxConcentrationToM(normalizedArgs?.target_concentration_value, targetUnit);
      const targetVolumeL = toolboxVolumeToL(normalizedArgs?.target_volume_value, targetVolumeUnit);
      const stockVolumeL = stockM > 0 ? ((targetM * targetVolumeL) / stockM) : 0;
      const diluentL = Math.max(0, targetVolumeL - stockVolumeL);
      resultUnit = resultUnit || targetVolumeUnit;
      resultValue = toolboxVolumeFromL(stockVolumeL, resultUnit);
      intermediate = {
        stock_concentration_M: stockM,
        target_concentration_M: targetM,
        target_volume_L: targetVolumeL,
        stock_volume_L: stockVolumeL,
        diluent_volume_L: diluentL,
        diluent_volume_in_output_unit: toolboxVolumeFromL(diluentL, resultUnit)
      };
      summary = `Calculated stock and diluent volumes for C1V1=C2V2 in ${resultUnit}.`;
    } else {
      return buildAgentToolOutputEnvelope(
        name,
        normalizedArgs,
        { items: [], citations: [], summary: 'Unsupported molarity operation.' },
        { ok: false, error: `Unsupported operation: ${operation}` }
      );
    }

    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items: [{
        operation,
        result_value: resultValue,
        result_unit: resultUnit,
        ...intermediate
      }],
      citations: [{
        source: 'toolbox_molarity',
        pointer: operation || 'molarity',
        reason: 'Computed with deterministic unit conversion formulas.'
      }],
      summary
    });
  }

  if (name === 'toolbox_peptide_properties') {
    const sequence = cleanProteinSequenceForToolbox(normalizedArgs?.sequence_text, false);
    if (!sequence) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'No valid peptide sequence was provided.'
      });
    }
    const ph = toFiniteNumber(normalizedArgs?.ph, 7);
    const stats = calculatePeptideStatsForToolbox(sequence, ph);
    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items: [{ sequence, ph, ...stats }],
      citations: [{
        source: 'toolbox_peptide',
        pointer: `length:${stats.length}`,
        reason: 'Computed peptide physicochemical properties.'
      }],
      summary: `Computed peptide properties for ${stats.length} residues.`
    });
  }

  if (name === 'toolbox_buffer_preparer') {
    const volumeMl = toFiniteNumber(normalizedArgs?.volume_ml);
    const volumeL = volumeMl / 1000;
    const components = asArray(normalizedArgs?.components).slice(0, 60);
    if (!(volumeMl > 0) || !components.length) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'Buffer preparation requires positive volume_ml and at least one component.'
      });
    }

    let totalSolidMg = 0;
    let totalLiquidMl = 0;
    const items = components.map((component, index) => {
      const form = String(component?.form || 'solid').toLowerCase() === 'liquid' ? 'liquid' : 'solid';
      const concentrationValue = toFiniteNumber(component?.concentration_value);
      const concentrationUnitRaw = String(component?.concentration_unit || '').trim();
      const concentrationUnit = concentrationUnitRaw || (form === 'liquid' ? 'percent_vv' : 'mM');
      const nameLabel = cleanText(component?.name, 120) || `component_${index + 1}`;

      if (form === 'liquid') {
        const percent = concentrationUnit.toLowerCase().includes('%')
          || concentrationUnit.toLowerCase().includes('percent')
          ? concentrationValue
          : concentrationValue;
        const requiredMl = (volumeMl * percent) / 100;
        const requiredUl = requiredMl * 1000;
        totalLiquidMl += requiredMl;
        return {
          name: nameLabel,
          form,
          concentration_value: concentrationValue,
          concentration_unit: concentrationUnit,
          required_ml: requiredMl,
          required_ul: requiredUl
        };
      }

      const mw = toFiniteNumber(component?.molecular_weight_g_mol);
      const concentrationM = toolboxConcentrationToM(
        concentrationValue,
        concentrationUnit in TOOLBOX_CONCENTRATION_TO_M ? concentrationUnit : 'mM'
      );
      const moles = concentrationM * volumeL;
      const grams = moles * mw;
      const mg = grams * 1000;
      totalSolidMg += mg;
      return {
        name: nameLabel,
        form,
        concentration_value: concentrationValue,
        concentration_unit: concentrationUnit,
        molecular_weight_g_mol: mw,
        required_mg: mg,
        required_g: grams
      };
    });

    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items,
      citations: [{
        source: 'toolbox_buffer',
        pointer: `components:${items.length}`,
        reason: 'Calculated component amounts from target buffer formulation.'
      }],
      summary: `Calculated ${items.length} buffer components (solids ${totalSolidMg.toFixed(3)} mg, liquids ${totalLiquidMl.toFixed(3)} mL).`
    });
  }

  if (name === 'toolbox_dna_to_protein') {
    const sequenceType = String(normalizedArgs?.sequence_type || 'DNA').toUpperCase() === 'RNA' ? 'RNA' : 'DNA';
    const cleaned = cleanNucleotideSequenceForToolbox(normalizedArgs?.sequence_text, sequenceType);
    if (!cleaned) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'No valid DNA/RNA sequence was provided.'
      });
    }
    const frameRaw = Math.round(toFiniteNumber(normalizedArgs?.frame, 1));
    const frame = frameRaw === 0 ? 1 : clamp(frameRaw, -3, 3);
    const stopMode = String(normalizedArgs?.stop_mode || 'star') === 'trim' ? 'trim' : 'star';
    const dnaSequence = sequenceType === 'RNA' ? cleaned.replace(/U/g, 'T') : cleaned;
    const translated = translateDnaSequenceForToolbox(dnaSequence, frame, stopMode);
    const counts = countNucleotideResidues(cleaned);
    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items: [{
        sequence_type: sequenceType,
        cleaned_sequence: cleaned,
        nucleotide_counts: counts,
        ...translated
      }],
      citations: [{
        source: 'toolbox_translation',
        pointer: `${translated.strand}${translated.frame}`,
        reason: 'Translated sequence with codon table.'
      }],
      summary: `Translated ${translated.codons} codons in frame ${translated.strand}${translated.frame}.`
    });
  }

  if (name === 'toolbox_protein_to_dna') {
    const protein = cleanProteinSequenceForToolbox(normalizedArgs?.protein_sequence, true);
    if (!protein) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'No valid protein sequence was provided.'
      });
    }

    const translated = reverseTranslateProteinForToolbox(protein, {
      appendStopCodon: normalizedArgs?.append_stop_codon === true,
      restrictionSites: asArray(normalizedArgs?.restriction_sites)
    });

    return buildAgentToolOutputEnvelope(
      name,
      normalizedArgs,
      { items: [translated], citations: [{
        source: 'toolbox_reverse_translation',
        pointer: `aa:${translated.aa_length || protein.length}`,
        reason: translated.ok ? 'Reverse-translated protein sequence to DNA.' : 'Reverse translation returned a constraint/validation error.'
      }], summary: translated.ok
        ? `Reverse-translated protein to ${translated.nt_length} bp DNA.`
        : (translated.message || 'Reverse translation failed.') },
      translated.ok ? {} : { ok: false, error: translated.message || 'Reverse translation failed.' }
    );
  }

  if (name === 'toolbox_oligo_properties') {
    const oligoType = String(normalizedArgs?.oligo_type || 'DNA').toUpperCase() === 'RNA' ? 'RNA' : 'DNA';
    const sequence = cleanNucleotideSequenceForToolbox(normalizedArgs?.sequence_text, oligoType);
    if (!sequence) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'No valid oligo sequence was provided.'
      });
    }
    const counts = countNucleotideResidues(sequence);
    const mw = oligoMolecularWeightForToolbox(sequence, oligoType);
    const extinction = oligoExtinctionForToolbox(sequence, oligoType);
    const tm = oligoTmForToolbox(sequence, oligoType);
    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items: [{
        oligo_type: oligoType,
        sequence,
        length: sequence.length,
        counts,
        molecular_weight_g_mol: mw,
        extinction_coefficient_m1_cm1: extinction,
        tm_celsius: tm
      }],
      citations: [{
        source: 'toolbox_oligo',
        pointer: `${oligoType}:${sequence.length}`,
        reason: 'Computed oligo MW, extinction, and Tm.'
      }],
      summary: `Computed oligo properties for ${sequence.length} nt (${oligoType}).`
    });
  }

  if (name === 'toolbox_extinction_coefficient') {
    const sequenceType = String(normalizedArgs?.sequence_type || 'protein');
    const normalizedType = sequenceType === 'DNA' || sequenceType === 'RNA' ? sequenceType : 'protein';
    if (normalizedType === 'protein') {
      const sequence = cleanProteinSequenceForToolbox(normalizedArgs?.sequence_text, false);
      if (!sequence) {
        return buildAgentToolOutputEnvelope(name, normalizedArgs, {
          items: [],
          citations: [],
          summary: 'No valid protein sequence was provided.'
        });
      }
      const counts = countProteinResidues(sequence);
      const tyr = counts.Y || 0;
      const trp = counts.W || 0;
      const cys = counts.C || 0;
      const reduced = (5500 * trp) + (1490 * tyr);
      const oxidized = reduced + (125 * Math.floor(cys / 2));
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [{
          sequence_type: 'protein',
          sequence,
          length: sequence.length,
          extinction_reduced_m1_cm1: reduced,
          extinction_oxidized_m1_cm1: oxidized
        }],
        citations: [{
          source: 'toolbox_extinction',
          pointer: `protein:${sequence.length}`,
          reason: 'Computed protein extinction coefficients from Trp/Tyr/Cys counts.'
        }],
        summary: `Computed protein extinction coefficient for ${sequence.length} residues.`
      });
    }

    const sequence = cleanNucleotideSequenceForToolbox(normalizedArgs?.sequence_text, normalizedType);
    if (!sequence) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: `No valid ${normalizedType} sequence was provided.`
      });
    }
    const extinction = oligoExtinctionForToolbox(sequence, normalizedType);
    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items: [{
        sequence_type: normalizedType,
        sequence,
        length: sequence.length,
        extinction_m1_cm1: extinction
      }],
      citations: [{
        source: 'toolbox_extinction',
        pointer: `${normalizedType}:${sequence.length}`,
        reason: `Computed ${normalizedType} extinction coefficient.`
      }],
      summary: `Computed ${normalizedType} extinction coefficient for ${sequence.length} nt.`
    });
  }

  if (name === 'toolbox_qpcr_efficiency') {
    const inputSlope = toFiniteNumber(normalizedArgs?.slope, Number.NaN);
    const slopeValid = Number.isFinite(inputSlope) && inputSlope !== 0;
    const points = asArray(normalizedArgs?.points).map((point) => ({
      quantity: toFiniteNumber(point?.quantity, Number.NaN),
      ct: toFiniteNumber(point?.ct, Number.NaN)
    })).filter((point) => Number.isFinite(point.quantity) && point.quantity > 0 && Number.isFinite(point.ct));

    const xValues = points.map((point) => Math.log10(point.quantity));
    const yValues = points.map((point) => point.ct);
    const regression = points.length >= 2 ? linearRegressionForToolbox(xValues, yValues) : null;
    const usedSlope = slopeValid ? inputSlope : (regression?.slope ?? Number.NaN);
    if (!Number.isFinite(usedSlope) || usedSlope === 0) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'Provide slope or at least two valid qPCR standard-curve points.'
      });
    }
    const efficiencyPercent = ((10 ** (-1 / usedSlope)) - 1) * 100;
    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items: [{
        slope: usedSlope,
        slope_source: slopeValid ? 'input' : 'regression',
        intercept: regression?.intercept ?? null,
        r_squared: regression?.rSquared ?? null,
        points_used: points.length,
        efficiency_percent: efficiencyPercent
      }],
      citations: [{
        source: 'toolbox_qpcr',
        pointer: slopeValid ? 'input_slope' : `points:${points.length}`,
        reason: 'Computed qPCR efficiency with Efficiency = (10^(-1/slope) - 1) * 100.'
      }],
      summary: `Computed qPCR efficiency as ${efficiencyPercent.toFixed(2)}%.`
    });
  }

  if (name === 'toolbox_plannotate') {
    const sequenceText = String(normalizedArgs?.sequence_text || '');
    if (!sequenceText.trim()) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'No plain-text sequence was provided for pLannotate.'
      });
    }

    try {
      const result = await annotateWithBlast({
        sequenceText,
        topology: String(normalizedArgs?.topology || '') === 'linear' ? 'linear' : 'circular',
        detailed: normalizedArgs?.detailed === true,
        minIdentity: clamp(toFiniteNumber(normalizedArgs?.min_identity, 85), 50, 100),
        minCoverage: clamp(toFiniteNumber(normalizedArgs?.min_coverage, 0.25), 0.05, 1),
        minHitLength: Math.round(clamp(toFiniteNumber(normalizedArgs?.min_hit_length, 24), 12, 2000)),
        maxHits: Math.round(clamp(toFiniteNumber(normalizedArgs?.max_hits, 60), 1, 200)),
        recordName: cleanText(normalizedArgs?.record_name, 120) || 'plasmid'
      });

      const resultLimit = Math.round(clamp(toFiniteNumber(normalizedArgs?.max_hits, 20), 1, 200));
      const items = asArray(result?.hits).slice(0, resultLimit).map((hit, index) => ({
        id: cleanText(`${hit?.sseqid || hit?.Feature || 'hit'}_${index + 1}`, 120),
        feature: cleanText(hit?.Feature, 180),
        type: cleanText(hit?.Type, 80),
        start: Number(toFiniteNumber(hit?.qstart, 0)) + 1,
        end: Number(toFiniteNumber(hit?.qend, 0)),
        strand: Number(toFiniteNumber(hit?.sframe, 1)) === -1 ? '-' : '+',
        identity_percent: Number(toFiniteNumber(hit?.pident, 0)),
        coverage_percent: Number(toFiniteNumber(hit?.percmatch, 0)),
        source_db: cleanText(hit?.db, 60),
        fragment: hit?.fragment === true
      }));
      const citations = items.slice(0, 20).map((item) => ({
        source: 'plannotate',
        pointer: item.id || item.feature || 'hit',
        reason: 'Annotated pLannotate feature hit from plain-text sequence.'
      }));
      const warningCount = asArray(result?.warnings).length;
      const summary = `Annotated ${items.length} feature hit(s) from plain-text sequence${warningCount ? ` with ${warningCount} warning(s)` : ''}.`;
      return buildAgentToolOutputEnvelope(name, normalizedArgs, { items, citations, summary });
    } catch (error) {
      return buildAgentToolOutputEnvelope(
        name,
        normalizedArgs,
        {
          items: [],
          citations: [],
          summary: 'pLannotate annotation failed.'
        },
        {
          ok: false,
          error: cleanText(error?.message || error, 600)
        }
      );
    }
  }

  if (name === 'toolbox_crispr_sgrna_designer') {
    const parsedTargets = parseCrisprTargetsTextForToolbox(normalizedArgs?.targets_text);
    if (!parsedTargets.length) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'No valid CRISPR target sequence(s) were parsed.'
      });
    }

    const selectedIds = new Set(asArray(normalizedArgs?.selected_target_ids).map((value) => cleanText(value, 80)).filter(Boolean));
    const selectedTargets = selectedIds.size
      ? parsedTargets.filter((target) => selectedIds.has(target.id))
      : parsedTargets;
    if (!selectedTargets.length) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'selected_target_ids did not match any parsed targets.'
      });
    }

    const pamPattern = normalizeIupacPatternForToolbox(normalizedArgs?.pam_pattern || 'NGG');
    const guideLength = Math.round(clamp(toFiniteNumber(normalizedArgs?.guide_length, 20), 18, 24));
    const topCount = Math.round(clamp(toFiniteNumber(normalizedArgs?.top_count, 12), 1, 100));
    let minGc = clamp(toFiniteNumber(normalizedArgs?.min_gc, 35), 0, 100);
    let maxGc = clamp(toFiniteNumber(normalizedArgs?.max_gc, 75), 0, 100);
    if (minGc > maxGc) {
      const swap = minGc;
      minGc = maxGc;
      maxGc = swap;
    }
    const referenceGenomeId = cleanText(normalizedArgs?.reference_genome_id, 40) || 'custom';
    const genomeMultiplier = TOOLBOX_REFERENCE_GENOME_MULTIPLIER[referenceGenomeId] || 1;

    const selectedSites = selectedTargets.flatMap((target) => collectCrisprPamSitesForToolbox(target, guideLength, pamPattern));
    const backgroundSites = parsedTargets.flatMap((target) => collectCrisprPamSitesForToolbox(target, guideLength, pamPattern));

    const candidates = selectedSites.map((site) => {
      const gcPercent = calculateGcPercentForToolbox(site.guide_sequence);
      const onTargetScore = scoreCrisprOnTargetForToolbox(site.guide_sequence);
      const notes = [];
      if (/TTTT/.test(site.guide_sequence)) {
        notes.push('poly-T motif');
      }
      if (/(AAAAA|CCCCC|GGGGG|TTTTT)/.test(site.guide_sequence)) {
        notes.push('homopolymer');
      }
      return {
        ...site,
        gc_percent: gcPercent,
        on_target_score: onTargetScore,
        notes
      };
    }).filter((candidate) => candidate.gc_percent >= minGc && candidate.gc_percent <= maxGc);

    if (!candidates.length) {
      return buildAgentToolOutputEnvelope(name, normalizedArgs, {
        items: [],
        citations: [],
        summary: 'No sgRNA candidates passed GC and PAM filters.'
      });
    }

    const evaluated = candidates.slice(0, Math.min(candidates.length, Math.max(topCount * 4, 120), 320))
      .map((candidate) => {
        const offTarget = computeCrisprOffTargetStatsForToolbox(candidate, backgroundSites.slice(0, 15000), genomeMultiplier);
        const totalScore = (candidate.on_target_score * 0.62) + (offTarget.specificity_score * 0.38);
        return {
          ...candidate,
          ...offTarget,
          total_score: totalScore
        };
      })
      .sort((left, right) => (
        (right.total_score - left.total_score)
        || (right.on_target_score - left.on_target_score)
        || (right.specificity_score - left.specificity_score)
      ));

    const items = evaluated.slice(0, topCount).map((candidate, index) => ({
      rank: index + 1,
      target_id: candidate.target_id,
      target_name: candidate.target_name,
      strand: candidate.strand,
      start: candidate.start,
      end: candidate.end,
      guide_sequence: candidate.guide_sequence,
      pam_sequence: candidate.pam_sequence,
      gc_percent: candidate.gc_percent,
      on_target_score: candidate.on_target_score,
      specificity_score: candidate.specificity_score,
      off_target_rate: candidate.off_target_rate,
      total_score: candidate.total_score,
      mismatch_counts: candidate.mismatch_counts,
      notes: candidate.notes
    }));
    const citations = items.slice(0, 20).map((item) => ({
      source: 'toolbox_crispr',
      pointer: `${item.target_id}:${item.start}-${item.end}:${item.strand}`,
      reason: 'Ranked sgRNA candidate from deterministic CRISPR scoring.'
    }));
    return buildAgentToolOutputEnvelope(name, normalizedArgs, {
      items,
      citations,
      summary: `Designed ${items.length} sgRNA candidate(s) from ${selectedTargets.length} selected target(s).`
    });
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

function buildToolFuzzyVocabulary(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const values = [
    ...asArray(source.projects).flatMap((item) => [item?.name, item?.summary]),
    ...asArray(source.protocols).flatMap((item) => [item?.name, item?.category]),
    ...asArray(source.workflows).flatMap((item) => [
      item?.name,
      item?.description,
      ...asArray(item?.blocks).map((block) => block?.text || block?.protocolId)
    ]),
    ...asArray(source.notebookEntries).flatMap((item) => [item?.protocolName, item?.result]),
    ...asArray(source.assays).flatMap((item) => [item?.name, item?.project_name, item?.notebook_entry_protocol_name]),
    ...asArray(source.gelAnalyses).flatMap((item) => [item?.name, item?.project_name, item?.notebook_entry_protocol_name]),
    ...asArray(source.papers).flatMap((item) => [item?.title, item?.summary]),
    ...asArray(source.inventory?.chemicals).flatMap((item) => [item?.name, item?.cas, item?.supplier]),
    ...asArray(source.inventory?.personal).flatMap((zone) => asArray(zone?.items).flatMap((item) => [item?.name, item?.location])),
    'molecular weight',
    'isoelectric point',
    'pd-1',
    'pd1'
  ];
  const seen = new Set();
  const out = [];
  values.forEach((value) => {
    const normalized = cleanText(value, 220);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

async function runAgentTool(name, args, snapshot, options = {}) {
  return executeToolCall(name, normalizeToolInvocationArgs(args), {
    contract: AGENT_TOOL_REGISTRY,
    allowWriteTools: options?.allowWriteTools === true,
    fuzzyVocabulary: buildToolFuzzyVocabulary(snapshot),
    toEnvelope: (toolName, callArgs, rawResult, envelopeOptions = {}) => buildAgentToolOutputEnvelope(
      toolName,
      callArgs,
      rawResult,
      envelopeOptions
    ),
    dispatch: async (toolName, callArgs) => runAgentToolDispatchLegacy(
      toolName,
      callArgs,
      snapshot,
      options
    )
  });
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
  const notebookDraft = normalizeNotebookDraftPayload(source.notebookDraft);
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
    notebookDraft: notebookDraft
      ? {
        protocol: notebookDraft.protocol,
        project: notebookDraft.project,
        notebook_type: notebookDraft.notebook_type,
        placeholder_count: notebookDraft.placeholder_values.length,
        unresolved_count: notebookDraft.unresolved_placeholders.length,
        save: notebookDraft.save
      }
      : null,
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
    'search_workflows',
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
  projectId,
  projectName,
  promptConfig,
  allowWriteTools,
  routing
}) {
  const intermediateStates = [];
  const toolTrace = [];
  const evidence = [];
  const notebookToolResults = [];
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
      `Context sizes: projects=${snapshot.projects.length}, protocols=${snapshot.protocols.length}, workflows=${snapshot.workflows.length}, notebook_entries=${snapshot.notebookEntries.length}, assays=${snapshot.assays.length}, gel_analyses=${snapshot.gelAnalyses.length}, papers=${snapshot.papers.length}.`
    ],
    confidence: 0.52
  }));

  intermediateStates.push(buildIntermediateState('route', `Resolved routing intent "${routingInfo.intent}".`, {
    assumptions: buildRoutingAssumptionRows(routingInfo),
    openQuestions: routingInfo.plan.needs_clarification ? [routingInfo.plan.clarification_question] : [],
    proposedActions: asArray(routingInfo.plan.tool_selection_rationale).slice(0, 5).map((row) => ({
      action_type: 'read',
      tool_name: row.tool,
      risk_level: 'low',
      reason: `selector score=${Number(row.score) || 0}; ${cleanText(row.reason, 180)}`
    })),
    confidence: routingInfo.confidence
  }));

  const projectEvidence = maybeCollectProjectEvidence({
    message,
    routing: routingInfo,
    snapshot,
    projectId,
    projectName
  });
  if (projectEvidence) {
    const assumptions = buildProjectEvidenceAssumptionRows(projectEvidence);
    intermediateStates.push(buildIntermediateState('project_evidence', 'Collected deterministic project-aware evidence packs.', {
      assumptions,
      evidence: asArray(projectEvidence.citations).slice(0, 10),
      confidence: 0.67
    }));
    toolTrace.push({
      tool: 'project_evidence_aggregator',
      args: {
        project_id: cleanText(projectEvidence?.selected_project?.id, 80),
        project_name: cleanText(projectEvidence?.selected_project?.name, 180)
      },
      summary: cleanText(assumptions.join(' '), 240)
    });
    evidence.push(...asArray(projectEvidence.citations));
  }

  const paperEvidence = maybeCollectPaperEvidence({
    message,
    routing: routingInfo,
    snapshot
  });
  if (paperEvidence) {
    const assumptions = buildPaperEvidenceAssumptionRows(paperEvidence);
    intermediateStates.push(buildIntermediateState('paper_evidence', 'Collected deterministic paper evidence packs.', {
      assumptions,
      evidence: asArray(paperEvidence.citations).slice(0, 10),
      confidence: 0.66
    }));
    toolTrace.push({
      tool: 'paper_evidence_aggregator',
      args: {
        mode: cleanText(routingInfo.plan.paper_task_mode, 80),
        selected_paper_id: cleanText(routingInfo.plan.paper_match?.selected_paper_id, 80),
        selected_paper_title: cleanText(routingInfo.plan.paper_match?.selected_paper_title, 220)
      },
      summary: cleanText(assumptions.join(' '), 240)
    });
    evidence.push(...asArray(paperEvidence.citations));
  }

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
  const notebookDraft = maybeBuildNotebookDraft({
    message,
    conversation: promptConversation,
    routing: routingInfo,
    snapshot,
    projectId,
    projectName,
    toolResults: collected.contextSlices.map((slice) => ({
      tool: slice.tool,
      items: asArray(slice.items),
      summary: ''
    }))
  });

  if (notebookDraft) {
    intermediateStates.push(buildIntermediateState('notebook_draft', 'Generated deterministic notebook draft metadata.', {
      assumptions: buildNotebookDraftAssumptionRows(notebookDraft),
      confidence: asArray(notebookDraft.unresolved_placeholders).length ? 0.62 : 0.74
    }));
  }

  const systemPrompt = buildAgentSystemPrompt(projectName, promptConfig);
  const draftPrompt = [
    systemPrompt,
    'Task: answer the latest user request using only the retrieved Enana context below. If context is missing, explicitly say what is missing.',
    `Conversation transcript:\n${toPromptConversationTranscript(promptConversation)}`,
    `Routing decision JSON:\n${cleanText(JSON.stringify(routingInfo, null, 2), 10000)}`,
    ...(projectEvidence
      ? [`Project evidence JSON:\n${cleanText(JSON.stringify(projectEvidence, null, 2), 24000)}`]
      : []),
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
  if (notebookDraft) {
    const summary = buildNotebookDraftSummary(notebookDraft);
    if (summary) {
      normalized.answer = cleanText(`${normalized.answer}\n\n${summary}`, 12000);
    }
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
    ...(notebookDraft ? { notebookDraft } : {}),
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
  const projectId = cleanText(payload?.projectId, 80);
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
    toolContract: AGENT_TOOL_REGISTRY,
    writeIntent: containsWriteIntent(message),
    selectedProjectId: projectId,
    selectedProjectName: projectName
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
      snapshot,
      writeIntent: containsWriteIntent(message),
      availableToolNames,
      toolContract: AGENT_TOOL_REGISTRY,
      selectedProjectId: projectId,
      selectedProjectName: projectName
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
      projectId,
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
      `Context sizes: projects=${snapshot.projects.length}, protocols=${snapshot.protocols.length}, workflows=${snapshot.workflows.length}, notebook_entries=${snapshot.notebookEntries.length}, assays=${snapshot.assays.length}, gel_analyses=${snapshot.gelAnalyses.length}, papers=${snapshot.papers.length}.`
    ],
    confidence: 0.52
  }));

  intermediateStates.push(buildIntermediateState('route', `Resolved routing intent "${routing.intent}".`, {
    assumptions: buildRoutingAssumptionRows(routing),
    proposedActions: asArray(routing.plan.tool_selection_rationale).slice(0, 5).map((row) => ({
      action_type: 'read',
      tool_name: row.tool,
      risk_level: 'low',
      reason: `selector score=${Number(row.score) || 0}; ${cleanText(row.reason, 180)}`
    })),
    confidence: routing.confidence
  }));

  const projectEvidence = maybeCollectProjectEvidence({
    message,
    routing,
    snapshot,
    projectId,
    projectName
  });
  if (projectEvidence) {
    const assumptions = buildProjectEvidenceAssumptionRows(projectEvidence);
    intermediateStates.push(buildIntermediateState('project_evidence', 'Collected deterministic project-aware evidence packs.', {
      assumptions,
      evidence: asArray(projectEvidence.citations).slice(0, 10),
      confidence: 0.67
    }));
    toolTrace.push({
      tool: 'project_evidence_aggregator',
      args: {
        project_id: cleanText(projectEvidence?.selected_project?.id, 80),
        project_name: cleanText(projectEvidence?.selected_project?.name, 180)
      },
      summary: cleanText(assumptions.join(' '), 240)
    });
    evidence.push(...asArray(projectEvidence.citations));
  }

  const paperEvidence = maybeCollectPaperEvidence({
    message,
    routing,
    snapshot
  });
  if (paperEvidence) {
    const assumptions = buildPaperEvidenceAssumptionRows(paperEvidence);
    intermediateStates.push(buildIntermediateState('paper_evidence', 'Collected deterministic paper evidence packs.', {
      assumptions,
      evidence: asArray(paperEvidence.citations).slice(0, 10),
      confidence: 0.66
    }));
    toolTrace.push({
      tool: 'paper_evidence_aggregator',
      args: {
        mode: cleanText(routing.plan.paper_task_mode, 80),
        selected_paper_id: cleanText(routing.plan.paper_match?.selected_paper_id, 80),
        selected_paper_title: cleanText(routing.plan.paper_match?.selected_paper_title, 220)
      },
      summary: cleanText(assumptions.join(' '), 240)
    });
    evidence.push(...asArray(paperEvidence.citations));
  }

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
      notebookToolResults.push({
        tool: call.name,
        items: asArray(toolResult.items),
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

  const notebookDraft = maybeBuildNotebookDraft({
    message,
    conversation: promptConversation,
    routing,
    snapshot,
    projectId,
    projectName,
    toolResults: notebookToolResults
  });
  if (notebookDraft) {
    intermediateStates.push(buildIntermediateState('notebook_draft', 'Generated deterministic notebook draft metadata.', {
      assumptions: buildNotebookDraftAssumptionRows(notebookDraft),
      confidence: asArray(notebookDraft.unresolved_placeholders).length ? 0.62 : 0.74
    }));
  }

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
  if (notebookDraft) {
    const summary = buildNotebookDraftSummary(notebookDraft);
    if (summary) {
      normalized.answer = cleanText(`${normalized.answer}\n\n${summary}`, 12000);
    }
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
    ...(notebookDraft ? { notebookDraft } : {}),
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
