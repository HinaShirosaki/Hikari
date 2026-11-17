import { createPresentation } from './i18n.mjs';
import { installIllustrationContextMenu } from './workspace-tools.mjs';

const i18nUi = createPresentation('figura');

// Copied from the public-API Gel rail adapter; no host source imports.
const DEFAULT_WIDTH = 280;
const DEFAULT_MIN = 240;
const DEFAULT_MAX = 400;
const DEFAULT_MOBILE_BREAKPOINT = 980;
const HANDLE_CLASS = 'app-left-rail-handle';

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function initPluginLeftRailResizer({
  documentObject = globalThis.document,
  windowObject = globalThis.window,
  initialLayout = null,
  commitWidth = async () => null,
  commitFolded = async () => null,
  onCommitError = () => {}
} = {}) {
  const root = documentObject?.documentElement;
  if (!root?.style || !documentObject?.querySelector || !windowObject?.addEventListener) {
    return {
      applyContext: () => DEFAULT_WIDTH,
      ensureHandle: () => null,
      destroy: () => {}
    };
  }

  let rail = null;
  let layout = null;
  let handle = null;
  let activeResize = null;
  let destroyed = false;
  let commitVersion = 0;
  let folded = false, foldable = false, folding = false;
  let headerToggle = false;
  const toggle = documentObject.getElementById?.('toggle-illustrations');
  let constraints = {
    width: DEFAULT_WIDTH,
    min: DEFAULT_MIN,
    max: DEFAULT_MAX,
    mobileBreakpoint: DEFAULT_MOBILE_BREAKPOINT
  };

  function clampWidth(width) {
    const responsiveMax = windowObject.innerWidth > constraints.mobileBreakpoint
      ? Math.max(constraints.min, Math.min(constraints.max, Math.floor(windowObject.innerWidth * 0.38)))
      : constraints.max;
    return Math.max(
      constraints.min,
      Math.min(responsiveMax, Math.round(finiteNumber(width, constraints.width)))
    );
  }

  function applyWidth(width) {
    const nextWidth = clampWidth(width);
    constraints.width = nextWidth;
    root.style.setProperty('--shared-left-rail-min', `${constraints.min}px`);
    root.style.setProperty('--shared-left-rail-max', `${constraints.max}px`);
    root.style.setProperty('--shared-left-rail-width', `${nextWidth}px`);
    return nextWidth;
  }

  function applyContext(context = {}) {
    if (destroyed) return constraints.width;
    const leftRail = context?.leftRail && typeof context.leftRail === 'object'
      ? context.leftRail
      : context;
    constraints = {
      width: finiteNumber(leftRail?.width, constraints.width),
      min: Math.max(1, finiteNumber(leftRail?.min, constraints.min)),
      max: Math.max(1, finiteNumber(leftRail?.max, constraints.max)),
      mobileBreakpoint: Math.max(
        1,
        finiteNumber(leftRail?.mobileBreakpoint, constraints.mobileBreakpoint)
      )
    };
    if (constraints.max < constraints.min) {
      constraints.max = constraints.min;
    }
    if (typeof leftRail.foldable === 'boolean') foldable = leftRail.foldable;
    if (typeof leftRail.folded === 'boolean') folded = leftRail.folded;
    syncFoldState();
    if (activeResize) {
      return activeResize.currentWidth;
    }
    return applyWidth(constraints.width);
  }

  function syncFoldState() {
    const hidden = foldable && folded;
    if (hidden && activeResize) finishResize({ shouldCommit: false });
    if (hidden && rail?.contains(documentObject.activeElement)) {
      const focusTarget = headerToggle ? documentObject.getElementById('figure-title') : toggle;
      focusTarget?.focus({ preventScroll: true });
    }
    layout?.classList.toggle('is-left-rail-folded', hidden);
    if (rail) { rail.hidden = hidden; rail.inert = hidden; }
    if (handle) handle.hidden = hidden;
    if (toggle) {
      toggle.hidden = !foldable || headerToggle;
      toggle.setAttribute('aria-busy', String(folding));
      toggle.setAttribute('aria-expanded', String(!hidden));
      i18nUi.setAttribute(toggle, "aria-label", (hidden ? i18nUi.message("Show library") : i18nUi.message("Hide library")));
      i18nUi.setAttribute(toggle, "title", (hidden ? i18nUi.message("Show library") : i18nUi.message("Hide library")));
    }
  }

  async function onFoldClick() {
    if (!foldable || folding || destroyed) return;
    const request = commitVersion += 1;
    folding = true; syncFoldState();
    try {
      const result = await commitFolded(!folded);
      if (!destroyed && request === commitVersion && result?.leftRail) applyContext(result.leftRail);
    } catch (error) {
      if (!destroyed) onCommitError(error);
    } finally {
      folding = false;
      if (!destroyed) syncFoldState();
    }
  }

  function removeDocumentListeners() {
    documentObject.removeEventListener?.('pointermove', onPointerMove);
    documentObject.removeEventListener?.('pointerup', onPointerUp);
    documentObject.removeEventListener?.('pointercancel', onPointerUp);
  }

  function commit(nextWidth) {
    const request = commitVersion += 1;
    Promise.resolve(commitWidth(nextWidth)).then((result) => {
      if (destroyed || request !== commitVersion) {
        return;
      }
      if (result?.leftRail) {
        applyContext(result.leftRail);
      }
    }).catch((error) => {
      if (!destroyed && request === commitVersion) {
        onCommitError(error, nextWidth);
      }
    });
  }

  function finishResize({ shouldCommit = true } = {}) {
    if (!activeResize) {
      return;
    }
    const nextWidth = activeResize.currentWidth;
    activeResize = null;
    rail?.classList?.remove('is-resizing');
    documentObject.body?.classList?.remove('shared-left-rail-resizing');
    removeDocumentListeners();
    if (shouldCommit) {
      commit(nextWidth);
    }
  }

  function onPointerMove(event) {
    if (!activeResize) {
      return;
    }
    activeResize.currentWidth = applyWidth(
      activeResize.startWidth + (finiteNumber(event?.clientX, activeResize.startX) - activeResize.startX)
    );
  }

  function onPointerUp() {
    finishResize();
  }

  function onPointerDown(event) {
    if (windowObject.innerWidth <= constraints.mobileBreakpoint || !rail || (foldable && folded)) {
      return;
    }
    event?.preventDefault?.();
    const measuredWidth = finiteNumber(rail.getBoundingClientRect?.().width, constraints.width);
    activeResize = {
      startX: finiteNumber(event?.clientX, 0),
      startWidth: measuredWidth,
      currentWidth: measuredWidth
    };
    rail.classList?.add('is-resizing');
    documentObject.body?.classList?.add('shared-left-rail-resizing');
    documentObject.addEventListener?.('pointermove', onPointerMove);
    documentObject.addEventListener?.('pointerup', onPointerUp);
    documentObject.addEventListener?.('pointercancel', onPointerUp);
  }

  function ensureHandle() {
    layout = documentObject.querySelector('.illustration-workspace.left-rail-template');
    rail = layout?.querySelector?.('[data-sync-left-rail]') || null;
    if (!layout || !rail) {
      return null;
    }
    layout.querySelectorAll?.(`.${HANDLE_CLASS}`)?.forEach?.((node) => node.remove?.());
    handle = documentObject.createElement('button');
    handle.type = 'button';
    handle.className = HANDLE_CLASS;
    handle.tabIndex = -1;
    handle.setAttribute('aria-hidden', 'true');
    handle.setAttribute('data-shared-left-rail-handle', 'true');
    handle.addEventListener('pointerdown', onPointerDown);
    layout.append(handle);
    syncFoldState();
    return handle;
  }

  function onResize() {
    if (activeResize && windowObject.innerWidth <= constraints.mobileBreakpoint) {
      finishResize({ shouldCommit: false });
    }
    applyWidth(constraints.width);
  }

  function destroy() {
    destroyed = true;
    commitVersion += 1;
    finishResize({ shouldCommit: false });
    windowObject.removeEventListener?.('resize', onResize);
    toggle?.removeEventListener('click', onFoldClick);
    foldable = false; syncFoldState();
    handle?.removeEventListener?.('pointerdown', onPointerDown);
    handle?.remove?.();
    handle = null;
    rail = null;
    layout = null;
  }

  applyContext(initialLayout || {});
  ensureHandle();
  toggle?.addEventListener('click', onFoldClick);
  windowObject.addEventListener('resize', onResize);

  return {
    applyContext,
    setHeaderToggle(mounted) {
      headerToggle = mounted === true;
      syncFoldState();
    },
    ensureHandle,
    destroy
  };
}

