export function bindPersonalInventoryEvents(ctx) {
  const {
    addContainerBtn,
    addFolderBtn,
    addContainerOverlay,
    addContainerNameInput,
    addContainerTypeSelect,
    addContainerForm,
    addContainerCloseBtn,
    addContainerCancelBtn
  } = ctx.elements;
  const rootDocument = addContainerForm?.ownerDocument || globalThis.document || null;
  const windowRef = rootDocument?.defaultView || globalThis.window || globalThis;

  function closeAddContainerDialog() {
    const opener = ctx.uiState.addItemMode === 'folder' ? addFolderBtn : addContainerBtn;
    ctx.resetAddContainerForm();
    ctx.setAddContainerFormOpen(false);
    opener?.focus();
  }

  addContainerBtn?.addEventListener('click', () => {
    if (ctx.uiState.isAddContainerFormOpen) {
      closeAddContainerDialog();
      return;
    }
    ctx.beginAddContainer();
    windowRef.requestAnimationFrame?.(() => {
      addContainerNameInput?.focus();
    }) || addContainerNameInput?.focus();
  });
  addFolderBtn?.addEventListener('click', () => {
    if (ctx.uiState.isAddContainerFormOpen) {
      closeAddContainerDialog();
      return;
    }
    ctx.beginAddFolder();
    windowRef.requestAnimationFrame?.(() => {
      addContainerNameInput?.focus();
    }) || addContainerNameInput?.focus();
  });
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
