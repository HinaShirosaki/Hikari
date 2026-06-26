'use strict';

const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const ORF_ANALYSIS_PATH = path.join(
  PROJECT_ROOT,
  'src',
  'renderer',
  'modules',
  'sequence-viewer',
  'algorithms',
  'orf-features.js'
);
const RESTRICTION_ANALYSIS_PATH = path.join(
  PROJECT_ROOT,
  'src',
  'renderer',
  'modules',
  'sequence-viewer',
  'algorithms',
  'restriction-features.js'
);
const EXPORTED_STANDARD_FEATURES_PATH = path.join(
  PROJECT_ROOT,
  'src',
  'renderer',
  'modules',
  'sequence-viewer',
  'data',
  'exported-standard-features.js'
);

const MIN_QUERY_LENGTH = 12;
const MIN_ORF_LENGTH = 15;
const DEFAULT_PROMOTER_TO_ORF_MAX_GAP = 1800;
const DEFAULT_RESTRICTION_FLANK_MAX_GAP = 240;
const DEFAULT_MAX_PROMOTER_SELECTIONS = 12;
const MIN_BACKBONE_SHARED_LENGTH = 24;
const MIN_HOST_COVERAGE = 0.45;

module.exports = {
  DEFAULT_MAX_PROMOTER_SELECTIONS,
  DEFAULT_PROMOTER_TO_ORF_MAX_GAP,
  DEFAULT_RESTRICTION_FLANK_MAX_GAP,
  EXPORTED_STANDARD_FEATURES_PATH,
  MIN_BACKBONE_SHARED_LENGTH,
  MIN_HOST_COVERAGE,
  MIN_ORF_LENGTH,
  MIN_QUERY_LENGTH,
  ORF_ANALYSIS_PATH,
  RESTRICTION_ANALYSIS_PATH
};