function installIllustrationMenu({ document, workspace, manageIllustration, exportFigure, status }) {
  const $ = id => document.getElementById(id);
  const list = $('illustrations');
  const dialog = $('illustration-action-dialog'), form = $('illustration-action-form');
  const name = $('illustration-new-name'), cancel = $('cancel-illustration-action'), error = $('illustration-action-error');
  const tasks = [...form.querySelectorAll('[data-illustration-task]')];
  const submitButtons = [...form.querySelectorAll('button[type="submit"]')];
  let target, saving = false;

  function focusRow(id) {
    const row = [...list.children].find(button => button.dataset.illustrationId === id)
      || list.querySelector('[aria-pressed="true"]') || $('illustration-search');
    row.focus({ preventScroll: true });
  }
  function showError(message = '') {
    i18nUi.setOwnedText(error, message);
    error.hidden = !message;
  }
  function openDialog(action, id) {
    const entry = workspace.getLibrary().illustrations.find(item => item.id === id);
    if (!entry) return;
    target = { action, id };
    for (const element of tasks) element.hidden = !element.dataset.illustrationTask.split(' ').includes(action);
    for (const button of submitButtons) button.disabled = button.hidden;
    i18nUi.setText($('illustration-action-name'), entry.title || i18nUi.message('Untitled figure'));
    name.disabled = action !== 'rename';
    name.value = entry.title;
    showError();
    dialog.showModal();
    if (action === 'rename') { name.focus(); name.select(); }
    else (action === 'export' ? submitButtons.find(button => !button.hidden) : cancel).focus();
  }

  const contextMenu = installIllustrationContextMenu({ document, focusRow, status,
    getActions: id => ({
      export: { enabled: true, run: () => openDialog('export', id) },
      duplicate: { enabled: workspace.getLibrary().illustrations.length < 100, run: async () => {
        const result = await manageIllustration('duplicate', id);
        if (result?.ok) focusRow(result.illustration_id);
      } },
      rename: { enabled: true, run: () => openDialog('rename', id) },
      delete: { enabled: true, run: () => openDialog('delete', id) }
    })
  });
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (!dialog.open && target) { focusRow(target.id); target = null; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!target || saving) return;
    const { action, id } = target;
    if (action === 'export') {
      if (!event.submitter?.value) return;
      dialog.close();
      await exportFigure(event.submitter.value, id);
      return;
    }
    const title = name.value.trim();
    if (action === 'rename' && !title) {
      showError('Enter an illustration name.');
      name.focus();
      return;
    }
    saving = true;
    cancel.disabled = true;
    submitButtons.forEach(button => { button.disabled = true; });
    showError();
    try {
      const result = await manageIllustration(action, id, title);
      if (result?.ok) dialog.close();
      else showError(result?.error);
    } finally {
      saving = false;
      cancel.disabled = false;
      submitButtons.forEach(button => { button.disabled = button.hidden; });
    }
  });
  return contextMenu;
}

