import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("notebook");
import { positionContextMenu } from '../../../lib/context-menu.js';

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
      i18nUi.setHtml(menu, '');
    }
    menuState = null;
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
    i18nUi.setHtml(menuEl, `
      <button type="button" class="biology-notebook-placeholder-table-action" role="menuitem" data-placeholder-add-table>
        ${i18nUi.html("Add Table")}
      </button>
    `);
    positionContextMenu(menuEl, x, y, win);
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
