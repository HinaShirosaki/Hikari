const TOOL_CLASS = Object.freeze({
  READ: 'read',
  COMPUTE: 'compute',
  WRITE: 'write'
});

const INTENT_TASK_MAP = Object.freeze({
  protocol_to_notebook: ['protocol_search', 'notebook_generation'],
  inventory_lookup: ['inventory_lookup', 'entity_property_lookup'],
  record_lookup: ['record_lookup', 'history_lookup'],
  project_science_question: ['project_science', 'record_lookup'],
  paper_analysis: ['paper_analysis', 'literature_lookup'],
  coding_data_analysis: ['coding_data_analysis', 'compute'],
  general_science_question: ['general_science', 'literature_lookup'],
  literature_search: ['literature_lookup', 'general_science'],
  data_analysis_or_coding: ['coding_data_analysis', 'compute'],
  mixed_request: ['record_lookup', 'project_science', 'literature_lookup'],
  unclear: []
});

const TOOL_CAPABILITY_MAP = Object.freeze({
  search_projects: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['project'],
    taskTypes: ['project_science', 'record_lookup', 'history_lookup'],
    aliases: ['project', 'program', 'initiative']
  },
  search_protocols: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['protocol', 'activity', 'cell_line'],
    taskTypes: ['protocol_search', 'notebook_generation', 'record_lookup'],
    aliases: ['protocol', 'sop', 'method', 'workflow']
  },
  search_notebook_entries: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['activity', 'protocol', 'workflow_step', 'project'],
    taskTypes: ['record_lookup', 'history_lookup', 'project_science'],
    aliases: ['notebook', 'entry', 'last time', 'history', 'record']
  },
  search_workflows: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['workflow_step', 'project', 'activity', 'protocol'],
    taskTypes: ['record_lookup', 'history_lookup', 'project_science'],
    aliases: ['workflow', 'step', 'pipeline', 'next step', 'graph']
  },
  search_assays: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['activity', 'workflow_step', 'project'],
    taskTypes: ['record_lookup', 'project_science'],
    aliases: ['assay', 'plate', 'dose response']
  },
  search_gel_analyses: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['activity', 'workflow_step', 'project'],
    taskTypes: ['record_lookup', 'project_science'],
    aliases: ['gel', 'western', 'lane', 'band']
  },
  search_inventory: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['compound', 'protein'],
    taskTypes: ['inventory_lookup', 'entity_property_lookup'],
    aliases: ['inventory', 'reagent', 'chemical', 'stock', 'molecular weight', 'pi']
  },
  search_papers: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['paper_title', 'protein', 'compound', 'project'],
    taskTypes: ['paper_analysis', 'literature_lookup', 'project_science'],
    aliases: ['paper', 'pdf', 'journal', 'literature']
  },
  search_web: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['project', 'paper_title', 'protein', 'compound', 'workflow_step'],
    taskTypes: ['general_science', 'literature_lookup', 'project_science', 'paper_analysis'],
    aliases: ['web', 'internet', 'latest', 'recent', 'news', 'review', 'reference']
  },
  search_uniprot: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['protein'],
    taskTypes: ['entity_property_lookup', 'literature_lookup', 'project_science'],
    aliases: ['uniprot', 'protein', 'accession']
  },
  search_pubmed: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['paper_title', 'protein', 'compound'],
    taskTypes: ['paper_analysis', 'literature_lookup', 'general_science'],
    aliases: ['pubmed', 'pmid', 'paper', 'literature']
  },
  search_crossref: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['paper_title', 'protein', 'compound'],
    taskTypes: ['paper_analysis', 'literature_lookup', 'general_science'],
    aliases: ['crossref', 'doi', 'paper', 'citation']
  },
  search_europe_pmc: {
    toolClass: TOOL_CLASS.READ,
    entityTypes: ['paper_title', 'protein', 'compound'],
    taskTypes: ['paper_analysis', 'literature_lookup', 'general_science'],
    aliases: ['europe pmc', 'pmcid', 'pmid', 'paper', 'literature']
  },
  toolbox_molarity_calculator: {
    toolClass: TOOL_CLASS.COMPUTE,
    entityTypes: [],
    taskTypes: ['coding_data_analysis', 'compute'],
    aliases: ['molarity', 'dilution', 'c1v1', 'concentration', 'mass', 'volume']
  },
  toolbox_peptide_properties: {
    toolClass: TOOL_CLASS.COMPUTE,
    entityTypes: ['protein'],
    taskTypes: ['coding_data_analysis', 'compute', 'entity_property_lookup'],
    aliases: ['peptide', 'pi', 'isoelectric point', 'net charge', 'mass']
  },
  toolbox_buffer_preparer: {
    toolClass: TOOL_CLASS.COMPUTE,
    entityTypes: ['compound'],
    taskTypes: ['coding_data_analysis', 'compute', 'inventory_lookup'],
    aliases: ['buffer', 'prepare buffer', 'component', 'mM', 'percent v/v']
  },
  toolbox_dna_to_protein: {
    toolClass: TOOL_CLASS.COMPUTE,
    entityTypes: ['protein'],
    taskTypes: ['coding_data_analysis', 'compute'],
    aliases: ['dna to protein', 'translate', 'reading frame', 'codon']
  },
  toolbox_protein_to_dna: {
    toolClass: TOOL_CLASS.COMPUTE,
    entityTypes: ['protein'],
    taskTypes: ['coding_data_analysis', 'compute'],
    aliases: ['reverse translate', 'protein to dna', 'codon optimization', 'restriction site']
  },
  toolbox_oligo_properties: {
    toolClass: TOOL_CLASS.COMPUTE,
    entityTypes: ['compound'],
    taskTypes: ['coding_data_analysis', 'compute', 'entity_property_lookup'],
    aliases: ['oligo', 'tm', 'melting temperature', 'extinction coefficient']
  },
  toolbox_extinction_coefficient: {
    toolClass: TOOL_CLASS.COMPUTE,
    entityTypes: ['protein', 'compound'],
    taskTypes: ['coding_data_analysis', 'compute', 'entity_property_lookup'],
    aliases: ['extinction coefficient', 'a280', 'protein concentration']
  },
  toolbox_qpcr_efficiency: {
    toolClass: TOOL_CLASS.COMPUTE,
    entityTypes: ['activity'],
    taskTypes: ['coding_data_analysis', 'compute', 'project_science'],
    aliases: ['qpcr', 'efficiency', 'slope', 'standard curve', 'ct']
  },
  toolbox_plannotate: {
    toolClass: TOOL_CLASS.COMPUTE,
    entityTypes: ['activity'],
    taskTypes: ['coding_data_analysis', 'compute', 'project_science'],
    aliases: ['plannotate', 'plasmid', 'annotate sequence', 'feature map']
  },
  toolbox_crispr_sgrna_designer: {
    toolClass: TOOL_CLASS.COMPUTE,
    entityTypes: ['protein', 'activity'],
    taskTypes: ['coding_data_analysis', 'compute', 'project_science'],
    aliases: ['crispr', 'sgrna', 'guide rna', 'pam', 'off-target']
  },
  run_python_sandbox: {
    toolClass: TOOL_CLASS.COMPUTE,
    entityTypes: ['activity'],
    taskTypes: ['coding_data_analysis', 'compute'],
    aliases: ['python', 'compute', 'script', 'analysis']
  },
  download_paper_pdf: {
    toolClass: TOOL_CLASS.WRITE,
    entityTypes: ['paper_title', 'project'],
    taskTypes: ['paper_analysis'],
    aliases: ['download', 'pdf', 'save paper']
  }
});

