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
    const webQueries = asArray(plan.web_queries).map((item) => cleanText(item, 260)).filter(Boolean);
    const webSources = asArray(plan.web_sources).map((row) => ({
      title: cleanText(row?.title, 320),
      url: cleanText(row?.url, 1200),
      source_domain: cleanText(row?.source_domain, 160),
      source_lane: cleanText(row?.source_lane, 60),
      source_tool: cleanText(row?.source_tool, 120),
      published_at: cleanText(row?.published_at, 80),
      score: Number.isFinite(Number(row?.score)) ? Number(row.score) : 0
    })).filter((row) => row.title || row.url);
    const inventorySearch = plan.inventory_search && typeof plan.inventory_search === 'object'
      ? plan.inventory_search
      : {};
    const protocolMatch = plan.protocol_match && typeof plan.protocol_match === 'object' ? plan.protocol_match : {};
    const projectMatch = plan.project_match && typeof plan.project_match === 'object' ? plan.project_match : {};
    const paperMatch = plan.paper_match && typeof plan.paper_match === 'object' ? plan.paper_match : {};
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
    const projectCandidates = asArray(plan.project_candidates).map((row) => ({
      project_id: cleanText(row?.project_id, 80),
      project_name: cleanText(row?.project_name, 220),
      score: Number.isFinite(Number(row?.score)) ? Number(row.score) : 0,
      exact_name_score: Number.isFinite(Number(row?.exact_name_score)) ? Number(row.exact_name_score) : 0,
      partial_name_score: Number.isFinite(Number(row?.partial_name_score)) ? Number(row.partial_name_score) : 0,
      selected_bias_score: Number.isFinite(Number(row?.selected_bias_score)) ? Number(row.selected_bias_score) : 0,
      linked_record_support_score: Number.isFinite(Number(row?.linked_record_support_score))
        ? Number(row.linked_record_support_score)
        : 0,
      reason: cleanText(row?.reason, 220)
    })).filter((row) => row.project_id || row.project_name);
    const paperCandidates = asArray(plan.paper_candidates).map((row) => ({
      paper_id: cleanText(row?.paper_id, 80),
      paper_title: cleanText(row?.paper_title, 320),
      linked_project_name: cleanText(row?.linked_project_name, 220),
      score: Number.isFinite(Number(row?.score)) ? Number(row.score) : 0,
      semantic_score: Number.isFinite(Number(row?.semantic_score)) ? Number(row.semantic_score) : 0,
      title_score: Number.isFinite(Number(row?.title_score)) ? Number(row.title_score) : 0,
      entity_overlap_score: Number.isFinite(Number(row?.entity_overlap_score))
        ? Number(row.entity_overlap_score)
        : 0,
      project_relevance_score: Number.isFinite(Number(row?.project_relevance_score))
        ? Number(row.project_relevance_score)
        : 0,
      availability_status: cleanText(row?.availability_status, 80),
      deep_read_ready: row?.deep_read_ready === true,
      has_uploaded_pdf: row?.has_uploaded_pdf === true,
      reason: cleanText(row?.reason, 220)
    })).filter((row) => row.paper_id || row.paper_title);

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
        needs_project_retrieval: plan.needs_project_retrieval === true,
        needs_workflow_retrieval: plan.needs_workflow_retrieval === true,
        needs_paper_retrieval: plan.needs_paper_retrieval === true,
        needs_deep_paper_reading: plan.needs_deep_paper_reading === true,
        needs_paper_comparison: plan.needs_paper_comparison === true,
        needs_notebook_generation: plan.needs_notebook_generation === true,
        notebook_autosave: plan.notebook_autosave === true,
        needs_pdf_reading: plan.needs_pdf_reading === true,
        needs_python: plan.needs_python === true,
        needs_web_search: plan.needs_web_search === true,
        python_task_type: cleanText(plan.python_task_type, 80),
        python_ready: plan.python_ready === true,
        python_needs_clarification: plan.python_needs_clarification === true,
        python_artifact_count: Number.isFinite(Number(plan.python_artifact_count))
          ? Number(plan.python_artifact_count)
          : 0,
        python_codegen_status: cleanText(plan.python_codegen_status, 80),
        python_codegen_reason: cleanText(plan.python_codegen_reason, 180),
        web_fallback_triggered: plan.web_fallback_triggered === true,
        web_fallback_reason: cleanText(plan.web_fallback_reason, 180),
        web_queries: webQueries,
        web_sources: webSources,
        inventory_search: {
          normalized_query: cleanText(inventorySearch.normalized_query, 220),
          candidate_terms: asArray(inventorySearch.candidate_terms).map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 10),
          aliases: asArray(inventorySearch.aliases).map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 10),
          search_mode: cleanText(inventorySearch.search_mode, 60)
        },
        needs_clarification: plan.needs_clarification === true,
        clarification_reason: cleanText(plan.clarification_reason, 260),
        clarification_question: cleanText(plan.clarification_question, 320),
        paper_task_mode: cleanText(plan.paper_task_mode, 80) || 'general_paper_query',
        selected_tool_names: selectedToolNames,
        tool_selection_rationale: toolSelectionRationale,
        paper_match: {
          selected_paper_id: cleanText(paperMatch.selected_paper_id, 80),
          selected_paper_title: cleanText(paperMatch.selected_paper_title, 320),
          secondary_paper_id: cleanText(paperMatch.secondary_paper_id, 80),
          secondary_paper_title: cleanText(paperMatch.secondary_paper_title, 320),
          top_score: Number.isFinite(Number(paperMatch.top_score)) ? Number(paperMatch.top_score) : 0,
          score_delta: Number.isFinite(Number(paperMatch.score_delta)) ? Number(paperMatch.score_delta) : 0,
          needs_clarification: paperMatch.needs_clarification === true,
          ambiguity_reason: cleanText(paperMatch.ambiguity_reason, 220),
          availability_status: cleanText(paperMatch.availability_status, 80),
          deep_read_ready: paperMatch.deep_read_ready === true,
          secondary_availability_status: cleanText(paperMatch.secondary_availability_status, 80),
          secondary_deep_read_ready: paperMatch.secondary_deep_read_ready === true,
          comparison_summary: cleanText(paperMatch.comparison_summary, 2200)
        },
        paper_candidates: paperCandidates,
        protocol_match: {
          selected_protocol_id: cleanText(protocolMatch.selected_protocol_id, 80),
          selected_protocol_name: cleanText(protocolMatch.selected_protocol_name, 220),
          top_score: Number.isFinite(Number(protocolMatch.top_score)) ? Number(protocolMatch.top_score) : 0,
          score_delta: Number.isFinite(Number(protocolMatch.score_delta)) ? Number(protocolMatch.score_delta) : 0,
          needs_clarification: protocolMatch.needs_clarification === true,
          ambiguity_reason: cleanText(protocolMatch.ambiguity_reason, 220)
        },
        protocol_candidates: protocolCandidates,
        project_match: {
          selected_project_id: cleanText(projectMatch.selected_project_id, 80),
          selected_project_name: cleanText(projectMatch.selected_project_name, 220),
          top_score: Number.isFinite(Number(projectMatch.top_score)) ? Number(projectMatch.top_score) : 0,
          score_delta: Number.isFinite(Number(projectMatch.score_delta)) ? Number(projectMatch.score_delta) : 0,
          needs_clarification: projectMatch.needs_clarification === true,
          ambiguity_reason: cleanText(projectMatch.ambiguity_reason, 220),
          resolution_source: cleanText(projectMatch.resolution_source, 80)
        },
        project_candidates: projectCandidates
      },
      classifier: {
        source: cleanText(classifier.source, 80) || 'llm_parser',
        fallbackAttempted: classifier.fallbackAttempted === true,
        fallbackUsed: classifier.fallbackUsed === true,
        lowConfidence: classifier.lowConfidence === true,
        tieDetected: classifier.tieDetected === true,
        ruleReason: cleanText(classifier.ruleReason, 260),
        fallbackError: cleanText(classifier.fallbackError, 260),
        parserPrimaryIntent: cleanText(classifier.parser_primary_intent, 80),
        parserSecondaryIntents: asArray(classifier.parser_secondary_intents).map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 5),
        parserNeedsClarification: classifier.parser_needs_clarification === true,
        parserClarificationReason: cleanText(classifier.parser_clarification_reason, 260),
        parserReasoningSummary: cleanText(classifier.parser_reasoning_summary, 320),
        mappedExecutionIntent: cleanText(classifier.mapped_execution_intent, 80),
        parserEntities: classifier.parser_entities && typeof classifier.parser_entities === 'object'
          ? {
            activity_type: cleanText(classifier.parser_entities.activity_type, 180),
            project_name: cleanText(classifier.parser_entities.project_name, 180),
            protocol_name: cleanText(classifier.parser_entities.protocol_name, 220),
            protein_name: cleanText(classifier.parser_entities.protein_name, 120),
            compound_name: cleanText(classifier.parser_entities.compound_name, 120),
            inventory_item: cleanText(classifier.parser_entities.inventory_item, 120),
            cell_line: cleanText(classifier.parser_entities.cell_line, 80),
            paper_title: cleanText(classifier.parser_entities.paper_title, 220),
            workflow_step: cleanText(classifier.parser_entities.workflow_step, 180),
            requested_output: cleanText(classifier.parser_entities.requested_output, 180)
          }
          : {},
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
      `Planner flags tools=${normalized.plan.needs_tools} protocol_search=${normalized.plan.needs_protocol_search} notebook_retrieval=${normalized.plan.needs_notebook_retrieval} project_retrieval=${normalized.plan.needs_project_retrieval} workflow_retrieval=${normalized.plan.needs_workflow_retrieval} paper_retrieval=${normalized.plan.needs_paper_retrieval} deep_paper=${normalized.plan.needs_deep_paper_reading} paper_compare=${normalized.plan.needs_paper_comparison} notebook_generation=${normalized.plan.needs_notebook_generation} notebook_autosave=${normalized.plan.notebook_autosave} pdf=${normalized.plan.needs_pdf_reading} python=${normalized.plan.needs_python} web=${normalized.plan.needs_web_search} clarification=${normalized.plan.needs_clarification}.`
    ];
    if (normalized.plan.needs_python || normalized.plan.python_task_type) {
      rows.push(
        `Python plan task=${normalized.plan.python_task_type || '-'} `
        + `ready=${normalized.plan.python_ready} `
        + `needs_clarification=${normalized.plan.python_needs_clarification} `
        + `artifact_count=${Number(normalized.plan.python_artifact_count) || 0} `
        + `codegen_status=${normalized.plan.python_codegen_status || '-'} `
        + `codegen_reason=${normalized.plan.python_codegen_reason || '-'}.`
      );
    }
    if (normalized.plan.web_fallback_triggered || normalized.plan.needs_web_search) {
      rows.push(
        `Web fallback triggered=${normalized.plan.web_fallback_triggered} `
        + `reason=${normalized.plan.web_fallback_reason || '-'} `
        + `queries=${asArray(normalized.plan.web_queries).length} `
        + `sources=${asArray(normalized.plan.web_sources).length}.`
      );
    }
    if (normalized.intent === 'inventory_lookup') {
      rows.push(
        `Inventory search normalized_query=${normalized.plan.inventory_search.normalized_query || '-'} `
        + `candidate_terms=${asArray(normalized.plan.inventory_search.candidate_terms).length} `
        + `aliases=${asArray(normalized.plan.inventory_search.aliases).length} `
        + `mode=${normalized.plan.inventory_search.search_mode || '-'}.`
      );
    }
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
    if (normalized.plan.project_match.selected_project_name) {
      rows.push(
        `Project matcher selected "${normalized.plan.project_match.selected_project_name}" `
        + `(score=${normalized.plan.project_match.top_score.toFixed(2)} source=${normalized.plan.project_match.resolution_source || 'unknown'}).`
      );
    }
    if (normalized.plan.project_match.needs_clarification) {
      rows.push(
        `Project matcher requested clarification (${normalized.plan.project_match.ambiguity_reason || 'ambiguous'}; `
        + `delta=${normalized.plan.project_match.score_delta.toFixed(2)}).`
      );
    }
    if (asArray(normalized.plan.project_candidates).length) {
      const topProjectCandidate = normalized.plan.project_candidates[0];
      rows.push(
        `Project candidate top-1: ${topProjectCandidate.project_name || topProjectCandidate.project_id} `
        + `score=${topProjectCandidate.score.toFixed(2)}.`
      );
    }
    if (normalized.plan.paper_match.selected_paper_title) {
      rows.push(
        `Paper matcher selected "${normalized.plan.paper_match.selected_paper_title}" `
        + `(mode=${normalized.plan.paper_task_mode}; score=${normalized.plan.paper_match.top_score.toFixed(2)}; `
        + `availability=${normalized.plan.paper_match.availability_status || 'unknown'}).`
      );
    }
    if (normalized.plan.paper_match.secondary_paper_title) {
      rows.push(
        `Paper matcher comparison target "${normalized.plan.paper_match.secondary_paper_title}" `
        + `(availability=${normalized.plan.paper_match.secondary_availability_status || 'unknown'}).`
      );
    }
    if (normalized.plan.paper_match.needs_clarification) {
      rows.push(
        `Paper matcher requested clarification (${normalized.plan.paper_match.ambiguity_reason || 'ambiguous'}; `
        + `delta=${normalized.plan.paper_match.score_delta.toFixed(2)}).`
      );
    }
    if (asArray(normalized.plan.paper_candidates).length) {
      const topPaperCandidate = normalized.plan.paper_candidates[0];
      rows.push(
        `Paper candidate top-1: ${topPaperCandidate.paper_title || topPaperCandidate.paper_id} `
        + `score=${topPaperCandidate.score.toFixed(2)} semantic=${topPaperCandidate.semantic_score.toFixed(2)}.`
      );
    }
    if (normalized.classifier.fallbackAttempted) {
      rows.push(normalized.classifier.fallbackUsed
        ? 'Routing fallback completed successfully.'
        : `Routing fallback attempted but not used${normalized.classifier.fallbackError ? `: ${normalized.classifier.fallbackError}` : '.'}`);
    }
    if (normalized.classifier.source === 'llm_parser') {
      rows.push(
        `Parser primary=${normalized.classifier.parserPrimaryIntent || '-'} `
        + `secondary=${asArray(normalized.classifier.parserSecondaryIntents).join('|') || '-'} `
        + `mapped_intent=${normalized.classifier.mappedExecutionIntent || normalized.intent}.`
      );
      if (normalized.classifier.parserNeedsClarification) {
        rows.push(
          `Parser requested clarification (${normalized.classifier.parserClarificationReason || 'reason_not_provided'}).`
        );
      }
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
