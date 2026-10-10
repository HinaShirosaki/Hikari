import { initSettings } from '../modules/settings/index.js';

export const settingsManifest = {
  key: 'settings',
  viewKey: 'SETTING',
  historyStateKeys: ['settings'],
  init: initSettings,
  bootOrder: 90,
  createOptions: ({
    state,
    persist,
    onStoragePathSaved,
    runCloudSync,
    rendererServices,
    rootDocument,
    windowObject
  }) => ({
    state,
    persist,
    onStoragePathSaved,
    runCloudSync,
    onSampleInventorySettingsChanged: rendererServices.inventory.handleSampleInventorySettingsChanged,
    document: rootDocument,
    windowObject
  }),
  renderAll: ({ modules }) => {
    modules.settings.renderForms();
    modules.settings.applyAppearance();
  }
};
