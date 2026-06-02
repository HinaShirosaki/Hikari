export function bindPersonalInventoryEvents(ctx) {
  const {
    addContainerBtn,
    addContainerNameInput,
    addContainerTypeSelect,
    addContainerForm,
    addContainerCancelBtn,
    sampleCompoundDialogApplyBtn,
    sampleCompoundDialogCloseBtn,
    sampleCompoundDialogCancelBtn,
    sampleCompoundDialogOverlay
  } = ctx.elements;

  addContainerBtn?.addEventListener('click', () => {
    ctx.renderAddContainerLocationOptions();
    ctx.setAddContainerFormOpen(!ctx.uiState.isAddContainerFormOpen);
    if (ctx.uiState.isAddContainerFormOpen) {
      addContainerNameInput?.focus();
    }
  });
  addContainerTypeSelect?.addEventListener('change', ctx.renderAddContainerTypeFields);
  addContainerForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    ctx.addContainerFromForm();
  });
  addContainerCancelBtn?.addEventListener('click', () => {
    ctx.resetAddContainerForm();
    ctx.setAddContainerFormOpen(false);
  });
  sampleCompoundDialogApplyBtn?.addEventListener('click', ctx.onInventoryStructureApplyClick);
  sampleCompoundDialogCloseBtn?.addEventListener('click', ctx.onInventoryStructureCloseClick);
  sampleCompoundDialogCancelBtn?.addEventListener('click', ctx.onInventoryStructureCloseClick);
  sampleCompoundDialogOverlay?.addEventListener('click', ctx.onInventoryStructureOverlayClick);
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', ctx.onInventoryStructureKeydown);
  }
}
