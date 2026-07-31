import {
  DEFAULT_AGENT_LLM_PROVIDER as DEFAULT_LLM_PROVIDER
} from '../codex-model-catalog.generated.js';
import { createExternalSkillsController } from './external-skills-controller.js';
import { createGenomesController } from './genomes-controller.js';
import { createPluginsController } from './plugins-controller.js';
import {
  createLlmModelCatalog,
  normalizeCodexLoginStatus
} from './llm-model-catalog.js';
import { getSettingsElements } from './dom.js';
import { escapeHtml } from './html.js';
import { createSampleInventorySettingsController } from './sample-inventory-controller.js';
import {
  applyAppearanceToDocument,
  normalizeAppearanceMode
} from '../app-state/appearance.js';
import { normalizePreferredJournalList } from '../../lib/preferred-journals.js';


export function initSettings({
  state,
  persist,
  onStoragePathSaved,
  onSampleInventorySettingsChanged,
  document: rootDocument = globalThis?.document || null,
  windowObject = globalThis?.window || null
}) {
  const document = rootDocument;
  const window = windowObject;
  const {
    settingsNavItems,
    settingsPanels,
    appearanceForm,
    settingFontSize,
    settingMode,
    storageForm,
    settingStoragePath,
    selectStoragePathBtn,
    startupForm,
    settingStartupDefaultView,
    settingStartupRememberLastView,
    llmForm,
    settingModel,
    settingModelOptions,
    settingReasoningEffort,
    settingCodexAuthControls,
    settingCodexStatus,
    startCodexLoginBtn,
    clearCodexLoginBtn,
    copyCodexDesktopMcpPromptBtn,
    settingCodexDesktopMcpStatus,
    settingAgentExternalSkillsEnabled,
    settingExternalSkillsRefreshBtn,
    settingExternalSkillsList,
    genomesAddBtn,
    genomesRefreshBtn,
    genomesStatus,
    genomesList,
    pluginsAddBtn,
    pluginsReloadBtn,
    pluginsStatus,
    pluginsList,
    telegramForm,
    settingTelegramToken,
    clearTelegramTokenBtn,
    locationInput,
    locationAddBtn,
    locationList,
    sampleInventoryLocationInput,
    sampleInventoryLocationAddBtn,
    sampleInventoryLocationList,
    sampleTypeLabelsForm,
    sampleTypeAddInput,
    sampleTypeAddBtn,
    sampleTypeLabelList,
    preferredJournalForm,
    settingPreferredJournal,
    preferredJournalList,
    clearPreferredJournalBtn
  } = getSettingsElements(document);
  let codexLoginConfig = {
    ok: false,
    loggedIn: false,
    source: 'none',
    expired: false,
    sourcePath: '',
    message: 'Checking Codex login...'
  };
  const llmModelCatalog = createLlmModelCatalog();
  let codexLoginRefreshTimers = [];
  let activeSettingsPanel = settingsNavItems[0]?.dataset.settingsTarget || 'appearance';
  const externalSkillsController = createExternalSkillsController({
    state,
    persist,
    api: window.hikariApi || null,
    enabledInput: settingAgentExternalSkillsEnabled,
    listElement: settingExternalSkillsList,
    escapeHtml
  });
  const genomesController = createGenomesController({
    api: window.hikariApi || null,
    statusElement: genomesStatus,
    listElement: genomesList,
    escapeHtml
  });
  const pluginsController = createPluginsController({
    state,
    persist,
    api: window.hikariApi || null,
    statusElement: pluginsStatus,
    listElement: pluginsList,
    escapeHtml
  });
  const sampleInventoryController = createSampleInventorySettingsController({
    state,
    persist,
    elements: {
      locationInput,
      locationList,
      sampleInventoryLocationInput,
      sampleInventoryLocationList,
      sampleTypeAddInput,
      sampleTypeLabelList
    },
    escapeHtml,
    renderSettings: renderForms,
    onSettingsChanged: onSampleInventorySettingsChanged
  });

  settingsNavItems.forEach((item) => {
    item.addEventListener('click', () => {
      activateSettingsPanel(item.dataset.settingsTarget);
    });
  });
  appearanceForm.addEventListener('submit', onSaveAppearance);
  storageForm.addEventListener('submit', onSaveStoragePath);
  selectStoragePathBtn?.addEventListener('click', onSelectStoragePath);
  startupForm?.addEventListener('submit', onSaveStartupSettings);
  llmForm.addEventListener('submit', onSaveLlmSettings);
  settingModel?.addEventListener('input', onModelChanged);
  settingModel?.addEventListener('change', onModelChanged);
  startCodexLoginBtn?.addEventListener('click', onStartCodexLogin);
  clearCodexLoginBtn?.addEventListener('click', onClearCodexLogin);
  copyCodexDesktopMcpPromptBtn?.addEventListener('click', () => {
    void onCopyCodexDesktopMcpPrompt();
  });
  settingAgentExternalSkillsEnabled?.addEventListener('change', externalSkillsController.onGlobalEnabledChanged);
  settingExternalSkillsRefreshBtn?.addEventListener('click', () => {
    void externalSkillsController.refresh();
  });
  genomesAddBtn?.addEventListener('click', () => {
    void genomesController.onAddGenome();
  });
  genomesRefreshBtn?.addEventListener('click', () => {
    void genomesController.refresh();
  });
  pluginsAddBtn?.addEventListener('click', () => {
    void pluginsController.onAddPlugin();
  });
  pluginsReloadBtn?.addEventListener('click', () => {
    window.location.reload();
  });
  telegramForm?.addEventListener('submit', onSaveTelegramToken);
  clearTelegramTokenBtn?.addEventListener('click', onClearTelegramToken);
  locationAddBtn.addEventListener('click', sampleInventoryController.onAddLocation);
  sampleInventoryLocationAddBtn?.addEventListener('click', sampleInventoryController.onAddSampleInventoryLocation);
  sampleTypeAddBtn?.addEventListener('click', sampleInventoryController.onAddSampleType);
  sampleTypeAddInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sampleInventoryController.onAddSampleType();
    }
  });
  sampleTypeLabelsForm?.addEventListener('submit', sampleInventoryController.onSaveSampleTypeLabels);
  preferredJournalForm?.addEventListener('submit', onSavePreferredJournal);
  preferredJournalList?.addEventListener('click', onPreferredJournalListClick);
  preferredJournalList?.addEventListener('keydown', onPreferredJournalListKeydown);
  clearPreferredJournalBtn?.addEventListener('click', onClearPreferredJournal);
  window.addEventListener('focus', () => {
    void refreshCodexLoginStatus();
  });
  void externalSkillsController.refresh();
  void refreshCodexCatalog();
  void refreshCodexLoginStatus();
  activateSettingsPanel(activeSettingsPanel);

  function activateSettingsPanel(panelId) {
    activeSettingsPanel = settingsPanels.some((panel) => panel.dataset.settingsPanel === panelId)
      ? panelId
      : activeSettingsPanel;

    settingsNavItems.forEach((item) => {
      const isActive = item.dataset.settingsTarget === activeSettingsPanel;
      item.classList.toggle('is-active', isActive);
      item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    settingsPanels.forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== activeSettingsPanel;
    });

    if (activeSettingsPanel === 'llm') {
      void refreshCodexLoginStatus();
    }
    if (activeSettingsPanel === 'genomes') {
      void genomesController.refresh();
    }
    if (
      activeSettingsPanel === 'skills'
      && !externalSkillsController.hasDiscoveredSkills()
      && !externalSkillsController.isLoading()
    ) {
      void externalSkillsController.refresh();
    }
  }

  function syncCodexSettingsFromCatalog() {
    if (!llmModelCatalog.hasCodexModels()) {
      return false;
    }
    const llm = state.settings?.llm && typeof state.settings.llm === 'object'
      ? state.settings.llm
      : {};
    const provider = DEFAULT_LLM_PROVIDER;

    const currentModel = String(llm.model || '').trim();
    const nextModel = currentModel
      ? llmModelCatalog.normalizeModel(provider, currentModel)
      : currentModel;
    const nextReasoningEffort = llmModelCatalog.normalizeReasoning(
      provider,
      nextModel,
      llm.reasoningEffort
    );
    if (nextModel === currentModel && nextReasoningEffort === String(llm.reasoningEffort || '').trim().toLowerCase()) {
      return false;
    }

    state.settings.llm = {
      ...state.settings.llm,
      provider,
      model: nextModel,
      reasoningEffort: nextReasoningEffort
    };
    return true;
  }

  function renderModelOptions(provider) {
    if (!settingModelOptions) {
      return;
    }
    const modelOptions = llmModelCatalog.getModelOptions(provider);
    settingModelOptions.textContent = '';
    modelOptions.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.value;
      if (entry.label && entry.label !== entry.value) {
        option.label = entry.label;
      }
      settingModelOptions.append(option);
    });
  }

  function renderReasoningEffortOptions(provider, model, selectedReasoningEffort = '') {
    if (!settingReasoningEffort) {
      return;
    }

    const modelConfig = llmModelCatalog.getModelConfig(provider, model);
    const supported = Array.isArray(modelConfig?.reasoningEfforts) ? modelConfig.reasoningEfforts : [];
    const normalizedSelected = llmModelCatalog.normalizeReasoning(provider, model, selectedReasoningEffort);
    settingReasoningEffort.textContent = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    if (supported.length) {
      const fallbackLabel = String(modelConfig?.defaultReasoningEffort || supported[0] || '').trim();
      defaultOption.textContent = fallbackLabel ? `Default (${fallbackLabel})` : 'Default';
    } else {
      defaultOption.textContent = 'Not configurable for this model';
    }
    settingReasoningEffort.append(defaultOption);

    supported.forEach((effort) => {
      const option = document.createElement('option');
      option.value = effort;
      option.textContent = effort;
      settingReasoningEffort.append(option);
    });

    settingReasoningEffort.disabled = supported.length === 0;
    settingReasoningEffort.value = normalizedSelected;
  }

  function refreshLlmModelAndReasoningFields(provider, selectedReasoningEffort = '') {
    renderModelOptions(provider);
    renderReasoningEffortOptions(provider, settingModel?.value || '', selectedReasoningEffort);
  }

  function renderForms() {
    const didSyncCodexSettings = syncCodexSettingsFromCatalog();
    const appearance = state.settings.appearance;
    const llm = state.settings.llm;

    settingFontSize.value = String(appearance.fontSize || 16);
    settingMode.value = appearance.mode || 'day';

    settingStoragePath.value = state.settings.storagePath || '';
    if (settingStartupDefaultView) {
      const startupDefaultViewId = String(state.settings.startup?.defaultViewId || 'home-view');
      const hasOption = [...settingStartupDefaultView.options].some((option) => option.value === startupDefaultViewId);
      settingStartupDefaultView.value = hasOption ? startupDefaultViewId : 'home-view';
    }
    if (settingStartupRememberLastView) {
      settingStartupRememberLastView.checked = state.settings.startup?.rememberLastView === true;
    }
    const llmProvider = DEFAULT_LLM_PROVIDER;
    settingModel.value = llm.model || '';
    settingModel.placeholder = 'optional, e.g. gpt-5.4';
    refreshLlmModelAndReasoningFields(llmProvider, llm.reasoningEffort);
    if (settingAgentExternalSkillsEnabled) {
      settingAgentExternalSkillsEnabled.checked = state.settings?.agent?.externalSkillsEnabled !== false;
    }
    renderCodexStatus();
    externalSkillsController.render();
    genomesController.render();
    pluginsController.render();
    sampleInventoryController.renderLocationList();
    sampleInventoryController.renderSampleInventoryLocationList();
    sampleInventoryController.renderSampleTypeLabelList();
    renderPreferredJournal();
    if (didSyncCodexSettings) {
      persist();
    }
  }

  function applyAppearance() {
    const appearance = state.settings.appearance;
    applyAppearanceToDocument(appearance, document, 16);
    window.dispatchEvent(new CustomEvent('hikari:appearance-changed'));
  }

  function onSaveAppearance(event) {
    event.preventDefault();

    state.settings.appearance = {
      ...state.settings.appearance,
      fontSize: Number(settingFontSize.value) || 16,
      mode: normalizeAppearanceMode(settingMode.value)
    };

    persist();
    applyAppearance();
  }

  async function onSaveStoragePath(event) {
    event.preventDefault();
    await saveStoragePath(settingStoragePath.value);
  }

  async function onSelectStoragePath() {
    if (!window.hikariApi?.pickStorageDirectory) {
      return;
    }

    const result = await window.hikariApi.pickStorageDirectory(settingStoragePath.value);
    if (!result?.ok || !result.path) {
      return;
    }

    settingStoragePath.value = result.path;
    await saveStoragePath(result.path);
  }

  async function saveStoragePath(path) {
    const nextPath = String(path || '').trim();
    const previousPath = String(state.settings?.storagePath || '').trim();
    const rootChanged = nextPath !== previousPath;
    if (!nextPath) {
      state.settings.storagePath = '';
      persist();
      return;
    }
    if (typeof onStoragePathSaved !== 'function') {
      state.settings.storagePath = nextPath;
      persist();
      return;
    }
    const result = await onStoragePathSaved(nextPath, {
      resetWorkspace: rootChanged,
      previousStoragePath: previousPath
    });
    if (!result?.ok && rootChanged && result?.refreshed !== true && settingStoragePath) {
      settingStoragePath.value = previousPath;
    }
  }

  function onSaveStartupSettings(event) {
    event.preventDefault();
    state.settings.startup = {
      defaultViewId: String(settingStartupDefaultView?.value || 'home-view').trim() || 'home-view',
      rememberLastView: settingStartupRememberLastView?.checked === true
    };
    persist();
  }

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
      return codexLoginConfig;
    }
    try {
      const result = await window.hikariApi.getCodexLlmStatus();
      codexLoginConfig = normalizeCodexLoginStatus(result);
      renderCodexStatus();
      return codexLoginConfig;
    } catch {
      renderCodexStatus('Failed to load Codex login status.');
      return codexLoginConfig;
    }
  }

  async function startCodexLoginFlow() {
    if (!window.hikariApi?.loginCodexLlm) {
      renderCodexStatus('Codex login is unavailable.');
      return { ok: false };
    }
    try {
      const result = await window.hikariApi.loginCodexLlm();
      if (!result?.ok) {
        renderCodexStatus(result?.error || 'Failed to start the OpenAI login flow.');
        return result;
      }
      renderCodexStatus(result?.message || 'OpenAI login opened. Finish the Codex sign-in flow in your browser, then return here.');
      scheduleCodexLoginStatusRefresh();
      return result;
    } catch {
      renderCodexStatus('Failed to start the OpenAI login flow.');
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
      return;
    }

    const result = await window.hikariApi.clearCodexLlmLogin();
    if (!result?.ok) {
      renderCodexStatus(result?.error || 'Failed to clear the saved Codex login.');
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

  async function onSaveTelegramToken(event) {
    event.preventDefault();
    const token = settingTelegramToken?.value?.trim() || '';
    if (!token) {
      return;
    }
    if (!window.hikariApi?.setTelegramBotToken) {
      return;
    }

    const result = await window.hikariApi.setTelegramBotToken(token);
    if (!result?.ok) {
      return;
    }

    if (settingTelegramToken) {
      settingTelegramToken.value = '';
    }
  }

  async function onClearTelegramToken() {
    if (!window.hikariApi?.clearTelegramBotToken) {
      return;
    }

    const result = await window.hikariApi.clearTelegramBotToken();
    if (!result?.ok) {
      return;
    }

    if (settingTelegramToken) {
      settingTelegramToken.value = '';
    }
  }

  function renderPreferredJournal() {
    if (!settingPreferredJournal) {
      return;
    }
    settingPreferredJournal.value = '';
    if (!preferredJournalList) {
      return;
    }
    const journals = getPreferredJournalSettings();
    preferredJournalList.innerHTML = journals.length
      ? journals.map((journal, index) => `
          <div class="settings-edit-row settings-preferred-journal-row" data-preferred-journal-row="${index}">
            <input value="${escapeHtml(journal)}" data-preferred-journal-input="${index}" aria-label="Preferred journal ${index + 1}" />
            <button type="button" class="ghost-btn settings-inline-icon" data-preferred-journal-save="${index}" aria-label="Save ${escapeHtml(journal)}" title="Save journal">&check;</button>
            <button type="button" class="danger-btn settings-inline-icon settings-inline-icon-danger" data-preferred-journal-delete="${index}" aria-label="Delete ${escapeHtml(journal)}" title="Delete journal">&times;</button>
          </div>
        `).join('')
      : '<p class="small-note">No preferred journals configured.</p>';
  }

  function onSavePreferredJournal(event) {
    event.preventDefault();
    const nextJournal = String(settingPreferredJournal?.value || '').trim();
    if (!nextJournal) {
      return;
    }
    setPreferredJournalSettings([...getPreferredJournalSettings(), nextJournal]);
    persist();
    renderPreferredJournal();
  }

  function onClearPreferredJournal() {
    setPreferredJournalSettings([]);
    persist();
    renderPreferredJournal();
  }

  function onPreferredJournalListClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') {
      return;
    }
    const saveButton = target.closest('[data-preferred-journal-save]');
    if (saveButton) {
      const index = Number(saveButton.dataset.preferredJournalSave);
      const input = preferredJournalList?.querySelector(`[data-preferred-journal-input="${index}"]`);
      savePreferredJournalAt(index, input?.value || '');
      return;
    }
    const deleteButton = target.closest('[data-preferred-journal-delete]');
    if (deleteButton) {
      deletePreferredJournalAt(Number(deleteButton.dataset.preferredJournalDelete));
    }
  }

  function onPreferredJournalListKeydown(event) {
    if (event.key !== 'Enter') {
      return;
    }
    const input = event.target?.closest?.('[data-preferred-journal-input]');
    if (!input) {
      return;
    }
    event.preventDefault();
    savePreferredJournalAt(Number(input.dataset.preferredJournalInput), input.value);
  }

  function savePreferredJournalAt(index, value) {
    const journals = getPreferredJournalSettings();
    if (!Number.isInteger(index) || index < 0 || index >= journals.length) {
      return;
    }
    journals[index] = String(value || '').trim();
    setPreferredJournalSettings(journals);
    persist();
    renderPreferredJournal();
  }

  function deletePreferredJournalAt(index) {
    const journals = getPreferredJournalSettings();
    if (!Number.isInteger(index) || index < 0 || index >= journals.length) {
      return;
    }
    journals.splice(index, 1);
    setPreferredJournalSettings(journals);
    persist();
    renderPreferredJournal();
  }

  function getPreferredJournalSettings() {
    const list = Array.isArray(state.settings?.preferredJournals)
      ? state.settings.preferredJournals
      : [];
    const snakeList = Array.isArray(state.settings?.preferred_journals)
      ? state.settings.preferred_journals
      : [];
    const legacy = String(state.settings?.preferredJournal || '').trim();
    const snakeLegacy = String(state.settings?.preferred_journal || '').trim();
    return normalizePreferredJournalList([list, snakeList, legacy, snakeLegacy]);
  }

  function setPreferredJournalSettings(journals) {
    const normalized = normalizePreferredJournalList(journals);
    state.settings.preferredJournals = normalized;
    state.settings.preferredJournal = normalized.join('; ');
  }

  return { renderForms, applyAppearance };
}
