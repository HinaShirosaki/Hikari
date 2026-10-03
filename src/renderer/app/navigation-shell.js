import { applyAppearanceToDocument } from './appearance.js';
import { createAppDock } from './navigation-shell/app-dock.js';
import { createAgentChatRail } from './navigation-shell/agent-rail.js';
import { createSearchSuggestions } from './navigation-shell/search-suggestions.js';
import { runSearchInput } from '../lib/search-field-lens.js';
import { AGENT_AVAILABILITY_EVENT, isAgentAvailable, isAgentOffline } from '../lib/agent-availability.js';

export { isAgentChatRailAvailable } from './navigation-shell/agent-rail.js';

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
  const exitBtn = documentObject.getElementById('exit-btn');
  const topbarSearchInput = documentObject.getElementById('topbar-search');
  const topbarSearchToggle = documentObject.getElementById('topbar-search-toggle');
  const topbarSearchShell = documentObject.querySelector('.topbar-search-shell');
  const topbarSearchSuggestions = documentObject.getElementById('topbar-search-suggestions');
  const dockNav = documentObject.getElementById('app-dock-nav');
  const appDockDivider = documentObject.querySelector('.app-dock-divider');
  const moreBtn = documentObject.getElementById('app-more-btn');
  const moreMenu = documentObject.getElementById('app-more-menu');
  const views = [...documentObject.querySelectorAll('.view')];

  let lastViewPersistenceEnabled = false;

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

  const {
    closeMoreMenu,
    toggleMoreMenu,
    handleMoreMenuKeydown,
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
    expandedDockApps,
    isAppShown: (app) => app.viewId !== VIEWS.AGENT || isAgentAvailable(documentObject),
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

  function setSearchExpanded(expanded, { restoreFocus = false } = {}) {
    if (!topbarSearchShell || !topbarSearchInput || !topbarSearchToggle) {
      return;
    }
    topbarSearchShell.classList.toggle('is-expanded', expanded);
    topbarSearchToggle.setAttribute('aria-expanded', String(expanded));
    topbarSearchToggle.setAttribute('aria-label', expanded ? 'Search' : 'Open search');
    topbarSearchInput.inert = !expanded;
    topbarSearchInput.setAttribute('aria-hidden', String(!expanded));
    if (expanded) {
      topbarSearchInput.focus({ preventScroll: true });
    } else {
      closeSearchSuggestions();
      if (restoreFocus) {
        topbarSearchToggle.focus({ preventScroll: true });
      }
    }
  }

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

  const agentChatRailRuntime = createAgentChatRail({
    VIEWS,
    documentObject,
    getActiveViewId,
    getAppForView,
    resolveNavigationViewId,
    moduleRuntime,
    sharedLeftRailRuntime
  });

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
    const requestedView = normalize(viewId);
    const nextView = requestedView === VIEWS.AGENT && isAgentOffline(documentObject) ? VIEWS.HOME : requestedView;
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
    const agentChatRailEnabled = agentChatRailRuntime.syncState(activeNavView);

    const subtitleView = activeNavView;
    if (pageTitle && !pageTitle.classList?.contains?.('topbar-timekeeping')) {
      pageTitle.textContent = 'Hikari';
    }
    if (pageSubtitle) {
      pageSubtitle.textContent = TITLES[subtitleView] || '';
    }
    renderAppNavigation(activeNavView);
    syncNavigationState(activeNavView);
    closeMoreMenu();
    moduleRuntime.renderView(nextView);
    if (agentChatRailEnabled) {
      moduleRuntime.renderAgentChatRail?.();
    }
    sharedLeftRailRuntime.ensureHandles();
    sharedLeftRailRuntime.syncWidth();
    syncSharedLeftRailShellChrome();
  }

  function syncAgentAvailability() {
    const activeViewId = getActiveViewId();
    if (activeViewId === VIEWS.AGENT && isAgentOffline(documentObject)) {
      showView(VIEWS.HOME);
      return;
    }
    // Connection changes affect shell chrome, not the active editor's draft.
    const activeNavView = resolveNavigationViewId(activeViewId);
    const expanded = agentChatRailRuntime.syncState(activeNavView);
    renderAppNavigation(activeNavView);
    syncNavigationState(activeNavView);
    closeMoreMenu();
    // Only an open list is refreshed; collapsed search keeps its text and must stay closed.
    if (getSuggestionsState().open) refreshSearchSuggestions();
    if (expanded) moduleRuntime.renderAgentChatRail?.();
    sharedLeftRailRuntime.ensureHandles();
    sharedLeftRailRuntime.syncWidth();
    syncSharedLeftRailShellChrome();
  }

  function initNavigation() {
    const handleNavClick = (event) => {
      const target = event.target;
      const button = target instanceof Element ? target.closest('.app-nav-btn[data-view]') : null;
      if (button instanceof HTMLElement) {
        const fromMenu = moreMenu?.contains(button);
        showView(button.dataset.view);
        if (fromMenu) {
          (dockNav?.querySelector('.is-active') || moreBtn)?.focus();
        }
      }
    };
    dockNav?.addEventListener('click', handleNavClick);
    moreMenu?.addEventListener('click', handleNavClick);
    moreMenu?.addEventListener('keydown', handleMoreMenuKeydown);
    moreBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMoreMenu();
    });
    moreBtn?.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        toggleMoreMenu(true);
      }
    });
    agentChatRailRuntime.init();
    documentObject.addEventListener(AGENT_AVAILABILITY_EVENT, syncAgentAvailability);
    exitBtn?.addEventListener('click', () => windowObject.close());
    if (topbarSearchInput) {
      topbarSearchInput.setAttribute('role', 'combobox');
      topbarSearchInput.setAttribute('aria-autocomplete', 'list');
      topbarSearchInput.setAttribute('aria-expanded', 'false');
      topbarSearchInput.setAttribute('aria-controls', 'topbar-search-suggestions');
      topbarSearchInput.setAttribute('autocomplete', 'off');
    }
    topbarSearchToggle?.addEventListener('click', () => {
      if (!topbarSearchShell?.classList.contains('is-expanded')) {
        closeMoreMenu();
        setSearchExpanded(true);
      } else {
        runSearchInput(topbarSearchInput);
      }
    });
    topbarSearchShell?.addEventListener('focusout', (event) => {
      if (event.relatedTarget && !topbarSearchShell.contains(event.relatedTarget)) {
        setSearchExpanded(false);
      }
    });
    topbarSearchShell?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && topbarSearchShell.classList.contains('is-expanded')) {
        event.preventDefault();
        setSearchExpanded(false, { restoreFocus: true });
      }
    });
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
      if (target instanceof Node && !topbarSearchShell?.contains(target)) {
        setSearchExpanded(false);
      }
      if (getSuggestionsState().open) {
        const insideSuggestions = target instanceof Node
          && topbarSearchShell?.contains(target);
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
      if (event.key === 'Escape' && moreMenu?.hidden === false) {
        event.preventDefault();
        closeMoreMenu({ restoreFocus: true });
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
    openAgentChatRail: agentChatRailRuntime.open,
    renderAppNavigation,
    resolveStartupViewId,
    setSearchInputValue,
    showView,
    topbarSearchInput
  };
}
