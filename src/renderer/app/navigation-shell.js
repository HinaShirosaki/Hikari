import { applyAppearanceToDocument } from '../modules/app-state/appearance.js';
import { createAppDock } from './navigation-shell/app-dock.js';
import { createSearchSuggestions } from './navigation-shell/search-suggestions.js';

const LAST_ACTIVE_VIEW_STORAGE_KEY = 'hikari_last_active_view_v1';

export function normalizeViewId(VIEWS, viewId) {
  return viewId === VIEWS.PERSONAL_INVENTORY ? VIEWS.SAMPLE_REGISTRY : viewId;
}

export function applyAppearanceSnapshot(appearance, rootDocument = document) {
  return applyAppearanceToDocument(appearance, rootDocument, 16);
}

function createNavigationAliasMap(aliases, normalize) {
  const entries = aliases instanceof Map
    ? Array.from(aliases.entries())
    : Array.isArray(aliases)
      ? aliases
      : Object.entries(aliases || {});
  return new Map(entries
    .map(([sourceViewId, navigationViewId]) => [
      normalize(sourceViewId),
      normalize(navigationViewId)
    ])
    .filter(([sourceViewId, navigationViewId]) => sourceViewId && navigationViewId));
}

export function createNavigationShell({
  VIEWS,
  TITLES,
  APP_DOCK_ORDER,
  APP_REGISTRY,
  navigationViewAliases,
  moduleRuntime,
  sharedLeftRailRuntime,
  executeTopbarSearch,
  getSearchSuggestions = () => [],
  applySearchSuggestion = () => false,
  documentObject = document,
  windowObject = window
}) {
  const normalize = (viewId) => normalizeViewId(VIEWS, viewId);
  const navigationAliases = createNavigationAliasMap(navigationViewAliases, normalize);
  const resolveNavigationViewId = (viewId) => {
    const normalizedViewId = normalize(viewId);
    return navigationAliases.get(normalizedViewId) || normalizedViewId;
  };
  const appsById = new Map(APP_REGISTRY.map((app) => [app.id, app]));
  const appsByViewId = new Map(APP_REGISTRY.map((app) => [normalize(app.viewId), app]));
  const navigationApps = APP_REGISTRY.filter((app) => app.hiddenFromNavigation !== true);
  const validStartupViewIds = new Set(navigationApps.map((app) => normalize(app.viewId)));
  const dockApps = APP_DOCK_ORDER
    .map((id) => appsById.get(id))
    .filter((app) => app && app.hiddenFromNavigation !== true);
  const moreApps = navigationApps.filter((app) => !APP_DOCK_ORDER.includes(app.id));
  const expandedDockApps = [...dockApps, ...moreApps];

  const pageTitle = documentObject.getElementById('page-title');
  const pageSubtitle = documentObject.getElementById('page-subtitle');
  const topbarViewActions = documentObject.getElementById('topbar-view-actions');
  const topbarAssayModeSwitch = documentObject.getElementById('topbar-assay-mode-switch');
  const topbarAssayModeNote = documentObject.getElementById('assay-mode-note');
  const topbarNotebookAddProjectBtn = documentObject.getElementById('biology-notebook-header-add-project-btn');
  const exitBtn = documentObject.getElementById('exit-btn');
  const topbarSearchInput = documentObject.getElementById('topbar-search');
  const topbarSearchSuggestions = documentObject.getElementById('topbar-search-suggestions');
  const dockNav = documentObject.getElementById('app-dock-nav');
  const appDockDivider = documentObject.querySelector('.app-dock-divider');
  const moreBtn = documentObject.getElementById('app-more-btn');
  const moreMenu = documentObject.getElementById('app-more-menu');
  const agentChatRail = documentObject.getElementById('universal-agent-chat-rail');
  const agentChatRailToggleBtn = documentObject.getElementById('agent-chat-rail-toggle-btn');
  const views = [...documentObject.querySelectorAll('.view')];

  let lastViewPersistenceEnabled = false;
  let agentChatRailExpanded = false;

  function isValidStartupViewId(viewId) {
    return validStartupViewIds.has(normalize(String(viewId || '').trim()));
  }

  function rememberLastActiveView(viewId) {
    if (!isValidStartupViewId(viewId)) {
      return;
    }
    try {
      windowObject.localStorage.setItem(LAST_ACTIVE_VIEW_STORAGE_KEY, normalize(viewId));
    } catch {}
  }

  function readLastActiveView() {
    try {
      const storedViewId = String(windowObject.localStorage.getItem(LAST_ACTIVE_VIEW_STORAGE_KEY) || '').trim();
      if (!isValidStartupViewId(storedViewId)) {
        return '';
      }
      return normalize(storedViewId);
    } catch {
      return '';
    }
  }

  function resolveStartupViewId(state) {
    const startupSettings = state.settings?.startup || {};
    const configuredDefaultView = String(startupSettings.defaultViewId || '').trim();
    const defaultViewId = isValidStartupViewId(configuredDefaultView)
      ? normalize(configuredDefaultView)
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
    return appsByViewId.get(resolveNavigationViewId(viewId)) || null;
  }

  function isAgentChatRailEnabledForView(viewId) {
    const app = getAppForView(viewId);
    return app?.agentChatRail === true;
  }

  function agentChatRailToggleIcon(expanded) {
    if (expanded) {
      return `
        <svg class="universal-agent-chat-rail__toggle-icon" viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5"></rect>
          <path d="M14.5 4.5v15"></path>
          <path d="m7.25 9.5 2.5 2.5-2.5 2.5"></path>
        </svg>
      `;
    }
    return `
      <svg class="universal-agent-chat-rail__toggle-icon" viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
        <path d="M6.5 4.5h11a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-7l-3.5 3.25V15.5h-.5a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z"></path>
        <path d="M8.5 10h.01M12 10h.01M15.5 10h.01"></path>
      </svg>
    `;
  }

  function syncAgentChatRailExpansion(enabled) {
    const expanded = enabled && agentChatRailExpanded;
    documentObject.body.classList.toggle('has-agent-chat-rail-expanded', expanded);
    if (agentChatRail) {
      agentChatRail.classList.toggle('is-expanded', expanded);
      agentChatRail.classList.toggle('is-collapsed', enabled && !expanded);
      agentChatRail.dataset.state = expanded ? 'expanded' : 'collapsed';
    }
    if (agentChatRailToggleBtn) {
      agentChatRailToggleBtn.innerHTML = agentChatRailToggleIcon(expanded);
      agentChatRailToggleBtn.setAttribute('aria-expanded', String(expanded));
      const label = expanded ? 'Fold agent chat rail' : 'Open agent chat rail';
      agentChatRailToggleBtn.setAttribute('aria-label', label);
      agentChatRailToggleBtn.title = expanded ? 'Fold chat' : 'Open chat';
    }
    return expanded;
  }

  function setAgentChatRailExpanded(expanded) {
    agentChatRailExpanded = Boolean(expanded);
    const enabled = documentObject.body.classList.contains('has-agent-chat-rail');
    const visibleExpanded = syncAgentChatRailExpansion(enabled);
    if (visibleExpanded) {
      moduleRuntime.renderAgentChatRail?.();
    }
    sharedLeftRailRuntime.syncWidth();
  }

  function openAgentChatRail() {
    setAgentChatRailExpanded(true);
  }

  function syncAgentChatRailState(activeViewId) {
    const enabled = isAgentChatRailEnabledForView(activeViewId);
    documentObject.body.classList.toggle('has-agent-chat-rail', enabled);
    if (agentChatRail) {
      agentChatRail.hidden = !enabled;
      agentChatRail.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    }
    return syncAgentChatRailExpansion(enabled);
  }


  const {
    getRenderedDockApps,
    getDockCapacity,
    closeMoreMenu,
    toggleMoreMenu,
    renderAppNavigation,
    syncNavigationState
  } = createAppDock({
    documentObject,
    windowObject,
    TITLES,
    dockNav,
    appDockDivider,
    moreBtn,
    moreMenu,
    pageTitle,
    pageSubtitle,
    dockApps,
    moreApps,
    expandedDockApps,
    normalize,
    getActiveViewId,
    getAppForView,
    resolveNavigationViewId
  });

  const {
    closeSearchSuggestions,
    refreshSearchSuggestions,
    moveSearchSuggestionFocus,
    selectSearchSuggestion,
    setSuggestionActiveIndex,
    getSuggestionsState
  } = createSearchSuggestions({
    documentObject,
    topbarSearchInput,
    topbarSearchSuggestions,
    getSearchSuggestions,
    applySearchSuggestion
  });

  function setSearchInputValue(inputId, value) {
    const input = documentObject.getElementById(inputId);
    if (!input) {
      return false;
    }

    input.value = String(value || '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function getActiveViewId() {
    const activeViews = views.filter((view) => view.classList.contains('is-active')).map((view) => view.id);
    if (activeViews.includes(VIEWS.SAMPLE_REGISTRY) || activeViews.includes(VIEWS.PERSONAL_INVENTORY)) {
      return VIEWS.SAMPLE_REGISTRY;
    }
    return activeViews[0] || VIEWS.HOME;
  }

  function syncSharedLeftRailShellChrome() {
    const activeView = views.find((view) => view.classList.contains('is-active')) || null;
    const railShells = Array.from(activeView?.querySelectorAll?.('.left-rail-template') || []);
    const visibleRailShell = railShells.find((shell) => !shell.closest('[hidden]')) || null;
    const hasSharedLeftRailView = Boolean(visibleRailShell?.querySelector?.('[data-sync-left-rail]'));
    documentObject.body.classList.toggle('has-shared-left-rail-view', hasSharedLeftRailView);
    documentObject.body.classList.toggle(
      'has-folded-shared-left-rail',
      hasSharedLeftRailView && visibleRailShell?.classList.contains('is-left-rail-folded')
    );
  }



  function showView(viewId) {
    const nextView = normalize(viewId);
    if (lastViewPersistenceEnabled) {
      rememberLastActiveView(nextView);
    }
    documentObject.body.classList.toggle('agent-view-fixed-scroll', nextView === VIEWS.AGENT);
    if (nextView !== VIEWS.SEQUENCE_VIEWER) {
      documentObject.body.classList.remove('sequence-viewer-fixed-scroll');
    }

    const showContainerWorkspace = nextView === VIEWS.SAMPLE_REGISTRY;
    views.forEach((view) => {
      const active = showContainerWorkspace
        ? view.id === VIEWS.PERSONAL_INVENTORY
        : view.id === nextView;
      view.classList.toggle('is-active', active);
    });

    const activeNavView = resolveNavigationViewId(nextView);
    const activeApp = getAppForView(activeNavView);
    const agentChatRailEnabled = syncAgentChatRailState(activeNavView);
    const dockCapacity = getDockCapacity();
    const activeVisibleInDock = Boolean(activeApp && getRenderedDockApps().some((app) => app.id === activeApp.id));
    if (activeApp && APP_DOCK_ORDER.includes(activeApp.id) && !activeVisibleInDock && dockCapacity < dockApps.length) {
      renderAppNavigation();
    }
    syncNavigationState(activeNavView);

    const subtitleView = activeNavView;
    if (pageTitle) {
      pageTitle.textContent = activeApp?.label || 'Home';
    }
    if (pageSubtitle) {
      pageSubtitle.textContent = TITLES[subtitleView] || '';
    }
    if (topbarViewActions) {
      const isAssay = nextView === VIEWS.ASSAY;
      const isNotebook = nextView === VIEWS.BIOLOGY_NOTEBOOK;
      topbarViewActions.hidden = !isAssay && !isNotebook;
      if (topbarAssayModeSwitch) {
        topbarAssayModeSwitch.hidden = !isAssay;
      }
      if (topbarAssayModeNote) {
        topbarAssayModeNote.hidden = !isAssay;
      }
      if (topbarNotebookAddProjectBtn) {
        topbarNotebookAddProjectBtn.hidden = !isNotebook;
      }
    }
    closeMoreMenu();
    moduleRuntime.renderView(nextView);
    if (agentChatRailEnabled) {
      moduleRuntime.renderAgentChatRail?.();
    }
    sharedLeftRailRuntime.ensureHandles();
    sharedLeftRailRuntime.syncWidth();
    syncSharedLeftRailShellChrome();
  }

  function initNavigation() {
    const handleNavClick = (event) => {
      const target = event.target;
      const button = target instanceof Element ? target.closest('.app-nav-btn[data-view]') : null;
      if (button instanceof HTMLElement) {
        showView(button.dataset.view);
      }
    };
    dockNav?.addEventListener('click', handleNavClick);
    moreMenu?.addEventListener('click', handleNavClick);
    moreBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMoreMenu();
    });
    agentChatRailToggleBtn?.addEventListener('click', () => {
      setAgentChatRailExpanded(!agentChatRailExpanded);
    });
    documentObject.addEventListener('hikari:open-agent-chat-rail', openAgentChatRail);
    exitBtn?.addEventListener('click', () => windowObject.close());
    if (topbarSearchInput) {
      topbarSearchInput.setAttribute('role', 'combobox');
      topbarSearchInput.setAttribute('aria-autocomplete', 'list');
      topbarSearchInput.setAttribute('aria-expanded', 'false');
      topbarSearchInput.setAttribute('aria-controls', 'topbar-search-suggestions');
      topbarSearchInput.setAttribute('autocomplete', 'off');
    }
    topbarSearchInput?.addEventListener('input', () => {
      refreshSearchSuggestions();
    });
    topbarSearchInput?.addEventListener('focus', () => {
      if ((topbarSearchInput.value || '').trim()) {
        refreshSearchSuggestions();
      }
    });
    topbarSearchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        if (!getSuggestionsState().open) {
          refreshSearchSuggestions();
        } else {
          moveSearchSuggestionFocus(1);
        }
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowUp') {
        if (getSuggestionsState().open) {
          moveSearchSuggestionFocus(-1);
          event.preventDefault();
        }
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (getSuggestionsState().open && getSuggestionsState().activeIndex >= 0) {
          selectSearchSuggestion(getSuggestionsState().activeIndex);
          return;
        }
        closeSearchSuggestions();
        executeTopbarSearch(topbarSearchInput.value);
        return;
      }
      if (event.key === 'Escape') {
        if (getSuggestionsState().open) {
          closeSearchSuggestions();
          event.preventDefault();
          return;
        }
        topbarSearchInput.value = '';
        topbarSearchInput.title = 'Search cleared.';
      }
    });
    topbarSearchSuggestions?.addEventListener('mousedown', (event) => {
      const item = event.target instanceof Element
        ? event.target.closest('[data-index]')
        : null;
      if (!item) {
        return;
      }
      event.preventDefault();
      const index = Number(item.dataset.index);
      if (Number.isFinite(index)) {
        selectSearchSuggestion(index);
      }
    });
    topbarSearchSuggestions?.addEventListener('mouseover', (event) => {
      const item = event.target instanceof Element
        ? event.target.closest('[data-index]')
        : null;
      if (!item) {
        return;
      }
      const index = Number(item.dataset.index);
      if (Number.isFinite(index) && index !== getSuggestionsState().activeIndex) {
        setSuggestionActiveIndex(index);
      }
    });
    documentObject.addEventListener('click', (event) => {
      const target = event.target;
      if (getSuggestionsState().open) {
        const insideSuggestions = target instanceof Node
          && (topbarSearchSuggestions?.contains(target) || topbarSearchInput?.contains(target));
        if (!insideSuggestions) {
          closeSearchSuggestions();
        }
      }
      if (moreMenu?.hidden !== false) {
        return;
      }
      if (target instanceof Node && (moreMenu.contains(target) || moreBtn?.contains(target))) {
        return;
      }
      closeMoreMenu();
    });
    documentObject.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeMoreMenu();
      }
    });

    const syncResponsiveDock = () => {
      renderAppNavigation();
      syncNavigationState(getActiveViewId());
      sharedLeftRailRuntime.ensureHandles();
      sharedLeftRailRuntime.syncWidth();
      syncSharedLeftRailShellChrome();
    };
    windowObject.addEventListener('resize', syncResponsiveDock);
    if (typeof windowObject.ResizeObserver === 'function') {
      const responsiveDockObserver = new windowObject.ResizeObserver(() => {
        syncResponsiveDock();
      });
      responsiveDockObserver.observe(documentObject.documentElement);
    }
    if (typeof windowObject.MutationObserver === 'function') {
      const workspaceMain = documentObject.querySelector('.workspace-main');
      if (workspaceMain) {
        const hiddenObserver = new windowObject.MutationObserver(() => {
          syncSharedLeftRailShellChrome();
        });
        hiddenObserver.observe(workspaceMain, {
          subtree: true,
          attributes: true,
          attributeFilter: ['hidden']
        });
      }
    }
  }

  function enableLastViewPersistence() {
    lastViewPersistenceEnabled = true;
  }

  windowObject.addEventListener('hikari:appearance-changed', () => {
    showView(getActiveViewId());
  });

  return {
    applyAppearanceSnapshot: (appearance) => applyAppearanceSnapshot(appearance, documentObject),
    enableLastViewPersistence,
    getActiveViewId,
    initNavigation,
    normalizeViewId: normalize,
    openAgentChatRail,
    renderAppNavigation,
    resolveStartupViewId,
    setSearchInputValue,
    showView,
    topbarSearchInput
  };
}