const LOCAL_SEARCH_TOOLS = new Set([
  'search_projects',
  'search_protocols',
  'search_notebook_entries',
  'search_workflows',
  'search_assays',
  'search_gel_analyses',
  'search_inventory',
  'search_papers'
]);

const QUERY_ALIAS_RULES = Object.freeze([
  { pattern: /\bmw\b/gi, replacement: 'molecular weight' },
  { pattern: /\bp\/?i\b/gi, replacement: 'isoelectric point' },
  { pattern: /\bpd1\b/gi, replacement: 'pd-1' },
  { pattern: /\bifng\b/gi, replacement: 'ifn-gamma' },
  { pattern: /\btnfa\b/gi, replacement: 'tnf-alpha' }
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 400) {
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
  return cleanText(value, 3000)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 80);
}

function normalizeContractTool(tool) {
  const source = tool && typeof tool === 'object' ? tool : {};
  const name = cleanText(source.name, 120);
  if (!name) {
    return null;
  }
  return {
    name,
    description: cleanText(source.description, 800),
    input_schema: source.input_schema && typeof source.input_schema === 'object'
      ? source.input_schema
      : { type: 'object', additionalProperties: true, properties: {} },
    output_schema: source.output_schema && typeof source.output_schema === 'object'
      ? source.output_schema
      : { type: 'object', additionalProperties: true }
  };
}

