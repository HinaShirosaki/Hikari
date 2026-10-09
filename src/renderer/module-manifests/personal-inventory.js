import { initPersonalInventory } from '../modules/personal-inventory/index.js';

export const personalInventoryManifest = {
  key: 'personalInventory',
  historyStateKeys: ['samples', 'inventory', 'inventoryFolders', 'settings'],
  init: initPersonalInventory,
  viewKey: 'SAMPLE_REGISTRY',
  bootOrder: 60,
  createOptions: ({
    state,
    persist,
    createId,
    safeText,
    cssEscape
  }) => ({
    state,
    persist,
    createId,
    safeText,
    cssEscape
  }),
  render: ({ modules }) => {
    modules.personalInventory.renderSections();
  }
};
