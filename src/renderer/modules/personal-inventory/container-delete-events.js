export function deleteContainer(ctx, section, id) {
  const { persist, state, uiState } = ctx;
  if (!section || !id) {
    return false;
  }

  const containers = state.inventory?.[section] || [];
  if (!containers.some((item) => item.id === id)) {
    return false;
  }

  state.inventory[section] = containers.filter((item) => item.id !== id);
  state.samples = (state.samples || []).map((sample) => {
    const link = sample.inventoryLink;
    if (!link || link.section !== section || link.containerId !== id) {
      return sample;
    }
    return { ...sample, inventoryLink: null, updatedAt: new Date().toISOString() };
  });

  if (
    uiState.selectedContainer
    && uiState.selectedContainer.section === section
    && uiState.selectedContainer.containerId === id
  ) {
    uiState.selectedContainer = null;
    uiState.editingWellIndex = -1;
    uiState.editingSampleId = '';
    uiState.wellEditorStatus = '';
    uiState.shouldAutoOpenContainer = true;
  }

  uiState.selectedSectionName = section;
  persist();
  ctx.notifyInventoryChanged();
  ctx.renderSections();
  return true;
}
