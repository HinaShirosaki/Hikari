'use strict';

function createScienceLoopSupport(deps = {}) {
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
    : ((values, max = 20) => {
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
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const applyResponseLayerToOutput = typeof deps.applyResponseLayerToOutput === 'function'
    ? deps.applyResponseLayerToOutput
    : (({ normalized }) => normalized);
  const applyValidationGateToOutput = typeof deps.applyValidationGateToOutput === 'function'
    ? deps.applyValidationGateToOutput
    : (({ routing, normalized }) => ({
      routing,
      normalized,
      validation: {
        passed: true,
        forced_clarification: false,
        violations: [],
        failure_reasons: []
      },
      provenance: {
        source_evidence: [],
        unsupported_statement_count: 0
      }
    }));

  function buildStateId(prefix) {
    return `${cleanText(prefix, 40) || 'science'}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function buildIntermediateState(stage, goal, extras = {}) {
    return {
      state_id: buildStateId(stage),
      created_at: now(),
      stage: cleanText(stage, 80),
      goal: cleanText(goal, 800),
      assumptions: asArray(extras.assumptions).map((item) => cleanText(item, 320)).filter(Boolean),
      open_questions: asArray(extras.open_questions).map((item) => cleanText(item, 320)).filter(Boolean),
      evidence: asArray(extras.evidence).slice(0, 20).map((item) => ({
        source: cleanText(item?.source, 120),
        pointer: cleanText(item?.pointer, 220),
        reason: cleanText(item?.reason, 260)
      })).filter((item) => item.source || item.pointer),
      proposed_actions: asArray(extras.proposed_actions).slice(0, 10).map((item) => ({
        action_type: cleanText(item?.action_type, 40),
        tool_name: cleanText(item?.tool_name, 120),
        risk_level: cleanText(item?.risk_level, 30),
        reason: cleanText(item?.reason, 260)
      })).filter((item) => item.action_type || item.tool_name || item.reason),
      confidence: Number.isFinite(Number(extras.confidence))
        ? clamp(Number(extras.confidence), 0, 1)
        : 0.5
    };
  }

  function normalizeProject(project) {
    const source = project && typeof project === 'object' ? project : {};
    const id = cleanText(source.id, 120);
    const name = cleanText(source.name, 220);
    if (!id && !name) {
      return null;
    }
    return {
      id,
      name,
      resolution_source: cleanText(source.resolution_source, 80) || 'unknown'
    };
  }

  function normalizeCitations(citations, max = 20) {
    const seen = new Set();
    const out = [];
    asArray(citations).forEach((citation) => {
      const source = cleanText(citation?.source, 120);
      const pointer = cleanText(citation?.pointer, 220);
      const reason = cleanText(citation?.reason, 260);
      const key = `${source.toLowerCase()}::${pointer.toLowerCase()}`;
      if (!source && !pointer) {
        return;
      }
      if (seen.has(key) || out.length >= max) {
        return;
      }
      seen.add(key);
      out.push({ source, pointer, reason });
    });
    return out;
  }

  function normalizeLoadedContextBlocks(blocks, max = 6) {
    const seen = new Set();
    const out = [];
    asArray(blocks).forEach((block) => {
      const paperId = cleanText(block?.paper_id, 120);
      const paperTitle = cleanText(block?.paper_title, 320);
      const sectionLabel = cleanText(block?.section_label, 160) || 'Excerpt';
      const excerpt = cleanText(block?.excerpt, 1800);
      const relevanceReason = cleanText(block?.relevance_reason, 260);
      const source = cleanText(block?.source, 80);
      const evidenceKind = cleanText(block?.evidence_kind, 40) || 'text';
      const key = `${paperId.toLowerCase()}::${sectionLabel.toLowerCase()}::${excerpt.toLowerCase()}`;
      if (!paperId || !excerpt || seen.has(key) || out.length >= max) {
        return;
      }
      seen.add(key);
      out.push({
        paper_id: paperId,
        paper_title: paperTitle,
        section_label: sectionLabel,
        excerpt,
        relevance_reason: relevanceReason,
        source,
        evidence_kind: evidenceKind
      });
    });
    return out;
  }

  function formatLoadedContextBlocks(blocks, max = 4) {
    return normalizeLoadedContextBlocks(blocks, max)
      .map((block) => {
        const header = [
          cleanText(block.paper_title, 160),
          cleanText(block.section_label, 80)
        ].filter(Boolean).join(' | ');
        const excerpt = cleanText(block.excerpt, 220);
        const reason = cleanText(block.relevance_reason, 180);
        return [header, excerpt, reason].filter(Boolean).join(' - ');
      })
      .filter(Boolean);
  }

  function normalizeDecisionRecord(record, fallback = {}) {
    const source = record && typeof record === 'object' ? record : {};
    return {
      assumptions: uniqueStrings([
        ...asArray(source.assumptions),
        ...asArray(fallback.assumptions)
      ], 10),
      open_questions: uniqueStrings([
        ...asArray(source.open_questions),
        ...asArray(fallback.open_questions)
      ], 10),
      verification_notes: uniqueStrings([
        ...asArray(source.verification_notes),
        ...asArray(fallback.verification_notes)
      ], 12)
    };
  }

  function buildNeedsMoreInfoResult({
    intent,
    routing,
    reason,
    question,
    toolTrace = [],
    intermediateStates = [],
    citations = []
  }) {
    const followUp = uniqueStrings([
      cleanText(question, 320) || cleanText(reason, 280) || 'Could you clarify the missing details so I can continue safely?'
    ], 4);
    const clarificationRouting = {
      ...(routing && typeof routing === 'object' ? routing : {}),
      plan: {
        ...((routing?.plan && typeof routing.plan === 'object') ? routing.plan : {}),
        needs_clarification: true,
        clarification_reason: cleanText(reason, 260) || cleanText(routing?.plan?.clarification_reason, 260),
        clarification_question: followUp[0]
      }
    };
    const normalizedBase = applyResponseLayerToOutput({
      normalized: {
        answer: followUp[0],
        confidence: 0.35,
        citations: normalizeCitations(citations),
        decision_record: {
          assumptions: [
            `${intent} was routed into the shared science reasoning loop.`
          ],
          open_questions: followUp,
          verification_notes: [
            'Execution stopped before tool use because prerequisite clarification was missing.'
          ]
        }
      },
      routing: clarificationRouting,
      notebookDraft: null,
      toolTrace
    });
    const validation = applyValidationGateToOutput({
      routing: clarificationRouting,
      normalized: {
        ...normalizedBase,
        decisionRecord: normalizeDecisionRecord(normalizedBase.decision_record, {
          assumptions: [`${intent} requires clarification before retrieval.`],
          open_questions: followUp,
          verification_notes: ['No science retrieval tool was executed.']
        })
      },
      notebookDraft: null,
      toolTrace
    });
    return {
      status: 'needs_more_info',
      answer: validation.normalized.answer,
      confidence: Number.isFinite(Number(validation.normalized.confidence))
        ? Number(validation.normalized.confidence)
        : 0.35,
      citations: normalizeCitations(citations),
      decision_record: validation.normalized.decisionRecord || normalizeDecisionRecord(null, {
        assumptions: [`${intent} requires clarification before retrieval.`],
        open_questions: followUp,
        verification_notes: ['No science retrieval tool was executed.']
      }),
      response_type: cleanText(validation.normalized.response_type, 80),
      confidence_label: cleanText(validation.normalized.confidence_label, 40),
      source_summary: validation.normalized.source_summary && typeof validation.normalized.source_summary === 'object'
        ? validation.normalized.source_summary
        : { total_sources: 0, groups: [] },
      unresolved_fields: asArray(validation.normalized.unresolved_fields).map((item) => cleanText(item, 180)).filter(Boolean),
      validation: validation.validation,
      provenance: validation.provenance,
      tool_trace: asArray(toolTrace),
      intermediate_states: asArray(intermediateStates),
      rounds_executed: 0,
      follow_up_questions: followUp
    };
  }

  function buildToolSchemaMap(toolDefinitions) {
    const out = new Map();
    asArray(toolDefinitions).forEach((tool) => {
      const name = cleanText(tool?.name, 120);
      if (!name) {
        return;
      }
      out.set(name, tool?.parameters && typeof tool.parameters === 'object'
        ? tool.parameters
        : { type: 'object', additionalProperties: true, properties: {} });
    });
    return out;
  }

  function validatePrimitiveByType(value, schemaType) {
    if (schemaType === 'string') {
      return typeof value === 'string';
    }
    if (schemaType === 'number') {
      return typeof value === 'number' && Number.isFinite(value);
    }
    if (schemaType === 'integer') {
      return Number.isInteger(value);
    }
    if (schemaType === 'boolean') {
      return typeof value === 'boolean';
    }
    if (schemaType === 'array') {
      return Array.isArray(value);
    }
    if (schemaType === 'object') {
      return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }
    return true;
  }

  function validateArgumentsAgainstSchema(schema, value, path = 'arguments') {
    const targetSchema = schema && typeof schema === 'object' ? schema : {};
    if (Array.isArray(targetSchema.anyOf) && targetSchema.anyOf.length) {
      const matched = targetSchema.anyOf.some((entry) => validateArgumentsAgainstSchema(entry, value, path).ok);
      return matched
        ? { ok: true }
        : { ok: false, error: `${path} does not satisfy any allowed schema branch.` };
    }
    const schemaType = cleanText(targetSchema.type, 30);
    if (schemaType && !validatePrimitiveByType(value, schemaType)) {
      return { ok: false, error: `${path} must be of type ${schemaType}.` };
    }
    if (schemaType === 'integer' && Number.isFinite(Number(targetSchema.minimum)) && Number(value) < Number(targetSchema.minimum)) {
      return { ok: false, error: `${path} must be >= ${Number(targetSchema.minimum)}.` };
    }
    if (schemaType === 'integer' && Number.isFinite(Number(targetSchema.maximum)) && Number(value) > Number(targetSchema.maximum)) {
      return { ok: false, error: `${path} must be <= ${Number(targetSchema.maximum)}.` };
    }
    if (schemaType === 'number' && Number.isFinite(Number(targetSchema.minimum)) && Number(value) < Number(targetSchema.minimum)) {
      return { ok: false, error: `${path} must be >= ${Number(targetSchema.minimum)}.` };
    }
    if (schemaType === 'number' && Number.isFinite(Number(targetSchema.maximum)) && Number(value) > Number(targetSchema.maximum)) {
      return { ok: false, error: `${path} must be <= ${Number(targetSchema.maximum)}.` };
    }
    if (Array.isArray(targetSchema.enum) && targetSchema.enum.length && !targetSchema.enum.includes(value)) {
      return { ok: false, error: `${path} must be one of: ${targetSchema.enum.join(', ')}.` };
    }
    if (schemaType === 'array' && targetSchema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const child = validateArgumentsAgainstSchema(targetSchema.items, value[index], `${path}[${index}]`);
        if (!child.ok) {
          return child;
        }
      }
    }
    if (schemaType === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      const properties = targetSchema.properties && typeof targetSchema.properties === 'object'
        ? targetSchema.properties
        : {};
      const required = asArray(targetSchema.required).map((item) => cleanText(item, 120)).filter(Boolean);
      for (const requiredKey of required) {
        if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
          return { ok: false, error: `${path}.${requiredKey} is required.` };
        }
      }
      if (targetSchema.additionalProperties === false) {
        const unknownKey = Object.keys(value).find((key) => !Object.prototype.hasOwnProperty.call(properties, key));
        if (unknownKey) {
          return { ok: false, error: `${path}.${unknownKey} is not allowed.` };
        }
      }
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          continue;
        }
        const child = validateArgumentsAgainstSchema(propertySchema, value[key], `${path}.${key}`);
        if (!child.ok) {
          return child;
        }
      }
    }
    return { ok: true };
  }

  function normalizeToolCall(call) {
    const source = call && typeof call === 'object' ? call : {};
    return {
      callId: cleanText(source.callId || source.call_id || source.id, 120),
      name: cleanText(source.name || source.tool_name, 120),
      argsText: cleanText(source.argsText || source.arguments || source.args, 12000)
    };
  }

  function hasExternalCitation(citations) {
    return asArray(citations).some((citation) => {
      const source = cleanText(citation?.source, 120).toLowerCase();
      return ['pubmed', 'crossref', 'europe_pmc', 'uniprot', 'web_source'].includes(source);
    });
  }

  function hasInternalCitation(citations) {
    return asArray(citations).some((citation) => {
      const source = cleanText(citation?.source, 120).toLowerCase();
      return ['project', 'protocol', 'notebook_entry', 'workflow', 'assay', 'gel_analysis', 'paper', 'python_sandbox', 'python-sandbox', 'record-lookup'].includes(source);
    });
  }

  function buildProjectLabel(project = null) {
    const source = project && typeof project === 'object' ? project : null;
    if (!source) {
      return '';
    }
    const projectName = cleanText(source.name, 220);
    const projectId = cleanText(source.id, 120);
    if (projectName && projectId) {
      return `${projectName} (${projectId})`;
    }
    return projectName || projectId || '';
  }

  function buildPolicyHints(policy = {}) {
    const source = policy && typeof policy === 'object' ? policy : {};
    return uniqueStrings([
      cleanText(source.retrieval_priority, 120)
        ? `Retrieval preference: ${cleanText(source.retrieval_priority, 120)}.`
        : '',
      source.require_external_citation_when_recent === true
        ? 'Use an external citation when the clarified request depends on freshness or recency.'
        : '',
      source.require_retrieval_attempt === true
        ? 'Make at least one evidence-gathering attempt before answering.'
        : '',
      source.answer_with_limitations_after_attempt === true
        ? 'A limitation-qualified answer is acceptable after a best-effort evidence attempt.'
        : '',
      source.require_project_resolution === true
        ? 'Project resolution must be established before project-specific reasoning.'
        : '',
      source.distinguish_internal_vs_external === true
        ? 'Keep internal evidence clearly separated from external evidence.'
        : '',
      source.require_compute_for_numeric_queries === true
        ? 'Prefer deterministic computation for numeric or transformation-heavy questions.'
        : ''
    ], 6);
  }

  function buildRoutePlanHints(routePlan = {}) {
    const source = routePlan && typeof routePlan === 'object' ? routePlan : {};
    const toolSuggestions = asArray(source.tool_call_suggestions)
      .slice(0, 3)
      .map((item) => cleanText(item?.tool_name, 120))
      .filter(Boolean);
    return uniqueStrings([
      cleanText(source.goal, 260) ? `Loop goal: ${cleanText(source.goal, 260)}` : '',
      cleanText(source.route_summary, 300) ? `Route summary: ${cleanText(source.route_summary, 300)}` : '',
      toolSuggestions.length ? `Preferred tools: ${toolSuggestions.join(' | ')}` : '',
      source.reference_only === true ? 'Route suggestions are guidance only.' : ''
    ], 4);
  }

  function buildExitCriteriaHints(exitCriteria = {}) {
    const source = exitCriteria && typeof exitCriteria === 'object' ? exitCriteria : {};
    const preferredTools = uniqueStrings(source.preferred_next_tools, 3);
    const exitCondition = uniqueStrings(source.exit_conditions, 1)[0] || '';
    const requiredEvidence = uniqueStrings(source.required_evidence, 1)[0] || '';
    const continueWhen = uniqueStrings(source.continue_when, 1)[0] || '';
    const limitations = uniqueStrings(source.can_exit_with_limitations_when, 1)[0] || '';
    return uniqueStrings([
      cleanText(source.objective_summary, 260) ? `Objective: ${cleanText(source.objective_summary, 260)}` : '',
      exitCondition ? `Exit when: ${cleanText(exitCondition, 260)}` : '',
      requiredEvidence ? `Required evidence: ${cleanText(requiredEvidence, 260)}` : '',
      continueWhen ? `Continue when: ${cleanText(continueWhen, 260)}` : '',
      limitations ? `Limitations rule: ${cleanText(limitations, 260)}` : '',
      preferredTools.length ? `Preferred tools: ${preferredTools.join(' | ')}` : ''
    ], 5);
  }

  function buildExecutionHintsSection({ project, routePlan, exitCriteria }) {
    const lines = uniqueStrings([
      buildProjectLabel(project) ? `Project: ${buildProjectLabel(project)}` : '',
      ...buildRoutePlanHints(routePlan),
      ...buildExitCriteriaHints(exitCriteria)
    ], 10);
    if (!lines.length) {
      return '';
    }
    return `Execution hints:\n${lines.map((line) => `- ${line}`).join('\n')}`;
  }

  function buildScienceSessionSystemPrompt({
    baseSystemPrompt = '',
    policy,
    routing,
    project,
    clarification,
    routePlan,
    exitCriteria,
    message,
    reasoningEffort,
    directAnswerOnly = false
  }) {
    const rules = directAnswerOnly === true
      ? [
        'Answer directly without entering the deterministic science reasoning loop.',
        'Provide a complete answer: lead with the main conclusion, then explain the key reasoning and any important caveats.',
        'Do not be artificially terse unless the user explicitly asked for a short answer.',
        'Do not call tools or ask to enter a reasoning loop.',
        'Use stable scientific knowledge plus the provided context only.',
        'Do not fabricate project records, literature results, or computation outputs.'
      ]
      : [
        'You are inside a deterministic science reasoning loop.',
        'At each assistant turn, either call one or more independent tools or answer directly if you already have sufficient evidence.',
        'If multiple tool calls would help, keep them tightly scoped and independent so they can be executed in parallel as one evidence round.',
        'Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.',
        'When you give the final answer, include enough detail to explain the conclusion, supporting evidence, and material caveats.',
        'Do not compress the final answer to one or two sentences unless the user explicitly asked for brevity.',
        'Treat any route plan as non-binding guidance; adapt when the actual evidence suggests a better next step.',
        'If a tool result is weak or empty, choose a more targeted next tool or tool batch on the following turn.',
        'Do not fabricate project records, literature results, or computation outputs.'
      ];
    return [
      cleanText(baseSystemPrompt, 12000),
      directAnswerOnly === true ? 'Execution mode: direct answer only.' : '',
      buildExecutionHintsSection({
        project,
        routePlan,
        exitCriteria
      }),
      directAnswerOnly !== true ? 'The clarified execution request is provided separately as the session message.' : '',
      rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')
    ].filter(Boolean).join('\n\n');
  }

  function buildEvaluatorFeedback(evaluation, intent) {
    const missing = uniqueStrings(asArray(evaluation?.missing_requirements), 6);
    const nextTool = evaluation?.next_tool_hint && typeof evaluation.next_tool_hint === 'object'
      ? evaluation.next_tool_hint
      : null;
    return [
      `Evaluator feedback for ${cleanText(intent, 80) || 'science'}: the previous result is not sufficient yet.`,
      cleanText(evaluation?.reason, 320) ? `Reason: ${cleanText(evaluation.reason, 320)}` : '',
      missing.length ? `Missing requirements: ${missing.join('; ')}` : '',
      nextTool?.tool_name ? `Suggested next tool: ${cleanText(nextTool.tool_name, 120)}.` : '',
      nextTool?.query ? `Suggested query refinement: ${cleanText(nextTool.query, 320)}` : '',
      nextTool?.reason ? `Why: ${cleanText(nextTool.reason, 260)}` : '',
      'Please continue with the next best tool call or tightly scoped parallel tool batch, or answer directly only if the evidence is now sufficient.'
    ].filter(Boolean).join('\n');
  }

  function buildFallbackAnswer({
    latestAssistantText,
    evaluator,
    toolTrace
  }) {
    const missing = uniqueStrings(asArray(evaluator?.missing_requirements), 5);
    const latestSummary = cleanText(asArray(toolTrace).slice(-1)[0]?.summary, 320);
    const parts = [
      cleanText(latestAssistantText, 4000),
      missing.length ? `Remaining gaps: ${missing.join('; ')}.` : '',
      latestSummary ? `Latest tool summary: ${latestSummary}` : ''
    ].filter(Boolean);
    return parts.join('\n\n') || 'I could not gather enough evidence to produce a confident answer.';
  }

  function buildSyntheticToolEnvelope(toolName, args, roundIndex, errorMessage) {
    return {
      ok: false,
      tool_name: cleanText(toolName, 120),
      input: args && typeof args === 'object' ? args : {},
      result: {
        items: [],
        citations: [],
        summary: cleanText(errorMessage, 320) || 'Tool invocation failed before execution.'
      },
      items: [],
      citations: [],
      summary: cleanText(errorMessage, 320) || 'Tool invocation failed before execution.',
      error: cleanText(errorMessage, 600) || 'Tool invocation failed before execution.',
      round: roundIndex
    };
  }

  return {
    normalizeProject,
    normalizeCitations,
    normalizeLoadedContextBlocks,
    formatLoadedContextBlocks,
    normalizeDecisionRecord,
    buildIntermediateState,
    buildNeedsMoreInfoResult,
    buildToolSchemaMap,
    validateArgumentsAgainstSchema,
    normalizeToolCall,
    buildScienceSessionSystemPrompt,
    buildEvaluatorFeedback,
    buildFallbackAnswer,
    buildSyntheticToolEnvelope,
    hasExternalCitation,
    hasInternalCitation
  };
}

module.exports = {
  createScienceLoopSupport
};
