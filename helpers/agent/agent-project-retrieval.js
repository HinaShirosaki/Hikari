'use strict';

const PROJECT_SCOPE_SCORE_THRESHOLD = 0.6;
const PROJECT_SCOPE_DELTA_THRESHOLD = 0.1;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function tokenize(value) {
  return cleanText(value, 8000)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 120);
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 260);
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

function normalizeIso(value) {
  const text = cleanText(value, 80);
  if (!text) {
    return '';
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    return '';
  }
  return new Date(parsed).toISOString();
}

function parseDate(value) {
  const parsed = Date.parse(cleanText(value, 80));
  return Number.isFinite(parsed) ? parsed : 0;
}

function recencyScore(value, now = new Date()) {
  const updated = parseDate(value);
  if (!updated) {
    return 0.15;
  }
  const deltaMs = Math.max(0, now.getTime() - updated);
  const days = deltaMs / (24 * 60 * 60 * 1000);
  const score = Math.exp(-days / 180);
  return clamp(score, 0, 1);
}

function tokenOverlapScore(targetTokens, queryTokens) {
  const targets = new Set(asArray(targetTokens).map((token) => String(token).toLowerCase()));
  const queries = uniqueStrings(asArray(queryTokens).map((token) => String(token).toLowerCase()));
  if (!targets.size || !queries.length) {
    return 0;
  }
  let overlap = 0;
  queries.forEach((token) => {
    if (targets.has(token)) {
      overlap += 1;
    }
  });
  return clamp(overlap / queries.length, 0, 1);
}

function scoreNameMatch(projectName, query) {
  const name = cleanText(projectName, 220).toLowerCase();
  const needle = cleanText(query, 220).toLowerCase();
  if (!name || !needle) {
    return {
      exact: 0,
      partial: 0,
      token: 0,
      score: 0
    };
  }

  const exact = name === needle ? 1 : 0;
  const partial = exact
    ? 1
    : (name.includes(needle) || needle.includes(name) ? 0.8 : 0);
  const token = tokenOverlapScore(tokenize(name), tokenize(needle));
  const score = clamp(Math.max(exact, partial, token), 0, 1);

  return {
    exact,
    partial,
    token,
    score
  };
}

function scoreProjectCandidate({
  project,
  message,
  entities,
  selectedProjectId,
  selectedProjectName,
  linkedRecordCount
}) {
  const projectId = cleanText(project?.id, 80);
  const projectName = cleanText(project?.name, 220);
  const selectedId = cleanText(selectedProjectId, 80);
  const selectedName = cleanText(selectedProjectName, 220);
  const entityProject = cleanText(entities?.project, 220);

  const selectedIdScore = selectedId && projectId && selectedId === projectId ? 1 : 0;
  const selectedNameMatch = scoreNameMatch(projectName, selectedName);
  const entityMatch = scoreNameMatch(projectName, entityProject);
  const messageMatch = scoreNameMatch(projectName, message);
  const partialNameScore = clamp(
    Math.max(selectedNameMatch.partial, entityMatch.partial, messageMatch.partial),
    0,
    1
  );
  const exactNameScore = clamp(
    Math.max(selectedNameMatch.exact, entityMatch.exact, messageMatch.exact),
    0,
    1
  );
  const selectedBiasScore = clamp(Math.max(selectedIdScore, selectedNameMatch.score), 0, 1);
  const linkedRecordSupportScore = clamp(Math.log1p(Math.max(0, Number(linkedRecordCount) || 0)) / Math.log1p(24), 0, 1);

  let score;
  if (selectedBiasScore >= 0.95) {
    score = clamp(0.72 + (0.18 * entityMatch.score) + (0.10 * linkedRecordSupportScore), 0, 1);
  } else {
    score = clamp(
      (0.42 * Math.max(entityMatch.score, selectedNameMatch.score))
      + (0.28 * messageMatch.score)
      + (0.18 * partialNameScore)
      + (0.12 * linkedRecordSupportScore),
      0,
      1
    );
  }

  const reasonParts = [];
  if (selectedBiasScore >= 0.95) {
    reasonParts.push('selected project bias');
  }
  if (exactNameScore > 0) {
    reasonParts.push('exact project name');
  } else if (partialNameScore > 0) {
    reasonParts.push('partial project name');
  }
  if (messageMatch.score > 0) {
    reasonParts.push('message overlap');
  }
  if (linkedRecordSupportScore > 0) {
    reasonParts.push('linked records');
  }

  return {
    project_id: projectId,
    project_name: projectName,
    score,
    exact_name_score: exactNameScore,
    partial_name_score: partialNameScore,
    selected_bias_score: selectedBiasScore,
    linked_record_support_score: linkedRecordSupportScore,
    reason: reasonParts.length ? reasonParts.join(', ') : 'fallback candidate'
  };
}