function loadToolContract(rawContract) {
  const source = rawContract && typeof rawContract === 'object' ? rawContract : {};
  const tools = asArray(source.tools).map(normalizeContractTool).filter(Boolean);
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    schema_name: cleanText(source.schema_name, 120) || 'enana_llm_agent_io',
    schema_version: cleanText(source.schema_version, 40) || '1.0.0',
    tools,
    toolMap
  };
}

function getToolCapability(toolName) {
  return TOOL_CAPABILITY_MAP[toolName] || {
    toolClass: TOOL_CLASS.READ,
    entityTypes: [],
    taskTypes: [],
    aliases: []
  };
}

function listAvailableTools(contract, options = {}) {
  const normalized = loadToolContract(contract);
  const includeWrite = options.includeWrite !== false;
  const includeCompute = options.includeCompute !== false;
  return normalized.tools.filter((tool) => {
    const capability = getToolCapability(tool.name);
    if (!includeWrite && capability.toolClass === TOOL_CLASS.WRITE) {
      return false;
    }
    if (!includeCompute && capability.toolClass === TOOL_CLASS.COMPUTE) {
      return false;
    }
    return true;
  });
}

function findToolsByEntityType(contract, entityType, options = {}) {
  const target = cleanText(entityType, 80).toLowerCase();
  if (!target) {
    return [];
  }
  return listAvailableTools(contract, options).filter((tool) => {
    const capability = getToolCapability(tool.name);
    return asArray(capability.entityTypes).includes(target);
  });
}

function findToolsByTaskType(contract, taskType, options = {}) {
  const target = cleanText(taskType, 80).toLowerCase();
  if (!target) {
    return [];
  }
  return listAvailableTools(contract, options).filter((tool) => {
    const capability = getToolCapability(tool.name);
    return asArray(capability.taskTypes).includes(target);
  });
}

function scoreExactness(messageTokens, entityTokens, tool, capability) {
  const catalogTokens = new Set([
    ...tokenize(`${tool.name} ${tool.description}`),
    ...asArray(capability.aliases).flatMap((alias) => tokenize(alias))
  ]);
  if (!catalogTokens.size) {
    return 0;
  }
  const targetTokens = uniqueStrings([...messageTokens, ...entityTokens]);
  if (!targetTokens.length) {
    return 0;
  }
  let overlap = 0;
  targetTokens.forEach((token) => {
    if (catalogTokens.has(token.toLowerCase())) {
      overlap += 1;
    }
  });
  if (!overlap) {
    return 0;
  }
  if (overlap >= 3) {
    return 3;
  }
  if (overlap >= 2) {
    return 2;
  }
  return 1;
}

function scoreToolCandidate({ tool, intent, entities, message }) {
  const capability = getToolCapability(tool.name);
  const entityPairs = Object.entries(entities && typeof entities === 'object' ? entities : {});
  const activeEntityTypes = entityPairs
    .filter(([, value]) => cleanText(value, 160))
    .map(([key]) => cleanText(key, 80).toLowerCase());
  const intentTasks = asArray(INTENT_TASK_MAP[cleanText(intent, 80)] || []);
  const messageTokens = tokenize(message);
  const entityTokens = entityPairs.flatMap(([, value]) => tokenize(value));

  const entityScore = activeEntityTypes.some((type) => asArray(capability.entityTypes).includes(type)) ? 5 : 0;
  const taskScore = intentTasks.some((task) => asArray(capability.taskTypes).includes(task)) ? 4 : 0;
  const exactnessScore = scoreExactness(messageTokens, entityTokens, tool, capability);
  const score = entityScore + taskScore + exactnessScore;

  const reasons = [];
  if (entityScore) {
    reasons.push('entity match');
  }
  if (taskScore) {
    reasons.push('task match');
  }
  if (exactnessScore) {
    reasons.push('keyword overlap');
  }
  if (!reasons.length) {
    reasons.push('fallback candidate');
  }

  return {
    tool: tool.name,
    score,
    entityScore,
    taskScore,
    exactnessScore,
    reason: reasons.join(', ')
  };
}

function topCountForIntent(intent) {
  const normalized = cleanText(intent, 80);
  if (normalized === 'protocol_to_notebook') {
    return 3;
  }
  if (normalized === 'inventory_lookup') {
    return 3;
  }
  if (normalized === 'record_lookup') {
    return 4;
  }
  if (normalized === 'project_science_question') {
    return 5;
  }
  if (normalized === 'paper_analysis') {
    return 5;
  }
  if (normalized === 'coding_data_analysis') {
    return 2;
  }
  if (normalized === 'data_analysis_or_coding') {
    return 2;
  }
  if (normalized === 'literature_search') {
    return 4;
  }
  if (normalized === 'mixed_request') {
    return 3;
  }
  return 2;
}

