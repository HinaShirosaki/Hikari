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
  installPlannotateAssets
} = require('./plannotate-engine');

const appIconPath = path.join(__dirname, 'image.png');
const DEFAULT_DATA_FILE_NAME = 'enana-data.json';
const TELEGRAM_CONFIG_FILE_NAME = 'telegram-bot.json';
const CHEMICALS_DATA_FILE_PATH = path.join(__dirname, 'data', 'chemicals.json');
const LLM_PROVIDERS = Object.freeze({
  OPENAI: 'openai',
  GEMINI: 'gemini',
  CLAUDE: 'claude'
});
const DEFAULT_LLM_PROVIDER = LLM_PROVIDERS.OPENAI;
const DEFAULT_LLM_ENDPOINTS = Object.freeze({
  [LLM_PROVIDERS.OPENAI]: 'https://api.openai.com/v1/responses',
  [LLM_PROVIDERS.GEMINI]: 'https://generativelanguage.googleapis.com/v1beta',
  [LLM_PROVIDERS.CLAUDE]: 'https://api.anthropic.com/v1/messages'
});
const DEFAULT_AGENT_MODELS = Object.freeze({
  [LLM_PROVIDERS.OPENAI]: 'gpt-4.1-mini',
  [LLM_PROVIDERS.GEMINI]: 'gemini-2.5-flash',
  [LLM_PROVIDERS.CLAUDE]: 'claude-3-5-sonnet-latest'
});
const MAX_AGENT_TOOL_ROUNDS = 4;
const LLM_PROMPTS_FILE_PATH = path.join(__dirname, 'data', 'llm-prompts.json');
const DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE =
  'You are Enana Lab Assistant Agent.\n{{projectScope}}\nRespond concisely and avoid fabrication.';
const DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE =
  'Return JSON matching the schema exactly. Do not claim write operations were executed. Write intent detected: {{writeIntent}}.';
let mainWindow = null;
let telegramBot = null;
let savedTelegramToken = '';
let telegramTokenSource = 'none';
let llmPromptsCache = null;
let llmPromptsPromise = null;

function getDefaultDataFilePath() {
  return path.join(app.getPath('userData'), DEFAULT_DATA_FILE_NAME);
}

function getTelegramConfigPath() {
  return path.join(app.getPath('userData'), TELEGRAM_CONFIG_FILE_NAME);
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

ipcMain.handle('ena:save', async (_event, payload) => {
  const { data, filePath } = payload || {};
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
    return { ok: true, filePath: targetPath };
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
    const chemicalsPayload = await readChemicalsFile();
    const data = mergeChemicalsIntoSnapshot(parsed, chemicalsPayload);
    return { ok: true, filePath, data };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('data:auto-save', async (_event, payload) => {
  const { data, filePath } = payload || {};
  if (!data) {
    return { ok: false, error: 'Missing data payload.' };
  }

  const targetPath = normalizeDataFilePath(filePath, getDefaultDataFilePath());

  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const snapshot = data && typeof data === 'object' ? data : {};
    await writeEnaFile(targetPath, snapshot);
    await writeChemicalsFile(snapshot.labInventory);
    return { ok: true, filePath: targetPath };
  } catch (error) {
    return { ok: false, error: String(error), filePath: targetPath };
  }
});

ipcMain.handle('data:auto-load', async (_event, payload) => {
  const targetPath = normalizeDataFilePath(payload?.filePath, getDefaultDataFilePath());

  try {
    const raw = await fs.readFile(targetPath, 'utf8');
    const parsed = JSON.parse(raw);
    const chemicalsPayload = await readChemicalsFile();
    const data = mergeChemicalsIntoSnapshot(parsed, chemicalsPayload);
    return { ok: true, filePath: targetPath, data };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ok: true, filePath: targetPath, data: null };
    }
    return { ok: false, error: String(error), filePath: targetPath };
  }
});

ipcMain.handle('storage:pick-directory', async (_event, payload) => {
  const currentPath = typeof payload?.currentPath === 'string' ? payload.currentPath.trim() : '';
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
  const targetPath = typeof payload?.path === 'string' ? payload.path.trim() : '';
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

ipcMain.handle('plannotate:check-env', async (_event, payload) => {
  try {
    const status = await checkPlannotateEnvironment(payload?.dbDir || '');
    return { ok: true, status };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle('plannotate:annotate', async (_event, payload) => {
  try {
    const result = await annotateWithBlast(payload || {});
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

const AGENT_TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'search_projects',
    description: 'Read project records by semantic keyword or exact term.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 20 }
      },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'search_protocols',
    description: 'Read protocol records, including names and step snippets.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 20 }
      },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'search_notebook_entries',
    description: 'Read notebook entries with result summaries and timestamps.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 20 }
      },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'search_assays',
    description: 'Read assay runs with plate metadata and compact numeric summaries.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 20 }
      },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'search_gel_analyses',
    description: 'Read gel analysis runs with confidence, calibration, and warning summaries.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 20 }
      },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'search_inventory',
    description: 'Read chemical and personal inventory records.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 25 }
      },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'search_papers',
    description: 'Read uploaded paper summaries, methods, and reagent extraction notes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 20 }
      },
      required: ['query']
    }
  }
];

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
    }
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
  return /\b(create|update|edit|delete|remove|reserve|consume|commit|save)\b/i.test(String(text || ''));
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

