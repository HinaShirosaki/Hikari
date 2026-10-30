import "./localization.js";
import { createPresentation } from "../../lib/i18n/presentation.js";
const i18nUi = createPresentation("settings");
import { setSettingsText } from './localization.js';
import {
  DEFAULT_AGENT_LLM_PROVIDER as DEFAULT_LLM_PROVIDER
} from '../codex-model-catalog.generated.js';
import { normalizeCodexLoginStatus } from './llm-model-catalog.js';
import { showTransientNotice } from '../../lib/notify.js';
import { isCodexConnected, setAgentAvailability } from '../../lib/agent-availability.js';
import { createCodexUsageSettings } from './codex-usage.js';
import { syncMarkdownRecordState } from '../../services/markdown-record-storage.js';

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
      i18nUi.setText(clearCodexLoginBtn, (connected ? i18nUi.message("Sign out") : i18nUi.message("Clear saved login")));
    }

    const cliMissing = codexLoginConfig.cliAvailable === false;
    if (settingCodexInstall) settingCodexInstall.hidden = !cliMissing;
    if (settingCodexInstallCommand) settingCodexInstallCommand.value = codexLoginConfig.cliInstallCommand || '';
    if (copyCodexInstallCommandBtn) copyCodexInstallCommandBtn.disabled = !codexLoginConfig.cliInstallCommand;
    if (settingCodexInstallHelp) {
      i18nUi.setText(settingCodexInstallHelp, i18nUi.message("Run this command in {p0} to install Codex CLI. Then click Check again and sign in with OpenAI. For a custom install location, restart Hikari after updating PATH or set HIKARI_CODEX_CLI to the executable path.", { p0: codexLoginConfig.cliInstallShell || 'your terminal' }));
    }
    if (cliMissing) {
      i18nUi.setOwnedText(settingCodexStatus, (codexLoginConfig.cliMessage || i18nUi.message("Codex CLI was not found on this computer.")));
      return;
    }

    const override = String(overrideMessage || '').trim();
    if (override) {
      i18nUi.setOwnedText(settingCodexStatus, i18nUi.message("OpenAI account: {p0}", { p0: override }));
      return;
    }

    if (connected) {
      const identity = [codexLoginConfig.email, codexLoginConfig.planType].filter(Boolean).join(' · ');
      i18nUi.setOwnedText(settingCodexStatus, (codexLoginConfig.source === 'env' ? i18nUi.message("OpenAI account: connected through an environment token.") : i18nUi.message("OpenAI account: connected{p0}.", { p0: identity ? ` (${identity})` : '' })));
      if (codexLoginConfig.cliVersion) {
        i18nUi.appendText(settingCodexStatus, i18nUi.message(" Codex CLI {p0}; updates automatically.", { p0: codexLoginConfig.cliVersion }));
      }
      if (codexLoginConfig.cliUpdateError) {
        i18nUi.appendText(settingCodexStatus, i18nUi.message(" Automatic update failed: {p0}", { p0: codexLoginConfig.cliUpdateError }));
      }
      return;
    }

    if (codexLoginConfig.source === 'login_in_progress') {
      i18nUi.setOwnedText(settingCodexStatus, i18nUi.message("OpenAI account: sign-in is in progress in your browser."));
      return;
    }

    if (codexLoginConfig.expired) {
      i18nUi.setOwnedText(settingCodexStatus, i18nUi.message("OpenAI account: current session expired. Sign in with OpenAI again."));
      return;
    }

    if (codexLoginConfig.source === 'stored') {
      i18nUi.setOwnedText(settingCodexStatus, i18nUi.message("OpenAI account: stored credentials were found, but they are not usable right now. Sign in again or clear them."));
      return;
    }

    i18nUi.setOwnedText(settingCodexStatus, i18nUi.message("OpenAI account: not connected. Sign in to use Codex in Hikari."));
  }

  async function refreshCodexLoginStatus() {
    if (clearingCodexLogin) return codexLoginConfig;
    const revision = ++codexStatusRevision;
    if (!window.hikariApi?.getCodexLlmStatus) {
      codexLoginConfig = normalizeCodexLoginStatus({ ...codexLoginConfig, ok: false, loggedIn: false, canRefresh: false });
      setAgentAvailability(false);
      usage.clear();
      renderCodexStatus(i18nUi.text("Codex login is unavailable."));
      showTransientNotice(i18nUi.message("Codex login is unavailable."), { type: 'error' });
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
          || previousStatus.accountKey !== codexLoginConfig.accountKey || previousStatus.planType !== codexLoginConfig.planType
          || !llmModelCatalog?.hasCodexModels?.())) {
        await refreshCodexCatalog();
      }
      return codexLoginConfig;
    } catch {
      if (revision !== codexStatusRevision) return codexLoginConfig;
      codexLoginConfig = normalizeCodexLoginStatus({ ...codexLoginConfig, ok: false, loggedIn: false, canRefresh: false });
      setAgentAvailability(false);
      usage.clear();
      renderCodexStatus(i18nUi.text("Failed to load Codex login status."));
      showTransientNotice(i18nUi.message("Failed to load Codex login status."), { type: 'error' });
      return codexLoginConfig;
    } finally {
      if (checkCodexCliBtn && revision === codexStatusRevision) checkCodexCliBtn.disabled = false;
    }
  }

  async function startCodexLoginFlow() {
    const status = await refreshCodexLoginStatus();
    if (status.cliAvailable === false) return { ok: false };
    if (!window.hikariApi?.loginCodexLlm) {
      renderCodexStatus(i18nUi.text("Codex login is unavailable."));
      showTransientNotice(i18nUi.message("Codex login is unavailable."), { type: 'error' });
      return { ok: false };
    }
    try {
      const result = await window.hikariApi.loginCodexLlm();
      if (!result?.ok) {
        renderCodexStatus((((((result?.error || i18nUi.text("Failed to start the OpenAI login flow.")))))));
        showTransientNotice((((((result?.error || i18nUi.message("Failed to start the OpenAI login flow.")))))), { type: 'error' });
        return result;
      }
      renderCodexStatus((((((result?.message || i18nUi.text("OpenAI login opened. Finish the Codex sign-in flow in your browser, then return here.")))))));
      scheduleCodexLoginStatusRefresh();
      return result;
    } catch {
      renderCodexStatus(i18nUi.text("Failed to start the OpenAI login flow."));
      showTransientNotice(i18nUi.message("Failed to start the OpenAI login flow."), { type: 'error' });
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
      renderCodexStatus(i18nUi.text("Codex login reset is unavailable."));
      showTransientNotice(i18nUi.message("Codex login reset is unavailable."), { type: 'error' });
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
        renderCodexStatus((((((result?.error || i18nUi.text("Failed to clear the saved Codex login.")))))));
        showTransientNotice((((((result?.error || i18nUi.message("Failed to clear the saved Codex login.")))))), { type: 'error' });
        return;
      }

      codexLoginConfig = normalizeCodexLoginStatus(result?.status);
      setAgentAvailability(isCodexConnected(codexLoginConfig));
      renderCodexStatus((((((result?.message || i18nUi.text("Cleared the saved Codex login.")))))));
    } catch {
      renderCodexStatus(i18nUi.text("Failed to clear the saved Codex login."));
      showTransientNotice(i18nUi.message("Failed to clear the saved Codex login."), { type: 'error' });
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
    i18nUi.setOwnedText(settingCodexDesktopMcpStatus, String(message || '').trim());
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
      showTransientNotice((((((copied ? i18nUi.message("Install command copied.") : i18nUi.message("Could not copy the install command. Select and copy it manually.")))))), { type: copied ? 'success' : 'error' });
    } catch {
      showTransientNotice(i18nUi.message("Could not copy the install command. Select and copy it manually."), { type: 'error' });
    }
  }

  let preparingDesktopPrompt = null;

  async function prepareDesktopPrompt() {
    if (preparingDesktopPrompt) return preparingDesktopPrompt;
    preparingDesktopPrompt = (async () => {
      const storagePath = String(state.settings?.storagePath || '').trim();
      let dataFilePath = '';
      if (storagePath && window.hikariApi?.autoSaveDataFile) {
        const syncResult = await syncMarkdownRecordState(window.hikariApi, state);
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
    renderCodexDesktopMcpStatus(i18nUi.text("Preparing setup instructions…"), 'working');
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
    setSettingsText(copyCodexDesktopMcpPromptBtn, 'codex.preparing');
    renderCodexDesktopMcpStatus(i18nUi.text("Preparing live connection…"), 'working');
    try {
      const prompt = await prepareDesktopPrompt();
      const copied = await copyTextToClipboard(prompt);
      if (!copied) throw new Error('Could not copy. Open View setup instructions and copy the text manually.');
      setSettingsText(copyCodexDesktopMcpPromptBtn, 'codex.copied');
      renderCodexDesktopMcpStatus(i18nUi.text("Paste into a Codex Desktop task and send."), 'success');
    } catch (error) {
      setSettingsText(copyCodexDesktopMcpPromptBtn, 'codex.copySetup');
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
      renderCodexStatus(i18nUi.text("Failed to start Codex login from settings."));
      showTransientNotice(i18nUi.message("Failed to start Codex login from settings."), { type: 'error' });
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
