const { selectToolsForRequest } = require('./agent-tools');
const { resolveProtocolMatch } = require('./agent-protocol-matching');
const { resolveProjectScope } = require('./agent-project-retrieval');
const { resolvePaperRequest } = require('./agent-paper-analysis');
const { classifyPythonTask, buildPythonRunRequest } = require('./agent-python-orchestration');
const {
  mapCanonicalIntentToExecutionIntent,
  normalizeParserEntitiesToRoutingEntities
} = require('./agent-intent-parser');

const ROUTING_INTENTS = Object.freeze([
  'protocol_to_notebook',
  'inventory_lookup',
  'record_lookup',
  'project_science_question',
  'paper_analysis',
  'coding_data_analysis',
  'general_science_question'
]);

const AGENT_MVP_SCOPE = Object.freeze({
  phase0: Object.freeze({
    mvpFeatures: Object.freeze([
      'user writes plain text lab activity',
      'agent matches protocol',
      'agent asks follow-up when ambiguous',
      'agent generates notebook page',
      'agent answers lab data questions through tools in agent-io-contract.json'
    ]),
    supportedRequestTypes: Object.freeze([
      'protocol_to_notebook',
      'inventory_lookup',
      'record_lookup',
      'project_science_question',
      'paper_analysis',
      'coding_data_analysis',
      'general_science_question',
      'literature_search',
      'data_analysis_or_coding',
      'mixed_request',
      'unclear'
    ]),
    doneCriteria: Object.freeze({
      protocol_matching: 'top 3 candidate protocols can be returned',
      notebook_generation: 'output follows a fixed JSON schema',
      inventory_lookup: 'tools can be selected from agent-io-contract.json',
      paper_handling: 'uploaded PDFs can be read and non-uploaded papers trigger an upload request'
    })
  })
});

const DEFAULT_INTENT = 'general_science_question';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 1200) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 220);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function normalizeRoutingEntities(rawEntities) {
  const source = rawEntities && typeof rawEntities === 'object' ? rawEntities : {};
  return {
    activity: cleanText(source.activity, 180),
    project: cleanText(source.project, 180),
    protein: cleanText(source.protein, 100),
    compound: cleanText(source.compound, 120),
    protocol: cleanText(source.protocol, 220),
    cell_line: cleanText(source.cell_line, 80),
    paper_title: cleanText(source.paper_title, 220),
    workflow_step: cleanText(source.workflow_step, 180)
  };
}

function isEntityMissing(entity, key) {
  return !cleanText(entity?.[key], 240);
}

