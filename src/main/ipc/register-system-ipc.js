'use strict';

const { LLM, SYSTEM } = require('../../shared/ipc/channels');

function registerSystemIpc(deps = {}) {
  const ipcMain = deps.ipcMain;
  const shell = deps.shell || null;
  const launchCodexCliLogin = deps.launchCodexCliLogin;
  const clearCodexCliStoredLogin = deps.clearCodexCliStoredLogin;
  const getCodexLoginStatus = deps.getCodexLoginStatus;
  const requestCodexCliUsage = deps.requestCodexCliUsage;
  const requestCodexCliCatalog = typeof deps.requestCodexCliCatalog === 'function'
    ? deps.requestCodexCliCatalog
    : (async () => ({ ok: false, models: [], defaultModel: '', defaultReasoningEffort: '' }));
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
  const errorReporting = deps.errorReporting || null;
  const updater = deps.updater || null;
  const getCodexDesktopMcpSetupPrompt = typeof deps.getCodexDesktopMcpSetupPrompt === 'function'
    ? deps.getCodexDesktopMcpSetupPrompt
    : null;
  const directLlmRegistry = deps.directLlmRegistry && typeof deps.directLlmRegistry === 'object'
    ? deps.directLlmRegistry
    : null;
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, _maxLength = 2400) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      return text;
    });
  const thirdPartyNoticesPath = cleanText(deps.thirdPartyNoticesPath, 2400);

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
      canRefresh: status.canRefresh === true,
      sourcePath: cleanText(status.sourcePath, 2400),
      message: status.message || '',
      cliAvailable: status.cliAvailable,
      cliPath: cleanText(status.cliPath, 2400),
      cliVersion: cleanText(status.cliVersion, 80),
      cliUpdateStatus: cleanText(status.cliUpdateStatus, 80),
      cliUpdateError: cleanText(status.cliUpdateError, 400),
      cliMessage: cleanText(status.cliMessage, 2400),
      cliInstallCommand: cleanText(status.cliInstallCommand, 2400),
      cliInstallShell: cleanText(status.cliInstallShell, 80)
    };
  });

  ipcMain.handle(LLM.CODEX_USAGE, async () => {
    if (typeof requestCodexCliUsage !== 'function') {
      return { ok: false, error: 'Codex account usage is unavailable.' };
    }
    try {
      return await requestCodexCliUsage({ cwd: getCodexCliWorkingDirectory() });
    } catch (error) {
      return { ok: false, error: cleanText(error?.message, 400) || 'Failed to load Codex account usage.' };
    }
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
          canRefresh: status.canRefresh === true,
          cliAvailable: status.cliAvailable,
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
    // Asked from Codex each time: no Codex, no login, or no network means no list,
    // and Settings then offers only "Use the default model".
    const catalog = await requestCodexCliCatalog().catch((error) => ({
      ok: false, error: cleanText(error?.message || error, 400), models: []
    }));
    return {
      ok: catalog.ok === true,
      error: catalog.error || '',
      defaultModel: cleanText(catalog.defaultModel, 120),
      defaultReasoningEffort: cleanText(catalog.defaultReasoningEffort, 40),
      currentModel: cleanText(getCodexCliModel(), 120),
      currentReasoningEffort: cleanText(getCodexCliReasoningEffort(), 40),
      // Hidden models (Codex's own picker hides them) stay valid for a saved choice.
      models: Array.isArray(catalog.models)
        ? catalog.models.filter((entry) => !entry?.hidden).map((entry) => ({
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

  ipcMain.handle(LLM.CODEX_DESKTOP_MCP_PROMPT, async (_event, payload) => {
    if (!getCodexDesktopMcpSetupPrompt) {
      return { ok: false, error: 'Codex Desktop MCP setup is unavailable.' };
    }
    try {
      const normalizedPayload = normalizeJsonPayload(payload, {});
      return await getCodexDesktopMcpSetupPrompt({
        storagePath: cleanText(normalizedPayload?.storagePath, 2400),
        dataFilePath: cleanText(normalizedPayload?.dataFilePath, 2400)
      });
    } catch (error) {
      return {
        ok: false,
        error: cleanText(error?.message || error, 2400)
          || 'Failed to prepare the Codex Desktop MCP setup prompt.'
      };
    }
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

  ipcMain.on(SYSTEM.REPORT_ERROR, (_event, payload) => {
    errorReporting?.reportFromRenderer?.(normalizeJsonPayload(payload, {}));
  });

  ipcMain.handle(SYSTEM.OPEN_LOGS_FOLDER, async () => {
    const logPath = cleanText(errorReporting?.logPath, 2400);
    if (!logPath || !shell || typeof shell.openPath !== 'function') {
      return { ok: false, error: 'Logs folder is unavailable.' };
    }
    const folder = require('node:path').dirname(logPath);
    await require('node:fs/promises').mkdir(folder, { recursive: true }).catch(() => {});
    const error = await shell.openPath(folder);
    return error ? { ok: false, error: cleanText(error, 2400) } : { ok: true, path: folder };
  });

  ipcMain.handle(SYSTEM.OPEN_THIRD_PARTY_NOTICES, async () => {
    if (!thirdPartyNoticesPath || !shell || typeof shell.openPath !== 'function') {
      return { ok: false, error: 'Third-party notices are unavailable.' };
    }
    const error = await shell.openPath(thirdPartyNoticesPath);
    return error ? { ok: false, error: cleanText(error, 2400) } : { ok: true, path: thirdPartyNoticesPath };
  });

  // Settings > Updates. Install resolves only when the build fails (the app
  // restarts on success); the renderer shows 'installing' meanwhile.
  const noUpdater = { configured: false, status: 'not-configured', error: '' };
  ipcMain.handle(SYSTEM.UPDATE_STATUS, async () => updater?.getStatus() || noUpdater);
  ipcMain.handle(SYSTEM.CHECK_FOR_UPDATES, async () => (updater ? updater.checkForUpdates({ prompt: false }) : noUpdater));
  ipcMain.handle(SYSTEM.INSTALL_UPDATE, async () => (updater ? updater.installUpdate() : noUpdater));

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
