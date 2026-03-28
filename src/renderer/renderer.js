import {
  VIEWS,
  TITLES,
  loadState,
  persistState,
  normalizeState,
  createId,
  trackGrowthEvent,
  safeText,
  cssEscape
} from './modules/shared.js';
import { initLabManagement } from './modules/lab-management.js';
import { initInstrumentManagement } from './modules/instrument-management.js';
import { initProtocolManagement } from './modules/protocol-management.js';
import { initLabNotebook } from './modules/lab-notebook.js';
import { initLabNotebook as initBiologyNotebook } from './modules/biology-notebook.js';
import { initPersonalInventory } from './modules/personal-inventory.js';
import { initSettings } from './modules/settings.js';
import { initProjectManagement } from './modules/project-management.js';
import { initWorkflowManagement } from './modules/workflow-management.js';
import { initCollaborationManagement } from './modules/collaboration-management.js';
import { initLabCommonInventory } from './modules/lab-common-inventory.js';
import { initSampleRegistry } from './modules/sample-registry.js';
import { initAssay } from './modules/assay.js';
import { initGelAnalysis } from './modules/gel-analysis.js';
import { initPapersManagement } from './modules/papers-management.js';
import { initToolBox } from './modules/tool-box.js';
import { initAgentChat } from './modules/agent-chat.js';
import { initHomeDashboard } from './modules/home-dashboard.js';
import { initSequenceViewer } from './modules/sequence-viewer.js';
import {
  rebuildObjectGraph,
  queryNotebookEntriesByRelation,
  queryInstrumentUsageInRange
} from './modules/object-graph.js';
import { APP_DOCK_ORDER, APP_REGISTRY } from './modules/app-registry.generated.js';

const state = loadState();
const LAST_ACTIVE_VIEW_STORAGE_KEY = 'enana_last_active_view_v1';
const SEQUENCE_VIEWER_DETAIL_VIEW_ID = 'sequence-viewer-detail-view';
const FIXED_ACCENT = '#647255';
const FIXED_FOCUS = '#7a8a69';

function normalizeViewId(viewId) {
  return viewId === VIEWS.PERSONAL_INVENTORY ? VIEWS.SAMPLE_REGISTRY : viewId;
}

function buildViewAliasMap(apps) {
  const map = new Map();
  apps.forEach((app) => {
    [
      app.id,
      app.label,
      ...(Array.isArray(app.aliases) ? app.aliases : [])
    ].forEach((token) => {
      const normalized = normalizeSearchToken(token);
      if (!normalized || map.has(normalized)) {
        return;
      }
      map.set(normalized, normalizeViewId(app.viewId));
    });
  });
  return map;
}

function buildSearchScopeMap(apps) {
  const map = new Map();
  apps.forEach((app) => {
    const target = {
      viewId: normalizeViewId(app.viewId),
      inputId: String(app.searchInputId || '').trim(),
      label: app.label
    };
    [
      app.id,
      app.label,
      ...(Array.isArray(app.aliases) ? app.aliases : [])
    ].forEach((token) => {
      const normalized = normalizeSearchToken(token);
      if (!normalized || map.has(normalized)) {
        return;
      }
      map.set(normalized, target);
    });
  });
  return map;
}

const APPS_BY_ID = new Map(APP_REGISTRY.map((app) => [app.id, app]));
const APPS_BY_VIEW_ID = new Map(APP_REGISTRY.map((app) => [normalizeViewId(app.viewId), app]));
const GLOBAL_VIEW_ALIASES = buildViewAliasMap(APP_REGISTRY);
const SEARCH_SCOPE_TARGETS = buildSearchScopeMap(APP_REGISTRY);
const VALID_STARTUP_VIEW_IDS = new Set(APP_REGISTRY.map((app) => normalizeViewId(app.viewId)));
const DOCK_APPS = APP_DOCK_ORDER
  .map((id) => APPS_BY_ID.get(id))
  .filter(Boolean);
const MORE_APPS = APP_REGISTRY.filter((app) => !APP_DOCK_ORDER.includes(app.id));

function applyAppearanceSnapshot(appearance) {
  const root = document.documentElement;
  const resolved = appearance && typeof appearance === 'object' ? appearance : {};
  const fontSize = Number(resolved.fontSize) || 16;
  const mode = resolved.mode === 'night' ? 'night' : 'day';

  root.style.setProperty('--accent', FIXED_ACCENT);
  root.style.setProperty('--focus', FIXED_FOCUS);
  root.style.setProperty('--app-font-size', `${fontSize}px`);
  root.style.setProperty('font-size', `${fontSize}px`);
  document.body.classList.toggle('theme-night', mode === 'night');
  document.body.classList.add('ui-neutral-compact');
}

applyAppearanceSnapshot(state.settings?.appearance);

const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');
const homeBtn = document.getElementById('home-btn');
const topbarSettingsBtn = document.getElementById('topbar-settings-btn');
const exitBtn = document.getElementById('exit-btn');
const topbarSearchInput = document.getElementById('topbar-search');
const dockNav = document.getElementById('app-dock-nav');
const moreBtn = document.getElementById('app-more-btn');
const moreMenu = document.getElementById('app-more-menu');
const views = [...document.querySelectorAll('.view')];
let appNavButtons = [];
let moreMenuButtons = [];

let assay = null;
let gel = null;
let workflowManagement = null;
let agentChat = null;
let homeDashboard = null;
let protocol = null;
let lastViewPersistenceEnabled = false;
let sequenceViewer = null;

function isValidStartupViewId(viewId) {
  return VALID_STARTUP_VIEW_IDS.has(normalizeViewId(String(viewId || '').trim()));
}

