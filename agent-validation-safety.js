'use strict';

const CLAIMY_TOOL_HINT_PATTERN = /\b(found|retrieved|looked up|in stock|inventory shows|record shows|workflow shows|notebook shows|paper shows|according to)\b/i;
const PAPER_DEEP_CLAIM_PATTERN = /\bfigure|table|supplement|methods?|reagents?|section\b/i;
const NON_FACTUAL_STATEMENT_PATTERN = /\?$|^(can|could|would|should|please|let me|i need|do you|which)\b/i;
const TOOL_BACKED_INTENTS = new Set([
  'inventory_lookup',
  'record_lookup',
  'project_science_question',
  'paper_analysis',
  'coding_data_analysis',
  'protocol_to_notebook'
]);
const ALLOWED_PLACEHOLDER_SOURCES = new Set([
  'user_input',
  'conversation_context',
  'project_records',
  'project_history',
  'tool_results',
  'tool_result',
  'follow_up_answer',
  'message_entity',
  'conversation_recent',
  'by_type',
  'by_key'
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 180);
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

function tokenize(text) {
  return uniqueStrings(
    cleanText(text, 2000)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  );
}

function statementSplit(answer) {
  return cleanText(answer, 20000)
    .split(/[\n.!?]+/)
    .map((part) => cleanText(part, 360))
    .filter(Boolean)
    .slice(0, 24);
}

function overlapCount(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) {
    return 0;
  }
  const setB = new Set(tokensB);
  return tokensA.reduce((sum, token) => sum + (setB.has(token) ? 1 : 0), 0);
}

