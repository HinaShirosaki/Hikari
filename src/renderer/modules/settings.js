import { defaultLlmEndpointForProvider, normalizeLlmProvider } from './shared.js';

export function initSettings({ state, persist, onStoragePathSaved, onSaveEnaFile, onLoadEnaFile }) {
  const personalInfoForm = document.getElementById('personal-info-form');
  const settingNameInput = document.getElementById('setting-name');
  const settingPositionInput = document.getElementById('setting-position');
  const settingInstitutionEmailInput = document.getElementById('setting-institution-email');
  const settingEnanaEmailInput = document.getElementById('setting-enana-email');

  const appearanceForm = document.getElementById('appearance-form');
  const settingFontSize = document.getElementById('setting-font-size');
  const settingThemeColor = document.getElementById('setting-theme-color');
  const settingMode = document.getElementById('setting-mode');
  const settingUiStyleToggle = document.getElementById('setting-ui-style-toggle');
  const settingUiStyleLabel = document.getElementById('setting-ui-style-label');

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
  let activeLlmProvider = 'openai';
  const looksLikeEndpoint = (value) => /^[a-z]+:\/\//i.test(String(value || '').trim());

  personalInfoForm.addEventListener('submit', onSavePersonalInfo);
  appearanceForm.addEventListener('submit', onSaveAppearance);
  settingUiStyleToggle?.addEventListener('click', onToggleUiStyle);
  storageForm.addEventListener('submit', onSaveStoragePath);
  selectStoragePathBtn?.addEventListener('click', onSelectStoragePath);
  startupForm?.addEventListener('submit', onSaveStartupSettings);
  llmForm.addEventListener('submit', onSaveLlmSettings);
  settingProvider?.addEventListener('change', onProviderChanged);
  telegramForm?.addEventListener('submit', onSaveTelegramToken);
  clearTelegramTokenBtn?.addEventListener('click', onClearTelegramToken);
  saveEnaBtn.addEventListener('click', onSaveEnaClick);
  loadEnaBtn.addEventListener('click', onLoadEnaClick);
  settingAutoSaveEna?.addEventListener('change', onToggleAutoSaveEna);
  locationAddBtn.addEventListener('click', onAddLocation);
  void refreshTelegramBotStatus();

  function renderForms() {
    const personal = state.settings.personalInfo;
    const appearance = state.settings.appearance;
    const llm = state.settings.llm;

    settingNameInput.value = personal.name || '';
    settingPositionInput.value = personal.position || '';
    settingInstitutionEmailInput.value = personal.institutionEmail || '';
    settingEnanaEmailInput.value = personal.enanaEmail || '';

    settingFontSize.value = String(appearance.fontSize || 16);
    settingThemeColor.value = appearance.themeColor || '#2688ff';
    settingMode.value = appearance.mode || 'day';
    syncUiStyleControls(appearance.uiStyle || 'neutral-compact');

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
    settingApiEndpoint.value = llm.apiEndpoint
      || (llm.api && looksLikeEndpoint(llm.api) ? llm.api : defaultLlmEndpointForProvider(llmProvider));
    settingApiEndpoint.placeholder = defaultLlmEndpointForProvider(llmProvider);
    settingApiKey.value = llm.apiKey || (llm.api && !looksLikeEndpoint(llm.api) ? llm.api : '');
    settingApiKey.placeholder = llmProvider === 'codex'
      ? 'Not required (use `codex login`)'
      : 'sk-...';
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

    root.style.setProperty('--accent', appearance.themeColor || '#2688ff');
    root.style.setProperty('--focus', appearance.themeColor || '#2688ff');
    root.style.setProperty('--app-font-size', `${appearance.fontSize || 16}px`);
    root.style.setProperty('font-size', `${appearance.fontSize || 16}px`);

    document.body.classList.toggle('theme-night', appearance.mode === 'night');
    document.body.classList.toggle('ui-neutral-compact', (appearance.uiStyle || 'neutral-compact') === 'neutral-compact');
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
      fontSize: Number(settingFontSize.value) || 16,
      themeColor: settingThemeColor.value || '#2688ff',
      mode: settingMode.value === 'night' ? 'night' : 'day',
      uiStyle: state.settings.appearance?.uiStyle === 'classic' ? 'classic' : 'neutral-compact'
    };

    persist();
    applyAppearance();
  }

  function onToggleUiStyle() {
    const current = state.settings.appearance?.uiStyle === 'classic' ? 'classic' : 'neutral-compact';
    const next = current === 'neutral-compact' ? 'classic' : 'neutral-compact';
    state.settings.appearance = {
      ...state.settings.appearance,
      uiStyle: next
    };
    persist();
    applyAppearance();
    syncUiStyleControls(next);
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
    const endpoint = settingApiEndpoint.value.trim() || defaultLlmEndpointForProvider(provider);
    const apiKey = settingApiKey.value.trim();

    state.settings.llm = {
      provider,
      model: settingModel.value.trim(),
      apiEndpoint: endpoint,
      apiKey,
      api: apiKey || endpoint
    };
    state.settings.agent = {
      developerMode: settingAgentDeveloperMode?.checked === true
    };

    persist();

    if (provider === 'codex' && window.enanaApi?.setCodexLlmModel) {
      try {
        await window.enanaApi.setCodexLlmModel(state.settings.llm.model);
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
    settingApiKey.placeholder = provider === 'codex'
      ? 'Not required (use `codex login`)'
      : 'sk-...';
    activeLlmProvider = provider;
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

  function syncUiStyleControls(uiStyle) {
    if (!settingUiStyleLabel || !settingUiStyleToggle) {
      return;
    }
    const isNeutral = uiStyle === 'neutral-compact';
    settingUiStyleLabel.textContent = `Current style: ${isNeutral ? 'Neutral Compact' : 'Classic'}`;
    settingUiStyleToggle.textContent = isNeutral ? 'Switch to Classic UI' : 'Use Neutral Compact UI';
  }

  function modelPlaceholderForProvider(provider) {
    if (provider === 'gemini') {
      return 'e.g. gemini-2.5-pro';
    }
    if (provider === 'claude') {
      return 'e.g. claude-sonnet-4-5';
    }
    if (provider === 'codex') {
      return 'optional, e.g. gpt-5';
    }
    return 'e.g. gpt-4.1';
  }

  return { renderForms, applyAppearance };
}