function buildExecutionPlan({
  intent,
  entities,
  message,
  writeIntent = false
}) {
  const normalizedIntent = ROUTING_INTENTS.includes(intent) ? intent : DEFAULT_INTENT;
  const text = cleanText(message, 3000).toLowerCase();
  const plan = {
    needs_tools: false,
    needs_protocol_search: false,
    needs_notebook_retrieval: false,
    needs_project_retrieval: false,
    needs_workflow_retrieval: false,
    needs_paper_retrieval: false,
    needs_deep_paper_reading: false,
    needs_paper_comparison: false,
    needs_notebook_generation: false,
    notebook_autosave: false,
    needs_pdf_reading: false,
    needs_python: false,
    needs_web_search: false,
    python_task_type: '',
    python_ready: false,
    python_needs_clarification: false,
    python_artifact_count: 0,
    web_fallback_triggered: false,
    web_fallback_reason: '',
    web_queries: [],
    web_sources: [],
    inventory_search: {
      normalized_query: '',
      candidate_terms: [],
      aliases: [],
      search_mode: ''
    },
    needs_clarification: false,
    clarification_reason: '',
    clarification_question: '',
    selected_tool_names: [],
    paper_task_mode: 'general_paper_query',
    paper_match: {
      selected_paper_id: '',
      selected_paper_title: '',
      secondary_paper_id: '',
      secondary_paper_title: '',
      top_score: 0,
      score_delta: 0,
      needs_clarification: false,
      ambiguity_reason: '',
      availability_status: '',
      deep_read_ready: false,
      secondary_availability_status: '',
      secondary_deep_read_ready: false,
      comparison_summary: ''
    },
    paper_candidates: [],
    protocol_match: {
      selected_protocol_id: '',
      selected_protocol_name: '',
      top_score: 0,
      score_delta: 0,
      needs_clarification: false,
      ambiguity_reason: ''
    },
    protocol_candidates: [],
    project_match: {
      selected_project_id: '',
      selected_project_name: '',
      top_score: 0,
      score_delta: 0,
      needs_clarification: false,
      ambiguity_reason: '',
      resolution_source: ''
    },
    project_candidates: []
  };

  if (normalizedIntent === 'protocol_to_notebook') {
    plan.needs_tools = true;
    plan.needs_protocol_search = true;
    plan.needs_notebook_generation = true;
    plan.notebook_autosave = true;
  } else if (normalizedIntent === 'inventory_lookup') {
    plan.needs_tools = true;
  } else if (normalizedIntent === 'record_lookup') {
    plan.needs_tools = true;
    plan.needs_notebook_retrieval = true;
    plan.needs_workflow_retrieval = true;
  } else if (normalizedIntent === 'project_science_question') {
    plan.needs_tools = true;
    plan.needs_project_retrieval = true;
    plan.needs_workflow_retrieval = true;
    plan.needs_notebook_retrieval = true;
  } else if (normalizedIntent === 'paper_analysis') {
    plan.needs_tools = true;
    plan.needs_paper_retrieval = true;
    plan.needs_pdf_reading = true;
  } else if (normalizedIntent === 'coding_data_analysis') {
    plan.needs_tools = true;
    plan.needs_python = true;
  } else {
    plan.needs_web_search = /latest|recent|new|review|citation|reference/.test(text);
    plan.needs_tools = plan.needs_web_search;
  }

  if (writeIntent) {
    plan.needs_tools = true;
  }

  if (normalizedIntent === 'protocol_to_notebook' && isEntityMissing(entities, 'activity') && isEntityMissing(entities, 'protocol')) {
    plan.needs_clarification = true;
    plan.clarification_reason = 'Protocol workflow is ambiguous.';
    plan.clarification_question = 'Which lab activity should I map to a protocol (for example cell maintenance, transfection, purification, or assay setup)?';
  }

  if (normalizedIntent === 'inventory_lookup' && isEntityMissing(entities, 'compound') && isEntityMissing(entities, 'protein')) {
    plan.needs_clarification = true;
    plan.clarification_reason = 'Inventory lookup target is missing.';
    plan.clarification_question = 'Which reagent, compound, or protein should I look up?';
  }

  if (normalizedIntent === 'record_lookup' && isEntityMissing(entities, 'workflow_step') && isEntityMissing(entities, 'protocol') && !/last time|history|record/.test(text)) {
    plan.needs_clarification = true;
    plan.clarification_reason = 'Record lookup target is underspecified.';
    plan.clarification_question = 'Which prior record do you want: notebook entry, workflow step, assay run, or gel analysis?';
  }

  if (normalizedIntent === 'paper_analysis' && isEntityMissing(entities, 'paper_title') && !/paper|pdf|literature|journal/.test(text)) {
    plan.needs_clarification = true;
    plan.clarification_reason = 'Paper target is missing.';
    plan.clarification_question = 'Which paper should I analyze? You can provide a title or upload a PDF.';
  }

  return plan;
}

function normalizeProtocolCandidates(candidates) {
  return asArray(candidates).slice(0, 3).map((candidate) => ({
    protocol_id: cleanText(candidate?.protocol_id, 80),
    protocol_name: cleanText(candidate?.protocol_name, 220),
    category: cleanText(candidate?.category, 80),
    score: Number.isFinite(Number(candidate?.score)) ? Number(candidate.score) : 0,
    semantic_score: Number.isFinite(Number(candidate?.semantic_score)) ? Number(candidate.semantic_score) : 0,
    entity_overlap_score: Number.isFinite(Number(candidate?.entity_overlap_score))
      ? Number(candidate.entity_overlap_score)
      : 0,
    project_relevance_score: Number.isFinite(Number(candidate?.project_relevance_score))
      ? Number(candidate.project_relevance_score)
      : 0,
    recent_workflow_relevance_score: Number.isFinite(Number(candidate?.recent_workflow_relevance_score))
      ? Number(candidate.recent_workflow_relevance_score)
      : 0,
    reason: cleanText(candidate?.reason, 220),
    steps: asArray(candidate?.steps).map((step) => cleanText(step, 220)).filter(Boolean).slice(0, 8)
  })).filter((candidate) => candidate.protocol_name);
}

