import { escapeHtml } from '../tool-box/common.js';
import {
  DEFAULT_MAX_RECORDS,
  DEFAULT_SEQUENCE_LINE_LENGTH,
  FALLBACK_CHAR_ADVANCE_PX,
  FALLBACK_SEQUENCE_LINE_HEIGHT_PX,
  DEFAULT_STRAND_MARKER_COLUMN_PX,
  DEFAULT_STRAND_COLUMN_GAP_PX,
  DEFAULT_RESTRICTION_VENDOR_FILTER
} from './constants.js';
import { normalizeExternalPayload, parseInputRecords } from './parsing.js';
import { buildSequenceSignature, cleanText, clamp, normalizeRecordName, normalizeSequenceText, normalizeTopology } from './shared.js';
import {
  buildCircularPreviewHtmlDocument,
  buildRecordGenbankText,
  readStoragePathFromLocalState
} from './storage.js';
import {
  normalizeOrfStopCodonVisibility
} from './translation-style.js';
import { getSequenceViewerElements } from './dom.js';
import { createSequenceViewerAnnotationController } from './annotation.js';
import { createSequenceViewerHomeController } from './home-controller.js';
import { createSequenceViewerDetailController } from './detail-controller.js';
import { createSequenceViewerAlignmentController } from './alignment-controller.js';
import { createSequenceViewerProteinBuilderController } from './protein-builder.js';
import { createProteinBuilderCloningNotebookPage } from './protein-builder-cloning-notebook.js';

