import { requestDirectLlm } from '../../services/direct-llm.js';
import { ACTION_WHERE_TO_BUY } from './constants.js';
import { normalizeInsights } from './insight-model.js';
import {
  SELECTION_INSIGHT_SYSTEM_PROMPT,
  WHERE_TO_BUY_SCHEMA,
  createSelectionInsightPrompt
} from './prompt.js';
import { cleanText } from './text-utils.js';

export function getHostRegistration(ctx, hostKey) {
  return ctx.hosts.get(hostKey) || null;
}

export function getCurrentContext(ctx, hostKey) {
  const registration = getHostRegistration(ctx, hostKey);
  if (!registration || typeof registration.getContext !== 'function') {
    return null;
  }
  const context = registration.getContext();
  if (!context || typeof context !== 'object') {
    return null;
  }
  const record = context.record && typeof context.record === 'object' ? context.record : null;
  if (!record) {
    return null;
  }
  return {
    ...context,
    record,
    label: cleanText(context.label || record.name || record.protocolName, 220),
    insights: normalizeInsights(context.insights || record.selectionInsights)
  };
}

// One-shot direct LLM task (same path as page naming / note clarify), not a
// chat turn: no chat session is created and no state snapshot is synced.
export function requestInsightAnswer(ctx, context, selectionContext, actionType) {
  const isPurchase = actionType === ACTION_WHERE_TO_BUY;
  return requestDirectLlm({
    llm: ctx.state?.settings?.llm,
    moduleId: 'selection-insights',
    task: isPurchase ? 'where-to-buy' : 'what-is-it',
    systemPrompt: SELECTION_INSIGHT_SYSTEM_PROMPT,
    prompt: createSelectionInsightPrompt({
      actionType,
      selectedText: selectionContext.selectedText,
      segmentText: selectionContext.segmentText,
      context: {
        ...context,
        segmentLabel: selectionContext.segmentLabel
      }
    }),
    ...(isPurchase ? { expectJson: true, schema: WHERE_TO_BUY_SCHEMA } : {})
  });
}
