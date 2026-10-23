import { clamp } from '../shared.js';
import { findLaneDividerNearPointer } from './divider-target.js';

export function createDividerMenu({ runtime, elements, onRemove }) {
  const canvas = elements.gelCanvas;
  const documentObject = canvas?.ownerDocument;
  const windowObject = documentObject?.defaultView;
  if (!documentObject?.createElement) return { close() {}, sync() {}, destroy() {} };
  const menu = documentObject.createElement('div');
  menu.className = 'gel-menu gel-divider-menu';
  menu.setAttribute('popover', 'auto');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Lane divider');
  menu.innerHTML = `<button type="button" role="menuitem"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" /></svg><span>Remove divider</span></button>`;
  (documentObject.getElementById('gel-view') || documentObject.body).append(menu);
  const button = menu.querySelector('button');
  let pending = null;

  function close({ restoreFocus = false } = {}) {
    pending = null;
    if (menu.matches(':popover-open')) menu.hidePopover();
    if (restoreFocus) elements.gelToolDividersBtn?.focus({ preventScroll: true });
  }
  function isCurrent() {
    return pending && runtime.selectedViewerTool === 'dividers' && !runtime.cropperActive
      && pending.image === runtime.currentImage && pending.revision === runtime.imageRevision
      && pending.overrides === runtime.manualOverrides;
  }
  function sync() { if (pending && !isCurrent()) close(); }
  function onContextMenu(event) {
    close();
    if (!runtime.currentImage || runtime.cropperActive || runtime.selectedViewerTool !== 'dividers') return;
    event.preventDefault();
    const target = findLaneDividerNearPointer({ runtime, canvas, event });
    if (target === null) return;
    pending = { x: target, image: runtime.currentImage, revision: runtime.imageRevision, overrides: runtime.manualOverrides };
    menu.style.left = `${event.clientX}px`; menu.style.top = `${event.clientY}px`;
    menu.showPopover();
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${clamp(event.clientX, 8, Math.max(8, windowObject.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${clamp(event.clientY, 8, Math.max(8, windowObject.innerHeight - rect.height - 8))}px`;
    button.focus({ preventScroll: true });
  }
  function onRemoveClick() {
    if (!isCurrent()) { close(); return; }
    const { x } = pending;
    close({ restoreFocus: true });
    onRemove(x);
  }
  function onKeyDown(event) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); close({ restoreFocus: true });
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); button.focus();
    }
  }
  function onToggle(event) { if (event.newState === 'closed') pending = null; }
  function onViewportChange(event) { if (!menu.contains(event.target)) close(); }
  canvas.addEventListener('contextmenu', onContextMenu);
  button.addEventListener('click', onRemoveClick);
  menu.addEventListener('keydown', onKeyDown);
  menu.addEventListener('toggle', onToggle);
  windowObject.addEventListener('resize', onViewportChange);
  windowObject.addEventListener('scroll', onViewportChange, true);

  return { close, sync, destroy() {
    close();
    canvas.removeEventListener('contextmenu', onContextMenu);
    windowObject.removeEventListener('resize', onViewportChange);
    windowObject.removeEventListener('scroll', onViewportChange, true);
    menu.remove();
  } };
}
