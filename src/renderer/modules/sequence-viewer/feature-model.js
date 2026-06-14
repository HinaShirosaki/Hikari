import { getOrfFeaturesForRecord } from './orf-analysis.js';
import { getCommercialRestrictionFeaturesForRecord } from './restriction-analysis.js';
import { getFeatureTypeColor } from './feature-types.js';
import { clamp } from './shared.js';

export function buildFeatureLocationText(feature, sequenceLength) {
  if (feature.locationText) {
    return feature.locationText;
  }
  const len = Math.max(1, Number(sequenceLength) || 1);
  const segments = Array.isArray(feature.segments) ? feature.segments : [];
  if (!segments.length) {
    return '-';
  }

  return segments
    .map((segment) => {
      const start = clamp(segment.start + 1, 1, len);
      const end = clamp(segment.end, 1, len);
      return `${start}..${end}`;
    })
    .join(', ');
}

export function hashTypeToColor(type) {
  const fixedColor = getFeatureTypeColor(type);
  if (fixedColor) {
    return fixedColor;
  }

  const colors = ['#4e7fff', '#f6a35e', '#479f71', '#c97064', '#808080', '#2f8f9d', '#8b5cf6', '#a16207'];
  const key = String(type || 'misc_feature');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

function parseHexColor(color) {
  const normalized = String(color || '').trim();
  const match = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }

  const raw = match[1];
  if (raw.length === 3) {
    return {
      r: Number.parseInt(`${raw[0]}${raw[0]}`, 16),
      g: Number.parseInt(`${raw[1]}${raw[1]}`, 16),
      b: Number.parseInt(`${raw[2]}${raw[2]}`, 16)
    };
  }

  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16)
  };
}

export function getContrastTextColor(backgroundColor) {
  const rgb = parseHexColor(backgroundColor);
  if (!rgb) {
    return '#0f223e';
  }

  const toLinear = (channel) => {
    const srgb = clamp(channel, 0, 255) / 255;
    return srgb <= 0.04045
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (
    (0.2126 * toLinear(rgb.r))
    + (0.7152 * toLinear(rgb.g))
    + (0.0722 * toLinear(rgb.b))
  );

  return luminance >= 0.42 ? '#0f223e' : '#ffffff';
}

function segmentsOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

export function assignFeatureLanes(features) {
  const lanes = [];

  return features.map((feature) => {
    const segments = Array.isArray(feature.segments) ? feature.segments : [];
    let laneIndex = 0;

    while (laneIndex < lanes.length) {
      const laneSegments = lanes[laneIndex];
      const hasOverlap = segments.some((segment) => laneSegments.some((existing) => segmentsOverlap(segment, existing)));
      if (!hasOverlap) {
        break;
      }
      laneIndex += 1;
    }

    if (!lanes[laneIndex]) {
      lanes[laneIndex] = [];
    }
    lanes[laneIndex].push(...segments);

    return {
      ...feature,
      lane: laneIndex
    };
  });
}

export function getRenderableFeaturesForRecord(record, options = {}) {
  const parsedFeatures = Array.isArray(record?.features) ? record.features : [];
  const includeOrf = Boolean(options?.includeOrf);
  const orfFeatures = includeOrf
    ? getOrfFeaturesForRecord(record, {
      ...options,
      stopCodons: options?.orfStopCodons ?? options?.stopCodons
    })
    : [];
  const restrictionFeatures = getCommercialRestrictionFeaturesForRecord(record, {
    vendorFilter: options?.restrictionVendorFilter
  });
  return [...parsedFeatures, ...orfFeatures, ...restrictionFeatures];
}
