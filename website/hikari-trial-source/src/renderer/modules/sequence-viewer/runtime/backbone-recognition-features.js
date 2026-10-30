import { cleanText, clamp } from '../shared.js';
import {
  FEATURE_SOURCE_BACKBONE_RECOGNITION,
  LIBRARY_STATUS_SAVED
} from './config.js';
import { getRecognitionDisplayMatch } from './backbone-recognition-model.js';

export function buildBackboneRecognitionFeatures(match, sequenceLength, selection = {}) {
  const safeMatch = getRecognitionDisplayMatch(match, selection);
  if (!safeMatch) {
    return [];
  }

  const includeContextFeatures = selection?.includeContextFeatures !== false;
  const hostName = cleanText(safeMatch.hostVectorName, 140) || 'vector';
  const hasLibraryContext = String(safeMatch.recognitionSource || '').toLowerCase() === 'library_alignment'
    || Boolean(cleanText(safeMatch.hostVectorId, 120));
  const hostStatus = hasLibraryContext
    ? (String(safeMatch.hostVectorStatus || '').toLowerCase() === LIBRARY_STATUS_SAVED ? 'saved' : 'temporary')
    : 'recognized';
  const segments = {
    backbone: normalizeRecognitionSegments(safeMatch.backboneSegments, sequenceLength),
    insert: normalizeRecognitionSegments(safeMatch.insertSegments, sequenceLength),
    promoter: normalizeRecognitionSegments(safeMatch.promoter?.segments, sequenceLength),
    orf: normalizeRecognitionSegments(safeMatch.orf?.segments, sequenceLength),
    upstream: normalizeRecognitionSegments(safeMatch.upstreamSite?.segments, sequenceLength),
    downstream: normalizeRecognitionSegments(safeMatch.downstreamSite?.segments, sequenceLength)
  };
  return [
    ...buildContextFeatures(safeMatch, segments, includeContextFeatures),
    ...buildBackboneInsertFeatures(safeMatch, segments, hostName, hostStatus, hasLibraryContext),
    ...buildRestrictionFeatures(safeMatch, segments, includeContextFeatures)
  ];
}

function buildContextFeatures(match, segments, includeContextFeatures) {
  const features = [];
  if (includeContextFeatures && segments.promoter.length) {
    features.push({
      id: buildFeatureId('promoter', match),
      name: match.promoter?.name || 'Promoter',
      type: 'promoter',
      strand: Number(match.promoter?.strand) === -1 ? -1 : 1,
      source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
      description: `Matched exported promoter ${match.promoter?.name || 'promoter'} with the nearest ORF ${Math.max(0, Number(match.promoter?.gapToOrf) || 0).toLocaleString()} bp downstream.`,
      locationText: '',
      segments: segments.promoter
    });
  }
  if (includeContextFeatures && segments.orf.length) {
    const stopCodon = String(match.stopCodon || match.orf?.stopCodon || '').trim();
    features.push({
      id: buildFeatureId('orf', match),
      name: match.orf?.name || 'Nearest ORF',
      type: 'orf',
      strand: Number(match.orf?.strand) === -1 ? -1 : 1,
      source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
      description: `${Math.max(0, Number(match.orf?.length) || 0).toLocaleString()} bp ORF identified from ATG to ${stopCodon || 'stop codon'}.`,
      locationText: '',
      segments: segments.orf
    });
  }
  return features;
}

function buildBackboneInsertFeatures(match, segments, hostName, hostStatus, hasLibraryContext) {
  const features = [];
  const hostCoveragePercent = Math.max(0, Number(match.hostCoverage) || 0) * 100;
  const orientationText = match.orientation === 'reverse' ? 'reverse-complement' : 'forward';
  if (segments.backbone.length) {
    features.push({
      id: buildFeatureId('backbone', match),
      name: `Backbone (${hostName})`,
      type: 'backbone',
      strand: 1,
      source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
      description: hasLibraryContext
        ? `${hostName} ${hostStatus} vector recognized with ${Math.max(0, Number(match.backboneLength) || 0).toLocaleString()} bp exact backbone coverage (${hostCoveragePercent.toFixed(1)}% of host, ${orientationText} orientation; ${modeLabel(match)} view).`
        : `Backbone region recognized from promoter alignment with ${Math.max(0, Number(match.backboneLength) || 0).toLocaleString()} bp outside the selected insert (${modeLabel(match)} view).`,
      locationText: '',
      segments: segments.backbone
    });
  }
  if (segments.insert.length) {
    features.push(buildInsertFeature(match, segments.insert, hostName, hasLibraryContext));
  }
  return features;
}

function buildInsertFeature(match, insertSegments, hostName, hasLibraryContext) {
  const qualifier = match.activeVariantMode === 'restriction'
    ? [match.upstreamSite?.name ? `5' ${match.upstreamSite.name}` : '', match.downstreamSite?.name ? `3' ${match.downstreamSite.name}` : ''].filter(Boolean).join(' / ')
    : 'ATG to stop codon';
  return {
    id: buildFeatureId('insert', match),
    name: `Insert (${hostName})`,
    type: 'insert',
    strand: 1,
    source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
    description: hasLibraryContext
      ? `${Math.max(0, Number(match.insertLength) || 0).toLocaleString()} bp insert sequence (${qualifier || 'selected candidate'}) selected relative to backbone candidate ${hostName}.`
      : `${Math.max(0, Number(match.insertLength) || 0).toLocaleString()} bp insert sequence (${qualifier || 'selected candidate'}) selected from promoter / ORF recognition.`,
    locationText: '',
    segments: insertSegments
  };
}

function buildRestrictionFeatures(match, segments, includeContextFeatures) {
  if (!includeContextFeatures || match.activeVariantMode !== 'restriction') {
    return [];
  }
  const sites = [
    ['restriction_5', match.upstreamSite, segments.upstream, "5'"],
    ['restriction_3', match.downstreamSite, segments.downstream, "3'"]
  ];
  return sites.filter(([, , siteSegments]) => siteSegments.length).map(([role, site, siteSegments, suffix]) => ({
    id: buildFeatureId(role, match),
    name: `${site?.name || `${suffix} site`} (${suffix})`,
    type: 'restriction_site',
    strand: 1,
    source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
    description: `Nearest ${suffix} restriction site ${site?.name || 'site'} used to bound the insert.`,
    locationText: '',
    segments: siteSegments
  }));
}

function normalizeRecognitionSegments(segments, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
      const end = clamp(Math.round(Number(segment?.end) || 0), 0, safeLength);
      return end > start ? { start, end } : null;
    })
    .filter(Boolean);
}

function buildFeatureId(role, match) {
  const safeRole = cleanText(role, 32).toLowerCase() || 'feature';
  const safeHostId = cleanText(match?.hostVectorId, 120) || 'vector';
  return `${FEATURE_SOURCE_BACKBONE_RECOGNITION}_${safeRole}_${safeHostId}`;
}

function modeLabel(match) {
  return match.activeVariantMode === 'restriction' ? 'restriction-site' : 'Gibson/HR';
}
