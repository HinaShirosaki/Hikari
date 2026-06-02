export function installRenderAll(ctx) {
  const { persist } = ctx;

function renderAll() {
  ctx.ensureLabInventoryShape();
  const migrated = ctx.ensureChemicalCodes();
  if (migrated) {
    persist();
  }
  ctx.renderLocationOptions();
  ctx.renderChemicalList();
  ctx.renderChemicalDetail();
  ctx.renderBlockchain();
  void ctx.syncChemicalSqliteBundle(migrated);
}

  ctx.renderAll = renderAll;
}
