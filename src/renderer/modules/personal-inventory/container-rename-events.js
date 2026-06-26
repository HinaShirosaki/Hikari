export function renameContainer(ctx, section, id, rawName) {
  const { persist, state, uiState } = ctx;
  if (!section || !id) {
    return false;
  }

  const container = (state.inventory?.[section] || []).find((item) => item.id === id);
  if (!container) {
    return false;
  }

  const name = String(rawName || '').trim();
  if (!name || name === container.name) {
    return false; // ponytail: blank or unchanged name is a no-op (containers key on id, so duplicates are allowed).
  }

  container.name = name;
  uiState.selectedSectionName = section;
  persist();
  ctx.notifyInventoryChanged();
  ctx.renderSections();
  return true;
}
