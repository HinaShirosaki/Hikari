import {
  DEFAULT_AGENT_LLM_PROVIDER as DEFAULT_LLM_PROVIDER
} from '../codex-model-catalog.generated.js';
import { normalizeCodexLoginStatus } from './llm-model-catalog.js';
import { showTransientNotice } from '../../lib/notify.js';

// Codex account panel: login status polling, the login/logout flow, the desktop
// MCP prompt, and saving the LLM provider/model selection.
function createCodexAccountSettings({
  state,
  persist,
  llmModelCatalog,
  renderForms,
  renderReasoningEffortOptions,
  settingCodexStatus,
  settingCodexAuthControls,
  settingCodexDesktopMcpStatus,
  settingModel,
  settingReasoningEffort,
  startCodexLoginBtn,
  clearCodexLoginBtn,
  copyCodexDesktopMcpPromptBtn
} = {}) {
  let codexLoginConfig = {
    ok: false,
    loggedIn: false,
    source: 'none',
    expired: false,
    sourcePath: '',
    message: 'Checking Codex login...'
  };
  let codexLoginRefreshTimers = [];

  function clearCodexLoginRefreshTimers() {
    codexLoginRefreshTimers.forEach((timerId) => {
      clearTimeout(timerId);
    });
    codexLoginRefreshTimers = [];
  }

  function scheduleCodexLoginStatusRefresh(delays = [2500, 7000, 15000]) {
    clearCodexLoginRefreshTimers();
    codexLoginRefreshTimers = delays.map((delay) => setTimeout(() => {
      void refreshCodexLoginStatus();
    }, delay));
  }

  function renderCodexStatus(overrideMessage = '') {
    if (!settingCodexAuthControls || !settingCodexStatus) {
      return;
    }
    settingCodexAuthControls.hidden = false;
    if (startCodexLoginBtn) {
      startCodexLoginBtn.disabled = false;
    }
    if (clearCodexLoginBtn) {
      clearCodexLoginBtn.disabled = false;
    }

    const override = String(overrideMessage || '').trim();
    if (override) {
      settingCodexStatus.textContent = `Codex login: ${override}`;
      return;
    }

    if (codexLoginConfig.loggedIn) {
      settingCodexStatus.textContent = codexLoginConfig.source === 'env'
        ? 'Codex login: connected through an environment token.'
        : 'Codex login: connected and stored for future launches.';
      return;
    }

    if (codexLoginConfig.source === 'login_in_progress') {
      settingCodexStatus.textContent = 'Codex login: sign-in is in progress in your browser.';
      return;
    }

    if (codexLoginConfig.expired) {
      settingCodexStatus.textContent = 'Codex login: current session expired. Save settings or click Login with OpenAI to sign in again.';
      return;
    }

    if (codexLoginConfig.source === 'stored') {
      settingCodexStatus.textContent = 'Codex login: stored credentials were found, but they are not usable right now. Sign in again or clear them.';
      return;
    }

    settingCodexStatus.textContent = 'Codex login: not configured yet. Saving Codex settings will open the OpenAI login flow.';
  }

  async function refreshCodexLoginStatus() {
    if (!window.hikariApi?.getCodexLlmStatus) {
      renderCodexStatus('Codex login is unavailable.');
      showTransientNotice('Codex login is unavailable.', { type: 'error' });
      return codexLoginConfig;
    }
    try {
      const result = await window.hikariApi.getCodexLlmStatus();
      codexLoginConfig = normalizeCodexLoginStatus(result);
      renderCodexStatus();
      return codexLoginConfig;
    } catch {
      renderCodexStatus('Failed to load Codex login status.');
      showTransientNotice('Failed to load Codex login status.', { type: 'error' });
      return codexLoginConfig;
    }
  }

  async function startCodexLoginFlow() {
    if (!window.hikariApi?.loginCodexLlm) {
      renderCodexStatus('Codex login is unavailable.');
      showTransientNotice('Codex login is unavailable.', { type: 'error' });
      return { ok: false };
    }
    try {
      const result = await window.hikariApi.loginCodexLlm();
      if (!result?.ok) {
        renderCodexStatus(result?.error || 'Failed to start the OpenAI login flow.');
        showTransientNotice(result?.error || 'Failed to start the OpenAI login flow.', { type: 'error' });
        return result;
      }
      renderCodexStatus(result?.message || 'OpenAI login opened. Finish the Codex sign-in flow in your browser, then return here.');
      scheduleCodexLoginStatusRefresh();
      return result;
    } catch {
      renderCodexStatus('Failed to start the OpenAI login flow.');
      showTransientNotice('Failed to start the OpenAI login flow.', { type: 'error' });
      return { ok: false };
    }
  }

  async function onStartCodexLogin() {
    await startCodexLoginFlow();
  }

  async function onClearCodexLogin() {
    clearCodexLoginRefreshTimers();
    if (!window.hikariApi?.clearCodexLlmLogin) {
      renderCodexStatus('Codex login reset is unavailable.');
      showTransientNotice('Codex login reset is unavailable.', { type: 'error' });
      return;
    }

    const result = await window.hikariApi.clearCodexLlmLogin();
    if (!result?.ok) {
      renderCodexStatus(result?.error || 'Failed to clear the saved Codex login.');
      showTransientNotice(result?.error || 'Failed to clear the saved Codex login.', { type: 'error' });
      return;
    }

    codexLoginConfig = normalizeCodexLoginStatus(result?.status);
    renderCodexStatus(result?.message || 'Cleared the saved Codex login.');
  }

  function renderCodexDesktopMcpStatus(message = '', stateName = '') {
    if (!settingCodexDesktopMcpStatus) {
      return;
    }
    settingCodexDesktopMcpStatus.textContent = String(message || '').trim();
    settingCodexDesktopMcpStatus.dataset.state = String(stateName || '').trim();
  }

  async function copyTextToClipboard(value = '') {
    const text = String(value || '');
    if (!text) {
      return false;
    }
    if (window.hikariApi?.writeTextToClipboard) {
      const result = await window.hikariApi.writeTextToClipboard(text);
      if (result?.ok) {
        return true;
      }
    }
    const clipboard = window.navigator?.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      return false;
    }
    await clipboard.writeText(text);
    return true;
  }

  async function onCopyCodexDesktopMcpPrompt() {
    if (!copyCodexDesktopMcpPromptBtn) {
      return;
    }
    copyCodexDesktopMcpPromptBtn.disabled = true;
    renderCodexDesktopMcpStatus('Preparing live connection...', 'working');
    try {
      const storagePath = String(state.settings?.storagePath || '').trim();
      let dataFilePath = '';
      if (storagePath && window.hikariApi?.autoSaveDataFile) {
        const syncResult = await window.hikariApi.autoSaveDataFile(state, '');
        dataFilePath = String(syncResult?.filePath || '').trim();
      }
      if (!window.hikariApi?.getCodexDesktopMcpSetupPrompt) {
        throw new Error('Codex Desktop MCP setup is unavailable.');
      }
      const result = await window.hikariApi.getCodexDesktopMcpSetupPrompt({
        storagePath,
        dataFilePath
      });
      if (!result?.ok || !result.prompt) {
        throw new Error(result?.error || 'Hikari could not prepare the setup prompt.');
      }
      const copied = await copyTextToClipboard(result.prompt);
      if (!copied) {
        throw new Error('The text clipboard is unavailable.');
      }
      renderCodexDesktopMcpStatus('Copied. Paste into Codex Desktop.', 'success');
    } catch (error) {
      renderCodexDesktopMcpStatus(
        String(error?.message || error || 'Failed to copy the setup prompt.'),
        'error'
      );
    } finally {
      copyCodexDesktopMcpPromptBtn.disabled = false;
    }
  }

  async function onSaveLlmSettings(event) {
    event.preventDefault();
    const provider = DEFAULT_LLM_PROVIDER;
    const model = llmModelCatalog.normalizeModel(provider, settingModel?.value);
    const reasoningEffort = llmModelCatalog.normalizeReasoning(provider, model, settingReasoningEffort?.value);

    state.settings.llm = {
      provider,
      model,
      reasoningEffort
    };
    persist();

    try {
      await Promise.all([
        window.hikariApi?.setCodexLlmModel
          ? window.hikariApi.setCodexLlmModel(state.settings.llm.model)
          : Promise.resolve(),
        window.hikariApi?.setCodexLlmReasoningEffort
          ? window.hikariApi.setCodexLlmReasoningEffort(state.settings.llm.reasoningEffort)
          : Promise.resolve()
      ]);
      const status = await refreshCodexLoginStatus();
      if (status.loggedIn !== true) {
        await startCodexLoginFlow();
      }
    } catch {
      renderCodexStatus('Failed to start Codex login from settings.');
      showTransientNotice('Failed to start Codex login from settings.', { type: 'error' });
    }
  }

  function onModelChanged() {
    renderReasoningEffortOptions(DEFAULT_LLM_PROVIDER, settingModel?.value || '', settingReasoningEffort?.value);
  }

  async function refreshCodexCatalog() {
    if (!window.hikariApi?.getCodexLlmCatalog) {
      return;
    }
    try {
      const result = await window.hikariApi.getCodexLlmCatalog();
      if (!result?.ok) {
        return;
      }
      llmModelCatalog.setCodexCatalog(result);
      renderForms();
    } catch {
      // Keep settings available even when the desktop bridge cannot inspect Codex CLI.
    }
  }

  return {
    clearCodexLoginRefreshTimers,
    scheduleCodexLoginStatusRefresh,
    renderCodexStatus,
    refreshCodexLoginStatus,
    onStartCodexLogin,
    onClearCodexLogin,
    renderCodexDesktopMcpStatus,
    onCopyCodexDesktopMcpPrompt,
    onSaveLlmSettings,
    onModelChanged,
    refreshCodexCatalog
  };
}

export { createCodexAccountSettings };