export function createIllustrationLibraryView({ document, workspace, exportFigure, flushImagePreferences, renderAssets, status }) {
  const $ = id => document.getElementById(id);

  function renderIllustrations(library = workspace.getLibrary()) {
    if (!library) return;
    const list = $('illustrations'), scrollTop = list.scrollTop;
    const focusedId = document.activeElement?.dataset.illustrationId;
    const query = $('illustration-search').value.trim().toLowerCase();
    const entries = library.illustrations.filter(item => item.title.toLowerCase().includes(query));
    const rows = document.createDocumentFragment();
    for (const entry of entries) {
      const button = document.createElement('button'); button.type = 'button';
      button.className = `illustration-row${entry.id === library.active_illustration_id ? ' is-active' : ''}`;
      button.dataset.illustrationId = entry.id; button.setAttribute('aria-pressed', String(entry.id === library.active_illustration_id));
      button.setAttribute('aria-haspopup', 'menu');
      i18nUi.setAttribute(button, "title", (entry.title || i18nUi.message("Untitled figure")));
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M5 3h14v18H5zM8 16l3-4 3 3 2-2'); icon.append(path);
      const title = document.createElement('span'); i18nUi.setText(title, (entry.title || i18nUi.message("Untitled figure")));
      button.append(icon, title); button.addEventListener('click', () => {
        if (workspace.getLibrary().active_illustration_id !== entry.id) void manageIllustration('open', entry.id);
      });
      rows.append(button);
    }
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'rail-note'; i18nUi.setText(empty, i18nUi.message("No illustrations match your search.")); rows.append(empty); }
    list.replaceChildren(rows);
    list.scrollTop = scrollTop;
    if (focusedId) [...list.children].find(button => button.dataset.illustrationId === focusedId)?.focus({ preventScroll: true });
  }
  async function manageIllustration(action, id, title) {
    try {
      await flushImagePreferences();
      const result = await workspace.manage(action, id, title);
      if (!result.ok) status(result.error);
      else if (action === 'create' || action === 'duplicate') { $('illustration-search').value = ''; renderIllustrations(); }
      return result;
    } catch (error) { status(error.message); return { ok: false, error: error.message }; }
  }
  const illustrationMenu = installIllustrationMenu({ document, workspace, manageIllustration, exportFigure, status });
  // The left rail switches between the figure library and the shared assets.
  function showLibrary(view) {
    illustrationMenu.close();
    for (const node of document.querySelectorAll('[data-library-view]')) node.hidden = node.dataset.libraryView !== view;
    $('illustrations-view-tab').setAttribute('aria-pressed', String(view !== 'assets')); $('assets-view-tab').setAttribute('aria-pressed', String(view === 'assets'));
    if (view === 'assets') renderAssets();
  }
  $('illustrations-view-tab').addEventListener('click', () => showLibrary('illustrations'));
  $('assets-view-tab').addEventListener('click', () => showLibrary('assets'));
  $('illustration-search').addEventListener('input', () => { $('illustrations').scrollTop = 0; renderIllustrations(); });
  $('new-illustration').addEventListener('click', () => void manageIllustration('create'));

  return { render: renderIllustrations, show: showLibrary };
}
