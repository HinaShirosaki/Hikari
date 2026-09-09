import {
  DEFAULT_AGENT_LLM_PROVIDER as DEFAULT_LLM_PROVIDER
} from '../codex-model-catalog.generated.js';
import { createExternalSkillsController } from './external-skills-controller.js';
import { createGenomesController } from './genomes-controller.js';
import { createPluginsController } from './plugins-controller.js';
import { createLlmModelCatalog } from './llm-model-catalog.js';
import { createMcpToolsController } from './mcp-tools-controller.js';
import { getSettingsElements } from './dom.js';
import { escapeHtml } from './html.js';
import { createSampleInventorySettingsController } from './sample-inventory-controller.js';
import {
  applyAppearanceToDocument,
  normalizeAppearanceMode
} from '../app-state/appearance.js';
import { createCodexAccountSettings } from './codex-account.js';
import { createPreferredJournalSettings } from './preferred-journals.js';
import { createNotebookPdfSettingsController } from './notebook-pdf-controller.js';


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
    notebookPdfForm,
    settingNotebookPdfPageSize,
    settingNotebookPdfStapleEdge,
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
    settingMcpToolsList,
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
  const llmModelCatalog = createLlmModelCatalog();
  let activeSettingsPanel = settingsNavItems[0]?.dataset.settingsTarget || 'appearance';
  const notebookPdfController = createNotebookPdfSettingsController({
    state,
    persist,
    pageSizeInput: settingNotebookPdfPageSize,
    stapleEdgeInput: settingNotebookPdfStapleEdge
  });
  const mcpToolsController = createMcpToolsController({
    state,
    persist,
    listElement: settingMcpToolsList,
    escapeHtml
  });
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
  const {
    renderCodexStatus,
    refreshCodexLoginStatus,
    onStartCodexLogin,
    onClearCodexLogin,
    onCopyCodexDesktopMcpPrompt,
    onSaveLlmSettings,
    onModelChanged,
    refreshCodexCatalog
  } = createCodexAccountSettings({
    state,
    persist,
    llmModelCatalog,
    renderForms: () => renderForms(),
    renderReasoningEffortOptions: (...args) => renderReasoningEffortOptions(...args),
    settingCodexStatus,
    settingCodexAuthControls,
    settingCodexDesktopMcpStatus,
    settingModel,
    settingReasoningEffort,
    startCodexLoginBtn,
    clearCodexLoginBtn,
    copyCodexDesktopMcpPromptBtn
  });
  const {
    renderPreferredJournal,
    onSavePreferredJournal,
    onClearPreferredJournal,
    onPreferredJournalListClick,
    onPreferredJournalListKeydown
  } = createPreferredJournalSettings({
    state,
    persist,
    settingPreferredJournal,
    preferredJournalList
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
  notebookPdfForm?.addEventListener('submit', notebookPdfController.save);
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
    notebookPdfController.render();
    const llmProvider = DEFAULT_LLM_PROVIDER;
    settingModel.value = llm.model || '';
    settingModel.placeholder = 'optional, e.g. gpt-5.4';
    refreshLlmModelAndReasoningFields(llmProvider, llm.reasoningEffort);
    if (settingAgentExternalSkillsEnabled) {
      settingAgentExternalSkillsEnabled.checked = state.settings?.agent?.externalSkillsEnabled !== false;
    }
    renderCodexStatus();
    mcpToolsController.render();
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
      window.dispatchEvent(new CustomEvent('hikari:storage-changed'));
      return;
    }
    if (typeof onStoragePathSaved !== 'function') {
      state.settings.storagePath = nextPath;
      persist();
      window.dispatchEvent(new CustomEvent('hikari:storage-changed'));
      return;
    }
    const result = await onStoragePathSaved(nextPath, {
      resetWorkspace: rootChanged,
      previousStoragePath: previousPath
    });
    if (!result?.ok && rootChanged && result?.refreshed !== true && settingStoragePath) {
      settingStoragePath.value = previousPath;
    }
    window.dispatchEvent(new CustomEvent('hikari:storage-changed'));
  }

  function onSaveStartupSettings(event) {
    event.preventDefault();
    state.settings.startup = {
      defaultViewId: String(settingStartupDefaultView?.value || 'home-view').trim() || 'home-view',
      rememberLastView: settingStartupRememberLastView?.checked === true
    };
    persist();
  }

  return { renderForms, applyAppearance };
}
