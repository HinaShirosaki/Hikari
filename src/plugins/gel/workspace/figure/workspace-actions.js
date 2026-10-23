// Layers and Stack share the original Gel viewer. Its existing controls must
// act on the visible layer instead of the previously processed image.
export function bindFigureWorkspaceActions({ documentObject, elements, isOpen, isBusy, resumeEditor, exportFigure, saveProject }) {
  const disposers = [];
  function listen(node, event, handler) {
    node?.addEventListener(event, handler, true);
    disposers.push(() => node?.removeEventListener(event, handler, true));
  }
  function resume(event) {
    if (!isOpen() || !event.target.closest('input,select,button')) return;
    if (isBusy()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    resumeEditor();
    if (event.type === 'focusin') event.target.focus({ preventScroll: true });
  }
  const rail = elements.gelForm;
  for (const event of ['pointerdown', 'focusin', 'click']) listen(rail, event, resume);
  // The Export menu is a popover declared inside the toolbar, so its items
  // still bubble through here; opening the menu is not an edit.
  listen(documentObject.querySelector('.gel-viewer-toolbar'), 'click', event => {
    const button = event.target.closest('button');
    if (!button || !isOpen() || button.dataset.gelToolCategory || ['gel-open-figure-btn', 'gel-export-menu-btn'].includes(button.id)) return;
    if (isBusy()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (button === elements.gelSaveBtn) {
      event.preventDefault(); event.stopImmediatePropagation(); void saveProject(); return;
    }
    const format = button === elements.gelExportImageBtn ? 'png' : button === elements.gelExportPptxBtn ? 'pptx' : '';
    if (format) {
      // Stopping here also skips the menu's own close-on-click listener.
      event.preventDefault(); event.stopImmediatePropagation(); button.closest('[popover]')?.hidePopover();
      void exportFigure(format);
    } else resumeEditor();
  });
  return () => disposers.forEach(dispose => dispose());
}
