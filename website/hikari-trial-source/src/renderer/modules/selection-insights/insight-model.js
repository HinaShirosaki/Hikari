import { ACTION_WHAT_IS_IT, ACTION_WHERE_TO_BUY } from './constants.js';
import { asArray, cleanText, cloneJson } from './text-utils.js';

export function normalizeInsightAnswers(source) {
  const payload = source && typeof source === 'object' ? source : {};
  return {
    [ACTION_WHAT_IS_IT]: payload[ACTION_WHAT_IS_IT] && typeof payload[ACTION_WHAT_IS_IT] === 'object'
      ? cloneJson(payload[ACTION_WHAT_IS_IT], {})
      : null,
    [ACTION_WHERE_TO_BUY]: payload[ACTION_WHERE_TO_BUY] && typeof payload[ACTION_WHERE_TO_BUY] === 'object'
      ? cloneJson(payload[ACTION_WHERE_TO_BUY], {})
      : null
  };
}

export function normalizeInsightRecord(rawInsight) {
  const source = rawInsight && typeof rawInsight === 'object' ? rawInsight : {};
  const id = cleanText(source.id, 120);
  const segmentId = cleanText(source.segmentId, 240);
  const selectedText = cleanText(source.selectedText, 500);
  if (!id || !segmentId || !selectedText) {
    return null;
  }
  return {
    id,
    segmentId,
    segmentLabel: cleanText(source.segmentLabel, 160),
    selectedText,
    occurrenceIndex: Math.max(1, Number(source.occurrenceIndex) || 1),
    contextText: cleanText(source.contextText, 4000),
    createdAt: cleanText(source.createdAt, 80),
    updatedAt: cleanText(source.updatedAt, 80),
    answers: normalizeInsightAnswers(source.answers)
  };
}

export function normalizeInsights(insights) {
  return asArray(insights)
    .map((item) => normalizeInsightRecord(item))
    .filter(Boolean);
}

export function buildPendingAnswer(actionType, nowIso) {
  return {
    actionType,
    status: 'pending',
    requestedAt: nowIso,
    answeredAt: '',
    text: '',
    summary: '',
    payload: null,
    error: ''
  };
}

export function buildCompletedAnswer(actionType, response) {
  const isPurchase = actionType === ACTION_WHERE_TO_BUY;
  const payload = response?.payload && typeof response.payload === 'object' ? response.payload : null;
  return {
    actionType,
    status: 'completed',
    requestedAt: '',
    answeredAt: new Date().toISOString(),
    text: isPurchase ? '' : cleanText(response?.text, 12000),
    summary: isPurchase ? cleanText(payload?.summary, 12000) : '',
    payload: isPurchase ? cloneJson(payload, null) : null,
    error: ''
  };
}

export function buildErroredAnswer(actionType, errorMessage, pendingAnswer = null) {
  return {
    actionType,
    status: 'error',
    requestedAt: cleanText(pendingAnswer?.requestedAt, 80),
    answeredAt: new Date().toISOString(),
    text: '',
    summary: '',
    payload: null,
    error: cleanText(errorMessage, 1200) || 'The answer could not be generated.'
  };
}

// A selection is identified by segment + selected text + which occurrence of
// that text inside the segment (1-based), so "Tris" twice in one step keeps
// two separate insights.
export function findInsightForSelection(insights, selectionContext) {
  const records = normalizeInsights(insights);
  if (selectionContext?.existingInsightId) {
    return records.find((item) => item.id === selectionContext.existingInsightId) || null;
  }
  return records.find((item) => (
    item.segmentId === selectionContext?.segmentId
    && item.selectedText === selectionContext?.selectedText
    && Math.max(1, Number(item.occurrenceIndex) || 1) === Math.max(1, Number(selectionContext?.occurrenceIndex) || 1)
  )) || null;
}

export function updateInsightAnswers(insights, selectionContext, actionType, answerUpdater, createId) {
  const nextInsights = normalizeInsights(insights);
  const existingInsight = findInsightForSelection(nextInsights, selectionContext);

  const nowIso = new Date().toISOString();
  const nextInsight = existingInsight
    ? {
      ...existingInsight,
      segmentId: selectionContext.segmentId,
      segmentLabel: selectionContext.segmentLabel,
      selectedText: selectionContext.selectedText,
      occurrenceIndex: Math.max(1, Number(selectionContext.occurrenceIndex) || 1),
      contextText: selectionContext.segmentText,
      updatedAt: nowIso,
      answers: normalizeInsightAnswers(existingInsight.answers)
    }
    : {
      id: cleanText(createId?.(), 120) || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      segmentId: selectionContext.segmentId,
      segmentLabel: selectionContext.segmentLabel,
      selectedText: selectionContext.selectedText,
      occurrenceIndex: Math.max(1, Number(selectionContext.occurrenceIndex) || 1),
      contextText: selectionContext.segmentText,
      createdAt: nowIso,
      updatedAt: nowIso,
      answers: normalizeInsightAnswers({})
    };

  const currentAnswer = nextInsight.answers?.[actionType] && typeof nextInsight.answers[actionType] === 'object'
    ? cloneJson(nextInsight.answers[actionType], {})
    : null;
  nextInsight.answers[actionType] = answerUpdater(currentAnswer);

  const existingIndex = nextInsights.findIndex((item) => item.id === nextInsight.id);
  if (existingIndex >= 0) {
    nextInsights[existingIndex] = nextInsight;
  } else {
    nextInsights.push(nextInsight);
  }

  return {
    insights: nextInsights,
    insight: nextInsight
  };
}
