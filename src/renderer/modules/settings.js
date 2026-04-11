import {
  DEFAULT_LLM_PROVIDER,
  LLM_PROVIDER_OPTIONS,
  apiKeyPlaceholderForProvider,
  defaultLlmEndpointForProvider,
  getLlmModelConfig,
  getLlmProviderModelOptions,
  modelPlaceholderForProvider,
  normalizeLlmProvider,
  normalizeReasoningEffort
} from './shared.js';

const FIXED_ACCENT = '#647255';
const FIXED_FOCUS = '#7a8a69';

export function initSettings({ state, persist, onStoragePathSaved, onSaveEnaFile, onLoadEnaFile }) {
  const settingsNavItems = [...document.querySelectorAll('#setting-view [data-settings-target]')];
  const settingsPanels = [...document.querySelectorAll('#setting-view [data-settings-panel]')];
  const personalInfoForm = document.getElementById('personal-info-form');
  const settingNameInput = document.getElementById('setting-name');
  const settingPositionInput = document.getElementById('setting-position');
  const settingInstitutionEmailInput = document.getElementById('setting-institution-email');
  const settingEnanaEmailInput = document.getElementById('setting-enana-email');

  const appearanceForm = document.getElementById('appearance-form');
  const settingFontSize = document.getElementById('setting-font-size');
  const settingMode = document.getElementById('setting-mode');

  const storageForm = document.getElementById('storage-form');
  const settingStoragePath = document.getElementById('setting-storage-path');
  const settingStorageImportStatus = document.getElementById('setting-storage-import-status');
  const selectStoragePathBtn = document.getElementById('select-storage-path-btn');
  const startupForm = document.getElementById('startup-form');
  const settingStartupDefaultView = document.getElementById('setting-startup-default-view');
  const settingStartupRememberLastView = document.getElementById('setting-startup-remember-last-view');
  const settingStartupAutoLoadDataFile = document.getElementById('setting-startup-auto-load-data-file');

  const llmForm = document.getElementById('llm-form');
  const settingProvider = document.getElementById('setting-provider');
  const settingModel = document.getElementById('setting-model');
  const settingModelOptions = document.getElementById('setting-model-options');
  const settingReasoningEffort = document.getElementById('setting-reasoning-effort');
  const settingApiEndpoint = document.getElementById('setting-api-endpoint');
  const settingApiKey = document.getElementById('setting-api-key');
  const settingAgentDeveloperMode = document.getElementById('setting-agent-developer-mode');
  const telegramForm = document.getElementById('telegram-form');
  const settingTelegramToken = document.getElementById('setting-telegram-token');
  const settingTelegramStatus = document.getElementById('setting-telegram-status');
  const clearTelegramTokenBtn = document.getElementById('clear-telegram-token-btn');
  const settingEnaPath = document.getElementById('setting-ena-path');
  const saveEnaBtn = document.getElementById('save-ena-btn');
  const loadEnaBtn = document.getElementById('load-ena-btn');
  const settingAutoSaveEna = document.getElementById('setting-auto-save-ena');
  const locationInput = document.getElementById('setting-location-input');
  const locationAddBtn = document.getElementById('setting-location-add-btn');
  const locationList = document.getElementById('setting-location-list');
  let telegramConfig = {
    enabled: false,
    source: 'none',
    hasSavedToken: false
  };
  let storageImportInFlight = false;
  let activeLlmProvider = DEFAULT_LLM_PROVIDER;
  let codexCatalog = null;
  let activeSettingsPanel = settingsNavItems[0]?.dataset.settingsTarget || 'appearance';
  const looksLikeEndpoint = (value) => /^[a-z]+:\/\//i.test(String(value || '').trim());

  populateLlmProviderOptions();

  settingsNavItems.forEach((item) => {
    item.addEventListener('click', () => {
      activateSettingsPanel(item.dataset.settingsTarget);
    });
  });
  personalInfoForm.addEventListener('submit', onSavePersonalInfo);
  appearanceForm.addEventListener('submit', onSaveAppearance);
  storageForm.addEventListener('submit', onSaveStoragePath);
  selectStoragePathBtn?.addEventListener('click', onSelectStoragePath);
  startupForm?.addEventListener('submit', onSaveStartupSettings);
  llmForm.addEventListener('submit', onSaveLlmSettings);
  settingProvider?.addEventListener('change', onProviderChanged);
  settingModel?.addEventListener('input', onModelChanged);
  settingModel?.addEventListener('change', onModelChanged);
  telegramForm?.addEventListener('submit', onSaveTelegramToken);
  clearTelegramTokenBtn?.addEventListener('click', onClearTelegramToken);
  saveEnaBtn.addEventListener('click', onSaveEnaClick);
  loadEnaBtn.addEventListener('click', onLoadEnaClick);
  settingAutoSaveEna?.addEventListener('change', onToggleAutoSaveEna);
  locationAddBtn.addEventListener('click', onAddLocation);
  void refreshTelegramBotStatus();
  void refreshCodexCatalog();
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
  }

  function normalizeCodexCatalog(rawCatalog) {
    const source = rawCatalog && typeof rawCatalog === 'object' ? rawCatalog : {};
    return {
      defaultModel: String(source.defaultModel || '').trim(),
      defaultReasoningEffort: String(source.defaultReasoningEffort || '').trim().toLowerCase(),
      models: Array.isArray(source.models)
        ? source.models.map((entry) => ({
          id: String(entry?.id || '').trim(),
          label: String(entry?.label || entry?.id || '').trim(),
          reasoningEfforts: Array.isArray(entry?.reasoningEfforts)
            ? entry.reasoningEfforts.map((effort) => String(effort || '').trim().toLowerCase()).filter(Boolean)
            : [],
          defaultReasoningEffort: String(entry?.defaultReasoningEffort || '').trim().toLowerCase()
        })).filter((entry) => entry.id)
        : []
    };
  }

  function getCodexModelConfig(model = '') {
    const target = String(model || '').trim();
    if (!codexCatalog?.models?.length || !target) {
      return null;
    }
    return codexCatalog.models.find((entry) => entry.id === target) || null;
  }

  function getModelConfigForProvider(provider, model = '') {
    if (provider === 'codex' && codexCatalog?.models?.length) {
      return getCodexModelConfig(model);
    }
    return getLlmModelConfig(provider, model);
  }

  function getModelOptionsForProvider(provider) {
    if (provider === 'codex' && codexCatalog?.models?.length) {
      return codexCatalog.models.map((entry) => ({
        value: entry.id,
        label: entry.label || entry.id
      }));
    }
    return getLlmProviderModelOptions(provider);
  }

  function normalizeModelForProvider(provider, model = '') {
    const cleanModel = String(model || '').trim();
    if (!cleanModel) {
      return '';
    }
    if (provider === 'codex' && codexCatalog?.models?.length) {
      return getCodexModelConfig(cleanModel)?.id || String(codexCatalog.defaultModel || '').trim() || cleanModel;
    }
    return cleanModel;
  }

  function normalizeReasoningForProvider(provider, model = '', reasoningEffort = '') {
    const cleanEffort = String(reasoningEffort || '').trim().toLowerCase();
    const modelConfig = getModelConfigForProvider(provider, model);
    const supported = Array.isArray(modelConfig?.reasoningEfforts) ? modelConfig.reasoningEfforts : [];
    if (!supported.length) {
      return normalizeReasoningEffort(provider, model, cleanEffort);
    }
    return supported.includes(cleanEffort) ? cleanEffort : '';
  }

  function syncCodexSettingsFromCatalog() {
    if (!codexCatalog?.models?.length) {
      return false;
    }
    const llm = state.settings?.llm && typeof state.settings.llm === 'object'
      ? state.settings.llm
      : {};
    const provider = normalizeLlmProvider(llm.provider, llm.apiEndpoint || llm.api);
    if (provider !== 'codex') {
      return false;
    }

    const currentModel = String(llm.model || '').trim();
    const nextModel = currentModel
      ? normalizeModelForProvider(provider, currentModel)
      : currentModel;
    const nextReasoningEffort = normalizeReasoningForProvider(
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
    const modelOptions = getModelOptionsForProvider(provider);
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

    const modelConfig = getModelConfigForProvider(provider, model);
    const supported = Array.isArray(modelConfig?.reasoningEfforts) ? modelConfig.reasoningEfforts : [];
    const normalizedSelected = normalizeReasoningForProvider(provider, model, selectedReasoningEffort);
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
    const resolvedProvider = normalizeLlmProvider(provider, settingApiEndpoint?.value || '');
    renderModelOptions(resolvedProvider);
    renderReasoningEffortOptions(resolvedProvider, settingModel?.value || '', selectedReasoningEffort);
  }

  function renderForms() {
    const didSyncCodexSettings = syncCodexSettingsFromCatalog();
    const personal = state.settings.personalInfo;
    const appearance = state.settings.appearance;
    const llm = state.settings.llm;

    settingNameInput.value = personal.name || '';
    settingPositionInput.value = personal.position || '';
    settingInstitutionEmailInput.value = personal.institutionEmail || '';
    settingEnanaEmailInput.value = personal.enanaEmail || '';

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
    if (settingStartupAutoLoadDataFile) {
      settingStartupAutoLoadDataFile.checked = state.settings.startup?.autoLoadDataFileOnLaunch !== false;
    }
    const llmProvider = normalizeLlmProvider(llm.provider, llm.apiEndpoint || llm.api);
    activeLlmProvider = llmProvider;
    if (settingProvider) {
      settingProvider.value = llmProvider;
    }
    settingModel.value = llm.model || '';
    settingModel.placeholder = modelPlaceholderForProvider(llmProvider);
    refreshLlmModelAndReasoningFields(llmProvider, llm.reasoningEffort);
    settingApiEndpoint.value = llm.apiEndpoint
      || (llm.api && looksLikeEndpoint(llm.api) ? llm.api : defaultLlmEndpointForProvider(llmProvider));
    settingApiEndpoint.placeholder = defaultLlmEndpointForProvider(llmProvider);
    settingApiKey.value = llm.apiKey || (llm.api && !looksLikeEndpoint(llm.api) ? llm.api : '');
    settingApiKey.placeholder = apiKeyPlaceholderForProvider(llmProvider);
    if (settingAgentDeveloperMode) {
      settingAgentDeveloperMode.checked = state.settings?.agent?.developerMode === true;
    }
    settingEnaPath.textContent = state.settings.enaFilePath || 'Not set';
    if (settingAutoSaveEna) {
      settingAutoSaveEna.checked = state.settings.autoSaveEna !== false;
    }
    renderTelegramStatus();
    renderLocationList();
    renderStorageImportStatus();
    if (didSyncCodexSettings) {
      persist();
    }
  }

  function renderLocationList() {
    const locations = state.settings.inventoryLocations || [];
    if (!locations.length) {
      locationList.innerHTML = '<p class="small-note">No locations configured.</p>';
      return;
    }

    locationList.innerHTML = locations.map((location, index) => `
      <div class="card-actions">
        <span>${escapeHtml(location)}</span>
        <button type="button" class="danger-btn" data-location-delete="${index}">Delete</button>
      </div>
    `).join('');

    locationList.querySelectorAll('[data-location-delete]').forEach((button) => {
      button.addEventListener('click', () => {
        const idx = Number(button.dataset.locationDelete);
        state.settings.inventoryLocations.splice(idx, 1);
        persist();
        renderForms();
      });
    });
  }

  function applyAppearance() {
    const appearance = state.settings.appearance;
    const root = document.documentElement;

    root.style.setProperty('--accent', FIXED_ACCENT);
    root.style.setProperty('--focus', FIXED_FOCUS);
    root.style.setProperty('--app-font-size', `${appearance.fontSize || 16}px`);
    root.style.setProperty('font-size', `${appearance.fontSize || 16}px`);

    document.body.classList.toggle('theme-night', appearance.mode === 'night');
    document.body.classList.add('ui-neutral-compact');
    window.dispatchEvent(new CustomEvent('enana:appearance-changed'));
  }

  function onSavePersonalInfo(event) {
    event.preventDefault();

    state.settings.personalInfo = {
      name: settingNameInput.value.trim(),
      position: settingPositionInput.value.trim(),
      institutionEmail: settingInstitutionEmailInput.value.trim(),
      enanaEmail: settingEnanaEmailInput.value.trim()
    };

    persist();
  }

  function onSaveAppearance(event) {
    event.preventDefault();

    state.settings.appearance = {
      ...state.settings.appearance,
      fontSize: Number(settingFontSize.value) || 16,
      mode: settingMode.value === 'night' ? 'night' : 'day'
    };

    persist();
    applyAppearance();
  }

  async function onSaveStoragePath(event) {
    event.preventDefault();
    await saveStoragePath(settingStoragePath.value);
  }

  async function onSelectStoragePath() {
    if (!window.enanaApi?.pickStorageDirectory) {
      return;
    }

    const result = await window.enanaApi.pickStorageDirectory(settingStoragePath.value);
    if (!result?.ok || !result.path) {
      return;
    }

    settingStoragePath.value = result.path;
    await saveStoragePath(result.path);
  }

  async function saveStoragePath(path) {
    const nextPath = String(path || '').trim();
    state.settings.storagePath = nextPath;
    persist();
    if (!nextPath) {
      renderStorageImportStatus();
      return;
    }
    if (typeof onStoragePathSaved !== 'function') {
      renderStorageImportStatus();
      return;
    }
    storageImportInFlight = true;
    renderStorageImportStatus();
    try {
      await onStoragePathSaved(nextPath);
    } finally {
      storageImportInFlight = false;
      renderStorageImportStatus();
    }
  }

  function onSaveStartupSettings(event) {
    event.preventDefault();
    state.settings.startup = {
      defaultViewId: String(settingStartupDefaultView?.value || 'home-view').trim() || 'home-view',
      rememberLastView: settingStartupRememberLastView?.checked === true,
      autoLoadDataFileOnLaunch: settingStartupAutoLoadDataFile?.checked !== false
    };
    persist();
  }

  async function onSaveLlmSettings(event) {
    event.preventDefault();
    const provider = normalizeLlmProvider(settingProvider?.value, settingApiEndpoint.value);
    const model = normalizeModelForProvider(provider, settingModel?.value);
    const reasoningEffort = normalizeReasoningForProvider(provider, model, settingReasoningEffort?.value);
    const endpoint = settingApiEndpoint.value.trim() || defaultLlmEndpointForProvider(provider);
    const apiKey = settingApiKey.value.trim();

    state.settings.llm = {
      provider,
      model,
      reasoningEffort,
      apiEndpoint: endpoint,
      apiKey,
      api: apiKey || endpoint
    };
    state.settings.agent = {
      ...state.settings.agent,
      developerMode: settingAgentDeveloperMode?.checked === true
    };

    persist();

    if (provider === 'codex') {
      try {
        await Promise.all([
          window.enanaApi?.setCodexLlmModel
            ? window.enanaApi.setCodexLlmModel(state.settings.llm.model)
            : Promise.resolve(),
          window.enanaApi?.setCodexLlmReasoningEffort
            ? window.enanaApi.setCodexLlmReasoningEffort(state.settings.llm.reasoningEffort)
            : Promise.resolve()
        ]);
      } catch {
        // Keep settings save non-blocking if the desktop bridge is unavailable.
      }
    }
  }

  function onProviderChanged() {
    const provider = normalizeLlmProvider(settingProvider?.value, settingApiEndpoint.value);
    const previousDefault = defaultLlmEndpointForProvider(activeLlmProvider);
    const nextDefault = defaultLlmEndpointForProvider(provider);
    const currentEndpoint = settingApiEndpoint.value.trim();

    if (!currentEndpoint || currentEndpoint === previousDefault) {
      settingApiEndpoint.value = nextDefault;
    }
    settingApiEndpoint.placeholder = nextDefault;
    settingModel.placeholder = modelPlaceholderForProvider(provider);
    settingApiKey.placeholder = apiKeyPlaceholderForProvider(provider);
    activeLlmProvider = provider;
    refreshLlmModelAndReasoningFields(provider, settingReasoningEffort?.value);
  }

  function onModelChanged() {
    const provider = normalizeLlmProvider(settingProvider?.value, settingApiEndpoint.value);
    renderReasoningEffortOptions(provider, settingModel?.value || '', settingReasoningEffort?.value);
  }

  async function refreshCodexCatalog() {
    if (!window.enanaApi?.getCodexLlmCatalog) {
      return;
    }
    try {
      const result = await window.enanaApi.getCodexLlmCatalog();
      if (!result?.ok) {
        return;
      }
      codexCatalog = normalizeCodexCatalog(result);
      renderForms();
    } catch {
      // Keep settings available even when the desktop bridge cannot inspect Codex CLI.
    }
  }

  async function onSaveTelegramToken(event) {
    event.preventDefault();
    const token = settingTelegramToken?.value?.trim() || '';
    if (!token) {
      renderTelegramStatus('Token is required.');
      return;
    }
    if (!window.enanaApi?.setTelegramBotToken) {
      renderTelegramStatus('Telegram integration is unavailable.');
      return;
    }

    const result = await window.enanaApi.setTelegramBotToken(token);
    if (!result?.ok) {
      renderTelegramStatus(result?.error || 'Failed to save token.');
      return;
    }

    telegramConfig = {
      enabled: result.enabled === true,
      source: result.source || 'none',
      hasSavedToken: result.hasSavedToken === true
    };
    if (settingTelegramToken) {
      settingTelegramToken.value = '';
    }
    renderTelegramStatus();
  }

  async function onClearTelegramToken() {
    if (!window.enanaApi?.clearTelegramBotToken) {
      renderTelegramStatus('Telegram integration is unavailable.');
      return;
    }

    const result = await window.enanaApi.clearTelegramBotToken();
    if (!result?.ok) {
      renderTelegramStatus(result?.error || 'Failed to clear saved token.');
      return;
    }

    telegramConfig = {
      enabled: result.enabled === true,
      source: result.source || 'none',
      hasSavedToken: result.hasSavedToken === true
    };
    if (settingTelegramToken) {
      settingTelegramToken.value = '';
    }
    renderTelegramStatus();
  }

  function onToggleAutoSaveEna() {
    state.settings.autoSaveEna = settingAutoSaveEna?.checked !== false;
    persist();
  }

  async function onSaveEnaClick() {
    if (typeof onSaveEnaFile !== 'function') {
      return;
    }
    await onSaveEnaFile();
    renderForms();
  }

  async function onLoadEnaClick() {
    if (typeof onLoadEnaFile !== 'function') {
      return;
    }
    await onLoadEnaFile();
    renderForms();
  }

  function onAddLocation() {
    const value = locationInput.value.trim();
    if (!value) {
      return;
    }

    if (!Array.isArray(state.settings.inventoryLocations)) {
      state.settings.inventoryLocations = [];
    }
    const normalized = value.toLowerCase();
    const hasLocation = state.settings.inventoryLocations.some((item) => String(item).trim().toLowerCase() === normalized);
    if (!hasLocation) {
      state.settings.inventoryLocations.push(value);
      persist();
      renderForms();
    }
    locationInput.value = '';
  }

  async function refreshTelegramBotStatus() {
    if (!window.enanaApi?.getTelegramBotConfig) {
      renderTelegramStatus('Telegram integration is unavailable.');
      return;
    }

    const result = await window.enanaApi.getTelegramBotConfig();
    if (!result?.ok) {
      renderTelegramStatus(result?.error || 'Failed to load Telegram bot status.');
      return;
    }

    telegramConfig = {
      enabled: result.enabled === true,
      source: result.source || 'none',
      hasSavedToken: result.hasSavedToken === true
    };
    renderTelegramStatus();
  }

  function renderTelegramStatus(errorMessage = '') {
    if (!settingTelegramStatus) {
      return;
    }

    if (errorMessage) {
      settingTelegramStatus.textContent = `Telegram bot status: ${errorMessage}`;
      return;
    }

    if (telegramConfig.enabled) {
      const sourceText = telegramConfig.source === 'app'
        ? 'using token saved in app'
        : telegramConfig.source === 'env'
          ? 'using TELEGRAM_BOT_TOKEN env var'
          : 'using configured token';
      settingTelegramStatus.textContent = `Telegram bot status: running (${sourceText}).`;
      return;
    }

    if (telegramConfig.hasSavedToken) {
      settingTelegramStatus.textContent = 'Telegram bot status: token is saved, but bot is not running.';
      return;
    }

    if (telegramConfig.source === 'env') {
      settingTelegramStatus.textContent = 'Telegram bot status: env token detected, bot is not running.';
      return;
    }

    settingTelegramStatus.textContent = 'Telegram bot status: not configured.';
  }

  function renderStorageImportStatus() {
    if (!settingStorageImportStatus) {
      return;
    }
    if (storageImportInFlight) {
      settingStorageImportStatus.textContent = 'Storage import: scanning and importing records...';
      return;
    }
    const info = state.settings?.storageImport && typeof state.settings.storageImport === 'object'
      ? state.settings.storageImport
      : {};
    const summary = info.summary && typeof info.summary === 'object' ? info.summary : {};
    const warningCount = Array.isArray(info.warnings) ? info.warnings.length : 0;
    if (String(info.error || '').trim()) {
      settingStorageImportStatus.textContent = `Storage import: ${String(info.error).trim()}`;
      return;
    }
    if (String(info.lastImportedAt || '').trim()) {
      const parts = [
        `${Number(summary.protocols) || 0} protocols`,
        `${Number(summary.notebookEntries) || 0} notebook entries`,
        `${Number(summary.workflowTemplates) || 0} workflow templates`,
        `${Number(summary.workflows) || 0} workflows`,
        `${Number(summary.papers) || 0} papers`,
        `${Number(summary.chemicals) || 0} chemicals`,
        `${Number(summary.personalInventoryContainers) || 0} inventory containers`,
        `${Number(summary.sequenceEntries) || 0} sequences`
      ];
      const warningText = warningCount ? ` (${warningCount} warnings)` : '';
      const manifestPath = String(info.manifestPath || '').trim();
      const suffix = manifestPath ? ` · manifest: ${manifestPath}` : '';
      settingStorageImportStatus.textContent = `Storage import: ${parts.join(', ')}${warningText}${suffix}`;
      return;
    }
    settingStorageImportStatus.textContent = 'Storage import: not started.';
  }

  function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, (char) => {
      const entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return entityMap[char] || char;
    });
  }

  function populateLlmProviderOptions() {
    if (!settingProvider) {
      return;
    }
    const selectedProvider = normalizeLlmProvider(settingProvider.value);
    settingProvider.textContent = '';
    LLM_PROVIDER_OPTIONS.forEach((provider) => {
      const option = document.createElement('option');
      option.value = provider.value;
      option.textContent = provider.label;
      settingProvider.append(option);
    });
    settingProvider.value = selectedProvider || DEFAULT_LLM_PROVIDER;
  }

  return { renderForms, applyAppearance };
}
