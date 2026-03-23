'use strict';

function registerSystemIpc(deps = {}) {
  const ipcMain = deps.ipcMain;
  const getCodexLoginStatus = deps.getCodexLoginStatus;
  const setCodexCliModel = deps.setCodexCliModel;
  const getCodexCliModel = deps.getCodexCliModel;
  const requestCodexCliText = deps.requestCodexCliText;
  const getCodexCliWorkingDirectory = deps.getCodexCliWorkingDirectory;
  const restartTelegramBot = deps.restartTelegramBot;
  const getTelegramState = typeof deps.getTelegramState === 'function'
    ? deps.getTelegramState
    : (() => ({ enabled: false, source: 'none', hasSavedToken: false, savedToken: '' }));
  const writeSavedTelegramToken = deps.writeSavedTelegramToken;
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, maxLength = 2400) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      if (text.length <= maxLength) {
        return text;
      }
      return `${text.slice(0, maxLength)}...`;
    });
  const setSavedTelegramToken = typeof deps.setSavedTelegramToken === 'function'
    ? deps.setSavedTelegramToken
    : (() => {});

  function normalizeJsonPayload(payload, fallback = {}) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload;
    }
    try {
      const parsed = JSON.parse(String(payload || ''));
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  ipcMain.handle('llm:codex-status', async () => {
    const status = await getCodexLoginStatus({ cwd: getCodexCliWorkingDirectory(), forceRefresh: true });
    return {
      ok: status.ok === true,
      loggedIn: status.loggedIn === true,
      message: status.message || ''
    };
  });

  ipcMain.handle('llm:codex-set-model', async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const previousModel = getCodexCliModel();
    const model = setCodexCliModel(cleanText(normalizedPayload?.model, 120));
    return {
      ok: true,
      model,
      previousModel
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
    const state = getTelegramState();
    return {
      ok: true,
      enabled: state.enabled === true,
      source: cleanText(state.source, 80) || 'none',
      hasSavedToken: state.hasSavedToken === true
    };
  });

  ipcMain.handle('telegram:set-token', async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const token = typeof normalizedPayload?.token === 'string' ? normalizedPayload.token.trim() : '';
    if (!token) {
      return { ok: false, error: 'Token is required.' };
    }

    try {
      setSavedTelegramToken(token);
      await writeSavedTelegramToken(token);
      restartTelegramBot();
      const state = getTelegramState();
      return {
        ok: true,
        enabled: state.enabled === true,
        source: cleanText(state.source, 80) || 'none',
        hasSavedToken: state.hasSavedToken === true
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  ipcMain.handle('telegram:clear-token', async () => {
    try {
      setSavedTelegramToken('');
      await writeSavedTelegramToken('');
      restartTelegramBot();
      const state = getTelegramState();
      return {
        ok: true,
        enabled: state.enabled === true,
        source: cleanText(state.source, 80) || 'none',
        hasSavedToken: false
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
}

module.exports = {
  registerSystemIpc
};
