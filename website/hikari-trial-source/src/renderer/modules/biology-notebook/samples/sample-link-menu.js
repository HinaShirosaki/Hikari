export function createSampleLinkMenuController({
  doc = (typeof document !== 'undefined' ? document : null),
  win = (typeof window !== 'undefined' ? window : null),
  onAddTable
} = {}) {
  let menu = null;
  let menuState = null;

  function ensureMenu() {
    if (menu || !doc?.createElement) {
      return menu;
    }
    menu = doc.createElement('div');
    menu.className = 'biology-notebook-sample-link-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    menu.addEventListener('click', onMenuClick);
    doc.body?.append(menu);
    return menu;
  }

  function close() {
    if (menu) {
      menu.hidden = true;
      menu.innerHTML = '';
    }
    menuState = null;
  }

  function position(x, y) {
    if (!menu) {
      return;
    }
    const menuWidth = 132;
    const menuHeight = 40;
    const viewportWidth = win?.innerWidth || doc?.documentElement?.clientWidth || menuWidth;
    const viewportHeight = win?.innerHeight || doc?.documentElement?.clientHeight || menuHeight;
    const left = Math.max(8, Math.min(Number(x) || 8, viewportWidth - menuWidth - 8));
    const top = Math.max(8, Math.min(Number(y) || 8, viewportHeight - menuHeight - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function onMenuClick(event) {
    const action = event.target.closest('[data-placeholder-add-table]');
    if (!action || !menuState) {
      return;
    }
    event.preventDefault?.();
    onAddTable?.(menuState);
    close();
  }

  function open({ wrap, token, x, y }) {
    const key = String(token?.dataset?.nbKeyRef || '').trim();
    const placeholderName = String(wrap?.dataset?.placeholderName || '').trim();
    const hiddenValue = wrap?.querySelector?.('[data-nb-key]');
    if (!key) {
      return;
    }
    const menuEl = ensureMenu();
    if (!menuEl) {
      return;
    }
    menuState = {
      wrap,
      key,
      placeholderName,
      value: String(hiddenValue?.value || '').trim()
    };
    menuEl.innerHTML = `
      <button type="button" class="biology-notebook-placeholder-table-action" role="menuitem" data-placeholder-add-table>
        Add Table
      </button>
    `;
    position(x, y);
    menuEl.hidden = false;
    menuEl.querySelector('[data-placeholder-add-table]')?.focus?.();
  }

  function isOpenAt(target) {
    return Boolean(menu) && !menu.hidden && menu.contains(target);
  }

  function isOpen() {
    return Boolean(menu) && !menu.hidden;
  }

  return {
    open,
    close,
    isOpen,
    isOpenAt
  };
}
