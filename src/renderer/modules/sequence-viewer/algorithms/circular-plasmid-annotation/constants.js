'use strict';

const WORKER_MODE = 'annotate-circular-plasmid-chunk';

const BASE_MASKS = Object.freeze({
  A: 1,
  C: 2,
  G: 4,
  T: 8,
  U: 8,
  R: 1 | 4,
  Y: 2 | 8,
  S: 2 | 4,
  W: 1 | 8,
  K: 4 | 8,
  M: 1 | 2,
  B: 2 | 4 | 8,
  D: 1 | 4 | 8,
  H: 1 | 2 | 8,
  V: 1 | 2 | 4,
  N: 1 | 2 | 4 | 8,
  X: 1 | 2 | 4 | 8
});

const REVERSE_COMPLEMENT_MAP = Object.freeze({
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  U: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  D: 'H',
  H: 'D',
  V: 'B',
  N: 'N',
  X: 'N'
});

const DEFAULT_CIRCULAR_PLASMID_ANNOTATION_OPTIONS = Object.freeze({
  minRecordLength: 12,
  allowReverseComplement: true,
  maxHitsPerRecord: 8,
  maxWorkers: 0,
  workerThreshold: 256,
  recordsPerWorker: 256,
  maxMismatchCount: 0,
  maxMismatchRate: 0,
  minSeedLength: 12,
  approximateCandidateCap: 4096,
  bruteForceCompatibilityLimit: 2_000_000,
  sortResults: true
});

module.exports = {
  BASE_MASKS,
  DEFAULT_CIRCULAR_PLASMID_ANNOTATION_OPTIONS,
  REVERSE_COMPLEMENT_MAP,
  WORKER_MODE
};