function rememberLastActiveView(viewId) {
  if (!isValidStartupViewId(viewId)) {
    return;
  }
  try {
    localStorage.setItem(LAST_ACTIVE_VIEW_STORAGE_KEY, normalizeViewId(viewId));
  } catch {}
}

function readLastActiveView() {
  try {
    const storedViewId = String(localStorage.getItem(LAST_ACTIVE_VIEW_STORAGE_KEY) || '').trim();
    if (!isValidStartupViewId(storedViewId)) {
      return '';
    }
    return normalizeViewId(storedViewId);
  } catch {
    return '';
  }
}

function resolveStartupViewId() {
  const startupSettings = state.settings?.startup || {};
  const configuredDefaultView = String(startupSettings.defaultViewId || '').trim();
  const defaultViewId = isValidStartupViewId(configuredDefaultView)
    ? normalizeViewId(configuredDefaultView)
    : VIEWS.HOME;
  if (startupSettings.rememberLastView === true) {
    const rememberedViewId = readLastActiveView();
    if (rememberedViewId) {
      return rememberedViewId;
    }
  }
  return defaultViewId;
}

function getAppForView(viewId) {
  return APPS_BY_VIEW_ID.get(normalizeViewId(viewId)) || null;
}

function createInlineIcon(iconMarkup) {
  const icon = document.createElement('span');
  icon.className = 'app-nav-icon';
  icon.setAttribute('aria-hidden', 'true');
  if (iconMarkup) {
    const template = document.createElement('template');
    template.innerHTML = iconMarkup.trim();
    const svg = template.content.firstElementChild;
    if (svg) {
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      icon.append(svg);
    }
  }
  return icon;
}

function createNavButton(app, options = {}) {
  const menu = options.menu === true;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = menu ? 'app-nav-btn app-more-item' : 'app-nav-btn app-dock-btn';
  button.dataset.view = app.viewId;
  button.dataset.appId = app.id;
  button.title = app.label;
  button.setAttribute('aria-label', app.label);
  if (menu) {
    button.setAttribute('role', 'menuitem');
  }

  const icon = createInlineIcon(app.iconMarkup);
  button.append(icon);

  const label = document.createElement('span');
  label.className = menu ? 'app-more-label' : 'sr-only';
  label.textContent = app.label;
  button.append(label);
  return button;
}

function closeMoreMenu() {
  if (!moreMenu || !moreBtn) {
    return;
  }
  moreMenu.hidden = true;
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.classList.remove('is-open');
}

function toggleMoreMenu(forceOpen) {
  if (!moreMenu || !moreBtn) {
    return;
  }
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : moreMenu.hidden;
  moreMenu.hidden = !shouldOpen;
  moreBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  moreBtn.classList.toggle('is-open', shouldOpen);
}

function renderAppNavigation() {
  if (dockNav) {
    dockNav.replaceChildren(...DOCK_APPS.map((app) => createNavButton(app)));
  }
  if (moreMenu) {
    moreMenu.replaceChildren(...MORE_APPS.map((app) => createNavButton(app, { menu: true })));
  }
  appNavButtons = [...document.querySelectorAll('.app-nav-btn[data-view]')];
  moreMenuButtons = [...document.querySelectorAll('.app-more-item[data-view]')];
}

function replaceState(nextState) {
  Object.keys(state).forEach((key) => {
    delete state[key];
  });
  Object.assign(state, nextState);
}

function persist() {
  state.objectGraph = rebuildObjectGraph(state);
  persistState(state);
  if (window.enanaApi && state.settings.autoSaveEna !== false) {
    window.enanaApi
      .autoSaveDataFile(state, state.settings.enaFilePath || '')
      .then((result) => {
        if (result?.ok && result.filePath && state.settings.enaFilePath !== result.filePath) {
          state.settings.enaFilePath = result.filePath;
          persistState(state);
        }
      })
      .catch(() => {});
  }
}

function mergeRecordsById(existingRecords, importedRecords, fallbackPrefix) {
  const byId = new Map();
  asArray(existingRecords).forEach((record, index) => {
    const source = record && typeof record === 'object' ? record : {};
    const id = String(source.id || `${fallbackPrefix}_existing_${index + 1}`).trim();
    byId.set(id, {
      ...source,
      id
    });
  });
  asArray(importedRecords).forEach((record, index) => {
    const source = record && typeof record === 'object' ? record : {};
    const id = String(source.id || `${fallbackPrefix}_imported_${index + 1}`).trim();
    byId.set(id, {
      ...source,
      id
    });
  });
  return [...byId.values()];
}

function mergeInventoryMap(existingInventory, importedInventory) {
  const merged = {};
  const mergeZone = (zoneName, containers) => {
    const zone = String(zoneName || '').trim();
    if (!zone) {
      return;
    }
    const zoneMap = new Map(
      asArray(merged[zone]).map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const id = String(source.id || `${zone}_existing_${index + 1}`).trim();
        return [
          id,
          {
            ...source,
            id
          }
        ];
      })
    );
    asArray(containers).forEach((item, index) => {
      const source = item && typeof item === 'object' ? item : {};
      const id = String(source.id || `${zone}_imported_${index + 1}`).trim();
      zoneMap.set(id, {
        ...source,
        id
      });
    });
    merged[zone] = [...zoneMap.values()];
  };

  Object.entries(existingInventory && typeof existingInventory === 'object' ? existingInventory : {})
    .forEach(([zone, containers]) => mergeZone(zone, containers));
  Object.entries(importedInventory && typeof importedInventory === 'object' ? importedInventory : {})
    .forEach(([zone, containers]) => mergeZone(zone, containers));

  return merged;
}

