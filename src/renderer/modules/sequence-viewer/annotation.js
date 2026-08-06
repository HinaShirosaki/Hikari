import {
  cleanText,
  clamp,
  normalizeRecordName,
  normalizeTopology
} from './shared.js';
import { normalizeFeatureType } from './feature-types.js';

const FEATURE_SOURCE_SQL_ANNOTATION_DNA = 'sql_annotation_dna';
const FEATURE_SOURCE_SQL_ANNOTATION_PROTEIN = 'sql_annotation_protein';

function normalizeSegments(segments, sequenceLength) {
  const safeLength = Math.max(0, Number(sequenceLength) || 0);
  if (!safeLength) {
    return [];
  }

  return (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = clamp(Math.round(Number(segment?.start) || 0), 0, safeLength);
      const end = clamp(Math.round(Number(segment?.end) || 0), 0, safeLength);
      if (end <= start) {
        return null;
      }
      return { start, end };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }
      return left.end - right.end;
    });
}

function buildSegmentKey(segments) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => `${segment.start}-${segment.end}`)
    .join(',');
}

function buildFeatureId(prefix, match = {}, segments = []) {
  const safePrefix = cleanText(prefix, 40).toLowerCase() || 'annotation';
  const safeReference = cleanText(match.featureId || match.name || match.type || 'feature', 240)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72)
    || 'feature';
  const strand = Number(match?.strand) === -1 ? 'minus' : 'plus';
  const segmentKey = buildSegmentKey(segments).replace(/[^0-9,-]+/g, '').slice(0, 120) || '0-0';
  return `${safePrefix}_${safeReference}_${strand}_${segmentKey}`;
}

