'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../shared/agent-llm-utils.js');

const SCIENCE_FINAL_SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'confidence', 'decision_record', 'follow_up_questions', 'trace_sentence'],
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    decision_record: {
      type: 'object',
      additionalProperties: false,
      required: ['assumptions', 'open_questions', 'verification_notes'],
      properties: {
        assumptions: { type: 'array', items: { type: 'string' } },
        open_questions: { type: 'array', items: { type: 'string' } },
        verification_notes: { type: 'array', items: { type: 'string' } }
      }
    },
    follow_up_questions: {
      type: 'array',
      items: { type: 'string' }
    },
    trace_sentence: { type: 'string' }
  }
};

function createScienceFinalSynthesisRuntime(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    requestAssistantText
  } = createAgentLlmRuntimeHelpers(deps);
  const clamp = typeof deps.clamp === 'function'
    ? deps.clamp
    : ((value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min)));
  const synthesizeScienceFinalOverride = typeof deps.synthesizeScienceFinal === 'function'
    ? deps.synthesizeScienceFinal
    : null;

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

  function buildCompactList(title, values, max = 4) {
    const rows = uniqueStrings(asArray(values), max)
      .map((item) => cleanText(item, 260))
      .filter(Boolean);
    if (!rows.length) {
      return '';
    }
    return `${title}:\n${rows.map((item) => `- ${item}`).join('\n')}`;
  }

  function buildPolicySection(policy = {}) {
    const source = policy && typeof policy === 'object' ? policy : {};
    return [
      'Science policy:',
      cleanText(source.description, 320) ? `Description: ${cleanText(source.description, 320)}` : '',
      cleanText(source.retrieval_priority, 120) ? `Retrieval priority: ${cleanText(source.retrieval_priority, 120)}` : '',
      source.require_external_citation_when_recent === true ? 'Require external citation when freshness matters: yes' : '',
      source.require_retrieval_attempt === true ? 'Require retrieval attempt before final answer: yes' : '',
      source.answer_with_limitations_after_attempt === true ? 'Allow limitation-qualified answer after evidence attempt: yes' : ''
    ].filter(Boolean).join('\n');
  }

  function buildProjectSection(project = null) {
    const source = project && typeof project === 'object' ? project : null;
    if (!source) {
      return '';
    }
    const projectName = cleanText(source.name, 220);
    const projectId = cleanText(source.id, 120);
    const resolutionSource = cleanText(source.resolution_source, 120);
    return [
      'Project context:',
      projectName ? `Name: ${projectName}` : '',
      projectId ? `ID: ${projectId}` : '',
      resolutionSource ? `Resolution source: ${resolutionSource}` : ''
    ].filter(Boolean).join('\n');
  }

  function buildEvaluatorSection(evaluator = {}) {
    const source = evaluator && typeof evaluator === 'object' ? evaluator : {};
    const nextToolHint = source.next_tool_hint && typeof source.next_tool_hint === 'object'
      ? source.next_tool_hint
      : null;
    return [
      'Evaluator summary:',
      typeof source.satisfied === 'boolean' ? `Satisfied: ${source.satisfied ? 'yes' : 'no'}` : '',
      typeof source.should_continue === 'boolean' ? `Should continue: ${source.should_continue ? 'yes' : 'no'}` : '',
      typeof source.can_answer_with_limitations === 'boolean'
        ? `Can answer with limitations: ${source.can_answer_with_limitations ? 'yes' : 'no'}`
        : '',
      cleanText(source.reason, 320) ? `Reason: ${cleanText(source.reason, 320)}` : '',
      buildCompactList('Missing requirements', source.missing_requirements, 4),
      nextToolHint && cleanText(nextToolHint.tool_name, 120)
        ? `Next tool hint: ${cleanText(nextToolHint.tool_name, 120)}`
        : '',
      nextToolHint && cleanText(nextToolHint.reason, 220)
        ? `Next tool reason: ${cleanText(nextToolHint.reason, 220)}`
        : ''
    ].filter(Boolean).join('\n');
  }

  function buildCitationSection(citations = []) {
    const rows = normalizeCitations(citations, 4)
      .map((citation) => {
        const source = cleanText(citation.source, 120);
        const pointer = cleanText(citation.pointer, 220);
        const reason = cleanText(citation.reason, 220);
        const head = [source, pointer].filter(Boolean).join(': ');
        return reason ? `${head} - ${reason}` : head;
      })
      .filter(Boolean);
    if (!rows.length) {
      return '';
    }
    return `Citations:\n${rows.map((item) => `- ${item}`).join('\n')}`;
  }

  function buildToolTraceSection(toolTrace = []) {
    const rows = asArray(toolTrace)
      .slice(-3)
      .map((row) => {
        const toolName = cleanText(row?.tool_name, 120) || 'unknown-tool';
        const status = row?.ok === false ? 'failed' : 'ok';
        const summary = cleanText(
          row?.summary
            || row?.result?.summary
            || row?.assistant_after_tool
            || row?.error
            || row?.result?.error,
          220
        );
        return summary
          ? `- ${toolName} (${status}) | summary: ${summary}`
          : `- ${toolName} (${status})`;
      })
      .filter(Boolean);
    if (!rows.length) {
      return '';
    }
    return `Recent tool outputs:\n${rows.join('\n')}`;
  }

  function buildLoadedContextSection(toolTrace = []) {
    const rows = uniqueStrings(
      asArray(toolTrace)
        .slice(-3)
        .flatMap((row) => asArray(row?.loaded_context_blocks))
        .map((block) => {
          const paperTitle = cleanText(block?.paper_title, 160);
          const sectionLabel = cleanText(block?.section_label, 80);
          const excerpt = cleanText(block?.excerpt, 220);
          const reason = cleanText(block?.relevance_reason, 180);
          return [[paperTitle, sectionLabel].filter(Boolean).join(' | '), excerpt, reason].filter(Boolean).join(' - ');
        }),
      6
    );
    if (!rows.length) {
      return '';
    }
    return `Loaded evidence excerpts:\n${rows.map((item) => `- ${item}`).join('\n')}`;
  }

  function buildSynthesisPrompt({
    intent,
    policy,
    originalMessage,
    parserPayload,
    message,
    clarification,
    project,
    roundsExecuted,
    maxRounds,
    evaluator,
    accumulatedCitations,
    toolTrace,
    partial
  }) {
    const executionRequest = cleanText(message || originalMessage, 3200);
    return [
      'You are the final answer synthesizer for a science reasoning loop.',
      'Answer using only the evidence and tool trace provided by the app.',
      'Do not invent evidence, papers, values, or project facts.',
      'Markdown is allowed in the final answer. Use sections, bullets, or tables when they improve clarity, but do not include HTML.',
      'Respond with the final answer text only. Do not wrap the answer in JSON.',
      partial
        ? 'The loop stopped before full satisfaction. Produce the best available answer and explicitly name the remaining gaps.'
        : 'The evaluator judged the evidence sufficient. Produce a grounded answer that explains the conclusion, supporting evidence, and any material caveats.',
      `Clarified request:\n${executionRequest}`,
      cleanText(intent, 80) ? `Intent: ${cleanText(intent, 80)}` : '',
      buildPolicySection(policy),
      buildProjectSection(project),
      `Rounds executed: ${Number(roundsExecuted) || 0}/${Number(maxRounds) || 0}`,
      buildEvaluatorSection(evaluator),
      buildCitationSection(accumulatedCitations),
      buildLoadedContextSection(toolTrace),
      buildToolTraceSection(toolTrace)
    ].filter(Boolean).join('\n\n');
  }

  function buildDerivedConfidence(payload = {}) {
    const citationCount = normalizeCitations(payload.accumulatedCitations, 20).length;
    const successfulToolCount = asArray(payload.toolTrace).filter((row) => row?.ok === true).length;
    let confidence = payload.partial === true ? 0.44 : 0.6;
    if (citationCount >= 1) {
      confidence += 0.08;
    }
    if (citationCount >= 3) {
      confidence += 0.04;
    }
    if (successfulToolCount >= 2) {
      confidence += 0.03;
    }
    if (payload.partial !== true && payload.evaluator?.satisfied === true) {
      confidence += 0.03;
    }
    if (payload.partial === true && payload.evaluator?.can_answer_with_limitations === true) {
      confidence += 0.02;
    }
    return clamp(confidence, 0.3, 0.86);
  }

  function buildDerivedDecisionRecord(payload = {}) {
    const evaluator = payload.evaluator && typeof payload.evaluator === 'object' ? payload.evaluator : {};
    const citations = normalizeCitations(payload.accumulatedCitations, 4);
    const recentToolNotes = asArray(payload.toolTrace)
      .slice(-3)
      .map((row) => {
        const toolName = cleanText(row?.tool_name, 120) || 'tool';
        const summary = cleanText(
          row?.summary
            || row?.result?.summary
            || row?.assistant_after_tool
            || row?.error
            || row?.result?.error,
          220
        );
        return summary ? `${toolName}: ${summary}` : '';
      })
      .filter(Boolean);
    return {
      assumptions: uniqueStrings([
        payload.partial === true
          ? 'The answer is best-effort because the loop stopped before full evidence sufficiency.'
          : 'The evaluator judged the collected evidence sufficient for a grounded answer.',
        citations.length
          ? `The answer is grounded in ${citations.length} citation-backed evidence item(s).`
          : 'The answer relies on the available tool trace because no citation-backed evidence was collected.'
      ], 10),
      open_questions: uniqueStrings(asArray(evaluator.missing_requirements), 10),
      verification_notes: uniqueStrings([
        cleanText(evaluator.reason, 260),
        ...recentToolNotes
      ], 12)
    };
  }

  function buildDerivedFollowUpQuestions(payload = {}) {
    if (payload.partial !== true) {
      return [];
    }
    return uniqueStrings(asArray(payload.evaluator?.missing_requirements).map((item) => {
      const clean = cleanText(item, 220);
      return clean ? `What additional evidence would resolve this gap: ${clean}` : '';
    }), 6);
  }

  function normalizeSynthesisPayload(rawPayload, payload = {}) {
    const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const derivedDecisionRecord = buildDerivedDecisionRecord(payload);
    return {
      answer: cleanText(typeof rawPayload === 'string' ? rawPayload : source.answer, 12000)
        || cleanText(payload.fallbackAnswer, 12000)
        || 'I could not complete a grounded final synthesis from the available evidence.',
      confidence: Number.isFinite(Number(source.confidence))
        ? clamp(Number(source.confidence), 0, 1)
        : buildDerivedConfidence(payload),
      decision_record: normalizeDecisionRecord(source.decision_record, derivedDecisionRecord),
      follow_up_questions: uniqueStrings([
        ...asArray(source.follow_up_questions),
        ...buildDerivedFollowUpQuestions(payload)
      ], 6),
      trace_sentence: cleanText(source.trace_sentence, 240)
        || (payload.partial === true
          ? 'I am synthesizing the best grounded answer I can while naming the remaining gaps.'
          : 'I am synthesizing the final grounded answer from the evidence collected so far.')
    };
  }

  async function synthesizeFinal(payload = {}) {
    if (synthesizeScienceFinalOverride) {
      return normalizeSynthesisPayload(await synthesizeScienceFinalOverride(payload), payload);
    }
    const llmResult = await requestAssistantText({
      source: payload,
      stage: 'science_reasoning_final_synthesis',
      systemPrompt: 'Write a grounded final science answer using only the supplied evidence. Respond as assistant text only.',
      userPrompt: buildSynthesisPrompt(payload),
      traceContext: payload.traceContext || null,
      defaultError: 'Science reasoning synthesis is not configured.'
    });
    if (!llmResult?.ok || !llmResult.text) {
      return normalizeSynthesisPayload(null, payload);
    }
    return normalizeSynthesisPayload(llmResult.text, payload);
  }

  return {
    SCIENCE_FINAL_SYNTHESIS_SCHEMA,
    buildSynthesisPrompt,
    synthesizeFinal
  };
}

module.exports = {
  SCIENCE_FINAL_SYNTHESIS_SCHEMA,
  createScienceFinalSynthesisRuntime
};
