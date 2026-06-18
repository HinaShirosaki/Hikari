import { initSettings } from '../modules/settings/index.js';

export const settingsManifest = {
  key: 'settings',
  init: initSettings,
  bootOrder: 90,
  createOptions: ({
    state,
    persist,
    onStoragePathSaved,
    rendererServices
  }) => ({
    state,
    persist,
    onStoragePathSaved,
    onSampleInventorySettingsChanged: rendererServices.inventory.handleSampleInventorySettingsChanged
  }),
  renderAll: ({ modules }) => {
    modules.settings.renderForms();
    modules.settings.applyAppearance();
  }
};
