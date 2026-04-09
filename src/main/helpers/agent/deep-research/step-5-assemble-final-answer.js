'use strict';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, _maxLength = 2000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text;
}

function uniqueStrings(values, max = 20) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 240);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key) || out.length >= max) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

const OUTLINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sections'],
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'objective'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          objective: { type: 'string' }
        }
      }
    }
  }
};

const SECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['section_text'],
  properties: {
    section_text: { type: 'string' }
  }
};

function buildOutlinePrompt(input = {}) {
  return [
    'Create the outline for Step 5 of deep research final synthesis.',
    'Use the research plan and completion state to choose concise report sections.',
    `Intent: ${cleanText(input.intent, 80) || 'unknown'}`,
    `Research objective JSON:\n${JSON.stringify(input.researchObjective || {}, null, 2)}`,
    `Research plan JSON:\n${JSON.stringify(input.researchPlan || {}, null, 2)}`,
    `Completion check JSON:\n${JSON.stringify(input.completionCheck || null, null, 2)}`,
    'Return JSON only.'
  ].filter(Boolean).join('\n\n');
}

function normalizeOutline(rawPayload, fallback = {}) {
  const source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const fallbackSections = asArray(fallback.sections);
  const sections = asArray(source.sections).map((section, index) => ({
    id: cleanText(section?.id, 120) || cleanText(fallbackSections[index]?.id, 120) || `section_${index + 1}`,
    title: cleanText(section?.title, 160) || cleanText(fallbackSections[index]?.title, 160) || `Section ${index + 1}`,
    objective: cleanText(section?.objective, 320) || cleanText(fallbackSections[index]?.objective, 320) || 'Summarize this part of the answer.'
  })).filter((section) => section.id && section.title);
  return {
    sections: sections.length ? sections : fallbackSections
  };
}

function buildSectionPrompt(input = {}) {
  return [
    'Write one section of the deep research final answer.',
    'Use only the provided evidence. Preserve uncertainty and avoid inventing sources.',
    'Markdown is allowed for the section text. Use bullets or tables when they make the evidence easier to scan, and do not include HTML.',
    `Section title: ${cleanText(input.section?.title, 160) || 'Section'}`,
    `Section objective: ${cleanText(input.section?.objective, 320) || 'Summarize the section.'}`,
    `Research objective JSON:\n${JSON.stringify(input.researchObjective || {}, null, 2)}`,
    `Section evidence JSON:\n${JSON.stringify(input.sectionEvidence || {}, null, 2)}`,
    `Context snapshot JSON:\n${JSON.stringify(input.contextSnapshot || {}, null, 2)}`,
    `Accuracy snapshot JSON:\n${JSON.stringify(input.accuracySnapshot || {}, null, 2)}`,
    'Return JSON only.'
  ].filter(Boolean).join('\n\n');
}

function buildFallbackSectionText(input = {}) {
  const title = cleanText(input.section?.title, 160) || 'Section';
  const notes = asArray(input.sectionEvidence?.notes).map((item) => cleanText(item, 220)).filter(Boolean);
  const evidenceRows = asArray(input.sectionEvidence?.evidence)
    .slice(0, 4)
    .map((item) => {
      const pointer = cleanText(item?.pointer, 180);
      const source = cleanText(item?.source, 120);
      const reason = cleanText(item?.reason, 180);
      return [pointer, source ? `source=${source}` : '', reason].filter(Boolean).join(' | ');
    })
    .filter(Boolean);
  const lines = [];
  if (/recommendation|direct answer/i.test(title)) {
    lines.push(cleanText(input.executionResult?.latest_assistant_text, 800) || cleanText(input.researchObjective?.research_goal, 800));
  }
  if (evidenceRows.length) {
    lines.push(`Evidence considered: ${evidenceRows.join('; ')}.`);
  }
  if (notes.length) {
    lines.push(`Important notes: ${notes.join('; ')}.`);
  }
  return lines.join(' ') || `No additional section content was synthesized for ${title}.`;
}

function computeConfidence(input = {}) {
  const citations = asArray(input.executionResult?.citations).length;
  const contradictions = asArray(input.executionResult?.accuracy_snapshot?.contradictions).length;
  const missing = asArray(input.executionResult?.completion_check?.missing_requirements).length;
  const base = 0.42 + Math.min(0.28, citations * 0.06);
  const contradictionPenalty = Math.min(0.14, contradictions * 0.04);
  const missingPenalty = Math.min(0.12, missing * 0.04);
  return Math.max(0.2, Math.min(0.88, base - contradictionPenalty - missingPenalty));
}