function requiredToolHintsForIntent(intent) {
  const normalized = cleanText(intent, 80);
  if (normalized === 'protocol_to_notebook') {
    return ['search_protocols', 'search_projects', 'search_notebook_entries'];
  }
  if (normalized === 'inventory_lookup') {
    return ['search_inventory', 'search_uniprot'];
  }
  if (normalized === 'record_lookup') {
    return ['search_notebook_entries', 'search_workflows', 'search_assays', 'search_gel_analyses', 'search_projects'];
  }
  if (normalized === 'project_science_question') {
    return ['search_projects', 'search_notebook_entries', 'search_workflows', 'search_papers', 'search_protocols', 'search_web'];
  }
  if (normalized === 'paper_analysis') {
    return ['search_papers', 'search_pubmed', 'search_crossref', 'search_europe_pmc'];
  }
  if (normalized === 'coding_data_analysis') {
    return ['run_python_sandbox'];
  }
  if (normalized === 'data_analysis_or_coding') {
    return ['run_python_sandbox'];
  }
  if (normalized === 'literature_search') {
    return ['search_web', 'search_pubmed', 'search_crossref', 'search_europe_pmc'];
  }
  if (normalized === 'mixed_request') {
    return ['search_projects', 'search_notebook_entries', 'search_web'];
  }
  if (normalized === 'unclear') {
    return [];
  }
  return ['search_web', 'search_pubmed', 'search_crossref'];
}

function selectToolsForRequest({ intent, entities, message, contract, allowWriteTools = false }) {
  const tools = listAvailableTools(contract, {
    includeWrite: allowWriteTools,
    includeCompute: true
  });
  const ranked = tools
    .map((tool) => scoreToolCandidate({ tool, intent, entities, message }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.entityScore !== a.entityScore) {
        return b.entityScore - a.entityScore;
      }
      if (b.taskScore !== a.taskScore) {
        return b.taskScore - a.taskScore;
      }
      return a.tool.localeCompare(b.tool);
    });

  const takeCount = topCountForIntent(intent);
  const selected = ranked.slice(0, takeCount).map((item) => item.tool);
  const requiredHints = requiredToolHintsForIntent(intent);
  requiredHints.forEach((toolName) => {
    if (selected.includes(toolName)) {
      return;
    }
    const hasTool = tools.some((tool) => tool.name === toolName);
    if (hasTool && selected.length < takeCount) {
      selected.push(toolName);
    }
  });

  return {
    selectedToolNames: uniqueStrings(selected),
    candidates: ranked.slice(0, 8).map((row) => ({ ...row })),
    rationaleRows: ranked.slice(0, 8).map((row) => ({
      tool: row.tool,
      score: row.score,
      entityScore: row.entityScore,
      taskScore: row.taskScore,
      exactnessScore: row.exactnessScore,
      reason: row.reason
    }))
  };
}

function normalizeQueryText(query) {
  return cleanText(query, 400)
    .toLowerCase()
    .replace(/[\u03b1\u0391]/g, 'alpha')
    .replace(/[\u03b2\u0392]/g, 'beta')
    .replace(/[\u03b3\u0393]/g, 'gamma')
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }
  const dp = Array.from({ length: b.length + 1 }, (_v, idx) => idx);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + cost
      );
      prev = temp;
    }
  }
  return dp[b.length];
}

function rewriteAliases(query) {
  let next = String(query || '');
  QUERY_ALIAS_RULES.forEach((rule) => {
    next = next.replace(rule.pattern, rule.replacement);
  });
  return next;
}

function applyLightFuzzy(query, vocabulary = []) {
  const vocab = new Set(asArray(vocabulary).flatMap((item) => tokenize(item)));
  if (!vocab.size) {
    return query;
  }
  const tokens = tokenize(query);
  const replaced = tokens.map((token) => {
    if (token.length < 4 || vocab.has(token)) {
      return token;
    }
    let best = token;
    for (const candidate of vocab) {
      if (candidate.length < 4) {
        continue;
      }
      if (Math.abs(candidate.length - token.length) > 1) {
        continue;
      }
      const distance = levenshteinDistance(token, candidate);
      if (distance <= 1) {
        best = candidate;
        break;
      }
    }
    return best;
  });
  return uniqueStrings([replaced.join(' ')])[0] || query;
}

function buildQueryVariants(query, vocabulary = []) {
  const base = cleanText(query, 400);
  if (!base) {
    return [];
  }
  const alias = rewriteAliases(base);
  const normalized = normalizeQueryText(alias || base);
  const fuzzy = applyLightFuzzy(normalized || alias || base, vocabulary);
  return uniqueStrings([base, alias, normalized, fuzzy]);
}

