import {
  DEFAULT_SEQUENCE_LINE_LENGTH,
  FALLBACK_CHAR_ADVANCE_PX,
  FALLBACK_SEQUENCE_LINE_HEIGHT_PX,
  DEFAULT_STRAND_MARKER_COLUMN_PX,
  DEFAULT_STRAND_COLUMN_GAP_PX,
  DEFAULT_RESTRICTION_VENDOR_FILTER
} from '../constants.js';
import { normalizeOrfStopCodonSelection } from '../translation-style.js';

export const LIBRARY_STATUS_SAVED = 'saved';
export const LIBRARY_STATUS_TEMPORARY = 'temporary';
export const FEATURE_SOURCE_BACKBONE_RECOGNITION = 'backbone_recognition';
export const RECOGNIZED_BACKBONE_ARTIFACT_FOLDER = 'SequenceViewer/protein-builder/backbones';
export const RECOGNIZED_BACKBONE_SCHEMA_NAME = 'hikari_recognized_backbone';
export const RECOGNIZED_BACKBONE_SCHEMA_VERSION = '1.0.0';
export const FILE_ACCEPT = '.gbk,.gb,.gbff,.fasta,.fa,.fas,.fna,.fastq,.fq,.txt,.seq';

export function createInitialSequenceViewerState() {
  return {
    mode: 'paste',
    fileName: '',
    fileText: '',
    records: [],
    selectedRecordIndex: 0,
    selectedFeatureIndex: -1,
    warnings: [],
    errors: [],
    isAnnotating: false,
    isRecognizingBackbone: false,
    backboneRecognitionDialog: {
      open: false,
      recordIndex: -1,
      match: null,
      candidateId: '',
      variantMode: 'gibson'
    },
    orfViewEnabled: false,
    orfStopCodons: normalizeOrfStopCodonSelection({ TAG: true, TAA: true, TGA: true }),
    orfFrameFilter: { '+1': true, '+2': true, '+3': true, '-1': true, '-2': true, '-3': true },
    restrictionVendorFilter: { ...DEFAULT_RESTRICTION_VENDOR_FILTER },
    inputComposerVisible: true,
    libraryFilter: LIBRARY_STATUS_SAVED,
    libraryEntries: [],
    libraryFolders: [],
    expandedLibraryFolderIds: [],
    libraryFolderExpansionInitialized: false,
    libraryStoragePath: '',
    selectedLibraryEntryId: '',
    previewZoom: 1,
    activeEntryId: '',
    activeEntryStatus: '',
    alignmentSessions: [],
    activeAlignmentSessionId: '',
    activeAlignmentSessionName: '',
    activeAlignmentResult: null,
    activeAlignmentQueryRecord: null,
    alignmentViewEnabled: false,
    traceUseProcessed: true,
    proteinBuilderConfirmation: null,
    vectorBuilder: {
      selectedFeatureIndex: -1,
      selectionAnchor: null,
      selectionFocus: null,
      cursorBase: null,
      isSelecting: false,
      showCutters: false,
      insertTarget: null,
      sequenceLayout: null,
      zoom: 1
    },
    sequenceEditDesignSource: null,
    cloningDesign: {},
    featureSearchQuery: '',
    featureSearchResults: [],
    isSearchingFeatures: false,
    sequenceSelectionAnchor: null,
    sequenceSelectionFocus: null,
    sequenceCursorBase: null,
    isSelectingSequence: false,
    sequenceLayout: {
      lineLength: DEFAULT_SEQUENCE_LINE_LENGTH,
      charAdvancePx: FALLBACK_CHAR_ADVANCE_PX,
      lineHeightPx: FALLBACK_SEQUENCE_LINE_HEIGHT_PX,
      lineFeatureOffsetPx: DEFAULT_STRAND_MARKER_COLUMN_PX + DEFAULT_STRAND_COLUMN_GAP_PX
    }
  };
}