function runAgentTool(name, args, snapshot) {
  const query = cleanText(args?.query, 300);
  const limit = clamp(Number(args?.limit) || 6, 1, 25);
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

    return {
      items,
      citations: items.map((project) => ({
        source: 'project',
        pointer: project.id || project.name,
        reason: 'Matched project metadata.'
      })),
      summary: `Found ${items.length} matching projects.`
    };
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

    return {
      items,
      citations: items.map((protocol) => ({
        source: 'protocol',
        pointer: protocol.id || protocol.name,
        reason: 'Matched protocol name/steps.'
      })),
      summary: `Found ${items.length} matching protocols.`
    };
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

    return {
      items,
      citations: items.map((entry) => ({
        source: 'notebook_entry',
        pointer: entry.id || entry.protocolName,
        reason: 'Matched notebook summary/results.'
      })),
      summary: `Found ${items.length} matching notebook entries.`
    };
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

    return {
      items,
      citations: items.map((assay) => ({
        source: 'assay',
        pointer: assay.id || assay.name || assay.assay_number,
        reason: 'Matched assay metadata or axis annotations.'
      })),
      summary: `Found ${items.length} matching assays.`
    };
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

    return {
      items,
      citations: items.map((analysis) => ({
        source: 'gel_analysis',
        pointer: analysis.id || analysis.name,
        reason: 'Matched gel metadata, warnings, or confidence fields.'
      })),
      summary: `Found ${items.length} matching gel analyses.`
    };
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

    return {
      items,
      citations: items.map((item) => ({
        source: item.kind || 'inventory',
        pointer: item.id || item.name,
        reason: 'Matched inventory name and metadata.'
      })),
      summary: `Found ${items.length} matching inventory records.`
    };
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

    return {
      items,
      citations: items.map((paper) => ({
        source: 'paper',
        pointer: paper.id || paper.title,
        reason: 'Matched paper title, summary, or extracted methods.'
      })),
      summary: `Found ${items.length} matching papers.`
    };
  }

  return {
    items: [],
    citations: [],
    summary: `Unknown tool: ${name}`
  };
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
  if (endpoint && /^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  return defaultEndpointForProvider(provider);
}

function resolveAgentModel(llm, provider = DEFAULT_LLM_PROVIDER) {
  const model = cleanText(llm?.model, 120);
  return model || DEFAULT_AGENT_MODELS[provider] || DEFAULT_AGENT_MODELS[DEFAULT_LLM_PROVIDER];
}

function buildAgentSystemPrompt(projectName, prompts) {
  const projectScope = projectName ? `Scoped project: ${projectName}.` : 'Scope: all projects.';
  const template = String(prompts?.agent?.systemPromptTemplate || '').trim() || DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE;
  return renderPromptTemplate(template, { projectScope });
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

const CLAUDE_TOOL_DEFINITIONS = AGENT_TOOL_DEFINITIONS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.parameters
}));

