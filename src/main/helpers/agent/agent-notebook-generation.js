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

function uniqueStrings(values, maxLength = 240) {
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

function toIsoDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value) {
  const timestamp = Date.parse(String(value || '').trim());
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  return timestamp;
}

function normalizePlaceholderKey(value) {
  const normalized = cleanText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'value';
}

function normalizeKeyAlias(value) {
  return normalizePlaceholderKey(value).replace(/_/g, '');
}

function getStepText(step) {
  if (typeof step === 'string') {
    return cleanText(step, 320);
  }
  return cleanText(step?.text || step?.instruction || step?.action || step?.description, 320);
}

function parseStructuredPlaceholders(step) {
  return asArray(step?.placeholders)
    .map((item, index) => {
      const name = cleanText(item?.name, 120);
      if (!name) {
        return null;
      }
      const placeholderId = cleanText(item?.id, 120) || `placeholder_${index + 1}`;
      return {
        placeholder_id: placeholderId,
        placeholder_key: normalizePlaceholderKey(name),
        display: `[${name}]`,
        marker_type: 'structured',
        marker: ''
      };
    })
    .filter(Boolean);
}

function extractProtocolPlaceholders(steps = []) {
  const normalizedSteps = asArray(steps)
    .map((step, index) => {
      const rawStep = step && typeof step === 'object' ? step : { text: step };
      const text = getStepText(rawStep);
      if (!text) {
        return null;
      }
      const stepId = cleanText(rawStep?.id, 120) || `step_${index + 1}`;
      const structured = parseStructuredPlaceholders(rawStep);
      const byId = new Map(structured.map((item) => [item.placeholder_id, item]));
      const placeholders = [];
      const placeholderByKey = new Map();

      // Keep extraction deterministic by scanning markers in source order.
      const markerRegex = /(\{\{ph:([^}]+)\}\}|\[([^\[\]]{1,80})\])/g;
      let order = 0;
      let match = markerRegex.exec(text);
      let bracketCount = 0;
      while (match) {
        order += 1;
        const token = cleanText(match[0], 120);
        const tokenId = cleanText(match[2], 120);
        const bracketName = cleanText(match[3], 120);
        if (tokenId) {
          const structuredMatch = byId.get(tokenId);
          const key = normalizePlaceholderKey(structuredMatch?.placeholder_key || tokenId);
          placeholders.push({
            step_id: stepId,
            placeholder_id: tokenId,
            placeholder_key: key,
            display: cleanText(structuredMatch?.display, 120) || `[${key}]`,
            marker_type: 'token',
            marker: token,
            order
          });
          placeholderByKey.set(`${stepId}:${tokenId}`, true);
        } else if (bracketName) {
          bracketCount += 1;
          const generatedId = `inline_${bracketCount}`;
          const key = normalizePlaceholderKey(bracketName);
          placeholders.push({
            step_id: stepId,
            placeholder_id: generatedId,
            placeholder_key: key,
            display: `[${bracketName}]`,
            marker_type: 'bracket',
            marker: token,
            order
          });
          placeholderByKey.set(`${stepId}:${generatedId}`, true);
        }
        match = markerRegex.exec(text);
      }

      structured.forEach((placeholder) => {
        const key = `${stepId}:${placeholder.placeholder_id}`;
        if (placeholderByKey.has(key)) {
          return;
        }
        placeholders.push({
          step_id: stepId,
          placeholder_id: placeholder.placeholder_id,
          placeholder_key: placeholder.placeholder_key,
          display: placeholder.display,
          marker_type: 'trailing',
          marker: '',
          order: 10000 + placeholders.length
        });
      });

      return {
        step_id: stepId,
        text,
        placeholders: placeholders.sort((left, right) => left.order - right.order)
      };
    })
    .filter(Boolean);

  return normalizedSteps;
}

