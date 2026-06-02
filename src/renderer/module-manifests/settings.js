import { initSettings } from '../modules/settings/index.js';

export const settingsManifest = {
  key: 'settings',
  init: initSettings,
  bootOrder: 90,
  createOptions: ({
    state,
    persist,
    onStoragePathSaved
  }) => ({
    state,
    persist,
    onStoragePathSaved
  }),
  renderAll: ({ modules }) => {
    modules.settings.renderForms();
    modules.settings.applyAppearance();
  }
};
