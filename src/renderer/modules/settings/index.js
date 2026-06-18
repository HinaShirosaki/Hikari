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
} from '../llm-provider-config.generated.js';
import {
  getEditableSampleTypeEntries,
  getSampleInventoryLocationNames,
  normalizeSampleInventoryLocations,
  normalizeSampleTypeLabels
} from '../sample-inventory-settings.js';

const FIXED_ACCENT = '#647255';
const FIXED_FOCUS = '#7a8a69';

export function initSettings({
  state,
  persist,
  onStoragePathSaved,
  onSampleInventorySettingsChanged
}) {
  const settingsNavItems = [...document.querySelectorAll('#setting-view [data-settings-target]')];
  const settingsPanels = [...document.querySelectorAll('#setting-view [data-settings-panel]')];

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

  const llmForm = document.getElementById('llm-form');
  const settingProvider = document.getElementById('setting-provider');
  const settingModel = document.getElementById('setting-model');
  const settingModelOptions = document.getElementById('setting-model-options');
  const settingReasoningEffort = document.getElementById('setting-reasoning-effort');
  const settingApiEndpoint = document.getElementById('setting-api-endpoint');
  const settingApiKey = document.getElementById('setting-api-key');
  const settingCodexAuthControls = document.getElementById('setting-codex-auth-controls');
  const settingCodexStatus = document.getElementById('setting-codex-status');
  const startCodexLoginBtn = document.getElementById('start-codex-login-btn');
  const clearCodexLoginBtn = document.getElementById('clear-codex-login-btn');
  const settingAgentDeveloperMode = document.getElementById('setting-agent-developer-mode');
  const settingAgentExternalSkillsEnabled = document.getElementById('setting-agent-external-skills-enabled');
  const settingExternalSkillsStatus = document.getElementById('setting-external-skills-status');
  const settingExternalSkillsRefreshBtn = document.getElementById('setting-external-skills-refresh-btn');
  const settingExternalSkillsList = document.getElementById('setting-external-skills-list');
  const telegramForm = document.getElementById('telegram-form');
  const settingTelegramToken = document.getElementById('setting-telegram-token');
  const settingTelegramStatus = document.getElementById('setting-telegram-status');
  const clearTelegramTokenBtn = document.getElementById('clear-telegram-token-btn');
  const locationInput = document.getElementById('setting-location-input');
  const locationAddBtn = document.getElementById('setting-location-add-btn');
  const locationList = document.getElementById('setting-location-list');
  const sampleInventoryLocationInput = document.getElementById('setting-sample-inventory-location-input');
  const sampleInventoryLocationAddBtn = document.getElementById('setting-sample-inventory-location-add-btn');
  const sampleInventoryLocationList = document.getElementById('setting-sample-inventory-location-list');
  const sampleTypeLabelsForm = document.getElementById('sample-type-labels-form');
  const sampleTypeLabelList = document.getElementById('setting-sample-type-label-list');
  const preferredJournalForm = document.getElementById('preferred-journal-form');
  const settingPreferredJournal = document.getElementById('setting-preferred-journal');
  const clearPreferredJournalBtn = document.getElementById('clear-preferred-journal-btn');
  let telegramConfig = {
    enabled: false,
    source: 'none',
    hasSavedToken: false
  };
  let codexLoginConfig = {
    ok: false,
    loggedIn: false,
    source: 'none',
    expired: false,
    sourcePath: '',
    message: 'Checking Codex login...'
  };
  let storageImportInFlight = false;
  let externalSkillsLoading = false;
  let externalSkillCatalog = {
    ok: false,
    error: '',
    skills: []
  };
  let activeLlmProvider = DEFAULT_LLM_PROVIDER;
  let codexCatalog = null;
  let codexLoginRefreshTimers = [];
  let activeSettingsPanel = settingsNavItems[0]?.dataset.settingsTarget || 'appearance';
  const looksLikeEndpoint = (value) => /^[a-z]+:\/\//i.test(String(value || '').trim());

  function renderCodexAccessFields(provider = '') {
    const isCodexProvider = provider === 'codex';
    const endpointLabel = settingApiEndpoint?.closest('label');
    const apiKeyLabel = settingApiKey?.closest('label');
    if (endpointLabel) {
      endpointLabel.hidden = isCodexProvider;
    }
    if (apiKeyLabel) {
      apiKeyLabel.hidden = isCodexProvider;
    }
    if (isCodexProvider) {
      if (settingApiEndpoint) {
        settingApiEndpoint.value = '';
        settingApiEndpoint.placeholder = '';
      }
      if (settingApiKey) {
        settingApiKey.value = '';
        settingApiKey.placeholder = '';
      }
    }
  }

  populateLlmProviderOptions();

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
  settingProvider?.addEventListener('change', onProviderChanged);
  settingModel?.addEventListener('input', onModelChanged);
  settingModel?.addEventListener('change', onModelChanged);
  startCodexLoginBtn?.addEventListener('click', onStartCodexLogin);
  clearCodexLoginBtn?.addEventListener('click', onClearCodexLogin);
  settingAgentExternalSkillsEnabled?.addEventListener('change', onExternalSkillsEnabledChanged);
  settingExternalSkillsRefreshBtn?.addEventListener('click', () => {
    void refreshExternalSkills();
  });
  telegramForm?.addEventListener('submit', onSaveTelegramToken);
  clearTelegramTokenBtn?.addEventListener('click', onClearTelegramToken);
  locationAddBtn.addEventListener('click', onAddLocation);
  sampleInventoryLocationAddBtn?.addEventListener('click', onAddSampleInventoryLocation);
  sampleTypeLabelsForm?.addEventListener('submit', onSaveSampleTypeLabels);
  preferredJournalForm?.addEventListener('submit', onSavePreferredJournal);
  clearPreferredJournalBtn?.addEventListener('click', onClearPreferredJournal);
  window.addEventListener('focus', () => {
    if (activeLlmProvider === 'codex') {
      void refreshCodexLoginStatus();
    }
  });
  void refreshTelegramBotStatus();
  void refreshExternalSkills();
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

    if (activeSettingsPanel === 'llm' && activeLlmProvider === 'codex') {
      void refreshCodexLoginStatus();
    }
    if (activeSettingsPanel === 'skills' && !externalSkillCatalog.skills.length && !externalSkillsLoading) {
      void refreshExternalSkills();
    }
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

  function normalizeCodexLoginStatus(rawStatus) {
    const source = rawStatus && typeof rawStatus === 'object' ? rawStatus : {};
    return {
      ok: source.ok === true,
      loggedIn: source.loggedIn === true,
      source: String(source.source || '').trim().toLowerCase() || 'none',
      expired: source.expired === true,
      sourcePath: String(source.sourcePath || '').trim(),
      message: String(source.message || '').trim()
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
    const llmProvider = normalizeLlmProvider(llm.provider, llm.apiEndpoint || llm.api);
    activeLlmProvider = llmProvider;
    if (settingProvider) {
      settingProvider.value = llmProvider;
    }
    settingModel.value = llm.model || '';
    settingModel.placeholder = modelPlaceholderForProvider(llmProvider);
    refreshLlmModelAndReasoningFields(llmProvider, llm.reasoningEffort);
    if (llmProvider === 'codex') {
      renderCodexAccessFields(llmProvider);
    } else {
      settingApiEndpoint.value = llm.apiEndpoint
        || (llm.api && looksLikeEndpoint(llm.api) ? llm.api : defaultLlmEndpointForProvider(llmProvider));
      settingApiEndpoint.placeholder = defaultLlmEndpointForProvider(llmProvider);
      settingApiKey.value = llm.apiKey || (llm.api && !looksLikeEndpoint(llm.api) ? llm.api : '');
      settingApiKey.placeholder = apiKeyPlaceholderForProvider(llmProvider);
      renderCodexAccessFields(llmProvider);
    }
    if (settingAgentDeveloperMode) {
      settingAgentDeveloperMode.checked = state.settings?.agent?.developerMode === true;
    }
    if (settingAgentExternalSkillsEnabled) {
      settingAgentExternalSkillsEnabled.checked = state.settings?.agent?.externalSkillsEnabled !== false;
    }
    renderCodexStatus();
    renderExternalSkills();
    renderTelegramStatus();
    renderLocationList();
    renderSampleInventoryLocationList();
    renderSampleTypeLabelList();
    renderPreferredJournal();
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

  function getSampleInventoryLocations() {
    state.settings.sampleInventoryLocations = getSampleInventoryLocationNames(state.settings, state.inventory);
    return state.settings.sampleInventoryLocations;
  }

  function notifySampleInventorySettingsChanged() {
    if (typeof onSampleInventorySettingsChanged === 'function') {
      onSampleInventorySettingsChanged();
    }
  }

  function getSampleInventoryContainerCount(locationName) {
    const section = String(locationName || '').trim();
    return Array.isArray(state.inventory?.[section]) ? state.inventory[section].length : 0;
  }

  function migrateSampleInventoryLocation(oldLocation, nextLocation) {
    const source = String(oldLocation || '').trim();
    const target = String(nextLocation || '').trim();
    if (!source || !target || source === target) {
      return;
    }
    state.inventory = state.inventory && typeof state.inventory === 'object' ? state.inventory : {};
    const sourceContainers = Array.isArray(state.inventory[source]) ? state.inventory[source] : [];
    if (sourceContainers.length) {
      const targetContainers = Array.isArray(state.inventory[target]) ? state.inventory[target] : [];
      state.inventory[target] = targetContainers.concat(sourceContainers);
      delete state.inventory[source];
    }
    (state.samples || []).forEach((sample) => {
      if (sample?.inventoryLink?.section === source) {
        sample.inventoryLink = {
          ...sample.inventoryLink,
          section: target
        };
      }
    });
  }

  function renderSampleInventoryLocationList() {
    if (!sampleInventoryLocationList) {
      return;
    }
    const locations = getSampleInventoryLocations();
    if (!locations.length) {
      sampleInventoryLocationList.innerHTML = '<p class="small-note">No sample inventory locations configured.</p>';
      return;
    }

    sampleInventoryLocationList.innerHTML = locations.map((location, index) => {
      const containerCount = getSampleInventoryContainerCount(location);
      const deleteDisabled = containerCount > 0 ? ' disabled' : '';
      const deleteTitle = containerCount > 0 ? ' title="Move or rename containers before deleting this location."' : '';
      return `
        <div class="settings-edit-row">
          <input value="${escapeHtml(location)}" data-sample-inventory-location-input="${index}" aria-label="Sample inventory location ${index + 1}" />
          <span class="small-note">${escapeHtml(`${containerCount} container${containerCount === 1 ? '' : 's'}`)}</span>
          <button type="button" class="ghost-btn" data-sample-inventory-location-save="${index}">Save</button>
          <button type="button" class="danger-btn" data-sample-inventory-location-delete="${index}"${deleteDisabled}${deleteTitle}>Delete</button>
        </div>
      `;
    }).join('');

    sampleInventoryLocationList.querySelectorAll('[data-sample-inventory-location-save]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.sampleInventoryLocationSave);
        const input = sampleInventoryLocationList.querySelector(`[data-sample-inventory-location-input="${index}"]`);
        saveSampleInventoryLocation(index, input?.value);
      });
    });

    sampleInventoryLocationList.querySelectorAll('[data-sample-inventory-location-delete]').forEach((button) => {
      button.addEventListener('click', () => {
        deleteSampleInventoryLocation(Number(button.dataset.sampleInventoryLocationDelete));
      });
    });
  }

  function saveSampleInventoryLocation(index, rawValue) {
    const locations = getSampleInventoryLocations();
    const nextValue = String(rawValue || '').trim().replace(/\s+/g, ' ');
    if (!nextValue || !Number.isInteger(index) || index < 0 || index >= locations.length) {
      return;
    }
    const duplicate = locations.some((location, locationIndex) => (
      locationIndex !== index && String(location || '').trim().toLowerCase() === nextValue.toLowerCase()
    ));
    if (duplicate) {
      renderSampleInventoryLocationList();
      return;
    }
    const oldValue = locations[index];
    locations[index] = nextValue;
    state.settings.sampleInventoryLocations = normalizeSampleInventoryLocations(locations);
    migrateSampleInventoryLocation(oldValue, nextValue);
    persist();
    renderForms();
    notifySampleInventorySettingsChanged();
  }

  function deleteSampleInventoryLocation(index) {
    const locations = getSampleInventoryLocations();
    if (!Number.isInteger(index) || index < 0 || index >= locations.length) {
      return;
    }
    if (getSampleInventoryContainerCount(locations[index]) > 0 || locations.length <= 1) {
      renderSampleInventoryLocationList();
      return;
    }
    locations.splice(index, 1);
    state.settings.sampleInventoryLocations = normalizeSampleInventoryLocations(locations);
    persist();
    renderForms();
    notifySampleInventorySettingsChanged();
  }

  function renderSampleTypeLabelList() {
    if (!sampleTypeLabelList) {
      return;
    }
    const entries = getEditableSampleTypeEntries(state.settings);
    sampleTypeLabelList.innerHTML = entries.map((entry) => `
      <label class="settings-sample-type-label-row">
        <span>${escapeHtml(entry.defaultLabel)}</span>
        <input data-sample-type-label="${escapeHtml(entry.type)}" value="${escapeHtml(entry.label)}" placeholder="${escapeHtml(entry.defaultLabel)}" />
      </label>
    `).join('');
  }

  function onSaveSampleTypeLabels(event) {
    event.preventDefault();
    const nextLabels = normalizeSampleTypeLabels(state.settings.sampleTypeLabels);
    sampleTypeLabelList?.querySelectorAll('[data-sample-type-label]').forEach((input) => {
      const type = String(input.dataset.sampleTypeLabel || '').trim();
      if (!type) {
        return;
      }
      nextLabels[type] = String(input.value || '').trim().replace(/\s+/g, ' ');
    });
    state.settings.sampleTypeLabels = normalizeSampleTypeLabels(nextLabels);
    persist();
    renderForms();
    notifySampleInventorySettingsChanged();
  }

  function normalizeDisabledExternalSkillNames(value = []) {
    return Array.isArray(value)
      ? value.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
  }

  function getAgentSettings() {
    const currentAgentSettings = state.settings?.agent && typeof state.settings.agent === 'object'
      ? state.settings.agent
      : {};
    state.settings.agent = {
      ...currentAgentSettings,
      developerMode: currentAgentSettings.developerMode === true,
      externalSkillsEnabled: currentAgentSettings.externalSkillsEnabled !== false,
      disabledExternalSkillNames: normalizeDisabledExternalSkillNames(currentAgentSettings.disabledExternalSkillNames)
    };
    return state.settings.agent;
  }

  function getDisabledExternalSkillSet() {
    return new Set(
      normalizeDisabledExternalSkillNames(getAgentSettings().disabledExternalSkillNames)
        .map((item) => item.toLowerCase())
    );
  }

  function normalizeExternalSkillCatalog(result = {}) {
    const source = result && typeof result === 'object' ? result : {};
    const skills = Array.isArray(source.skills)
      ? source.skills.map((skill) => ({
        name: String(skill?.name || '').trim(),
        description: String(skill?.description || '').trim(),
        commandName: String(skill?.command_name || skill?.commandName || '').trim(),
        path: String(skill?.path || '').trim(),
        homepage: String(skill?.homepage || '').trim(),
        eligible: skill?.eligible !== false,
        enabled: skill?.enabled === true,
        settingsEnabled: skill?.settings_enabled !== false,
        disabledReason: String(skill?.disabled_reason || '').trim(),
        userInvocable: skill?.user_invocable !== false,
        modelVisible: skill?.disable_model_invocation !== true
      })).filter((skill) => skill.name)
      : [];
    return {
      ok: source.ok === true,
      error: String(source.error || '').trim(),
      skills
    };
  }

  function buildExternalSkillsPayload() {
    const agentSettings = getAgentSettings();
    return {
      agent: {
        externalSkillsEnabled: agentSettings.externalSkillsEnabled !== false,
        disabledExternalSkillNames: normalizeDisabledExternalSkillNames(agentSettings.disabledExternalSkillNames)
      },
      stateSnapshot: {
        settings: {
          agent: {
            externalSkillsEnabled: agentSettings.externalSkillsEnabled !== false,
            disabledExternalSkillNames: normalizeDisabledExternalSkillNames(agentSettings.disabledExternalSkillNames)
          }
        }
      }
    };
  }

  function renderExternalSkills() {
    if (!settingExternalSkillsStatus || !settingExternalSkillsList) {
      return;
    }
    const agentSettings = getAgentSettings();
    const externalSkillsEnabled = agentSettings.externalSkillsEnabled !== false;
    const disabledSet = getDisabledExternalSkillSet();
    const skills = externalSkillCatalog.skills || [];
    const availableCount = skills.filter((skill) => (
      externalSkillsEnabled
      && skill.eligible
      && !disabledSet.has(skill.name.toLowerCase())
    )).length;
    if (externalSkillsLoading) {
      settingExternalSkillsStatus.textContent = 'External skills: loading...';
    } else if (externalSkillCatalog.error) {
      settingExternalSkillsStatus.textContent = `External skills: ${externalSkillCatalog.error}`;
    } else {
      const switchText = externalSkillsEnabled ? 'enabled' : 'off';
      settingExternalSkillsStatus.textContent = `External skills: ${switchText} · ${skills.length} discovered · ${availableCount} available.`;
    }

    if (!skills.length) {
      settingExternalSkillsList.innerHTML = '<p class="small-note">No external skills discovered.</p>';
      return;
    }

    settingExternalSkillsList.innerHTML = skills.map((skill) => {
      const skillKey = skill.name.toLowerCase();
      const individuallyEnabled = !disabledSet.has(skillKey);
      const statusText = !externalSkillsEnabled
        ? 'Paused by global switch.'
        : !individuallyEnabled
          ? 'Hidden from agent prompts.'
          : skill.eligible
            ? 'Available to agent.'
            : (skill.disabledReason || 'Not eligible in this environment.');
      const toggleText = individuallyEnabled
        ? (externalSkillsEnabled ? 'On' : 'Allowed')
        : 'Off';
      const commandText = skill.commandName ? `/${escapeHtml(skill.commandName)}` : 'no command';
      const modelText = skill.modelVisible ? 'model visible' : 'command only';
      const pathText = skill.path ? `<p class="small-note settings-skill-path">${escapeHtml(skill.path)}</p>` : '';
      return `
        <div class="settings-skill-row">
          <div class="settings-skill-main">
            <div class="settings-skill-title">
              <span>${escapeHtml(skill.name)}</span>
              <span class="settings-skill-command">${commandText}</span>
            </div>
            <p class="small-note settings-skill-description">${escapeHtml(skill.description || 'No description provided.')}</p>
            <p class="small-note">${escapeHtml(statusText)} ${escapeHtml(modelText)}.</p>
            ${pathText}
          </div>
          <label class="settings-skill-toggle">
            <input type="checkbox" data-external-skill-toggle data-skill-name="${escapeHtml(skill.name)}" ${individuallyEnabled ? 'checked' : ''} />
            <span>${escapeHtml(toggleText)}</span>
          </label>
        </div>
      `;
    }).join('');

    settingExternalSkillsList.querySelectorAll('[data-external-skill-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        setExternalSkillEnabled(input.dataset.skillName, input.checked === true);
      });
    });
  }

  async function refreshExternalSkills() {
    if (!window.hikariApi?.listAgentSkills) {
      externalSkillCatalog = {
        ok: false,
        error: 'Agent skill listing is unavailable.',
        skills: []
      };
      renderExternalSkills();
      return;
    }
    externalSkillsLoading = true;
    renderExternalSkills();
    try {
      const result = await window.hikariApi.listAgentSkills(buildExternalSkillsPayload());
      externalSkillCatalog = normalizeExternalSkillCatalog(result);
    } catch {
      externalSkillCatalog = {
        ok: false,
        error: 'Failed to load external skills.',
        skills: []
      };
    } finally {
      externalSkillsLoading = false;
      renderExternalSkills();
    }
  }

  function onExternalSkillsEnabledChanged() {
    const agentSettings = getAgentSettings();
    state.settings.agent = {
      ...agentSettings,
      externalSkillsEnabled: settingAgentExternalSkillsEnabled?.checked === true
    };
    persist();
    renderExternalSkills();
  }

  function setExternalSkillEnabled(skillName = '', enabled = true) {
    const cleanName = String(skillName || '').trim();
    if (!cleanName) {
      return;
    }
    const agentSettings = getAgentSettings();
    const disabledNames = normalizeDisabledExternalSkillNames(agentSettings.disabledExternalSkillNames);
    const nextDisabledByKey = new Map(disabledNames.map((item) => [item.toLowerCase(), item]));
    if (enabled) {
      nextDisabledByKey.delete(cleanName.toLowerCase());
    } else {
      nextDisabledByKey.set(cleanName.toLowerCase(), cleanName);
    }
    state.settings.agent = {
      ...agentSettings,
      disabledExternalSkillNames: Array.from(nextDisabledByKey.values()).sort((left, right) => left.localeCompare(right))
    };
    persist();
    renderExternalSkills();
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
    window.dispatchEvent(new CustomEvent('hikari:appearance-changed'));
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
      renderStorageImportStatus();
      return;
    }
    if (typeof onStoragePathSaved !== 'function') {
      state.settings.storagePath = nextPath;
      persist();
      renderStorageImportStatus();
      return;
    }
    storageImportInFlight = true;
    renderStorageImportStatus();
    try {
      const result = await onStoragePathSaved(nextPath, {
        resetWorkspace: rootChanged,
        previousStoragePath: previousPath
      });
      if (!result?.ok && rootChanged && result?.refreshed !== true && settingStoragePath) {
        settingStoragePath.value = previousPath;
      }
    } finally {
      storageImportInFlight = false;
      renderStorageImportStatus();
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

    const provider = normalizeLlmProvider(settingProvider?.value, settingApiEndpoint?.value || '');
    const isCodexProvider = provider === 'codex';
    settingCodexAuthControls.hidden = !isCodexProvider;
    if (startCodexLoginBtn) {
      startCodexLoginBtn.disabled = !isCodexProvider;
    }
    if (clearCodexLoginBtn) {
      clearCodexLoginBtn.disabled = !isCodexProvider;
    }
    if (!isCodexProvider) {
      return;
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

  async function onSaveLlmSettings(event) {
    event.preventDefault();
    const provider = normalizeLlmProvider(settingProvider?.value, settingApiEndpoint.value);
    const model = normalizeModelForProvider(provider, settingModel?.value);
    const reasoningEffort = normalizeReasoningForProvider(provider, model, settingReasoningEffort?.value);
    const endpoint = provider === 'codex'
      ? ''
      : (settingApiEndpoint.value.trim() || defaultLlmEndpointForProvider(provider));
    const apiKey = provider === 'codex' ? '' : settingApiKey.value.trim();

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
  }

  function onProviderChanged() {
    const provider = normalizeLlmProvider(settingProvider?.value, settingApiEndpoint.value);
    const previousDefault = defaultLlmEndpointForProvider(activeLlmProvider);
    const nextDefault = defaultLlmEndpointForProvider(provider);
    const currentEndpoint = settingApiEndpoint.value.trim();

    if (provider === 'codex') {
      settingApiEndpoint.value = '';
      settingApiKey.value = '';
    } else if (!currentEndpoint || currentEndpoint === previousDefault) {
      settingApiEndpoint.value = nextDefault;
    }
    settingApiEndpoint.placeholder = nextDefault;
    settingModel.placeholder = modelPlaceholderForProvider(provider);
    settingApiKey.placeholder = apiKeyPlaceholderForProvider(provider);
    activeLlmProvider = provider;
    renderCodexAccessFields(provider);
    refreshLlmModelAndReasoningFields(provider, settingReasoningEffort?.value);
    renderCodexStatus();
    if (provider === 'codex') {
      void refreshCodexLoginStatus();
    }
  }

  function onModelChanged() {
    const provider = normalizeLlmProvider(settingProvider?.value, settingApiEndpoint.value);
    renderReasoningEffortOptions(provider, settingModel?.value || '', settingReasoningEffort?.value);
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
    if (!window.hikariApi?.setTelegramBotToken) {
      renderTelegramStatus('Telegram integration is unavailable.');
      return;
    }

    const result = await window.hikariApi.setTelegramBotToken(token);
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
    if (!window.hikariApi?.clearTelegramBotToken) {
      renderTelegramStatus('Telegram integration is unavailable.');
      return;
    }

    const result = await window.hikariApi.clearTelegramBotToken();
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

  function renderPreferredJournal() {
    if (!settingPreferredJournal) {
      return;
    }
    settingPreferredJournal.value = String(state.settings.preferredJournal || '').trim();
  }

  function onSavePreferredJournal(event) {
    event.preventDefault();
    state.settings.preferredJournal = String(settingPreferredJournal?.value || '').trim();
    persist();
    renderPreferredJournal();
  }

  function onClearPreferredJournal() {
    if (settingPreferredJournal) {
      settingPreferredJournal.value = '';
    }
    state.settings.preferredJournal = '';
    persist();
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

  function onAddSampleInventoryLocation() {
    const value = String(sampleInventoryLocationInput?.value || '').trim().replace(/\s+/g, ' ');
    if (!value) {
      return;
    }
    const locations = getSampleInventoryLocations();
    const duplicate = locations.some((location) => String(location || '').trim().toLowerCase() === value.toLowerCase());
    if (!duplicate) {
      locations.push(value);
      state.settings.sampleInventoryLocations = normalizeSampleInventoryLocations(locations);
      persist();
      renderForms();
      notifySampleInventorySettingsChanged();
    }
    if (sampleInventoryLocationInput) {
      sampleInventoryLocationInput.value = '';
    }
  }

  async function refreshTelegramBotStatus() {
    if (!window.hikariApi?.getTelegramBotConfig) {
      renderTelegramStatus('Telegram integration is unavailable.');
      return;
    }

    const result = await window.hikariApi.getTelegramBotConfig();
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
      settingStorageImportStatus.textContent = 'Storage import: refreshing workspace and scanning records...';
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
