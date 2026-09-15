import { getCurrentContext, getHostRegistration, requestInsightAnswer } from './controller-context.js';
import { refreshHost } from './controller-selection.js';
import { hideMenu, openPanelByInsightId } from './controller-ui.js';
import {
  buildCompletedAnswer,
  buildErroredAnswer,
  buildPendingAnswer,
  findInsightForSelection,
  updateInsightAnswers
} from './insight-model.js';
import { persistInsightSidecar } from './storage.js';

async function persistForUpdatedRecord(ctx, context, updatedRecord, insights) {
  if (!updatedRecord) {
    return;
  }
  await persistInsightSidecar({
    api: ctx.api,
    context: {
      ...context,
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

  // Answers are saved per selection, so re-running the action on a selection
  // that already has one just reopens it instead of paying for the model again.
  const savedInsight = findInsightForSelection(context.insights, selectionContext);
  if (savedInsight?.answers?.[actionType]?.status === 'completed') {
    openPanelByInsightId(ctx, hostKey, savedInsight.id, {
      pinned: true,
      fallbackRect: selectionContext.selectionRect
    });
    return;
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

  await persistForUpdatedRecord(ctx, context, updatedPendingRecord, pendingResult.insights);
  refreshHost(ctx, hostKey);
  openPanelByInsightId(ctx, hostKey, pendingResult.insight.id, {
    pinned: true,
    fallbackRect: selectionContext.selectionRect
  });

  try {
    const response = await requestInsightAnswer(ctx, context, selectionContext, actionType);
    const updatedRecord = context.updateRecord?.((record) => {
      const completedResult = updateInsightAnswers(
        record.selectionInsights,
        { ...selectionContext, existingInsightId: pendingResult.insight.id },
        actionType,
        () => {
          const answer = buildCompletedAnswer(actionType, response);
          answer.requestedAt = pendingResult.insight.answers?.[actionType]?.requestedAt || '';
          return answer;
        },
        ctx.createId
      );
      return { ...record, selectionInsights: completedResult.insights };
    }) || null;

    await persistForUpdatedRecord(ctx, context, updatedRecord, updatedRecord?.selectionInsights);
    if (getCurrentContext(ctx, hostKey)?.record?.id !== context.record.id) {
      return;
    }
    refreshHost(ctx, hostKey);
    openPanelByInsightId(ctx, hostKey, pendingResult.insight.id, {
      pinned: true,
      fallbackRect: selectionContext.selectionRect
    });
  } catch (error) {
    const errorMessage = String(error?.message || error);
    const updatedRecord = context.updateRecord?.((record) => {
      const erroredResult = updateInsightAnswers(
        record.selectionInsights,
        { ...selectionContext, existingInsightId: pendingResult.insight.id },
        actionType,
        (pendingAnswer) => buildErroredAnswer(actionType, errorMessage, pendingAnswer),
        ctx.createId
      );
      return { ...record, selectionInsights: erroredResult.insights };
    }) || null;

    await persistForUpdatedRecord(ctx, context, updatedRecord, updatedRecord?.selectionInsights);
    if (getCurrentContext(ctx, hostKey)?.record?.id !== context.record.id) {
      return;
    }
    refreshHost(ctx, hostKey);
    openPanelByInsightId(ctx, hostKey, pendingResult.insight.id, {
      pinned: true,
      fallbackRect: selectionContext.selectionRect
    });
  }
}
