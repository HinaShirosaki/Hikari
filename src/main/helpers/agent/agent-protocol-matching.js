const TOP_SCORE_CLARIFICATION_THRESHOLD = 0.6;
const TOP_DELTA_CLARIFICATION_THRESHOLD = 0.1;

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

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  if (number < min) {
    return min;
  }
  if (number > max) {
    return max;
  }
  return number;
}

function uniqueStrings(values, maxLength = 220) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, maxLength);
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

function normalizeForTokens(value) {
  return cleanText(value, 10000)
    .toLowerCase()
    .replace(/[\u03b1\u0391]/g, 'alpha')
    .replace(/[\u03b2\u0392]/g, 'beta')
    .replace(/[\u03b3\u0393]/g, 'gamma')
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value, maxTokens = 120) {
  return normalizeForTokens(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, maxTokens);
}

function tokenSet(value) {
  return new Set(tokenize(value, 240));
}

function tokenOverlapRatio(needleTokens, haystackSet) {
  const needles = asArray(needleTokens).filter(Boolean);
  if (!needles.length || !(haystackSet instanceof Set) || !haystackSet.size) {
    return 0;
  }
  const overlap = needles.reduce((count, token) => (
    haystackSet.has(String(token).toLowerCase()) ? count + 1 : count
  ), 0);
  return clamp(overlap / needles.length, 0, 1);
}

function tokenJaccard(leftValue, rightValue) {
  const leftSet = tokenSet(leftValue);
  const rightSet = tokenSet(rightValue);
  if (!leftSet.size || !rightSet.size) {
    return 0;
  }
  let intersection = 0;
  leftSet.forEach((token) => {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  });
  const union = leftSet.size + rightSet.size - intersection;
  if (!union) {
    return 0;
  }
  return clamp(intersection / union, 0, 1);
}

function charNgramSet(value, n = 3) {
  const normalized = ` ${normalizeForTokens(value)} `;
  if (!normalized.trim()) {
    return new Set();
  }
  const out = new Set();
  if (normalized.length <= n) {
    out.add(normalized);
    return out;
  }
  for (let index = 0; index <= normalized.length - n; index += 1) {
    out.add(normalized.slice(index, index + n));
  }
  return out;
}

function charNgramDice(leftValue, rightValue) {
  const left = charNgramSet(leftValue, 3);
  const right = charNgramSet(rightValue, 3);
  if (!left.size || !right.size) {
    return 0;
  }
  let intersection = 0;
  left.forEach((gram) => {
    if (right.has(gram)) {
      intersection += 1;
    }
  });
  return clamp((2 * intersection) / (left.size + right.size), 0, 1);
}

function semanticSimilarity(leftValue, rightValue) {
  const tokenScore = tokenJaccard(leftValue, rightValue);
  const ngramScore = charNgramDice(leftValue, rightValue);
  return clamp((tokenScore * 0.6) + (ngramScore * 0.4), 0, 1);
}

function getStepText(step) {
  if (typeof step === 'string') {
    return cleanText(step, 240);
  }
  return cleanText(step?.text || step?.instruction || step?.action || step?.description, 240);
}

function getStepPlaceholders(step) {
  const fromStructured = step && typeof step === 'object'
    ? asArray(step.placeholders)
    .map((placeholder) => cleanText(placeholder?.name, 120))
    .filter(Boolean)
    : [];
  const fromInline = [];
  const text = getStepText(step);
  if (text) {
    const bracketPattern = /\[([^\[\]]{1,80})\]/g;
    let match = bracketPattern.exec(text);
    while (match) {
      fromInline.push(cleanText(match[1], 120));
      match = bracketPattern.exec(text);
    }
    const tokenPattern = /\{\{ph:([^}]+)\}\}/g;
    match = tokenPattern.exec(text);
    while (match) {
      fromInline.push(cleanText(match[1], 120));
      match = tokenPattern.exec(text);
    }
  }
  return uniqueStrings([...fromStructured, ...fromInline], 120);
}

function parseTags(rawValue) {
  if (Array.isArray(rawValue)) {
    return uniqueStrings(rawValue, 80);
  }
  const text = cleanText(rawValue, 800);
  if (!text) {
    return [];
  }
  return uniqueStrings(text.split(/[;,|]/).map((value) => value.trim()), 80);
}

