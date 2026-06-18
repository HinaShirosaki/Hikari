import { cleanText, clamp } from '../shared.js';
import { mergeSegments, normalizeRecordSegments, sumSegmentLength } from './segments.js';

export function getFeatureSpanLength(feature, sequenceLength) {
  return sumSegmentLength(normalizeRecordSegments(feature?.segments, sequenceLength));
}

export function getReusableBackboneFeaturePriority(feature, sequenceLength) {
  const source = cleanText(feature?.source, 120).toLowerCase();
  const type = cleanText(feature?.type, 120).toLowerCase();
  return [
    type === 'backbone' ? 0 : 1,
    source === 'backbone_recognition' ? 0 : (source === 'protein_builder' ? 1 : 2),
    -getFeatureSpanLength(feature, sequenceLength),
    cleanText(feature?.name, 160)
  ];
}

export function getReusableInsertFeaturePriority(feature, sequenceLength) {
  const source = cleanText(feature?.source, 120).toLowerCase();
  const type = cleanText(feature?.type, 120).toLowerCase();
  return [
    type === 'insert' ? 0 : 1,
    source === 'backbone_recognition' ? 0 : (source === 'protein_builder' ? 1 : 2),
    -getFeatureSpanLength(feature, sequenceLength),
    cleanText(feature?.name, 160)
  ];
}

export function comparePriorityTuple(left = [], right = []) {
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === rightValue) {
      continue;
    }
    if (typeof leftValue === 'string' || typeof rightValue === 'string') {
      return String(leftValue || '').localeCompare(String(rightValue || ''));
    }
    return Number(leftValue || 0) - Number(rightValue || 0);
  }
  return 0;
}

export function selectFeatureByType(features, type, sequenceLength) {
  return (Array.isArray(features) ? features : [])
    .filter((feature) => cleanText(feature?.type, 120).toLowerCase() === type)
    .sort((left, right) => {
      const leftPriority = type === 'backbone'
        ? getReusableBackboneFeaturePriority(left, sequenceLength)
        : getReusableInsertFeaturePriority(left, sequenceLength);
      const rightPriority = type === 'backbone'
        ? getReusableBackboneFeaturePriority(right, sequenceLength)
        : getReusableInsertFeaturePriority(right, sequenceLength);
      return comparePriorityTuple(leftPriority, rightPriority);
    })[0] || null;
}

export function deriveInsertionOffsetFromBackboneSegments(backboneSegments, sequenceLength) {
  const orderedSegments = normalizeRecordSegments(backboneSegments, sequenceLength);
  if (!orderedSegments.length) {
    return null;
  }
  if (orderedSegments.length === 1) {
    const wrapGap = Math.max(0, sequenceLength - orderedSegments[0].end) + orderedSegments[0].start;
    return wrapGap > 0 ? orderedSegments[0].end - orderedSegments[0].start : null;
  }

  let cursor = 0;
  for (let index = 0; index < orderedSegments.length - 1; index += 1) {
    const current = orderedSegments[index];
    const next = orderedSegments[index + 1];
    cursor += current.end - current.start;
    const gapLength = next.start >= current.end
      ? next.start - current.end
      : Math.max(0, sequenceLength - current.end) + next.start;
    if (gapLength > 0) {
      return cursor;
    }
  }

  const last = orderedSegments[orderedSegments.length - 1];
  const first = orderedSegments[0];
  const wrapGap = Math.max(0, sequenceLength - last.end) + first.start;
  if (wrapGap > 0) {
    return sumSegmentLength(orderedSegments);
  }
  return null;
}

export function resolvePromoterInsertionOffset(features, backboneLength) {
  const safeBackboneLength = Math.max(0, Number(backboneLength) || 0);
  const promoter = (Array.isArray(features) ? features : [])
    .filter((feature) => cleanText(feature?.type, 120).toLowerCase() === 'promoter')
    .map((feature) => ({
      feature,
      segments: mergeSegments(feature?.segments)
    }))
    .filter((entry) => entry.segments.length)
    .sort((left, right) => {
      if (left.segments[0].start !== right.segments[0].start) {
        return left.segments[0].start - right.segments[0].start;
      }
      return right.segments[right.segments.length - 1].end - left.segments[left.segments.length - 1].end;
    })[0];

  if (!promoter) {
    return safeBackboneLength;
  }
  return clamp(promoter.segments[promoter.segments.length - 1].end, 0, safeBackboneLength);
}
