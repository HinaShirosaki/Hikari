'use strict';

function createAgentScienceMainUtils(deps = {}) {
  const asArray = typeof deps.asArray === 'function'
    ? deps.asArray
    : ((value) => (Array.isArray(value) ? value : []));
  const cleanText = typeof deps.cleanText === 'function'
    ? deps.cleanText
    : ((value, _maxLength = 2000) => {
      const text = String(value || '').trim();
      if (!text) {
        return '';
      }
      return text;
    });
  const uniqueStrings = typeof deps.uniqueStrings === 'function'
    ? deps.uniqueStrings
    : ((values, max = 50) => {
      const seen = new Set();
      const out = [];
      asArray(values).forEach((value) => {
        const normalized = cleanText(value, 220);
        if (!normalized) {
          return;
        }
        const key = normalized.toLowerCase();
        if (seen.has(key) || out.length >= max) {
          return;
        }
        seen.add(key);
        out.push(normalized);
      });
      return out;
    });
  const clamp = typeof deps.clamp === 'function'
    ? deps.clamp
    : ((value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min)));
  const normalizeRoutingPayload = typeof deps.normalizeRoutingPayload === 'function'
    ? deps.normalizeRoutingPayload
    : ((value) => value && typeof value === 'object' ? value : {});
  const normalizeNotebookDraftPayload = typeof deps.normalizeNotebookDraftPayload === 'function'
    ? deps.normalizeNotebookDraftPayload
    : ((value) => value && typeof value === 'object' ? value : null);
  const applyRoutingPlanPatch = typeof deps.applyRoutingPlanPatch === 'function'
    ? deps.applyRoutingPlanPatch
    : ((_routing, patch = {}) => patch);
  const pickTopMatches = typeof deps.pickTopMatches === 'function'
    ? deps.pickTopMatches
    : ((items = [], _builder, _query, limit = 6) => asArray(items).slice(0, limit));
  const scoreByQuery = typeof deps.scoreByQuery === 'function'
    ? deps.scoreByQuery
    : (() => 0);
  const normalizeQuery = typeof deps.normalizeQuery === 'function'
    ? deps.normalizeQuery
    : ((value) => ({
      query: cleanText(value, 300).toLowerCase(),
      tokens: cleanText(value, 300).toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean)
    }));
  const mapCanonicalIntentToExecutionIntent = typeof deps.mapCanonicalIntentToExecutionIntent === 'function'
    ? deps.mapCanonicalIntentToExecutionIntent
    : ((intent) => cleanText(intent, 80) || 'general_science_question');
  const normalizeParserEntitiesToRoutingEntities = typeof deps.normalizeParserEntitiesToRoutingEntities === 'function'
    ? deps.normalizeParserEntitiesToRoutingEntities
    : ((entities) => entities && typeof entities === 'object' ? entities : {});

  function summarizeCitationGroups(citations = []) {
    const counts = new Map();
    asArray(citations).forEach((citation) => {
      const source = cleanText(citation?.source, 120) || 'unknown';
      counts.set(source, (counts.get(source) || 0) + 1);
    });
    return [...counts.entries()].map(([source, count]) => ({
      source,
      count
    }));
  }

  function confidenceToLabel(confidence) {
    const normalized = Number.isFinite(Number(confidence)) ? Number(confidence) : 0;
    if (normalized >= 0.8) {
      return 'high';
    }
    if (normalized >= 0.55) {
      return 'medium';
    }
    return 'low';
  }

  function finalizeAgentResponse({
    answer,
    confidence,
    routing,
    notebookDraft,
    toolTrace,
    citations
  }) {
    const normalizedAnswer = cleanText(answer, 12000) || 'No answer generated.';
    const normalizedConfidence = clamp(Number.isFinite(Number(confidence)) ? Number(confidence) : 0.5, 0, 1);
    const normalizedRouting = normalizeRoutingPayload(routing);
    const unresolvedFields = [];
    if (normalizedRouting.plan?.needs_clarification === true) {
      unresolvedFields.push('clarification_required');
    }
    const unresolvedPlaceholders = asArray(notebookDraft?.unresolved_placeholders)
      .map((item) => cleanText(item?.placeholder_key || item?.display, 180))
      .filter(Boolean);
    unresolvedFields.push(...unresolvedPlaceholders);

    const normalizedCitations = asArray(citations).map((citation) => ({
      source: cleanText(citation?.source, 120),
      pointer: cleanText(citation?.pointer, 220),
      reason: cleanText(citation?.reason, 260)
    })).filter((citation) => citation.source || citation.pointer);
    const responseType = normalizedRouting.plan?.needs_clarification === true
      ? 'clarification_request'
      : (notebookDraft
        ? 'notebook_draft'
        : (normalizedCitations.length || asArray(toolTrace).length
          ? 'grounded_answer'
          : 'factual_answer'));

    return {
      answer: normalizedAnswer,
      confidence: normalizedConfidence,
      response_type: responseType,
      confidence_label: confidenceToLabel(normalizedConfidence),
      source_summary: {
        total_sources: normalizedCitations.length,
        groups: summarizeCitationGroups(normalizedCitations)
      },
      unresolved_fields: uniqueStrings(unresolvedFields, 12)
    };
  }

  function validateAndGateResponse({
    routing,
    normalized,
    citations
  }) {
    const normalizedRouting = normalizeRoutingPayload(routing);
    const output = normalized && typeof normalized === 'object' ? normalized : {};
    const normalizedCitations = asArray(citations).map((citation) => ({
      source: cleanText(citation?.source, 120),
      pointer: cleanText(citation?.pointer, 220),
      reason: cleanText(citation?.reason, 260)
    })).filter((citation) => citation.source || citation.pointer);
    const violations = [];
    let forcedClarification = false;
    let clarificationQuestion = cleanText(normalizedRouting.plan?.clarification_question, 320);
    let clarificationReason = cleanText(normalizedRouting.plan?.clarification_reason, 260);

    if (!cleanText(output.answer, 12000)) {
      violations.push({
        code: 'missing_answer',
        severity: 'high',
        message: 'The response did not include answer text.',
        detail: 'A final answer string is required.'
      });
      forcedClarification = true;
      clarificationQuestion = clarificationQuestion || 'Could you clarify what you need so I can continue safely?';
      clarificationReason = clarificationReason || 'The response was empty and could not be safely emitted.';
    }

    if (normalizedRouting.plan?.needs_clarification === true) {
      forcedClarification = true;
      clarificationQuestion = clarificationQuestion || 'Could you clarify the missing details so I can continue safely?';
      clarificationReason = clarificationReason || 'Routing requested clarification before execution.';
    }

    const answerExcerpt = cleanText(output.answer, 320);
    const sourceEvidence = answerExcerpt
      ? [{
        statement: answerExcerpt,
        support_level: normalizedCitations.length
          ? (normalizedCitations.some((citation) => ['project', 'protocol', 'notebook_entry', 'workflow', 'assay', 'gel_analysis', 'paper', 'python_sandbox', 'python-sandbox', 'notebook-lookup'].includes(cleanText(citation?.source, 120).toLowerCase()))
            ? 'direct'
            : 'indirect')
          : 'none',
        supports: normalizedCitations.slice(0, 8).map((citation) => ({
          source: cleanText(citation?.source, 120),
          pointer: cleanText(citation?.pointer, 220),
          overlap: 1
        }))
      }]
      : [];

    return {
      clarification: {
        question: clarificationQuestion,
        reason: clarificationReason,
        answer: clarificationQuestion
      },
      validation: {
        passed: violations.length === 0 && forcedClarification === false,
        forced_clarification: forcedClarification,
        violations,
        failure_reasons: uniqueStrings([
          ...(forcedClarification ? ['clarification_required'] : []),
          ...violations.map((item) => cleanText(item?.code, 80))
        ], 8)
      },
      provenance: {
        source_evidence: sourceEvidence,
        unsupported_statement_count: sourceEvidence.filter((item) => item.support_level === 'none').length
      }
    };
  }

  function applyResponseLayerToOutput({
    normalized,
    routing,
    notebookDraft,
    toolTrace
  }) {
    const source = normalized && typeof normalized === 'object' ? normalized : {};
    const responseLayer = finalizeAgentResponse({
      answer: source.answer,
      confidence: source.confidence,
      routing,
      notebookDraft,
      toolTrace: asArray(toolTrace),
      citations: asArray(source.citations)
    });
    return {
      ...source,
      answer: responseLayer.answer,
      response_type: responseLayer.response_type,
      confidence_label: responseLayer.confidence_label,
      source_summary: responseLayer.source_summary,
      unresolved_fields: responseLayer.unresolved_fields
    };
  }

  function applyValidationGateToOutput({
    routing,
    normalized,
    notebookDraft,
    toolTrace
  }) {
    const normalizedRouting = normalizeRoutingPayload(routing);
    const normalizedOutput = normalized && typeof normalized === 'object' ? normalized : {};
    const validationResult = validateAndGateResponse({
      routing: normalizedRouting,
      normalized: normalizedOutput,
      notebookDraft: normalizeNotebookDraftPayload(notebookDraft),
      toolTrace: asArray(toolTrace),
      citations: asArray(normalizedOutput.citations)
    });
    const validationMeta = validationResult.validation && typeof validationResult.validation === 'object'
      ? validationResult.validation
      : {
        passed: true,
        forced_clarification: false,
        violations: [],
        failure_reasons: []
      };
    const provenanceMeta = validationResult.provenance && typeof validationResult.provenance === 'object'
      ? validationResult.provenance
      : {
        source_evidence: [],
        unsupported_statement_count: 0
      };
    let routed = normalizedRouting;
    let finalized = {
      ...normalizedOutput
    };

    if (validationMeta.forced_clarification === true) {
      const clarificationAnswer = cleanText(validationResult?.clarification?.answer, 400)
        || cleanText(routed.plan?.clarification_question, 400)
        || 'Could you clarify the missing details so I can continue safely?';
      const clarificationReason = cleanText(validationResult?.clarification?.reason, 260)
        || 'Response validation requested clarification.';
      routed = applyRoutingPlanPatch(routed, {
        needs_clarification: true,
        clarification_reason: clarificationReason,
        clarification_question: cleanText(validationResult?.clarification?.question, 320) || clarificationAnswer
      });
      finalized = applyResponseLayerToOutput({
        normalized: {
          ...finalized,
          answer: clarificationAnswer
        },
        routing: routed,
        notebookDraft,
        toolTrace
      });
    }

    return {
      routing: routed,
      normalized: finalized,
      validation: {
        passed: validationMeta.passed === true,
        forced_clarification: validationMeta.forced_clarification === true,
        violations: asArray(validationMeta.violations).map((row) => ({
          code: cleanText(row?.code, 80),
          severity: cleanText(row?.severity, 20),
          message: cleanText(row?.message, 280),
          detail: cleanText(row?.detail, 360)
        })).filter((row) => row.code || row.message),
        failure_reasons: asArray(validationMeta.failure_reasons).map((row) => cleanText(row, 80)).filter(Boolean)
      },
      provenance: {
        source_evidence: asArray(provenanceMeta.source_evidence).map((row) => ({
          statement: cleanText(row?.statement, 360),
          support_level: cleanText(row?.support_level, 20) || 'none',
          supports: asArray(row?.supports).map((support) => ({
            source: cleanText(support?.source, 120),
            pointer: cleanText(support?.pointer, 220),
            overlap: Number.isFinite(Number(support?.overlap)) ? Number(support.overlap) : 0
          })).filter((support) => support.source || support.pointer)
        })).filter((row) => row.statement),
        unsupported_statement_count: Number.isFinite(Number(provenanceMeta.unsupported_statement_count))
          ? Number(provenanceMeta.unsupported_statement_count)
          : 0
      }
    };
  }

  function retrieveProjectEvidence({
    message,
    entities = {},
    selectedProjectId = '',
    selectedProjectName = '',
    snapshot = {},
    maxPerSource = 3,
    allowAmbiguousScope = false
  }) {
    const projects = asArray(snapshot?.projects);
    const protocols = asArray(snapshot?.protocols);
    const workflows = asArray(snapshot?.workflows);
    const notebookEntries = asArray(snapshot?.notebookEntries);
    const assays = asArray(snapshot?.assays);
    const gelAnalyses = asArray(snapshot?.gelAnalyses);
    const papers = asArray(snapshot?.papers);
    const desiredProjectId = cleanText(selectedProjectId, 120);
    const desiredProjectName = cleanText(
      selectedProjectName
        || entities?.project
        || entities?.project_name
        || entities?.projectName,
      220
    );
    const lowerProjectName = desiredProjectName.toLowerCase();
    const messageText = cleanText(message, 1600).toLowerCase();

    const exactById = desiredProjectId
      ? projects.find((project) => cleanText(project?.id, 120) === desiredProjectId)
      : null;
    const exactByName = lowerProjectName
      ? projects.find((project) => cleanText(project?.name, 220).toLowerCase() === lowerProjectName)
      : null;
    const partialMatches = lowerProjectName
      ? projects.filter((project) => cleanText(project?.name, 220).toLowerCase().includes(lowerProjectName))
      : [];
    const messageMatches = !desiredProjectId && !desiredProjectName
      ? projects.filter((project) => {
        const projectName = cleanText(project?.name, 220).toLowerCase();
        return projectName && messageText.includes(projectName);
      })
      : [];
    const matchedProjects = uniqueStrings([
      ...(exactById ? [cleanText(exactById.id, 120)] : []),
      ...(exactByName ? [cleanText(exactByName.id, 120)] : []),
      ...partialMatches.map((project) => cleanText(project?.id, 120)),
      ...messageMatches.map((project) => cleanText(project?.id, 120))
    ], 6).map((projectId) => (
      projects.find((project) => cleanText(project?.id, 120) === projectId)
    )).filter(Boolean);

    if (!matchedProjects.length) {
      return allowAmbiguousScope
        ? {
          selected_project: null,
          packs: {},
          summary_rows: [],
          citations: []
        }
        : {
          needs_clarification: true,
          clarification_question: desiredProjectName
            ? `I couldn't find a project named "${desiredProjectName}". Which project should I use?`
            : 'Which project should I use for this question?',
          selected_project: null,
          packs: {},
          summary_rows: [],
          citations: []
        };
    }

    if (matchedProjects.length > 1 && !allowAmbiguousScope && !desiredProjectId && !exactByName) {
      return {
        needs_clarification: true,
        clarification_question: `I found multiple project matches: ${matchedProjects.slice(0, 4).map((project) => cleanText(project?.name, 180)).filter(Boolean).join(', ')}. Which project should I use?`,
        selected_project: null,
        packs: {},
        summary_rows: [],
        citations: []
      };
    }

    const selectedProject = matchedProjects[0];
    const selectedProjectIdNormalized = cleanText(selectedProject?.id, 120);
    const selectedProjectNameNormalized = cleanText(selectedProject?.name, 220);
    const matchesProject = (record) => {
      const recordProjectId = cleanText(record?.projectId || record?.project_id || record?.linkedId, 120);
      const recordProjectName = cleanText(
        record?.projectName
        || record?.project_name
        || record?.linkedName
        || record?.linked_project_name,
        220
      ).toLowerCase();
      return (selectedProjectIdNormalized && recordProjectId === selectedProjectIdNormalized)
        || (selectedProjectNameNormalized && recordProjectName === selectedProjectNameNormalized.toLowerCase());
    };
    const limit = clamp(Number(maxPerSource) || 3, 1, 8);

    const filteredProtocols = protocols.filter(matchesProject).slice(0, limit);
    const filteredWorkflows = workflows.filter(matchesProject).slice(0, limit);
    const filteredNotebookEntries = notebookEntries.filter(matchesProject).slice(0, limit);
    const filteredAssays = assays.filter(matchesProject).slice(0, limit);
    const filteredGelAnalyses = gelAnalyses.filter(matchesProject).slice(0, limit);
    const filteredPapers = papers.filter(matchesProject).slice(0, limit);

    const citations = [
      {
        source: 'project',
        pointer: selectedProjectIdNormalized || selectedProjectNameNormalized,
        reason: 'Resolved as the scoped project for this project-science request.'
      },
      ...filteredProtocols.map((item) => ({
        source: 'protocol',
        pointer: cleanText(item?.id || item?.name, 220),
        reason: 'Project-linked protocol evidence.'
      })),
      ...filteredWorkflows.map((item) => ({
        source: 'workflow',
        pointer: cleanText(item?.id || item?.name, 220),
        reason: 'Project-linked workflow evidence.'
      })),
      ...filteredNotebookEntries.map((item) => ({
        source: 'notebook_entry',
        pointer: cleanText(item?.id || item?.protocolName, 220),
        reason: 'Project-linked notebook evidence.'
      })),
      ...filteredAssays.map((item) => ({
        source: 'assay',
        pointer: cleanText(item?.id || item?.name, 220),
        reason: 'Project-linked assay evidence.'
      })),
      ...filteredGelAnalyses.map((item) => ({
        source: 'gel_analysis',
        pointer: cleanText(item?.id || item?.name, 220),
        reason: 'Project-linked gel evidence.'
      })),
      ...filteredPapers.map((item) => ({
        source: 'paper',
        pointer: cleanText(item?.id || item?.title, 220),
        reason: 'Project-linked paper evidence.'
      }))
    ];

    return {
      needs_clarification: false,
      selected_project: {
        id: selectedProjectIdNormalized,
        name: selectedProjectNameNormalized,
        resolution_source: desiredProjectId || desiredProjectName ? 'project_hint' : 'message_match'
      },
      packs: {
        protocols: filteredProtocols,
        workflows: filteredWorkflows,
        notebook_entries: filteredNotebookEntries,
        assays: filteredAssays,
        gel_analyses: filteredGelAnalyses,
        papers: filteredPapers
      },
      summary_rows: [
        `Resolved project=${selectedProjectNameNormalized || selectedProjectIdNormalized}.`,
        `Project evidence counts protocols=${filteredProtocols.length} workflows=${filteredWorkflows.length} notebook_entries=${filteredNotebookEntries.length} assays=${filteredAssays.length} gels=${filteredGelAnalyses.length} papers=${filteredPapers.length}.`
      ],
      citations
    };
  }

  function buildPaperSearchableDocs({ papers = [], projects = [] } = {}) {
    const projectNameById = new Map(asArray(projects).map((project) => [
      cleanText(project?.id, 120),
      cleanText(project?.name, 220)
    ]));
    return asArray(papers).map((paper) => ({
      paper_id: cleanText(paper?.id, 120),
      paper_title: cleanText(paper?.title, 220),
      summary: cleanText(paper?.summary, 1200),
      methods: asArray(paper?.methods)
        .map((method) => ({
          title: cleanText(method?.title || method?.name, 180),
          steps: asArray(method?.steps).map((step) => cleanText(
            step?.text || step?.instruction || step?.action || step,
            220
          )).filter(Boolean).slice(0, 10),
          citations: asArray(method?.citations).map((item) => cleanText(item, 140)).filter(Boolean).slice(0, 8)
        }))
        .filter((method) => method.title || method.steps.length),
      key_figures: asArray(paper?.keyFigures || paper?.key_figures).map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 10),
      linked_project_name: cleanText(
        paper?.linkedName
        || paper?.projectName
        || projectNameById.get(cleanText(paper?.linkedId, 120)),
        220
      ),
      availability_status: cleanText(paper?.availabilityStatus || paper?.availability_status, 80),
      deep_read_ready: paper?.deepReadReady === true || paper?.deep_read_ready === true,
      ingestion_status: cleanText(paper?.ingestionStatus || paper?.ingestion_status, 80),
      updated_at: cleanText(paper?.updatedAt || paper?.createdAt, 80)
    }));
  }

  function retrievePaperCandidates({
    message,
    entities = {},
    docs = [],
    maxCandidates = 6
  }) {
    const query = [
      cleanText(entities?.paper_title, 220),
      cleanText(entities?.project, 180),
      cleanText(entities?.protein, 140),
      cleanText(entities?.compound, 140),
      cleanText(message, 400)
    ].filter(Boolean).join(' ');
    return pickTopMatches(
      asArray(docs),
      (doc) => [
        doc?.paper_title,
        doc?.summary,
        doc?.linked_project_name,
        asArray(doc?.methods).map((method) => `${method?.title || ''} ${asArray(method?.steps).join(' ')}`).join(' '),
        asArray(doc?.key_figures).join(' ')
      ].join(' '),
      query,
      clamp(Number(maxCandidates) || 6, 1, 12)
    ).map((doc) => ({
      ...doc,
      score: scoreByQuery([
        doc?.paper_title,
        doc?.summary,
        doc?.linked_project_name,
        asArray(doc?.methods).map((method) => `${method?.title || ''} ${asArray(method?.steps).join(' ')}`).join(' ')
      ].join(' '), normalizeQuery(query).tokens)
    }));
  }

  function resolvePaperRequest({
    message,
    entities = {},
    papers = [],
    projects = [],
    maxCandidates = 6
  }) {
    const query = cleanText(entities?.paper_title || message, 300);
    const docs = buildPaperSearchableDocs({
      papers: asArray(papers),
      projects: asArray(projects)
    });
    const candidates = retrievePaperCandidates({
      message,
      entities: {
        paper_title: cleanText(entities?.paper_title, 220),
        project: cleanText(entities?.project, 180),
        protein: cleanText(entities?.protein, 140),
        compound: cleanText(entities?.compound, 140)
      },
      docs,
      maxCandidates
    });
    const selected = candidates[0] || null;
    return {
      mode: /\bcompare\b/i.test(String(message || '')) ? 'compare_papers' : 'general_paper_query',
      requires_deep_reading: /\bdeep|full|detail|methods|analy[sz]e\b/i.test(String(message || '')),
      selected,
      secondary_selected: candidates[1] || null,
      candidates,
      availability: {
        availability_status: cleanText(selected?.availability_status, 80) || 'unknown',
        deep_read_ready: selected?.deep_read_ready === true
      },
      secondary_availability: {
        availability_status: cleanText(candidates[1]?.availability_status, 80) || 'unknown',
        deep_read_ready: candidates[1]?.deep_read_ready === true
      },
      comparison_summary: query ? `Resolved ${candidates.length} paper candidate(s) for "${query}".` : ''
    };
  }

  function buildScienceRoutingFromParser(parserPayload = {}) {
    const parserIntent = cleanText(parserPayload?.primary_intent, 80);
    const intent = mapCanonicalIntentToExecutionIntent(parserIntent);
    const remappedUnclearIntent = parserIntent === 'unclear' && intent === 'general_science_question';
    const reasoningEffort = ['general_science_question', 'project_science_question'].includes(intent)
      ? (remappedUnclearIntent
        ? 2
        : ([0, 1, 2].includes(Number(parserPayload?.reasoning_effort)) ? Number(parserPayload.reasoning_effort) : 1))
      : 0;
    return normalizeRoutingPayload({
      intent,
      confidence: parserPayload?.needs_clarification === true ? 0.35 : 0.64,
      entities: normalizeParserEntitiesToRoutingEntities(parserPayload?.entities, parserPayload?.primary_intent),
      plan: {
        needs_clarification: parserPayload?.needs_clarification === true,
        clarification_reason: cleanText(parserPayload?.clarification_reason, 260),
        clarification_question: cleanText(parserPayload?.clarification_reason, 320),
        reasoning_effort: reasoningEffort
      },
      classifier: {
        source: 'intent_parser',
        fallbackAttempted: remappedUnclearIntent,
        fallbackUsed: remappedUnclearIntent,
        lowConfidence: parserPayload?.needs_clarification === true || remappedUnclearIntent,
        tieDetected: false,
        reasoning_effort: reasoningEffort,
        ruleReason: cleanText(parserPayload?.reasoning_summary, 220),
        fallbackError: ''
      }
    });
  }

  return {
    finalizeAgentResponse,
    validateAndGateResponse,
    applyResponseLayerToOutput,
    applyValidationGateToOutput,
    retrieveProjectEvidence,
    buildPaperSearchableDocs,
    retrievePaperCandidates,
    resolvePaperRequest,
    buildScienceRoutingFromParser
  };
}

module.exports = {
  createAgentScienceMainUtils
};
