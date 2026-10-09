export function deleteContainer(ctx, section, id) {
  const { persist, state, uiState } = ctx;
  if (!section || !id) {
    return false;
  }

  const containers = state.inventory?.[section] || [];
  if (!containers.some((item) => item.id === id)) {
    return false;
  }

  state.inventory[section] = containers.filter((item) => String(item?.id || '') !== String(id));
  // Samples only exist inside a container, so they go with it (undo restores both).
  state.samples = (state.samples || []).filter((sample) => {
    const link = sample.inventoryLink;
    return !link || link.section !== section || String(link.containerId || '') !== String(id);
  });

  if (
    uiState.selectedContainer
    && uiState.selectedContainer.section === section
    && String(uiState.selectedContainer.containerId || '') === String(id)
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
