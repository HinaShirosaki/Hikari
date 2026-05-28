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
  getSearchSuggestions = () => [],
  applySearchSuggestion = () => false,
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
  const topbarSearchSuggestions = documentObject.getElementById('topbar-search-suggestions');
  const dockNav = documentObject.getElementById('app-dock-nav');
  const appDockDivider = documentObject.querySelector('.app-dock-divider');
  const moreBtn = documentObject.getElementById('app-more-btn');
  const moreMenu = documentObject.getElementById('app-more-menu');
  const agentChatRail = documentObject.getElementById('universal-agent-chat-rail');
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

  function isAgentChatRailEnabledForView(viewId) {
    const app = getAppForView(viewId);
    return app?.agentChatRail === true;
  }

  function syncAgentChatRailState(activeViewId) {
    const enabled = isAgentChatRailEnabledForView(activeViewId);
    documentObject.body.classList.toggle('has-agent-chat-rail', enabled);
    if (agentChatRail) {
      agentChatRail.hidden = !enabled;
      agentChatRail.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    }
    return enabled;
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
    const railShells = Array.from(activeView?.querySelectorAll?.('.left-rail-template') || []);
    const visibleRailShell = railShells.find((shell) => !shell.closest('[hidden]')) || null;
    const hasSharedLeftRailView = Boolean(visibleRailShell?.querySelector?.('[data-sync-left-rail]'));
    documentObject.body.classList.toggle('has-shared-left-rail-view', hasSharedLeftRailView);
  }

  let suggestionsState = {
    items: [],
    activeIndex: -1,
    open: false
  };

  function escapeHtmlText(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderSearchSuggestionList() {
    if (!topbarSearchSuggestions) {
      return;
    }
    const { items, activeIndex, open } = suggestionsState;
    if (!open || items.length === 0) {
      topbarSearchSuggestions.hidden = true;
      topbarSearchSuggestions.replaceChildren();
      topbarSearchInput?.setAttribute('aria-expanded', 'false');
      topbarSearchInput?.removeAttribute('aria-activedescendant');
      return;
    }
    topbarSearchSuggestions.hidden = false;
    topbarSearchInput?.setAttribute('aria-expanded', 'true');

    const fragment = documentObject.createDocumentFragment();
    items.forEach((item, index) => {
      const li = documentObject.createElement('li');
      li.className = 'topbar-search-suggestion';
      li.setAttribute('role', 'option');
      li.id = `topbar-search-suggestion-${index}`;
      li.dataset.index = String(index);
      li.classList.toggle('is-active', index === activeIndex);
      li.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');

      const kindHtml = item.kind
        ? `<span class="topbar-search-suggestion-kind">${escapeHtmlText(item.kind)}</span>`
        : '';
      const sublabelHtml = item.sublabel
        ? `<span class="topbar-search-suggestion-sublabel">${escapeHtmlText(item.sublabel)}</span>`
        : '';

      li.innerHTML = `
        <span class="topbar-search-suggestion-body">
          <span class="topbar-search-suggestion-label">${escapeHtmlText(item.label)}</span>
          ${sublabelHtml}
        </span>
        ${kindHtml}
      `;
      fragment.appendChild(li);
    });
    topbarSearchSuggestions.replaceChildren(fragment);

    if (activeIndex >= 0 && activeIndex < items.length) {
      topbarSearchInput?.setAttribute('aria-activedescendant', `topbar-search-suggestion-${activeIndex}`);
    } else {
      topbarSearchInput?.removeAttribute('aria-activedescendant');
    }
  }

  function closeSearchSuggestions() {
    if (!suggestionsState.open && suggestionsState.items.length === 0) {
      return;
    }
    suggestionsState = { items: [], activeIndex: -1, open: false };
    renderSearchSuggestionList();
  }

  function refreshSearchSuggestions() {
    if (!topbarSearchSuggestions || !topbarSearchInput) {
      return;
    }
    const rawQuery = topbarSearchInput.value || '';
    if (!rawQuery.trim()) {
      closeSearchSuggestions();
      return;
    }
    const items = getSearchSuggestions(rawQuery, { limit: 8 }) || [];
    if (!items.length) {
      suggestionsState = { items: [], activeIndex: -1, open: false };
      renderSearchSuggestionList();
      return;
    }
    suggestionsState = {
      items,
      activeIndex: items.length ? 0 : -1,
      open: true
    };
    renderSearchSuggestionList();
  }

  function moveSearchSuggestionFocus(delta) {
    const { items } = suggestionsState;
    if (!suggestionsState.open || items.length === 0) {
      return;
    }
    const total = items.length;
    const current = suggestionsState.activeIndex;
    const next = current < 0
      ? (delta > 0 ? 0 : total - 1)
      : (current + delta + total) % total;
    suggestionsState = { ...suggestionsState, activeIndex: next };
    renderSearchSuggestionList();
    const target = topbarSearchSuggestions?.querySelector(`[data-index="${next}"]`);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest' });
    }
  }

  function selectSearchSuggestion(index) {
    const item = suggestionsState.items[index];
    if (!item) {
      return false;
    }
    closeSearchSuggestions();
    if (topbarSearchInput) {
      topbarSearchInput.value = '';
      topbarSearchInput.title = `Opened ${item.kind || item.target?.label || 'view'}: ${item.label}`;
    }
    return applySearchSuggestion(item);
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
    const agentChatRailEnabled = syncAgentChatRailState(activeNavView);
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
        if (!suggestionsState.open) {
          refreshSearchSuggestions();
        } else {
          moveSearchSuggestionFocus(1);
        }
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowUp') {
        if (suggestionsState.open) {
          moveSearchSuggestionFocus(-1);
          event.preventDefault();
        }
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (suggestionsState.open && suggestionsState.activeIndex >= 0) {
          selectSearchSuggestion(suggestionsState.activeIndex);
          return;
        }
        closeSearchSuggestions();
        executeTopbarSearch(topbarSearchInput.value);
        return;
      }
      if (event.key === 'Escape') {
        if (suggestionsState.open) {
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
      if (Number.isFinite(index) && index !== suggestionsState.activeIndex) {
        suggestionsState = { ...suggestionsState, activeIndex: index };
        renderSearchSuggestionList();
      }
    });
    documentObject.addEventListener('click', (event) => {
      const target = event.target;
      if (suggestionsState.open) {
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
