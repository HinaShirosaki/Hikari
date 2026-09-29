'use strict';

const LIBRARY_FOLDER_NAME = 'DNA';
const PROJECT_FOLDER_ID_PREFIX = 'project:';
const DB_FILE_NAME = 'sequence-library.sqlite';
const STATUS_SAVED = 'saved';
const STATUS_TEMPORARY = 'temporary';
const FEATURE_INDEX_VERSION = 1;

const FEATURE_SOURCE_BACKBONE_RECOGNITION = 'backbone_recognition';
const FEATURE_SOURCE_SQL_ANNOTATION_DNA = 'sql_annotation_dna';
const FEATURE_SOURCE_SQL_ANNOTATION_PROTEIN = 'sql_annotation_protein';

const ALIGNMENTS_DIR_NAME = 'alignments';
const ALIGNMENTS_MANIFEST_FILE_NAME = 'alignment-sessions.json';

const RECOGNIZED_BACKBONE_ARTIFACT_DIR_NAME = 'protein-builder/backbones';
const RECOGNIZED_BACKBONE_STORE_FILE_NAME = 'protein-builder-backbones.json';
const RECOGNIZED_BACKBONE_STORE_SCHEMA_NAME = 'hikari_recognized_backbone_store';
const RECOGNIZED_BACKBONE_STORE_SCHEMA_VERSION = '1.0.0';
const RECOGNIZED_BACKBONE_SCHEMA_NAME = 'hikari_recognized_backbone';

const ORF_START_CODONS = new Set(['ATG']);
const ORF_STOP_CODONS = new Set(['TAA', 'TAG', 'TGA']);
const MIN_DNA_ANNOTATION_FEATURE_LENGTH = 12;
const MIN_PROTEIN_ANNOTATION_AA_LENGTH = 3;
const MAX_ANNOTATION_MATCHES_PER_FEATURE = 32;
const MAX_ANNOTATION_FEATURES_PER_RUN = 500;

const CODON_TO_AMINO_ACID = Object.freeze({
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G'
});

const BASE_COMPLEMENT = Object.freeze({
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

module.exports = {
  ALIGNMENTS_DIR_NAME,
  ALIGNMENTS_MANIFEST_FILE_NAME,
  BASE_COMPLEMENT,
  CODON_TO_AMINO_ACID,
  DB_FILE_NAME,
  FEATURE_INDEX_VERSION,
  FEATURE_SOURCE_BACKBONE_RECOGNITION,
  FEATURE_SOURCE_SQL_ANNOTATION_DNA,
  FEATURE_SOURCE_SQL_ANNOTATION_PROTEIN,
  LIBRARY_FOLDER_NAME,
  MAX_ANNOTATION_FEATURES_PER_RUN,
  MAX_ANNOTATION_MATCHES_PER_FEATURE,
  MIN_DNA_ANNOTATION_FEATURE_LENGTH,
  MIN_PROTEIN_ANNOTATION_AA_LENGTH,
  ORF_START_CODONS,
  ORF_STOP_CODONS,
  PROJECT_FOLDER_ID_PREFIX,
  RECOGNIZED_BACKBONE_ARTIFACT_DIR_NAME,
  RECOGNIZED_BACKBONE_SCHEMA_NAME,
  RECOGNIZED_BACKBONE_STORE_FILE_NAME,
  RECOGNIZED_BACKBONE_STORE_SCHEMA_NAME,
  RECOGNIZED_BACKBONE_STORE_SCHEMA_VERSION,
  STATUS_SAVED,
  STATUS_TEMPORARY
};