function normalizeProjectCandidates(candidates) {
  return asArray(candidates).slice(0, 3).map((candidate) => ({
    project_id: cleanText(candidate?.project_id, 80),
    project_name: cleanText(candidate?.project_name, 220),
    score: Number.isFinite(Number(candidate?.score)) ? Number(candidate.score) : 0,
    exact_name_score: Number.isFinite(Number(candidate?.exact_name_score)) ? Number(candidate.exact_name_score) : 0,
    partial_name_score: Number.isFinite(Number(candidate?.partial_name_score)) ? Number(candidate.partial_name_score) : 0,
    selected_bias_score: Number.isFinite(Number(candidate?.selected_bias_score)) ? Number(candidate.selected_bias_score) : 0,
    linked_record_support_score: Number.isFinite(Number(candidate?.linked_record_support_score))
      ? Number(candidate.linked_record_support_score)
      : 0,
    reason: cleanText(candidate?.reason, 220)
  })).filter((candidate) => candidate.project_id || candidate.project_name);
}

function normalizePaperCandidates(candidates) {
  return asArray(candidates).slice(0, 3).map((candidate) => ({
    paper_id: cleanText(candidate?.paper_id, 80),
    paper_title: cleanText(candidate?.paper_title, 320),
    linked_project_name: cleanText(candidate?.linked_project_name, 220),
    score: Number.isFinite(Number(candidate?.score)) ? Number(candidate.score) : 0,
    semantic_score: Number.isFinite(Number(candidate?.semantic_score)) ? Number(candidate.semantic_score) : 0,
    title_score: Number.isFinite(Number(candidate?.title_score)) ? Number(candidate.title_score) : 0,
    entity_overlap_score: Number.isFinite(Number(candidate?.entity_overlap_score))
      ? Number(candidate.entity_overlap_score)
      : 0,
    project_relevance_score: Number.isFinite(Number(candidate?.project_relevance_score))
      ? Number(candidate.project_relevance_score)
      : 0,
    availability_status: cleanText(candidate?.availability_status, 80),
    deep_read_ready: candidate?.deep_read_ready === true,
    has_uploaded_pdf: candidate?.has_uploaded_pdf === true,
    reason: cleanText(candidate?.reason, 220)
  })).filter((candidate) => candidate.paper_id || candidate.paper_title);
}

function applyProtocolMatchingToPlan({
  intent,
  message,
  entities,
  plan,
  snapshot = {}
}) {
  if (intent !== 'protocol_to_notebook') {
    return plan;
  }

  const match = resolveProtocolMatch({
    message,
    entities,
    protocols: asArray(snapshot.protocols),
    projects: asArray(snapshot.projects),
    notebookEntries: asArray(snapshot.notebookEntries),
    maxCandidates: 3
  });
  const candidates = normalizeProtocolCandidates(match?.candidates);
  const selected = match?.selected && typeof match.selected === 'object' ? match.selected : {};
  const ambiguity = match?.ambiguity && typeof match.ambiguity === 'object' ? match.ambiguity : {};

  plan.protocol_match = {
    selected_protocol_id: cleanText(selected.protocol_id, 80),
    selected_protocol_name: cleanText(selected.protocol_name, 220),
    top_score: Number.isFinite(Number(ambiguity.top_score)) ? Number(ambiguity.top_score) : 0,
    score_delta: Number.isFinite(Number(ambiguity.score_delta)) ? Number(ambiguity.score_delta) : 0,
    needs_clarification: ambiguity.needs_clarification === true,
    ambiguity_reason: cleanText(ambiguity.ambiguity_reason, 220)
  };
  plan.protocol_candidates = candidates;

  if (ambiguity.needs_clarification === true) {
    plan.needs_clarification = true;
    plan.clarification_reason = cleanText(ambiguity.ambiguity_reason, 220) || 'Protocol workflow is ambiguous.';
    plan.clarification_question = cleanText(ambiguity.clarification_question, 320)
      || plan.clarification_question
      || 'Which protocol matches your workflow?';
  }

  return plan;
}