function mergeStorageImportPatch(statePatch) {
  const patch = statePatch && typeof statePatch === 'object' ? statePatch : {};
  state.protocols = mergeRecordsById(state.protocols, patch.protocols, 'protocol');
  state.notebookEntries = mergeRecordsById(state.notebookEntries, patch.notebookEntries, 'notebook');

  const existingLabInventory = state.labInventory && typeof state.labInventory === 'object'
    ? state.labInventory
    : {};
  const importedLabInventory = patch.labInventory && typeof patch.labInventory === 'object'
    ? patch.labInventory
    : {};
  const mergedBlocksMap = new Map();
  asArray(existingLabInventory.blocks).forEach((block, index) => {
    const source = block && typeof block === 'object' ? block : {};
    const key = String(source.hash || `${source.index || 0}_${source.timestamp || ''}_${index}`).trim();
    mergedBlocksMap.set(key, source);
  });
  asArray(importedLabInventory.blocks).forEach((block, index) => {
    const source = block && typeof block === 'object' ? block : {};
    const key = String(source.hash || `${source.index || 0}_${source.timestamp || ''}_${index}`).trim();
    mergedBlocksMap.set(key, source);
  });
  const mergedBlocks = [...mergedBlocksMap.values()].sort((left, right) => {
    const leftIndex = Number(left?.index) || 0;
    const rightIndex = Number(right?.index) || 0;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return String(left?.timestamp || '').localeCompare(String(right?.timestamp || ''));
  });

  state.labInventory = {
    ...existingLabInventory,
    ...importedLabInventory,
    chemicals: mergeRecordsById(existingLabInventory.chemicals, importedLabInventory.chemicals, 'chemical'),
    blocks: mergedBlocks,
    locationCodeMap: {
      ...(existingLabInventory.locationCodeMap && typeof existingLabInventory.locationCodeMap === 'object'
        ? existingLabInventory.locationCodeMap
        : {}),
      ...(importedLabInventory.locationCodeMap && typeof importedLabInventory.locationCodeMap === 'object'
        ? importedLabInventory.locationCodeMap
        : {})
    },
    locationCodeNextByLocation: {
      ...(existingLabInventory.locationCodeNextByLocation && typeof existingLabInventory.locationCodeNextByLocation === 'object'
        ? existingLabInventory.locationCodeNextByLocation
        : {}),
      ...(importedLabInventory.locationCodeNextByLocation && typeof importedLabInventory.locationCodeNextByLocation === 'object'
        ? importedLabInventory.locationCodeNextByLocation
        : {})
    },
    lastLocationNumber: Math.max(
      Number(existingLabInventory.lastLocationNumber) || 0,
      Number(importedLabInventory.lastLocationNumber) || 0
    )
  };

  state.inventory = mergeInventoryMap(state.inventory, patch.inventory);
}

function updateStorageImportState(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const summary = source.summary && typeof source.summary === 'object' ? source.summary : {};
  state.settings.storageImport = {
    lastImportedAt: new Date().toISOString(),
    manifestPath: String(source.manifestPath || '').trim(),
    summary: {
      bundles: Number(summary.bundles) || 0,
      protocols: Number(summary.protocols) || 0,
      notebookEntries: Number(summary.notebookEntries) || 0,
      chemicals: Number(summary.chemicals) || 0,
      personalInventoryContainers: Number(summary.personalInventoryContainers) || 0,
      sequenceEntries: Number(summary.sequenceEntries) || 0
    },
    warnings: Array.isArray(source.warnings) ? source.warnings.map((item) => String(item || '')) : [],
    error: ''
  };
}

function updateStorageImportError(message) {
  const previous = state.settings.storageImport && typeof state.settings.storageImport === 'object'
    ? state.settings.storageImport
    : {};
  state.settings.storageImport = {
    ...previous,
    lastImportedAt: previous.lastImportedAt || '',
    manifestPath: previous.manifestPath || '',
    summary: previous.summary && typeof previous.summary === 'object'
      ? previous.summary
      : {
        bundles: 0,
        protocols: 0,
        notebookEntries: 0,
        chemicals: 0,
        personalInventoryContainers: 0,
        sequenceEntries: 0
      },
    warnings: Array.isArray(previous.warnings) ? previous.warnings : [],
    error: String(message || '').trim()
  };
}

async function runStorageRootImport(storagePath, options = {}) {
  const resolvedStoragePath = String(storagePath || '').trim();
  if (!resolvedStoragePath || !window.enanaApi?.importStorageRoot) {
    return { ok: false, skipped: true };
  }

  const persistMergedState = options.persistMergedState === true;
  try {
    const result = await window.enanaApi.importStorageRoot(resolvedStoragePath);
    if (!result?.ok) {
      updateStorageImportError(result?.error || 'Storage import failed.');
      persistState(state);
      return { ok: false, error: result?.error || 'Storage import failed.' };
    }

    mergeStorageImportPatch(result.statePatch);
    updateStorageImportState(result);
    if (persistMergedState) {
      persist();
    } else {
      state.objectGraph = rebuildObjectGraph(state);
      persistState(state);
    }
    return {
      ok: true,
      summary: result.summary || {},
      warnings: result.warnings || [],
      manifestPath: result.manifestPath || ''
    };
  } catch (error) {
    updateStorageImportError(error?.message || 'Storage import failed.');
    persistState(state);
    return { ok: false, error: error?.message || 'Storage import failed.' };
  }
}

