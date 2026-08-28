import { escapeHtml } from '../../lib/html.js';
import { normalizeHighlightSegments } from './rendering.js';
import { buildSequenceSignature, cleanText, normalizeSequenceText } from './shared.js';
import { buildInlineTraceLines } from './detail-alignment/inline-trace-geometry.js';
import { buildDisplayAlignmentTrace } from './detail-alignment/trace-normalizing.js';

function normalizeTrackReferenceIndex(value, sequenceLength, allowWrap) {
  const safeLength = Math.max(0, Math.floor(Number(sequenceLength) || 0));
  if (!safeLength) {
    return null;
  }

  const numeric = Math.floor(Number(value) || 0);
  if (numeric >= 0 && numeric < safeLength) {
    return numeric;
  }
  if (!allowWrap) {
    return null;
  }

  let wrapped = numeric % safeLength;
  if (wrapped < 0) {
    wrapped += safeLength;
  }
  return wrapped;
}

export function buildAlignmentSequenceTrack(state, record, options = {}) {
  const referenceSequence = normalizeSequenceText(record?.sequence || '');
  const result = state?.activeAlignmentResult && typeof state.activeAlignmentResult === 'object'
    ? state.activeAlignmentResult
    : null;
  if (!state?.alignmentViewEnabled || !referenceSequence.length || !result) {
    return null;
  }

  const alignedReference = String(result.alignedReference || '').toUpperCase();
  const alignedQuery = String(result.alignedQuery || '').toUpperCase();
  const columnCount = Math.min(alignedReference.length, alignedQuery.length);
  if (!columnCount) {
    return null;
  }

  const cells = Array.from({ length: referenceSequence.length }, () => null);
  const traceCells = [];
  const queryRecord = state?.activeAlignmentQueryRecord && typeof state.activeAlignmentQueryRecord === 'object'
    ? state.activeAlignmentQueryRecord
    : null;
  const displayTrace = queryRecord
    ? buildDisplayAlignmentTrace(queryRecord, result, { useProcessed: state?.traceUseProcessed !== false })
    : null;
  const allowWrap = Boolean(result.referenceSpan?.wraps);
  let referenceCursor = Math.max(0, Math.floor(Number(result.referenceSpan?.start) || 0));
  let queryCursor = 0;
  let filledCount = 0;

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const referenceBase = alignedReference[columnIndex] || '-';
    const queryBase = alignedQuery[columnIndex] || '-';
    if (referenceBase === '-') {
      if (queryBase !== '-') {
        queryCursor += 1;
      }
      continue;
    }

    const referenceIndex = normalizeTrackReferenceIndex(referenceCursor, referenceSequence.length, allowWrap);
    referenceCursor += 1;
    if (!Number.isFinite(referenceIndex)) {
      continue;
    }

    const displayBase = queryBase === '-' ? '-' : queryBase;
    const kind = queryBase === '-'
      ? 'deletion'
      : (referenceBase === queryBase ? 'match' : 'mismatch');
    cells[referenceIndex] = {
      base: displayBase,
      kind
    };
    if (queryBase !== '-' && displayTrace?.positions?.length) {
      traceCells.push({
        referenceIndex,
        queryIndex: queryCursor,
        position: displayTrace.positions[queryCursor],
        base: displayTrace.sequence?.[queryCursor] || queryBase,
        kind
      });
    }
    if (queryBase !== '-') {
      queryCursor += 1;
    }
    filledCount += 1;
  }

  if (!filledCount) {
    return null;
  }

  return {
    cells,
    traceLines: buildInlineTraceLines(displayTrace, traceCells, referenceSequence.length, {
      lineLength: options?.lineLength,
      charAdvancePx: options?.charAdvancePx
    }),
    name: cleanText(state.activeAlignmentSessionName || result.queryName, 140),
    orientation: cleanText(result.orientation, 40).toLowerCase() === 'reverse' ? 'reverse' : 'forward'
  };
}

