'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function addEvidencePack({
  pack,
  stage,
  stageMessage,
  confidence,
  traceTool,
  traceArgs,
  buildAssumptions,
  intermediateStates,
  toolTrace,
  evidence,
  buildIntermediateState,
  cleanText
}) {
  if (!pack) {
    return;
  }
  const assumptions = typeof buildAssumptions === 'function'
    ? asArray(buildAssumptions(pack))
    : [];
  intermediateStates.push(buildIntermediateState(stage, stageMessage, {
    assumptions,
    evidence: asArray(pack.citations).slice(0, 10),
    confidence
  }));
  toolTrace.push({
    tool: traceTool,
    args: traceArgs && typeof traceArgs === 'object' ? traceArgs : {},
    summary: cleanText(assumptions.join(' '), 240)
  });
  evidence.push(...asArray(pack.citations));
}

function applyFinalResponseLayerAndValidation({
  normalized,
  requiresApproval,
  notebookDraft,
  buildNotebookDraftSummary,
  cleanText,
  routing,
  toolTrace,
  intermediateStates,
  buildIntermediateState,
  buildResponseLayerAssumptionRows,
  applyResponseLayerToOutput,
  applyValidationGateToOutput,
  buildValidationAssumptionRows,
  buildProvenanceAssumptionRows,
  recordLifecycleEvent,
  lifecycleRecorder,
  handoffWriteAssumption
}) {
  let nextNormalized = normalized && typeof normalized === 'object'
    ? { ...normalized }
    : {};

  if (requiresApproval && asArray(nextNormalized.proposedWriteActions).length === 0) {
    nextNormalized.proposedWriteActions = [
      {
        tool_name: 'write_operation_pending_approval',
        reason: 'User intent appears write-oriented; explicit approval is required before execution.'
      }
    ];
  }
  if (requiresApproval) {
    nextNormalized.requiresApproval = true;
  }
  if (notebookDraft) {
    const summary = typeof buildNotebookDraftSummary === 'function'
      ? buildNotebookDraftSummary(notebookDraft)
      : '';
    if (summary) {
      nextNormalized.answer = cleanText(`${nextNormalized.answer}\n\n${summary}`, 12000);
    }
  }

  nextNormalized = applyResponseLayerToOutput({
    normalized: nextNormalized,
    routing,
    notebookDraft,
    toolTrace
  });

  intermediateStates.push(buildIntermediateState('synthesize', 'Generated final user-facing response with decision record.', {
    evidence: asArray(nextNormalized.citations),
    proposedActions: asArray(nextNormalized.proposedWriteActions).map((action) => ({
      action_type: 'write',
      tool_name: action?.tool_name,
      risk_level: 'high',
      reason: action?.reason
    })),
    confidence: nextNormalized.confidence
  }));
  intermediateStates.push(buildIntermediateState('response_layer', 'Applied deterministic response-layer templates and provenance metadata.', {
    assumptions: buildResponseLayerAssumptionRows(nextNormalized),
    confidence: nextNormalized.confidence
  }));

  const validationGate = applyValidationGateToOutput({
    routing,
    normalized: nextNormalized,
    notebookDraft,
    toolTrace
  });
  const validatedRouting = validationGate.routing;
  const validatedNormalized = validationGate.normalized;

  intermediateStates.push(buildIntermediateState('validation', 'Ran deterministic validation and safety gate.', {
    assumptions: [
      ...buildValidationAssumptionRows(validationGate.validation),
      ...buildProvenanceAssumptionRows(validationGate.provenance)
    ],
    openQuestions: validationGate.validation.forced_clarification
      ? [cleanText(validatedRouting.plan?.clarification_question, 320) || 'Validation requested clarification.']
      : [],
    confidence: validatedNormalized.confidence
  }));

  if (typeof recordLifecycleEvent === 'function') {
    recordLifecycleEvent(lifecycleRecorder, {
      stage: 'validation_completed',
      status: validationGate.validation.passed ? 'ok' : 'failed',
      routing_intent: validatedRouting.intent,
      response_type: validatedNormalized.response_type,
      failure_reasons: validationGate.validation.failure_reasons,
      message: buildValidationAssumptionRows(validationGate.validation).join(' ')
    });
  }

  intermediateStates.push(buildIntermediateState('handoff', 'Prepared response for UI handoff and audit trail.', {
    assumptions: [
      handoffWriteAssumption || 'Any write action remains pending explicit approval.',
      ...buildResponseLayerAssumptionRows(validatedNormalized),
      ...buildValidationAssumptionRows(validationGate.validation)
    ],
    confidence: validatedNormalized.confidence
  }));

  return {
    normalized: validatedNormalized,
    routing: validatedRouting,
    validation: validationGate.validation,
    provenance: validationGate.provenance
  };
}

module.exports = {
  addEvidencePack,
  applyFinalResponseLayerAndValidation
};