function summarizeHosts(hosts) {
  const names = (Array.isArray(hosts) ? hosts : [])
    .map((host) => normalizeRecordName(host?.hostVectorName || '', ''))
    .filter(Boolean);
  if (!names.length) {
    return '';
  }
  if (names.length === 1) {
    return names[0];
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names.slice(0, 2).join(', ')}, and ${names.length - 2} more`;
}

function buildDnaAnnotationDescription(match = {}) {
  const hostSummary = summarizeHosts(match?.hosts);
  const matchLength = Math.max(0, Number(match?.sequenceLength) || Number(match?.matchedSequence?.length) || 0);
  const typeLabel = cleanText(match?.type, 120) || 'feature';
  const parts = [`Exact DNA annotation match for stored ${typeLabel}.`];
  if (matchLength > 0) {
    parts.push(`${matchLength.toLocaleString()} bp matched.`);
  }
  if (hostSummary) {
    parts.push(`Seen in ${hostSummary}.`);
  }
  return parts.join(' ');
}

function buildProteinAnnotationDescription(match = {}) {
  const hostSummary = summarizeHosts(match?.hosts);
  const aaLength = Math.max(0, Number(match?.orfLengthAa) || 0);
  const ntLength = Math.max(0, Number(match?.orfLengthNt) || 0);
  const frame = cleanText(match?.orfFrame, 24);
  const parts = ['Exact ORF protein annotation match for a stored CDS.'];
  if (aaLength > 0 || ntLength > 0 || frame) {
    const detail = [];
    if (frame) {
      detail.push(`frame ${frame}`);
    }
    if (aaLength > 0) {
      detail.push(`${aaLength.toLocaleString()} aa`);
    }
    if (ntLength > 0) {
      detail.push(`${ntLength.toLocaleString()} nt`);
    }
    if (detail.length) {
      parts.push(`${detail.join(', ')}.`);
    }
  }
  if (hostSummary) {
    parts.push(`Seen in ${hostSummary}.`);
  }
  return parts.join(' ');
}

function buildDnaAnnotationFeatures(matches, sequenceLength) {
  return (Array.isArray(matches) ? matches : [])
    .map((match) => {
      const segments = normalizeSegments(match?.segments, sequenceLength);
      if (!segments.length) {
        return null;
      }
      return {
        id: buildFeatureId(FEATURE_SOURCE_SQL_ANNOTATION_DNA, match, segments),
        name: normalizeRecordName(match?.name || match?.type || 'feature', 'feature'),
        type: normalizeFeatureType(cleanText(match?.type || 'misc_feature', 120)),
        strand: Number(match?.strand) === -1 ? -1 : 1,
        source: FEATURE_SOURCE_SQL_ANNOTATION_DNA,
        identity: 100,
        coverage: 100,
        description: buildDnaAnnotationDescription(match),
        segments
      };
    })
    .filter(Boolean);
}

function buildProteinAnnotationFeatures(matches, sequenceLength) {
  return (Array.isArray(matches) ? matches : [])
    .map((match) => {
      const segments = normalizeSegments(match?.segments, sequenceLength);
      if (!segments.length) {
        return null;
      }
      return {
        id: buildFeatureId(FEATURE_SOURCE_SQL_ANNOTATION_PROTEIN, match, segments),
        name: normalizeRecordName(match?.name || 'cds', 'cds'),
        type: normalizeFeatureType(cleanText(match?.type || 'cds', 120), 'cds'),
        strand: Number(match?.strand) === -1 ? -1 : 1,
        source: FEATURE_SOURCE_SQL_ANNOTATION_PROTEIN,
        identity: 100,
        coverage: 100,
        translation: cleanText(match?.translation || match?.proteinSequence, 24000).toUpperCase(),
        description: buildProteinAnnotationDescription(match),
        orfFrame: cleanText(match?.orfFrame, 24),
        orfLengthNt: Math.max(0, Number(match?.orfLengthNt) || 0),
        orfLengthAa: Math.max(0, Number(match?.orfLengthAa) || 0),
        startCodon: cleanText(match?.startCodon, 12).toUpperCase(),
        stopCodon: cleanText(match?.stopCodon, 12).toUpperCase(),
        segments
      };
    })
    .filter(Boolean);
}

export function isSqlAnnotationFeature(feature) {
  const source = cleanText(feature?.source, 120).toLowerCase();
  return source === FEATURE_SOURCE_SQL_ANNOTATION_DNA
    || source === FEATURE_SOURCE_SQL_ANNOTATION_PROTEIN;
}

function removeSqlAnnotationFeatures(features) {
  return (Array.isArray(features) ? features : []).filter((feature) => !isSqlAnnotationFeature(feature));
}

function areFeaturesEquivalent(left, right, sequenceLength) {
  if (!left || !right) {
    return false;
  }

  const leftSegments = normalizeSegments(left?.segments, sequenceLength);
  const rightSegments = normalizeSegments(right?.segments, sequenceLength);
  if (leftSegments.length !== rightSegments.length) {
    return false;
  }

  const strandMatches = (Number(left?.strand) === -1 ? -1 : 1) === (Number(right?.strand) === -1 ? -1 : 1);
  const nameMatches = cleanText(left?.name, 240) === cleanText(right?.name, 240);
  const typeMatches = cleanText(left?.type, 120).toLowerCase() === cleanText(right?.type, 120).toLowerCase();
  const segmentsMatch = leftSegments.every((segment, index) => (
    segment.start === rightSegments[index]?.start
    && segment.end === rightSegments[index]?.end
  ));

  return strandMatches && nameMatches && typeMatches && segmentsMatch;
}

function buildStatusSummary(dnaCount, proteinCount) {
  const parts = [];
  if (dnaCount > 0) {
    parts.push(`${dnaCount} DNA feature${dnaCount === 1 ? '' : 's'}`);
  }
  if (proteinCount > 0) {
    parts.push(`${proteinCount} CDS feature${proteinCount === 1 ? '' : 's'}`);
  }
  if (!parts.length) {
    return 'No SQL-backed annotations matched this sequence.';
  }
  if (parts.length === 1) {
    return `Annotated ${parts[0]}.`;
  }
  return `Annotated ${parts[0]} and ${parts[1]}.`;
}

function buildAlreadyPresentStatus(matchCount) {
  const safeCount = Math.max(0, Math.round(Number(matchCount) || 0));
  return `All ${safeCount.toLocaleString()} SQL-backed annotation match${safeCount === 1 ? '' : 'es'} ${safeCount === 1 ? 'is' : 'are'} already present on this sequence.`;
}

export function createSequenceViewerAnnotationController(config = {}) {
  const state = config?.state || {};
  const getSelectedRecord = config?.getSelectedRecord || (() => null);
  const getStoragePath = config?.getStoragePath || (() => '');
  const getBridge = config?.getBridge || (() => null);
  const detailController = config?.detailController || null;
  const persistFeatureMutation = config?.persistFeatureMutation || (async () => {});
  const setStatus = config?.setStatus || (() => {});

  async function annotateCurrentRecord() {
    if (state.isAnnotating) {
      return;
    }

    const record = getSelectedRecord();
    if (!record?.sequence?.length) {
      setStatus('Load a record before annotation.', true);
      return;
    }

    const storagePath = String(getStoragePath() || '').trim();
    if (!storagePath) {
      setStatus('Set Storage Folder Path in Settings before annotating from the sequence library.', true);
      return;
    }

    const bridge = getBridge();
    if (!bridge?.sequenceLibraryAnnotate) {
      setStatus('Sequence annotation API unavailable.', true);
      return;
    }

    state.isAnnotating = true;
    detailController?.syncActionButtonsState?.();
    setStatus(`Annotating ${record.name || 'record'} from stored SQL features...`);

    try {
      const response = await bridge.sequenceLibraryAnnotate({
        storagePath,
        sequence: record.sequence,
        topology: normalizeTopology(record.topology || 'linear')
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'Sequence annotation failed.');
      }

      const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, state.records.length - 1));
      const nextRecords = [...state.records];
      const current = nextRecords[selectedIndex];
      if (!current) {
        throw new Error('Selected record no longer exists.');
      }

      const previousFeatures = Array.isArray(current.features) ? current.features : [];
      const retainedFeatures = removeSqlAnnotationFeatures(previousFeatures);
      const nextDnaFeatures = buildDnaAnnotationFeatures(response?.dnaMatches, current.sequence.length);
      const nextProteinFeatures = buildProteinAnnotationFeatures(response?.proteinMatches, current.sequence.length);
      const matchedFeatures = [...nextDnaFeatures, ...nextProteinFeatures];
      const nextAutoFeatures = matchedFeatures
        .filter((feature) => !retainedFeatures.some((existingFeature) => (
          areFeaturesEquivalent(existingFeature, feature, current.sequence.length)
        )));

      current.features = [...retainedFeatures, ...nextAutoFeatures];
      state.records = nextRecords;
      detailController?.clearSequenceSelection?.();
      detailController?.hideFeatureContextMenu?.();
      detailController?.hideFeatureEditor?.();

      const hadPreviousSqlFeatures = retainedFeatures.length !== previousFeatures.length;
      if (!nextAutoFeatures.length) {
        state.selectedFeatureIndex = -1;
        detailController?.renderActiveRecord?.();
        if (hadPreviousSqlFeatures && state.activeEntryId) {
          await persistFeatureMutation(current, 'Cleared SQL-derived annotations.');
        }
        setStatus(matchedFeatures.length
          ? buildAlreadyPresentStatus(matchedFeatures.length)
          : 'No SQL-backed annotations matched this sequence.');
        return;
      }

      const preferredFeature = nextProteinFeatures.find((feature) => nextAutoFeatures.includes(feature))
        || nextAutoFeatures[0];
      state.selectedFeatureIndex = detailController?.findFeatureIndexByIdentity?.(
        detailController?.getVisibleFeaturesForRecord?.(current),
        preferredFeature
      ) ?? -1;
      detailController?.renderActiveRecord?.();

      const dnaCount = nextAutoFeatures.filter((feature) => feature.source === FEATURE_SOURCE_SQL_ANNOTATION_DNA).length;
      const proteinCount = nextAutoFeatures.filter((feature) => feature.source === FEATURE_SOURCE_SQL_ANNOTATION_PROTEIN).length;
      const duplicateCount = Math.max(0, matchedFeatures.length - nextAutoFeatures.length);
      const summary = `${buildStatusSummary(dnaCount, proteinCount)}${duplicateCount
        ? ` ${duplicateCount.toLocaleString()} other match${duplicateCount === 1 ? '' : 'es'} ${duplicateCount === 1 ? 'was' : 'were'} already present.`
        : ''}`;

      if (state.activeEntryId) {
        await persistFeatureMutation(current, summary);
      } else {
        setStatus(`${summary} Save the record to persist changes.`);
      }
    } catch (error) {
      setStatus(error?.message || 'Sequence annotation failed.', true);
    } finally {
      state.isAnnotating = false;
      detailController?.syncActionButtonsState?.();
    }
  }

  return {
    annotateCurrentRecord
  };
}
