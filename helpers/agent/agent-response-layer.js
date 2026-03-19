'use strict';

const RESPONSE_TYPES = Object.freeze({
  CLARIFICATION_QUESTION: 'clarification_question',
  FACTUAL_ANSWER: 'factual_answer',
  NOTEBOOK_DRAFT: 'notebook_draft',
  PROJECT_SCIENCE_ANSWER: 'project_science_answer',
  PAPER_SUMMARY: 'paper_summary',
  ANALYSIS_RESULT: 'analysis_result'
});

const CONFIDENCE_LABELS = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
});

const SOURCE_TYPE_ORDER = Object.freeze([
  'tool_result',
  'notebook_page',
  'workflow_record',
  'uploaded_paper',
  'web_search',
  'inference'
]);

const SOURCE_TYPE_LABELS = Object.freeze({
  tool_result: 'Tool result',
  notebook_page: 'Notebook page',
  workflow_record: 'Workflow record',
  uploaded_paper: 'Uploaded paper',
  web_search: 'Web search',
  inference: 'Inference'
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function cleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function mapCitationSourceType(sourceValue = '') {
  const normalized = cleanText(sourceValue, 120).toLowerCase();
  if (!normalized) {
    return 'tool_result';
  }
  if (normalized.includes('notebook')) {
    return 'notebook_page';
  }
  if (normalized.includes('workflow')) {
    return 'workflow_record';
  }
  if (normalized.includes('paper')) {
    return 'uploaded_paper';
  }
  if (normalized.includes('web')) {
    return 'web_search';
  }
  if (normalized.includes('inference') || normalized.includes('assumption')) {
    return 'inference';
  }
  return 'tool_result';
}

function mapToolToSourceType(toolName = '') {
  const normalized = cleanText(toolName, 120).toLowerCase();
  if (!normalized) {
    return 'tool_result';
  }
  if (normalized === 'search_notebook_entries') {
    return 'notebook_page';
  }
  if (normalized === 'search_workflows') {
    return 'workflow_record';
  }
  if (normalized === 'search_papers' || normalized === 'download_paper_pdf') {
    return 'uploaded_paper';
  }
  if (normalized === 'search_web' || normalized === 'hybrid_web_fallback') {
    return 'web_search';
  }
  if (normalized === 'project_evidence_aggregator' || normalized === 'paper_evidence_aggregator') {
    return 'inference';
  }
  return 'tool_result';
}

function determineResponseType({
  routing,
  notebookDraft,
  toolTrace,
  citations
} = {}) {
  const normalizedRouting = routing && typeof routing === 'object' ? routing : {};
  const plan = normalizedRouting.plan && typeof normalizedRouting.plan === 'object' ? normalizedRouting.plan : {};
  const intent = cleanText(normalizedRouting.intent, 80);
  const trace = asArray(toolTrace);
  const citationRows = asArray(citations);

  if (plan.needs_clarification === true) {
    return RESPONSE_TYPES.CLARIFICATION_QUESTION;
  }
  if (notebookDraft && typeof notebookDraft === 'object') {
    return RESPONSE_TYPES.NOTEBOOK_DRAFT;
  }
  if (intent === 'project_science_question') {
    return RESPONSE_TYPES.PROJECT_SCIENCE_ANSWER;
  }
  if (intent === 'paper_analysis') {
    return RESPONSE_TYPES.PAPER_SUMMARY;
  }
  if (
    intent === 'coding_data_analysis'
    || plan.needs_python === true
    || trace.some((item) => cleanText(item?.tool, 120) === 'run_python_sandbox')
    || citationRows.some((item) => cleanText(item?.source, 120).toLowerCase().includes('python'))
  ) {
    return RESPONSE_TYPES.ANALYSIS_RESULT;
  }
  return RESPONSE_TYPES.FACTUAL_ANSWER;
}

function buildSourceSummary({
  citations,
  toolTrace
} = {}) {
  const buckets = new Map();
  SOURCE_TYPE_ORDER.forEach((type) => {
    buckets.set(type, []);
  });
  const seen = new Set();

  asArray(citations).forEach((citation) => {
    const source = cleanText(citation?.source, 120);
    const pointer = cleanText(citation?.pointer, 220);
    const reason = cleanText(citation?.reason, 260);
    if (!source && !pointer) {
      return;
    }
    const sourceType = mapCitationSourceType(source);
    const dedupeKey = `${sourceType}|${source.toLowerCase()}|${pointer.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    buckets.get(sourceType).push({
      source_type: sourceType,
      source,
      pointer,
      reason
    });
  });

  asArray(toolTrace).forEach((row) => {
    const tool = cleanText(row?.tool, 120);
    if (!tool) {
      return;
    }
    const sourceType = mapToolToSourceType(tool);
    const reason = cleanText(row?.summary, 260);
    const dedupeKey = `${sourceType}|tool|${tool.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    buckets.get(sourceType).push({
      source_type: sourceType,
      source: 'tool_trace',
      pointer: tool,
      reason
    });
  });

  const groups = SOURCE_TYPE_ORDER.map((sourceType) => {
    const items = buckets.get(sourceType) || [];
    return {
      source_type: sourceType,
      label: SOURCE_TYPE_LABELS[sourceType] || sourceType,
      count: items.length,
      items
    };
  }).filter((group) => group.count > 0);

  return {
    total_sources: groups.reduce((sum, group) => sum + group.count, 0),
    groups
  };
}

function labelConfidence({ score } = {}) {
  const numericScore = Number.isFinite(Number(score))
    ? clamp(Number(score), 0, 1)
    : 0;
  if (numericScore >= 0.8) {
    return CONFIDENCE_LABELS.HIGH;
  }
  if (numericScore >= 0.6) {
    return CONFIDENCE_LABELS.MEDIUM;
  }
  return CONFIDENCE_LABELS.LOW;
}

function buildUnresolvedFields({ responseType, notebookDraft } = {}) {
  if (cleanText(responseType, 80) !== RESPONSE_TYPES.NOTEBOOK_DRAFT) {
    return [];
  }
  const draft = notebookDraft && typeof notebookDraft === 'object' ? notebookDraft : {};
  return asArray(draft.unresolved_placeholders).map((row) => ({
    step_id: cleanText(row?.step_id, 120),
    placeholder_id: cleanText(row?.placeholder_id, 120),
    placeholder_key: cleanText(row?.placeholder_key, 120),
    display: cleanText(row?.display, 120),
    reason: cleanText(row?.reason, 180) || 'missing_supported_value'
  })).filter((row) => row.placeholder_id || row.placeholder_key || row.display);
}

function buildSourcesBlock(sourceSummary) {
  const groups = asArray(sourceSummary?.groups);
  if (!groups.length) {
    return '';
  }
  const lines = ['Sources used:'];
  groups.forEach((group) => {
    const items = asArray(group?.items);
    if (!items.length) {
      return;
    }
    const pointers = [];
    const seen = new Set();
    items.forEach((item) => {
      const value = cleanText(item?.pointer || item?.source, 180);
      if (!value) {
        return;
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      pointers.push(value);
    });
    if (!pointers.length) {
      return;
    }
    const preview = pointers.slice(0, 4);
    const overflow = pointers.length - preview.length;
    lines.push(`- ${cleanText(group?.label, 80)}: ${preview.join('; ')}${overflow > 0 ? ` (+${overflow} more)` : ''}`);
  });
  return lines.length > 1 ? lines.join('\n') : '';
}

function buildUnresolvedBlock(unresolvedFields) {
  const items = asArray(unresolvedFields);
  if (!items.length) {
    return '';
  }
  const lines = ['Unresolved placeholders:'];
  items.slice(0, 8).forEach((item) => {
    const label = cleanText(item?.display || item?.placeholder_key || item?.placeholder_id, 120) || 'placeholder';
    const reason = cleanText(item?.reason, 160) || 'missing_supported_value';
    lines.push(`- ${label}: ${reason}`);
  });
  if (items.length > 8) {
    lines.push(`- +${items.length - 8} more`);
  }
  return lines.join('\n');
}

function applyResponseTemplate({
  answer,
  responseType,
  sourceSummary,
  unresolvedFields
} = {}) {
  const baseAnswer = cleanText(answer, 12000) || 'No answer generated.';
  if (cleanText(responseType, 80) === RESPONSE_TYPES.CLARIFICATION_QUESTION) {
    return baseAnswer;
  }

  const parts = [baseAnswer];
  const sourcesBlock = buildSourcesBlock(sourceSummary);
  if (sourcesBlock) {
    parts.push(sourcesBlock);
  }
  if (cleanText(responseType, 80) === RESPONSE_TYPES.NOTEBOOK_DRAFT) {
    const unresolvedBlock = buildUnresolvedBlock(unresolvedFields);
    if (unresolvedBlock) {
      parts.push(unresolvedBlock);
    }
  }
  return parts.join('\n\n');
}

function finalizeAgentResponse({
  answer,
  confidence,
  routing,
  notebookDraft,
  toolTrace,
  citations
} = {}) {
  const responseType = determineResponseType({
    routing,
    notebookDraft,
    toolTrace,
    citations
  });
  const sourceSummary = buildSourceSummary({ citations, toolTrace });
  const unresolvedFields = buildUnresolvedFields({ responseType, notebookDraft });
  const responseAnswer = applyResponseTemplate({
    answer,
    responseType,
    sourceSummary,
    unresolvedFields
  });
  return {
    answer: responseAnswer,
    response_type: responseType,
    confidence_label: labelConfidence({ score: confidence }),
    source_summary: sourceSummary,
    unresolved_fields: unresolvedFields
  };
}

module.exports = {
  RESPONSE_TYPES,
  determineResponseType,
  buildSourceSummary,
  labelConfidence,
  buildUnresolvedFields,
  applyResponseTemplate,
  finalizeAgentResponse
};
