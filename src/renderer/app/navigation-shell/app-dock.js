// Keep modules in registry order, folding those that do not fit into More.
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
  expandedDockApps,
  isAppShown = () => true,
  getActiveViewId,
  getAppForView,
  resolveNavigationViewId
} = {}) {
  let appNavButtons = [];
  let renderedDockApps = [];
  let renderedOverflowApps = [];
  let renderedSignature = '';

  function getDockCapacity(activeViewId = getActiveViewId()) {
    const apps = expandedDockApps.filter(isAppShown);
    const viewportWidth = windowObject.innerWidth || documentObject.documentElement?.clientWidth || 0;
    const topbar = documentObject.querySelector('.topbar');
    const brand = documentObject.querySelector('.topbar-brand');
    const tools = documentObject.querySelector('.topbar-tools');
    const topbarRect = topbar?.getBoundingClientRect?.();
    const brandRect = brand?.getBoundingClientRect?.();
    const toolsRect = tools?.getBoundingClientRect?.();
    const styles = (element) => element && windowObject.getComputedStyle?.(element);
    const rootFont = parseFloat(styles(documentObject.documentElement)?.fontSize) || 16;
    const navStyle = styles(dockNav);
    const dockStyle = styles(dockNav?.parentElement);
    const moreStyle = styles(moreBtn);
    const dividerStyle = styles(appDockDivider);
    const topbarStyle = styles(topbar);
    const leftPadding = parseFloat(topbarStyle?.paddingLeft) || (viewportWidth <= 960 ? 14 : 20);
    const rightPadding = parseFloat(topbarStyle?.paddingRight) || (viewportWidth <= 960 ? 14 : 20);
    const buttonWidth = parseFloat(moreStyle?.width) || 2.625 * rootFont;
    const navGap = parseFloat(navStyle?.columnGap) || (viewportWidth <= 960 ? 0.25 : 0.375) * rootFont;
    const dockGap = parseFloat(dockStyle?.columnGap) || navGap;
    const padding = dockStyle
      ? parseFloat(dockStyle.paddingLeft) + parseFloat(dockStyle.paddingRight)
      : viewportWidth <= 960 ? 0 : 0.75 * rootFont;
    const dividerWidth = dividerStyle
      ? (parseFloat(dividerStyle.width) || parseFloat(dividerStyle.flexBasis) || 0.0625 * rootFont)
        + (parseFloat(dividerStyle.marginLeft) || 0) + (parseFloat(dividerStyle.marginRight) || 0)
      : 0.5625 * rootFont;
    const hostWidth = topbar?.clientWidth || viewportWidth;
    let availableWidth = viewportWidth <= 960
      ? hostWidth - leftPadding - rightPadding
      : Math.min(viewportWidth * 0.56, hostWidth - 360);
    if (viewportWidth > 1180 && topbarRect?.width > 0 && brandRect?.width > 0 && toolsRect?.width > 0) {
      const center = topbarRect.left + leftPadding + (topbarRect.width - leftPadding - rightPadding) / 2;
      // Reserve the search tools' preferred clamp(250px, 26vw, 360px) width.
      // Their current grid cell can be narrower while a previous dock state
      // is laid out; using that shrunken width would make capacity oscillate.
      const toolsWidth = Math.max(toolsRect.width, Math.min(360, Math.max(250, viewportWidth * 0.26)));
      const toolsLeft = topbarRect.right - rightPadding - toolsWidth;
      availableWidth = 2 * Math.min(center - brandRect.right - 14, toolsLeft - center - 14);
    }
    // The active label expands one button on desktop. Use its actual font so
    // larger appearance settings do not push icons into search or page actions.
    let labelExtra = 0;
    const activeApp = getAppForView(activeViewId);
    if (viewportWidth > 1180 && activeApp) {
      const labelStyle = styles(dockNav?.querySelector('.app-dock-label'));
      const canvas = documentObject.createElement('canvas');
      const context = canvas.getContext?.('2d');
      if (context) {
        context.font = labelStyle?.font || `500 ${0.8125 * rootFont}px sans-serif`;
      }
      const textWidth = context?.measureText(activeApp.label).width || activeApp.label.length * 0.5 * rootFont;
      labelExtra = Math.max(0, textWidth + 22 + 2 * rootFont + 2 - buttonWidth);
    }
    const requiredWidth = (count, overflow) => padding + count * buttonWidth
      + Math.max(0, count - 1) * navGap + labelExtra
      + (overflow ? buttonWidth + dividerWidth + 2 * dockGap : 0);
    if (requiredWidth(apps.length, false) <= availableWidth) {
      return apps.length;
    }
    let count = apps.length - 1;
    while (count > 1 && requiredWidth(count, true) > availableWidth) {
      count -= 1;
    }
    return Math.max(1, count);
  }

  function getRenderedDockState(activeViewId) {
    const capacity = getDockCapacity(activeViewId);
    const activeApp = getAppForView(activeViewId);
    const apps = expandedDockApps.filter(isAppShown);
    let visibleApps = apps.slice(0, capacity);
    if (activeApp && apps.some((app) => app.id === activeApp.id)
      && !visibleApps.some((app) => app.id === activeApp.id) && visibleApps.length) {
      visibleApps = [...visibleApps.slice(0, -1), activeApp]
        .sort((left, right) => apps.indexOf(left) - apps.indexOf(right));
    }
    const visibleIds = new Set(visibleApps.map((app) => app.id));
    return { visibleApps, overflowApps: apps.filter((app) => !visibleIds.has(app.id)) };
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
    label.className = menu ? 'app-more-label' : 'app-dock-label';
    label.textContent = app.label;
    button.append(label);
    return button;
  }

  function closeMoreMenu({ restoreFocus = false } = {}) {
    if (!moreMenu || !moreBtn) {
      return;
    }
    moreMenu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.classList.remove('is-open');
    if (restoreFocus) {
      moreBtn.focus();
    }
  }

  function toggleMoreMenu(forceOpen) {
    if (!moreMenu || !moreBtn) {
      return;
    }
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : moreMenu.hidden;
    moreMenu.hidden = !shouldOpen;
    moreBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    moreBtn.classList.toggle('is-open', shouldOpen);
    if (shouldOpen) {
      moreMenu.scrollTop = 0;
      const items = moreMenu.querySelectorAll('.app-more-item');
      const activeItem = Array.from(items).find((item) => item.classList.contains('is-active'));
      (activeItem || items[0])?.focus();
    }
  }

  function handleMoreMenuKeydown(event) {
    if (moreMenu?.hidden !== false) {
      return;
    }
    if (event.key === 'Tab') {
      closeMoreMenu({ restoreFocus: true });
      return;
    }
    const items = Array.from(moreMenu.querySelectorAll('.app-more-item'));
    const index = items.indexOf(documentObject.activeElement);
    const nextIndex = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1
    }[event.key];
    if (nextIndex !== undefined && items.length) {
      event.preventDefault();
      items[nextIndex].focus();
    }
  }

  function renderAppNavigation(activeViewId = getActiveViewId()) {
    const { visibleApps, overflowApps } = getRenderedDockState(activeViewId);
    const signature = JSON.stringify([visibleApps.map((app) => [app.id, app.iconMarkup]), overflowApps.map((app) => [app.id, app.iconMarkup])]);
    if (signature === renderedSignature) {
      return;
    }
    const focused = documentObject.activeElement;
    const focusedAppId = appNavButtons.includes(focused) ? focused.dataset.appId : '';
    renderedSignature = signature;
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
    if (focusedAppId) {
      const visibleButton = Array.from(dockNav?.children || []).find((button) => button.dataset.appId === focusedAppId);
      const menuButton = moreMenu?.hidden === false
        ? Array.from(moreMenu.children).find((button) => button.dataset.appId === focusedAppId)
        : null;
      (visibleButton || menuButton || moreBtn)?.focus();
    } else if (focused === moreBtn && moreBtn.hidden) {
      appNavButtons.find((button) => button.dataset.view === resolveNavigationViewId(activeViewId))?.focus();
    }
  }

  function syncNavigationState(activeViewId) {
    const activeNavView = resolveNavigationViewId(activeViewId);
    const activeApp = getAppForView(activeNavView);
    appNavButtons.forEach((button) => {
      const buttonView = button.dataset.view;
      button.classList.toggle('is-active', buttonView === activeNavView);
      if (buttonView === activeNavView) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    });
    if (moreBtn) {
      const isOverflowActive = Boolean(activeApp && renderedOverflowApps.some((app) => app.id === activeApp.id));
      moreBtn.classList.toggle('is-active', isOverflowActive);
      const label = isOverflowActive ? `More modules: ${activeApp.label}` : 'More modules';
      moreBtn.setAttribute('aria-label', label);
      moreBtn.title = label;
    }
    documentObject.body.dataset.activeView = activeNavView;
    if (pageTitle && !pageTitle.classList?.contains?.('topbar-timekeeping')) {
      pageTitle.textContent = 'Hikari';
    }
    if (pageSubtitle) {
      pageSubtitle.textContent = TITLES[activeNavView] || '';
    }
  }

  return {
    getDockCapacity,
    getRenderedDockApps: () => renderedDockApps,
    closeMoreMenu,
    toggleMoreMenu,
    handleMoreMenuKeydown,
    renderAppNavigation,
    syncNavigationState
  };
}

export { createAppDock };
