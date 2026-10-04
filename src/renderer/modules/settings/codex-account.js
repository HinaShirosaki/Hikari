import {
  DEFAULT_AGENT_LLM_PROVIDER as DEFAULT_LLM_PROVIDER
} from '../codex-model-catalog.generated.js';
import { normalizeCodexLoginStatus } from './llm-model-catalog.js';
import { showTransientNotice } from '../../lib/notify.js';
import { isCodexConnected, setAgentAvailability } from '../../lib/agent-availability.js';
import { createCodexUsageSettings } from './codex-usage.js';

// Codex account panel: login status polling, the login/logout flow, the desktop
// MCP prompt, and saving the LLM provider/model selection.
function createCodexAccountSettings({
  state,
  persist,
  llmModelCatalog,
  renderForms,
  renderReasoningEffortOptions,
  settingCodexStatus,
  settingCodexUsage,
  settingCodexUsageStatus,
  refreshCodexUsageBtn,
  settingCodexInstall,
  settingCodexInstallCommand,
  settingCodexInstallHelp,
  copyCodexInstallCommandBtn,
  checkCodexCliBtn,
  settingCodexAuthControls,
  settingCodexDesktopMcpStatus,
  settingModel,
  settingReasoningEffort,
  startCodexLoginBtn,
  clearCodexLoginBtn,
  copyCodexDesktopMcpPromptBtn,
  settingCodexDesktopPreview,
  settingCodexDesktopPrompt
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
  let codexStatusRevision = 0;
  let clearingCodexLogin = false;
  const usage = createCodexUsageSettings({ settingCodexUsage, settingCodexUsageStatus,
    refreshCodexUsageBtn, isConnected: () => !clearingCodexLogin && isCodexConnected(codexLoginConfig) });

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
    const connected = isCodexConnected(codexLoginConfig);
    if (startCodexLoginBtn) {
      startCodexLoginBtn.hidden = connected;
      startCodexLoginBtn.disabled = codexLoginConfig.cliAvailable === false;
    }
    if (clearCodexLoginBtn) {
      clearCodexLoginBtn.hidden = !codexLoginConfig.loggedIn && codexLoginConfig.source !== 'stored';
      clearCodexLoginBtn.disabled = codexLoginConfig.source === 'env';
      clearCodexLoginBtn.textContent = connected ? 'Sign out' : 'Clear saved login';
    }

    const cliMissing = codexLoginConfig.cliAvailable === false;
    if (settingCodexInstall) settingCodexInstall.hidden = !cliMissing;
    if (settingCodexInstallCommand) settingCodexInstallCommand.value = codexLoginConfig.cliInstallCommand || '';
    if (copyCodexInstallCommandBtn) copyCodexInstallCommandBtn.disabled = !codexLoginConfig.cliInstallCommand;
    if (settingCodexInstallHelp) {
      settingCodexInstallHelp.textContent = `Run this command in ${codexLoginConfig.cliInstallShell || 'your terminal'} to install Codex CLI. Then click Check again and sign in with OpenAI. For a custom install location, restart Hikari after updating PATH or set HIKARI_CODEX_CLI to the executable path.`;
    }
    if (cliMissing) {
      settingCodexStatus.textContent = codexLoginConfig.cliMessage || 'Codex CLI was not found on this computer.';
      return;
    }

    const override = String(overrideMessage || '').trim();
    if (override) {
      settingCodexStatus.textContent = `OpenAI account: ${override}`;
      return;
    }

    if (connected) {
      settingCodexStatus.textContent = codexLoginConfig.source === 'env'
        ? 'OpenAI account: connected through an environment token.'
        : 'OpenAI account: connected.';
      if (codexLoginConfig.cliVersion) {
        settingCodexStatus.textContent += ` Codex CLI ${codexLoginConfig.cliVersion}; updates automatically.`;
      }
      if (codexLoginConfig.cliUpdateError) {
        settingCodexStatus.textContent += ` Automatic update failed: ${codexLoginConfig.cliUpdateError}`;
      }
      return;
    }

    if (codexLoginConfig.source === 'login_in_progress') {
      settingCodexStatus.textContent = 'OpenAI account: sign-in is in progress in your browser.';
      return;
    }

    if (codexLoginConfig.expired) {
      settingCodexStatus.textContent = 'OpenAI account: current session expired. Sign in with OpenAI again.';
      return;
    }

    if (codexLoginConfig.source === 'stored') {
      settingCodexStatus.textContent = 'OpenAI account: stored credentials were found, but they are not usable right now. Sign in again or clear them.';
      return;
    }

    settingCodexStatus.textContent = 'OpenAI account: not connected. Sign in to use Codex in Hikari.';
  }

  async function refreshCodexLoginStatus() {
    if (clearingCodexLogin) return codexLoginConfig;
    const revision = ++codexStatusRevision;
    if (!window.hikariApi?.getCodexLlmStatus) {
      codexLoginConfig = normalizeCodexLoginStatus({ ...codexLoginConfig, ok: false, loggedIn: false, canRefresh: false });
      setAgentAvailability(false);
      usage.clear();
      renderCodexStatus('Codex login is unavailable.');
      showTransientNotice('Codex login is unavailable.', { type: 'error' });
      return codexLoginConfig;
    }
    if (checkCodexCliBtn) checkCodexCliBtn.disabled = true;
    try {
      const result = await window.hikariApi.getCodexLlmStatus();
      if (revision !== codexStatusRevision) return codexLoginConfig;
      const previousStatus = codexLoginConfig;
      codexLoginConfig = normalizeCodexLoginStatus(result);
      setAgentAvailability(isCodexConnected(codexLoginConfig));
      renderCodexStatus();
      if (isCodexConnected(codexLoginConfig)) void usage.refresh();
      else usage.clear();
      if (isCodexConnected(codexLoginConfig)
        && (!isCodexConnected(previousStatus) || previousStatus.cliVersion !== codexLoginConfig.cliVersion
          || !llmModelCatalog?.hasCodexModels?.())) {
        await refreshCodexCatalog();
      }
      return codexLoginConfig;
    } catch {
      if (revision !== codexStatusRevision) return codexLoginConfig;
      codexLoginConfig = normalizeCodexLoginStatus({ ...codexLoginConfig, ok: false, loggedIn: false, canRefresh: false });
      setAgentAvailability(false);
      usage.clear();
      renderCodexStatus('Failed to load Codex login status.');
      showTransientNotice('Failed to load Codex login status.', { type: 'error' });
      return codexLoginConfig;
    } finally {
      if (checkCodexCliBtn && revision === codexStatusRevision) checkCodexCliBtn.disabled = false;
    }
  }

  async function startCodexLoginFlow() {
    const status = await refreshCodexLoginStatus();
    if (status.cliAvailable === false) return { ok: false };
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
    if (clearingCodexLogin) return;
    clearCodexLoginRefreshTimers();
    if (!window.hikariApi?.clearCodexLlmLogin) {
      renderCodexStatus('Codex login reset is unavailable.');
      showTransientNotice('Codex login reset is unavailable.', { type: 'error' });
      return;
    }

    // Invalidate earlier checks and keep focus/poll refreshes out of this transition.
    codexStatusRevision += 1;
    clearingCodexLogin = true;
    usage.clear('Signing out…');
    if (checkCodexCliBtn) checkCodexCliBtn.disabled = true;
    try {
      const result = await window.hikariApi.clearCodexLlmLogin();
      if (!result?.ok) {
        renderCodexStatus(result?.error || 'Failed to clear the saved Codex login.');
        showTransientNotice(result?.error || 'Failed to clear the saved Codex login.', { type: 'error' });
        return;
      }

      codexLoginConfig = normalizeCodexLoginStatus(result?.status);
      setAgentAvailability(isCodexConnected(codexLoginConfig));
      renderCodexStatus(result?.message || 'Cleared the saved Codex login.');
    } catch {
      renderCodexStatus('Failed to clear the saved Codex login.');
      showTransientNotice('Failed to clear the saved Codex login.', { type: 'error' });
    } finally {
      clearingCodexLogin = false;
      if (isCodexConnected(codexLoginConfig)) void usage.refresh();
      else usage.clear();
      if (checkCodexCliBtn) checkCodexCliBtn.disabled = false;
    }
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

  async function onCopyCodexInstallCommand() {
    try {
      const copied = await copyTextToClipboard(codexLoginConfig.cliInstallCommand);
      showTransientNotice(copied ? 'Install command copied.' : 'Could not copy the install command. Select and copy it manually.', { type: copied ? 'success' : 'error' });
    } catch {
      showTransientNotice('Could not copy the install command. Select and copy it manually.', { type: 'error' });
    }
  }

  let preparingDesktopPrompt = null;

  async function prepareDesktopPrompt() {
    if (preparingDesktopPrompt) return preparingDesktopPrompt;
    preparingDesktopPrompt = (async () => {
      const storagePath = String(state.settings?.storagePath || '').trim();
      let dataFilePath = '';
      if (storagePath && window.hikariApi?.autoSaveDataFile) {
        const syncResult = await window.hikariApi.autoSaveDataFile(state, '');
        dataFilePath = String(syncResult?.filePath || '').trim();
      }
      if (!window.hikariApi?.getCodexDesktopMcpSetupPrompt) {
        throw new Error('Codex Desktop setup is unavailable.');
      }
      const result = await window.hikariApi.getCodexDesktopMcpSetupPrompt({ storagePath, dataFilePath });
      if (!result?.ok || !result.prompt) {
        throw new Error(result?.error || 'Hikari could not prepare the setup instructions.');
      }
      if (settingCodexDesktopPrompt) settingCodexDesktopPrompt.value = result.prompt;
      return result.prompt;
    })();
    try {
      return await preparingDesktopPrompt;
    } finally {
      preparingDesktopPrompt = null;
    }
  }

  async function onPreviewCodexDesktopPrompt() {
    if (!settingCodexDesktopPreview?.open) return;
    renderCodexDesktopMcpStatus('Preparing setup instructions…', 'working');
    try {
      await prepareDesktopPrompt();
      renderCodexDesktopMcpStatus();
    } catch (error) {
      renderCodexDesktopMcpStatus(String(error?.message || error), 'error');
    }
  }
  settingCodexDesktopPreview?.addEventListener('toggle', onPreviewCodexDesktopPrompt);

  async function onCopyCodexDesktopMcpPrompt() {
    if (!copyCodexDesktopMcpPromptBtn) return;
    copyCodexDesktopMcpPromptBtn.disabled = true;
    copyCodexDesktopMcpPromptBtn.textContent = 'Preparing…';
    renderCodexDesktopMcpStatus('Preparing live connection…', 'working');
    try {
      const prompt = await prepareDesktopPrompt();
      const copied = await copyTextToClipboard(prompt);
      if (!copied) throw new Error('Could not copy. Open View setup instructions and copy the text manually.');
      copyCodexDesktopMcpPromptBtn.textContent = 'Copied';
      renderCodexDesktopMcpStatus('Paste into a Codex Desktop task and send.', 'success');
    } catch (error) {
      copyCodexDesktopMcpPromptBtn.textContent = 'Copy setup instructions';
      renderCodexDesktopMcpStatus(String(error?.message || error || 'Failed to copy the setup instructions.'), 'error');
    } finally {
      copyCodexDesktopMcpPromptBtn.disabled = false;
    }
  }

  async function syncCodexExecutionSettings() {
    const llm = state.settings?.llm && typeof state.settings.llm === 'object'
      ? state.settings.llm
      : {};
    const requestedModel = String(llm.model || '').trim();
    const requestedReasoningEffort = String(llm.reasoningEffort || '').trim().toLowerCase();
    let appliedModel = requestedModel;

    if (window.hikariApi?.setCodexLlmModel) {
      const result = await window.hikariApi.setCodexLlmModel(requestedModel);
      if (result?.ok === false) {
        throw new Error(result.error || 'Failed to apply the Codex model.');
      }
      appliedModel = String(result?.model || requestedModel).trim();
    }

    const normalizedReasoningEffort = llmModelCatalog.normalizeReasoning(
      DEFAULT_LLM_PROVIDER,
      appliedModel,
      requestedReasoningEffort
    );
    let appliedReasoningEffort = normalizedReasoningEffort;
    if (window.hikariApi?.setCodexLlmReasoningEffort) {
      const result = await window.hikariApi.setCodexLlmReasoningEffort(normalizedReasoningEffort);
      if (result?.ok === false) {
        throw new Error(result.error || 'Failed to apply the Codex reasoning effort.');
      }
      appliedReasoningEffort = String(
        result?.reasoningEffort ?? normalizedReasoningEffort
      ).trim().toLowerCase();
    }

    const changed = appliedModel !== requestedModel
      || appliedReasoningEffort !== requestedReasoningEffort;
    if (changed) {
      state.settings.llm = {
        ...llm,
        provider: DEFAULT_LLM_PROVIDER,
        model: appliedModel,
        reasoningEffort: appliedReasoningEffort
      };
      persist();
    }
    return {
      changed,
      model: appliedModel,
      reasoningEffort: appliedReasoningEffort
    };
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
      const syncResult = await syncCodexExecutionSettings();
      if (syncResult.changed && typeof renderForms === 'function') {
        renderForms();
      }
      const status = await refreshCodexLoginStatus();
      if (!isCodexConnected(status) && status.cliAvailable !== false) {
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
    let catalogChanged = false;
    try {
      if (window.hikariApi?.getCodexLlmCatalog) {
        const result = await window.hikariApi.getCodexLlmCatalog();
        if (result?.ok) {
          llmModelCatalog.setCodexCatalog(result);
          catalogChanged = true;
          if (typeof renderForms === 'function') {
            renderForms();
          }
        }
      }
    } catch {
      // Keep settings available even when the desktop bridge cannot inspect Codex CLI.
    }
    try {
      const syncResult = await syncCodexExecutionSettings();
      if (syncResult.changed && !catalogChanged && typeof renderForms === 'function') {
        renderForms();
      }
    } catch {
      // Agent Chat still passes its model explicitly if startup synchronization fails.
    }
  }

  return {
    clearCodexLoginRefreshTimers,
    scheduleCodexLoginStatusRefresh,
    renderCodexStatus,
    refreshCodexLoginStatus,
    refreshCodexUsage: usage.refresh,
    onStartCodexLogin,
    onClearCodexLogin,
    renderCodexDesktopMcpStatus,
    onCopyCodexDesktopMcpPrompt,
    onPreviewCodexDesktopPrompt,
    onCopyCodexInstallCommand,
    onSaveLlmSettings,
    onModelChanged,
    refreshCodexCatalog,
    syncCodexExecutionSettings
  };
}

export { createCodexAccountSettings };
