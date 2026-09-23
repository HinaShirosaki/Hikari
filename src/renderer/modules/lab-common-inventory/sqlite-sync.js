import { showTransientNotice } from '../../lib/notify.js';

export function installChemicalSqliteSync(ctx) {
  const { state } = ctx;

function buildChemicalSqliteSyncKey() {
  const storagePath = String(state.settings?.storagePath || '').trim();
  const summary = state.labInventory.chemicals
    .map((item) => `${item.id}|${item.locationCode || ''}|${item.updatedAt || ''}`)
    .join('||');
  const locationCodeMapSummary = Object.entries(state.labInventory.locationCodeMap || {})
    .map(([location, letter]) => `${location}:${letter}`)
    .sort()
    .join('|');
  const nextByLocationSummary = Object.entries(state.labInventory.locationCodeNextByLocation || {})
    .map(([location, number]) => `${location}:${Number(number) || 0}`)
    .sort()
    .join('|');
  return `${storagePath}::${summary}::${state.labInventory.blocks.length}::${Number(state.labInventory.lastLocationNumber) || 0}::${locationCodeMapSummary}::${nextByLocationSummary}`;
}

async function syncChemicalSqliteBundle(force = false) {
  const storagePath = String(state.settings?.storagePath || '').trim();
  if (!storagePath || !window.hikariApi?.syncSqliteBundle) {
    return;
  }

  const syncKey = buildChemicalSqliteSyncKey();
  if (!force && syncKey === ctx.lastChemicalSqliteSyncKey) {
    return;
  }

  const inventorySnapshot = {
    labInventory: {
      chemicals: Array.isArray(state.labInventory.chemicals) ? state.labInventory.chemicals : [],
      blocks: Array.isArray(state.labInventory.blocks) ? state.labInventory.blocks : [],
      lastLocationNumber: Number(state.labInventory.lastLocationNumber) || 0,
      locationCodeMap: state.labInventory.locationCodeMap || {},
      locationCodeNextByLocation: state.labInventory.locationCodeNextByLocation || {}
    },
    inventory: state.inventory && typeof state.inventory === 'object' ? state.inventory : {},
    settings: {
      storagePath,
      inventoryLocations: Array.isArray(state.settings?.inventoryLocations)
        ? state.settings.inventoryLocations
        : []
    }
  };

  try {
    // Main owns the bundle path; this side only says which bundle it is.
    const result = await window.hikariApi.syncSqliteBundle({
      mode: 'chemical',
      snapshot: inventorySnapshot
    });
    if (result?.ok) {
      ctx.lastChemicalSqliteSyncKey = syncKey;
    } else {
      console.warn('Failed to sync chemical sqlite bundle:', result?.error || 'unknown error');
      showTransientNotice('Chemical inventory could not be written to the sqlite bundle.', { type: 'error' });
    }
  } catch (error) {
    console.warn('Failed to sync chemical sqlite bundle:', error);
    showTransientNotice('Chemical inventory could not be written to the sqlite bundle.', { type: 'error' });
  }
}

  Object.assign(ctx, {
    buildChemicalSqliteSyncKey,
    syncChemicalSqliteBundle
  });
}
