import { initPersonalInventory } from '../modules/personal-inventory/index.js';

export const personalInventoryManifest = {
  key: 'personalInventory',
  init: initPersonalInventory,
  createOptions: ({
    state,
    persist,
    createId,
    safeText,
    cssEscape,
    rendererServices
  }) => ({
    state,
    persist,
    createId,
    safeText,
    cssEscape,
    onSamplesChanged: rendererServices.inventory.handleSamplesChanged
  })
};
