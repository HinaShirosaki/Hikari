import { initLabCommonInventory } from '../modules/lab-common-inventory/index.js';

export const labCommonInventoryManifest = {
  key: 'labCommonInventory',
  historyStateKeys: ['labInventory'],
  init: initLabCommonInventory,
  viewKey: 'LAB_COMMON_INVENTORY',
  bootOrder: 40,
  createOptions: ({
    state,
    persist,
    createId,
    safeText
  }) => ({
    state,
    persist,
    createId,
    safeText
  }),
  render: ({ modules }) => modules.labCommonInventory.renderAll()
};
