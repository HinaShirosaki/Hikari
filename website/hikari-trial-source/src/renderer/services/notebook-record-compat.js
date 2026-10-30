// Compatibility boundary for persisted Sequence Viewer cloning notebook records.
// App-state hydration and Notebook display consume this service instead of
// importing Sequence Viewer implementation files directly.
import { asArray } from '../lib/normalize.js';
import { upsertProtocolRecord } from './protocolService.js';
import {
  cloneProtocolSnapshot,
  resolveProteinBuilderCloningNotebookProtocol
} from '../modules/sequence-viewer/protein-builder-cloning/notebook-protocol.js';

export { resolveProteinBuilderCloningNotebookProtocol };

export function migrateProteinBuilderCloningNotebookState(state = {}) {
  if (!state || typeof state !== 'object') {
    return 0;
  }

  let migratedCount = 0;
  let latestProtocol = null;
  state.notebookEntries = asArray(state.notebookEntries).map((entry) => {
    const protocol = resolveProteinBuilderCloningNotebookProtocol(entry);
    if (!protocol) {
      return entry;
    }
    migratedCount += 1;
    latestProtocol = protocol;
    return {
      ...entry,
      protocolId: protocol.id,
      protocolName: protocol.name,
      protocolSnapshot: cloneProtocolSnapshot(protocol)
    };
  });

  if (latestProtocol) {
    state.protocols = asArray(state.protocols);
    const existing = state.protocols.find((protocol) => (
      String(protocol?.id || '').trim() === String(latestProtocol.id || '').trim()
    ));
    upsertProtocolRecord(state.protocols, {
      ...existing,
      ...latestProtocol,
      createdAt: String(existing?.createdAt || '').trim() || latestProtocol.createdAt
    });
  }

  return migratedCount;
}
