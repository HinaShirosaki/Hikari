function ensureFolderMap(state) {
  if (!state.inventoryFolders || typeof state.inventoryFolders !== 'object' || Array.isArray(state.inventoryFolders)) {
    state.inventoryFolders = {};
  }
  return state.inventoryFolders;
}

export function renameInventoryFolder(ctx, section, folderId, rawName) {
  const folder = ctx.helpers?.getFolder?.(section, folderId);
  const name = String(rawName || '').trim();
  if (!folder || !name || name === folder.name) {
    return false;
  }
  folder.name = name;
  ctx.uiState.selectedSectionName = section;
  ctx.persist();
  ctx.notifyInventoryChanged();
  ctx.renderSections();
  return true;
}

export function deleteInventoryFolder(ctx, section, folderId) {
  const folder = ctx.helpers?.getFolder?.(section, folderId);
  if (!folder) {
    return false;
  }
  const parentFolderId = String(folder.parentFolderId || '');
  const folderMap = ensureFolderMap(ctx.state);
  folderMap[section] = (folderMap[section] || [])
    .filter((item) => String(item?.id || '') !== String(folderId))
    .map((item) => (
      String(item?.parentFolderId || '') === String(folderId)
        ? { ...item, parentFolderId }
        : item
    ));
  ctx.state.inventory[section] = (ctx.state.inventory?.[section] || []).map((container) => (
    String(container?.folderId || '') === String(folderId)
      ? { ...container, folderId: parentFolderId }
      : container
  ));
  ctx.uiState.selectedSectionName = section;
  ctx.persist();
  ctx.notifyInventoryChanged();
  ctx.renderSections();
  return true;
}
