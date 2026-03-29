import { escapeHtml } from '../tool-box/common.js';
import { normalizeHighlightSegments } from './rendering.js';
import { buildSequenceSignature, cleanText } from './shared.js';

export function getAlignmentSessionsForRecord(state, record) {
  const sessions = Array.isArray(state?.alignmentSessions) ? state.alignmentSessions : [];
  const referenceKey = buildSequenceSignature(record?.sequence || '', 'ref');
  if (!referenceKey) {
    return [];
  }
  return sessions.filter((session) => {
    const sessionReferenceKey = cleanText(session?.referenceRecordKey, 200);
    return !sessionReferenceKey || sessionReferenceKey === referenceKey;
  });
}

export function syncAlignmentControlsState({ elements = {}, state = {}, record = null } = {}) {
  const hasRecord = Boolean(record?.sequence?.length);
  const savedSessions = getAlignmentSessionsForRecord(state, record);
  const hasAppliedAlignment = Boolean(state.activeAlignmentResult && state.activeAlignmentQueryRecord);
  const activeSessionName = cleanText(
    state.activeAlignmentQueryRecord?.name
      || state.activeAlignmentSessionName
      || state.activeAlignmentResult?.queryName,
    120
  ) || '';

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
      ? `${activeSessionName || 'Alignment'} ready${state.alignmentViewEnabled ? ' | visible on reference' : ' | hidden on reference'}`
      : (savedSessions.length
        ? `${savedSessions.length.toLocaleString()} saved alignment${savedSessions.length === 1 ? '' : 's'} ready for this reference.`
        : 'No alignment selected.');
  }
  if (elements.alignmentActiveNote?.style) {
    elements.alignmentActiveNote.style.color = hasAppliedAlignment || savedSessions.length ? '' : 'var(--muted)';
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
