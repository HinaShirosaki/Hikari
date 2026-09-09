

export const SUPPORTED_EDIT_TYPES = new Set([
  'point-mutation',
  'insertion',
  'deletion',
  'replacement'
]);

export const DEFAULT_VENDOR_FILTER = Object.freeze({
  neb: true,
  thermo: true
});

export const DEFAULT_GIBSON_MIN_FRAGMENT_COUNT = 2;
export const DEFAULT_OVERLAP_PCR_MIN_FRAGMENT_COUNT = 2;
export const DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH = 12;
export const DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH = 40;

export const CLONING_PRIMER_TM_THRESHOLDS = Object.freeze({
  strict: Object.freeze({
    primerLength: Object.freeze({ min: 18, max: 32 }),
    primerTm: Object.freeze({ min: 58, max: 64 }),
    maxPrimerTmDifference: 3,
    overlapTm: Object.freeze({ min: 60, max: 68 }),
    maxOverlapTmDifference: 3
  }),
  moderate: Object.freeze({
    primerLength: Object.freeze({ min: 16, max: 36 }),
    primerTm: Object.freeze({ min: 56, max: 66 }),
    maxPrimerTmDifference: 6,
    overlapTm: Object.freeze({ min: 58, max: 70 }),
    maxOverlapTmDifference: 6
  }),
  relaxed: Object.freeze({
    primerLength: Object.freeze({ min: 15, max: 40 }),
    primerTm: Object.freeze({ min: 54, max: 68 }),
    maxPrimerTmDifference: 10,
    overlapTm: Object.freeze({ min: 56, max: 72 }),
    maxOverlapTmDifference: 10
  })
});

export const DEFAULT_CLONING_PREFERENCES = Object.freeze({
  allowRestrictionLigation: true,
  preferRestrictionLigation: true,
  preferGibsonForMultiFragment: true,
  maxPrimerEncodedInsertionAA: 30,
  maxPrimerLength: 60,
  minMutagenesisFlankLength: 8,
  topology: 'circular',
  vendorFilter: DEFAULT_VENDOR_FILTER,
  primerClampSequence: 'GCGCGC',
  minEngineeredOverlapLength: DEFAULT_MIN_ENGINEERED_OVERLAP_LENGTH,
  maxEngineeredOverlapLength: DEFAULT_MAX_ENGINEERED_OVERLAP_LENGTH
});