function applyProjectMatchingToPlan({
  intent,
  message,
  entities,
  plan,
  snapshot = {},
  selectedProjectId = '',
  selectedProjectName = ''
}) {
  if (intent !== 'project_science_question') {
    return plan;
  }

  const indexProjects = asArray(snapshot.projects).map((project) => ({
    id: cleanText(project?.id, 80),
    name: cleanText(project?.name, 220),
    summary: cleanText(project?.summary || project?.description || project?.objective, 500)
  })).filter((project) => project.id || project.name);

  const scoped = resolveProjectScope({
    message,
    entities,
    selectedProjectId,
    selectedProjectName,
    projects: indexProjects,
    index: snapshot.projectIndex || null
  });
  const projectMatch = scoped?.project_match && typeof scoped.project_match === 'object'
    ? scoped.project_match
    : {};

  plan.project_match = {
    selected_project_id: cleanText(projectMatch.selected_project_id, 80),
    selected_project_name: cleanText(projectMatch.selected_project_name, 220),
    top_score: Number.isFinite(Number(projectMatch.top_score)) ? Number(projectMatch.top_score) : 0,
    score_delta: Number.isFinite(Number(projectMatch.score_delta)) ? Number(projectMatch.score_delta) : 0,
    needs_clarification: projectMatch.needs_clarification === true,
    ambiguity_reason: cleanText(projectMatch.ambiguity_reason, 220),
    resolution_source: cleanText(projectMatch.resolution_source, 80)
  };
  plan.project_candidates = normalizeProjectCandidates(scoped?.project_candidates);

  if (projectMatch.needs_clarification === true) {
    plan.needs_clarification = true;
    plan.clarification_reason = cleanText(projectMatch.ambiguity_reason, 220) || 'Project scope is ambiguous.';
    plan.clarification_question = cleanText(scoped?.clarification_question, 320)
      || plan.clarification_question
      || 'Which project should I use for this question?';
  }

  return plan;
}

function applyPaperMatchingToPlan({
  intent,
  message,
  entities,
  plan,
  snapshot = {}
}) {
  if (intent !== 'paper_analysis') {
    return plan;
  }

  const match = resolvePaperRequest({
    message,
    entities,
    papers: asArray(snapshot.papers),
    projects: asArray(snapshot.projects),
    maxCandidates: 6
  });
  const selected = match?.selected && typeof match.selected === 'object' ? match.selected : {};
  const secondary = match?.secondary_selected && typeof match.secondary_selected === 'object'
    ? match.secondary_selected
    : {};
  const availability = match?.availability && typeof match.availability === 'object' ? match.availability : {};
  const secondaryAvailability = match?.secondary_availability && typeof match.secondary_availability === 'object'
    ? match.secondary_availability
    : {};
  const candidates = normalizePaperCandidates(match?.candidates);

  plan.needs_paper_retrieval = true;
  plan.paper_task_mode = cleanText(match?.mode, 80) || 'general_paper_query';
  plan.needs_paper_comparison = plan.paper_task_mode === 'compare_papers';
  plan.needs_deep_paper_reading = match?.requires_deep_reading === true;
  if (plan.needs_deep_paper_reading) {
    plan.needs_pdf_reading = true;
  }

  plan.paper_match = {
    selected_paper_id: cleanText(selected.paper_id, 80),
    selected_paper_title: cleanText(selected.paper_title, 320),
    secondary_paper_id: cleanText(secondary.paper_id, 80),
    secondary_paper_title: cleanText(secondary.paper_title, 320),
    top_score: Number.isFinite(Number(match?.top_score)) ? Number(match.top_score) : 0,
    score_delta: Number.isFinite(Number(match?.score_delta)) ? Number(match.score_delta) : 0,
    needs_clarification: match?.needs_clarification === true,
    ambiguity_reason: cleanText(match?.ambiguity_reason, 220),
    availability_status: cleanText(availability.availability_status, 80),
    deep_read_ready: availability.deep_read_ready === true,
    secondary_availability_status: cleanText(secondaryAvailability.availability_status, 80),
    secondary_deep_read_ready: secondaryAvailability.deep_read_ready === true,
    comparison_summary: cleanText(match?.comparison_summary, 2200)
  };
  plan.paper_candidates = candidates;

  const paperClarificationBlocksExecution = match?.needs_clarification === true
    && (
      match?.requires_deep_reading === true
      || cleanText(match?.mode, 80) === 'compare_papers'
    );
  if (!paperClarificationBlocksExecution && cleanText(plan.clarification_reason, 220) === 'Paper target is missing.') {
    plan.needs_clarification = false;
    plan.clarification_reason = '';
    plan.clarification_question = '';
  }
  if (paperClarificationBlocksExecution) {
    plan.needs_clarification = true;
    plan.clarification_reason = cleanText(match?.ambiguity_reason, 220) || 'Paper selection is ambiguous.';
    plan.clarification_question = cleanText(match?.clarification_question, 320)
      || plan.clarification_question
      || 'Which paper should I use?';
  }

  return plan;
}

