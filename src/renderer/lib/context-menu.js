// Measure after revealing the menu so inset padding and wrapped labels are
// included when keeping a right-click menu inside the viewport.
export function positionContextMenu(menu, clientX, clientY, windowRef = menu?.ownerDocument?.defaultView) {
  if (!menu?.style) return;
  const margin = 8;
  menu.hidden = false;
  let left = Math.max(margin, Number(clientX) || margin);
  let top = Math.max(margin, Number(clientY) || margin);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const rect = menu.getBoundingClientRect?.();
  const viewportWidth = Number(windowRef?.innerWidth || menu.ownerDocument?.documentElement?.clientWidth);
  const viewportHeight = Number(windowRef?.innerHeight || menu.ownerDocument?.documentElement?.clientHeight);
  if (viewportWidth && rect?.width) left = Math.min(left, Math.max(margin, viewportWidth - rect.width - margin));
  if (viewportHeight && rect?.height) top = Math.min(top, Math.max(margin, viewportHeight - rect.height - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}
