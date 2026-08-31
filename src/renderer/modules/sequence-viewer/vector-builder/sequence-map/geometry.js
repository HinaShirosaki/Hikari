import { assignFeatureLanes, buildFeatureLocationText, hashTypeToColor } from '../../feature-model.js';
import { isPrimerBindingFeature } from '../../feature-types.js';
import { normalizeTopology } from '../../shared.js';
import { MAX_MAP_ZOOM, MIN_MAP_ZOOM, TAU } from './map-constants.js';

function getMapKind(record) {
  return normalizeTopology(record?.topology) === 'circular' ? 'circular' : 'linear';
}

function clampMapZoom(value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) {
    return MIN_MAP_ZOOM;
  }
  return Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, zoom));
}

function fixed(value) {
  return (Number(value) || 0).toFixed(2);
}

function polar(radius, base, sequenceLength) {
  const theta = (TAU * base) / Math.max(1, sequenceLength);
  return {
    x: radius * Math.sin(theta),
    y: -radius * Math.cos(theta)
  };
}

function normalizeSegments(feature, sequenceLength) {
  return (Array.isArray(feature?.segments) ? feature.segments : [])
    .map((segment) => ({
      start: Math.max(0, Number(segment?.start) || 0),
      end: Math.min(sequenceLength, Number(segment?.end) || 0)
    }))
    .filter((segment) => segment.end > segment.start);
}

function describeFeature(feature, index, sequenceLength) {
  const colorKey = feature.type === 'restriction_site' ? `${feature.type}:${feature.name}` : feature.type;
  return {
    index,
    color: hashTypeToColor(colorKey),
    strand: Number(feature.strand) === -1 ? -1 : (Number(feature.strand) === 1 ? 1 : 0),
    name: String(feature.name || feature.type || 'feature'),
    title: `${feature.name || 'feature'} (${buildFeatureLocationText(feature, sequenceLength)})`,
    lane: Math.max(0, Number(feature.lane) || 0),
    segments: normalizeSegments(feature, sequenceLength)
  };
}

// Split primers out of the lane-packed features while keeping each feature's
// original index: data-feature-index is what the click, hover and context-menu
// handlers resolve against.
function partitionFeatures(features, sequenceLength) {
  const parts = [];
  const primers = [];
  features.forEach((feature, index) => {
    (isPrimerBindingFeature(feature?.type) ? primers : parts).push({ feature, index });
  });
  const laidOut = assignFeatureLanes(parts.map((entry) => entry.feature))
    .map((feature, position) => describeFeature(feature, parts[position].index, sequenceLength));
  return {
    laidOut,
    primers: primers.map((entry) => describeFeature(entry.feature, entry.index, sequenceLength))
  };
}

// The 5' end is the anchor: forward primers extend clockwise from their start,
// reverse primers anticlockwise from their end.
function primerAnchors(primer, minSpan) {
  const range = primer.segments.length
    ? { start: primer.segments[0].start, end: primer.segments[primer.segments.length - 1].end }
    : null;
  if (!range) {
    return null;
  }
  const span = Math.max(range.end - range.start, minSpan);
  return primer.strand === -1
    ? { tail: range.end, lead: range.end - span }
    : { tail: range.start, lead: range.start + span };
}

// =============================== circular ====================================

// Label anchor for a circular feature. A feature that crosses the origin comes
// in as two segments (...end, 0...), so a plain min/max midpoint lands on the
// far side of the ring: take the length-weighted circular mean instead.
function featureLabelBase(feature, sequenceLength) {
  const segments = normalizeSegments(feature, sequenceLength);
  let x = 0;
  let y = 0;
  segments.forEach((segment) => {
    const theta = (TAU * ((segment.start + segment.end) / 2)) / Math.max(1, sequenceLength);
    const weight = segment.end - segment.start;
    x += Math.cos(theta) * weight;
    y += Math.sin(theta) * weight;
  });
  if (!x && !y) {
    return null;
  }
  return (((Math.atan2(y, x) / TAU) * sequenceLength) + sequenceLength) % sequenceLength;
}

export {
  clampMapZoom,
  featureLabelBase,
  fixed,
  getMapKind,
  partitionFeatures,
  polar,
  primerAnchors
};