function applyPythonPlanningToPlan({
  intent,
  message,
  entities,
  plan,
  snapshot = {},
  selectedProjectId = '',
  selectedProjectName = ''
}) {
  if (intent !== 'coding_data_analysis' && plan?.needs_python !== true) {
    return plan;
  }

  const pythonTask = classifyPythonTask({
    message,
    entities,
    routing: {
      intent,
      plan
    }
  });
  const runSpec = buildPythonRunRequest({
    message,
    snapshot,
    projectId: cleanText(selectedProjectId, 80),
    projectName: cleanText(selectedProjectName || entities?.project, 180),
    taskType: cleanText(pythonTask?.task_type, 80) || 'general_compute'
  });

  plan.needs_python = true;
  plan.needs_tools = true;
  plan.python_task_type = cleanText(runSpec?.task_type || pythonTask?.task_type, 80) || 'general_compute';
  plan.python_ready = runSpec?.ready === true;
  plan.python_needs_clarification = runSpec?.needs_clarification === true;
  plan.python_artifact_count = 0;

  if (runSpec?.needs_clarification === true) {
    plan.needs_clarification = true;
    plan.clarification_reason = cleanText(runSpec?.reason, 220) || 'Python task requires additional input data.';
    plan.clarification_question = cleanText(runSpec?.clarification_question, 320)
      || plan.clarification_question
      || 'Please provide the required input data for the Python analysis task.';
  }

  return plan;
}

function selectToolNamesForPlan(plan, availableToolNames = []) {
  const available = new Set(uniqueStrings(availableToolNames));
  const selected = [];
  const add = (name) => {
    if (!name || selected.includes(name)) {
      return;
    }
    if (available.size && !available.has(name)) {
      return;
    }
    selected.push(name);
  };

  if (!plan || plan.needs_tools !== true) {
    return selected;
  }

  if (plan.needs_protocol_search) {
    add('search_protocols');
  }
  if (plan.needs_notebook_retrieval) {
    add('search_notebook_entries');
    add('search_assays');
    add('search_gel_analyses');
  }
  if (plan.needs_workflow_retrieval) {
    add('search_workflows');
  }
  if (plan.needs_paper_retrieval) {
    add('search_papers');
  }
  if (plan.needs_pdf_reading) {
    add('search_papers');
  }
  if (plan.needs_python) {
    add('run_python_sandbox');
  }
  if (plan.needs_web_search) {
    add('search_web');
    add('search_pubmed');
    add('search_crossref');
    add('search_europe_pmc');
  }

  add('search_projects');
  if (!plan.needs_protocol_search) {
    add('search_protocols');
  }
  if (!plan.needs_notebook_retrieval) {
    add('search_notebook_entries');
  }
  if (!plan.needs_workflow_retrieval) {
    add('search_workflows');
  }
  add('search_inventory');
  if (!plan.needs_pdf_reading && !plan.needs_paper_retrieval) {
    add('search_papers');
  }

  return selected;
}

