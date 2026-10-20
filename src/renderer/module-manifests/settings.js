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
    onReloadRequested,
    rendererServices,
    rootDocument,
    windowObject
  }) => ({
    state,
    persist,
    onStoragePathSaved,
    onReloadRequested,
    onSampleInventorySettingsChanged: rendererServices.inventory.handleSampleInventorySettingsChanged,
    document: rootDocument,
    windowObject
  }),
  renderAll: ({ modules }) => {
    modules.settings.renderForms();
    modules.settings.applyAppearance();
  }
};
