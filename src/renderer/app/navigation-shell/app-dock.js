// The app dock: how many buttons fit at the current width, which apps overflow
// into the More menu, and keeping the active view highlighted wherever it sits.
function createAppDock({
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
} = {}) {
  let appNavButtons = [];
  let renderedDockApps = dockApps;
  let renderedOverflowApps = moreApps;

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
    const topbarBrand = documentObject.querySelector('.topbar-brand');
    const topbarTools = documentObject.querySelector('.topbar-tools');
    const dockViewportMargin = viewportWidth <= 960 ? 20 : 32;
    const dockHostWidth = topbar?.clientWidth || viewportWidth;
    const fallbackWidth = Math.min(
      Math.max(240, Math.floor(viewportWidth <= 960 ? dockHostWidth - dockViewportMargin : viewportWidth * 0.56)),
      Math.max(240, dockHostWidth - (viewportWidth <= 960 ? dockViewportMargin : 360)),
      Math.max(240, viewportWidth - dockViewportMargin)
    );
    const topbarRect = topbar?.getBoundingClientRect?.();
    const brandRect = topbarBrand?.getBoundingClientRect?.();
    const toolsRect = topbarTools?.getBoundingClientRect?.();
    const isSingleRowDesktop = viewportWidth > 1180;
    const hasMeasuredClearance = isSingleRowDesktop
      && topbarRect?.width > 0
      && brandRect?.width > 0
      && toolsRect?.width > 0;
    const effectiveWidth = hasMeasuredClearance
      ? Math.max(0, Math.floor(2 * Math.min(
        (topbarRect.left + (topbarRect.width / 2)) - brandRect.right - 14,
        toolsRect.left - (topbarRect.left + (topbarRect.width / 2)) - 14
      )))
      : fallbackWidth;
    if (!effectiveWidth) {
      return 1;
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
    if (!overflowApps.length) {
      closeMoreMenu();
    }
  }

  function syncNavigationState(activeViewId) {
    const activeNavView = resolveNavigationViewId(activeViewId);
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

  return {
    getRenderedDockApps: () => renderedDockApps,
    getDockCapacity,
    closeMoreMenu,
    toggleMoreMenu,
    renderAppNavigation,
    syncNavigationState
  };
}

export { createAppDock };