function normalizeInventorySearch(rawInventorySearch) {
  const source = rawInventorySearch && typeof rawInventorySearch === 'object' ? rawInventorySearch : {};
  return {
    normalized_query: cleanText(source.normalized_query, 220),
    candidate_terms: uniqueStrings(asArray(source.candidate_terms)).slice(0, 10),
    aliases: uniqueStrings(asArray(source.aliases)).slice(0, 10),
    search_mode: cleanText(source.search_mode, 60)
  };
}

function buildParserClarificationQuestion({
  parserIntent,
  parserNeedsClarification = false,
  parserClarificationReason = '',
  parserReasoningSummary = ''
}) {
  const intent = cleanText(parserIntent, 80);
  const reason = cleanText(parserClarificationReason, 220) || cleanText(parserReasoningSummary, 220);
  if (intent === 'mixed_request') {
    return 'I detected multiple goals. Which should I handle first: protocol drafting, inventory lookup, record lookup, project question, paper analysis, literature search, or coding/data analysis?';
  }
  if (intent === 'unclear') {
    return 'Could you clarify your primary goal so I can route correctly: protocol drafting, inventory lookup, record lookup, project question, paper analysis, literature search, or coding/data analysis?';
  }
  if (parserNeedsClarification) {
    if (intent === 'inventory_lookup') {
      return reason || 'Which inventory item or chemical should I look up?';
    }
    if (intent === 'paper_analysis') {
      return reason || 'Which paper should I analyze?';
    }
    if (intent === 'project_science_question') {
      return reason || 'Which project should I use for this question?';
    }
    return reason || 'Could you clarify what you want me to do first?';
  }
  return '';
}