window.enanaGraph = {
  rebuild: () => {
    state.objectGraph = rebuildObjectGraph(state);
    persistState(state);
    return state.objectGraph;
  },
  entriesUsingReagentLot: (lot) => queryNotebookEntriesByRelation(state, {
    relation: 'uses_reagent_lot',
    targetType: 'reagent_lot',
    targetId: lot
  }),
  entriesUsingInstrumentLastMonth: (instrumentId) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).toISOString();
    return queryInstrumentUsageInRange(state, instrumentId, start, end);
  }
};

const labManagement = initLabManagement({
  state,
  persist,
  createId,
  safeText
});

const instrumentManagement = initInstrumentManagement({
  state,
  persist,
  createId,
  safeText
});

const synthesisNotebook = initLabNotebook({
  state,
  persist,
  createId,
  safeText,
  notebookType: 'synthesis',
  importProtocolsFromJson: (rawInput, options = {}) => {
    if (!protocol?.importProtocolsFromJson) {
      return { ok: false, error: 'Protocol import is not ready.' };
    }
    return protocol.importProtocolsFromJson(rawInput, options);
  },
  onNotebookEntriesChanged: () => {
    projectManagement.renderNotebookPages();
    workflowManagement?.render();
    assay?.renderNotebookOptions();
    assay?.renderList();
    gel?.renderNotebookOptions();
    gel?.renderList();
  }
});

const biologyNotebook = initBiologyNotebook({
  state,
  persist,
  createId,
  safeText,
  notebookType: 'biology',
  importProtocolsFromJson: (rawInput, options = {}) => {
    if (!protocol?.importProtocolsFromJson) {
      return { ok: false, error: 'Protocol import is not ready.' };
    }
    return protocol.importProtocolsFromJson(rawInput, options);
  },
  onNotebookEntriesChanged: () => {
    projectManagement.renderNotebookPages();
    workflowManagement?.render();
    assay?.renderNotebookOptions();
    assay?.renderList();
    gel?.renderNotebookOptions();
    gel?.renderList();
  }
});

function refreshProtocolDependents() {
  synthesisNotebook.renderProtocolOptions();
  synthesisNotebook.renderEntries();
  biologyNotebook.renderProtocolOptions();
  biologyNotebook.renderEntries();
  workflowManagement?.render();
  assay?.renderNotebookOptions();
  assay?.renderList();
  gel?.renderNotebookOptions();
  gel?.renderList();
}

protocol = initProtocolManagement({
  state,
  persist,
  createId,
  safeText,
  onProtocolsChanged: refreshProtocolDependents,
  trackGrowthEvent
});

const projectManagement = initProjectManagement({
  state,
  persist,
  createId,
  safeText,
  onProjectsChanged: () => {
    synthesisNotebook.renderProjectOptions();
    synthesisNotebook.renderProtocolOptions();
    synthesisNotebook.renderEntries();
    biologyNotebook.renderProjectOptions();
    biologyNotebook.renderProtocolOptions();
    biologyNotebook.renderEntries();
    workflowManagement?.render();
    assay?.renderProjectOptions();
    assay?.renderNotebookOptions();
    assay?.renderList();
    gel?.renderProjectOptions();
    gel?.renderNotebookOptions();
    gel?.renderList();
    papers.render();
    agentChat?.render();
  }
});

agentChat = initAgentChat({
  state,
  persist,
  createId,
  safeText,
  onNotebookEntriesChanged: () => {
    synthesisNotebook.renderEntries();
    biologyNotebook.renderEntries();
    projectManagement.renderNotebookPages();
    workflowManagement?.render();
    assay?.renderNotebookOptions();
    assay?.renderList();
    gel?.renderNotebookOptions();
    gel?.renderList();
  }
});

workflowManagement = initWorkflowManagement({
  state,
  persist,
  createId,
  safeText,
  onWorkflowsChanged: () => {}
});

const papers = initPapersManagement({
  state,
  persist,
  createId,
  safeText,
  onCreateProtocolDraft: ({ method, paper }) => {
    const ok = protocol.addDraftFromExtractedMethod(method, paper);
    if (ok) {
      showView(VIEWS.PROTOCOL_MANAGEMENT);
    }
  }
});

const collaboration = initCollaborationManagement({
  state,
  persist,
  createId,
  safeText,
  onProtocolsImported: () => {
    refreshProtocolDependents();
    protocol.renderList();
  },
  trackGrowthEvent
});

const labCommonInventory = initLabCommonInventory({
  state,
  persist,
  createId,
  safeText
});

let sampleRegistry = null;
const personalInventory = initPersonalInventory({
  state,
  persist,
  createId,
  safeText,
  cssEscape,
  onSamplesChanged: () => {
    sampleRegistry?.render();
  }
});

sampleRegistry = initSampleRegistry({
  state,
  persist,
  safeText
});

assay = initAssay({
  state,
  persist,
  createId,
  safeText,
  onAssaysChanged: () => {
    projectManagement.renderNotebookPages();
  }
});

gel = initGelAnalysis({
  state,
  persist,
  createId,
  safeText,
  onGelAnalysesChanged: () => {
    projectManagement.renderNotebookPages();
  }
});

sequenceViewer = initSequenceViewer({
  onNavigateHome: () => {
    showView(VIEWS.SEQUENCE_VIEWER);
  },
  onNavigateDetail: () => {
    showView(SEQUENCE_VIEWER_DETAIL_VIEW_ID);
  }
});

