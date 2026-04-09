'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, _maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text;
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 320);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key) || out.length >= max) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function normalizeCitation(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = {
    source: cleanText(source.source, 120),
    pointer: cleanText(source.pointer, 240),
    reason: cleanText(source.reason, 320)
  };
  return normalized.source || normalized.pointer ? normalized : null;
}

function dedupeCitations(citations, max = 40) {
  const seen = new Set();
  const out = [];
  asArray(citations).forEach((citation) => {
    const normalized = normalizeCitation(citation);
    if (!normalized) {
      return;
    }
    const key = `${normalized.source.toLowerCase()}::${normalized.pointer.toLowerCase()}`;
    if (seen.has(key) || out.length >= max) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function inferUncertaintyMarkers(text) {
  const normalized = cleanText(text, 1200).toLowerCase();
  if (!normalized) {
    return [];
  }
  const markers = [];
  if (/\b(may|might|could|possibly|unclear|unknown|limited|inconclusive)\b/.test(normalized)) {
    markers.push(cleanText(text, 320));
  }
  return markers;
}

function createAccuracyPreservationState(input = {}) {
  return {
    citations: dedupeCitations(input.citations, 40),
    contradictions: uniqueStrings(input.contradictions, 16),
    load_bearing_claims: uniqueStrings(input.load_bearing_claims, 16),
    uncertainty_markers: uniqueStrings(input.uncertainty_markers, 16),
    updated_at: new Date().toISOString()
  };
}

function updateAccuracyPreservationState(state, input = {}) {
  const source = state && typeof state === 'object' ? state : createAccuracyPreservationState();
  const next = cloneJson(source, createAccuracyPreservationState());
  next.citations = dedupeCitations([
    ...asArray(next.citations),
    ...asArray(input.citations)
  ], 40);
  next.contradictions = uniqueStrings([
    ...asArray(next.contradictions),
    ...asArray(input.contradictions)
  ], 16);
  next.load_bearing_claims = uniqueStrings([
    ...asArray(next.load_bearing_claims),
    ...asArray(input.load_bearing_claims),
    cleanText(input.assistant_text, 320)
  ], 16);
  next.uncertainty_markers = uniqueStrings([
    ...asArray(next.uncertainty_markers),
    ...asArray(input.uncertainty_markers),
    ...inferUncertaintyMarkers(input.assistant_text)
  ], 16);
  next.updated_at = new Date().toISOString();
  return next;
}

function buildAccuracyPreservationSnapshot(state, options = {}) {
  const source = state && typeof state === 'object' ? state : createAccuracyPreservationState();
  return {
    citations: dedupeCitations(source.citations, Math.max(1, Number(options.maxCitations) || 12)),
    contradictions: uniqueStrings(source.contradictions, Math.max(1, Number(options.maxContradictions) || 8)),
    load_bearing_claims: uniqueStrings(source.load_bearing_claims, Math.max(1, Number(options.maxClaims) || 8)),
    uncertainty_markers: uniqueStrings(source.uncertainty_markers, Math.max(1, Number(options.maxUncertainty) || 8)),
    updated_at: cleanText(source.updated_at, 80)
  };
}

module.exports = {
  normalizeCitation,
  dedupeCitations,
  createAccuracyPreservationState,
  updateAccuracyPreservationState,
  buildAccuracyPreservationSnapshot
};
