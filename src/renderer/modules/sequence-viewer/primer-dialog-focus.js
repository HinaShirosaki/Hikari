// The order dialog can sit above the library without sharing its keyboard focus.
export function createPrimerDialogFocus({ rootDocument, overlay, onClose, isTop = () => true }) {
  let previousFocus = null;
  function open() { previousFocus = rootDocument?.activeElement; }
  function restore() { if (previousFocus?.isConnected) previousFocus.focus?.(); }
  function bind() {
    rootDocument?.addEventListener?.('keydown', event => {
      if (!overlay || overlay.hidden !== false || !isTop()) return;
      if (event.key === 'Escape') {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        onClose();
      } else if (event.key === 'Tab') {
        const controls = [...overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
          .filter(node => node.getClientRects().length);
        const current = controls.indexOf(rootDocument.activeElement);
        if (current < 0 || (event.shiftKey && current === 0) || (!event.shiftKey && current === controls.length - 1)) {
          event.preventDefault();
          (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
        }
      }
    }, true);
  }
  return { bind, open, restore };
}