initToolBox({
  onOpenSequenceViewer: (payload) => {
    if (!sequenceViewer?.loadFromExternal) {
      return;
    }
    sequenceViewer.loadFromExternal(payload);
    showView(SEQUENCE_VIEWER_DETAIL_VIEW_ID);
  }
});

const settings = initSettings({
  state,
  persist,
  onStoragePathSaved: async (storagePath) => {
    const result = await runStorageRootImport(storagePath, { persistMergedState: true });
    renderAll();
    return result;
  },
  onSaveEnaFile: async () => {
    if (!window.enanaApi) {
      return;
    }
    const result = await window.enanaApi.saveEnaFile(state, state.settings.enaFilePath || '');
    if (result?.ok && result.filePath) {
      state.settings.enaFilePath = result.filePath;
      persistState(state);
    }
  },
  onLoadEnaFile: async () => {
    if (!window.enanaApi) {
      return;
    }
    const result = await window.enanaApi.loadEnaFile();
    if (!result?.ok || !result.data) {
      return;
    }
    const loadedState = normalizeState(result.data);
    loadedState.settings.enaFilePath = result.filePath || loadedState.settings.enaFilePath;
    replaceState(loadedState);
    persistState(state);
    renderAll();
    showView(VIEWS.HOME);
  }
});

homeDashboard = initHomeDashboard({
  state,
  persist,
  safeText,
  onOpenSampleSearch: (query) => {
    showView(VIEWS.SAMPLE_REGISTRY);
    setSearchInputValue('sample-search', query);
  }
});

function showView(viewId) {
  const nextView = normalizeViewId(viewId);
  if (lastViewPersistenceEnabled) {
    rememberLastActiveView(nextView);
  }

  const showSampleInventoryWorkspace = nextView === VIEWS.SAMPLE_REGISTRY;
  views.forEach((view) => {
    const isSampleInventorySection = view.id === VIEWS.SAMPLE_REGISTRY || view.id === VIEWS.PERSONAL_INVENTORY;
    const active = view.id === nextView || (showSampleInventoryWorkspace && isSampleInventorySection);
    view.classList.toggle('is-active', active);
  });
  const activeNavView = nextView === SEQUENCE_VIEWER_DETAIL_VIEW_ID
    ? VIEWS.SEQUENCE_VIEWER
    : nextView;
  const activeApp = getAppForView(activeNavView);
  appNavButtons.forEach((button) => {
    const buttonView = normalizeViewId(button.dataset.view);
    button.classList.toggle('is-active', buttonView === activeNavView);
  });
  if (moreBtn) {
    moreBtn.classList.toggle('is-active', Boolean(activeApp && activeApp.placement === 'more'));
  }
  if (topbarSettingsBtn) {
    topbarSettingsBtn.classList.toggle('is-active', activeNavView === VIEWS.SETTING);
  }
  document.body.dataset.activeView = activeNavView;

  const subtitleView = nextView === SEQUENCE_VIEWER_DETAIL_VIEW_ID
    ? VIEWS.SEQUENCE_VIEWER
    : nextView;
  if (pageTitle) {
    pageTitle.textContent = activeApp?.label || 'Home';
  }
  pageSubtitle.textContent = TITLES[subtitleView] || '';
  homeBtn.hidden = nextView === VIEWS.HOME;
  closeMoreMenu();

  if (nextView === VIEWS.HOME) {
    homeDashboard?.render();
  }

  if (nextView === VIEWS.SYNTHESIS_NOTEBOOK) {
    synthesisNotebook.renderProjectOptions();
    synthesisNotebook.renderProtocolOptions();
    synthesisNotebook.renderEntries();
  }

  if (nextView === VIEWS.BIOLOGY_NOTEBOOK) {
    biologyNotebook.renderProjectOptions();
    biologyNotebook.renderProtocolOptions();
    biologyNotebook.renderEntries();
  }

  if (nextView === VIEWS.PROTOCOL_MANAGEMENT) {
    protocol.renderShareTargets();
    protocol.renderList();
  }

  if (nextView === VIEWS.SAMPLE_REGISTRY) {
    personalInventory.renderSections();
    sampleRegistry.render();
  }

  if (nextView === VIEWS.ASSAY) {
    assay.render();
  }

  if (nextView === VIEWS.GEL) {
    gel.render();
  }

  if (nextView === VIEWS.LAB_COMMON_INVENTORY) {
    labCommonInventory.renderAll();
  }

  if (nextView === VIEWS.COLLABORATION_MANAGEMENT) {
    collaboration.renderEmailSelectors();
  }

  if (nextView === VIEWS.PROJECT_MANAGEMENT) {
    projectManagement.render();
  }

  if (nextView === VIEWS.WORKFLOW_MANAGEMENT) {
    workflowManagement.render();
  }

  if (nextView === VIEWS.PAPERS) {
    papers.render();
  }

  if (nextView === VIEWS.AGENT) {
    agentChat.render();
  }

  if (nextView === VIEWS.SEQUENCE_VIEWER || nextView === SEQUENCE_VIEWER_DETAIL_VIEW_ID) {
    sequenceViewer?.render?.();
  }

  if (nextView === VIEWS.INSTRUMENT_MANAGEMENT) {
    instrumentManagement.render();
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSearchToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function tokenizeSearchQuery(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 12);
}

function scoreTextByTokens(text, queryTokens, queryLower) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack) {
    return 0;
  }

  if (!queryTokens.length) {
    return queryLower && haystack.includes(queryLower) ? 1 : 0;
  }

  let score = 0;
  queryTokens.forEach((token) => {
    if (haystack.includes(token)) {
      score += 1;
    }
  });
  if (queryLower && queryLower.length >= 3 && haystack.includes(queryLower)) {
    score += 2;
  }
  return score;
}