function scoreEvidenceRecord({
  messageTokens,
  entityTokens,
  workflowTokens,
  text,
  updatedAt,
  now
}) {
  const recordTokens = tokenize(text);
  const tokenScore = tokenOverlapScore(recordTokens, messageTokens);
  const entityOverlap = tokenOverlapScore(recordTokens, [...entityTokens, ...workflowTokens]);
  const recency = recencyScore(updatedAt, now);
  const score = clamp((0.55 * tokenScore) + (0.30 * entityOverlap) + (0.15 * recency), 0, 1);
  return {
    score,
    token_score: tokenScore,
    entity_overlap_score: entityOverlap,
    recency_score: recency
  };
}

function buildStepsPreview(steps, maxItems = 5) {
  return asArray(steps)
    .map((step) => {
      if (typeof step === 'string') {
        return cleanText(step, 220);
      }
      return cleanText(step?.text || step?.instruction || step?.action || step?.description, 220);
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildProjectFollowUpQuestion({ candidates }) {
  const items = asArray(candidates)
    .map((candidate) => cleanText(candidate?.project_name || candidate?.project_id, 120))
    .filter(Boolean)
    .slice(0, 3);

  if (!items.length) {
    return 'Which project should I use for this question?';
  }
  if (items.length === 1) {
    return `Should I use project ${items[0]} for this question?`;
  }

  const quoted = items.map((name) => `"${name}"`);
  const optionText = quoted.length === 2
    ? `${quoted[0]} or ${quoted[1]}`
    : `${quoted[0]}, ${quoted[1]}, or ${quoted[2]}`;
  return `Which project should I use for this question: ${optionText}?`;
}

function buildProjectRecordIndex({ snapshot = {} }) {
  const projects = asArray(snapshot.projects).map((project) => ({
    id: cleanText(project?.id, 80),
    name: cleanText(project?.name, 220),
    summary: cleanText(project?.summary || project?.description || project?.objective, 500)
  })).filter((project) => project.id || project.name);

  const protocols = asArray(snapshot.protocols);
  const notebookEntries = asArray(snapshot.notebookEntries);
  const workflows = asArray(snapshot.workflows);
  const papers = asArray(snapshot.papers);
  const assays = asArray(snapshot.assays);
  const gelAnalyses = asArray(snapshot.gelAnalyses);

  const byProjectId = {};

  const ensureProjectBucket = (projectId, projectName = '') => {
    const id = cleanText(projectId, 80);
    if (!id) {
      return null;
    }
    if (!byProjectId[id]) {
      const knownProject = projects.find((project) => project.id === id);
      byProjectId[id] = {
        project_id: id,
        project_name: cleanText(knownProject?.name || projectName, 220) || `Project ${id}`,
        project_summary: cleanText(knownProject?.summary, 500),
        notebook_entries: [],
        workflows: [],
        papers: [],
        assays: [],
        gel_analyses: [],
        protocol_ids: new Set()
      };
    }
    return byProjectId[id];
  };

  const notebookById = new Map();
  notebookEntries.forEach((entry) => {
    const projectId = cleanText(entry?.projectId, 80);
    const bucket = ensureProjectBucket(projectId, cleanText(entry?.projectName, 220));
    const normalized = {
      id: cleanText(entry?.id, 80),
      project_id: projectId,
      project_name: cleanText(entry?.projectName, 220),
      protocol_id: cleanText(entry?.protocolId, 120),
      protocol_name: cleanText(entry?.protocolName, 220),
      result: cleanText(entry?.result || entry?.body, 900),
      updated_at: normalizeIso(entry?.updatedAt || entry?.createdAt)
    };
    if (bucket && normalized.id) {
      bucket.notebook_entries.push(normalized);
      if (normalized.protocol_id) {
        bucket.protocol_ids.add(normalized.protocol_id);
      }
    }
    if (normalized.id) {
      notebookById.set(normalized.id, normalized);
    }
  });

  workflows.forEach((workflow) => {
    const directProjectId = cleanText(workflow?.projectId, 80);
    const linkedNotebookProjectIds = uniqueStrings(asArray(workflow?.notebookEntryIds)
      .map((entryId) => notebookById.get(cleanText(entryId, 80))?.project_id)
      .filter(Boolean));
    const projectId = directProjectId || linkedNotebookProjectIds[0] || '';
    const bucket = ensureProjectBucket(projectId, '');
    const blocks = asArray(workflow?.blocks);
    const stepsPreview = blocks.map((block) => {
      const protocolName = protocols.find((protocol) => cleanText(protocol?.id, 120) === cleanText(block?.protocolId, 120))?.name;
      return cleanText(block?.text || protocolName || block?.protocolId, 220);
    }).filter(Boolean).slice(0, 8);

    const normalized = {
      id: cleanText(workflow?.id, 80),
      name: cleanText(workflow?.name, 220),
      description: cleanText(workflow?.description, 500),
      project_id: projectId,
      project_name: cleanText(bucket?.project_name, 220),
      block_count: blocks.length,
      link_count: asArray(workflow?.links).length,
      steps_preview: stepsPreview,
      updated_at: normalizeIso(workflow?.updatedAt || workflow?.createdAt),
      notebook_entry_ids: uniqueStrings(workflow?.notebookEntryIds)
    };

    if (bucket && normalized.id) {
      bucket.workflows.push(normalized);
      blocks.forEach((block) => {
        const protocolId = cleanText(block?.protocolId, 120);
        if (protocolId) {
          bucket.protocol_ids.add(protocolId);
        }
      });
    }
  });

  papers.forEach((paper) => {
    if (cleanText(paper?.linkedType, 40) !== 'project') {
      return;
    }
    const projectId = cleanText(paper?.linkedId, 80);
    const bucket = ensureProjectBucket(projectId, '');
    const normalized = {
      id: cleanText(paper?.id, 80),
      title: cleanText(paper?.title, 320),
      summary: cleanText(paper?.summary, 900),
      project_id: projectId,
      project_name: cleanText(bucket?.project_name, 220),
      updated_at: normalizeIso(paper?.updatedAt || paper?.createdAt)
    };
    if (bucket && normalized.id) {
      bucket.papers.push(normalized);
    }
  });

  assays.forEach((assay) => {
    const projectId = cleanText(assay?.projectId, 80);
    const bucket = ensureProjectBucket(projectId, cleanText(assay?.project_name || assay?.projectName, 220));
    const normalized = {
      id: cleanText(assay?.id, 80),
      name: cleanText(assay?.name, 220),
      project_id: projectId,
      project_name: cleanText(bucket?.project_name, 220),
      updated_at: normalizeIso(assay?.updated_at || assay?.updatedAt)
    };
    if (bucket && normalized.id) {
      bucket.assays.push(normalized);
      const protocolId = cleanText(assay?.protocolId, 120);
      if (protocolId) {
        bucket.protocol_ids.add(protocolId);
      }
    }
  });

  gelAnalyses.forEach((analysis) => {
    const projectId = cleanText(analysis?.projectId, 80);
    const bucket = ensureProjectBucket(projectId, cleanText(analysis?.project_name || analysis?.projectName, 220));
    const normalized = {
      id: cleanText(analysis?.id, 80),
      name: cleanText(analysis?.name, 220),
      project_id: projectId,
      project_name: cleanText(bucket?.project_name, 220),
      updated_at: normalizeIso(analysis?.updated_at || analysis?.updatedAt)
    };
    if (bucket && normalized.id) {
      bucket.gel_analyses.push(normalized);
      const protocolId = cleanText(analysis?.protocolId, 120);
      if (protocolId) {
        bucket.protocol_ids.add(protocolId);
      }
    }
  });

  Object.values(byProjectId).forEach((bucket) => {
    const protocolIds = uniqueStrings([...bucket.protocol_ids]);
    bucket.protocols = protocolIds.map((protocolId) => {
      const matched = protocols.find((protocol) => cleanText(protocol?.id, 120) === protocolId) || {};
      return {
        id: protocolId,
        name: cleanText(matched?.name, 220),
        category: cleanText(matched?.category, 80),
        steps_preview: buildStepsPreview(matched?.step_entries || matched?.steps, 6)
      };
    }).filter((protocol) => protocol.id || protocol.name);
    bucket.linked_record_count = (
      bucket.notebook_entries.length
      + bucket.workflows.length
      + bucket.protocols.length
      + bucket.papers.length
      + bucket.assays.length
      + bucket.gel_analyses.length
    );
    delete bucket.protocol_ids;

    bucket.notebook_entries.sort((left, right) => parseDate(right.updated_at) - parseDate(left.updated_at));
    bucket.workflows.sort((left, right) => parseDate(right.updated_at) - parseDate(left.updated_at));
    bucket.papers.sort((left, right) => parseDate(right.updated_at) - parseDate(left.updated_at));
  });

  const mergedProjects = Object.values(byProjectId).map((bucket) => ({
    id: bucket.project_id,
    name: bucket.project_name,
    summary: bucket.project_summary,
    linked_record_count: bucket.linked_record_count
  }));

  projects.forEach((project) => {
    if (byProjectId[project.id]) {
      return;
    }
    byProjectId[project.id] = {
      project_id: project.id,
      project_name: project.name || `Project ${project.id}`,
      project_summary: project.summary,
      notebook_entries: [],
      workflows: [],
      papers: [],
      assays: [],
      gel_analyses: [],
      protocols: [],
      linked_record_count: 0
    };
    mergedProjects.push({
      id: project.id,
      name: project.name,
      summary: project.summary,
      linked_record_count: 0
    });
  });

  mergedProjects.sort((left, right) => {
    const nameDiff = cleanText(left.name, 220).localeCompare(cleanText(right.name, 220));
    if (nameDiff !== 0) {
      return nameDiff;
    }
    return cleanText(left.id, 80).localeCompare(cleanText(right.id, 80));
  });

  return {
    projects: mergedProjects,
    by_project_id: byProjectId
  };
}

function resolveProjectScope({
  message,
  entities,
  selectedProjectId,
  selectedProjectName,
  projects,
  index
}) {
  const projectRows = asArray(projects).length
    ? asArray(projects)
    : asArray(index?.projects);
  const indexByProjectId = index?.by_project_id && typeof index.by_project_id === 'object'
    ? index.by_project_id
    : {};

  const ranked = projectRows
    .map((project) => scoreProjectCandidate({
      project,
      message,
      entities,
      selectedProjectId,
      selectedProjectName,
      linkedRecordCount: Number(indexByProjectId[cleanText(project?.id, 80)]?.linked_record_count) || 0
    }))
    .filter((row) => row.project_id || row.project_name)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.exact_name_score !== left.exact_name_score) {
        return right.exact_name_score - left.exact_name_score;
      }
      return cleanText(left.project_name || left.project_id, 220)
        .localeCompare(cleanText(right.project_name || right.project_id, 220));
    });

  const top = ranked[0] || null;
  const second = ranked[1] || null;
  const topScore = Number(top?.score) || 0;
  const scoreDelta = top && second
    ? Math.max(0, Number(top.score) - Number(second.score))
    : top
      ? Number(top.score)
      : 0;

  let needsClarification = false;
  let ambiguityReason = '';
  if (!ranked.length) {
    needsClarification = true;
    ambiguityReason = 'no_project_candidates';
  } else if (topScore < PROJECT_SCOPE_SCORE_THRESHOLD) {
    needsClarification = true;
    ambiguityReason = 'top_score_below_threshold';
  } else if (ranked.length > 1 && scoreDelta < PROJECT_SCOPE_DELTA_THRESHOLD) {
    needsClarification = true;
    ambiguityReason = 'top_two_scores_too_close';
  }

  const resolutionSource = (() => {
    if (!top) {
      return '';
    }
    if (top.selected_bias_score >= 0.95) {
      return 'selected_project';
    }
    if (top.exact_name_score >= 0.9) {
      return 'entity_project';
    }
    if (top.partial_name_score >= 0.7) {
      return 'message_project';
    }
    return 'linked_record_support';
  })();

  const projectCandidates = ranked.slice(0, 3).map((row) => ({
    project_id: cleanText(row.project_id, 80),
    project_name: cleanText(row.project_name, 220),
    score: Number.isFinite(Number(row.score)) ? Number(row.score) : 0,
    exact_name_score: Number.isFinite(Number(row.exact_name_score)) ? Number(row.exact_name_score) : 0,
    partial_name_score: Number.isFinite(Number(row.partial_name_score)) ? Number(row.partial_name_score) : 0,
    selected_bias_score: Number.isFinite(Number(row.selected_bias_score)) ? Number(row.selected_bias_score) : 0,
    linked_record_support_score: Number.isFinite(Number(row.linked_record_support_score))
      ? Number(row.linked_record_support_score)
      : 0,
    reason: cleanText(row.reason, 260)
  }));

  const clarificationQuestion = needsClarification
    ? buildProjectFollowUpQuestion({ candidates: projectCandidates })
    : '';

  return {
    project_match: {
      selected_project_id: cleanText(top?.project_id, 80),
      selected_project_name: cleanText(top?.project_name, 220),
      top_score: topScore,
      score_delta: Number(scoreDelta) || 0,
      needs_clarification: needsClarification,
      ambiguity_reason: cleanText(ambiguityReason, 120),
      resolution_source: cleanText(resolutionSource, 80)
    },
    project_candidates: projectCandidates,
    needs_clarification: needsClarification,
    ambiguity_reason: cleanText(ambiguityReason, 120),
    clarification_question: cleanText(clarificationQuestion, 320)
  };
}