function buildSourceItems(citations, sourceSummary) {
  const out = [];
  asArray(citations).forEach((citation) => {
    out.push({
      source: cleanText(citation?.source, 120),
      pointer: cleanText(citation?.pointer, 220),
      reason: cleanText(citation?.reason, 260)
    });
  });
  asArray(sourceSummary?.groups).forEach((group) => {
    asArray(group?.items).forEach((item) => {
      out.push({
        source: cleanText(item?.source, 120) || cleanText(group?.source_type, 80),
        pointer: cleanText(item?.pointer, 220),
        reason: cleanText(item?.reason, 260)
      });
    });
  });
  const seen = new Set();
  return out.filter((item) => {
    if (!item.source && !item.pointer && !item.reason) {
      return false;
    }
    const key = `${item.source.toLowerCase()}|${item.pointer.toLowerCase()}|${item.reason.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeViolation(rawViolation) {
  const source = rawViolation && typeof rawViolation === 'object' ? rawViolation : {};
  return {
    code: cleanText(source.code, 80) || 'validation_violation',
    severity: cleanText(source.severity, 24) || 'blocking',
    message: cleanText(source.message, 300) || 'Validation violation.',
    detail: cleanText(source.detail, 400)
  };
}

function buildSourceEvidence({ answer, citations, sourceSummary } = {}) {
  const statements = statementSplit(answer);
  const sourceItems = buildSourceItems(citations, sourceSummary);
  const sourceTokenRows = sourceItems.map((item) => ({
    ...item,
    tokens: tokenize(`${item.source} ${item.pointer} ${item.reason}`)
  }));

  return statements.map((statement) => {
    const statementTokens = tokenize(statement);
    const rankedMatches = sourceTokenRows.map((row) => ({
      source: row.source,
      pointer: row.pointer,
      reason: row.reason,
      overlap: overlapCount(statementTokens, row.tokens)
    })).filter((row) => row.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || a.pointer.localeCompare(b.pointer))
      .slice(0, 3);

    const topOverlap = rankedMatches[0]?.overlap || 0;
    const supportLevel = topOverlap >= 2
      ? 'direct'
      : (topOverlap >= 1 ? 'indirect' : 'none');
    return {
      statement: cleanText(statement, 360),
      support_level: supportLevel,
      supports: rankedMatches.map((row) => ({
        source: cleanText(row.source, 120),
        pointer: cleanText(row.pointer, 220),
        overlap: row.overlap
      }))
    };
  });
}

function validateToolClaimIntegrity({ routing, toolTrace, citations, answer } = {}) {
  const normalizedRouting = routing && typeof routing === 'object' ? routing : {};
  const intent = cleanText(normalizedRouting.intent, 80);
  const plan = normalizedRouting.plan && typeof normalizedRouting.plan === 'object' ? normalizedRouting.plan : {};
  const toolBacked = plan.needs_tools === true || TOOL_BACKED_INTENTS.has(intent);
  const hasToolEvidence = asArray(toolTrace).length > 0 || asArray(citations).length > 0;
  const answerText = cleanText(answer, 8000);
  const impliesRetrievedFacts = CLAIMY_TOOL_HINT_PATTERN.test(answerText);
  const violations = [];

  if (toolBacked && impliesRetrievedFacts && !hasToolEvidence) {
    violations.push({
      code: 'tool_claim_without_tool_evidence',
      severity: 'blocking',
      message: 'Answer implies tool-backed facts but no tool output/citations were captured.',
      detail: `intent=${intent || 'unknown'}`
    });
  }

  return {
    passed: violations.length === 0,
    violations: violations.map((item) => normalizeViolation(item))
  };
}

function validateProtocolClaimIntegrity({ routing, answer } = {}) {
  const normalizedRouting = routing && typeof routing === 'object' ? routing : {};
  const plan = normalizedRouting.plan && typeof normalizedRouting.plan === 'object' ? normalizedRouting.plan : {};
  const protocolMatch = plan.protocol_match && typeof plan.protocol_match === 'object'
    ? plan.protocol_match
    : {};
  const selectedProtocolName = cleanText(protocolMatch.selected_protocol_name, 220);
  const selectedProtocolId = cleanText(protocolMatch.selected_protocol_id, 80);
  const answerText = cleanText(answer, 8000);
  const violations = [];

  if (cleanText(normalizedRouting.intent, 80) !== 'protocol_to_notebook') {
    return { passed: true, violations: [] };
  }

  if (!selectedProtocolName && !selectedProtocolId) {
    violations.push({
      code: 'no_protocol_candidates',
      severity: 'blocking',
      message: 'Protocol-to-notebook response is missing a selected protocol.',
      detail: 'routing.plan.protocol_match has no selected protocol'
    });
  }

  const otherCandidateMatch = asArray(plan.protocol_candidates).find((candidate) => {
    const candidateName = cleanText(candidate?.protocol_name, 220);
    return candidateName
      && selectedProtocolName
      && candidateName.toLowerCase() !== selectedProtocolName.toLowerCase()
      && answerText.toLowerCase().includes(candidateName.toLowerCase());
  });
  if (otherCandidateMatch) {
    violations.push({
      code: 'protocol_claim_mismatch',
      severity: 'blocking',
      message: 'Answer references a protocol candidate different from the selected protocol.',
      detail: `selected=${selectedProtocolName || selectedProtocolId}; referenced=${cleanText(otherCandidateMatch.protocol_name, 220)}`
    });
  }

  return {
    passed: violations.length === 0,
    violations: violations.map((item) => normalizeViolation(item))
  };
}

function validateNotebookPlaceholderSupport({ notebookDraft, toolTrace } = {}) {
  const draft = notebookDraft && typeof notebookDraft === 'object' ? notebookDraft : null;
  if (!draft) {
    return { passed: true, violations: [] };
  }
  const violations = [];
  const traceRows = asArray(toolTrace);

  asArray(draft.placeholder_values).forEach((placeholder, index) => {
    const source = cleanText(placeholder?.source, 80).toLowerCase();
    const value = cleanText(placeholder?.value, 260);
    const key = cleanText(placeholder?.placeholder_key || placeholder?.placeholder_id, 120) || `placeholder_${index + 1}`;
    if (!value) {
      violations.push({
        code: 'unsupported_placeholder_fill',
        severity: 'blocking',
        message: `Placeholder "${key}" was marked filled but has empty value.`,
        detail: `source=${source || 'unknown'}`
      });
      return;
    }
    if (source && !ALLOWED_PLACEHOLDER_SOURCES.has(source)) {
      violations.push({
        code: 'unsupported_placeholder_fill',
        severity: 'blocking',
        message: `Placeholder "${key}" uses unsupported fill source.`,
        detail: `source=${source}`
      });
      return;
    }
    if (source.includes('tool') && !traceRows.length) {
      violations.push({
        code: 'unsupported_placeholder_fill',
        severity: 'blocking',
        message: `Placeholder "${key}" claims tool support but tool trace is empty.`,
        detail: 'tool_trace_missing'
      });
    }
  });

  return {
    passed: violations.length === 0,
    violations: violations.map((item) => normalizeViolation(item))
  };
}

function validatePaperDetailClaims({ routing, answer } = {}) {
  const normalizedRouting = routing && typeof routing === 'object' ? routing : {};
  if (cleanText(normalizedRouting.intent, 80) !== 'paper_analysis') {
    return { passed: true, violations: [] };
  }
  const plan = normalizedRouting.plan && typeof normalizedRouting.plan === 'object' ? normalizedRouting.plan : {};
  const paperMatch = plan.paper_match && typeof plan.paper_match === 'object' ? plan.paper_match : {};
  const answerText = cleanText(answer, 8000);
  const violations = [];

  if (
    plan.needs_deep_paper_reading === true
    && paperMatch.deep_read_ready !== true
    && PAPER_DEEP_CLAIM_PATTERN.test(answerText)
  ) {
    violations.push({
      code: 'pdf_missing',
      severity: 'blocking',
      message: 'Answer contains deep paper claims but selected paper is not deep-read ready.',
      detail: `availability=${cleanText(paperMatch.availability_status, 80) || 'unknown'}`
    });
  }

  if (
    plan.needs_paper_comparison === true
    && (
      !cleanText(paperMatch.secondary_paper_id, 80)
      || paperMatch.secondary_deep_read_ready !== true
    )
    && /\bcompare|versus|vs\.?|both papers\b/i.test(answerText)
  ) {
    violations.push({
      code: 'pdf_missing',
      severity: 'blocking',
      message: 'Comparison answer requires two deep-ready papers but one is missing or unavailable.',
      detail: `secondary_ready=${paperMatch.secondary_deep_read_ready === true}`
    });
  }

  return {
    passed: violations.length === 0,
    violations: violations.map((item) => normalizeViolation(item))
  };
}

function evaluateMaterialAmbiguity({ routing, confidenceLabel, sourceEvidence } = {}) {
  const normalizedRouting = routing && typeof routing === 'object' ? routing : {};
  const plan = normalizedRouting.plan && typeof normalizedRouting.plan === 'object' ? normalizedRouting.plan : {};
  if (plan.needs_clarification === true) {
    return {
      needs_clarification: true,
      reason: cleanText(plan.clarification_reason, 260) || 'routing_requires_clarification',
      clarification_question: cleanText(plan.clarification_question, 320)
    };
  }

  if (
    plan.protocol_match?.needs_clarification === true
    || plan.project_match?.needs_clarification === true
    || plan.paper_match?.needs_clarification === true
  ) {
    return {
      needs_clarification: true,
      reason: cleanText(
        plan.protocol_match?.ambiguity_reason
        || plan.project_match?.ambiguity_reason
        || plan.paper_match?.ambiguity_reason,
        260
      ) || 'multiple_close_matches',
      clarification_question: cleanText(plan.clarification_question, 320)
    };
  }

  const directCount = asArray(sourceEvidence).filter((row) => row?.support_level === 'direct').length;
  if (cleanText(confidenceLabel, 20) === 'low' && directCount === 0) {
    return {
      needs_clarification: true,
      reason: 'low_confidence_no_direct_support',
      clarification_question: cleanText(plan.clarification_question, 320)
    };
  }

  return {
    needs_clarification: false,
    reason: '',
    clarification_question: ''
  };
}

function buildClarificationFromViolation(firstViolation, routing, ambiguity) {
  const plan = routing?.plan && typeof routing.plan === 'object' ? routing.plan : {};
  const violationCode = cleanText(firstViolation?.code, 80);
  if (violationCode === 'tool_claim_without_tool_evidence') {
    return 'I need at least one retrieved source before confirming those tool-backed claims. Which record or source should I check first?';
  }
  if (violationCode === 'no_protocol_candidates' || violationCode === 'protocol_claim_mismatch') {
    return cleanText(plan.clarification_question, 320)
      || 'Which protocol should I use for this notebook entry?';
  }
  if (violationCode === 'unsupported_placeholder_fill') {
    return 'Some placeholders are not supported by reliable evidence yet. Please provide the missing values so I can finalize the draft.';
  }
  if (violationCode === 'pdf_missing') {
    return 'I need an uploaded, deep-read-ready PDF before I can confirm figure or method-level details. Please upload the paper PDF and retry.';
  }
  if (ambiguity?.needs_clarification) {
    return cleanText(ambiguity.clarification_question, 320)
      || cleanText(plan.clarification_question, 320)
      || 'Could you clarify the request so I can continue safely?';
  }
  return cleanText(plan.clarification_question, 320)
    || 'Could you clarify the missing details so I can provide a reliable answer?';
}

function isLikelyFactualStatement(statement) {
  const text = cleanText(statement, 360);
  if (!text) {
    return false;
  }
  if (NON_FACTUAL_STATEMENT_PATTERN.test(text.toLowerCase())) {
    return false;
  }
  return text.length >= 14;
}

function validateAndGateResponse({
  routing,
  normalized,
  notebookDraft,
  toolTrace,
  citations
} = {}) {
  const response = normalized && typeof normalized === 'object' ? normalized : {};
  const answer = cleanText(response.answer, 12000);
  const sourceSummary = response.source_summary && typeof response.source_summary === 'object'
    ? response.source_summary
    : {};
  const sourceEvidence = buildSourceEvidence({
    answer,
    citations,
    sourceSummary
  });
  const unsupportedStatements = sourceEvidence.filter((row) => row.support_level === 'none' && isLikelyFactualStatement(row.statement));
  const unsupportedStatementCount = unsupportedStatements.length;
  const confidenceLabel = cleanText(response.confidence_label, 20);
  const normalizedRouting = routing && typeof routing === 'object' ? routing : {};
  const plan = normalizedRouting.plan && typeof normalizedRouting.plan === 'object' ? normalizedRouting.plan : {};

  const validations = [
    validateToolClaimIntegrity({ routing: normalizedRouting, toolTrace, citations, answer }),
    validateProtocolClaimIntegrity({ routing: normalizedRouting, answer }),
    validateNotebookPlaceholderSupport({ notebookDraft, toolTrace }),
    validatePaperDetailClaims({ routing: normalizedRouting, answer })
  ];
  const violations = validations.flatMap((result) => asArray(result?.violations));

  if (
    plan.needs_tools === true
    && unsupportedStatementCount > 0
    && cleanText(response.response_type, 80) !== 'clarification_question'
  ) {
    violations.push(normalizeViolation({
      code: 'unsupported_factual_statement',
      severity: 'blocking',
      message: 'One or more factual statements are not supported by retrieved evidence.',
      detail: `unsupported_statement_count=${unsupportedStatementCount}`
    }));
  }

  const ambiguity = evaluateMaterialAmbiguity({
    routing: normalizedRouting,
    confidenceLabel,
    sourceEvidence
  });
  if (ambiguity.needs_clarification) {
    violations.push(normalizeViolation({
      code: cleanText(ambiguity.reason, 80) || 'multiple_close_matches',
      severity: 'blocking',
      message: 'Material ambiguity remains after synthesis.',
      detail: cleanText(ambiguity.reason, 260)
    }));
  }

  const normalizedViolations = violations.map((item) => normalizeViolation(item));
  const blockingViolations = normalizedViolations.filter((item) => item.severity === 'blocking');
  const forcedClarification = blockingViolations.length > 0;
  const failureReasons = uniqueStrings(normalizedViolations.map((item) => item.code));
  const clarificationAnswer = forcedClarification
    ? buildClarificationFromViolation(blockingViolations[0], normalizedRouting, ambiguity)
    : '';
  const clarificationReason = cleanText(blockingViolations[0]?.message, 260)
    || cleanText(ambiguity.reason, 260);

  return {
    validation: {
      passed: !forcedClarification,
      forced_clarification: forcedClarification,
      violations: normalizedViolations,
      failure_reasons: failureReasons
    },
    provenance: {
      source_evidence: sourceEvidence,
      unsupported_statement_count: unsupportedStatementCount
    },
    clarification: {
      should_clarify: forcedClarification,
      answer: clarificationAnswer,
      reason: clarificationReason,
      question: cleanText(ambiguity.clarification_question, 320) || clarificationAnswer
    }
  };
}

module.exports = {
  buildSourceEvidence,
  validateToolClaimIntegrity,
  validateProtocolClaimIntegrity,
  validateNotebookPlaceholderSupport,
  validatePaperDetailClaims,
  evaluateMaterialAmbiguity,
  validateAndGateResponse
};