export function initSequenceViewer(options = {}) {
  const LIBRARY_STATUS_SAVED = 'saved';
  const LIBRARY_STATUS_TEMPORARY = 'temporary';
  const FEATURE_SOURCE_BACKBONE_RECOGNITION = 'backbone_recognition';
  const RECOGNIZED_BACKBONE_ARTIFACT_FOLDER = 'SequenceViewer/protein-builder/backbones';
  const RECOGNIZED_BACKBONE_SCHEMA_NAME = 'enana_recognized_backbone';
  const RECOGNIZED_BACKBONE_SCHEMA_VERSION = '1.0.0';
  const FILE_ACCEPT = '.gbk,.gb,.gbff,.fasta,.fa,.fas,.fna,.fastq,.fq,.txt,.seq';
  const homeViewId = String(options?.homeViewId || '').trim();
  const detailViewId = String(options?.detailViewId || '').trim();
  const rootDocument = options?.document || globalThis?.document || null;
  const elements = getSequenceViewerElements(rootDocument);

  const state = {
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
    orfStopVisibility: normalizeOrfStopCodonVisibility({
      TAG: Boolean(elements.orfStopTagToggle?.checked),
      TAA: Boolean(elements.orfStopTaaToggle?.checked),
      TGA: Boolean(elements.orfStopTgaToggle?.checked)
    }),
    restrictionVendorFilter: {
      ...DEFAULT_RESTRICTION_VENDOR_FILTER
    },
    inputComposerVisible: true,
    libraryFilter: LIBRARY_STATUS_SAVED,
    libraryEntries: [],
    selectedLibraryEntryId: '',
    activeEntryId: '',
    activeEntryStatus: '',
    alignmentSessions: [],
    activeAlignmentSessionId: '',
    activeAlignmentSessionName: '',
    activeAlignmentResult: null,
    activeAlignmentQueryRecord: null,
    alignmentViewEnabled: false,
    proteinBuilderConfirmation: null,
    featureSearchQuery: '',
    featureSearchResults: [],
    isSearchingFeatures: false,
    lastLibraryClickEntryId: '',
    lastLibraryClickAt: 0,
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

  const onNavigateHome = typeof options?.onNavigateHome === 'function'
    ? options.onNavigateHome
    : null;
  const onNavigateDetail = typeof options?.onNavigateDetail === 'function'
    ? options.onNavigateDetail
    : null;

  function getBridge() {
    return (typeof options?.getApiBridge === 'function' ? options.getApiBridge() : null)
      || options?.apiBridge
      || options?.bridge
      || globalThis?.window?.enanaApi
      || globalThis?.enanaApi
      || null;
  }

  function getStoragePath() {
    return String(options?.storagePath || '').trim() || readStoragePathFromLocalState();
  }

  function hasStoragePath() {
    return Boolean(getStoragePath());
  }

  function normalizeProteinBuilderCloningDesignSource(source) {
    const safeSource = source && typeof source === 'object' ? source : null;
    if (!safeSource) {
      return null;
    }

    const backbone = safeSource.backbone && typeof safeSource.backbone === 'object'
      ? { ...safeSource.backbone }
      : {};
    const dnaConstruct = safeSource.dnaConstruct && typeof safeSource.dnaConstruct === 'object'
      ? { ...safeSource.dnaConstruct }
      : {};
    const assembledRecord = safeSource.assembledRecord && typeof safeSource.assembledRecord === 'object'
      ? { ...safeSource.assembledRecord }
      : {};
    const backboneSequence = normalizeSequenceText(backbone.backboneSequence || '');
    const insertSequence = normalizeSequenceText(dnaConstruct.sequence || '');
    const assembledSequence = normalizeSequenceText(assembledRecord.sequence || '');
    if (!backboneSequence && !insertSequence && !assembledSequence) {
      return null;
    }

    return {
      constructName: cleanText(safeSource.constructName, 160),
      backbone: {
        ...backbone,
        backboneSequence
      },
      dnaConstruct: {
        ...dnaConstruct,
        sequence: insertSequence,
        length: Math.max(0, Number(dnaConstruct.length || insertSequence.length) || 0),
        parts: Array.isArray(dnaConstruct.parts)
          ? dnaConstruct.parts.map((part) => ({ ...part }))
          : []
      },
      assembledRecord: {
        ...assembledRecord,
        sequence: assembledSequence,
        features: Array.isArray(assembledRecord.features)
          ? assembledRecord.features.map((feature) => ({
              ...feature,
              segments: Array.isArray(feature?.segments)
                ? feature.segments.map((segment) => ({ ...segment }))
                : []
            }))
          : []
      }
    };
  }

  function normalizeProteinBuilderConfirmation(payload) {
    const safePayload = payload && typeof payload === 'object' ? payload : null;
    if (!safePayload) {
      return null;
    }

    const recordName = cleanText(safePayload.recordName, 160);
    const constructName = cleanText(safePayload.constructName, 160);
    const backboneName = cleanText(safePayload.backboneName, 160);
    const sourceLabel = cleanText(safePayload.sourceLabel, 160);
    const notebookEntryId = cleanText(safePayload.notebookEntryId, 160);
    const notebookTitle = cleanText(safePayload.notebookTitle, 220);
    const assemblyStrategy = cleanText(safePayload.assemblyStrategy, 120);
    const plasmidLength = Math.max(0, Number(safePayload.plasmidLength) || 0);
    const insertLength = Math.max(0, Number(safePayload.insertLength) || 0);
    const primerCount = Math.max(0, Number(safePayload.primerCount) || 0);
    const cloningDesignSource = normalizeProteinBuilderCloningDesignSource(safePayload.cloningDesignSource);
    if (
      !recordName
      && !constructName
      && !backboneName
      && !sourceLabel
      && !notebookEntryId
      && !notebookTitle
      && !assemblyStrategy
      && !plasmidLength
      && !insertLength
      && !primerCount
      && !cloningDesignSource
    ) {
      return null;
    }

    return {
      recordName,
      constructName,
      backboneName,
      sourceLabel,
      plasmidLength,
      insertLength,
      notebookEntryId,
      notebookTitle,
      assemblyStrategy,
      primerCount,
      cloningDesignSource
    };
  }

  function normalizeFeatureSegmentsForExtraction(segments, sequenceLength) {
    const safeLength = Math.max(0, Number(sequenceLength) || 0);
    return (Array.isArray(segments) ? segments : [])
      .map((segment) => {
        const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
        const end = clamp(Math.round(Number(segment?.end) || start), start, safeLength);
        return end > start ? { start, end } : null;
      })
      .filter(Boolean);
  }

  function reverseComplementSequence(sequence) {
    const complement = {
      A: 'T',
      T: 'A',
      G: 'C',
      C: 'G'
    };
    return normalizeSequenceText(sequence || '')
      .split('')
      .reverse()
      .map((base) => complement[base] || '')
      .join('');
  }

  function extractFeatureSequence(record = {}, feature = {}) {
    const sequence = normalizeSequenceText(record?.sequence || '');
    if (!sequence.length || !feature) {
      return '';
    }
    const segments = normalizeFeatureSegmentsForExtraction(feature?.segments, sequence.length);
    if (!segments.length) {
      return '';
    }
    const extracted = segments.map((segment) => sequence.slice(segment.start, segment.end)).join('');
    return Number(feature?.strand) === -1 ? reverseComplementSequence(extracted) : extracted;
  }

  function getProteinBuilderFeatureRank(feature = {}, role = '') {
    const normalizedRole = cleanText(role, 80).toLowerCase();
    const id = cleanText(feature?.id, 200).toLowerCase();
    const type = cleanText(feature?.type, 120).toLowerCase();
    const source = cleanText(feature?.source, 120).toLowerCase();
    const name = cleanText(feature?.name, 160).toLowerCase();
    if (id === `protein_builder_${normalizedRole}`) {
      return 0;
    }
    if (source === 'protein_builder' && type === normalizedRole) {
      return 1;
    }
    if (type === normalizedRole && name.includes(`protein builder ${normalizedRole}`)) {
      return 2;
    }
    if (type === normalizedRole) {
      return 3;
    }
    return Number.POSITIVE_INFINITY;
  }

  function findProteinBuilderFeature(record = {}, role = '') {
    return (Array.isArray(record?.features) ? record.features : [])
      .map((feature) => ({
        feature,
        rank: getProteinBuilderFeatureRank(feature, role)
      }))
      .filter((item) => Number.isFinite(item.rank))
      .sort((left, right) => {
        if (left.rank !== right.rank) {
          return left.rank - right.rank;
        }
        return cleanText(left.feature?.name, 160).localeCompare(cleanText(right.feature?.name, 160));
      })[0]?.feature || null;
  }

  function deriveInsertionOffsetFromBackboneFeature(feature = {}, sequenceLength = 0, fallbackOffset = 0) {
    const segments = normalizeFeatureSegmentsForExtraction(feature?.segments, sequenceLength);
    if (segments.length > 1) {
      return segments[0].end - segments[0].start;
    }
    return Math.max(0, Math.round(Number(fallbackOffset) || 0));
  }

  function buildCurrentProteinBuilderDesignSource(designSource = {}, assembledRecord = {}) {
    const sourceBackbone = designSource.backbone || {};
    const sourceConstruct = designSource.dnaConstruct || {};
    const insertFeature = findProteinBuilderFeature(assembledRecord, 'insert');
    const backboneFeature = findProteinBuilderFeature(assembledRecord, 'backbone');
    const insertSequence = extractFeatureSequence(assembledRecord, insertFeature);
    const backboneSequence = extractFeatureSequence(assembledRecord, backboneFeature);
    const nextConstruct = insertSequence
      ? {
          ...sourceConstruct,
          sequence: insertSequence,
          length: insertSequence.length,
          parts: Array.isArray(sourceConstruct?.parts)
            ? sourceConstruct.parts.map((part) => ({ ...part }))
            : []
        }
      : sourceConstruct;
    const nextBackbone = backboneSequence
      ? {
          ...sourceBackbone,
          backboneSequence,
          backboneLength: backboneSequence.length,
          insertionOffset: deriveInsertionOffsetFromBackboneFeature(
            backboneFeature,
            normalizeSequenceText(assembledRecord?.sequence || '').length,
            sourceBackbone?.insertionOffset
          )
        }
      : sourceBackbone;

    return {
      backbone: nextBackbone,
      dnaConstruct: nextConstruct
    };
  }

  function setProteinBuilderConfirmation(payload, options = {}) {
    state.proteinBuilderConfirmation = normalizeProteinBuilderConfirmation(payload);
    if (options?.render === false) {
      return;
    }
    detailController?.renderActiveRecord?.();
  }

  function createConfirmedProteinBuilderCloningNotebookPage(confirmation = {}) {
    const designSource = confirmation?.cloningDesignSource;
    if (!designSource) {
      return null;
    }

    const currentRecord = getSelectedRecord();
    const sourceRecord = designSource.assembledRecord || {};
    const assembledRecord = {
      ...sourceRecord,
      ...(currentRecord || {}),
      name: cleanText(currentRecord?.name, 160)
        || cleanText(sourceRecord?.name, 160)
        || cleanText(confirmation?.recordName, 160)
        || 'Protein Builder construct',
      sequence: normalizeSequenceText(currentRecord?.sequence || sourceRecord?.sequence || '')
    };
    if (!assembledRecord.sequence) {
      return null;
    }
    const currentDesignSource = buildCurrentProteinBuilderDesignSource(designSource, assembledRecord);

    return createProteinBuilderCloningNotebookPage({
      state: options?.state,
      persist: options?.persist,
      createId: options?.createId,
      onNotebookEntriesChanged: options?.onNotebookEntriesChanged,
      entryId: confirmation?.notebookEntryId,
      constructName: cleanText(confirmation?.constructName, 160)
        || cleanText(designSource?.constructName, 160)
        || cleanText(assembledRecord?.name, 160),
      backbone: currentDesignSource.backbone,
      dnaConstruct: currentDesignSource.dnaConstruct,
      assembledRecord
    });
  }

  function resetAlignmentState(options = {}) {
    const preserveSessions = options?.preserveSessions === true;
    if (!preserveSessions) {
      state.alignmentSessions = [];
    }
    state.activeAlignmentSessionId = '';
    state.activeAlignmentSessionName = '';
    state.activeAlignmentResult = null;
    state.activeAlignmentQueryRecord = null;
    state.alignmentViewEnabled = false;
  }

  function setAlignmentSessions(sessions) {
    state.alignmentSessions = Array.isArray(sessions) ? sessions : [];
    if (!state.activeAlignmentSessionId) {
      detailController?.syncAlignmentControlsState?.();
      return;
    }

    const activeSession = state.alignmentSessions.find((session) => String(session?.id || '') === String(state.activeAlignmentSessionId));
    if (!activeSession) {
      resetAlignmentState({ preserveSessions: true });
    } else {
      state.activeAlignmentSessionName = String(activeSession?.name || activeSession?.queryRecord?.name || '').trim();
      state.activeAlignmentResult = activeSession?.result || state.activeAlignmentResult;
      state.activeAlignmentQueryRecord = activeSession?.queryRecord || state.activeAlignmentQueryRecord;
    }
    detailController?.syncAlignmentControlsState?.();
  }

  function isBackboneRecognitionFeature(feature) {
    return String(feature?.source || '').toLowerCase() === FEATURE_SOURCE_BACKBONE_RECOGNITION;
  }

  function removeBackboneRecognitionFeatures(features) {
    return (Array.isArray(features) ? features : []).filter((feature) => !isBackboneRecognitionFeature(feature));
  }

  function buildBackboneRecognitionFeatureId(role, match) {
    const safeRole = cleanText(role, 32).toLowerCase() || 'feature';
    const safeHostId = cleanText(match?.hostVectorId, 120) || 'vector';
    return `${FEATURE_SOURCE_BACKBONE_RECOGNITION}_${safeRole}_${safeHostId}`;
  }

  function sanitizeStorageArtifactPart(value, fallback = 'artifact') {
    const cleaned = String(value || '')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
    return cleaned || fallback;
  }

  function normalizeRecognitionSegments(segments, sequenceLength) {
    const safeLength = Math.max(0, Number(sequenceLength) || 0);
    return (Array.isArray(segments) ? segments : [])
      .map((segment) => {
        const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
        const end = clamp(Math.round(Number(segment?.end) || 0), 0, safeLength);
        if (end <= start) {
          return null;
        }
        return { start, end };
      })
      .filter(Boolean);
  }

  function getRecognitionCandidates(match) {
    return Array.isArray(match?.candidateSelections) ? match.candidateSelections : [];
  }

  function getRecognitionSelectedCandidate(match, candidateId = '') {
    const candidates = getRecognitionCandidates(match);
    if (!candidates.length) {
      return null;
    }
    return candidates.find((candidate) => String(candidate?.id || '') === String(candidateId || ''))
      || candidates[0]
      || null;
  }

  function getRecognitionDisplayMatch(match, selection = {}) {
    const safeMatch = match && typeof match === 'object' ? match : null;
    if (!safeMatch) {
      return null;
    }

    const selectedCandidate = getRecognitionSelectedCandidate(
      safeMatch,
      selection?.candidateId || safeMatch.selectedCandidateId || ''
    );
    const requestedVariantMode = selection?.variantMode === 'restriction' ? 'restriction' : 'gibson';
    const requestedVariant = selectedCandidate?.variants?.[requestedVariantMode];
    const fallbackVariant = safeMatch.variants?.gibson || safeMatch.variants?.restriction;
    const activeVariant = (requestedVariant && typeof requestedVariant === 'object')
      ? requestedVariant
      : fallbackVariant;
    const activeVariantMode = (requestedVariant && typeof requestedVariant === 'object')
      ? requestedVariantMode
      : (safeMatch.variants?.restriction && !safeMatch.variants?.gibson ? 'restriction' : 'gibson');
    if (!activeVariant || typeof activeVariant !== 'object') {
      return safeMatch;
    }

    return {
      ...safeMatch,
      selectedCandidateId: String(selectedCandidate?.id || safeMatch.selectedCandidateId || ''),
      activeVariantMode,
      promoter: selectedCandidate?.promoter || safeMatch.promoter || null,
      orf: selectedCandidate?.orf || safeMatch.orf || null,
      startCodon: activeVariant?.startCodon || selectedCandidate?.orf?.startCodon || '',
      stopCodon: activeVariant?.stopCodon || selectedCandidate?.orf?.stopCodon || '',
      upstreamSite: activeVariant?.upstreamSite || null,
      downstreamSite: activeVariant?.downstreamSite || null,
      siteExtensionApplied: Boolean(activeVariant?.siteExtensionApplied),
      backboneSequence: String(activeVariant?.backboneSequence || safeMatch.backboneSequence || ''),
      insertSequence: String(activeVariant?.insertSequence || safeMatch.insertSequence || ''),
      backboneLength: Math.max(0, Number(activeVariant.backboneLength) || 0),
      insertLength: Math.max(0, Number(activeVariant.insertLength) || 0),
      backboneSegments: Array.isArray(activeVariant.backboneSegments)
        ? activeVariant.backboneSegments
        : safeMatch.backboneSegments,
      insertSegments: Array.isArray(activeVariant.insertSegments)
        ? activeVariant.insertSegments
        : safeMatch.insertSegments
    };
  }

  function buildBackboneRecognitionFeatures(match, sequenceLength, selection = {}) {
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
    const orientationText = safeMatch.orientation === 'reverse' ? 'reverse-complement' : 'forward';
    const hostCoveragePercent = Math.max(0, Number(safeMatch.hostCoverage) || 0) * 100;
    const backboneSegments = normalizeRecognitionSegments(safeMatch.backboneSegments, sequenceLength);
    const insertSegments = normalizeRecognitionSegments(safeMatch.insertSegments, sequenceLength);
    const promoterSegments = normalizeRecognitionSegments(safeMatch.promoter?.segments, sequenceLength);
    const orfSegments = normalizeRecognitionSegments(safeMatch.orf?.segments, sequenceLength);
    const upstreamSiteSegments = normalizeRecognitionSegments(safeMatch.upstreamSite?.segments, sequenceLength);
    const downstreamSiteSegments = normalizeRecognitionSegments(safeMatch.downstreamSite?.segments, sequenceLength);

    const features = [];
    if (includeContextFeatures && promoterSegments.length) {
      features.push({
        id: buildBackboneRecognitionFeatureId('promoter', safeMatch),
        name: safeMatch.promoter?.name || 'Promoter',
        type: 'promoter',
        strand: Number(safeMatch.promoter?.strand) === -1 ? -1 : 1,
        source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
        description: `Matched exported promoter ${safeMatch.promoter?.name || 'promoter'} with the nearest ORF ${Math.max(0, Number(safeMatch.promoter?.gapToOrf) || 0).toLocaleString()} bp downstream.`,
        locationText: '',
        segments: promoterSegments
      });
    }

    if (includeContextFeatures && orfSegments.length) {
      const stopCodon = String(safeMatch.stopCodon || safeMatch.orf?.stopCodon || '').trim();
      features.push({
        id: buildBackboneRecognitionFeatureId('orf', safeMatch),
        name: safeMatch.orf?.name || 'Nearest ORF',
        type: 'orf',
        strand: Number(safeMatch.orf?.strand) === -1 ? -1 : 1,
        source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
        description: `${Math.max(0, Number(safeMatch.orf?.length) || 0).toLocaleString()} bp ORF identified from ATG to ${stopCodon || 'stop codon'}.`,
        locationText: '',
        segments: orfSegments
      });
    }

    if (backboneSegments.length) {
      const backboneDescription = hasLibraryContext
        ? `${hostName} ${hostStatus} vector recognized with ${Math.max(0, Number(safeMatch.backboneLength) || 0).toLocaleString()} bp exact backbone coverage (${hostCoveragePercent.toFixed(1)}% of host, ${orientationText} orientation; ${safeMatch.activeVariantMode === 'restriction' ? 'restriction-site' : 'Gibson/HR'} view).`
        : `Backbone region recognized from promoter alignment with ${Math.max(0, Number(safeMatch.backboneLength) || 0).toLocaleString()} bp outside the selected insert (${safeMatch.activeVariantMode === 'restriction' ? 'restriction-site' : 'Gibson/HR'} view).`;
      features.push({
        id: buildBackboneRecognitionFeatureId('backbone', safeMatch),
        name: `Backbone (${hostName})`,
        type: 'backbone',
        strand: 1,
        source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
        description: backboneDescription,
        locationText: '',
        segments: backboneSegments
      });
    }

    if (insertSegments.length) {
      const insertQualifier = safeMatch.activeVariantMode === 'restriction'
        ? [
          safeMatch.upstreamSite?.name ? `5' ${safeMatch.upstreamSite.name}` : '',
          safeMatch.downstreamSite?.name ? `3' ${safeMatch.downstreamSite.name}` : ''
        ].filter(Boolean).join(' / ')
        : 'ATG to stop codon';
      features.push({
        id: buildBackboneRecognitionFeatureId('insert', safeMatch),
        name: `Insert (${hostName})`,
        type: 'insert',
        strand: 1,
        source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
        description: hasLibraryContext
          ? `${Math.max(0, Number(safeMatch.insertLength) || 0).toLocaleString()} bp insert sequence (${insertQualifier || 'selected candidate'}) selected relative to backbone candidate ${hostName}.`
          : `${Math.max(0, Number(safeMatch.insertLength) || 0).toLocaleString()} bp insert sequence (${insertQualifier || 'selected candidate'}) selected from promoter / ORF recognition.`,
        locationText: '',
        segments: insertSegments
      });
    }

    if (includeContextFeatures && safeMatch.activeVariantMode === 'restriction' && upstreamSiteSegments.length) {
      features.push({
        id: buildBackboneRecognitionFeatureId('restriction_5', safeMatch),
        name: `${safeMatch.upstreamSite?.name || '5 prime site'} (5')`,
        type: 'restriction_site',
        strand: 1,
        source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
        description: `Nearest 5' restriction site ${safeMatch.upstreamSite?.name || 'site'} used to bound the insert.`,
        locationText: '',
        segments: upstreamSiteSegments
      });
    }

    if (includeContextFeatures && safeMatch.activeVariantMode === 'restriction' && downstreamSiteSegments.length) {
      features.push({
        id: buildBackboneRecognitionFeatureId('restriction_3', safeMatch),
        name: `${safeMatch.downstreamSite?.name || '3 prime site'} (3')`,
        type: 'restriction_site',
        strand: 1,
        source: FEATURE_SOURCE_BACKBONE_RECOGNITION,
        description: `Nearest 3' restriction site ${safeMatch.downstreamSite?.name || 'site'} used to bound the insert.`,
        locationText: '',
        segments: downstreamSiteSegments
      });
    }

    return features;
  }

  function buildSequenceFromSegments(sequence, segments) {
    const normalizedSequence = normalizeSequenceText(sequence);
    if (!normalizedSequence.length) {
      return '';
    }
    return normalizeRecognitionSegments(segments, normalizedSequence.length)
      .map((segment) => normalizedSequence.slice(segment.start, segment.end))
      .join('');
  }

  function buildRecognizedBackboneArtifact(match, record, selection = {}) {
    const displayMatch = getRecognitionDisplayMatch(match, selection);
    const normalizedSequence = normalizeSequenceText(record?.sequence || '');
    if (!displayMatch || !normalizedSequence.length) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const recordName = normalizeRecordName(record?.name || 'sequence', 'sequence');
    const recordSignature = buildSequenceSignature(normalizedSequence, 'seq')
      || `seq_${normalizedSequence.length}`;
    const hostVectorName = cleanText(displayMatch?.hostVectorName, 140) || 'Promoter-aligned backbone';
    const variantMode = displayMatch?.activeVariantMode === 'restriction' ? 'restriction' : 'gibson';
    const backboneSegments = normalizeRecognitionSegments(displayMatch?.backboneSegments, normalizedSequence.length);
    const insertSegments = normalizeRecognitionSegments(displayMatch?.insertSegments, normalizedSequence.length);
    const backboneSequence = normalizeSequenceText(
      displayMatch?.backboneSequence || buildSequenceFromSegments(normalizedSequence, backboneSegments)
    );
    const insertSequence = normalizeSequenceText(
      displayMatch?.insertSequence || buildSequenceFromSegments(normalizedSequence, insertSegments)
    );

    return {
      fileName: `${sanitizeStorageArtifactPart(recordName, 'sequence')}__${recordSignature}.recognized-backbone.json`,
      data: {
        schema_name: RECOGNIZED_BACKBONE_SCHEMA_NAME,
        schema_version: RECOGNIZED_BACKBONE_SCHEMA_VERSION,
        updated_at: nowIso,
        source_record: {
          name: recordName,
          entry_id: cleanText(state.activeEntryId, 200),
          entry_status: cleanText(state.activeEntryStatus, 40),
          sequence_signature: recordSignature,
          topology: normalizeTopology(record?.topology || 'linear')
        },
        recognition: {
          host_vector_id: cleanText(displayMatch?.hostVectorId, 200),
          host_vector_name: hostVectorName,
          host_vector_status: cleanText(displayMatch?.hostVectorStatus, 40),
          recognition_source: cleanText(displayMatch?.recognitionSource, 80),
          variant_mode: variantMode,
          candidate_id: cleanText(displayMatch?.selectedCandidateId, 120),
          promoter_name: cleanText(displayMatch?.promoter?.name, 160),
          orf_name: cleanText(displayMatch?.orf?.name, 160),
          start_codon: cleanText(displayMatch?.startCodon, 12),
          stop_codon: cleanText(displayMatch?.stopCodon, 12),
          upstream_site_name: cleanText(displayMatch?.upstreamSite?.name, 120),
          downstream_site_name: cleanText(displayMatch?.downstreamSite?.name, 120)
        },
        backbone: {
          name: `Backbone (${hostVectorName})`,
          type: 'backbone',
          sequence: backboneSequence,
          sequence_length: backboneSequence.length,
          segments: backboneSegments
        },
        insert: {
          name: `Insert (${hostVectorName})`,
          type: 'insert',
          sequence: insertSequence,
          sequence_length: insertSequence.length,
          segments: insertSegments
        }
      }
    };
  }

  async function persistRecognizedBackboneArtifact(match, record, selection = {}) {
    const bridge = getBridge();
    const storagePath = getStoragePath();
    if (!storagePath || (!bridge?.sequenceLibraryUpsertBackbone && !bridge?.writeJsonFile)) {
      return null;
    }

    const artifact = buildRecognizedBackboneArtifact(match, record, selection);
    if (!artifact) {
      return null;
    }

    const response = bridge?.sequenceLibraryUpsertBackbone
      ? await bridge.sequenceLibraryUpsertBackbone({
          storagePath,
          backbone: artifact.data
        })
      : await bridge.writeJsonFile({
          storagePath,
          targetFolder: RECOGNIZED_BACKBONE_ARTIFACT_FOLDER,
          fileName: artifact.fileName,
          data: artifact.data
        });
    if (!response?.ok) {
      throw new Error(response?.error || 'Failed to store recognized backbone.');
    }
    return response;
  }

  function setMode(mode) {
    const resolved = mode === 'file' ? 'file' : 'paste';
    state.mode = resolved;

    if (elements.modePasteBtn) {
      elements.modePasteBtn.classList.toggle('sequence-viewer-mode-btn-active', resolved === 'paste');
    }
    if (elements.modeFileBtn) {
      elements.modeFileBtn.classList.toggle('sequence-viewer-mode-btn-active', resolved === 'file');
    }
    if (elements.pastePanel) {
      elements.pastePanel.hidden = !state.inputComposerVisible || resolved !== 'paste';
    }
    if (elements.filePanel) {
      elements.filePanel.hidden = !state.inputComposerVisible || resolved !== 'file';
    }
  }

  function setInputComposerVisible(visible) {
    const shouldShow = visible !== false;
    state.inputComposerVisible = shouldShow;

    if (elements.modePasteBtn) {
      elements.modePasteBtn.hidden = !shouldShow;
    }
    if (elements.modeFileBtn) {
      elements.modeFileBtn.hidden = !shouldShow;
    }
    if (elements.loadBtn) {
      elements.loadBtn.hidden = !shouldShow;
    }
    if (elements.pastePanel) {
      elements.pastePanel.hidden = !shouldShow || state.mode !== 'paste';
    }
    if (elements.filePanel) {
      elements.filePanel.hidden = !shouldShow || state.mode !== 'file';
    }
  }

  function setStatus(message, isError = false) {
    if (!elements.statusNote) {
      return;
    }
    elements.statusNote.textContent = message;
    elements.statusNote.style.color = isError ? 'var(--danger)' : '';
  }

  function updateMessages() {
    if (!elements.messageBox) {
      return;
    }
    const rows = [
      ...state.errors.map((text) => `<p class="small-note" style="color:var(--danger);">${escapeHtml(text)}</p>`),
      ...state.warnings.map((text) => `<p class="small-note">${escapeHtml(text)}</p>`)
    ];

    elements.messageBox.innerHTML = rows.length
      ? rows.join('')
      : '<p class="small-note">No parser warnings.</p>';
  }

  function getSelectedRecord() {
    const index = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
    return state.records[index] || null;
  }

  function toDataAttributeName(key) {
    return String(key || '').replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
  }

  function getDatasetValueFromTarget(target, key) {
    if (!target) {
      return '';
    }
    if (target.dataset && typeof target.dataset[key] === 'string') {
      return target.dataset[key];
    }
    if (typeof target.closest === 'function') {
      const closest = target.closest(`[data-${toDataAttributeName(key)}]`);
      if (closest?.dataset && typeof closest.dataset[key] === 'string') {
        return closest.dataset[key];
      }
    }
    return '';
  }

  function renderBackboneDialogPreviewFrame(record) {
    if (!elements.backboneDialogPreview) {
      return;
    }
    if (!record?.sequence?.length) {
      elements.backboneDialogPreview.innerHTML = '<p class="small-note">Circular plasmid preview unavailable.</p>';
      return;
    }

    const htmlText = buildCircularPreviewHtmlDocument({
      ...record,
      topology: 'circular'
    });
    const title = normalizeRecordName(record?.name || 'Backbone preview', 'Backbone preview');
    if (typeof rootDocument?.createElement === 'function' && typeof elements.backboneDialogPreview?.replaceChildren === 'function') {
      const frame = rootDocument.createElement('iframe');
      frame.className = 'sequence-viewer-preview-frame';
      frame.loading = 'lazy';
      frame.title = title;
      frame.setAttribute('scrolling', 'no');
      frame.srcdoc = String(htmlText || '');
      elements.backboneDialogPreview.replaceChildren(frame);
      return;
    }

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(String(htmlText || ''))}`;
    elements.backboneDialogPreview.innerHTML = `<iframe class="sequence-viewer-preview-frame" src="${dataUrl}" loading="lazy" scrolling="no" title="${escapeHtml(title)}"></iframe>`;
  }

  function buildBackboneDialogSummaryHtml(displayMatch) {
    if (!displayMatch) {
      return '<p class="small-note">Select a candidate to preview the plasmid map.</p>';
    }

    const modeLabel = displayMatch.activeVariantMode === 'restriction'
      ? 'Restriction cloning'
      : 'Gibson / homologous recombination';
    const vectorName = cleanText(displayMatch.hostVectorName, 140) || 'vector';
    const promoterName = cleanText(displayMatch.promoter?.name, 140);
    const orfLength = Math.max(0, Number(displayMatch.orf?.length) || 0);
    const upstreamSite = cleanText(displayMatch.upstreamSite?.name, 80);
    const downstreamSite = cleanText(displayMatch.downstreamSite?.name, 80);

    const rows = [
      `<p><strong>Backbone Candidate:</strong> ${escapeHtml(vectorName)}</p>`,
      `<p><strong>Mode:</strong> ${escapeHtml(modeLabel)}</p>`,
      promoterName ? `<p><strong>Promoter:</strong> ${escapeHtml(promoterName)}</p>` : '<p><strong>Promoter:</strong> No promoter-aligned candidate</p>',
      orfLength > 0
        ? `<p><strong>ORF:</strong> ${orfLength.toLocaleString()} bp from ${escapeHtml(String(displayMatch.startCodon || 'ATG'))} to ${escapeHtml(String(displayMatch.stopCodon || 'stop'))}</p>`
        : '',
      `<p><strong>Insert:</strong> ${Math.max(0, Number(displayMatch.insertLength) || 0).toLocaleString()} bp</p>`,
      `<p><strong>Backbone:</strong> ${Math.max(0, Number(displayMatch.backboneLength) || 0).toLocaleString()} bp</p>`,
      displayMatch.activeVariantMode === 'restriction'
        ? `<p><strong>Sites:</strong> ${escapeHtml(upstreamSite || '5\' site not found')}${downstreamSite ? ` -> ${escapeHtml(downstreamSite)}` : ''}</p>`
        : ''
    ].filter(Boolean);

    return rows.join('');
  }

  function renderBackboneRecognitionDialog() {
    const dialogState = state.backboneRecognitionDialog || {};
    const isOpen = Boolean(dialogState.open) && Boolean(dialogState.match);
    if (elements.backboneDialogOverlay) {
      elements.backboneDialogOverlay.hidden = !isOpen;
    }
    if (!isOpen) {
      return;
    }

    const match = dialogState.match;
    const candidates = getRecognitionCandidates(match);
    const activeCandidateId = String(dialogState.candidateId || candidates[0]?.id || '');
    const activeVariantMode = dialogState.variantMode === 'restriction' ? 'restriction' : 'gibson';
    const activeDisplayMatch = getRecognitionDisplayMatch(match, {
      candidateId: activeCandidateId,
      variantMode: activeVariantMode
    });

    if (elements.backboneDialogModeGibsonBtn) {
      elements.backboneDialogModeGibsonBtn.classList.toggle('sequence-viewer-mode-btn-active', activeVariantMode === 'gibson');
    }
    if (elements.backboneDialogModeRestrictionBtn) {
      elements.backboneDialogModeRestrictionBtn.classList.toggle('sequence-viewer-mode-btn-active', activeVariantMode === 'restriction');
    }
    if (elements.backboneDialogSubtitle) {
      const hostName = cleanText(activeDisplayMatch?.hostVectorName, 140) || 'vector';
      elements.backboneDialogSubtitle.textContent = String(activeDisplayMatch?.recognitionSource || '').toLowerCase() === 'library_alignment'
        ? `Recognized ${hostName} as the backbone candidate. Choose a promoter / ORF candidate and insert mode to apply.`
        : `Recognized a backbone candidate from promoter alignment. Choose a promoter / ORF candidate and insert mode to apply.`;
    }
    if (elements.backboneDialogCandidates) {
      elements.backboneDialogCandidates.innerHTML = candidates.length
        ? candidates.map((candidate) => {
          const candidateId = String(candidate?.id || '');
          const promoterName = cleanText(candidate?.promoter?.name || candidate?.label || 'Candidate', 140);
          const promoterGap = Math.max(0, Number(candidate?.promoter?.gapToOrf) || 0);
          const orfLength = Math.max(0, Number(candidate?.orf?.length) || 0);
          const restrictionUp = cleanText(candidate?.variants?.restriction?.upstreamSite?.name, 80);
          const restrictionDown = cleanText(candidate?.variants?.restriction?.downstreamSite?.name, 80);
          const activeClass = candidateId === activeCandidateId
            ? ' sequence-viewer-backbone-dialog-candidate-active'
            : '';
          const note = restrictionUp || restrictionDown
            ? `${restrictionUp || '5\' site missing'} -> ${restrictionDown || '3\' site missing'}`
            : 'Restriction sites unavailable; Gibson/HR still available.';
          return `
            <button
              type="button"
              class="sequence-viewer-backbone-dialog-candidate${activeClass}"
              data-candidate-id="${escapeHtml(candidateId)}"
            >
              <span class="sequence-viewer-backbone-dialog-candidate-name">${escapeHtml(promoterName)}</span>
              <span class="sequence-viewer-backbone-dialog-candidate-meta">${orfLength > 0 ? `${orfLength.toLocaleString()} bp ORF` : 'No downstream ORF'}; ${promoterGap.toLocaleString()} bp from promoter</span>
              <span class="sequence-viewer-backbone-dialog-candidate-note">${escapeHtml(note)}</span>
            </button>
          `;
        }).join('')
        : '<p class="small-note">No candidates available.</p>';
    }
    if (elements.backboneDialogSummary) {
      elements.backboneDialogSummary.innerHTML = buildBackboneDialogSummaryHtml(activeDisplayMatch);
    }

    const record = state.records[clamp(dialogState.recordIndex, 0, Math.max(0, state.records.length - 1))] || null;
    if (!record?.sequence?.length) {
      renderBackboneDialogPreviewFrame(null);
      return;
    }

    const previewFeatures = buildBackboneRecognitionFeatures(match, record.sequence.length, {
      candidateId: activeCandidateId,
      variantMode: activeVariantMode,
      includeContextFeatures: false
    }).filter((feature) => feature?.type === 'backbone' || feature?.type === 'insert');
    const previewRecord = {
      ...record,
      features: previewFeatures
    };
    renderBackboneDialogPreviewFrame(previewRecord);
  }

  function closeBackboneRecognitionDialog() {
    state.backboneRecognitionDialog = {
      open: false,
      recordIndex: -1,
      match: null,
      candidateId: '',
      variantMode: 'gibson'
    };
    if (elements.backboneDialogOverlay) {
      elements.backboneDialogOverlay.hidden = true;
    }
  }

  function openBackboneRecognitionDialog(match, recordIndex) {
    const defaultDisplayMatch = getRecognitionDisplayMatch(match, { variantMode: 'gibson' });
    state.backboneRecognitionDialog = {
      open: true,
      recordIndex,
      match,
      candidateId: String(defaultDisplayMatch?.selectedCandidateId || getRecognitionCandidates(match)[0]?.id || ''),
      variantMode: 'gibson'
    };
    renderBackboneRecognitionDialog();
  }

  function updateBackboneRecognitionDialogSelection(nextSelection = {}) {
    if (!state.backboneRecognitionDialog?.open || !state.backboneRecognitionDialog?.match) {
      return;
    }

    const candidates = getRecognitionCandidates(state.backboneRecognitionDialog.match);
    const nextCandidateId = String(nextSelection.candidateId || state.backboneRecognitionDialog.candidateId || candidates[0]?.id || '');
    state.backboneRecognitionDialog = {
      ...state.backboneRecognitionDialog,
      candidateId: nextCandidateId,
      variantMode: nextSelection.variantMode === 'restriction'
        ? 'restriction'
        : (nextSelection.variantMode === 'gibson' ? 'gibson' : state.backboneRecognitionDialog.variantMode)
    };
    renderBackboneRecognitionDialog();
  }

  async function applyBackboneRecognitionSelection() {
    const dialogState = state.backboneRecognitionDialog || {};
    const match = dialogState.match;
    if (!dialogState.open || !match) {
      return;
    }

    const recordIndex = clamp(dialogState.recordIndex, 0, Math.max(0, state.records.length - 1));
    const nextRecords = [...state.records];
    const current = nextRecords[recordIndex];
    if (!current?.sequence?.length) {
      closeBackboneRecognitionDialog();
      setStatus('Selected record no longer exists.', true);
      return;
    }

    const previousFeatures = Array.isArray(current.features) ? current.features : [];
    const retainedFeatures = removeBackboneRecognitionFeatures(previousFeatures);
    const removedRecognitionFeatures = retainedFeatures.length !== previousFeatures.length;
    if (removedRecognitionFeatures) {
      current.features = retainedFeatures;
      state.records = nextRecords;
      state.selectedFeatureIndex = -1;
    }

    detailController?.hideFeatureContextMenu();
    detailController?.hideFeatureEditor();

    closeBackboneRecognitionDialog();
    if (removedRecognitionFeatures) {
      detailController?.clearSequenceSelection();
      detailController?.renderActiveRecord();
    }

    const displayMatch = getRecognitionDisplayMatch(match, {
      candidateId: dialogState.candidateId,
      variantMode: dialogState.variantMode
    });
    const matchedHostName = cleanText(displayMatch?.hostVectorName, 140) || 'vector';
    const promoterDriven = String(displayMatch?.recognitionSource || '').toLowerCase() === 'promoter_alignment';
    const insertLength = Math.max(0, Number(displayMatch?.insertLength) || 0);
    const summary = insertLength > 0
      ? `${promoterDriven ? 'Recognized a promoter-aligned backbone' : `Recognized ${matchedHostName} backbone`} with a ${insertLength.toLocaleString()} bp ${dialogState.variantMode === 'restriction' ? 'restriction-bounded' : 'Gibson/HR'} insert.`
      : `${promoterDriven ? 'Recognized a promoter-aligned backbone.' : `Recognized ${matchedHostName} backbone.`}`;
    let artifactStored = false;
    let artifactError = '';
    let sequenceCleanupSaved = false;
    let sequenceCleanupError = '';

    try {
      const artifactResult = await persistRecognizedBackboneArtifact(match, current, {
        candidateId: dialogState.candidateId,
        variantMode: dialogState.variantMode
      });
      artifactStored = Boolean(artifactResult?.ok || artifactResult?.filePath);
    } catch (error) {
      artifactError = error?.message || 'Failed to store Protein Builder backbone file.';
    }

    if (removedRecognitionFeatures && state.activeEntryId) {
      try {
        const entry = await persistRecordToLibrary(current, {
          id: state.activeEntryId,
          status: state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
          name: elements.saveNameInput?.value || current.name || 'sequence'
        });
        await homeController?.refreshLibraryEntries({
          selectedId: entry.id,
          filter: entry.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
          silent: true
        });
        sequenceCleanupSaved = true;
      } catch (error) {
        sequenceCleanupError = error?.message || 'Failed to update stored sequence.';
      }
    }

    const artifactMessage = artifactStored
      ? ' Stored a Protein Builder backbone selection.'
      : (artifactError ? ` ${artifactError}` : '');
    const sequenceMessage = removedRecognitionFeatures
      ? (sequenceCleanupSaved
        ? ' Removed backbone/insert annotations from the original sequence.'
        : (sequenceCleanupError
          ? ` Could not remove existing backbone/insert annotations from the original sequence: ${sequenceCleanupError}`
          : ' Removed local backbone/insert annotations from the original sequence.'))
      : ' The original sequence was left unchanged.';

    setStatus(`${summary}${artifactMessage}${sequenceMessage}`);
  }

  let homeController = null;
  let detailController = null;
  let annotationController = null;
  let alignmentController = null;
  let proteinBuilderController = null;

  function showProteinBuilderWorkspace() {
    setProteinBuilderConfirmation(null, { render: false });
    detailController?.hideFeatureContextMenu();
    detailController?.hideFeatureEditor();
    detailController?.hideSequenceEditDialog?.();
    homeController?.setLocalWorkspaceVisibility('builder');
    if (onNavigateHome) {
      onNavigateHome();
    }
  }

  function setRecords(result, statusPrefix = 'Loaded') {
    state.records = Array.isArray(result.records) ? result.records : [];
    state.warnings = Array.isArray(result.warnings) ? result.warnings : [];
    state.errors = Array.isArray(result.errors) ? result.errors : [];
    state.isAnnotating = false;
    state.isRecognizingBackbone = false;
    state.proteinBuilderConfirmation = null;
    closeBackboneRecognitionDialog();
    state.selectedRecordIndex = 0;
    state.selectedFeatureIndex = -1;
    resetAlignmentState();
    detailController?.clearSequenceSelection();
    detailController?.hideFeatureContextMenu();
    detailController?.hideFeatureEditor();
    detailController?.hideSequenceEditDialog?.();

    detailController?.updateRecordSelect();
    detailController?.renderActiveRecord();
    proteinBuilderController?.render();
    if (elements.saveNameInput && state.records.length) {
      elements.saveNameInput.value = normalizeRecordName(state.records[0].name || 'sequence', 'sequence');
    }
    homeController?.syncHomeControlsState();

    if (state.records.length) {
      setStatus(`${statusPrefix}: ${state.records.length} record(s).`);
    } else {
      setStatus(state.errors[0] || 'No records loaded.', true);
    }
  }

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file selected.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read selected file.'));
      reader.readAsText(file);
    });
  }

  async function readFileAsArrayBuffer(file) {
    if (!file) {
      throw new Error('No file selected.');
    }
    if (typeof file.arrayBuffer === 'function') {
      return await file.arrayBuffer();
    }
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (result instanceof ArrayBuffer) {
          resolve(result);
          return;
        }
        reject(new Error('Failed to read selected file as binary data.'));
      };
      reader.onerror = () => reject(new Error('Failed to read selected file as binary data.'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function loadCurrentInput() {
    if (state.proteinBuilderConfirmation) {
      setInputComposerVisible(false);
      setStatus('Use the sequence edit dialog to edit this Protein Builder construct.');
      return;
    }

    const raw = state.mode === 'file'
      ? state.fileText
      : (elements.inputTextarea?.value || '');

    if (!String(raw || '').trim()) {
      setRecords({ records: [], warnings: [], errors: ['Provide sequence input first.'] }, 'Idle');
      return;
    }

    const parsed = parseInputRecords(raw, { maxRecords: DEFAULT_MAX_RECORDS });
    state.activeEntryId = '';
    state.activeEntryStatus = '';

    setRecords(parsed, 'Loaded');
    setInputComposerVisible(!(Array.isArray(parsed.records) && parsed.records.length > 0));
    await maybePersistImportedGenbankRecord(parsed);
  }

  async function persistRecordToLibrary(record, persistOptions = {}) {
    const bridge = getBridge();
    const storagePath = getStoragePath();
    if (!storagePath) {
      throw new Error('Set Storage Folder Path in Settings before saving sequence entries.');
    }
    if (!bridge?.sequenceLibraryUpsert) {
      throw new Error('Sequence library storage API unavailable.');
    }

    const safeRecord = record && typeof record === 'object' ? record : null;
    if (!safeRecord?.sequence?.length) {
      throw new Error('No sequence record available to persist.');
    }

    const status = String(
      persistOptions?.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY
    ).toLowerCase() === LIBRARY_STATUS_SAVED
      ? LIBRARY_STATUS_SAVED
      : LIBRARY_STATUS_TEMPORARY;
    const name = normalizeRecordName(
      persistOptions?.name || elements.saveNameInput?.value || safeRecord.name || 'sequence',
      'sequence'
    );
    const gbkText = buildRecordGenbankText(safeRecord);
    if (!gbkText.trim()) {
      throw new Error('Failed to generate GenBank text for sequence entry.');
    }

    const htmlText = buildCircularPreviewHtmlDocument(safeRecord);
    const response = await bridge.sequenceLibraryUpsert({
      storagePath,
      id: cleanText(persistOptions?.id || state.activeEntryId, 200),
      name,
      status,
      sourceFormat: String(safeRecord.sourceFormat || ''),
      topology: normalizeTopology(safeRecord.topology || 'linear'),
      sequenceLength: safeRecord.sequence.length,
      featureCount: Array.isArray(safeRecord.features) ? safeRecord.features.length : 0,
      sequence: safeRecord.sequence,
      features: Array.isArray(safeRecord.features) ? safeRecord.features : [],
      gbkText,
      htmlText,
      alignmentSessions: Array.isArray(persistOptions?.alignmentSessions)
        ? persistOptions.alignmentSessions
        : undefined
    });
    if (!response?.ok || !response?.entry) {
      throw new Error(response?.error || 'Failed to persist sequence entry.');
    }

    state.activeEntryId = cleanText(response.entry.id, 200);
    state.activeEntryStatus = String(response.entry.status || status).toLowerCase();
    if (Array.isArray(response.alignments)) {
      setAlignmentSessions(response.alignments);
    }
    if (elements.saveNameInput) {
      elements.saveNameInput.value = response.entry.name || name;
    }
    return {
      ...response.entry,
      alignments: Array.isArray(response.alignments) ? response.alignments : []
    };
  }

  async function persistAlignmentSession(payload = {}) {
    const referenceRecord = payload?.referenceRecord;
    const session = payload?.session;
    const safeReferenceRecord = referenceRecord && typeof referenceRecord === 'object' ? referenceRecord : null;
    if (!safeReferenceRecord?.sequence?.length || !session || typeof session !== 'object') {
      return {
        session: null,
        sessions: Array.isArray(state.alignmentSessions) ? state.alignmentSessions : []
      };
    }

    if (!hasStoragePath()) {
      const scopedSession = {
        ...session,
        referenceRecordKey: buildSequenceSignature(safeReferenceRecord.sequence, 'ref'),
        referenceRecordName: normalizeRecordName(safeReferenceRecord.name || 'reference', 'reference')
      };
      const nextSessions = [
        scopedSession,
        ...(Array.isArray(state.alignmentSessions) ? state.alignmentSessions.filter((item) => String(item?.id || '') !== String(session?.id || '')) : [])
      ];
      setAlignmentSessions(nextSessions);
      return {
        session: scopedSession,
        sessions: nextSessions
      };
    }

    let entryId = cleanText(state.activeEntryId, 200);
    if (!entryId) {
      const entry = await persistRecordToLibrary(safeReferenceRecord, {
        status: LIBRARY_STATUS_TEMPORARY,
        name: elements.saveNameInput?.value || safeReferenceRecord.name || 'sequence',
        alignmentSessions: []
      });
      entryId = cleanText(entry.id, 200);
      await homeController?.refreshLibraryEntries({
        selectedId: entryId,
        filter: entry.status || LIBRARY_STATUS_TEMPORARY,
        silent: true
      });
    }

    const scopedSession = {
      ...session,
      referenceRecordKey: buildSequenceSignature(safeReferenceRecord.sequence, 'ref'),
      referenceRecordName: normalizeRecordName(safeReferenceRecord.name || 'reference', 'reference')
    };
    const existingSessions = Array.isArray(state.alignmentSessions) ? state.alignmentSessions : [];
    const nextSessions = [
      scopedSession,
      ...existingSessions.filter((item) => String(item?.id || '') !== String(scopedSession?.id || ''))
    ];
    const entry = await persistRecordToLibrary(safeReferenceRecord, {
      id: entryId,
      status: state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
      name: elements.saveNameInput?.value || safeReferenceRecord.name || 'sequence',
      alignmentSessions: nextSessions
    });
    await homeController?.refreshLibraryEntries({
      selectedId: entry.id,
      filter: entry.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
      silent: true
    });

    const resolvedSessions = Array.isArray(entry.alignments) ? entry.alignments : nextSessions;
    const resolvedSession = resolvedSessions.find((item) => String(item?.id || '') === String(scopedSession?.id || ''))
      || resolvedSessions[0]
      || scopedSession;

    return {
      session: resolvedSession,
      sessions: resolvedSessions
    };
  }

  async function persistFeatureMutation(record, actionLabel) {
    if (!state.activeEntryId) {
      setStatus(`${actionLabel} Save the record to persist changes.`);
      return;
    }

    try {
      const entry = await persistRecordToLibrary(record, {
        id: state.activeEntryId,
        status: state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
        name: elements.saveNameInput?.value || record.name || 'sequence'
      });
      await homeController?.refreshLibraryEntries({
        selectedId: entry.id,
        filter: entry.status || state.activeEntryStatus || LIBRARY_STATUS_TEMPORARY,
        silent: true
      });
      setStatus(`${actionLabel} Saved to ${entry.name}.`);
    } catch (error) {
      setStatus(`${actionLabel} Changes remain local: ${error?.message || 'Failed to save.'}`, true);
    }
  }

  function normalizeEditedFeatureSegment(segment, sequenceLength) {
    const safeLength = Math.max(0, Number(sequenceLength) || 0);
    const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
    const end = clamp(Math.round(Number(segment?.end) || 0), start, safeLength);
    if (end <= start) {
      return null;
    }
    return { start, end };
  }

  function mergeEditedFeatureSegments(segments, sequenceLength) {
    const normalized = (Array.isArray(segments) ? segments : [])
      .map((segment) => normalizeEditedFeatureSegment(segment, sequenceLength))
      .filter(Boolean)
      .sort((left, right) => {
        if (left.start !== right.start) {
          return left.start - right.start;
        }
        return left.end - right.end;
      });

    if (!normalized.length) {
      return [];
    }

    const merged = [normalized[0]];
    for (let index = 1; index < normalized.length; index += 1) {
      const previous = merged[merged.length - 1];
      const current = normalized[index];
      if (current.start <= previous.end) {
        previous.end = Math.max(previous.end, current.end);
      } else {
        merged.push(current);
      }
    }
    return merged;
  }

  function adjustFeatureSegmentsForSequenceEdit(features, editRange, replacementLength, nextSequenceLength) {
    const editStart = Math.max(0, Math.round(Number(editRange?.start) || 0));
    const editEnd = Math.max(editStart, Math.round(Number(editRange?.end) || editStart));
    const insertLength = Math.max(0, Math.round(Number(replacementLength) || 0));
    const delta = insertLength - Math.max(0, editEnd - editStart);
    const safeNextLength = Math.max(0, Number(nextSequenceLength) || 0);

    return (Array.isArray(features) ? features : [])
      .map((feature) => {
        if (!Array.isArray(feature?.segments)) {
          return feature;
        }

        const adjustedSegments = feature.segments
          .map((segment) => {
            const start = Math.max(0, Math.round(Number(segment?.start) || 0));
            const end = Math.max(start, Math.round(Number(segment?.end) || start));
            if (end <= start) {
              return null;
            }

            if (end <= editStart) {
              return { start, end };
            }
            if (start >= editEnd) {
              return { start: start + delta, end: end + delta };
            }

            const nextStart = start < editStart ? start : editStart;
            const nextEnd = end > editEnd
              ? end + delta
              : editStart + insertLength;
            if (nextEnd <= nextStart) {
              return null;
            }
            return { start: nextStart, end: nextEnd };
          })
          .filter(Boolean);

        const mergedSegments = mergeEditedFeatureSegments(adjustedSegments, safeNextLength);
        if (!mergedSegments.length) {
          return null;
        }

        return {
          ...feature,
          locationText: '',
          segments: mergedSegments
        };
      })
      .filter(Boolean);
  }

  function buildSequenceEditStatus(mode, range, replacementLength) {
    const start = Math.max(0, Math.round(Number(range?.start) || 0));
    const end = Math.max(start, Math.round(Number(range?.end) || start));
    const selectedLength = Math.max(0, end - start);
    const insertedLength = Math.max(0, Number(replacementLength) || 0);
    if (mode === 'delete') {
      return `Deleted ${selectedLength.toLocaleString()} bp.`;
    }
    if (mode === 'replace') {
      return `Replaced ${selectedLength.toLocaleString()} bp with ${insertedLength.toLocaleString()} bp.`;
    }
    return `Inserted ${insertedLength.toLocaleString()} bp.`;
  }

  async function applySequenceEdit(payload = {}) {
    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      throw new Error('Load a record before editing sequence bases.');
    }

    const sequence = normalizeSequenceText(record.sequence);
    const sequenceLength = sequence.length;
    const mode = payload?.mode === 'delete'
      ? 'delete'
      : (payload?.mode === 'replace' ? 'replace' : 'insert');
    const start = clamp(Math.round(Number(payload?.range?.start) || 0), 0, sequenceLength);
    const end = mode === 'insert'
      ? start
      : clamp(Math.round(Number(payload?.range?.end) || start), start, sequenceLength);
    const replacement = mode === 'delete'
      ? ''
      : normalizeSequenceText(payload?.sequence || '').replace(/\*/g, '');

    if (mode !== 'insert' && end <= start) {
      throw new Error('Select one or more bases before editing.');
    }
    if (mode !== 'delete' && !replacement.length) {
      throw new Error('Enter at least one base before confirming.');
    }

    const nextSequence = `${sequence.slice(0, start)}${replacement}${sequence.slice(end)}`;
    if (!nextSequence.length) {
      throw new Error('The sequence cannot be empty.');
    }

    const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
    const nextRecords = [...state.records];
    const current = nextRecords[selectedIndex];
    const adjustedFeatures = adjustFeatureSegmentsForSequenceEdit(
      current?.features,
      { start, end },
      replacement.length,
      nextSequence.length
    );
    const nextRecord = {
      ...current,
      sequence: nextSequence,
      features: adjustedFeatures
    };
    if (typeof nextRecord.quality === 'string' && nextRecord.quality.length) {
      nextRecord.quality = '';
      const qualityWarning = 'Sequence edits clear per-base quality scores because they no longer match the edited sequence.';
      if (!state.warnings.includes(qualityWarning)) {
        state.warnings = [...state.warnings, qualityWarning];
      }
    }

    nextRecords[selectedIndex] = nextRecord;
    state.records = nextRecords;
    state.selectedFeatureIndex = -1;
    state.sequenceCursorBase = clamp(start + replacement.length, 0, nextSequence.length);
    resetAlignmentState({ preserveSessions: true });
    if (state.proteinBuilderConfirmation) {
      state.proteinBuilderConfirmation = {
        ...state.proteinBuilderConfirmation,
        plasmidLength: nextSequence.length
      };
    }
    detailController?.clearSequenceSelection({ preserveCursor: true });
    detailController?.hideFeatureContextMenu();
    detailController?.hideFeatureEditor();
    detailController?.updateRecordSelect?.();
    detailController?.renderActiveRecord?.();
    alignmentController?.handleReferenceRecordChanged?.();

    const actionLabel = buildSequenceEditStatus(mode, { start, end }, replacement.length);
    await persistFeatureMutation(nextRecord, actionLabel);
  }

  async function maybePersistImportedGenbankRecord(parsed) {
    const format = String(parsed?.format || '').toLowerCase();
    if (format !== 'genbank' || state.activeEntryId) {
      return null;
    }

    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    if (records.length !== 1) {
      return null;
    }

    const record = records[0];
    if (!record?.sequence?.length) {
      return null;
    }

    const storagePath = getStoragePath();
    const bridge = getBridge();
    if (!storagePath || !bridge?.sequenceLibraryUpsert) {
      return null;
    }

    try {
      const entry = await persistRecordToLibrary(record, {
        status: LIBRARY_STATUS_TEMPORARY,
        name: record.name || 'sequence'
      });
      await homeController?.refreshLibraryEntries({
        selectedId: entry.id,
        filter: entry.status || LIBRARY_STATUS_TEMPORARY,
        silent: true
      });
      return entry;
    } catch {
      return null;
    }
  }

  async function saveCurrentRecordAsSaved() {
    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Load a record before saving.', true);
      return;
    }

    try {
      const entry = await persistRecordToLibrary(record, {
        id: state.activeEntryId,
        status: LIBRARY_STATUS_SAVED,
        name: elements.saveNameInput?.value || record.name || 'sequence'
      });
      state.activeEntryId = cleanText(entry.id, 200);
      state.activeEntryStatus = LIBRARY_STATUS_SAVED;
      await homeController?.refreshLibraryEntries({
        selectedId: entry.id,
        filter: entry.status || LIBRARY_STATUS_SAVED,
        silent: true
      });
      setProteinBuilderConfirmation(null, { render: false });
      detailController?.renderActiveRecord?.();
      setStatus(`Saved sequence as ${entry.name}.`);
      homeController?.setHomeStatus(`Saved sequence entry: ${entry.name}.`);
    } catch (error) {
      setStatus(error?.message || 'Failed to save sequence.', true);
    }
  }

  async function recognizeCurrentBackboneInsert() {
    if (state.isRecognizingBackbone) {
      return;
    }

    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Load a record before backbone recognition.', true);
      return;
    }

    const storagePath = getStoragePath();
    if (!storagePath) {
      setStatus('Set Storage Folder Path in Settings before recognizing vector backbone.', true);
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibraryRecognizeBackbone) {
      setStatus('Backbone recognition API unavailable.', true);
      return;
    }

    state.isRecognizingBackbone = true;
    detailController?.syncActionButtonsState();
    setStatus(`Recognizing vector backbone for ${record.name || 'record'}...`);

    try {
      const response = await bridge.sequenceLibraryRecognizeBackbone({
        storagePath,
        sequence: record.sequence,
        excludeEntryId: state.activeEntryId
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Backbone recognition failed.');
      }

      const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
      const nextRecords = [...state.records];
      const current = nextRecords[selectedIndex];
      if (!current) {
        throw new Error('Selected record no longer exists.');
      }

      const previousFeatures = Array.isArray(current.features) ? current.features : [];
      const retainedFeatures = removeBackboneRecognitionFeatures(previousFeatures);
      const hadRecognitionFeatures = retainedFeatures.length !== previousFeatures.length;

      if (!response.match) {
        current.features = retainedFeatures;
        state.records = nextRecords;
        detailController?.clearSequenceSelection();
        detailController?.hideFeatureContextMenu();
        detailController?.hideFeatureEditor();
        state.selectedFeatureIndex = -1;
        detailController?.renderActiveRecord();
        if (hadRecognitionFeatures && state.activeEntryId) {
          await persistFeatureMutation(current, 'Cleared auto-detected backbone/insert features.');
        }
        setStatus('No backbone candidate was recognized from promoter alignment.');
        return;
      }

      openBackboneRecognitionDialog(response.match, selectedIndex);
      setStatus('Backbone recognized. Review promoter / ORF candidates before applying.');
    } catch (error) {
      setStatus(error?.message || 'Backbone recognition failed.', true);
    } finally {
      state.isRecognizingBackbone = false;
      detailController?.syncActionButtonsState();
    }
  }

  function clearAll() {
    if (elements.inputTextarea) {
      elements.inputTextarea.value = '';
    }
    if (elements.fileInput) {
      elements.fileInput.value = '';
    }
    if (elements.fileNameLabel) {
      elements.fileNameLabel.textContent = 'No file selected';
    }

    state.fileName = '';
    state.fileText = '';
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    state.isAnnotating = false;
    state.isRecognizingBackbone = false;
    closeBackboneRecognitionDialog();
    setMode('paste');
    setInputComposerVisible(true);
    detailController?.hideFeatureContextMenu();
    detailController?.hideFeatureEditor();
    detailController?.hideSequenceEditDialog?.();
    setRecords({ records: [], warnings: [], errors: [] }, 'Cleared');
    setStatus('Idle');
    if (elements.saveNameInput) {
      elements.saveNameInput.value = '';
    }
  }

  homeController = createSequenceViewerHomeController({
    rootDocument,
    elements,
    state,
    fileAccept: FILE_ACCEPT,
    libraryStatusSaved: LIBRARY_STATUS_SAVED,
    libraryStatusTemporary: LIBRARY_STATUS_TEMPORARY,
    getBridge,
    getStoragePath,
    hasStoragePath,
    getSelectedRecord,
    setMode,
    setInputComposerVisible,
    setRecords,
    setStatus,
    readFileAsText,
    onParsedRecordsOpened: maybePersistImportedGenbankRecord,
    onLibraryEntryLoaded: ({ alignments }) => {
      setAlignmentSessions(alignments);
      alignmentController?.handleReferenceRecordChanged?.();
    },
    hideFeatureContextMenu: () => detailController?.hideFeatureContextMenu(),
    hideFeatureEditor: () => detailController?.hideFeatureEditor(),
    onNavigateHome,
    onNavigateDetail,
    onClearAll: clearAll
  });

  detailController = createSequenceViewerDetailController({
    rootDocument,
    elements,
    state,
    getSelectedRecord,
    updateMessages,
    setStatus,
    hasStoragePath,
    persistFeatureMutation,
    onRequestAnnotate: () => annotationController?.annotateCurrentRecord?.(),
    onRequestRecognizeBackbone: recognizeCurrentBackboneInsert,
    onRequestClear: clearAll,
    onRequestSave: saveCurrentRecordAsSaved,
    onApplySequenceEdit: applySequenceEdit,
    onRequestAlignment: () => alignmentController?.openSequencingAlignmentWorkspace?.(),
    onSelectAlignmentSession: (sessionId) => alignmentController?.selectSavedAlignmentSession?.(sessionId, { enableView: true }),
    onConfirmProteinBuilderConstruct: () => {
      if (!state.proteinBuilderConfirmation) {
        return;
      }
      const confirmation = state.proteinBuilderConfirmation;
      let cloningNotebookResult = null;
      let notebookWarning = '';
      try {
        cloningNotebookResult = createConfirmedProteinBuilderCloningNotebookPage(confirmation);
      } catch (error) {
        notebookWarning = error?.message || 'Failed to update the cloning notebook page.';
      }
      setProteinBuilderConfirmation(null);
      setInputComposerVisible(false);
      if (cloningNotebookResult?.entry) {
        const notebookTitle = cleanText(cloningNotebookResult.entry.experimentName, 220)
          || cleanText(cloningNotebookResult.entry.protocolName, 220)
          || 'Protein Builder Cloning Assembly';
        const primerCount = Math.max(
          0,
          Number(cloningNotebookResult.entry?.proteinBuilderCloningDesign?.primerCount) || 0
        );
        setStatus(`Construct confirmed. Notebook page "${notebookTitle}" has the cloning plan, PCR program, and ${primerCount} primer${primerCount === 1 ? '' : 's'}. Save it to add it to Sequence Library.`);
        return;
      }
      if (notebookWarning) {
        setStatus(`Construct confirmed, but the cloning notebook page was not updated: ${notebookWarning}`, true);
        return;
      }
      setStatus('Construct confirmed. Save it to add it to Sequence Library.');
    },
    onReturnToProteinBuilder: () => {
      setProteinBuilderConfirmation(null, { render: false });
      showProteinBuilderWorkspace();
      setStatus('Returned to Protein Builder to adjust the construct.');
    },
    onNavigateHome: () => {
      setProteinBuilderConfirmation(null, { render: false });
      detailController?.hideSequenceEditDialog?.();
      homeController.navigateToHome();
    },
    onRefreshLibraryEntries: homeController.refreshLibraryEntries,
    onReferenceRecordChanged: () => {
      resetAlignmentState({ preserveSessions: true });
      alignmentController?.handleReferenceRecordChanged?.();
    }
  });

  annotationController = createSequenceViewerAnnotationController({
    state,
    getSelectedRecord,
    getStoragePath,
    getBridge,
    detailController,
    persistFeatureMutation,
    setStatus
  });

  alignmentController = createSequenceViewerAlignmentController({
    elements,
    viewerState: state,
    setStatus,
    setLocalWorkspaceVisibility: homeController.setLocalWorkspaceVisibility,
    onNavigateDetail,
    onAlignmentStateChange: () => detailController?.renderActiveRecord?.(),
    getSelectedReferenceRecord: getSelectedRecord,
    persistAlignmentSession,
    readFileAsText,
    readFileAsArrayBuffer
  });

  proteinBuilderController = createSequenceViewerProteinBuilderController({
    elements,
    state: options?.state,
    persist: options?.persist,
    createId: options?.createId,
    onNotebookEntriesChanged: options?.onNotebookEntriesChanged,
    getBridge,
    getStoragePath,
    getSelectedRecord,
    getSelectedFeature: () => {
      const record = getSelectedRecord();
      if (!record || !Number.isFinite(state.selectedFeatureIndex) || state.selectedFeatureIndex < 0) {
        return null;
      }
      const visibleFeatures = detailController?.getVisibleFeaturesForRecord?.(record) || [];
      return visibleFeatures[state.selectedFeatureIndex] || null;
    },
    hasStoragePath,
    setStatus,
    onNavigateHome: () => {
      setProteinBuilderConfirmation(null, { render: false });
      homeController.navigateToHome();
    },
    onNavigateBuilder: showProteinBuilderWorkspace,
    loadExternalRecord: loadFromExternal
  });

  function loadFromExternal(payload, options = {}) {
    const record = normalizeExternalPayload(payload);
    const hasSequence = Boolean(record.sequence.length);
    const proteinBuilderConfirmation = normalizeProteinBuilderConfirmation(options?.proteinBuilderConfirmation);

    setMode('paste');
    if (elements.inputTextarea) {
      elements.inputTextarea.value = proteinBuilderConfirmation ? '' : record.sequence;
    }
    state.activeEntryId = '';
    state.activeEntryStatus = '';
    if (elements.saveNameInput) {
      elements.saveNameInput.value = record.name || 'sequence';
    }

    setRecords({
      records: hasSequence ? [record] : [],
      warnings: hasSequence ? [] : ['External payload had no sequence.'],
      errors: hasSequence ? [] : ['Failed to load external payload.']
    }, 'Imported');
    setProteinBuilderConfirmation(proteinBuilderConfirmation, { render: false });
    setInputComposerVisible(!hasSequence);

    if (hasSequence) {
      homeController.navigateToDetail();
      detailController?.renderActiveRecord?.();
      setStatus(
        proteinBuilderConfirmation
          ? 'Review the assembled plasmid and confirm the construct.'
          : `Imported ${record.name} from ${record.sourceFormat || 'external'}.`
      );
    }
  }

  function syncShellWorkspace(activeViewId = '') {
    const nextViewId = String(activeViewId || '').trim();
    const workspaceMode = String(state.localWorkspaceMode || '').trim().toLowerCase();
    if (!nextViewId || !workspaceMode) {
      return;
    }

    if (nextViewId === homeViewId) {
      if (workspaceMode === 'detail' || workspaceMode === 'alignment') {
        homeController?.setLocalWorkspaceVisibility('home');
      }
      return;
    }

    if (nextViewId === detailViewId) {
      if (workspaceMode === 'home' || workspaceMode === 'builder') {
        homeController?.setLocalWorkspaceVisibility('detail');
      }
    }
  }

  function render(renderOptions = {}) {
    syncShellWorkspace(renderOptions?.activeViewId);
    detailController.updateRecordSelect();
    detailController.renderActiveRecord();
    alignmentController?.render?.();
    proteinBuilderController?.render();
    homeController.syncHomeControlsState();
    void homeController.refreshLibraryEntries({ silent: true });
  }

  elements.modePasteBtn?.addEventListener('click', () => {
    setMode('paste');
  });

  elements.modeFileBtn?.addEventListener('click', () => {
    setMode('file');
  });

  elements.fileChooseBtn?.addEventListener('click', () => {
    elements.fileInput?.click();
  });

  elements.fileInput?.addEventListener('change', async () => {
    const file = elements.fileInput.files?.[0];
    if (!file) {
      return;
    }

    try {
      setStatus('Loading file...');
      state.fileText = await readFileAsText(file);
      state.fileName = String(file.name || '');
      if (elements.fileNameLabel) {
        elements.fileNameLabel.textContent = state.fileName || 'No file selected';
      }
      setStatus(`Loaded file: ${state.fileName || 'input'}`);
    } catch (error) {
      state.fileText = '';
      state.fileName = '';
      if (elements.fileNameLabel) {
        elements.fileNameLabel.textContent = 'No file selected';
      }
      setStatus(error.message || 'Failed to load file.', true);
    }
  });

  elements.loadBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    void loadCurrentInput();
  });

  elements.backboneDialogCandidates?.addEventListener('click', (event) => {
    const candidateId = getDatasetValueFromTarget(event.target, 'candidateId');
    if (!candidateId) {
      return;
    }
    updateBackboneRecognitionDialogSelection({ candidateId });
  });

  elements.backboneDialogModeGibsonBtn?.addEventListener('click', () => {
    updateBackboneRecognitionDialogSelection({ variantMode: 'gibson' });
  });

  elements.backboneDialogModeRestrictionBtn?.addEventListener('click', () => {
    updateBackboneRecognitionDialogSelection({ variantMode: 'restriction' });
  });

  elements.backboneDialogApplyBtn?.addEventListener('click', () => {
    void applyBackboneRecognitionSelection();
  });

  elements.backboneDialogCloseBtn?.addEventListener('click', () => {
    closeBackboneRecognitionDialog();
    setStatus('Backbone recognition review closed.');
  });

  elements.backboneDialogCancelBtn?.addEventListener('click', () => {
    closeBackboneRecognitionDialog();
    setStatus('Backbone recognition review canceled.');
  });

  elements.backboneDialogOverlay?.addEventListener('click', (event) => {
    if (event.target !== elements.backboneDialogOverlay) {
      return;
    }
    closeBackboneRecognitionDialog();
    setStatus('Backbone recognition review closed.');
  });

  homeController.bindEvents();
  detailController.bindEvents();
  alignmentController?.bindEvents?.();
  proteinBuilderController?.bindEvents?.();

  homeController.setLibraryFilter(LIBRARY_STATUS_SAVED);
  homeController.setLocalWorkspaceVisibility('home');
  setMode('paste');
  setInputComposerVisible(true);
  setStatus('Paste sequence text, then click Load.');
  homeController.setHomeStatus('');
  render();

  return {
    render,
    loadFromExternal,
    openSequencingAlignmentWorkspace: () => alignmentController?.openSequencingAlignmentWorkspace?.(),
    closeSequencingAlignmentWorkspace: () => alignmentController?.closeSequencingAlignmentWorkspace?.(),
    loadSequencingAlignmentReference: async (input) => await alignmentController?.loadSequencingAlignmentReference?.(input),
    loadSequencingAlignmentQuery: async (input) => await alignmentController?.loadSequencingAlignmentQuery?.(input),
    runSequencingAlignment: async () => await alignmentController?.runSequencingAlignment?.()
  };
}