function getScopeTarget(scopeToken) {
  return SEARCH_SCOPE_TARGETS.get(normalizeSearchToken(scopeToken)) || null;
}

function parseTopbarSearch(rawValue) {
  const raw = String(rawValue || '').trim();
  const parsed = {
    raw,
    query: raw,
    queryLower: raw.toLowerCase(),
    tokens: tokenizeSearchQuery(raw),
    scopeToken: '',
    target: null,
    openViewId: ''
  };
  if (!raw) {
    return parsed;
  }

  // Scoped query syntax: "<scope>: <query>".
  const scopedMatch = raw.match(/^([a-z0-9][a-z0-9_\-\s]{0,30})\s*:\s*(.+)$/i);
  if (scopedMatch) {
    const scopeToken = normalizeSearchToken(scopedMatch[1]);
    const target = getScopeTarget(scopeToken);
    if (target) {
      const query = String(scopedMatch[2] || '').trim();
      parsed.scopeToken = scopeToken;
      parsed.target = target;
      parsed.query = query;
      parsed.queryLower = query.toLowerCase();
      parsed.tokens = tokenizeSearchQuery(query);
      return parsed;
    }
  }

  const [rawFirstToken = '', ...restParts] = raw.split(/\s+/);
  const firstToken = normalizeSearchToken(rawFirstToken);
  const trailingQuery = restParts.join(' ').trim();
  if (firstToken && trailingQuery) {
    const target = getScopeTarget(firstToken);
    if (target) {
      parsed.scopeToken = firstToken;
      parsed.target = target;
      parsed.query = trailingQuery;
      parsed.queryLower = trailingQuery.toLowerCase();
      parsed.tokens = tokenizeSearchQuery(trailingQuery);
      return parsed;
    }
  }

  if (firstToken && GLOBAL_VIEW_ALIASES.has(firstToken)) {
    parsed.openViewId = GLOBAL_VIEW_ALIASES.get(firstToken);
    parsed.query = trailingQuery;
    parsed.queryLower = trailingQuery.toLowerCase();
    parsed.tokens = tokenizeSearchQuery(trailingQuery);
  }
  return parsed;
}

function applySearchTarget(target, query) {
  if (!target || !target.viewId) {
    return false;
  }

  showView(target.viewId);
  if (target.inputId) {
    return setSearchInputValue(target.inputId, query);
  }
  return true;
}

function getActiveViewId() {
  const activeViews = views.filter((view) => view.classList.contains('is-active')).map((view) => view.id);
  if (activeViews.includes(VIEWS.SAMPLE_REGISTRY) || activeViews.includes(VIEWS.PERSONAL_INVENTORY)) {
    return VIEWS.SAMPLE_REGISTRY;
  }
  return activeViews[0] || VIEWS.HOME;
}

function getScopeTargetForView(viewId) {
  let fallback = null;
  for (const target of SEARCH_SCOPE_TARGETS.values()) {
    if (target.viewId !== viewId) {
      continue;
    }
    if (target.inputId) {
      return target;
    }
    if (!fallback) {
      fallback = target;
    }
  }
  return fallback;
}

function protocolSearchText(protocol) {
  const stepsText = asArray(protocol?.steps)
    .map((step) => (typeof step === 'string' ? step : step?.text || step?.instruction || step?.title || ''))
    .join(' ');
  return [
    protocol?.name,
    protocol?.purpose,
    asArray(protocol?.materials).join(' '),
    stepsText,
    protocol?.troubleshooting
  ].join(' ');
}