function resolveLinkedProject(protocol, projectNameById, notebookEntriesByProtocol) {
  const direct = cleanText(
    protocol?.linked_project
    || protocol?.linkedProject
    || protocol?.project
    || protocol?.project_name
    || protocol?.projectName,
    180
  );
  if (direct) {
    return direct;
  }

  const projectId = cleanText(protocol?.projectId || protocol?.project_id, 80);
  if (projectId && projectNameById.has(projectId)) {
    return projectNameById.get(projectId);
  }

  const protocolId = cleanText(protocol?.id, 80);
  const entries = protocolId ? asArray(notebookEntriesByProtocol.get(protocolId)) : [];
  const projectCounts = new Map();
  entries.forEach((entry) => {
    const value = cleanText(entry?.projectName || entry?.project_name, 180)
      || projectNameById.get(cleanText(entry?.projectId || entry?.project_id, 80))
      || '';
    if (!value) {
      return;
    }
    projectCounts.set(value, (projectCounts.get(value) || 0) + 1);
  });
  const ranked = [...projectCounts.entries()].sort((left, right) => right[1] - left[1]);
  return ranked[0]?.[0] || '';
}

function buildSearchableProtocolDocs({ protocols = [], projects = [], notebookEntries = [] } = {}) {
  const projectNameById = new Map();
  asArray(projects).forEach((project) => {
    const id = cleanText(project?.id, 80);
    const name = cleanText(project?.name, 180);
    if (id && name) {
      projectNameById.set(id, name);
    }
  });

  const notebookEntriesByProtocol = new Map();
  asArray(notebookEntries).forEach((entry) => {
    const protocolId = cleanText(entry?.protocolId || entry?.protocol_id, 80);
    if (!protocolId) {
      return;
    }
    if (!notebookEntriesByProtocol.has(protocolId)) {
      notebookEntriesByProtocol.set(protocolId, []);
    }
    notebookEntriesByProtocol.get(protocolId).push(entry);
  });

  return asArray(protocols)
    .map((protocol) => {
      const id = cleanText(protocol?.id, 80);
      const title = cleanText(protocol?.name || protocol?.title, 220);
      if (!title) {
        return null;
      }
      const steps = asArray(protocol?.steps)
        .map((step) => getStepText(step))
        .filter(Boolean)
        .slice(0, 80);
      const placeholders = uniqueStrings(
        asArray(protocol?.steps).flatMap((step) => getStepPlaceholders(step)),
        120
      );
      const description = cleanText(
        protocol?.description
        || protocol?.purpose
        || protocol?.summary
        || protocol?.troubleshooting,
        1200
      );
      const tags = uniqueStrings([
        ...parseTags(protocol?.tags),
        cleanText(protocol?.category, 80),
        cleanText(protocol?.type, 80)
      ], 80);
      const linkedProject = resolveLinkedProject(protocol, projectNameById, notebookEntriesByProtocol);
      const searchableParts = [
        title,
        description,
        tags.join(' '),
        linkedProject,
        placeholders.join(' '),
        steps.join(' ')
      ].filter(Boolean);
      const searchText = searchableParts.join(' ');
      return {
        id,
        title,
        description,
        tags,
        linked_project: linkedProject,
        placeholders,
        steps,
        category: cleanText(protocol?.category, 80),
        search_text: searchText,
        search_tokens: tokenSet(searchText),
        protocol
      };
    })
    .filter(Boolean);
}

function buildQueryText(message, entities = {}) {
  const sourceEntities = entities && typeof entities === 'object' ? entities : {};
  const parts = [
    cleanText(message, 3000),
    cleanText(sourceEntities.activity, 180),
    cleanText(sourceEntities.protocol, 220),
    cleanText(sourceEntities.cell_line, 80),
    cleanText(sourceEntities.project, 180),
    cleanText(sourceEntities.workflow_step, 180),
    cleanText(sourceEntities.protein, 100),
    cleanText(sourceEntities.compound, 120)
  ].filter(Boolean);
  return uniqueStrings(parts, 3000).join(' ');
}