async function runStep5AssembleFinalAnswer(input = {}, deps = {}) {
  const requestStructuredJsonPayload = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const buildDefaultAnswerOutline = typeof input.buildDefaultAnswerOutline === 'function'
    ? input.buildDefaultAnswerOutline
    : deps.buildDefaultAnswerOutline;
  const mapEvidenceToOutlineSections = typeof input.mapEvidenceToOutlineSections === 'function'
    ? input.mapEvidenceToOutlineSections
    : deps.mapEvidenceToOutlineSections;
  const validateSynthesisSections = typeof input.validateSynthesisSections === 'function'
    ? input.validateSynthesisSections
    : deps.validateSynthesisSections;

  const fallbackOutline = typeof buildDefaultAnswerOutline === 'function'
    ? buildDefaultAnswerOutline(input)
    : {
      sections: [
        { id: 'direct_answer', title: 'Direct Answer', objective: 'State the main conclusion.' },
        { id: 'key_evidence', title: 'Key Evidence', objective: 'Summarize supporting evidence.' },
        { id: 'uncertainty', title: 'Uncertainty and Gaps', objective: 'Preserve caveats and missing pieces.' }
      ]
    };
  let outline = fallbackOutline;

  if (requestStructuredJsonPayload) {
    const outlineResult = await requestStructuredJsonPayload({
      provider: cleanText(input.provider, 80),
      endpoint: cleanText(input.endpoint, 2000),
      apiKey: cleanText(input.apiKey, 400),
      model: cleanText(input.model, 120),
      stage: 'deep_research_step_5_outline',
      systemPrompt: 'Return valid JSON only.',
      userPrompt: buildOutlinePrompt(input),
      schema: OUTLINE_SCHEMA,
      traceContext: input.traceContext || null,
      maxOutputTokens: 1200,
      openAiStrict: true,
      openAiAsDefaultProvider: true,
      defaultError: 'Deep research outline synthesis is not configured.'
    });
    if (outlineResult?.ok && outlineResult.payload) {
      outline = normalizeOutline(outlineResult.payload, fallbackOutline);
    }
  }

  const sectionEvidenceMap = typeof mapEvidenceToOutlineSections === 'function'
    ? mapEvidenceToOutlineSections({
      ...input,
      outline,
      citations: input.executionResult?.citations || []
    })
    : [];

  const renderedSections = [];
  for (const section of asArray(outline.sections).slice(0, 6)) {
    const sectionEvidence = sectionEvidenceMap.find((row) => cleanText(row?.section_id, 120) === cleanText(section?.id, 120))
      || { section_id: cleanText(section?.id, 120), title: cleanText(section?.title, 160), objective: cleanText(section?.objective, 320), evidence: [], notes: [] };
    let sectionText = buildFallbackSectionText({
      ...input,
      section,
      sectionEvidence
    });
    if (requestStructuredJsonPayload) {
      const sectionResult = await requestStructuredJsonPayload({
        provider: cleanText(input.provider, 80),
        endpoint: cleanText(input.endpoint, 2000),
        apiKey: cleanText(input.apiKey, 400),
        model: cleanText(input.model, 120),
        stage: 'deep_research_step_5_section',
        systemPrompt: 'Return valid JSON only.',
        userPrompt: buildSectionPrompt({
          ...input,
          section,
          sectionEvidence
        }),
        schema: SECTION_SCHEMA,
        traceContext: input.traceContext || null,
        maxOutputTokens: 1200,
        openAiStrict: true,
        openAiAsDefaultProvider: true,
        defaultError: 'Deep research section synthesis is not configured.'
      });
      if (sectionResult?.ok && sectionResult.payload) {
        sectionText = cleanText(sectionResult.payload.section_text, 4000) || sectionText;
      }
    }
    renderedSections.push({
      section_id: cleanText(section?.id, 120),
      title: cleanText(section?.title, 160),
      text: cleanText(sectionText, 4000),
      evidence: asArray(sectionEvidence?.evidence)
    });
  }

  const validation = typeof validateSynthesisSections === 'function'
    ? validateSynthesisSections({
      outline,
      renderedSections
    })
    : { complete: true, missing_section_ids: [] };

  const answer = renderedSections
    .map((section) => `## ${cleanText(section.title, 160)}\n${cleanText(section.text, 4000)}`)
    .join('\n\n')
    .trim();
  const confidence = computeConfidence(input);
  const decisionRecord = {
    assumptions: uniqueStrings([
      'Deep research used an outline-first synthesis flow.',
      ...asArray(input.researchObjective?.scope_boundaries)
    ], 8),
    open_questions: uniqueStrings([
      ...asArray(input.executionResult?.completion_check?.missing_requirements)
    ], 8),
    verification_notes: uniqueStrings([
      `Rendered sections: ${renderedSections.length}.`,
      `Outline complete: ${validation.complete === true}.`,
      `Citations retained: ${asArray(input.executionResult?.citations).length}.`
    ], 8)
  };
  const followUpQuestions = uniqueStrings([
    ...asArray(input.executionResult?.completion_check?.missing_requirements).map((item) => {
      const clean = cleanText(item, 220);
      return clean ? `Would you like me to resolve: ${clean}?` : '';
    })
  ], 6);

  return {
    answer,
    confidence,
    decision_record: decisionRecord,
    follow_up_questions: followUpQuestions,
    answer_outline: outline,
    rendered_sections: renderedSections,
    section_evidence_map: sectionEvidenceMap,
    synthesis_validation: validation
  };
}

module.exports = {
  runStep5AssembleFinalAnswer
};
