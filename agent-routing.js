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
  if (includesAny(normalized, ['summarize', 'summary', 'analyze']) && includesAny(normalized, ['paper', 'pdf'])) {
    add('paper_analysis', 2);
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
    needs_pdf_reading: false,
    needs_python: false,
    needs_web_search: false,
    needs_clarification: false,
    clarification_reason: '',
    clarification_question: '',
    selected_tool_names: []
  };

  if (normalizedIntent === 'protocol_to_notebook') {
    plan.needs_tools = true;
    plan.needs_protocol_search = true;
  } else if (normalizedIntent === 'inventory_lookup') {
    plan.needs_tools = true;
  } else if (normalizedIntent === 'record_lookup') {
    plan.needs_tools = true;
    plan.needs_notebook_retrieval = true;
  } else if (normalizedIntent === 'project_science_question') {
    plan.needs_tools = true;
    plan.needs_notebook_retrieval = true;
  } else if (normalizedIntent === 'paper_analysis') {
    plan.needs_tools = true;
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
  add('search_inventory');
  if (!plan.needs_pdf_reading) {
    add('search_papers');
  }

  return selected;
}

function buildRuleBasedRoutingDecision({
  message,
  snapshot = {},
  availableToolNames = [],
  writeIntent = false
}) {
  const context = {
    projects: asArray(snapshot.projects),
    protocols: asArray(snapshot.protocols),
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
  const selectedToolNames = selectToolNamesForPlan(plan, availableToolNames);
  plan.selected_tool_names = selectedToolNames;
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
  writeIntent = false,
  availableToolNames = []
}) {
  const base = ruleDecision && typeof ruleDecision === 'object' ? ruleDecision : buildRuleBasedRoutingDecision({
    message,
    availableToolNames,
    writeIntent
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
    degradedPlan.selected_tool_names = selectToolNamesForPlan(degradedPlan, availableToolNames);
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
  if (parsed.needs_clarification) {
    mergedPlan.needs_clarification = true;
  }
  if (parsed.clarification_question) {
    mergedPlan.clarification_question = parsed.clarification_question;
  }
  if (parsed.reason && !mergedPlan.clarification_reason) {
    mergedPlan.clarification_reason = parsed.reason;
  }
  mergedPlan.selected_tool_names = selectToolNamesForPlan(mergedPlan, availableToolNames);

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
