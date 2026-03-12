const { selectToolsForRequest } = require('./agent-tools');
const { resolveProtocolMatch } = require('./agent-protocol-matching');
const { resolveProjectScope } = require('./agent-project-retrieval');
const { resolvePaperRequest } = require('./agent-paper-analysis');

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
      'general_science_question'
    ]),
    doneCriteria: Object.freeze({
      protocol_matching: 'top 3 candidate protocols can be returned',
      notebook_generation: 'output follows a fixed JSON schema',
      inventory_lookup: 'tools can be selected from agent-io-contract.json',
      paper_handling: 'uploaded PDFs can be read and non-uploaded papers trigger an upload request'
    })
  })
});

const ROUTING_RULE_CONFIDENCE_THRESHOLD = 0.68;
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

function tokenize(value) {
  return cleanText(value, 5000)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 60);
}

function includesAny(text, patterns) {
  const target = String(text || '').toLowerCase();
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) {
      return pattern.test(target);
    }
    return target.includes(String(pattern).toLowerCase());
  });
}

function scoreIntentByRules(message, context = {}) {
  const source = cleanText(message, 4000);
  const normalized = source.toLowerCase();
  const tokens = new Set(tokenize(source));
  const scores = {};
  ROUTING_INTENTS.forEach((intent) => {
    scores[intent] = 0;
  });

  const add = (intent, score) => {
    if (!Object.prototype.hasOwnProperty.call(scores, intent)) {
      return;
    }
    scores[intent] += score;
  };

  const hasQuestionMark = normalized.includes('?');
  const startsWithQuestionWord = /^(what|why|how|when|where|which|who)\b/.test(normalized);
  const hasProjectHint = includesAny(normalized, ['project ', 'our project', 'this project']);
  const hasKnownPaperTitle = asArray(context.papers).some((paper) => {
    const title = cleanText(paper?.title, 220).toLowerCase();
    return title && normalized.includes(title);
  });

  if (includesAny(normalized, ['notebook', 'lab note', 'i grew', 'i did', 'i ran', 'i purified', 'transfection', 'culture'])) {
    add('protocol_to_notebook', 4);
  }
  if (includesAny(normalized, ['protocol', 'sop', 'method']) && includesAny(normalized, ['write', 'draft', 'generate', 'create', 'build'])) {
    add('protocol_to_notebook', 3);
  }
  if (includesAny(normalized, ['mw', 'molecular weight', 'pi ', 'cas', 'reagent', 'chemical', 'inventory', 'stock', 'where is'])) {
    add('inventory_lookup', 5);
  }
  if (includesAny(normalized, ['notebook entry', 'what did we do', 'last time', 'record', 'history', 'assay run', 'gel run', 'workflow step', 'workflow state'])) {
    add('record_lookup', 5);
  }
  if (hasProjectHint || (context.projectNames || []).some((name) => name && normalized.includes(name.toLowerCase()))) {
    add('project_science_question', 4);
  }
  if (hasProjectHint && (hasQuestionMark || startsWithQuestionWord || includesAny(normalized, ['fail', 'failed', 'optimize', 'why']))) {
    add('project_science_question', 3);
  }
  if (includesAny(normalized, ['paper', 'pdf', 'journal', 'literature', 'publication', 'manuscript'])) {
    add('paper_analysis', 5);
  }
  if (hasKnownPaperTitle) {
    add('paper_analysis', 6);
  }
  if (includesAny(normalized, ['summarize', 'summary', 'analyze']) && includesAny(normalized, ['paper', 'pdf'])) {
    add('paper_analysis', 2);
  }
  if (includesAny(normalized, ['extract methods', 'extract method', 'extract reagents', 'key figures', 'compare'])
    && includesAny(normalized, ['paper', 'pdf'])) {
    add('paper_analysis', 4);
  }
  if (includesAny(normalized, ['extract methods', 'extract method', 'extract reagents', 'key figures', 'compare'])
    && hasKnownPaperTitle) {
    add('paper_analysis', 4);
  }
  if (includesAny(normalized, ['python', 'script', 'code', 'csv', 'plot', 'regression', 'calculate', 'compute', 'data analysis'])) {
    add('coding_data_analysis', 5);
  }
  if (startsWithQuestionWord || hasQuestionMark) {
    add('general_science_question', 2);
  }
  if (includesAny(normalized, ['explain', 'mechanism', 'biology', 'chemistry', 'science'])) {
    add('general_science_question', 1);
  }

  if (tokens.has('protein') && tokens.has('pi')) {
    add('inventory_lookup', 2);
  }
  if (tokens.has('download') && tokens.has('paper')) {
    add('paper_analysis', 2);
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const top = ranked[0] || [DEFAULT_INTENT, 0];
  const second = ranked[1] || [DEFAULT_INTENT, 0];
  const topIntent = top[1] > 0 ? top[0] : DEFAULT_INTENT;
  const diff = Math.max(0, Number(top[1] || 0) - Number(second[1] || 0));
  const baseConfidence = top[1] <= 0
    ? 0.42
    : Math.min(0.95, 0.48 + (Math.min(Number(top[1] || 0), 10) * 0.04) + (Math.min(diff, 6) * 0.05));
  const tieDetected = Number(top[1] || 0) > 0 && diff <= 1;
  const lowConfidence = baseConfidence < ROUTING_RULE_CONFIDENCE_THRESHOLD || tieDetected;
  return {
    intent: topIntent,
    confidence: Number(baseConfidence.toFixed(3)),
    scores,
    tieDetected,
    lowConfidence,
    reason: top[1] > 0 ? `Rule score ${topIntent}=${top[1]} (runner-up ${second[0]}=${second[1]}).` : 'No strong keyword signal.'
  };
}

function extractEntitiesByRules(message, context = {}) {
  const source = cleanText(message, 4000);
  const normalized = source.toLowerCase();
  const projects = asArray(context.projects);
  const protocols = asArray(context.protocols);
  const proteinMatches = [];
  const compoundMatches = [];

  const entity = {
    activity: '',
    project: '',
    protein: '',
    compound: '',
    protocol: '',
    cell_line: '',
    paper_title: '',
    workflow_step: ''
  };

  const activityPatterns = [
    /\b(grew cells?|cell culture|cultured cells?|transfection|purif(?:y|ied|ication)|ran a gel|assay|expression|conjugation)\b/i,
    /\b(i\s+(?:did|ran|performed|completed)\s+[a-z0-9\- ]{2,80})\b/i
  ];
  activityPatterns.some((pattern) => {
    const match = source.match(pattern);
    if (!match) {
      return false;
    }
    entity.activity = cleanText(match[1] || match[0], 160);
    return true;
  });

  const projectFromText = source.match(/\bproject\s+([a-z0-9\- _]{2,80})/i);
  if (projectFromText) {
    entity.project = cleanText(projectFromText[1], 120);
  } else {
    const matchedProject = projects.find((project) => {
      const name = cleanText(project?.name || '', 180);
      return name && normalized.includes(name.toLowerCase());
    });
    if (matchedProject) {
      entity.project = cleanText(matchedProject.name, 180);
    }
  }

  const protocolFromText = source.match(/\bprotocol\s*[:\-]?\s*([a-z0-9\- _]{2,120})/i);
  if (protocolFromText) {
    entity.protocol = cleanText(protocolFromText[1], 180);
  } else {
    const matchedProtocol = protocols.find((protocol) => {
      const name = cleanText(protocol?.name || '', 200);
      return name && normalized.includes(name.toLowerCase());
    });
    if (matchedProtocol) {
      entity.protocol = cleanText(matchedProtocol.name, 200);
    }
  }

  const cellLineMatch = source.match(/\b(hek293|expi293|cho|293t|hela|vero|jurkat|sf9|k562)\b/i);
  if (cellLineMatch) {
    entity.cell_line = cleanText(cellLineMatch[1], 60);
  }

  const proteinRegexes = [
    /\bprotein\s+([a-z0-9\-]{2,40})\b/ig,
    /\b([a-z0-9\-]{2,40})\s+binder\b/ig,
    /\b(pd-1|pd1|cd3|cd19|egfr|ifnγ|ifng|tnfα|tnfa)\b/ig
  ];
  proteinRegexes.forEach((pattern) => {
    let match = pattern.exec(source);
    while (match) {
      proteinMatches.push(cleanText(match[1], 80));
      match = pattern.exec(source);
    }
  });
  entity.protein = uniqueStrings(proteinMatches)[0] || '';

  const compoundRegexes = [
    /\b(?:mw|molecular weight|compound|chemical|reagent)\s+(?:of\s+)?([a-z0-9\- ]{2,80})\b/ig,
    /\b(biotin|dmso|imdz|imidazole|tris|hepes|nacl|edta)\b/ig
  ];
  compoundRegexes.forEach((pattern) => {
    let match = pattern.exec(source);
    while (match) {
      compoundMatches.push(cleanText(match[1], 80));
      match = pattern.exec(source);
    }
  });
  entity.compound = uniqueStrings(compoundMatches)[0] || '';

  const quotedTitle = source.match(/["“”']([^"“”']{8,220})["“”']/);
  if (quotedTitle && includesAny(normalized, ['paper', 'pdf', 'journal', 'manuscript'])) {
    entity.paper_title = cleanText(quotedTitle[1], 220);
  } else {
    const paperTail = source.match(/\bpaper\s+(.{4,220})$/i);
    if (paperTail) {
      entity.paper_title = cleanText(paperTail[1], 220);
    }
  }

  const workflowMatch = source.match(/\b(after|before|next|step|workflow)\s+([a-z0-9\- ]{2,100})/i);
  if (workflowMatch) {
    entity.workflow_step = cleanText(workflowMatch[2], 120);
  }

  return entity;
}

function isEntityMissing(entity, key) {
  return !cleanText(entity?.[key], 240);
}

function buildExecutionPlan({
  intent,
  entities,
  message,
  writeIntent = false,
  classificationConfidence = 0,
  fallbackUsed = false,
  tieDetected = false
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
    plan.needs_tools = false;
    plan.needs_web_search = /latest|recent|new|review|citation|reference/.test(text);
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

  if (!fallbackUsed && (tieDetected || classificationConfidence < ROUTING_RULE_CONFIDENCE_THRESHOLD - 0.06)) {
    plan.needs_clarification = true;
    if (!plan.clarification_reason) {
      plan.clarification_reason = 'Intent confidence is low.';
    }
    if (!plan.clarification_question) {
      plan.clarification_question = 'Can you clarify whether you want protocol drafting, lab record lookup, project reasoning, paper analysis, coding help, or a general science answer?';
    }
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

function buildRuleBasedRoutingDecision({
  message,
  snapshot = {},
  availableToolNames = [],
  toolContract = null,
  writeIntent = false,
  selectedProjectId = '',
  selectedProjectName = ''
}) {
  const context = {
    projects: asArray(snapshot.projects),
    protocols: asArray(snapshot.protocols),
    notebookEntries: asArray(snapshot.notebookEntries),
    workflows: asArray(snapshot.workflows),
    papers: asArray(snapshot.papers),
    assays: asArray(snapshot.assays),
    gelAnalyses: asArray(snapshot.gelAnalyses),
    projectNames: asArray(snapshot.projects).map((project) => cleanText(project?.name, 180)).filter(Boolean)
  };
  const classification = scoreIntentByRules(message, context);
  const entities = extractEntitiesByRules(message, context);
  const plan = buildExecutionPlan({
    intent: classification.intent,
    entities,
    message,
    writeIntent,
    classificationConfidence: classification.confidence,
    fallbackUsed: false,
    tieDetected: classification.tieDetected
  });
  applyProtocolMatchingToPlan({
    intent: classification.intent,
    message,
    entities,
    plan,
    snapshot: context
  });
  applyProjectMatchingToPlan({
    intent: classification.intent,
    message,
    entities,
    plan,
    snapshot: context,
    selectedProjectId,
    selectedProjectName
  });
  applyPaperMatchingToPlan({
    intent: classification.intent,
    message,
    entities,
    plan,
    snapshot: context
  });
  const selection = toolContract
    ? selectToolsForRequest({
      intent: classification.intent,
      entities,
      message,
      contract: toolContract,
      allowWriteTools: writeIntent
    })
    : {
      selectedToolNames: selectToolNamesForPlan(plan, availableToolNames),
      rationaleRows: []
    };
  const selectedToolNames = plan.paper_task_mode === 'compare_papers'
    ? ['search_papers']
    : selection.selectedToolNames;
  plan.selected_tool_names = selectedToolNames;
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
    intent: classification.intent,
    confidence: classification.confidence,
    entities,
    plan,
    classifier: {
      source: 'rules',
      fallbackAttempted: false,
      fallbackUsed: false,
      lowConfidence: classification.lowConfidence,
      tieDetected: classification.tieDetected,
      ruleReason: classification.reason,
      ruleScores: classification.scores,
      fallbackError: ''
    }
  };
}

function shouldUseRoutingFallback(routingDecision) {
  const routing = routingDecision && typeof routingDecision === 'object' ? routingDecision : {};
  const classifier = routing.classifier && typeof routing.classifier === 'object' ? routing.classifier : {};
  return classifier.lowConfidence === true || classifier.tieDetected === true;
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

function parseRoutingFallbackPayload(rawValue) {
  if (!rawValue) {
    return null;
  }
  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const intent = cleanText(parsed.intent, 80);
  if (!ROUTING_INTENTS.includes(intent)) {
    return null;
  }
  const confidenceRaw = Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0.55;
  const entities = normalizeRoutingEntities(parsed.entities);
  const needsClarification = parsed.needs_clarification === true;
  return {
    intent,
    confidence,
    entities,
    needs_clarification: needsClarification,
    clarification_question: cleanText(parsed.clarification_question, 280),
    reason: cleanText(parsed.reason, 260)
  };
}

function mergeRoutingFallback({
  ruleDecision,
  fallbackPayload,
  message,
  snapshot = {},
  writeIntent = false,
  availableToolNames = [],
  toolContract = null,
  selectedProjectId = '',
  selectedProjectName = ''
}) {
  const base = ruleDecision && typeof ruleDecision === 'object' ? ruleDecision : buildRuleBasedRoutingDecision({
    message,
    snapshot,
    availableToolNames,
    toolContract,
    writeIntent,
    selectedProjectId,
    selectedProjectName
  });
  const parsed = parseRoutingFallbackPayload(fallbackPayload);
  if (!parsed) {
    const degradedPlan = {
      ...(base.plan || {}),
      needs_clarification: true,
      clarification_reason: cleanText(base.plan?.clarification_reason, 220) || 'Routing fallback returned invalid output.',
      clarification_question: cleanText(base.plan?.clarification_question, 280)
        || 'I need one clarification to route this request. Do you want protocol drafting, data lookup, project analysis, paper analysis, coding analysis, or a general science answer?'
    };
    const degradedSelection = toolContract
      ? selectToolsForRequest({
        intent: cleanText(base.intent, 80) || DEFAULT_INTENT,
        entities: base.entities || {},
        message,
        contract: toolContract,
        allowWriteTools: writeIntent
      })
      : {
        selectedToolNames: selectToolNamesForPlan(degradedPlan, availableToolNames),
        rationaleRows: []
      };
    degradedPlan.selected_tool_names = degradedSelection.selectedToolNames;
    degradedPlan.tool_selection_rationale = degradedSelection.rationaleRows || [];
    return {
      ...base,
      plan: degradedPlan,
      classifier: {
        ...(base.classifier || {}),
        fallbackAttempted: true,
        fallbackUsed: false,
        fallbackError: 'Routing fallback output was malformed.'
      }
    };
  }

  const mergedPlan = buildExecutionPlan({
    intent: parsed.intent,
    entities: parsed.entities,
    message,
    writeIntent,
    classificationConfidence: parsed.confidence,
    fallbackUsed: true,
    tieDetected: false
  });
  applyProtocolMatchingToPlan({
    intent: parsed.intent,
    message,
    entities: parsed.entities,
    plan: mergedPlan,
    snapshot
  });
  applyProjectMatchingToPlan({
    intent: parsed.intent,
    message,
    entities: parsed.entities,
    plan: mergedPlan,
    snapshot,
    selectedProjectId,
    selectedProjectName
  });
  applyPaperMatchingToPlan({
    intent: parsed.intent,
    message,
    entities: parsed.entities,
    plan: mergedPlan,
    snapshot
  });
  if (parsed.needs_clarification) {
    mergedPlan.needs_clarification = true;
  }
  const protocolMatcherOwnsClarification = parsed.intent === 'protocol_to_notebook'
    && mergedPlan.protocol_match
    && mergedPlan.protocol_match.needs_clarification === true;
  const projectMatcherOwnsClarification = parsed.intent === 'project_science_question'
    && mergedPlan.project_match
    && mergedPlan.project_match.needs_clarification === true;
  const paperMatcherOwnsClarification = parsed.intent === 'paper_analysis'
    && mergedPlan.paper_match
    && mergedPlan.paper_match.needs_clarification === true;
  const matcherOwnsClarification = protocolMatcherOwnsClarification
    || projectMatcherOwnsClarification
    || paperMatcherOwnsClarification;
  if (parsed.clarification_question && !matcherOwnsClarification) {
    mergedPlan.clarification_question = parsed.clarification_question;
  }
  if (parsed.reason && !mergedPlan.clarification_reason && !matcherOwnsClarification) {
    mergedPlan.clarification_reason = parsed.reason;
  }
  const mergedSelection = toolContract
    ? selectToolsForRequest({
      intent: parsed.intent,
      entities: parsed.entities,
      message,
      contract: toolContract,
      allowWriteTools: writeIntent
    })
    : {
      selectedToolNames: selectToolNamesForPlan(mergedPlan, availableToolNames),
      rationaleRows: []
    };
  mergedPlan.selected_tool_names = mergedPlan.paper_task_mode === 'compare_papers'
    ? ['search_papers']
    : mergedSelection.selectedToolNames;
  mergedPlan.tool_selection_rationale = mergedPlan.paper_task_mode === 'compare_papers'
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
    : (mergedSelection.rationaleRows || []);

  return {
    intent: parsed.intent,
    confidence: Number(parsed.confidence.toFixed(3)),
    entities: parsed.entities,
    plan: mergedPlan,
    classifier: {
      ...(base.classifier || {}),
      source: 'rules+llm_fallback',
      fallbackAttempted: true,
      fallbackUsed: true,
      fallbackError: ''
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
  ROUTING_RULE_CONFIDENCE_THRESHOLD,
  classifyIntentByRules: scoreIntentByRules,
  extractEntitiesByRules,
  buildExecutionPlan,
  selectToolNamesForPlan,
  buildRuleBasedRoutingDecision,
  shouldUseRoutingFallback,
  parseRoutingFallbackPayload,
  mergeRoutingFallback,
  buildRoutingClarificationQuestion,
  normalizeRoutingEntities
};
