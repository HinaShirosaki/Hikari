export function bindPersonalInventoryEvents(ctx) {
  const {
    addContainerBtn,
    addContainerNameInput,
    addContainerTypeSelect,
    addContainerForm,
    addContainerCancelBtn
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
}