function buildGlobalSearchCandidates() {
  const candidates = [];
  const addCandidate = (target, text) => {
    if (!target || !target.viewId) {
      return;
    }
    const searchText = String(text || '').trim();
    if (!searchText) {
      return;
    }
    candidates.push({ target, text: searchText });
  };

  const chemicalTarget = getScopeTarget('chemicals');
  asArray(state.labInventory?.chemicals).forEach((chemical) => {
    addCandidate(chemicalTarget, [
      chemical?.name,
      chemical?.casNumber,
      chemical?.vendor,
      chemical?.catalogNumber,
      chemical?.location,
      chemical?.unitSize,
      chemical?.amountInStock
    ].join(' '));
  });

  const sampleTarget = getScopeTarget('samples');
  asArray(state.samples).forEach((sample) => {
    addCandidate(sampleTarget, [
      sample?.code,
      sample?.name,
      sample?.type,
      sample?.lot,
      sample?.concentration,
      sample?.notes
    ].join(' '));
  });

  const assayTarget = getScopeTarget('assay');
  asArray(state.assays).forEach((assayItem) => {
    addCandidate(assayTarget, [
      assayItem?.assayNumber,
      assayItem?.name,
      assayItem?.projectName,
      assayItem?.plateLabel,
      assayItem?.notebookEntryProtocolName,
      assayItem?.notes,
      asArray(assayItem?.sampleAxisValues).join(' '),
      asArray(assayItem?.concentrationAxisValues).join(' ')
    ].join(' '));
  });

  const gelTarget = getScopeTarget('gel');
  asArray(state.gelAnalyses).forEach((record) => {
    addCandidate(gelTarget, [
      record?.name,
      record?.projectName,
      record?.notebookEntryProtocolName,
      record?.analysisType,
      record?.imageName,
      record?.report?.confidence?.label,
      asArray(record?.report?.warnings).join(' ')
    ].join(' '));
  });

  const projectTarget = getScopeTarget('projects');
  asArray(state.projects).forEach((project) => {
    addCandidate(projectTarget, [project?.name, project?.description].join(' '));
  });

  const protocolTarget = getScopeTarget('protocols');
  asArray(state.protocols).forEach((protocolItem) => {
    addCandidate(protocolTarget, protocolSearchText(protocolItem));
  });

  const paperTarget = getScopeTarget('papers');
  asArray(state.papers).forEach((paper) => {
    addCandidate(paperTarget, [
      paper?.title,
      paper?.linkedName,
      paper?.summary,
      paper?.fileName
    ].join(' '));
  });

  const memberTarget = getScopeTarget('members');
  asArray(state.members).forEach((member) => {
    addCandidate(memberTarget, [
      member?.name,
      member?.position,
      member?.institutionEmail,
      member?.enanaEmail
    ].join(' '));
  });

  const instrumentTarget = getScopeTarget('instruments');
  asArray(state.instruments).forEach((instrument) => {
    addCandidate(instrumentTarget, [
      instrument?.name,
      instrument?.nickname,
      asArray(instrument?.reservations)
        .map((reservation) => [reservation?.title, reservation?.date, reservation?.notes].join(' '))
        .join(' ')
    ].join(' '));
  });

  const workflowTarget = {
    viewId: VIEWS.WORKFLOW_MANAGEMENT,
    inputId: '',
    label: 'Workflows'
  };
  asArray(state.workflows).forEach((workflow) => {
    addCandidate(workflowTarget, [workflow?.name, workflow?.description].join(' '));
  });

  const synthesisNotebookTarget = {
    viewId: VIEWS.SYNTHESIS_NOTEBOOK,
    inputId: '',
    label: 'Synthesis Notebook'
  };
  const biologyNotebookTarget = {
    viewId: VIEWS.BIOLOGY_NOTEBOOK,
    inputId: '',
    label: 'Biology Notebook'
  };
  asArray(state.notebookEntries).forEach((entry) => {
    const target = entry?.notebookType === 'biology' ? biologyNotebookTarget : synthesisNotebookTarget;
    addCandidate(target, [
      entry?.projectName,
      entry?.protocolName,
      entry?.result,
      asArray(entry?.resultFiles).join(' '),
      entry?.updatedAt
    ].join(' '));
  });

  const personalInventoryTarget = {
    viewId: VIEWS.SAMPLE_REGISTRY,
    inputId: '',
    label: 'Sample & Inventory'
  };
  // Flatten inventory containers/wells so the global matcher can route to sample/inventory workspace.
  Object.entries(state.inventory || {}).forEach(([zone, containers]) => {
    asArray(containers).forEach((container) => {
      addCandidate(personalInventoryTarget, [
        zone,
        container?.name,
        container?.type,
        container?.singleContent,
        asArray(container?.wells)
          .map((well) => (typeof well === 'string' ? well : `${well?.name || ''} ${well?.content || ''}`))
          .join(' ')
      ].join(' '));
    });
  });

  return candidates;
}