function retrieveProtocolCandidates({ message, entities = {}, docs = [], maxCandidates = 12 } = {}) {
  const queryText = buildQueryText(message, entities);
  const queryTokens = tokenize(queryText, 80);
  const queryTokenSet = new Set(queryTokens);
  const queryLower = queryText.toLowerCase();

  const ranked = asArray(docs).map((doc) => {
    const keywordScore = tokenOverlapRatio(queryTokens, doc.search_tokens);
    const semanticScore = semanticSimilarity(queryText, doc.search_text);
    const exactNameMatch = doc.title && queryLower.includes(doc.title.toLowerCase()) ? 1 : 0;
    const tagMatch = asArray(doc.tags).some((tag) => queryTokenSet.has(tag.toLowerCase())) ? 1 : 0;
    const prefilterScore = clamp(
      (keywordScore * 0.65)
      + (semanticScore * 0.25)
      + (exactNameMatch * 0.1)
      + (tagMatch * 0.05),
      0,
      1.2
    );
    return {
      doc,
      query_text: queryText,
      keyword_score: keywordScore,
      semantic_score: semanticScore,
      exact_name_match: exactNameMatch,
      prefilter_score: prefilterScore
    };
  });

  const keywordHits = ranked.filter((candidate) => (
    candidate.keyword_score > 0
    || candidate.exact_name_match === 1
  ));

  const pool = keywordHits.length
    ? keywordHits
    : ranked
      .sort((left, right) => (
        (right.semantic_score - left.semantic_score)
        || (right.prefilter_score - left.prefilter_score)
        || left.doc.title.localeCompare(right.doc.title)
      ))
      .slice(0, Math.max(6, maxCandidates));

  return pool
    .sort((left, right) => (
      (right.prefilter_score - left.prefilter_score)
      || (right.semantic_score - left.semantic_score)
      || left.doc.title.localeCompare(right.doc.title)
    ))
    .slice(0, Math.max(1, maxCandidates));
}

function parseIsoDate(value) {
  const timestamp = Date.parse(String(value || '').trim());
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  return timestamp;
}

function recencyScoreFromTimestamp(timestamp) {
  if (!timestamp) {
    return 0;
  }
  const days = Math.max(0, (Date.now() - timestamp) / (24 * 60 * 60 * 1000));
  if (days <= 7) {
    return 1;
  }
  if (days <= 30) {
    return 0.82;
  }
  if (days <= 90) {
    return 0.62;
  }
  if (days <= 180) {
    return 0.42;
  }
  if (days <= 365) {
    return 0.24;
  }
  return 0.1;
}

function buildNotebookHistoryIndex({ notebookEntries = [], projects = [] } = {}) {
  const projectNameById = new Map();
  asArray(projects).forEach((project) => {
    const id = cleanText(project?.id, 80);
    const name = cleanText(project?.name, 180);
    if (id && name) {
      projectNameById.set(id, name);
    }
  });

  const historyByProtocolId = new Map();
  asArray(notebookEntries).forEach((entry) => {
    const protocolId = cleanText(entry?.protocolId || entry?.protocol_id, 80);
    if (!protocolId) {
      return;
    }
    if (!historyByProtocolId.has(protocolId)) {
      historyByProtocolId.set(protocolId, {
        latestUpdatedAt: 0,
        projectNames: new Set(),
        workflowTokens: new Set(),
        entryCount: 0
      });
    }
    const bucket = historyByProtocolId.get(protocolId);
    bucket.entryCount += 1;
    const updatedAt = parseIsoDate(entry?.updatedAt || entry?.updated_at || entry?.createdAt || entry?.created_at);
    if (updatedAt > bucket.latestUpdatedAt) {
      bucket.latestUpdatedAt = updatedAt;
    }

    const projectName = cleanText(entry?.projectName || entry?.project_name, 180)
      || projectNameById.get(cleanText(entry?.projectId || entry?.project_id, 80))
      || '';
    if (projectName) {
      bucket.projectNames.add(projectName.toLowerCase());
    }

    const tokens = tokenize([
      cleanText(entry?.protocolName || entry?.protocol_name, 180),
      cleanText(entry?.result, 600)
    ].filter(Boolean).join(' '), 120);
    tokens.forEach((token) => bucket.workflowTokens.add(token));
  });

  return historyByProtocolId;
}

function scoreEntityOverlap(doc, entities = {}) {
  const sourceEntities = entities && typeof entities === 'object' ? entities : {};
  const values = [
    sourceEntities.activity,
    sourceEntities.protocol,
    sourceEntities.cell_line,
    sourceEntities.workflow_step,
    sourceEntities.protein,
    sourceEntities.compound
  ].map((value) => cleanText(value, 220)).filter(Boolean);

  if (!values.length) {
    return 0;
  }

  const overlapScores = values.map((value) => {
    const tokens = tokenize(value, 40);
    return tokenOverlapRatio(tokens, doc.search_tokens);
  });

  const exactProtocolMatch = cleanText(sourceEntities.protocol, 220)
    && cleanText(sourceEntities.protocol, 220).toLowerCase() === doc.title.toLowerCase()
    ? 1
    : 0;

  const average = overlapScores.reduce((sum, value) => sum + value, 0) / overlapScores.length;
  const strongest = overlapScores.length ? Math.max(...overlapScores) : 0;
  return clamp(Math.max(average, strongest, exactProtocolMatch), 0, 1);
}

