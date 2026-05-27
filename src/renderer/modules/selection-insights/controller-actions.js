import { getCurrentContext, getHostRegistration, requestInsightAnswer } from './controller-context.js';
import { refreshHost } from './controller-selection.js';
import { hideMenu, openPanelByInsightId } from './controller-ui.js';
import {
  buildCompletedAnswer,
  buildErroredAnswer,
  buildPendingAnswer,
  updateInsightAnswers
} from './insight-model.js';
import { persistInsightSidecar } from './storage.js';

async function persistForUpdatedRecord(ctx, hostKey, updatedRecord, insights) {
  const refreshedContext = getCurrentContext(ctx, hostKey);
  if (!updatedRecord || !refreshedContext) {
    return;
  }
  await persistInsightSidecar({
    api: ctx.api,
    context: {
      ...refreshedContext,
      record: updatedRecord
    },
    insights
  });
}

export async function runInsightAction(ctx, hostKey, selectionContext, actionType) {
  hideMenu(ctx);
  const registration = getHostRegistration(ctx, hostKey);
  if (!registration || !selectionContext) {
    return;
  }

  let context = getCurrentContext(ctx, hostKey);
  if (!context) {
    return;
  }

  if (typeof context.ensureRecord === 'function') {
    await context.ensureRecord();
    context = getCurrentContext(ctx, hostKey);
    if (!context) {
      return;
    }
  }

  const pendingResult = updateInsightAnswers(
    context.insights,
    selectionContext,
    actionType,
    () => buildPendingAnswer(actionType, new Date().toISOString()),
    ctx.createId
  );
  const updatedPendingRecord = context.updateRecord?.((record) => ({
    ...record,
    selectionInsights: pendingResult.insights
  })) || null;

  await persistForUpdatedRecord(ctx, hostKey, updatedPendingRecord, pendingResult.insights);
  refreshHost(ctx, hostKey);
  openPanelByInsightId(ctx, hostKey, pendingResult.insight.id, {
    pinned: true,
    fallbackRect: selectionContext.selectionRect
  });

  try {
    const response = await requestInsightAnswer(ctx, context, selectionContext, actionType);
    const completedResult = updateInsightAnswers(
      getCurrentContext(ctx, hostKey)?.insights || pendingResult.insights,
      {
        ...selectionContext,
        existingInsightId: pendingResult.insight.id
      },
      actionType,
      () => {
        const answer = buildCompletedAnswer(actionType, response);
        const pendingAnswer = pendingResult.insight.answers?.[actionType];
        if (pendingAnswer?.requestedAt) {
          answer.requestedAt = pendingAnswer.requestedAt;
        }
        return answer;
      },
      ctx.createId
    );
    const updatedRecord = getCurrentContext(ctx, hostKey)?.updateRecord?.((record) => ({
      ...record,
      selectionInsights: completedResult.insights
    })) || null;

    await persistForUpdatedRecord(ctx, hostKey, updatedRecord, completedResult.insights);
    refreshHost(ctx, hostKey);
    openPanelByInsightId(ctx, hostKey, completedResult.insight.id, {
      pinned: true,
      fallbackRect: selectionContext.selectionRect
    });
  } catch (error) {
    const errorMessage = String(error?.message || error);
    const erroredResult = updateInsightAnswers(
      getCurrentContext(ctx, hostKey)?.insights || pendingResult.insights,
      {
        ...selectionContext,
        existingInsightId: pendingResult.insight.id
      },
      actionType,
      (pendingAnswer) => buildErroredAnswer(actionType, errorMessage, pendingAnswer),
      ctx.createId
    );
    const updatedRecord = getCurrentContext(ctx, hostKey)?.updateRecord?.((record) => ({
      ...record,
      selectionInsights: erroredResult.insights
    })) || null;

    await persistForUpdatedRecord(ctx, hostKey, updatedRecord, erroredResult.insights);
    refreshHost(ctx, hostKey);
    openPanelByInsightId(ctx, hostKey, erroredResult.insight.id, {
      pinned: true,
      fallbackRect: selectionContext.selectionRect
    });
  }
}