function inferPlaceholderType(placeholderKey, display = '') {
  const key = normalizePlaceholderKey(`${placeholderKey} ${display}`);
  if (/(^|_)cell(_|$)|hek293|cho|hela|jurkat|vero|sf9|k562/.test(key)) {
    return 'cell_line';
  }
  if (/(^|_)project(_|$)/.test(key)) {
    return 'project';
  }
  if (/(^|_)protein(_|$)|binder|antibody/.test(key)) {
    return 'protein';
  }
  if (/(^|_)compound(_|$)|reagent|chemical|buffer/.test(key)) {
    return 'compound';
  }
  if (/(^|_)protocol(_|$)|method|sop/.test(key)) {
    return 'protocol';
  }
  if (/(^|_)workflow(_|$)|(^|_)step(_|$)/.test(key)) {
    return 'workflow_step';
  }
  if (/(^|_)date(_|$)|day/.test(key)) {
    return 'date';
  }
  if (/(^|_)time(_|$)|incubat|duration/.test(key)) {
    return 'time';
  }
  if (/(^|_)temp|celsius/.test(key)) {
    return 'temperature';
  }
  if (/(^|_)operator(_|$)|scientist|user|owner/.test(key)) {
    return 'operator';
  }
  if (/(^|_)sample(_|$)|construct|plasmid/.test(key)) {
    return 'sample';
  }
  return 'generic';
}

function detectCellLine(text) {
  const match = String(text || '').match(/\b(hek293|expi293|293t|cho|hela|vero|jurkat|sf9|k562)\b/i);
  return cleanText(match?.[1], 80);
}

function detectProject(text) {
  const match = String(text || '').match(/\bproject\s+([a-z0-9][a-z0-9 _-]{1,80})/i);
  return cleanText(match?.[1], 120);
}

function detectDate(text, now = new Date()) {
  const source = String(text || '').toLowerCase();
  if (!source) {
    return '';
  }
  const explicit = source.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (explicit) {
    return cleanText(explicit[1], 20);
  }
  const base = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(base.getTime())) {
    return '';
  }
  if (source.includes('today')) {
    return toIsoDate(base);
  }
  if (source.includes('yesterday')) {
    const prev = new Date(base.getTime() - (24 * 60 * 60 * 1000));
    return toIsoDate(prev);
  }
  if (source.includes('tomorrow')) {
    const next = new Date(base.getTime() + (24 * 60 * 60 * 1000));
    return toIsoDate(next);
  }
  return '';
}

function detectTime(text) {
  const match = String(text || '').match(/\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|min|mins|minute|minutes|day|days)\b/i);
  if (!match) {
    return '';
  }
  return cleanText(`${match[1]} ${match[2]}`, 40);
}

function detectTemperature(text) {
  const match = String(text || '').match(/\b(\d+(?:\.\d+)?)\s*(?:°\s*)?(c|celsius)\b/i);
  if (!match) {
    return '';
  }
  return cleanText(`${match[1]} C`, 40);
}

function detectWorkflowStep(text) {
  const match = String(text || '').match(/\b(?:step|workflow|after|before|next)\s+([a-z0-9][a-z0-9 _-]{1,80})/i);
  return cleanText(match?.[1], 160);
}

function collectTypedCandidatesFromText(text, now = new Date()) {
  const byType = {};
  const cellLine = detectCellLine(text);
  if (cellLine) {
    byType.cell_line = cellLine;
  }
  const project = detectProject(text);
  if (project) {
    byType.project = project;
  }
  const date = detectDate(text, now);
  if (date) {
    byType.date = date;
  }
  const time = detectTime(text);
  if (time) {
    byType.time = time;
  }
  const temperature = detectTemperature(text);
  if (temperature) {
    byType.temperature = temperature;
  }
  const workflowStep = detectWorkflowStep(text);
  if (workflowStep) {
    byType.workflow_step = workflowStep;
  }
  return byType;
}

function mergeCandidate(target, key, value) {
  const normalizedKey = normalizePlaceholderKey(key);
  const text = cleanText(value, 220);
  if (!normalizedKey || !text) {
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(target, normalizedKey)) {
    target[normalizedKey] = text;
  }
}

function buildCandidateSource(name, now = new Date()) {
  return {
    name,
    byKey: {},
    byAliasKey: {},
    byType: {},
    now
  };
}

function finalizeCandidateSource(source) {
  Object.entries(source.byKey).forEach(([key, value]) => {
    source.byAliasKey[normalizeKeyAlias(key)] = value;
  });
  return source;
}