function scoreProjectRelevance(doc, entities = {}, historyIndex = new Map()) {
  const targetProject = cleanText(entities?.project, 180).toLowerCase();
  if (!targetProject) {
    return 0;
  }

  const docProject = cleanText(doc.linked_project, 180).toLowerCase();
  if (docProject && (docProject.includes(targetProject) || targetProject.includes(docProject))) {
    return 1;
  }

  const history = doc.id ? historyIndex.get(doc.id) : null;
  if (!history) {
    return 0;
  }

  if (history.projectNames.has(targetProject)) {
    return 0.88;
  }

  const tokens = tokenize(targetProject, 20);
  const overlap = tokenOverlapRatio(tokens, history.workflowTokens);
  return clamp(overlap * 0.7, 0, 0.7);
}

function scoreRecentWorkflowRelevance(doc, entities = {}, historyIndex = new Map()) {
  const history = doc.id ? historyIndex.get(doc.id) : null;
  const workflowNeedleTokens = tokenize([
    cleanText(entities?.activity, 180),
    cleanText(entities?.workflow_step, 180)
  ].filter(Boolean).join(' '), 40);

  if (!history && !workflowNeedleTokens.length) {
    return 0;
  }

  const recency = history ? recencyScoreFromTimestamp(history.latestUpdatedAt) : 0;
  const historyOverlap = history && workflowNeedleTokens.length
    ? tokenOverlapRatio(workflowNeedleTokens, history.workflowTokens)
    : 0;
  const docOverlap = workflowNeedleTokens.length
    ? tokenOverlapRatio(workflowNeedleTokens, doc.search_tokens)
    : 0;

  if (!workflowNeedleTokens.length) {
    return clamp(recency * 0.72, 0, 1);
  }

  return clamp(
    (recency * 0.35)
    + (historyOverlap * 0.4)
    + (docOverlap * 0.25),
    0,
    1
  );
}

function scoreProtocolCandidates({ candidates = [], entities = {}, context = {} } = {}) {
  const historyIndex = buildNotebookHistoryIndex({
    notebookEntries: asArray(context.notebookEntries),
    projects: asArray(context.projects)
  });

  return asArray(candidates)
    .map((candidate) => {
      const doc = candidate.doc;
      const semantic = clamp(Math.max(candidate.semantic_score, candidate.keyword_score), 0, 1);
      const entityOverlap = scoreEntityOverlap(doc, entities);
      const projectRelevance = scoreProjectRelevance(doc, entities, historyIndex);
      const recentWorkflowRelevance = scoreRecentWorkflowRelevance(doc, entities, historyIndex);
      const score = clamp(
        (semantic * 0.5)
        + (entityOverlap * 0.25)
        + (projectRelevance * 0.15)
        + (recentWorkflowRelevance * 0.1),
        0,
        1
      );

      return {
        protocol_id: doc.id,
        protocol_name: doc.title,
        category: cleanText(doc.category, 80),
        steps: asArray(doc.steps).slice(0, 8),
        score,
        semantic_score: semantic,
        entity_overlap_score: entityOverlap,
        project_relevance_score: projectRelevance,
        recent_workflow_relevance_score: recentWorkflowRelevance,
        reason: `semantic=${semantic.toFixed(2)} entity=${entityOverlap.toFixed(2)} project=${projectRelevance.toFixed(2)} recent=${recentWorkflowRelevance.toFixed(2)}`,
        _doc: doc
      };
    })
    .sort((left, right) => (
      (right.score - left.score)
      || (right.semantic_score - left.semantic_score)
      || (right.entity_overlap_score - left.entity_overlap_score)
      || left.protocol_name.localeCompare(right.protocol_name)
    ));
}

