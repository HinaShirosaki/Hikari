'use strict';

const { pathToFileURL } = require('url');
const {
  COMMON_PROMOTERS_PATH,
  MIN_QUERY_LENGTH,
  ORF_ANALYSIS_PATH,
  RESTRICTION_ANALYSIS_PATH
} = require('./constants');
const { normalizeDisplayName } = require('./segment-utils');

let sequenceViewerAnalysisPromise = null;
let commonPromotersPromise = null;

function extractSequenceFromGbkText(normalizeSequenceText, gbkText) {
  const raw = String(gbkText || '');
  if (!raw) {
    return '';
  }
  const originMatch = raw.match(/(^|\n)ORIGIN\b([\s\S]*?)(?:\n\/\/|\s*$)/i);
  if (!originMatch) {
    return '';
  }
  return normalizeSequenceText(originMatch[2].replace(/[0-9\s/]+/g, ''));
}

function extractRecordFromGbkText(normalizeSequenceText, gbkText) {
  const raw = String(gbkText || '');
  const locusLine = raw.match(/^LOCUS.*$/m)?.[0] || '';
  return {
    sequence: extractSequenceFromGbkText(normalizeSequenceText, raw),
    topology: /circular/i.test(locusLine) ? 'circular' : 'linear'
  };
}

async function loadCommonPromoters(normalizeSequenceText) {
  if (!commonPromotersPromise) {
    commonPromotersPromise = import(pathToFileURL(COMMON_PROMOTERS_PATH).href)
      .then((module) => {
        const records = Array.isArray(module?.COMMON_PROMOTERS)
          ? module.COMMON_PROMOTERS
          : [];
        const seen = new Set();
        return records
          .map((record, index) => ({
            id: `common_promoter_${index + 1}`,
            label: normalizeDisplayName(record?.label, ''),
            sequence: normalizeSequenceText(record?.sequence),
            type: 'promoter',
            source: 'common_promoters'
          }))
          .filter((record) => record.label && record.sequence.length >= MIN_QUERY_LENGTH)
          .filter((record) => {
            const key = `${record.label}\n${record.sequence}`;
            if (seen.has(key)) {
              return false;
            }
            seen.add(key);
            return true;
          });
      })
      .catch(() => []);
  }
  return commonPromotersPromise;
}

async function loadSequenceViewerAnalysisModules() {
  if (!sequenceViewerAnalysisPromise) {
    sequenceViewerAnalysisPromise = Promise.all([
      import(pathToFileURL(ORF_ANALYSIS_PATH).href),
      import(pathToFileURL(RESTRICTION_ANALYSIS_PATH).href)
    ])
      .then(([orfAnalysisModule, restrictionAnalysisModule]) => ({
        buildOrfFeatures: typeof orfAnalysisModule?.buildOrfFeatures === 'function'
          ? orfAnalysisModule.buildOrfFeatures
          : () => [],
        buildCommercialRestrictionFeatures: typeof restrictionAnalysisModule?.buildCommercialRestrictionFeatures === 'function'
          ? restrictionAnalysisModule.buildCommercialRestrictionFeatures
          : () => []
      }))
      .catch(() => ({
        buildOrfFeatures: () => [],
        buildCommercialRestrictionFeatures: () => []
      }));
  }
  return sequenceViewerAnalysisPromise;
}

module.exports = {
  extractRecordFromGbkText,
  loadCommonPromoters,
  loadSequenceViewerAnalysisModules
};