function defaultEnvelope(toolName, args, rawResult, options = {}) {
  const source = rawResult && typeof rawResult === 'object' ? rawResult : {};
  return {
    ok: options.ok !== false,
    tool_name: cleanText(toolName, 120),
    input: args && typeof args === 'object' ? args : {},
    items: asArray(source.items),
    citations: asArray(source.citations),
    summary: cleanText(source.summary, 320),
    ...(options.error ? { error: cleanText(options.error, 600) } : {})
  };
}

function extractItems(result) {
  if (!result || typeof result !== 'object') {
    return [];
  }
  if (Array.isArray(result.items)) {
    return result.items;
  }
  if (result.result && typeof result.result === 'object' && Array.isArray(result.result.items)) {
    return result.result.items;
  }
  return [];
}

function isEnvelopeShape(result) {
  return Boolean(
    result
    && typeof result === 'object'
    && Object.prototype.hasOwnProperty.call(result, 'summary')
    && Object.prototype.hasOwnProperty.call(result, 'items')
    && Object.prototype.hasOwnProperty.call(result, 'citations')
  );
}

async function executeToolCall(toolName, args, context = {}) {
  const contract = loadToolContract(context.contract);
  const tool = contract.toolMap.get(cleanText(toolName, 120));
  const toEnvelope = typeof context.toEnvelope === 'function' ? context.toEnvelope : defaultEnvelope;
  const allowWriteTools = context.allowWriteTools === true;
  const dispatch = typeof context.dispatch === 'function' ? context.dispatch : null;
  if (!dispatch) {
    return toEnvelope(toolName, args, { items: [], citations: [], summary: 'Tool dispatch function is missing.' }, {
      ok: false,
      error: 'Tool dispatch function is missing.'
    });
  }

  if (!tool) {
    return toEnvelope(toolName, args, { items: [], citations: [], summary: `Unknown tool: ${toolName}` }, {
      ok: false,
      error: `Unknown tool: ${toolName}`
    });
  }

  const capability = getToolCapability(tool.name);
  if (capability.toolClass === TOOL_CLASS.WRITE && !allowWriteTools) {
    return toEnvelope(tool.name, args, {
      items: [],
      citations: [],
      summary: 'Write action blocked: explicit approval is required before execution.'
    }, {
      ok: false,
      error: 'Write action blocked: explicit approval is required.'
    });
  }

  const requestedArgs = args && typeof args === 'object' ? { ...args } : {};
  const query = cleanText(requestedArgs.query, 400);
  const shouldRetryLocally = LOCAL_SEARCH_TOOLS.has(tool.name) && query;
  const variants = shouldRetryLocally
    ? buildQueryVariants(query, asArray(context.fuzzyVocabulary))
    : [query];

  let lastResult = null;
  let lastArgs = requestedArgs;
  for (let index = 0; index < Math.max(1, variants.length); index += 1) {
    const variant = variants[index] || query;
    const nextArgs = {
      ...requestedArgs,
      ...(variant ? { query: variant } : {})
    };
    try {
      const raw = await dispatch(tool.name, nextArgs, {
        tool,
        capability,
        allowWriteTools,
        variantIndex: index
      });
      const envelope = isEnvelopeShape(raw)
        ? raw
        : toEnvelope(tool.name, nextArgs, raw || { items: [], citations: [], summary: 'No summary was generated.' });
      lastResult = envelope;
      lastArgs = nextArgs;
      const items = extractItems(envelope);
      if (items.length > 0) {
        return envelope;
      }
    } catch (error) {
      lastResult = toEnvelope(tool.name, nextArgs, {
        items: [],
        citations: [],
        summary: `${tool.name} failed.`
      }, {
        ok: false,
        error: cleanText(error?.message || error, 600)
      });
      lastArgs = nextArgs;
      break;
    }
  }

  if (shouldRetryLocally) {
    return toEnvelope(tool.name, lastArgs, {
      items: [],
      citations: [],
      summary: 'No matching record found.'
    });
  }

  return lastResult || toEnvelope(tool.name, requestedArgs, {
    items: [],
    citations: [],
    summary: 'No matching record found.'
  });
}

module.exports = {
  TOOL_CLASS,
  TOOL_CAPABILITY_MAP,
  loadToolContract,
  listAvailableTools,
  findToolsByEntityType,
  findToolsByTaskType,
  selectToolsForRequest,
  executeToolCall
};