export function getAlignmentSessionsForRecord(state, record) {
  const sessions = Array.isArray(state?.alignmentSessions) ? state.alignmentSessions : [];
  const referenceKey = buildSequenceSignature(record?.sequence || '', 'ref');
  if (!referenceKey) {
    return [];
  }
  const activeEntryId = cleanText(state?.activeEntryId, 200);
  return sessions.filter((session) => {
    const sessionReferenceKey = cleanText(session?.referenceRecordKey, 200);
    return !sessionReferenceKey
      || sessionReferenceKey === referenceKey
      || isStoredAlignmentSessionForActiveEntry(session, activeEntryId);
  });
}

function isStoredAlignmentSessionForActiveEntry(session, activeEntryId = '') {
  const entryId = cleanText(activeEntryId, 200);
  if (!entryId) {
    return false;
  }
  const sourceRelPath = cleanText(session?.storedSourceRelPath, 2000).replace(/\\/g, '/');
  const sourceAbsPath = cleanText(session?.storedSourcePath, 4000).replace(/\\/g, '/');
  const entryPathPattern = new RegExp(`(?:^|/)entries/${escapeRegExp(entryId)}/alignments(?:/|$)`);
  return entryPathPattern.test(sourceRelPath) || entryPathPattern.test(sourceAbsPath);
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function syncAlignmentControlsState({ elements = {}, state = {}, record = null } = {}) {
  const hasRecord = Boolean(record?.sequence?.length);
  const savedSessions = getAlignmentSessionsForRecord(state, record);
  const hasAppliedAlignment = Boolean(state.activeAlignmentResult && state.activeAlignmentQueryRecord);
  if (elements.alignmentSessionSelect) {
    if (!savedSessions.length) {
      elements.alignmentSessionSelect.innerHTML = '<option value="">No saved alignments</option>';
      elements.alignmentSessionSelect.value = '';
      elements.alignmentSessionSelect.disabled = true;
    } else {
      elements.alignmentSessionSelect.disabled = false;
      elements.alignmentSessionSelect.innerHTML = savedSessions
        .map((session) => {
          const sessionId = cleanText(session?.id, 200);
          const label = cleanText(session?.name || session?.queryRecord?.name || 'alignment', 120) || 'alignment';
          const selected = sessionId === String(state.activeAlignmentSessionId || '') ? ' selected' : '';
          return `<option value="${escapeHtml(sessionId)}"${selected}>${escapeHtml(label)}</option>`;
        })
        .join('');
      if (!savedSessions.some((session) => String(session?.id || '') === String(state.activeAlignmentSessionId || ''))) {
        elements.alignmentSessionSelect.value = cleanText(savedSessions[0]?.id, 200);
      }
    }
  }

  if (elements.alignmentToggle) {
    elements.alignmentToggle.checked = Boolean(state.alignmentViewEnabled && hasAppliedAlignment);
    elements.alignmentToggle.disabled = !hasRecord || !hasAppliedAlignment;
  }
  if (elements.alignmentActiveNote) {
    elements.alignmentActiveNote.textContent = hasAppliedAlignment
      ? ''
      : (savedSessions.length
        ? `${savedSessions.length.toLocaleString()} saved alignment${savedSessions.length === 1 ? '' : 's'} ready for this reference.`
        : 'No alignment selected.');
  }
  if (elements.alignmentActiveNote?.style) {
    elements.alignmentActiveNote.style.color = hasAppliedAlignment || savedSessions.length ? '' : 'var(--theme-text-muted)';
  }
}

export function getAlignmentHighlightSegments(state, record) {
  if (!state?.alignmentViewEnabled || !record?.sequence?.length) {
    return [];
  }

  const differences = Array.isArray(state?.activeAlignmentResult?.differences)
    ? state.activeAlignmentResult.differences
    : [];
  if (!differences.length) {
    return [];
  }

  return normalizeHighlightSegments(
    differences
      .filter((difference) => difference?.type === 'mismatch' || difference?.type === 'deletion')
      .map((difference) => ({
        start: Math.max(0, Number(difference?.referenceStart) || 0),
        end: Math.max(0, Number(difference?.referenceEnd) || 0),
        kind: 'alignment'
      })),
    record.sequence.length
  );
}
