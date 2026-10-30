// Where gel records live now.
//
// Gel analysis moved out of the renderer into the bundled Gel plugin, which
// keeps its records in settings.pluginStorage.gel and its files under
// <storage root>/Plugins/gel/. Host surfaces still need to read them — the
// notebook's linked-gel preview, the project dashboard, the home contribution
// graph, the project PDF, the agent's experiment snapshot — and after the port
// nothing writes state.gelAnalyses any more, so reading it directly returns
// data frozen at the migration.
//
// This is the one place that knows both facts: which slice holds the records,
// and that their paths are relative to the plugin folder rather than absolute
// the way the pre-port host records were.

import { joinStoragePath } from './storage-paths.js';

const GEL_PLUGIN_ID = 'gel';
const PLUGIN_FILES_FOLDER = 'Plugins';

function toHostPath(storageRoot, value) {
  const filePath = String(value || '').trim().replace(/^\.\//, '');
  if (!filePath || filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath)) {
    return filePath;
  }
  if (!storageRoot) {
    return '';
  }
  return joinStoragePath(storageRoot, `${PLUGIN_FILES_FOLDER}/${GEL_PLUGIN_ID}/${filePath}`);
}

export function getGelAnalyses(state) {
  const stored = state?.settings?.pluginStorage?.[GEL_PLUGIN_ID];
  const records = Array.isArray(stored?.gelAnalyses) ? stored.gelAnalyses : null;
  if (!records) {
    // The plugin has never run here: pre-migration state is still the truth.
    return Array.isArray(state?.gelAnalyses) ? state.gelAnalyses : [];
  }
  const storageRoot = String(state?.settings?.storagePath || '').trim();
  return records.map((record) => ({
    ...record,
    previewImagePath: toHostPath(storageRoot, record?.previewImagePath),
    sourceImagePath: toHostPath(storageRoot, record?.sourceImagePath),
    originalImagePath: toHostPath(storageRoot, record?.originalImagePath),
    analysisResultPath: toHostPath(storageRoot, record?.analysisResultPath),
    recordJsonPath: toHostPath(storageRoot, record?.recordJsonPath)
  }));
}