function evaluateProtocolAmbiguity({ ranked = [] } = {}) {
  const top = asArray(ranked)[0] || null;
  const second = asArray(ranked)[1] || null;
  const topScore = top ? clamp(top.score, 0, 1) : 0;
  const scoreDelta = top
    ? clamp(topScore - (second ? clamp(second.score, 0, 1) : 0), 0, 1)
    : 0;

  if (!top) {
    return {
      needs_clarification: true,
      ambiguity_reason: 'no_protocol_candidates',
      top_score: 0,
      score_delta: 0
    };
  }

  if (topScore < TOP_SCORE_CLARIFICATION_THRESHOLD) {
    return {
      needs_clarification: true,
      ambiguity_reason: 'top_score_below_threshold',
      top_score: topScore,
      score_delta: scoreDelta
    };
  }

  if (second && scoreDelta < TOP_DELTA_CLARIFICATION_THRESHOLD) {
    return {
      needs_clarification: true,
      ambiguity_reason: 'top_two_scores_too_close',
      top_score: topScore,
      score_delta: scoreDelta
    };
  }

  return {
    needs_clarification: false,
    ambiguity_reason: '',
    top_score: topScore,
    score_delta: scoreDelta
  };
}

function buildProtocolFollowUpQuestion({ ranked = [], entities = {} } = {}) {
  const candidates = asArray(ranked).slice(0, 3);
  const names = candidates.map((candidate) => cleanText(candidate.protocol_name, 120)).filter(Boolean);
  if (!names.length) {
    return 'Which lab activity should I map to a protocol (for example cell maintenance, transfection, purification, or assay setup)?';
  }

  const cellLine = cleanText(entities?.cell_line, 80);
  const contextHint = cellLine ? ` for ${cellLine}` : '';

  if (names.length === 1) {
    return `I found "${names[0]}"${contextHint}, but confidence is low. What specific activity or workflow step did you run?`;
  }

  if (names.length === 2) {
    return `Which protocol matches your run${contextHint}: "${names[0]}" or "${names[1]}"?`;
  }

  return `Which protocol matches your run${contextHint}: "${names[0]}", "${names[1]}", or "${names[2]}"?`;
}

function resolveProtocolMatch({
  message,
  entities = {},
  protocols = [],
  projects = [],
  notebookEntries = [],
  maxCandidates = 3
} = {}) {
  const docs = buildSearchableProtocolDocs({
    protocols,
    projects,
    notebookEntries
  });
  const retrieved = retrieveProtocolCandidates({
    message,
    entities,
    docs,
    maxCandidates: Math.max(6, maxCandidates)
  });
  const ranked = scoreProtocolCandidates({
    candidates: retrieved,
    entities,
    context: {
      notebookEntries,
      projects
    }
  });

  const topCandidates = ranked
    .slice(0, Math.max(1, maxCandidates))
    .map((candidate) => ({
      protocol_id: cleanText(candidate.protocol_id, 80),
      protocol_name: cleanText(candidate.protocol_name, 220),
      category: cleanText(candidate.category, 80),
      steps: asArray(candidate.steps).slice(0, 8).map((step) => cleanText(step, 240)).filter(Boolean),
      score: Number(candidate.score.toFixed(4)),
      semantic_score: Number(candidate.semantic_score.toFixed(4)),
      entity_overlap_score: Number(candidate.entity_overlap_score.toFixed(4)),
      project_relevance_score: Number(candidate.project_relevance_score.toFixed(4)),
      recent_workflow_relevance_score: Number(candidate.recent_workflow_relevance_score.toFixed(4)),
      reason: cleanText(candidate.reason, 220)
    }));

  const ambiguity = evaluateProtocolAmbiguity({ ranked: topCandidates });
  const clarificationQuestion = ambiguity.needs_clarification
    ? buildProtocolFollowUpQuestion({ ranked: topCandidates, entities })
    : '';
  const selected = !ambiguity.needs_clarification && topCandidates[0]
    ? {
      protocol_id: topCandidates[0].protocol_id,
      protocol_name: topCandidates[0].protocol_name,
      score: topCandidates[0].score
    }
    : null;

  return {
    docs,
    candidates: topCandidates,
    selected,
    ambiguity: {
      ...ambiguity,
      clarification_question: clarificationQuestion
    }
  };
}

module.exports = {
  TOP_SCORE_CLARIFICATION_THRESHOLD,
  TOP_DELTA_CLARIFICATION_THRESHOLD,
  buildSearchableProtocolDocs,
  retrieveProtocolCandidates,
  scoreProtocolCandidates,
  evaluateProtocolAmbiguity,
  buildProtocolFollowUpQuestion,
  resolveProtocolMatch
};