function buildUserInputSource({ message, routingEntities = {}, now = new Date() } = {}) {
  const source = buildCandidateSource('user_input', now);
  const entities = routingEntities && typeof routingEntities === 'object' ? routingEntities : {};
  const byType = {
    activity: cleanText(entities.activity, 180),
    project: cleanText(entities.project, 180),
    protein: cleanText(entities.protein, 120),
    compound: cleanText(entities.compound, 120),
    protocol: cleanText(entities.protocol, 220),
    cell_line: cleanText(entities.cell_line, 100),
    workflow_step: cleanText(entities.workflow_step, 180)
  };
  Object.entries(byType).forEach(([type, value]) => {
    if (!value) {
      return;
    }
    source.byType[type] = value;
    mergeCandidate(source.byKey, type, value);
  });

  const extracted = collectTypedCandidatesFromText(message, now);
  Object.entries(extracted).forEach(([type, value]) => {
    if (!value) {
      return;
    }
    if (!source.byType[type]) {
      source.byType[type] = value;
    }
    mergeCandidate(source.byKey, type, value);
  });
  return finalizeCandidateSource(source);
}

function buildConversationContextSource({ conversation = [], latestMessage = '', now = new Date() } = {}) {
  const source = buildCandidateSource('conversation_context', now);
  const messages = asArray(conversation)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      text: cleanText(item?.text, 1000)
    }))
    .filter((item) => item.text);

  const latest = cleanText(latestMessage, 1000);
  const contextMessages = messages.filter((item, index) => {
    if (index !== messages.length - 1) {
      return true;
    }
    return item.text !== latest;
  });

  const mergedText = contextMessages.slice(-8).map((item) => item.text).join(' ');
  const extracted = collectTypedCandidatesFromText(mergedText, now);
  Object.entries(extracted).forEach(([type, value]) => {
    source.byType[type] = value;
    mergeCandidate(source.byKey, type, value);
  });

  const recentUser = contextMessages
    .filter((item) => item.role === 'user')
    .slice(-2)
    .map((item) => item.text)
    .join(' ');
  const recentExtracted = collectTypedCandidatesFromText(recentUser, now);
  Object.entries(recentExtracted).forEach(([type, value]) => {
    if (!source.byType[type]) {
      source.byType[type] = value;
    }
    mergeCandidate(source.byKey, type, value);
  });

  return finalizeCandidateSource(source);
}

function buildFollowUpSource({ conversation = [], latestMessage = '', now = new Date() } = {}) {
  const source = buildCandidateSource('follow_up_answer', now);
  const messages = asArray(conversation)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      text: cleanText(item?.text, 1000)
    }))
    .filter((item) => item.text && item.role === 'user');

  const latest = cleanText(latestMessage, 1000);
  const candidate = messages
    .filter((item) => item.text !== latest)
    .slice(-1)[0];
  if (!candidate?.text) {
    return finalizeCandidateSource(source);
  }

  const extracted = collectTypedCandidatesFromText(candidate.text, now);
  Object.entries(extracted).forEach(([type, value]) => {
    source.byType[type] = value;
    mergeCandidate(source.byKey, type, value);
  });
  return finalizeCandidateSource(source);
}

function scoreNameMatch(needle, haystack) {
  const left = cleanText(needle, 200).toLowerCase();
  const right = cleanText(haystack, 200).toLowerCase();
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  if (right.includes(left) || left.includes(right)) {
    return 0.8;
  }
  const leftTokens = left.split(/[^a-z0-9]+/i).filter((token) => token.length >= 2);
  const rightSet = new Set(right.split(/[^a-z0-9]+/i).filter((token) => token.length >= 2));
  if (!leftTokens.length || !rightSet.size) {
    return 0;
  }
  const overlap = leftTokens.reduce((count, token) => (rightSet.has(token) ? count + 1 : count), 0);
  return overlap ? Math.min(0.75, overlap / leftTokens.length) : 0;
}

function lexicalProjectTieBreaker(left, right) {
  const leftId = cleanText(left?.id, 80).toLowerCase();
  const rightId = cleanText(right?.id, 80).toLowerCase();
  if (leftId && rightId && leftId !== rightId) {
    return leftId.localeCompare(rightId);
  }
  return cleanText(left?.name, 180).toLowerCase().localeCompare(cleanText(right?.name, 180).toLowerCase());
}

