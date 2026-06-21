import { buildStateSnapshot } from '../agent-chat/state-snapshot.js';
import { normalizeAgentResponse } from '../agent-chat-response.js';
import { normalizeInsights } from './insight-model.js';
import { createSelectionInsightPrompt } from './prompt.js';
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

export async function buildAgentSnapshot(ctx, projectId) {
  let syncResult = null;
  const storagePath = cleanText(ctx.state?.settings?.storagePath, 1200);
  if (ctx.api?.autoSaveDataFile && storagePath) {
    syncResult = await ctx.api.autoSaveDataFile(ctx.state, '');
    if (!syncResult?.ok) {
      throw new Error(syncResult?.error || 'Failed to sync state before running the answer request.');
    }
  }
  const snapshot = buildStateSnapshot(ctx.state, cleanText(projectId, 120));
  if (!snapshot.data_file_path) {
    snapshot.data_file_path = cleanText(syncResult?.filePath, 1600);
  }
  return snapshot;
}

export async function requestInsightAnswer(ctx, context, selectionContext, actionType) {
  if (!ctx.api?.agentChat) {
    throw new Error('Agent IPC is unavailable in this build.');
  }
  const stateSnapshot = await buildAgentSnapshot(ctx, context?.projectId);
  const message = createSelectionInsightPrompt({
    actionType,
    selectedText: selectionContext.selectedText,
    segmentText: selectionContext.segmentText,
    context: {
      ...context,
      segmentLabel: selectionContext.segmentLabel
    }
  });
  const result = await ctx.api.agentChat({
    clientRequestId: `selection-insight-${cleanText(ctx.createId?.(), 120) || Date.now().toString(36)}`,
    message,
    attachments: [],
    chatSessionId: '',
    projectId: cleanText(context?.projectId, 120),
    projectName: cleanText(context?.projectName || context?.record?.projectName, 220),
    conversation: [],
    stateSnapshot,
    llm: {
      provider: cleanText(ctx.state?.settings?.llm?.provider, 80),
      model: cleanText(ctx.state?.settings?.llm?.model, 160),
      reasoningEffort: cleanText(ctx.state?.settings?.llm?.reasoningEffort, 40).toLowerCase(),
      apiEndpoint: cleanText(ctx.state?.settings?.llm?.provider, 80) === 'codex'
        ? ''
        : cleanText(ctx.state?.settings?.llm?.apiEndpoint, 1200),
      apiKey: cleanText(ctx.state?.settings?.llm?.provider, 80) === 'codex'
        ? ''
        : cleanText(ctx.state?.settings?.llm?.apiKey, 4000)
    },
    agent: {
      developerMode: ctx.state?.settings?.agent?.developerMode === true,
      externalSkillsEnabled: ctx.state?.settings?.agent?.externalSkillsEnabled !== false,
      disabledExternalSkillNames: Array.isArray(ctx.state?.settings?.agent?.disabledExternalSkillNames)
        ? ctx.state.settings.agent.disabledExternalSkillNames.map((item) => cleanText(item, 160)).filter(Boolean)
        : [],
      selectionInsight: {
        actionType,
        selectedText: selectionContext.selectedText,
        contextText: selectionContext.segmentText,
        segmentLabel: selectionContext.segmentLabel,
        recordName: cleanText(
          context?.record?.name
            || context?.record?.protocolName
            || context?.label,
          220
        ),
        projectName: cleanText(
          context?.projectName
            || context?.record?.projectName,
          220
        )
      }
    }
  });
  if (!result?.ok) {
    throw new Error(result?.error || 'The selection insight request failed.');
  }
  return normalizeAgentResponse(result);
}