const GEMINI_TOOL_DEFINITIONS = [
  {
    functionDeclarations: AGENT_TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }))
  }
];

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
  hasLatestUserInConversation
}) {
  if (provider === LLM_PROVIDERS.CLAUDE) {
    const messages = [
      ...conversation.map((item) => toClaudeMessage(item.role, item.text)),
      ...(hasLatestUserInConversation ? [] : [toClaudeMessage('user', message)])
    ];
    const response = await requestClaudeMessagesWithBackoff({
      endpoint,
      apiKey,
      body: {
        model,
        system: systemPrompt,
        messages,
        tools: CLAUDE_TOOL_DEFINITIONS,
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
      raw: response,
      round: 0
    };
  }

  if (provider === LLM_PROVIDERS.GEMINI) {
    const contents = [
      ...conversation.map((item) => toGeminiContent(item.role, item.text)),
      ...(hasLatestUserInConversation ? [] : [toGeminiContent('user', message)])
    ];
    const response = await requestGeminiGenerateContentWithBackoff({
      endpoint,
      apiKey,
      model,
      body: {
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents,
        tools: GEMINI_TOOL_DEFINITIONS,
        toolConfig: {
          functionCallingConfig: {
            mode: 'AUTO'
          }
        },
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
      tools: AGENT_TOOL_DEFINITIONS,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      max_output_tokens: 1400
    }
  });
  return {
    provider: LLM_PROVIDERS.OPENAI,
    endpoint,
    apiKey,
    model,
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

    const response = await requestClaudeMessagesWithBackoff({
      endpoint: session.endpoint,
      apiKey: session.apiKey,
      body: {
        model: session.model,
        system: session.systemPrompt,
        messages: nextMessages,
        tools: CLAUDE_TOOL_DEFINITIONS,
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

    const response = await requestGeminiGenerateContentWithBackoff({
      endpoint: session.endpoint,
      apiKey: session.apiKey,
      model: session.model,
      body: {
        systemInstruction: {
          parts: [{ text: session.systemPrompt }]
        },
        contents: nextContents,
        tools: GEMINI_TOOL_DEFINITIONS,
        toolConfig: {
          functionCallingConfig: {
            mode: 'AUTO'
          }
        },
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
      tools: AGENT_TOOL_DEFINITIONS,
      tool_choice: 'auto',
      parallel_tool_calls: false,
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

async function runAgentController(payload) {
  const message = cleanText(payload?.message, 3000);
  if (!message) {
    throw new Error('Message is required.');
  }

  const apiKey = resolveAgentApiKey(payload?.llm);
  if (!apiKey) {
    throw new Error('Missing LLM API key. Set it in Settings > LLM Model & API, or use LLM_API_KEY / ENANA_LLM_API_KEY.');
  }

  const provider = resolveAgentProvider(payload?.llm);
  const endpoint = resolveAgentEndpoint(payload?.llm, provider);
  const model = resolveAgentModel(payload?.llm, provider);
  const conversation = extractConversation(payload?.conversation);
  const hasLatestUserInConversation = conversation.length > 0
    && conversation[conversation.length - 1].role === 'user'
    && conversation[conversation.length - 1].text === message;
  const snapshot = normalizeAgentSnapshot(payload?.stateSnapshot);
  const projectName = cleanText(payload?.projectName, 180);
  const promptConfig = await loadLlmPrompts();
  const intermediateStates = [];
  const toolTrace = [];
  const evidence = [];

  intermediateStates.push(buildIntermediateState('intake', message, {
    assumptions: ['User question is interpreted as read-first unless writes are explicitly requested.'],
    openQuestions: containsWriteIntent(message) ? ['User may want a write action; approval is required before any write.'] : [],
    confidence: 0.45
  }));

  intermediateStates.push(buildIntermediateState('context', 'Loaded snapshot context for retrieval tools.', {
    assumptions: [
      `Context sizes: projects=${snapshot.projects.length}, protocols=${snapshot.protocols.length}, notebook_entries=${snapshot.notebookEntries.length}, assays=${snapshot.assays.length}, gel_analyses=${snapshot.gelAnalyses.length}, papers=${snapshot.papers.length}.`
    ],
    confidence: 0.52
  }));

  const systemPrompt = buildAgentSystemPrompt(projectName, promptConfig);
  let session = await startAgentSession({
    provider,
    endpoint,
    apiKey,
    model,
    systemPrompt,
    conversation,
    message,
    hasLatestUserInConversation
  });
  let round = 0;

  while (round < MAX_AGENT_TOOL_ROUNDS) {
    const calls = extractAgentSessionFunctionCalls(session);
    if (!calls.length) {
      break;
    }

    const toolOutputs = [];
    const proposedActions = [];
    calls.slice(0, 4).forEach((call) => {
      const args = safeParseJson(call.argsText, {});
      const toolResult = runAgentTool(call.name, args, snapshot);
      toolOutputs.push({
        callId: call.callId,
        name: call.name,
        output: JSON.stringify(toolResult)
      });
      toolTrace.push({
        tool: call.name,
        args,
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
        action_type: 'read',
        tool_name: call.name,
        risk_level: 'low',
        reason: 'Model-requested read operation.'
      });
    });

    intermediateStates.push(buildIntermediateState('execute', `Executed ${toolOutputs.length} tool calls in round ${round + 1}.`, {
      evidence: evidence.slice(-10),
      proposedActions,
      confidence: 0.62
    }));

    session = await continueAgentSessionWithToolOutputs(session, toolOutputs);

    round += 1;
  }

  const draftAnswer = extractAgentSessionText(session);
  const requiresApproval = containsWriteIntent(message);

  intermediateStates.push(buildIntermediateState('verify', 'Verified evidence coverage and policy constraints.', {
    assumptions: ['Only read tools were executed by policy.'],
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
    assumptions: ['Any write action remains pending explicit approval.'],
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
    intermediateStates,
    toolTrace
  };
}

ipcMain.handle('agent:chat', async (_event, payload) => {
  try {
    return await runAgentController(payload);
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
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
  const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
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
