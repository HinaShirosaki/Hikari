// An HTML overlay stays usable while the canvas SVG is redrawn or zoomed.
export function createSelectionToolbar({ document, onAction, onHide, onLayout }) {
  const bar = document.getElementById('selection-toolbar');
  const stage = document.getElementById('main-canvas');
  const buttons = [...bar.querySelectorAll('button')];
  bar.addEventListener('click', event => {
    const button = event.target.closest('button[data-selection-action]');
    if (button && !button.disabled) onAction(button.dataset.selectionAction, button);
  });
  bar.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const enabled = buttons.filter(button => !button.disabled), index = enabled.indexOf(event.target);
    enabled[event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + enabled.length) % enabled.length]?.focus();
  });
  function hide() {
    if (!bar.hidden) { bar.hidden = true; onHide(); }
  }
  function layout() {
    if (bar.hidden) return;
    const area = stage.getBoundingClientRect(), wrap = bar.parentElement.getBoundingClientRect();
    const outlines = [...stage.querySelectorAll('.selection-member')].map(node => node.getBoundingClientRect())
      .filter(rect => rect.right > area.left && rect.left < area.right && rect.bottom > area.top && rect.top < area.bottom);
    if (!outlines.length || area.width < bar.offsetWidth + 16 || area.height < bar.offsetHeight + 16) { hide(); return; }
    const left = Math.max(area.left, Math.min(...outlines.map(rect => rect.left)));
    const right = Math.min(area.right, Math.max(...outlines.map(rect => rect.right)));
    const top = Math.min(...outlines.map(rect => rect.top)), bottom = Math.max(...outlines.map(rect => rect.bottom));
    const width = bar.offsetWidth, height = bar.offsetHeight, margin = 8;
    const x = Math.max(area.left + margin, Math.min(area.right - width - margin, (left + right - width) / 2));
    const preferredY = top - height - margin >= area.top + margin ? top - height - margin : bottom + margin;
    const y = Math.max(area.top + margin, Math.min(area.bottom - height - margin, preferredY));
    bar.style.left = `${x - wrap.left}px`; bar.style.top = `${y - wrap.top}px`;
    onLayout();
  }
  return {
    layout,
    sync({ visible, group, ungroup, align }) {
      buttons.forEach(button => { button.disabled = !({ group, ungroup, align }[button.dataset.selectionAction]); });
      if (buttons.includes(document.activeElement) && document.activeElement.disabled) buttons.find(button => !button.disabled)?.focus({ preventScroll: true });
      if (!visible) { hide(); return; }
      bar.hidden = false; layout();
    }
  };
}
