export function bindPersonalInventoryEvents(ctx) {
  const {
    addContainerOverlay,
    addContainerTypeSelect,
    addContainerForm,
    addContainerCloseBtn,
    addContainerCancelBtn
  } = ctx.elements;
  const rootDocument = addContainerForm?.ownerDocument || globalThis.document || null;

  function closeAddContainerDialog() {
    ctx.resetAddContainerForm();
    ctx.setAddContainerFormOpen(false);
  }
  addContainerOverlay?.addEventListener('click', (event) => {
    if (event.target === addContainerOverlay) {
      closeAddContainerDialog();
    }
  });
  addContainerTypeSelect?.addEventListener('change', ctx.renderAddContainerTypeFields);
  addContainerForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    ctx.addContainerFromForm();
  });
  [addContainerCloseBtn, addContainerCancelBtn].forEach((button) => {
    button?.addEventListener('click', closeAddContainerDialog);
  });
  rootDocument?.addEventListener?.('keydown', (event) => {
    if (event.key === 'Escape' && ctx.uiState.isAddContainerFormOpen) {
      closeAddContainerDialog();
    }
  });
}