function executeTopbarSearch(rawQuery) {
  const parsed = parseTopbarSearch(rawQuery);
  if (!parsed.raw) {
    if (topbarSearchInput) {
      topbarSearchInput.title = 'Type a query and press Enter.';
    }
    return false;
  }

  if (parsed.target) {
    const applied = applySearchTarget(parsed.target, parsed.query);
    if (topbarSearchInput) {
      const canFilter = Boolean(parsed.target.inputId && parsed.query);
      topbarSearchInput.title = applied
        ? (canFilter
          ? `Opened ${parsed.target.label} and searched for "${parsed.query}".`
          : `Opened ${parsed.target.label}.`)
        : 'Search target unavailable.';
    }
    return applied;
  }

  if (parsed.openViewId) {
    showView(parsed.openViewId);
    let appliedQuery = false;
    if (parsed.query) {
      const scopedTarget = getScopeTargetForView(parsed.openViewId);
      if (scopedTarget?.inputId) {
        setSearchInputValue(scopedTarget.inputId, parsed.query);
        appliedQuery = true;
      }
    }
    if (topbarSearchInput) {
      topbarSearchInput.title = appliedQuery
        ? `Opened ${TITLES[parsed.openViewId] || 'view'} and searched for "${parsed.query}".`
        : `Opened ${TITLES[parsed.openViewId] || 'view'}.`;
    }
    return true;
  }

  const activeViewId = getActiveViewId();
  const candidates = buildGlobalSearchCandidates();
  let bestCandidate = null;
  let bestScore = 0;
  // Score all known records and route to the strongest matching module.
  candidates.forEach((candidate) => {
    let score = scoreTextByTokens(candidate.text, parsed.tokens, parsed.queryLower);
    if (!score) {
      return;
    }
    if (candidate.target.viewId === activeViewId) {
      score += 0.25;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  });

  if (bestCandidate) {
    applySearchTarget(bestCandidate.target, parsed.query);
    if (topbarSearchInput) {
      const canFilter = Boolean(bestCandidate.target.inputId && parsed.query);
      topbarSearchInput.title = canFilter
        ? `Opened ${bestCandidate.target.label} and searched for "${parsed.query}".`
        : `Opened ${bestCandidate.target.label}.`;
    }
    return true;
  }

  const activeScopeTarget = getScopeTargetForView(activeViewId);
  if (activeScopeTarget?.inputId) {
    applySearchTarget(activeScopeTarget, parsed.query);
    if (topbarSearchInput) {
      topbarSearchInput.title = `Searched in current ${activeScopeTarget.label} view.`;
    }
    return true;
  }

  const aliasViewId = GLOBAL_VIEW_ALIASES.get(normalizeSearchToken(parsed.query));
  if (aliasViewId) {
    showView(aliasViewId);
    if (topbarSearchInput) {
      topbarSearchInput.title = `Opened ${TITLES[aliasViewId] || 'view'}.`;
    }
    return true;
  }

  if (topbarSearchInput) {
    topbarSearchInput.title = `No match found for "${parsed.query}". Try "assay: keyword" or "gel: keyword".`;
  }
  return false;
}

function setSearchInputValue(inputId, value) {
  const input = document.getElementById(inputId);
  if (!input) {
    return false;
  }

  input.value = String(value || '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function handleTelegramCommand(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const type = String(payload.type || '');
  if (type === 'open-view') {
    const viewId = String(payload.viewId || '').trim();
    if (viewId) {
      showView(viewId);
    }
    return;
  }

  if (type === 'search-chemicals') {
    showView(VIEWS.LAB_COMMON_INVENTORY);
    setSearchInputValue('chemical-search', payload.query);
    return;
  }

  if (type === 'search-samples') {
    showView(VIEWS.SAMPLE_REGISTRY);
    setSearchInputValue('sample-search', payload.query);
    return;
  }

  if (type === 'search-assays') {
    showView(VIEWS.ASSAY);
    setSearchInputValue('assay-search', payload.query);
    return;
  }

  if (type === 'search-gels') {
    showView(VIEWS.GEL);
    setSearchInputValue('gel-search', payload.query);
    return;
  }

  if (type === 'global-search') {
    const scope = String(payload.scope || '').trim();
    const query = String(payload.query || '').trim();
    const searchText = scope && query
      ? `${scope}: ${query}`
      : query || scope;
    if (!searchText) {
      return;
    }
    if (topbarSearchInput) {
      topbarSearchInput.value = searchText;
    }
    executeTopbarSearch(searchText);
  }
}

function initTelegramCommandBridge() {
  if (!window.enanaApi?.onTelegramCommand) {
    return;
  }

  window.enanaApi.onTelegramCommand((payload) => {
    handleTelegramCommand(payload);
  });
}

function initNavigation() {
  appNavButtons.forEach((entry) => {
    entry.addEventListener('click', () => {
      showView(entry.dataset.view);
    });
  });

  homeBtn.addEventListener('click', () => showView(VIEWS.HOME));
  if (topbarSettingsBtn) {
    topbarSettingsBtn.addEventListener('click', () => showView(VIEWS.SETTING));
  }
  if (moreBtn) {
    moreBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMoreMenu();
    });
  }
  if (exitBtn) {
    exitBtn.addEventListener('click', () => window.close());
  }
  if (topbarSearchInput) {
    topbarSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        executeTopbarSearch(topbarSearchInput.value);
        return;
      }
      if (event.key === 'Escape') {
        topbarSearchInput.value = '';
        topbarSearchInput.title = 'Search cleared.';
      }
    });
  }
  document.addEventListener('click', (event) => {
    if (moreMenu?.hidden !== false) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && (moreMenu.contains(target) || moreBtn?.contains(target))) {
      return;
    }
    closeMoreMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMoreMenu();
    }
  });
}

window.addEventListener('enana:appearance-changed', () => {
  const activeViewId = getActiveViewId();
  showView(activeViewId);
});

function renderAll() {
  state.objectGraph = rebuildObjectGraph(state);
  labManagement.render();
  instrumentManagement.render();
  protocol.renderShareTargets();
  protocol.renderList();
  projectManagement.render();
  workflowManagement.render();
  collaboration.renderEmailSelectors();
  labCommonInventory.renderAll();
  synthesisNotebook.renderProjectOptions();
  synthesisNotebook.renderProtocolOptions();
  synthesisNotebook.renderEntries();
  biologyNotebook.renderProjectOptions();
  biologyNotebook.renderProtocolOptions();
  biologyNotebook.renderEntries();
  personalInventory.renderSections();
  sampleRegistry.render();
  assay.render();
  gel.render();
  settings.renderForms();
  settings.applyAppearance();
  homeDashboard?.render();
  papers.render();
  agentChat.render();
}

async function hydrateStateFromDataFile() {
  if (state.settings?.startup?.autoLoadDataFileOnLaunch === false) {
    return;
  }
  if (!window.enanaApi?.autoLoadDataFile) {
    return;
  }

  const preferredPath = typeof state.settings?.enaFilePath === 'string' ? state.settings.enaFilePath : '';
  const result = await window.enanaApi.autoLoadDataFile(preferredPath);
  if (!result?.ok) {
    return;
  }

  if (result.filePath && state.settings.enaFilePath !== result.filePath) {
    state.settings.enaFilePath = result.filePath;
  }

  if (result.data && typeof result.data === 'object') {
    const loadedState = normalizeState(result.data);
    loadedState.settings.enaFilePath = result.filePath || loadedState.settings.enaFilePath;
    replaceState(loadedState);
  }

  persistState(state);
}

async function hydrateStateFromStorageRoot() {
  const storagePath = String(state.settings?.storagePath || '').trim();
  if (!storagePath) {
    return;
  }
  await runStorageRootImport(storagePath, { persistMergedState: false });
}

async function initApp() {
  await hydrateStateFromDataFile();
  await hydrateStateFromStorageRoot();
  applyAppearanceSnapshot(state.settings?.appearance);
  renderAppNavigation();
  initNavigation();
  initTelegramCommandBridge();
  renderAll();
  lastViewPersistenceEnabled = true;
  showView(resolveStartupViewId());
}

initApp();
