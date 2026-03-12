'use strict';

function createAgentWorkflowHelpers(deps = {}) {
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, maxLength = 2000) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      if (text.length <= maxLength) {
        return text;
      }
      return `${text.slice(0, maxLength)}...`;
    });
  const asArray = typeof deps.asArray === 'function'
    ? deps.asArray
    : ((value) => (Array.isArray(value) ? value : []));
  const clamp = typeof deps.clamp === 'function'
    ? deps.clamp
    : ((number, min, max) => Math.max(min, Math.min(max, number)));
  const routingIntents = Array.isArray(deps.routingIntents)
    ? deps.routingIntents.map((item) => cleanText(item, 80)).filter(Boolean)
    : [];
  const buildNotebookDraft = typeof deps.buildNotebookDraft === 'function'
    ? deps.buildNotebookDraft
    : (() => null);

  function normalizeRoutingPayload(rawRouting) {
    const source = rawRouting && typeof rawRouting === 'object' ? rawRouting : {};
    const entities = source.entities && typeof source.entities === 'object' ? source.entities : {};
    const plan = source.plan && typeof source.plan === 'object' ? source.plan : {};
    const classifier = source.classifier && typeof source.classifier === 'object' ? source.classifier : {};
    const selectedToolNames = asArray(plan.selected_tool_names).map((item) => cleanText(item, 120)).filter(Boolean);
    const toolSelectionRationale = asArray(plan.tool_selection_rationale).map((row) => ({
      tool: cleanText(row?.tool, 120),
      score: Number.isFinite(Number(row?.score)) ? Number(row.score) : 0,
      entityScore: Number.isFinite(Number(row?.entityScore)) ? Number(row.entityScore) : 0,
      taskScore: Number.isFinite(Number(row?.taskScore)) ? Number(row.taskScore) : 0,
      exactnessScore: Number.isFinite(Number(row?.exactnessScore)) ? Number(row.exactnessScore) : 0,
      reason: cleanText(row?.reason, 220)
    })).filter((row) => row.tool);
    const protocolMatch = plan.protocol_match && typeof plan.protocol_match === 'object' ? plan.protocol_match : {};
    const protocolCandidates = asArray(plan.protocol_candidates).map((row) => ({
      protocol_id: cleanText(row?.protocol_id, 80),
      protocol_name: cleanText(row?.protocol_name, 220),
      category: cleanText(row?.category, 80),
      score: Number.isFinite(Number(row?.score)) ? Number(row.score) : 0,
      semantic_score: Number.isFinite(Number(row?.semantic_score)) ? Number(row.semantic_score) : 0,
      entity_overlap_score: Number.isFinite(Number(row?.entity_overlap_score)) ? Number(row.entity_overlap_score) : 0,
      project_relevance_score: Number.isFinite(Number(row?.project_relevance_score)) ? Number(row.project_relevance_score) : 0,
      recent_workflow_relevance_score: Number.isFinite(Number(row?.recent_workflow_relevance_score))
        ? Number(row.recent_workflow_relevance_score)
        : 0,
      reason: cleanText(row?.reason, 220),
      steps: asArray(row?.steps).map((step) => cleanText(step, 220)).filter(Boolean).slice(0, 8)
    })).filter((row) => row.protocol_name);

    return {
      intent: routingIntents.includes(cleanText(source.intent, 80)) ? cleanText(source.intent, 80) : 'general_science_question',
      confidence: Number.isFinite(Number(source.confidence))
        ? clamp(Number(source.confidence), 0, 1)
        : 0.5,
      entities: {
        activity: cleanText(entities.activity, 180),
        project: cleanText(entities.project, 180),
        protein: cleanText(entities.protein, 100),
        compound: cleanText(entities.compound, 120),
        protocol: cleanText(entities.protocol, 220),
        cell_line: cleanText(entities.cell_line, 80),
        paper_title: cleanText(entities.paper_title, 220),
        workflow_step: cleanText(entities.workflow_step, 180)
      },
      plan: {
        needs_tools: plan.needs_tools === true,
        needs_protocol_search: plan.needs_protocol_search === true,
        needs_notebook_retrieval: plan.needs_notebook_retrieval === true,
        needs_notebook_generation: plan.needs_notebook_generation === true,
        notebook_autosave: plan.notebook_autosave === true,
        needs_pdf_reading: plan.needs_pdf_reading === true,
        needs_python: plan.needs_python === true,
        needs_web_search: plan.needs_web_search === true,
        needs_clarification: plan.needs_clarification === true,
        clarification_reason: cleanText(plan.clarification_reason, 260),
        clarification_question: cleanText(plan.clarification_question, 320),
        selected_tool_names: selectedToolNames,
        tool_selection_rationale: toolSelectionRationale,
        protocol_match: {
          selected_protocol_id: cleanText(protocolMatch.selected_protocol_id, 80),
          selected_protocol_name: cleanText(protocolMatch.selected_protocol_name, 220),
          top_score: Number.isFinite(Number(protocolMatch.top_score)) ? Number(protocolMatch.top_score) : 0,
          score_delta: Number.isFinite(Number(protocolMatch.score_delta)) ? Number(protocolMatch.score_delta) : 0,
          needs_clarification: protocolMatch.needs_clarification === true,
          ambiguity_reason: cleanText(protocolMatch.ambiguity_reason, 220)
        },
        protocol_candidates: protocolCandidates
      },
      classifier: {
        source: cleanText(classifier.source, 80) || 'rules',
        fallbackAttempted: classifier.fallbackAttempted === true,
        fallbackUsed: classifier.fallbackUsed === true,
        lowConfidence: classifier.lowConfidence === true,
        tieDetected: classifier.tieDetected === true,
        ruleReason: cleanText(classifier.ruleReason, 260),
        fallbackError: cleanText(classifier.fallbackError, 260),
        ruleScores: classifier.ruleScores && typeof classifier.ruleScores === 'object'
          ? classifier.ruleScores
          : {}
      }
    };
  }

  function buildRoutingAssumptionRows(routing) {
    const normalized = normalizeRoutingPayload(routing);
    const rows = [
      `Routing intent=${normalized.intent} confidence=${normalized.confidence.toFixed(2)} source=${normalized.classifier.source}.`,
      `Planner flags tools=${normalized.plan.needs_tools} protocol_search=${normalized.plan.needs_protocol_search} notebook_retrieval=${normalized.plan.needs_notebook_retrieval} notebook_generation=${normalized.plan.needs_notebook_generation} notebook_autosave=${normalized.plan.notebook_autosave} pdf=${normalized.plan.needs_pdf_reading} python=${normalized.plan.needs_python} web=${normalized.plan.needs_web_search} clarification=${normalized.plan.needs_clarification}.`
    ];
    if (normalized.plan.selected_tool_names.length) {
      rows.push(`Planner selected tools: ${normalized.plan.selected_tool_names.join(', ')}.`);
    }
    if (asArray(normalized.plan.tool_selection_rationale).length) {
      const top = normalized.plan.tool_selection_rationale[0];
      rows.push(`Tool selector top candidate: ${top.tool} score=${top.score} (${top.reason || 'no reason'}).`);
    }
    if (normalized.plan.protocol_match.selected_protocol_name) {
      rows.push(
        `Protocol matcher selected "${normalized.plan.protocol_match.selected_protocol_name}" `
        + `(score=${normalized.plan.protocol_match.top_score.toFixed(2)}).`
      );
    }
    if (normalized.plan.protocol_match.needs_clarification) {
      rows.push(
        `Protocol matcher requested clarification (${normalized.plan.protocol_match.ambiguity_reason || 'ambiguous'}; `
        + `delta=${normalized.plan.protocol_match.score_delta.toFixed(2)}).`
      );
    }
    if (asArray(normalized.plan.protocol_candidates).length) {
      const topCandidate = normalized.plan.protocol_candidates[0];
      rows.push(
        `Protocol candidate top-1: ${topCandidate.protocol_name} `
        + `score=${topCandidate.score.toFixed(2)} semantic=${topCandidate.semantic_score.toFixed(2)}.`
      );
    }
    if (normalized.classifier.fallbackAttempted) {
      rows.push(normalized.classifier.fallbackUsed
        ? 'Routing fallback completed successfully.'
        : `Routing fallback attempted but not used${normalized.classifier.fallbackError ? `: ${normalized.classifier.fallbackError}` : '.'}`);
    }
    return rows;
  }

  function normalizeNotebookDraftPayload(rawDraft) {
    if (!rawDraft || typeof rawDraft !== 'object') {
      return null;
    }
    const placeholderValues = asArray(rawDraft.placeholder_values).map((item) => ({
      step_id: cleanText(item?.step_id, 120),
      placeholder_id: cleanText(item?.placeholder_id, 120),
      placeholder_key: cleanText(item?.placeholder_key, 120),
      display: cleanText(item?.display, 120),
      value: cleanText(item?.value, 220),
      source: cleanText(item?.source, 120),
      source_type: cleanText(item?.source_type, 80)
    })).filter((item) => item.step_id && item.placeholder_id && item.value);

    const unresolvedPlaceholders = asArray(rawDraft.unresolved_placeholders).map((item) => ({
      step_id: cleanText(item?.step_id, 120),
      placeholder_id: cleanText(item?.placeholder_id, 120),
      placeholder_key: cleanText(item?.placeholder_key, 120),
      display: cleanText(item?.display, 120),
      reason: cleanText(item?.reason, 120)
    })).filter((item) => item.step_id && item.placeholder_id);

    const entryTemplate = rawDraft.entry_template && typeof rawDraft.entry_template === 'object'
      ? rawDraft.entry_template
      : {};
    const entryValues = entryTemplate.values && typeof entryTemplate.values === 'object'
      ? entryTemplate.values
      : {};

    return {
      protocol: {
        id: cleanText(rawDraft?.protocol?.id, 120),
        name: cleanText(rawDraft?.protocol?.name, 220)
      },
      project: {
        id: cleanText(rawDraft?.project?.id, 80),
        name: cleanText(rawDraft?.project?.name, 180),
        resolution_source: cleanText(rawDraft?.project?.resolution_source, 80)
      },
      notebook_type: cleanText(rawDraft?.notebook_type, 40) || 'biology',
      rendered_steps: asArray(rawDraft.rendered_steps).map((step) => cleanText(step, 320)).filter(Boolean).slice(0, 80),
      placeholder_values: placeholderValues,
      unresolved_placeholders: unresolvedPlaceholders,
      save: {
        mode: cleanText(rawDraft?.save?.mode, 80) || 'auto_save_draft',
        applied: rawDraft?.save?.applied === true,
        status: cleanText(rawDraft?.save?.status, 120),
        reason: cleanText(rawDraft?.save?.reason, 260)
      },
      entry_template: {
        notebookType: cleanText(entryTemplate.notebookType, 40) || 'biology',
        projectId: cleanText(entryTemplate.projectId, 80),
        projectName: cleanText(entryTemplate.projectName, 180),
        protocolId: cleanText(entryTemplate.protocolId, 120),
        protocolName: cleanText(entryTemplate.protocolName, 220),
        values: entryValues && typeof entryValues === 'object' ? entryValues : {},
        result: cleanText(entryTemplate.result, 900),
        updatedAt: cleanText(entryTemplate.updatedAt, 80),
        resultFiles: asArray(entryTemplate.resultFiles).map((value) => cleanText(value, 260)).filter(Boolean),
        resultFileRecords: asArray(entryTemplate.resultFileRecords),
        agentDraftStatus: cleanText(entryTemplate.agentDraftStatus, 80),
        agentDraftMeta: entryTemplate.agentDraftMeta && typeof entryTemplate.agentDraftMeta === 'object'
          ? entryTemplate.agentDraftMeta
          : {}
      }
    };
  }

  function buildNotebookDraftAssumptionRows(notebookDraft) {
    const draft = normalizeNotebookDraftPayload(notebookDraft);
    if (!draft) {
      return [];
    }
    const unresolved = asArray(draft.unresolved_placeholders).length;
    const rows = [
      `Notebook draft protocol=${draft.protocol.name || '-'} project=${draft.project.name || '-'} source=${draft.project.resolution_source || '-'}.`,
      `Notebook draft placeholders filled=${draft.placeholder_values.length} unresolved=${unresolved} save_mode=${draft.save.mode} save_status=${draft.save.status || 'pending'}.`
    ];
    if (asArray(draft.rendered_steps).length) {
      rows.push(`Notebook draft step preview: ${draft.rendered_steps[0]}`);
    }
    return rows;
  }

  function maybeBuildNotebookDraft({
    message,
    conversation,
    routing,
    snapshot,
    projectId = '',
    projectName = '',
    toolResults = []
  }) {
    const draft = buildNotebookDraft({
      message,
      conversation,
      routing,
      snapshot,
      selectedProjectId: projectId,
      selectedProjectName: projectName,
      toolResults
    });
    return normalizeNotebookDraftPayload(draft);
  }

  return {
    normalizeRoutingPayload,
    buildRoutingAssumptionRows,
    normalizeNotebookDraftPayload,
    buildNotebookDraftAssumptionRows,
    maybeBuildNotebookDraft
  };
}

module.exports = {
  createAgentWorkflowHelpers
};
