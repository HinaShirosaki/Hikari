'use strict';

const { LLM, TELEGRAM, SYSTEM } = require('../../shared/ipc/channels');

function registerSystemIpc(deps = {}) {
  const ipcMain = deps.ipcMain;
  const shell = deps.shell || null;
  const launchCodexCliLogin = deps.launchCodexCliLogin;
  const clearCodexCliStoredLogin = deps.clearCodexCliStoredLogin;
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
  const directLlmRegistry = deps.directLlmRegistry && typeof deps.directLlmRegistry === 'object'
    ? deps.directLlmRegistry
    : null;
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

  ipcMain.handle(LLM.CODEX_STATUS, async () => {
    const status = await getCodexLoginStatus({ cwd: getCodexCliWorkingDirectory(), forceRefresh: true });
    return {
      ok: status.ok === true,
      loggedIn: status.loggedIn === true,
      source: cleanText(status.source, 80) || 'none',
      expired: status.expired === true,
      sourcePath: cleanText(status.sourcePath, 2400),
      message: status.message || ''
    };
  });

  ipcMain.handle(LLM.CODEX_LOGIN, async () => {
    if (typeof launchCodexCliLogin !== 'function') {
      return { ok: false, error: 'Codex login is unavailable.' };
    }
    try {
      const result = await launchCodexCliLogin({ cwd: getCodexCliWorkingDirectory() });
      if (result?.loginUrl && shell && typeof shell.openExternal === 'function') {
        await shell.openExternal(result.loginUrl);
      }
      return {
        ok: result?.ok !== false,
        launched: result?.launched !== false,
        loginUrl: cleanText(result?.loginUrl, 2400),
        message: cleanText(result?.message, 2400) || 'OpenAI login opened for Codex.'
      };
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400) || 'Failed to start Codex login.'
      };
    }
  });

  ipcMain.handle(LLM.CODEX_CLEAR_LOGIN, async () => {
    if (typeof clearCodexCliStoredLogin !== 'function') {
      return { ok: false, error: 'Codex login reset is unavailable.' };
    }
    try {
      const result = await clearCodexCliStoredLogin({ cwd: getCodexCliWorkingDirectory() });
      const status = await getCodexLoginStatus({ cwd: getCodexCliWorkingDirectory(), forceRefresh: true });
      return {
        ok: result?.ok !== false,
        clearedPaths: Array.isArray(result?.clearedPaths)
          ? result.clearedPaths.map((entry) => cleanText(entry, 2400)).filter(Boolean)
          : [],
        hasEnvironmentToken: result?.hasEnvironmentToken === true,
        message: cleanText(result?.message, 2400),
        status: {
          ok: status.ok === true,
          loggedIn: status.loggedIn === true,
          source: cleanText(status.source, 80) || 'none',
          expired: status.expired === true,
          sourcePath: cleanText(status.sourcePath, 2400),
          message: cleanText(status.message, 2400)
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400) || 'Failed to clear saved Codex login.'
      };
    }
  });

  ipcMain.handle(LLM.CODEX_CATALOG, async () => {
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

  ipcMain.handle(LLM.CODEX_SET_MODEL, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const previousModel = getCodexCliModel();
    const model = setCodexCliModel(cleanText(normalizedPayload?.model, 120));
    return {
      ok: true,
      model,
      previousModel
    };
  });

  ipcMain.handle(LLM.CODEX_SET_REASONING_EFFORT, async (_event, payload) => {
    const normalizedPayload = normalizeJsonPayload(payload, {});
    const previousReasoningEffort = getCodexCliReasoningEffort();
    const reasoningEffort = setCodexCliReasoningEffort(cleanText(normalizedPayload?.reasoningEffort, 40));
    return {
      ok: true,
      reasoningEffort,
      previousReasoningEffort
    };
  });

  ipcMain.handle(LLM.CODEX_GENERATE, async (_event, payload) => {
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

  ipcMain.handle(LLM.DIRECT_MODULES, async () => {
    if (!directLlmRegistry || typeof directLlmRegistry.listModules !== 'function') {
      return {
        ok: false,
        modules: [],
        error: 'Direct LLM module registry is unavailable.'
      };
    }
    return {
      ok: true,
      modules: directLlmRegistry.listModules()
    };
  });

  ipcMain.handle(LLM.DIRECT_GENERATE, async (_event, payload) => {
    if (!directLlmRegistry || typeof directLlmRegistry.requestModuleLlm !== 'function') {
      return {
        ok: false,
        error: 'Direct LLM module registry is unavailable.'
      };
    }
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      return await directLlmRegistry.requestModuleLlm(normalizedPayload);
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400) || 'Direct LLM request failed.'
      };
    }
  });

  ipcMain.handle(TELEGRAM.GET_CONFIG, async () => {
    const state = getTelegramState();
    return {
      ok: true,
      enabled: state.enabled === true,
      source: cleanText(state.source, 80) || 'none',
      hasSavedToken: state.hasSavedToken === true
    };
  });

  ipcMain.handle(TELEGRAM.SET_TOKEN, async (_event, payload) => {
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

  ipcMain.handle(TELEGRAM.CLEAR_TOKEN, async () => {
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

  ipcMain.handle(SYSTEM.OPEN_EXTERNAL_URL, async (_event, payload) => {
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