function resolveProjectForNotebookDraft({
  selectedProjectId = '',
  selectedProjectName = '',
  entityProject = '',
  selectedProtocol = null,
  projects = [],
  notebookEntries = []
} = {}) {
  const projectList = asArray(projects)
    .map((project) => ({
      id: cleanText(project?.id, 80),
      name: cleanText(project?.name, 180)
    }))
    .filter((project) => project.id || project.name);
  const projectById = new Map(projectList.filter((project) => project.id).map((project) => [project.id, project]));

  const selectedId = cleanText(selectedProjectId, 80);
  if (selectedId && projectById.has(selectedId)) {
    const project = projectById.get(selectedId);
    return {
      id: project.id,
      name: project.name,
      resolution_source: 'selected_project'
    };
  }

  const selectedName = cleanText(selectedProjectName, 180);
  if (selectedName) {
    const ranked = projectList
      .map((project) => ({ project, score: scoreNameMatch(selectedName, project.name) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => (right.score - left.score) || lexicalProjectTieBreaker(left.project, right.project));
    if (ranked[0]) {
      return {
        id: ranked[0].project.id,
        name: ranked[0].project.name,
        resolution_source: 'selected_project_name'
      };
    }
  }

  const entityName = cleanText(entityProject, 180);
  if (entityName) {
    const ranked = projectList
      .map((project) => ({ project, score: scoreNameMatch(entityName, project.name) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => (right.score - left.score) || lexicalProjectTieBreaker(left.project, right.project));
    if (ranked[0]) {
      return {
        id: ranked[0].project.id,
        name: ranked[0].project.name,
        resolution_source: 'entity_project'
      };
    }
  }

  const protocolId = cleanText(selectedProtocol?.id, 80);
  const protocolName = cleanText(selectedProtocol?.name, 220);
  const protocolHistory = new Map();
  asArray(notebookEntries).forEach((entry) => {
    const entryProtocolId = cleanText(entry?.protocolId || entry?.protocol_id, 80);
    const entryProtocolName = cleanText(entry?.protocolName || entry?.protocol_name, 220);
    const matchesProtocol = Boolean(
      (protocolId && entryProtocolId && protocolId === entryProtocolId)
      || (protocolName && entryProtocolName && protocolName.toLowerCase() === entryProtocolName.toLowerCase())
    );
    if (!matchesProtocol) {
      return;
    }
    const projectId = cleanText(entry?.projectId || entry?.project_id, 80);
    const projectName = cleanText(entry?.projectName || entry?.project_name, 180);
    const key = projectId || projectName;
    if (!key) {
      return;
    }
    if (!protocolHistory.has(key)) {
      protocolHistory.set(key, {
        id: projectId,
        name: projectName,
        count: 0,
        latest: 0
      });
    }
    const bucket = protocolHistory.get(key);
    bucket.count += 1;
    const ts = parseIsoDate(entry?.updatedAt || entry?.updated_at || entry?.createdAt || entry?.created_at);
    if (ts > bucket.latest) {
      bucket.latest = ts;
    }
    if (!bucket.id && projectId) {
      bucket.id = projectId;
    }
    if (!bucket.name && projectName) {
      bucket.name = projectName;
    }
  });

  if (protocolHistory.size > 0) {
    const ranked = [...protocolHistory.values()].sort((left, right) => (
      (right.count - left.count)
      || (right.latest - left.latest)
      || lexicalProjectTieBreaker(left, right)
    ));
    const winner = ranked[0];
    return {
      id: cleanText(winner.id, 80),
      name: cleanText(winner.name, 180),
      resolution_source: 'protocol_history'
    };
  }

  const usageHistory = new Map();
  asArray(notebookEntries).forEach((entry) => {
    const projectId = cleanText(entry?.projectId || entry?.project_id, 80);
    const projectName = cleanText(entry?.projectName || entry?.project_name, 180);
    const key = projectId || projectName;
    if (!key) {
      return;
    }
    if (!usageHistory.has(key)) {
      usageHistory.set(key, {
        id: projectId,
        name: projectName,
        count: 0,
        latest: 0
      });
    }
    const bucket = usageHistory.get(key);
    bucket.count += 1;
    const ts = parseIsoDate(entry?.updatedAt || entry?.updated_at || entry?.createdAt || entry?.created_at);
    if (ts > bucket.latest) {
      bucket.latest = ts;
    }
    if (!bucket.id && projectId) {
      bucket.id = projectId;
    }
    if (!bucket.name && projectName) {
      bucket.name = projectName;
    }
  });

  if (usageHistory.size > 0) {
    const ranked = [...usageHistory.values()].sort((left, right) => (
      (right.count - left.count)
      || (right.latest - left.latest)
      || lexicalProjectTieBreaker(left, right)
    ));
    const winner = ranked[0];
    return {
      id: cleanText(winner.id, 80),
      name: cleanText(winner.name, 180),
      resolution_source: 'top_project_fallback'
    };
  }

  if (projectList.length > 0) {
    const fallback = [...projectList].sort(lexicalProjectTieBreaker)[0];
    return {
      id: fallback.id,
      name: fallback.name,
      resolution_source: 'top_project_fallback'
    };
  }

  return {
    id: '',
    name: '',
    resolution_source: 'unresolved'
  };
}

function buildProjectRecordSource({ project, protocol, notebookEntries = [], now = new Date() } = {}) {
  const source = buildCandidateSource('project_records', now);
  if (project?.name) {
    source.byType.project = cleanText(project.name, 180);
    mergeCandidate(source.byKey, 'project', project.name);
  }
  if (protocol?.name) {
    source.byType.protocol = cleanText(protocol.name, 220);
    mergeCandidate(source.byKey, 'protocol', protocol.name);
  }

  const protocolId = cleanText(protocol?.id, 80);
  const protocolName = cleanText(protocol?.name, 220).toLowerCase();
  const projectId = cleanText(project?.id, 80);
  const projectName = cleanText(project?.name, 180).toLowerCase();

  const candidates = asArray(notebookEntries)
    .filter((entry) => {
      const entryProtocolId = cleanText(entry?.protocolId || entry?.protocol_id, 80);
      const entryProtocolName = cleanText(entry?.protocolName || entry?.protocol_name, 220).toLowerCase();
      const entryProjectId = cleanText(entry?.projectId || entry?.project_id, 80);
      const entryProjectName = cleanText(entry?.projectName || entry?.project_name, 180).toLowerCase();
      const protocolMatch = protocolId
        ? entryProtocolId === protocolId
        : (protocolName && entryProtocolName === protocolName);
      const projectMatch = projectId
        ? entryProjectId === projectId
        : (projectName ? entryProjectName === projectName : true);
      return protocolMatch || projectMatch;
    })
    .sort((left, right) => parseIsoDate(right?.updatedAt || right?.updated_at || right?.createdAt || right?.created_at)
      - parseIsoDate(left?.updatedAt || left?.updated_at || left?.createdAt || left?.created_at));

  const latest = candidates[0];
  if (latest) {
    const latestResult = cleanText(latest?.result, 800);
    const extracted = collectTypedCandidatesFromText(latestResult, now);
    Object.entries(extracted).forEach(([type, value]) => {
      if (!source.byType[type]) {
        source.byType[type] = value;
      }
      mergeCandidate(source.byKey, type, value);
    });
  }

  return finalizeCandidateSource(source);
}

function buildToolResultsSource({ toolResults = [], now = new Date() } = {}) {
  const source = buildCandidateSource('tool_results', now);
  asArray(toolResults).forEach((toolResult) => {
    asArray(toolResult?.items).forEach((item) => {
      if (!item || typeof item !== 'object') {
        return;
      }
      Object.entries(item).forEach(([key, value]) => {
        const text = cleanText(value, 240);
        if (!text) {
          return;
        }
        mergeCandidate(source.byKey, key, text);
        const normalizedKey = normalizePlaceholderKey(key);
        if (normalizedKey.includes('project')) {
          mergeCandidate(source.byKey, 'project', text);
          if (!source.byType.project) {
            source.byType.project = text;
          }
        }
        if (normalizedKey.includes('protocol')) {
          mergeCandidate(source.byKey, 'protocol', text);
          if (!source.byType.protocol) {
            source.byType.protocol = text;
          }
        }
        if (normalizedKey.includes('cell')) {
          mergeCandidate(source.byKey, 'cell_line', text);
          if (!source.byType.cell_line) {
            source.byType.cell_line = text;
          }
        }
        if (normalizedKey.includes('workflow') || normalizedKey.includes('step')) {
          mergeCandidate(source.byKey, 'workflow_step', text);
          if (!source.byType.workflow_step) {
            source.byType.workflow_step = text;
          }
        }
        if (normalizedKey.includes('compound') || normalizedKey.includes('chemical') || normalizedKey.includes('reagent')) {
          mergeCandidate(source.byKey, 'compound', text);
          if (!source.byType.compound) {
            source.byType.compound = text;
          }
        }
        if (normalizedKey.includes('protein')) {
          mergeCandidate(source.byKey, 'protein', text);
          if (!source.byType.protein) {
            source.byType.protein = text;
          }
        }
      });

      const textualFields = uniqueStrings([
        cleanText(item?.name, 220),
        cleanText(item?.title, 220),
        cleanText(item?.summary, 500),
        cleanText(item?.result, 500)
      ], 500);
      const extracted = collectTypedCandidatesFromText(textualFields.join(' '), now);
      Object.entries(extracted).forEach(([type, value]) => {
        if (!source.byType[type]) {
          source.byType[type] = value;
        }
        mergeCandidate(source.byKey, type, value);
      });
    });
  });
  return finalizeCandidateSource(source);
}

function selectValueForPlaceholder({ placeholder, sources }) {
  const key = normalizePlaceholderKey(placeholder?.placeholder_key);
  const alias = normalizeKeyAlias(key);
  const type = inferPlaceholderType(key, placeholder?.display);

  for (const source of asArray(sources)) {
    const byKeyValue = cleanText(source?.byKey?.[key], 220);
    if (byKeyValue) {
      return { value: byKeyValue, source: source.name, source_type: 'by_key' };
    }
    const byAliasValue = cleanText(source?.byAliasKey?.[alias], 220);
    if (byAliasValue) {
      return { value: byAliasValue, source: source.name, source_type: 'by_alias' };
    }
    const byTypeValue = cleanText(source?.byType?.[type], 220);
    if (byTypeValue) {
      return { value: byTypeValue, source: source.name, source_type: 'by_type' };
    }

    if (type === 'date') {
      const inferredDate = cleanText(source?.byType?.date, 20);
      if (inferredDate) {
        return { value: inferredDate, source: source.name, source_type: 'date' };
      }
    }
  }

  return null;
}

function fillProtocolPlaceholders({ extractedSteps = [], sources = [] } = {}) {
  const placeholderValues = [];
  const unresolvedPlaceholders = [];
  const valuesByStepPlaceholder = new Map();

  asArray(extractedSteps).forEach((step) => {
    asArray(step?.placeholders).forEach((placeholder) => {
      const selected = selectValueForPlaceholder({ placeholder, sources });
      const entryKey = `${step.step_id}:${placeholder.placeholder_id}`;
      if (!selected) {
        unresolvedPlaceholders.push({
          step_id: step.step_id,
          placeholder_id: placeholder.placeholder_id,
          placeholder_key: placeholder.placeholder_key,
          display: placeholder.display,
          reason: 'missing_supported_value'
        });
        return;
      }

      const value = cleanText(selected.value, 220);
      if (!value) {
        unresolvedPlaceholders.push({
          step_id: step.step_id,
          placeholder_id: placeholder.placeholder_id,
          placeholder_key: placeholder.placeholder_key,
          display: placeholder.display,
          reason: 'empty_candidate'
        });
        return;
      }

      valuesByStepPlaceholder.set(entryKey, value);
      placeholderValues.push({
        step_id: step.step_id,
        placeholder_id: placeholder.placeholder_id,
        placeholder_key: placeholder.placeholder_key,
        display: placeholder.display,
        value,
        source: selected.source,
        source_type: selected.source_type
      });
    });
  });

  return {
    placeholderValues,
    unresolvedPlaceholders,
    valuesByStepPlaceholder
  };
}

function renderNotebookSteps({ extractedSteps = [], valuesByStepPlaceholder = new Map() } = {}) {
  return asArray(extractedSteps).map((step) => {
    const text = cleanText(step?.text, 600);
    const placeholders = asArray(step?.placeholders);
    const tokenById = new Map(placeholders.map((placeholder) => [placeholder.placeholder_id, placeholder]));
    const bracketList = placeholders.filter((placeholder) => placeholder.marker_type === 'bracket');
    let bracketIndex = 0;

    const replaced = text.replace(/(\{\{ph:([^}]+)\}\}|\[([^\[\]]{1,80})\])/g, (_full, rawToken, tokenId, bracketLabel) => {
      let placeholder = null;
      if (tokenId) {
        placeholder = tokenById.get(cleanText(tokenId, 120));
      } else if (bracketLabel) {
        placeholder = bracketList[bracketIndex] || null;
        bracketIndex += 1;
      }
      if (!placeholder) {
        return rawToken;
      }
      const key = `${step.step_id}:${placeholder.placeholder_id}`;
      const resolved = cleanText(valuesByStepPlaceholder.get(key), 220);
      return resolved || placeholder.display;
    });

    const trailing = placeholders
      .filter((placeholder) => placeholder.marker_type === 'trailing')
      .map((placeholder) => {
        const key = `${step.step_id}:${placeholder.placeholder_id}`;
        return cleanText(valuesByStepPlaceholder.get(key), 220) || placeholder.display;
      })
      .filter(Boolean)
      .join(' ');

    return cleanText(`${replaced}${trailing ? ` ${trailing}` : ''}`, 800);
  }).filter(Boolean);
}

function findSelectedProtocol({ routing = {}, protocols = [] } = {}) {
  const routingPlan = routing?.plan && typeof routing.plan === 'object' ? routing.plan : {};
  const match = routingPlan.protocol_match && typeof routingPlan.protocol_match === 'object'
    ? routingPlan.protocol_match
    : {};
  const protocolId = cleanText(match.selected_protocol_id, 120);
  const protocolName = cleanText(match.selected_protocol_name, 220);

  const normalizedProtocols = asArray(protocols);
  if (protocolId) {
    const exact = normalizedProtocols.find((protocol) => cleanText(protocol?.id, 120) === protocolId);
    if (exact) {
      return exact;
    }
  }
  if (protocolName) {
    const exact = normalizedProtocols.find((protocol) => cleanText(protocol?.name || protocol?.title, 220) === protocolName);
    if (exact) {
      return exact;
    }
    const includes = normalizedProtocols.find((protocol) => {
      const name = cleanText(protocol?.name || protocol?.title, 220).toLowerCase();
      return name && (name.includes(protocolName.toLowerCase()) || protocolName.toLowerCase().includes(name));
    });
    if (includes) {
      return includes;
    }
  }

  const firstCandidate = asArray(routingPlan.protocol_candidates)[0];
  const candidateId = cleanText(firstCandidate?.protocol_id, 120);
  const candidateName = cleanText(firstCandidate?.protocol_name, 220);
  if (candidateId) {
    const byId = normalizedProtocols.find((protocol) => cleanText(protocol?.id, 120) === candidateId);
    if (byId) {
      return byId;
    }
  }
  if (candidateName) {
    const byName = normalizedProtocols.find((protocol) => cleanText(protocol?.name || protocol?.title, 220) === candidateName);
    if (byName) {
      return byName;
    }
  }

  return null;
}

function normalizeProtocolForDraft(protocol) {
  if (!protocol || typeof protocol !== 'object') {
    return null;
  }
  const name = cleanText(protocol?.name || protocol?.title, 220);
  if (!name) {
    return null;
  }
  const stepSource = asArray(protocol?.step_entries).length ? protocol.step_entries : protocol.steps;
  const extractedSteps = extractProtocolPlaceholders(stepSource);
  return {
    id: cleanText(protocol?.id, 120),
    name,
    steps: extractedSteps,
    category: cleanText(protocol?.category, 120)
  };
}

function toEntryValuesMap(placeholderValues) {
  const values = {};
  asArray(placeholderValues).forEach((item) => {
    const stepId = cleanText(item?.step_id, 120);
    const placeholderId = cleanText(item?.placeholder_id, 120);
    const value = cleanText(item?.value, 220);
    if (!stepId || !placeholderId || !value) {
      return;
    }
    values[`${stepId}:${placeholderId}`] = value;
  });
  return values;
}

function buildNotebookDraft({
  message,
  conversation = [],
  routing = {},
  snapshot = {},
  selectedProjectId = '',
  selectedProjectName = '',
  toolResults = [],
  now = new Date()
} = {}) {
  const latestMessage = cleanText(message, 3000);
  if (!latestMessage) {
    return null;
  }

  const intent = cleanText(routing?.intent, 80);
  const needsClarification = routing?.plan?.needs_clarification === true;
  if (intent !== 'protocol_to_notebook' || needsClarification) {
    return null;
  }

  const selectedProtocolRaw = findSelectedProtocol({
    routing,
    protocols: asArray(snapshot?.protocols)
  });
  const protocol = normalizeProtocolForDraft(selectedProtocolRaw);
  if (!protocol || !asArray(protocol.steps).length) {
    return null;
  }

  const resolvedProject = resolveProjectForNotebookDraft({
    selectedProjectId,
    selectedProjectName,
    entityProject: cleanText(routing?.entities?.project, 180),
    selectedProtocol: selectedProtocolRaw,
    projects: asArray(snapshot?.projects),
    notebookEntries: asArray(snapshot?.notebookEntries)
  });

  const userInputSource = buildUserInputSource({
    message: latestMessage,
    routingEntities: routing?.entities,
    now
  });
  const conversationSource = buildConversationContextSource({
    conversation,
    latestMessage,
    now
  });
  const projectRecordSource = buildProjectRecordSource({
    project: resolvedProject,
    protocol,
    notebookEntries: asArray(snapshot?.notebookEntries),
    now
  });
  const toolResultsSource = buildToolResultsSource({
    toolResults,
    now
  });
  const followUpSource = buildFollowUpSource({
    conversation,
    latestMessage,
    now
  });

  const fill = fillProtocolPlaceholders({
    extractedSteps: protocol.steps,
    sources: [
      userInputSource,
      conversationSource,
      projectRecordSource,
      toolResultsSource,
      followUpSource
    ]
  });

  const renderedSteps = renderNotebookSteps({
    extractedSteps: protocol.steps,
    valuesByStepPlaceholder: fill.valuesByStepPlaceholder
  });

  const nowIso = toIsoDate(now) ? new Date(now).toISOString() : new Date().toISOString();
  const unresolvedCount = fill.unresolvedPlaceholders.length;
  const agentDraftStatus = unresolvedCount > 0 ? 'needs_review' : 'draft_ready';
  const entryTemplate = {
    notebookType: 'biology',
    projectId: cleanText(resolvedProject?.id, 80),
    projectName: cleanText(resolvedProject?.name, 180),
    protocolId: cleanText(protocol?.id, 120),
    protocolName: cleanText(protocol?.name, 220),
    values: toEntryValuesMap(fill.placeholderValues),
    result: cleanText(`Agent-generated notebook draft from request: ${latestMessage}`, 900),
    updatedAt: nowIso,
    resultFiles: [],
    resultFileRecords: [],
    agentDraftStatus,
    agentDraftMeta: {
      generatedAt: nowIso,
      unresolvedCount,
      source: 'agent_phase5',
      protocolCategory: cleanText(protocol?.category, 120)
    }
  };

  return {
    protocol: {
      id: cleanText(protocol?.id, 120),
      name: cleanText(protocol?.name, 220)
    },
    project: {
      id: cleanText(resolvedProject?.id, 80),
      name: cleanText(resolvedProject?.name, 180),
      resolution_source: cleanText(resolvedProject?.resolution_source, 80) || 'unresolved'
    },
    notebook_type: 'biology',
    rendered_steps: renderedSteps,
    placeholder_values: fill.placeholderValues,
    unresolved_placeholders: fill.unresolvedPlaceholders,
    save: {
      mode: 'auto_save_draft',
      applied: false,
      status: 'pending_client_autosave',
      reason: 'Renderer will persist notebook draft entry locally.'
    },
    entry_template: entryTemplate
  };
}

function buildNotebookDraftSummary(draft) {
  const normalized = draft && typeof draft === 'object' ? draft : null;
  if (!normalized) {
    return '';
  }
  const protocolName = cleanText(normalized?.protocol?.name, 220) || 'selected protocol';
  const projectName = cleanText(normalized?.project?.name, 180) || 'top project';
  const unresolvedCount = asArray(normalized?.unresolved_placeholders).length;
  const statusText = unresolvedCount
    ? `${unresolvedCount} unresolved placeholder${unresolvedCount > 1 ? 's' : ''}`
    : 'all placeholders resolved';
  return `Notebook draft prepared for "${protocolName}" in "${projectName}" (${statusText}). Auto-save draft is queued.`;
}

module.exports = {
  extractProtocolPlaceholders,
  resolveProjectForNotebookDraft,
  fillProtocolPlaceholders,
  renderNotebookSteps,
  buildNotebookDraft,
  buildNotebookDraftSummary
};
