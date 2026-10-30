function tableEditorFromTarget(host, target) {
  const editor = target?.closest?.('[data-result-table-editor]');
  if (!editor) {
    return null;
  }
  if (typeof host?.contains === 'function' && !host.contains(editor)) {
    return null;
  }
  return editor;
}

export function createSpreadsheetTableContextMenu({
  host,
  menu,
  onSelectTable,
  documentRef = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  windowRef = typeof window !== 'undefined' ? window : null
} = {}) {
  let returnFocus = null;

  function hide({ restoreFocus = false } = {}) {
    if (!menu) {
      return;
    }
    menu.hidden = true;
    if (restoreFocus) {
      returnFocus?.focus?.();
    }
    returnFocus = null;
  }

  function focusFirstItem() {
    const focus = () => menu?.querySelector?.('[role="menuitem"]:not([hidden])')?.focus?.();
    if (typeof windowRef?.requestAnimationFrame === 'function') {
      windowRef.requestAnimationFrame(focus);
    } else {
      focus();
    }
  }

  function position(clientX, clientY) {
    if (!menu) {
      return;
    }
    const viewportWidth = Number(windowRef?.innerWidth || documentRef?.documentElement?.clientWidth || 0);
    const viewportHeight = Number(windowRef?.innerHeight || documentRef?.documentElement?.clientHeight || 0);
    const margin = 8;
    let left = Math.max(margin, Number(clientX) || margin);
    let top = Math.max(margin, Number(clientY) || margin);

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.hidden = false;

    const rect = menu.getBoundingClientRect?.() || {};
    if (viewportWidth && Number(rect.width)) {
      left = Math.min(left, Math.max(margin, viewportWidth - Number(rect.width) - margin));
    }
    if (viewportHeight && Number(rect.height)) {
      top = Math.min(top, Math.max(margin, viewportHeight - Number(rect.height) - margin));
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function openForEditor(editor, event, { keyboard = false } = {}) {
    if (!menu || !editor) {
      return;
    }
    const tableIndex = Number(editor.dataset?.resultTableEditor);
    if (!Number.isFinite(tableIndex)) {
      return;
    }

    event?.preventDefault?.();
    event?.stopPropagation?.();
    onSelectTable?.(tableIndex);
    returnFocus = event?.target || editor;

    const editorRect = editor.getBoundingClientRect?.() || {};
    const x = keyboard ? Number(editorRect.left || 0) + 12 : event?.clientX;
    const y = keyboard ? Number(editorRect.top || 0) + 12 : event?.clientY;
    position(x, y);
    focusFirstItem();
  }

  function onHostContextMenu(event) {
    openForEditor(tableEditorFromTarget(host, event?.target), event);
  }

  function onHostKeydown(event) {
    const isContextMenuKey = event?.key === 'ContextMenu'
      || (event?.key === 'F10' && event?.shiftKey);
    if (!isContextMenuKey) {
      return;
    }
    openForEditor(tableEditorFromTarget(host, event?.target), event, { keyboard: true });
  }

  function menuItems() {
    return Array.from(menu?.querySelectorAll?.('[role="menuitem"]:not([hidden])') || []);
  }

  function onMenuKeydown(event) {
    if (event?.key === 'Escape') {
      event.preventDefault?.();
      hide({ restoreFocus: true });
      return;
    }
    if (event?.key === 'Tab') {
      hide();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event?.key)) {
      return;
    }

    const items = menuItems();
    if (!items.length) {
      return;
    }
    event.preventDefault?.();
    const currentIndex = items.indexOf(event?.target);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowUp'
          ? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % items.length;
    items[nextIndex]?.focus?.();
  }

  if (menu) {
    menu.hidden = true;
    menu.addEventListener?.('click', (event) => {
      event?.stopPropagation?.();
      hide({ restoreFocus: true });
    });
    menu.addEventListener?.('contextmenu', (event) => event?.preventDefault?.());
    menu.addEventListener?.('keydown', onMenuKeydown);
  }
  host?.addEventListener?.('contextmenu', onHostContextMenu);
  host?.addEventListener?.('keydown', onHostKeydown);
  documentRef?.addEventListener?.('click', () => hide());
  documentRef?.addEventListener?.('contextmenu', (event) => {
    const target = event?.target;
    const isInsideHost = typeof host?.contains === 'function' && host.contains(target);
    const isInsideMenu = typeof menu?.contains === 'function' && menu.contains(target);
    if (!isInsideHost && !isInsideMenu) {
      hide();
    }
  });
  documentRef?.addEventListener?.('keydown', (event) => {
    if (event?.key === 'Escape' && !menu?.hidden) {
      hide({ restoreFocus: true });
    }
  });
  windowRef?.addEventListener?.('resize', () => hide());
  windowRef?.addEventListener?.('scroll', () => hide(), true);

  return { hide, openForEditor };
}
