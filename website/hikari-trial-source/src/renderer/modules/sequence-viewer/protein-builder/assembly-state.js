import { parseInputRecords } from '../parsing.js';
import { cleanText, clamp, normalizeSequenceText } from '../shared.js';
import { deriveInsertionOffsetFromBackboneSegments } from './backbone-feature-selection.js';
import { deriveReusableBackboneFromRecord } from './backbone-projection.js';
import { normalizeRecordSegments } from './segments.js';

export function installProteinBuilderAssemblyState(ctx) {
  const { state } = ctx;

  ctx.getSelectedStoredBackbone = function getSelectedStoredBackbone() {
    return (Array.isArray(state.storedBackbones) ? state.storedBackbones : [])
      .find((item) => cleanText(item?.id, 400) === cleanText(state.selectedBackboneId, 400)) || null;
  };

  ctx.closeAssemblyDialog = function closeAssemblyDialog() {
    state.assemblyDialogOpen = false;
    state.isLoadingAssemblyBackbones = false;
    state.isPreparingAssembly = false;
    ctx.renderAssemblyDialog?.();
  };

  ctx.normalizeStoredBackboneCandidate = function normalizeStoredBackboneCandidate(backbone = {}) {
    const backboneSequence = normalizeSequenceText(backbone?.backboneSequence || '');
    const insertLength = Math.max(0, Number(backbone?.insertLength) || 0);
    const backboneLength = Math.max(0, Number(backbone?.backboneLength) || backboneSequence.length);
    const originalSequenceLength = Math.max(backboneLength + insertLength, backboneSequence.length);
    const backboneSegments = normalizeRecordSegments(backbone?.backboneSegments, originalSequenceLength);
    const insertSegments = normalizeRecordSegments(backbone?.insertSegments, originalSequenceLength);
    const fallbackInsertionOffset = deriveInsertionOffsetFromBackboneSegments(backboneSegments, originalSequenceLength);
    const explicitInsertionOffset = Number(backbone?.insertionOffset);
    const insertionOffset = clamp(
      Number.isFinite(explicitInsertionOffset)
        ? Math.round(explicitInsertionOffset)
        : (Number.isFinite(fallbackInsertionOffset) ? fallbackInsertionOffset : backboneSequence.length),
      0,
      backboneSequence.length
    );

    return {
      ...backbone,
      sourceKind: cleanText(backbone?.sourceKind, 120) || 'recognized_backbone',
      topology: cleanText(backbone?.topology, 40).toLowerCase() === 'linear' ? 'linear' : 'circular',
      variantMode: cleanText(backbone?.variantMode, 40).toLowerCase() === 'restriction' ? 'restriction' : 'gibson',
      backboneSequence,
      backboneLength,
      insertLength,
      backboneSegments,
      insertSegments,
      insertionOffset,
      features: Array.isArray(backbone?.features) ? backbone.features : []
    };
  };

  ctx.loadStoredBackboneCandidates = async function loadStoredBackboneCandidates() {
    const bridge = ctx.getBridge();
    const storagePath = ctx.getStoragePath();

    if (!bridge?.sequenceLibraryListBackbones) {
      return [];
    }

    const response = await bridge.sequenceLibraryListBackbones({
      storagePath,
      limit: 100
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to load stored backbones.');
    }
    return (Array.isArray(response.results) ? response.results : [])
      .map((item) => ctx.normalizeStoredBackboneCandidate(item));
  };

  ctx.hydrateStoredBackbone = async function hydrateStoredBackbone(backbone = {}) {
    if (!backbone || typeof backbone !== 'object') {
      throw new Error('Missing stored backbone selection.');
    }
    if (backbone.hydratedBackbone && typeof backbone.hydratedBackbone === 'object') {
      return backbone.hydratedBackbone;
    }

    if (cleanText(backbone?.sourceKind, 120) !== 'library_entry') {
      const normalized = ctx.normalizeStoredBackboneCandidate(backbone);
      backbone.hydratedBackbone = normalized;
      return normalized;
    }

    const bridge = ctx.getBridge();
    if (!bridge?.sequenceLibraryGet) {
      throw new Error('Stored sequence entry API unavailable.');
    }

    const response = await bridge.sequenceLibraryGet({
      storagePath: ctx.getStoragePath(),
      id: cleanText(backbone?.entryId, 200),
      includeGbk: true
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to load the selected stored backbone.');
    }

    const gbkText = String(response?.gbkText || '');
    const parsed = parseInputRecords(gbkText, {
      fileName: cleanText(response?.entry?.name, 160) || cleanText(backbone?.entryName, 160) || 'stored_backbone.gbk'
    });
    const record = Array.isArray(parsed?.records) ? parsed.records[0] : null;
    if (!record?.sequence) {
      throw new Error('Stored backbone entry did not contain a usable sequence.');
    }

    const derived = deriveReusableBackboneFromRecord(record, {
      sourceRecordName: cleanText(response?.entry?.name, 160) || cleanText(backbone?.sourceRecordName, 160),
      hostVectorName: cleanText(response?.entry?.name, 160) || cleanText(backbone?.hostVectorName, 160),
      backboneName: cleanText(backbone?.backboneName, 160) || cleanText(response?.entry?.name, 160)
    });
    if (!derived?.backboneSequence) {
      throw new Error('Unable to derive a reusable backbone from the selected sequence entry.');
    }

    const hydrated = {
      ...backbone,
      ...derived,
      templateSequence: record.sequence,
      entryName: cleanText(response?.entry?.name, 160) || cleanText(backbone?.entryName, 160),
      entryStatus: cleanText(response?.entry?.status, 40) || cleanText(backbone?.entryStatus, 40),
      updatedAt: cleanText(response?.entry?.updatedAt, 120) || cleanText(backbone?.updatedAt, 120)
    };
    backbone.hydratedBackbone = hydrated;
    backbone.backboneLength = hydrated.backboneLength;
    backbone.insertionOffset = hydrated.insertionOffset;
    backbone.features = hydrated.features;
    backbone.topology = hydrated.topology;
    return hydrated;
  };
}
