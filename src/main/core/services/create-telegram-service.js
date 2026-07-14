'use strict';

function createTelegramService({
  fs,
  path,
  processObject,
  startTelegramBot,
  getTelegramConfigPath,
  getMainWindow,
  consoleObject = console
} = {}) {
  let telegramBot = null;
  let savedTelegramToken = '';
  let telegramTokenSource = 'none';

  async function loadSavedTelegramToken() {
    try {
      const raw = await fs.readFile(getTelegramConfigPath(), 'utf8');
      const parsed = JSON.parse(raw);
      return typeof parsed?.token === 'string' ? parsed.token.trim() : '';
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return '';
      }
      consoleObject.error('Failed to read telegram bot config:', error);
      return '';
    }
  }

  async function hydrateSavedTelegramToken() {
    savedTelegramToken = await loadSavedTelegramToken();
    return savedTelegramToken;
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

  function setSavedTelegramToken(token) {
    savedTelegramToken = String(token || '').trim();
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

    const envToken = String(processObject.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (envToken) {
      return { token: envToken, source: 'env' };
    }

    return { token: '', source: 'none' };
  }

  function restartTelegramBot() {
    stopTelegramBot('reconfigure');
    const { token, source } = resolveTelegramBotToken();
    telegramBot = startTelegramBot(getMainWindow, token);
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

  return {
    getTelegramState,
    hydrateSavedTelegramToken,
    restartTelegramBot,
    setSavedTelegramToken,
    stopTelegramBot,
    writeSavedTelegramToken
  };
}

module.exports = {
  createTelegramService
};
