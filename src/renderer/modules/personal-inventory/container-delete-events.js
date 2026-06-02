export function bindContainerDeleteEvents(ctx) {
  const { persist, state, uiState } = ctx;
  const { inventorySections } = ctx.elements;
  const notifyInventoryChanged = () => ctx.notifyInventoryChanged();
  const renderSections = () => ctx.renderSections();

  inventorySections.querySelectorAll('[data-container-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.section;
      const id = button.dataset.containerDelete;
      state.inventory[section] = (state.inventory[section] || []).filter((item) => item.id !== id);
      state.samples = (state.samples || []).map((sample) => {
        const link = sample.inventoryLink;
        if (!link || link.section !== section || link.containerId !== id) {
          return sample;
        }
        return { ...sample, inventoryLink: null, updatedAt: new Date().toISOString() };
      });

      if (uiState.selectedContainer && uiState.selectedContainer.section === section && uiState.selectedContainer.containerId === id) {
        uiState.selectedContainer = null;
        uiState.editingWellIndex = -1;
        uiState.editingSampleId = '';
        uiState.wellEditorStatus = '';
        uiState.shouldAutoOpenContainer = true;
      }

      uiState.selectedSectionName = section;
      persist();
      notifyInventoryChanged();
      renderSections();
    });
  });
}
