import {
  rowLabelToIndex,
  toRowLabel
} from '../plate-model.js';

export {
  rowLabelToIndex,
  toRowLabel
};

export function formatNumber(value, digits = 4) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '-';
}

export function summarizeNumeric(values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const n = values.length;
  const total = values.reduce((sum, item) => sum + item, 0);
  const meanValue = total / n;
  const variance = n > 1
    ? values.reduce((sum, item) => sum + ((item - meanValue) ** 2), 0) / (n - 1)
    : 0;
  const sd = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { n, mean: meanValue, sd, min, max };
}

export function groupBy(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(item);
  });
  return map;
}

export function sortByConcentration(a, b) {
  const aNumeric = Number.isFinite(a.concentrationValue);
  const bNumeric = Number.isFinite(b.concentrationValue);
  if (aNumeric && bNumeric && a.concentrationValue !== b.concentrationValue) {
    return a.concentrationValue - b.concentrationValue;
  }
  if (aNumeric && !bNumeric) {
    return -1;
  }
  if (!aNumeric && bNumeric) {
    return 1;
  }
  return String(a.concentrationLabel).localeCompare(String(b.concentrationLabel));
}

export function describeObservationAxes(observations) {
  const sampleLabels = new Set();
  const concentrationLabels = new Set();
  const numericSampleValues = new Set();
  const numericConcentrationValues = new Set();

  observations.forEach((item) => {
    if (item.rawSampleId) {
      sampleLabels.add(item.rawSampleId);
    }
    if (item.rawConcentration) {
      concentrationLabels.add(item.rawConcentration);
    }
    if (Number.isFinite(item.sampleValue)) {
      numericSampleValues.add(item.sampleValue);
    }
    if (Number.isFinite(item.concentrationValue)) {
      numericConcentrationValues.add(item.concentrationValue);
    }
  });

  return {
    sampleCount: sampleLabels.size,
    concentrationCount: concentrationLabels.size,
    numericSampleCount: numericSampleValues.size,
    numericConcentrationCount: numericConcentrationValues.size,
    hasSampleFactor: sampleLabels.size > 1,
    hasConcentrationFactor: concentrationLabels.size > 1
  };
}
