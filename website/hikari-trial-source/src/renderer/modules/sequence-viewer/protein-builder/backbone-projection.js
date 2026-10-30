import { cleanText, clamp, normalizeSequenceText } from '../shared.js';
import {
  buildSequenceFromSegments,
  invertSegments,
  mergeSegments,
  normalizeRecordSegments
} from './segments.js';
import {
  deriveInsertionOffsetFromBackboneSegments,
  resolvePromoterInsertionOffset,
  selectFeatureByType
} from './backbone-feature-selection.js';

export function projectSegmentsOntoBackbone(featureSegments, backboneSegments, sequenceLength) {
  const orderedBackboneSegments = normalizeRecordSegments(backboneSegments, sequenceLength);
  const normalizedFeatureSegments = normalizeRecordSegments(featureSegments, sequenceLength);
  if (!orderedBackboneSegments.length || !normalizedFeatureSegments.length) {
    return [];
  }

  const projectionMap = [];
  let projectedCursor = 0;
  orderedBackboneSegments.forEach((segment) => {
    const length = Math.max(0, segment.end - segment.start);
    if (!length) {
      return;
    }
    projectionMap.push({
      originalStart: segment.start,
      originalEnd: segment.end,
      projectedStart: projectedCursor
    });
    projectedCursor += length;
  });

  const projectedSegments = [];
  normalizedFeatureSegments.forEach((featureSegment) => {
    projectionMap.forEach((projection) => {
      const overlapStart = Math.max(featureSegment.start, projection.originalStart);
      const overlapEnd = Math.min(featureSegment.end, projection.originalEnd);
      if (overlapEnd <= overlapStart) {
        return;
      }
      projectedSegments.push({
        start: projection.projectedStart + (overlapStart - projection.originalStart),
        end: projection.projectedStart + (overlapEnd - projection.originalStart)
      });
    });
  });

  return mergeSegments(projectedSegments);
}

export function projectFeatureOntoBackbone(feature, backboneSegments, sequenceLength, index = 0) {
  if (!feature || typeof feature !== 'object') {
    return null;
  }

  const featureType = cleanText(feature?.type, 120).toLowerCase();
  if (featureType === 'insert') {
    return null;
  }

  const projectedSegments = projectSegmentsOntoBackbone(feature?.segments, backboneSegments, sequenceLength);
  if (!projectedSegments.length) {
    return null;
  }

  return {
    id: cleanText(feature?.id, 200) || `stored_backbone_feature_${index + 1}`,
    name: cleanText(feature?.name, 160) || `Feature ${index + 1}`,
    type: featureType || 'misc_feature',
    strand: Number(feature?.strand) === -1 ? -1 : 1,
    source: cleanText(feature?.source, 120) || 'stored_backbone',
    description: cleanText(feature?.description, 2400),
    locationText: cleanText(feature?.locationText, 240),
    segments: projectedSegments
  };
}

export function shiftSegmentsForInsertion(segments, insertionOffset, insertLength) {
  const safeOffset = Math.max(0, Math.round(Number(insertionOffset) || 0));
  const safeInsertLength = Math.max(0, Math.round(Number(insertLength) || 0));
  const shifted = [];

  mergeSegments(segments).forEach((segment) => {
    if (segment.end <= safeOffset) {
      shifted.push({ ...segment });
      return;
    }
    if (segment.start >= safeOffset) {
      shifted.push({
        start: segment.start + safeInsertLength,
        end: segment.end + safeInsertLength
      });
      return;
    }
    shifted.push({ start: segment.start, end: safeOffset });
    shifted.push({
      start: safeOffset + safeInsertLength,
      end: segment.end + safeInsertLength
    });
  });

  return mergeSegments(shifted);
}

export function shiftFeatureForInsertion(feature, insertionOffset, insertLength) {
  if (!feature || typeof feature !== 'object') {
    return null;
  }
  const shiftedSegments = shiftSegmentsForInsertion(feature?.segments, insertionOffset, insertLength);
  if (!shiftedSegments.length) {
    return null;
  }
  return {
    ...feature,
    segments: shiftedSegments
  };
}

export function buildBackboneCoverageSegments(backboneLength, insertionOffset, insertLength) {
  const safeBackboneLength = Math.max(0, Math.round(Number(backboneLength) || 0));
  const safeOffset = clamp(Math.round(Number(insertionOffset) || 0), 0, safeBackboneLength);
  const safeInsertLength = Math.max(0, Math.round(Number(insertLength) || 0));
  const segments = [];

  if (safeOffset > 0) {
    segments.push({ start: 0, end: safeOffset });
  }
  if (safeBackboneLength > safeOffset) {
    segments.push({
      start: safeOffset + safeInsertLength,
      end: safeOffset + safeInsertLength + (safeBackboneLength - safeOffset)
    });
  }

  return mergeSegments(segments);
}

export function deriveReusableBackboneFromRecord(record = {}, options = {}) {
  const sequence = normalizeSequenceText(record?.sequence || '');
  const features = Array.isArray(record?.features) ? record.features : [];
  if (!sequence.length) {
    return null;
  }

  const explicitBackboneFeature = selectFeatureByType(features, 'backbone', sequence.length);
  const explicitInsertFeature = selectFeatureByType(features, 'insert', sequence.length);
  const explicitBackboneSegments = normalizeRecordSegments(explicitBackboneFeature?.segments, sequence.length);
  const explicitInsertSegments = normalizeRecordSegments(explicitInsertFeature?.segments, sequence.length);
  let reusableBackboneSegments = explicitBackboneSegments.length
    ? explicitBackboneSegments
    : (explicitInsertSegments.length ? invertSegments(explicitInsertSegments, sequence.length) : []);

  if (!reusableBackboneSegments.length) {
    reusableBackboneSegments = [{ start: 0, end: sequence.length }];
  }

  const backboneSequence = buildSequenceFromSegments(sequence, reusableBackboneSegments);
  const backboneLength = backboneSequence.length;
  const projectedFeatures = features
    .map((feature, index) => projectFeatureOntoBackbone(feature, reusableBackboneSegments, sequence.length, index))
    .filter(Boolean);
  const insertionOffset = clamp(
    deriveInsertionOffsetFromBackboneSegments(reusableBackboneSegments, sequence.length)
      ?? resolvePromoterInsertionOffset(projectedFeatures, backboneLength),
    0,
    backboneLength
  );

  return {
    topology: cleanText(record?.topology, 40).toLowerCase() === 'linear' ? 'linear' : 'circular',
    backboneSequence,
    backboneLength,
    backboneSegments: reusableBackboneSegments,
    insertSegments: explicitInsertSegments,
    insertionOffset,
    features: projectedFeatures,
    sourceRecordName: cleanText(options?.sourceRecordName, 160) || cleanText(record?.name, 160),
    hostVectorName: cleanText(options?.hostVectorName, 160) || cleanText(record?.name, 160),
    backboneName: cleanText(options?.backboneName, 160) || cleanText(record?.name, 160) || 'Stored backbone'
  };
}
