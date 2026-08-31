'use strict';

// Schema, system prompt, and prompt builder for the draft-selection LLM call.
function createDraftSelectionPrompt({ asArray, cleanText, ensureObject } = {}) {
  const NOTEBOOK_DRAFT_SELECTION_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: [
      'selected_candidate_id',
      'title',
      'purpose',
      'rationale',
      'planned_materials',
      'checkpoints'
    ],
    properties: {
      selected_candidate_id: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      title: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      purpose: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      rationale: {
        anyOf: [{ type: 'string' }, { type: 'null' }]
      },
      planned_materials: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 10
      },
      checkpoints: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 10
      }
    }
  };

  const NOTEBOOK_DRAFT_SELECTION_SYSTEM_PROMPT = [
    'You propose the most likely next experiment and prepare planning notes for a future notebook draft.',
    'Choose exactly one candidate from the app-provided list.',
    'Prefer downstream workflow steps, recent executed progress, and project consistency.',
    'Use evidence context when provided to choose a better next experiment and to justify the plan.',
    'Return JSON only.'
  ].join(' ');

  const NOTEBOOK_DRAFT_SELECTION_RULES = [
    'Choose one candidate that best represents the most plausible next experiment.',
    'Prefer candidates that are downstream from already executed workflow blocks.',
    'Do not invent protocol IDs, workflow IDs, or unsupported materials.',
    'Write concise planning text suited for a notebook draft that the user will edit later.',
    'If the candidate already includes checklist text from workflow notes, convert it into checkpoints when helpful.',
    'When evidence context is provided, incorporate supported paper or record findings into the rationale and checkpoints.'
  ];

  function normalizeEvidenceContext(rawEvidence = []) {
    return asArray(rawEvidence).map((item) => {
      const source = ensureObject(item);
      return {
        tool_name: cleanText(source.tool_name || source.toolName, 120),
        status: cleanText(source.status, 80),
        summary: cleanText(source.summary, 900),
        item_count: Number.isFinite(Number(source.item_count || source.itemCount))
          ? Number(source.item_count || source.itemCount)
          : asArray(source.items).length,
        citations: asArray(source.citations).slice(0, 6).map((citation) => ({
          source: cleanText(citation?.source, 120),
          pointer: cleanText(citation?.pointer, 260),
          reason: cleanText(citation?.reason, 260)
        })).filter((citation) => citation.source || citation.pointer || citation.reason)
      };
    }).filter((item) => item.tool_name || item.summary);
  }

  function buildNotebookDraftSelectionPrompt({
    message,
    conversation,
    parserPayload,
    project,
    notebookRuns,
    candidates,
    evidenceContext = []
  } = {}) {
    const promptConversation = asArray(conversation).slice(-8).map((row, index) => {
      const role = row?.role === 'assistant' ? 'assistant' : 'user';
      const text = cleanText(row?.text, 1200);
      return text ? `${index + 1}. ${role}: ${text}` : '';
    }).filter(Boolean).join('\n');
    return [
      ...NOTEBOOK_DRAFT_SELECTION_RULES,
      `User message: ${cleanText(message, 3200)}`,
      promptConversation ? `Recent conversation:\n${promptConversation}` : '',
      `Parser JSON:\n${JSON.stringify(parserPayload || {}, null, 2)}`,
      `Resolved project JSON:\n${JSON.stringify(project || {}, null, 2)}`,
      `Recent notebook runs JSON:\n${JSON.stringify(asArray(notebookRuns).slice(0, 12), null, 2)}`,
      `Candidate experiments JSON:\n${JSON.stringify(asArray(candidates).slice(0, 6), null, 2)}`,
      asArray(evidenceContext).length
        ? `Evidence context JSON:\n${JSON.stringify(normalizeEvidenceContext(evidenceContext).slice(0, 6), null, 2)}`
        : ''
    ].filter(Boolean).join('\n\n');
  }

  return {
    NOTEBOOK_DRAFT_SELECTION_SCHEMA,
    NOTEBOOK_DRAFT_SELECTION_SYSTEM_PROMPT,
    NOTEBOOK_DRAFT_SELECTION_RULES,
    normalizeEvidenceContext,
    buildNotebookDraftSelectionPrompt
  };
}

module.exports = { createDraftSelectionPrompt };
