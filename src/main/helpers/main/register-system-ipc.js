'use strict';

function registerSystemIpc(deps = {}) {
  const ipcMain = deps.ipcMain;
  const shell = deps.shell || null;
  const getCodexLoginStatus = deps.getCodexLoginStatus;
  const getCodexCliCatalog = typeof deps.getCodexCliCatalog === 'function'
    ? deps.getCodexCliCatalog
    : (() => ({ ok: false, models: [], defaultModel: '', defaultReasoningEffort: '' }));
  const setCodexCliModel = deps.setCodexCliModel;
  const getCodexCliModel = deps.getCodexCliModel;
  const setCodexCliReasoningEffort = typeof deps.setCodexCliReasoningEffort === 'function'
    ? deps.setCodexCliReasoningEffort
    : (() => '');
  const getCodexCliReasoningEffort = typeof deps.getCodexCliReasoningEffort === 'function'
    ? deps.getCodexCliReasoningEffort
    : (() => '');
  const requestCodexCliText = deps.requestCodexCliText;
  const getCodexCliWorkingDirectory = deps.getCodexCliWorkingDirectory;
  const restartTelegramBot = deps.restartTelegramBot;
  const getTelegramState = typeof deps.getTelegramState === 'function'
    ? deps.getTelegramState
    : (() => ({ enabled: false, source: 'none', hasSavedToken: false, savedToken: '' }));
  const writeSavedTelegramToken = deps.writeSavedTelegramToken;
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, _maxLength = 2400) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      return text;
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

  function normalizeExternalUrl(value) {
    const raw = cleanText(value, 2400);
    if (!raw) {
      return '';
    }
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return '';
      }
      return parsed.toString();
    } catch {
      return '';
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

  ipcMain.handle('llm:codex-catalog', async () => {
    const catalog = getCodexCliCatalog();
    return {
      ok: catalog.ok !== false,
      defaultModel: cleanText(catalog.defaultModel, 120),
      defaultReasoningEffort: cleanText(catalog.defaultReasoningEffort, 40),
      currentModel: cleanText(getCodexCliModel(), 120),
      currentReasoningEffort: cleanText(getCodexCliReasoningEffort(), 40),
      models: Array.isArray(catalog.models)
        ? catalog.models.map((entry) => ({
          id: cleanText(entry?.id, 120),
          label: cleanText(entry?.label, 160) || cleanText(entry?.id, 120),
          reasoningEfforts: Array.isArray(entry?.reasoningEfforts)
            ? entry.reasoningEfforts.map((effort) => cleanText(effort, 40).toLowerCase()).filter(Boolean)
            : [],
          defaultReasoningEffort: cleanText(entry?.defaultReasoningEffort, 40).toLowerCase()
        })).filter((entry) => entry.id)
        : []
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

  ipcMain.handle('llm:codex-set-reasoning-effort', async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const previousReasoningEffort = getCodexCliReasoningEffort();
    const reasoningEffort = setCodexCliReasoningEffort(cleanText(normalizedPayload?.reasoningEffort, 40));
    return {
      ok: true,
      reasoningEffort,
      previousReasoningEffort
    };
  });

  ipcMain.handle('llm:codex-generate', async (_event, payload) => {
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      const promptRaw = typeof normalizedPayload?.prompt === 'string' ? normalizedPayload.prompt.trim() : '';
      if (!promptRaw) {
        return { ok: false, error: 'Prompt is required.' };
      }

      const prompt = promptRaw;
      const model = cleanText(normalizedPayload?.model, 120);
      const reasoningEffort = cleanText(normalizedPayload?.reasoningEffort, 40);
      const fileName = cleanText(normalizedPayload?.fileName, 220);
      const pdfDataUrl = typeof normalizedPayload?.pdfDataUrl === 'string' ? normalizedPayload.pdfDataUrl.trim() : '';

      const text = await requestCodexCliText({
        prompt,
        model,
        reasoningEffort,
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

  ipcMain.handle('system:open-external-url', async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const url = normalizeExternalUrl(normalizedPayload?.url);
    if (!url) {
      return { ok: false, error: 'A valid http(s) URL is required.' };
    }
    if (!shell || typeof shell.openExternal !== 'function') {
      return { ok: false, error: 'External URL opening is unavailable.' };
    }
    try {
      await shell.openExternal(url);
      return { ok: true, url };
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400) || 'Failed to open the external URL.'
      };
    }
  });
}

module.exports = {
  registerSystemIpc
};
