import { cleanText, clamp, normalizeSequenceText } from '../shared.js';
import { buildBackboneCoverageSegments, shiftFeatureForInsertion } from './backbone-projection.js';

export function buildStoredBackboneDisplayName(backbone = {}) {
  return cleanText(backbone?.hostVectorName, 160)
    || cleanText(backbone?.backboneName, 160)
    || cleanText(backbone?.entryName, 160)
    || cleanText(backbone?.sourceRecordName, 160)
    || 'Stored backbone';
}

export function formatStoredBackboneDate(value) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  try {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return String(value || '').slice(0, 10);
  }
}

export function buildAssembledPlasmidPayload(backbone = {}, dnaConstruct = {}, options = {}) {
  const backboneSequence = normalizeSequenceText(backbone?.backboneSequence || '');
  const insertSequence = normalizeSequenceText(dnaConstruct?.sequence || '');
  if (!backboneSequence.length || !insertSequence.length) {
    return null;
  }

  const constructName = cleanText(options?.constructName, 140) || 'Protein Builder Insert';
  const backboneName = buildStoredBackboneDisplayName(backbone);
  const assembledName = `${constructName} (${backboneName})`;
  const explicitInsertionOffset = Number(backbone?.insertionOffset);
  const insertionOffset = clamp(
    Number.isFinite(explicitInsertionOffset) ? Math.round(explicitInsertionOffset) : backboneSequence.length,
    0,
    backboneSequence.length
  );
  const shiftedBackboneFeatures = (Array.isArray(backbone?.features) ? backbone.features : [])
    .map((feature) => shiftFeatureForInsertion(feature, insertionOffset, insertSequence.length))
    .filter(Boolean);
  const hasBackboneFeature = shiftedBackboneFeatures
    .some((feature) => cleanText(feature?.type, 120).toLowerCase() === 'backbone');
  const features = [];

  if (!hasBackboneFeature) {
    features.push({
      id: 'protein_builder_backbone',
      name: `Backbone (${backboneName})`,
      type: 'backbone',
      strand: 1,
      source: 'protein_builder',
      description: `Stored backbone selected from ${cleanText(backbone?.sourceRecordName, 160) || backboneName}.`,
      segments: buildBackboneCoverageSegments(backboneSequence.length, insertionOffset, insertSequence.length)
    });
  }

  features.push(...shiftedBackboneFeatures);
  features.push({
    id: 'protein_builder_insert',
    name: constructName,
    type: 'insert',
    strand: 1,
    source: 'protein_builder',
    description: `Protein Builder insert assembled from ${Math.max(0, Number(dnaConstruct?.parts?.length) || 0)} DNA block(s).`,
    segments: [{ start: insertionOffset, end: insertionOffset + insertSequence.length }]
  });

  let cursor = insertionOffset;
  (Array.isArray(dnaConstruct?.parts) ? dnaConstruct.parts : []).forEach((part, index) => {
    const dnaSequence = normalizeSequenceText(part?.dnaSequence || '');
    if (!dnaSequence.length) {
      return;
    }
    features.push({
      id: `protein_builder_insert_part_${index + 1}`,
      name: cleanText(part?.label, 160) || `Block ${index + 1}`,
      type: 'misc_feature',
      strand: 1,
      source: 'protein_builder',
      description: `Protein Builder DNA block (${dnaSequence.length} bp).`,
      segments: [{ start: cursor, end: cursor + dnaSequence.length }]
    });
    cursor += dnaSequence.length;
  });

  return {
    name: assembledName,
    sequence: `${backboneSequence.slice(0, insertionOffset)}${insertSequence}${backboneSequence.slice(insertionOffset)}`,
    topology: cleanText(backbone?.topology, 40).toLowerCase() === 'linear' ? 'linear' : 'circular',
    source: 'protein_builder',
    features
  };
}

export function buildProteinBuilderConfirmationPayload({
  assembledRecord = {},
  constructName = '',
  backbone = {},
  dnaConstruct = {},
  notebookEntry = null
} = {}) {
  const design = notebookEntry?.proteinBuilderCloningDesign && typeof notebookEntry.proteinBuilderCloningDesign === 'object'
    ? notebookEntry.proteinBuilderCloningDesign
    : null;
  const notebookTitle = cleanText(notebookEntry?.experimentName, 220)
    || cleanText(notebookEntry?.protocolName, 220);
  return {
    recordName: cleanText(assembledRecord?.name, 160),
    constructName: cleanText(constructName, 160),
    backboneName: buildStoredBackboneDisplayName(backbone),
    sourceLabel: cleanText(backbone?.sourceRecordName, 160) || buildStoredBackboneDisplayName(backbone),
    plasmidLength: Math.max(0, Number(assembledRecord?.sequence?.length) || 0),
    insertLength: Math.max(0, Number(dnaConstruct?.length || dnaConstruct?.sequence?.length) || 0),
    notebookEntryId: cleanText(notebookEntry?.id, 160),
    notebookTitle,
    assemblyStrategy: cleanText(design?.recommendedAssemblyStrategy, 120),
    primerCount: Math.max(
      0,
      Number(design?.primerCount) || 0
    ),
    cloningDesignSource: {
      constructName: cleanText(constructName, 160),
      backbone: { ...backbone },
      dnaConstruct: {
        ...dnaConstruct,
        parts: Array.isArray(dnaConstruct?.parts)
          ? dnaConstruct.parts.map((part) => ({ ...part }))
          : []
      },
      assembledRecord: {
        ...assembledRecord,
        features: Array.isArray(assembledRecord?.features)
          ? assembledRecord.features.map((feature) => ({
              ...feature,
              segments: Array.isArray(feature?.segments)
                ? feature.segments.map((segment) => ({ ...segment }))
                : []
            }))
          : []
      }
    }
  };
}
