import { buildStateSnapshot } from './state-snapshot.js';
import { trimText } from './shared.js';

export const buildSyncedStateSnapshot = async ({
  api,
  state,
  projectId
}) => {
  let syncResult = null;
  const storagePath = trimText(state.settings?.storagePath, 1200);
  if (api?.autoSaveDataFile && storagePath) {
    syncResult = await api.autoSaveDataFile(state, '');
    if (!syncResult?.ok) {
      throw new Error(syncResult?.error || 'Failed to sync data before agent request.');
    }
  }
  const stateSnapshot = buildStateSnapshot(state, projectId);
  if (!stateSnapshot.data_file_path) {
    stateSnapshot.data_file_path = trimText(syncResult?.filePath, 1600);
  }
  return stateSnapshot;
};