function rankProjectRecords({
  rows,
  messageTokens,
  entityTokens,
  workflowTokens,
  textBuilder,
  updatedAtBuilder,
  maxItems,
  now,
  sortKeyBuilder
}) {
  return asArray(rows)
    .map((row) => {
      const text = cleanText(textBuilder(row), 4000);
      const scoreParts = scoreEvidenceRecord({
        messageTokens,
        entityTokens,
        workflowTokens,
        text,
        updatedAt: updatedAtBuilder(row),
        now
      });
      return {
        ...row,
        ...scoreParts,
        _sort_key: cleanText(sortKeyBuilder(row), 220)
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const recencyDiff = (Number(right.recency_score) || 0) - (Number(left.recency_score) || 0);
      if (recencyDiff !== 0) {
        return recencyDiff;
      }
      return cleanText(left._sort_key, 220).localeCompare(cleanText(right._sort_key, 220));
    })
    .slice(0, maxItems)
    .map((row) => {
      const next = { ...row };
      delete next._sort_key;
      return next;
    });
}

function retrieveProjectEvidence({
  message,
  entities,
  selectedProjectId,
  selectedProjectName,
  snapshot,
  maxPerSource = 4,
  allowAmbiguousScope = false,
  now = new Date()
}) {
  const index = buildProjectRecordIndex({ snapshot: snapshot && typeof snapshot === 'object' ? snapshot : {} });
  const scope = resolveProjectScope({
    message,
    entities,
    selectedProjectId,
    selectedProjectName,
    projects: index.projects,
    index
  });

  const candidateProjectIds = allowAmbiguousScope && scope.needs_clarification
    ? scope.project_candidates.map((candidate) => cleanText(candidate.project_id, 80)).filter(Boolean)
    : [cleanText(scope.project_match.selected_project_id, 80)].filter(Boolean);

  if (scope.needs_clarification && !allowAmbiguousScope) {
    return {
      project_match: scope.project_match,
      project_candidates: scope.project_candidates,
      needs_clarification: true,
      ambiguity_reason: scope.ambiguity_reason,
      clarification_question: scope.clarification_question,
      selected_project: {
        id: '',
        name: '',
        resolution_source: ''
      },
      packs: {
        projects: [],
        notebook: [],
        workflows: [],
        protocols: [],
        papers: []
      },
      citations: [],
      summary_rows: [
        `Project scope requires clarification (${scope.ambiguity_reason || 'ambiguous'}).`
      ]
    };
  }

  const selectedProjectIdNormalized = cleanText(scope.project_match.selected_project_id, 80);
  const selectedBucket = index.by_project_id[selectedProjectIdNormalized] || null;
  const selectedProject = {
    id: selectedProjectIdNormalized,
    name: cleanText(scope.project_match.selected_project_name, 220),
    resolution_source: cleanText(scope.project_match.resolution_source, 80)
  };

  const selectedBuckets = uniqueStrings(candidateProjectIds)
    .map((projectId) => index.by_project_id[projectId])
    .filter(Boolean);

  const messageTokens = tokenize(message);
  const entityTokens = Object.values(entities && typeof entities === 'object' ? entities : {})
    .flatMap((value) => tokenize(value));
  const workflowTokens = tokenize(entities?.workflow_step || '');
  const maxItems = clamp(Number(maxPerSource) || 4, 1, 10);

  const projectRows = rankProjectRecords({
    rows: selectedBuckets.map((bucket) => ({
      id: cleanText(bucket.project_id, 80),
      name: cleanText(bucket.project_name, 220),
      summary: cleanText(bucket.project_summary, 500),
      linked_record_count: Number(bucket.linked_record_count) || 0,
      updated_at: ''
    })),
    messageTokens,
    entityTokens,
    workflowTokens,
    textBuilder: (row) => `${row.name} ${row.summary}`,
    updatedAtBuilder: (row) => row.updated_at,
    maxItems,
    now,
    sortKeyBuilder: (row) => row.id || row.name
  });

  const notebookRows = rankProjectRecords({
    rows: selectedBuckets.flatMap((bucket) => asArray(bucket.notebook_entries).map((entry) => ({
      id: cleanText(entry.id, 80),
      protocol_name: cleanText(entry.protocol_name, 220),
      result: cleanText(entry.result, 900),
      updated_at: cleanText(entry.updated_at, 80),
      project_name: cleanText(bucket.project_name, 220)
    }))),
    messageTokens,
    entityTokens,
    workflowTokens,
    textBuilder: (row) => `${row.protocol_name} ${row.result} ${row.project_name}`,
    updatedAtBuilder: (row) => row.updated_at,
    maxItems,
    now,
    sortKeyBuilder: (row) => row.id || row.protocol_name
  });

  const workflowRows = rankProjectRecords({
    rows: selectedBuckets.flatMap((bucket) => asArray(bucket.workflows).map((workflow) => ({
      id: cleanText(workflow.id, 80),
      name: cleanText(workflow.name, 220),
      project_name: cleanText(bucket.project_name, 220),
      description: cleanText(workflow.description, 500),
      block_count: Number(workflow.block_count) || 0,
      link_count: Number(workflow.link_count) || 0,
      steps_preview: asArray(workflow.steps_preview).map((step) => cleanText(step, 220)).filter(Boolean).slice(0, 8),
      updated_at: cleanText(workflow.updated_at, 80)
    }))),
    messageTokens,
    entityTokens,
    workflowTokens,
    textBuilder: (row) => `${row.name} ${row.description} ${row.steps_preview.join(' ')} ${row.project_name}`,
    updatedAtBuilder: (row) => row.updated_at,
    maxItems,
    now,
    sortKeyBuilder: (row) => row.id || row.name
  });

  const protocolRows = rankProjectRecords({
    rows: selectedBuckets.flatMap((bucket) => asArray(bucket.protocols).map((protocol) => ({
      id: cleanText(protocol.id, 120),
      name: cleanText(protocol.name, 220),
      category: cleanText(protocol.category, 80),
      project_name: cleanText(bucket.project_name, 220),
      steps_preview: asArray(protocol.steps_preview).map((step) => cleanText(step, 220)).filter(Boolean).slice(0, 8),
      updated_at: ''
    }))),
    messageTokens,
    entityTokens,
    workflowTokens,
    textBuilder: (row) => `${row.name} ${row.category} ${row.steps_preview.join(' ')} ${row.project_name}`,
    updatedAtBuilder: (row) => row.updated_at,
    maxItems,
    now,
    sortKeyBuilder: (row) => row.id || row.name
  });

  const paperRows = rankProjectRecords({
    rows: selectedBuckets.flatMap((bucket) => asArray(bucket.papers).map((paper) => ({
      id: cleanText(paper.id, 80),
      title: cleanText(paper.title, 320),
      summary: cleanText(paper.summary, 900),
      project_name: cleanText(bucket.project_name, 220),
      updated_at: cleanText(paper.updated_at, 80)
    }))),
    messageTokens,
    entityTokens,
    workflowTokens,
    textBuilder: (row) => `${row.title} ${row.summary} ${row.project_name}`,
    updatedAtBuilder: (row) => row.updated_at,
    maxItems,
    now,
    sortKeyBuilder: (row) => row.id || row.title
  });

  const citations = [
    ...projectRows.map((row) => ({ source: 'project', pointer: row.id || row.name, reason: 'Matched project scope and metadata.' })),
    ...notebookRows.map((row) => ({ source: 'notebook_entry', pointer: row.id || row.protocol_name, reason: 'Matched project notebook evidence.' })),
    ...workflowRows.map((row) => ({ source: 'workflow', pointer: row.id || row.name, reason: 'Matched project workflow evidence.' })),
    ...protocolRows.map((row) => ({ source: 'protocol', pointer: row.id || row.name, reason: 'Matched linked project protocol evidence.' })),
    ...paperRows.map((row) => ({ source: 'paper', pointer: row.id || row.title, reason: 'Matched linked project paper evidence.' }))
  ];

  const summaryRows = [
    `Project scope selected ${selectedProject.name || '-'} (${selectedProject.id || '-'}).`,
    `Project evidence counts projects=${projectRows.length} notebook=${notebookRows.length} workflows=${workflowRows.length} protocols=${protocolRows.length} papers=${paperRows.length}.`
  ];
  if (selectedBucket) {
    summaryRows.push(`Project linked records total=${Number(selectedBucket.linked_record_count) || 0}.`);
  }

  return {
    project_match: scope.project_match,
    project_candidates: scope.project_candidates,
    needs_clarification: false,
    ambiguity_reason: '',
    clarification_question: '',
    selected_project: selectedProject,
    packs: {
      projects: projectRows,
      notebook: notebookRows,
      workflows: workflowRows,
      protocols: protocolRows,
      papers: paperRows
    },
    citations,
    summary_rows: summaryRows
  };
}

module.exports = {
  PROJECT_SCOPE_SCORE_THRESHOLD,
  PROJECT_SCOPE_DELTA_THRESHOLD,
  buildProjectRecordIndex,
  resolveProjectScope,
  retrieveProjectEvidence,
  buildProjectFollowUpQuestion
};
