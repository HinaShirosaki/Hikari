import { initPersonalInventory } from '../modules/personal-inventory/index.js';

export const personalInventoryManifest = {
  key: 'personalInventory',
  init: initPersonalInventory,
  viewKey: 'PERSONAL_INVENTORY',
  createOptions: ({
    state,
    persist,
    createId,
    safeText,
    cssEscape,
    rendererServices,
    modules
  }) => ({
    state,
    persist,
    createId,
    safeText,
    cssEscape,
    onSamplesChanged: rendererServices.inventory.handleSamplesChanged,
    onSampleRecorded: (sample) => modules.sampleRegistry?.captureRecordedSample?.(sample)
  }),
  render: ({ modules }) => {
    modules.personalInventory.renderSections();
  }
};