function buildRoutingDecisionFromIntentParser({
  parserPayload,
  message,
  snapshot = {},
  availableToolNames = [],
  toolContract = null,
  writeIntent = false,
  selectedProjectId = '',
  selectedProjectName = ''
}) {
  const parsed = parserPayload && typeof parserPayload === 'object' ? parserPayload : {};
  const parserIntent = cleanText(parsed.primary_intent, 80);
  const parserSecondaryIntents = uniqueStrings(parsed.secondary_intents).slice(0, 5);
  const mappedIntent = mapCanonicalIntentToExecutionIntent(parserIntent);
  const parserEntities = parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {};
  const entities = normalizeRoutingEntities(normalizeParserEntitiesToRoutingEntities(parserEntities, parserIntent));
  const context = {
    projects: asArray(snapshot.projects),
    protocols: asArray(snapshot.protocols),
    notebookEntries: asArray(snapshot.notebookEntries),
    workflows: asArray(snapshot.workflows),
    papers: asArray(snapshot.papers),
    assays: asArray(snapshot.assays),
    gelAnalyses: asArray(snapshot.gelAnalyses)
  };
  const plan = buildExecutionPlan({
    intent: mappedIntent,
    entities,
    message,
    writeIntent
  });
  plan.inventory_search = normalizeInventorySearch(parsed.inventory_search);
  const parserNeedsClarification = parsed.needs_clarification === true;
  const parserClarificationReason = cleanText(parsed.clarification_reason, 260);
  const parserReasoningSummary = cleanText(parsed.reasoning_summary, 300);

  applyProtocolMatchingToPlan({
    intent: mappedIntent,
    message,
    entities,
    plan,
    snapshot: context
  });
  applyProjectMatchingToPlan({
    intent: mappedIntent,
    message,
    entities,
    plan,
    snapshot: context,
    selectedProjectId,
    selectedProjectName
  });
  applyPaperMatchingToPlan({
    intent: mappedIntent,
    message,
    entities,
    plan,
    snapshot: context
  });
  applyPythonPlanningToPlan({
    intent: mappedIntent,
    message,
    entities,
    plan,
    snapshot: context,
    selectedProjectId,
    selectedProjectName
  });

  if (parserIntent === 'literature_search') {
    plan.needs_tools = true;
    plan.needs_web_search = true;
  }
  if (parserIntent === 'mixed_request' || parserIntent === 'unclear') {
    plan.needs_clarification = true;
    plan.clarification_reason = parserClarificationReason || parserReasoningSummary || 'Request scope is ambiguous.';
    plan.clarification_question = buildParserClarificationQuestion({
      parserIntent,
      parserNeedsClarification,
      parserClarificationReason,
      parserReasoningSummary
    });
  } else if (parserNeedsClarification) {
    plan.needs_clarification = true;
    plan.clarification_reason = parserClarificationReason || parserReasoningSummary || 'Intent parser requested clarification.';
    if (!plan.clarification_question) {
      plan.clarification_question = buildParserClarificationQuestion({
        parserIntent,
        parserNeedsClarification,
        parserClarificationReason,
        parserReasoningSummary
      });
    }
  }

  const selection = toolContract
    ? selectToolsForRequest({
      intent: parserIntent || mappedIntent,
      entities,
      message,
      contract: toolContract,
      allowWriteTools: writeIntent
    })
    : {
      selectedToolNames: selectToolNamesForPlan(plan, availableToolNames),
      rationaleRows: []
    };
  plan.selected_tool_names = plan.needs_tools !== true
    ? []
    : (plan.paper_task_mode === 'compare_papers'
      ? ['search_papers']
      : selection.selectedToolNames);
  plan.tool_selection_rationale = plan.paper_task_mode === 'compare_papers'
    ? [
      {
        tool: 'search_papers',
        score: 999,
        entityScore: 5,
        taskScore: 4,
        exactnessScore: 3,
        reason: 'compare mode is limited to uploaded-paper retrieval in Phase 7'
      }
    ]
    : (selection.rationaleRows || []);

  return {
    intent: mappedIntent,
    confidence: Number.isFinite(Number(parsed.confidence))
      ? Number(Math.max(0, Math.min(1, Number(parsed.confidence))).toFixed(3))
      : 0.5,
    entities,
    plan,
    classifier: {
      source: 'llm_parser',
      fallbackAttempted: false,
      fallbackUsed: false,
      lowConfidence: Number(parsed.confidence) < 0.45,
      tieDetected: false,
      ruleReason: '',
      fallbackError: '',
      parser_primary_intent: parserIntent,
      parser_secondary_intents: parserSecondaryIntents,
      parser_needs_clarification: parserNeedsClarification,
      parser_clarification_reason: parserClarificationReason,
      parser_reasoning_summary: parserReasoningSummary,
      mapped_execution_intent: mappedIntent,
      parser_entities: {
        activity_type: cleanText(parserEntities.activity_type, 180),
        project_name: cleanText(parserEntities.project_name, 180),
        protocol_name: cleanText(parserEntities.protocol_name, 220),
        protein_name: cleanText(parserEntities.protein_name, 120),
        compound_name: cleanText(parserEntities.compound_name, 120),
        inventory_item: cleanText(parserEntities.inventory_item, 120),
        cell_line: cleanText(parserEntities.cell_line, 80),
        paper_title: cleanText(parserEntities.paper_title, 220),
        workflow_step: cleanText(parserEntities.workflow_step, 180),
        requested_output: cleanText(parserEntities.requested_output, 180)
      }
    }
  };
}

function buildRoutingClarificationQuestion(routingDecision) {
  const routing = routingDecision && typeof routingDecision === 'object' ? routingDecision : {};
  const plan = routing.plan && typeof routing.plan === 'object' ? routing.plan : {};
  if (cleanText(plan.clarification_question, 300)) {
    return cleanText(plan.clarification_question, 300);
  }
  return 'Can you clarify your goal so I can route this request correctly?';
}

module.exports = {
  ROUTING_INTENTS,
  AGENT_MVP_SCOPE,
  buildExecutionPlan,
  selectToolNamesForPlan,
  buildRoutingDecisionFromIntentParser,
  buildRoutingClarificationQuestion,
  normalizeRoutingEntities
};
