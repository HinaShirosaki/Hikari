const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const startTelegramBot = require('./telegramBot');
const {
  hasSupportedDataExtension,
  normalizeDataFilePath
} = require('./main-utils');

const appIconPath = path.join(__dirname, 'image.png');
const DEFAULT_DATA_FILE_NAME = 'enana-data.json';
const TELEGRAM_CONFIG_FILE_NAME = 'telegram-bot.json';
let mainWindow = null;
let telegramBot = null;
let savedTelegramToken = '';
let telegramTokenSource = 'none';

function getDefaultDataFilePath() {
  return path.join(app.getPath('userData'), DEFAULT_DATA_FILE_NAME);
}

function getTelegramConfigPath() {
  return path.join(app.getPath('userData'), TELEGRAM_CONFIG_FILE_NAME);
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
    await writeEnaFile(targetPath, data);
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
    const data = JSON.parse(raw);
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
    await writeEnaFile(targetPath, data);
    return { ok: true, filePath: targetPath };
  } catch (error) {
    return { ok: false, error: String(error), filePath: targetPath };
  }
});

ipcMain.handle('data:auto-load', async (_event, payload) => {
  const targetPath = normalizeDataFilePath(payload?.filePath, getDefaultDataFilePath());

  try {
    const raw = await fs.readFile(targetPath, 'utf8');
    const data = JSON.parse(raw);
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
