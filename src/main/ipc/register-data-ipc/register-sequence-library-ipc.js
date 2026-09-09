'use strict';

const { SEQUENCE_LIBRARY } = require('../../../shared/ipc/channels');

function registerSequenceLibraryIpc(deps = {}) {
  const {
    ipcMain,
    cleanText,
    normalizeJsonPayload,
    listSequenceEntries,
    getSequenceEntry,
    upsertSequenceEntry,
    promoteSequenceEntry,
    deleteSequenceEntry,
    upsertSequenceFolder,
    deleteSequenceFolder,
    moveSequenceEntryToFolder,
    annotateSequenceRecord,
    searchSequenceFeatures,
    listRecognizedBackbones,
    upsertRecognizedBackbone,
    recognizeSequenceBackbone
  } = deps;

  const handle = (channel, action) => {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        const normalizedPayload = normalizeJsonPayload(payload, {});
        const result = await action(normalizedPayload);
        return { ok: true, ...result };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    });
  };

  const requireStoragePath = (payload) => {
    const storagePath = cleanText(payload?.storagePath, 2000);
    if (!storagePath) {
      throw new Error('Missing storage path.');
    }
    return storagePath;
  };

  const requireEntryId = (payload) => {
    const id = cleanText(payload?.id, 200);
    if (!id) {
      throw new Error('Missing sequence entry id.');
    }
    return id;
  };

  handle(SEQUENCE_LIBRARY.AGENT_ARTIFACT, async (payload) => {
    const store = require('../../../renderer/modules/sequence-viewer/main-process/mcp/store');
    const { withLibraryLock } = require('../../../renderer/modules/sequence-viewer/main-process/sequence-library/operation-lock');
    const storagePath = requireStoragePath(payload);
    return withLibraryLock(storagePath, async () => {
      const value = payload.entryId ? await store.load(storagePath, payload.entryId) : null;
      const construct = payload.constructId ? await store.artifact(storagePath, payload.constructId) : value?.metadata?.construct;
      return { design: value?.metadata || null, construct: construct || null,
        designCurrent: Boolean(value?.metadata?.primer_design && value.metadata.result_sequence_hash === store.hash(value.record.sequence) && value.metadata.source_record.topology === value.record.topology) };
    });
  });

  handle(SEQUENCE_LIBRARY.LIST, async (payload) => listSequenceEntries({
    storagePath: requireStoragePath(payload),
    status: cleanText(payload?.status, 40),
    projects: (Array.isArray(payload?.projects) ? payload.projects : []).map((project) => ({
      id: cleanText(project?.id, 200),
      name: cleanText(project?.name, 320)
    }))
  }));

  handle(SEQUENCE_LIBRARY.GET, async (payload) => getSequenceEntry({
    storagePath: requireStoragePath(payload),
    id: requireEntryId(payload),
    includeGbk: payload?.includeGbk === true,
    includeAlignments: payload?.includeAlignments === true
  }));

  handle(SEQUENCE_LIBRARY.UPSERT, async (payload) => upsertSequenceEntry({
    storagePath: requireStoragePath(payload),
    id: cleanText(payload?.id, 200),
    name: cleanText(payload?.name, 140),
    status: cleanText(payload?.status, 40),
    sourceFormat: cleanText(payload?.sourceFormat, 80),
    topology: cleanText(payload?.topology, 40),
    sequenceLength: Number(payload?.sequenceLength),
    featureCount: Number(payload?.featureCount),
    sequence: String(payload?.sequence || ''),
    features: Array.isArray(payload?.features) ? payload.features : [],
    gbkText: String(payload?.gbkText || ''),
    alignmentSessions: Array.isArray(payload?.alignmentSessions) ? payload.alignmentSessions : null
  }));

  handle(SEQUENCE_LIBRARY.PROMOTE, async (payload) => promoteSequenceEntry({
    storagePath: requireStoragePath(payload),
    id: requireEntryId(payload),
    name: cleanText(payload?.name, 140)
  }));

  handle(SEQUENCE_LIBRARY.DELETE, async (payload) => deleteSequenceEntry({
    storagePath: requireStoragePath(payload),
    id: requireEntryId(payload)
  }));

  handle(SEQUENCE_LIBRARY.UPSERT_FOLDER, async (payload) => upsertSequenceFolder({
    storagePath: requireStoragePath(payload),
    id: cleanText(payload?.id, 200),
    name: cleanText(payload?.name, 140)
  }));

  handle(SEQUENCE_LIBRARY.DELETE_FOLDER, async (payload) => deleteSequenceFolder({
    storagePath: requireStoragePath(payload),
    id: cleanText(payload?.id, 200)
  }));

  handle(SEQUENCE_LIBRARY.MOVE_ENTRY, async (payload) => moveSequenceEntryToFolder({
    storagePath: requireStoragePath(payload),
    id: requireEntryId(payload),
    folderId: cleanText(payload?.folderId, 200)
  }));

  handle(SEQUENCE_LIBRARY.SEARCH_FEATURES, async (payload) => searchSequenceFeatures({
    storagePath: requireStoragePath(payload),
    query: cleanText(payload?.query, 600),
    limit: Number(payload?.limit)
  }));

  handle(SEQUENCE_LIBRARY.LIST_BACKBONES, async (payload) => {
    if (typeof listRecognizedBackbones !== 'function') {
      throw new Error('Stored backbone API unavailable.');
    }
    return listRecognizedBackbones({
      storagePath: requireStoragePath(payload),
      query: cleanText(payload?.query, 600),
      limit: Number(payload?.limit)
    });
  });

  handle(SEQUENCE_LIBRARY.UPSERT_BACKBONE, async (payload) => {
    if (typeof upsertRecognizedBackbone !== 'function') {
      throw new Error('Stored backbone API unavailable.');
    }
    return upsertRecognizedBackbone({
      storagePath: requireStoragePath(payload),
      backbone: payload?.backbone || payload?.data || {}
    });
  });

  handle(SEQUENCE_LIBRARY.ANNOTATE, async (payload) => {
    if (typeof annotateSequenceRecord !== 'function') {
      throw new Error('Sequence annotation API unavailable.');
    }
    return annotateSequenceRecord({
      storagePath: requireStoragePath(payload),
      sequence: String(payload?.sequence || ''),
      topology: cleanText(payload?.topology, 40),
      excludeEntryId: cleanText(payload?.excludeEntryId, 200)
    });
  });

  handle(SEQUENCE_LIBRARY.RECOGNIZE_BACKBONE, async (payload) => {
    if (typeof recognizeSequenceBackbone !== 'function') {
      throw new Error('Backbone recognition API unavailable.');
    }
    return recognizeSequenceBackbone({
      storagePath: requireStoragePath(payload),
      sequence: String(payload?.sequence || ''),
      excludeEntryId: cleanText(payload?.excludeEntryId, 200)
    });
  });
}

module.exports = {
  registerSequenceLibraryIpc
};
