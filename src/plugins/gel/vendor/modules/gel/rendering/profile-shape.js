import { clamp } from '../shared.js';

// Turning a lane's intensity profile into points and SVG paths: reading a row,
// thinning the series to something an SVG can carry, and the curves through it.
function getProfileValueAtRow(profile, row) {
  if (!profile?.values?.length) {
    return 0;
  }
  const safeRow = clamp(Math.round(Number(row) || 0), 0, profile.values.length - 1);
  return Number(profile.values[safeRow]) || 0;
}

function makeProfilePoint(profile, row) {
  const safeRow = clamp(Math.round(Number(row) || 0), 0, Math.max(0, (profile?.values?.length || 1) - 1));
  return {
    row: safeRow,
    value: getProfileValueAtRow(profile, safeRow)
  };
}

function formatTableNumber(value, digits = 4) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '-';
}

function downsampleLaneProfile(values, maxPoints = 220) {
  if (!values.length) {
    return [];
  }

  const targetCount = Math.min(maxPoints, values.length);
  if (targetCount === values.length) {
    return Array.from(values, (value, row) => ({ row, value: Number(value) || 0 }));
  }

  const bucketSize = values.length / targetCount;
  const points = [];

  for (let bucketIndex = 0; bucketIndex < targetCount; bucketIndex += 1) {
    const start = Math.floor(bucketIndex * bucketSize);
    const end = bucketIndex === targetCount - 1
      ? values.length
      : Math.max(start + 1, Math.floor((bucketIndex + 1) * bucketSize));

    let sum = 0;
    for (let index = start; index < end; index += 1) {
      sum += values[index];
    }

    points.push({
      row: (start + (end - 1)) / 2,
      value: sum / Math.max(1, end - start)
    });
  }

  return points;
}

function buildSmoothPath(points) {
  if (!points.length) {
    return '';
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    path += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  path += ` T ${last.x} ${last.y}`;
  return path;
}

function buildLinearPath(points) {
  if (!points.length) {
    return '';
  }
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
}

export {
  buildLinearPath,
  getProfileValueAtRow,
  buildSmoothPath,
  downsampleLaneProfile,
  formatTableNumber,
  makeProfilePoint
};
