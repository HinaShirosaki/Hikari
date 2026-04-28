const LAST_ACTIVE_VIEW_STORAGE_KEY = 'enana_last_active_view_v1';
const FIXED_ACCENT = '#647255';
const FIXED_FOCUS = '#7a8a69';

export function normalizeViewId(VIEWS, viewId) {
  return viewId === VIEWS.PERSONAL_INVENTORY ? VIEWS.SAMPLE_REGISTRY : viewId;
}

export function applyAppearanceSnapshot(appearance, rootDocument = document) {
  const root = rootDocument.documentElement;
  const resolved = appearance && typeof appearance === 'object' ? appearance : {};
  const fontSize = Number(resolved.fontSize) || 16;
  const mode = resolved.mode === 'night' ? 'night' : 'day';

  root.style.setProperty('--accent', FIXED_ACCENT);
  root.style.setProperty('--focus', FIXED_FOCUS);
  root.style.setProperty('--app-font-size', `${fontSize}px`);
  root.style.setProperty('font-size', `${fontSize}px`);
  rootDocument.body.classList.toggle('theme-night', mode === 'night');
  rootDocument.body.classList.add('ui-neutral-compact');
}

export function createNavigationShell({
  VIEWS,
  TITLES,
  APP_DOCK_ORDER,
  APP_REGISTRY,
  sequenceViewerDetailViewId,
  moduleRuntime,
  sharedLeftRailRuntime,
  executeTopbarSearch,
  documentObject = document,
  windowObject = window
}) {
  const normalize = (viewId) => normalizeViewId(VIEWS, viewId);
  const appsById = new Map(APP_REGISTRY.map((app) => [app.id, app]));
  const appsByViewId = new Map(APP_REGISTRY.map((app) => [normalize(app.viewId), app]));
  const validStartupViewIds = new Set(APP_REGISTRY.map((app) => normalize(app.viewId)));
  const dockApps = APP_DOCK_ORDER
    .map((id) => appsById.get(id))
    .filter(Boolean);
  const moreApps = APP_REGISTRY.filter((app) => !APP_DOCK_ORDER.includes(app.id));
  const expandedDockApps = [...dockApps, ...moreApps];

  const pageTitle = documentObject.getElementById('page-title');
  const pageSubtitle = documentObject.getElementById('page-subtitle');
  const topbarViewActions = documentObject.getElementById('topbar-view-actions');
  const exitBtn = documentObject.getElementById('exit-btn');
  const topbarSearchInput = documentObject.getElementById('topbar-search');
  const dockNav = documentObject.getElementById('app-dock-nav');
  const appDockDivider = documentObject.querySelector('.app-dock-divider');
  const moreBtn = documentObject.getElementById('app-more-btn');
  const moreMenu = documentObject.getElementById('app-more-menu');
  const views = [...documentObject.querySelectorAll('.view')];

  let appNavButtons = [];
  let renderedDockApps = dockApps;
  let renderedOverflowApps = moreApps;
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
    return appsByViewId.get(normalize(viewId)) || null;
  }

  function createInlineIcon(iconMarkup) {
    const icon = documentObject.createElement('span');
    icon.className = 'app-nav-icon';
    icon.setAttribute('aria-hidden', 'true');
    if (iconMarkup) {
      const template = documentObject.createElement('template');
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
    const button = documentObject.createElement('button');
    button.type = 'button';
    button.className = menu ? 'app-nav-btn app-more-item' : 'app-nav-btn app-dock-btn';
    button.dataset.view = app.viewId;
    button.dataset.appId = app.id;
    button.dataset.label = app.label;
    button.title = app.label;
    button.setAttribute('aria-label', app.label);
    if (menu) {
      button.setAttribute('role', 'menuitem');
    }

    const icon = createInlineIcon(app.iconMarkup);
    button.append(icon);

    const label = documentObject.createElement('span');
    label.className = menu ? 'app-more-label' : 'sr-only';
    label.textContent = app.label;
    button.append(label);
    return button;
  }

  function getDockCapacity() {
    const viewportWidth = windowObject.innerWidth || documentObject.documentElement?.clientWidth || 0;
    const topbar = documentObject.querySelector('.topbar');
    const dockViewportMargin = viewportWidth <= 960 ? 20 : 32;
    const dockHostWidth = topbar?.clientWidth || viewportWidth;
    const effectiveWidth = Math.min(
      Math.max(240, Math.floor(viewportWidth <= 960 ? dockHostWidth - dockViewportMargin : viewportWidth * 0.56)),
      Math.max(240, dockHostWidth - (viewportWidth <= 960 ? dockViewportMargin : 360)),
      Math.max(240, viewportWidth - dockViewportMargin)
    );
    if (!effectiveWidth) {
      return dockApps.length;
    }
    const dockHorizontalPadding = viewportWidth <= 720 ? 20 : 24;
    const dividerWidth = 1;
    const moreButtonWidth = viewportWidth <= 720 ? 34 : 36;
    const dockButtonWidth = viewportWidth <= 720 ? 42 : 46;
    const dockGap = 6;
    const navGapCountFor = (count) => Math.max(0, count - 1);
    const navWidthFor = (count) => (count * dockButtonWidth) + (navGapCountFor(count) * dockGap);
    const fullWidthWithoutMore = navWidthFor(expandedDockApps.length) + dockHorizontalPadding;

    if (fullWidthWithoutMore <= effectiveWidth) {
      return expandedDockApps.length;
    }

    let count = expandedDockApps.length;
    while (count > 1) {
      const requiredWidth = navWidthFor(count) + dockHorizontalPadding + dividerWidth + moreButtonWidth + (dockGap * 2);
      if (requiredWidth <= effectiveWidth) {
        return count;
      }
      count -= 1;
    }

    return 1;
  }

  function getRenderedDockState() {
    const capacity = getDockCapacity();
    const activeViewId = getActiveViewId();
    const activeApp = getAppForView(activeViewId);
    let visibleApps = expandedDockApps.slice(0, capacity);
    if (capacity < expandedDockApps.length && activeApp && expandedDockApps.some((app) => app.id === activeApp.id)) {
      const alreadyVisible = visibleApps.some((app) => app.id === activeApp.id);
      if (!alreadyVisible && visibleApps.length) {
        visibleApps = [...visibleApps.slice(0, -1), activeApp]
          .sort((left, right) => expandedDockApps.indexOf(left) - expandedDockApps.indexOf(right));
      }
    }
    const visibleIds = new Set(visibleApps.map((app) => app.id));
    const overflowApps = expandedDockApps.filter((app) => !visibleIds.has(app.id));
    return { visibleApps, overflowApps };
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
    const { visibleApps, overflowApps } = getRenderedDockState();
    renderedDockApps = visibleApps;
    renderedOverflowApps = overflowApps;
    dockNav?.replaceChildren(...visibleApps.map((app) => createNavButton(app)));
    moreMenu?.replaceChildren(...overflowApps.map((app) => createNavButton(app, { menu: true })));
    appNavButtons = [...documentObject.querySelectorAll('.app-nav-btn[data-view]')];
    if (moreBtn) {
      moreBtn.hidden = overflowApps.length === 0;
    }
    if (appDockDivider) {
      appDockDivider.hidden = overflowApps.length === 0;
    }
  }

  function syncNavigationState(activeViewId) {
    const activeNavView = activeViewId === sequenceViewerDetailViewId
      ? VIEWS.SEQUENCE_VIEWER
      : activeViewId;
    const activeApp = getAppForView(activeNavView);
    appNavButtons.forEach((button) => {
      const buttonView = normalize(button.dataset.view);
      button.classList.toggle('is-active', buttonView === activeNavView);
    });
    if (moreBtn) {
      const isOverflowActive = Boolean(activeApp && renderedOverflowApps.some((app) => app.id === activeApp.id));
      moreBtn.classList.toggle('is-active', isOverflowActive);
    }
    documentObject.body.dataset.activeView = activeNavView;
    if (pageTitle) {
      pageTitle.textContent = activeApp?.label || 'Home';
    }
    if (pageSubtitle) {
      pageSubtitle.textContent = TITLES[activeNavView] || '';
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

  function syncSharedLeftRailShellChrome() {
    const activeView = views.find((view) => view.classList.contains('is-active')) || null;
    const activeRailShell = activeView?.querySelector?.('.left-rail-template') || null;
    const hasSharedLeftRailView = Boolean(activeRailShell?.querySelector?.('[data-sync-left-rail]'));
    documentObject.body.classList.toggle('has-shared-left-rail-view', hasSharedLeftRailView);
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

    const showSampleInventoryWorkspace = nextView === VIEWS.SAMPLE_REGISTRY;
    views.forEach((view) => {
      const active = showSampleInventoryWorkspace
        ? view.id === VIEWS.PERSONAL_INVENTORY
        : view.id === nextView;
      view.classList.toggle('is-active', active);
    });

    const activeNavView = nextView === sequenceViewerDetailViewId ? VIEWS.SEQUENCE_VIEWER : nextView;
    const activeApp = getAppForView(activeNavView);
    const dockCapacity = getDockCapacity();
    const activeVisibleInDock = Boolean(activeApp && renderedDockApps.some((app) => app.id === activeApp.id));
    if (activeApp && APP_DOCK_ORDER.includes(activeApp.id) && !activeVisibleInDock && dockCapacity < dockApps.length) {
      renderAppNavigation();
    }
    syncNavigationState(activeNavView);

    const subtitleView = nextView === sequenceViewerDetailViewId ? VIEWS.SEQUENCE_VIEWER : nextView;
    if (pageTitle) {
      pageTitle.textContent = activeApp?.label || 'Home';
    }
    if (pageSubtitle) {
      pageSubtitle.textContent = TITLES[subtitleView] || '';
    }
    if (topbarViewActions) {
      topbarViewActions.hidden = nextView !== VIEWS.ASSAY;
    }
    closeMoreMenu();
    moduleRuntime.renderView(nextView);
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
    exitBtn?.addEventListener('click', () => windowObject.close());
    topbarSearchInput?.addEventListener('keydown', (event) => {
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
    documentObject.addEventListener('click', (event) => {
      if (moreMenu?.hidden !== false) {
        return;
      }
      const target = event.target;
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
  }

  function enableLastViewPersistence() {
    lastViewPersistenceEnabled = true;
  }

  windowObject.addEventListener('enana:appearance-changed', () => {
    showView(getActiveViewId());
  });

  return {
    applyAppearanceSnapshot: (appearance) => applyAppearanceSnapshot(appearance, documentObject),
    enableLastViewPersistence,
    getActiveViewId,
    initNavigation,
    normalizeViewId: normalize,
    renderAppNavigation,
    resolveStartupViewId,
    setSearchInputValue,
    showView,
    topbarSearchInput
  };
}
