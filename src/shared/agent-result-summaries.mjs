function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function createAgentQuestionNormalizer({ text: trimText } = {}) {
  function slugText(value, fallback = 'option') {
    const normalized = trimText(value, 120)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || fallback;
  }

  return function normalizeAgentUserQuestion(value, fallbackQuestion = '') {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const question = trimText(source.question || source.prompt || source.title || fallbackQuestion, 600);
    if (!question) return null;
    const options = asArray(source.options || source.choices)
      .map((item, index) => {
        const option = item && typeof item === 'object' && !Array.isArray(item) ? item : { label: item };
        const label = trimText(option.label || option.title || option.text || option.value, 160);
        const valueText = trimText(option.value || option.answer || label, 1000);
        if (!label || !valueText) return null;
        return {
          id: trimText(option.id || option.key, 120) || `${slugText(label)}-${index + 1}`,
          label,
          value: valueText,
          description: trimText(option.description || option.detail || option.reason, 260)
        };
      })
      .filter(Boolean)
      .slice(0, 6);
    const answered = source.answered && typeof source.answered === 'object' && !Array.isArray(source.answered)
      ? {
        answer: trimText(source.answered.answer || source.answered.value, 1000),
        answered_at: trimText(source.answered.answered_at || source.answered.answeredAt, 80)
      }
      : null;
    return {
      id: trimText(source.id || source.question_id || source.questionId, 120) || slugText(question, 'question'),
      question,
      context: trimText(source.context || source.help_text || source.helpText, 700),
      options,
      allow_custom: source.allow_custom !== false && source.allowCustom !== false,
      placeholder: trimText(source.placeholder || source.custom_placeholder || source.customPlaceholder, 160)
        || 'Type another answer',
      submit_label: trimText(source.submit_label || source.submitLabel, 80) || 'Send answer',
      status: trimText(source.status, 40),
      answered
    };
  };
}

export function createAgentResultSummaries({ text: trimText, normalizeAgentUserQuestion } = {}) {

function summarizeInventoryLookup(lookup) {
  const payload = lookup && typeof lookup === 'object' ? lookup : {};
  const status = trimText(payload.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    const followUps = asArray(payload.follow_up_questions).map((item) => trimText(item, 280)).filter(Boolean);
    return followUps.join(' ') || 'I need more details to run inventory lookup.';
  }
  const query = trimText(payload.query, 220);
  const items = asArray(payload.items);
  if (status === 'matched' && items.length) {
    const previewLines = items
      .slice(0, 3)
      .map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const label = trimText(source.name || source.id, 140);
        if (!label) {
          return '';
        }
        const details = [
          trimText(source.location, 180) ? `location ${trimText(source.location, 180)}` : '',
          trimText(source.container_name, 180) ? `container ${trimText(source.container_name, 180)}` : '',
          Number.isFinite(Number(source.well_index)) ? `well ${Number(source.well_index)}` : '',
          trimText(source.quantity, 80)
            ? `${trimText(source.kind, 40) === 'personal_sample' ? 'concentration' : 'quantity'} ${trimText(source.quantity, 80)}`
            : '',
          trimText(source.amount, 80) ? `amount ${trimText(source.amount, 80)}` : '',
          trimText(source.supplier, 160) ? `supplier ${trimText(source.supplier, 160)}` : '',
          !trimText(source.location, 180) && trimText(source.zone, 120) ? `zone ${trimText(source.zone, 120)}` : ''
        ].filter(Boolean).slice(0, 4);
        return `${index + 1}. ${label}${details.length ? ` (${details.join('; ')})` : ''}`;
      })
      .filter(Boolean);
    const extraCount = Math.max(0, items.length - previewLines.length);
    return [
      `Found ${items.length} inventory match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}.`,
      ...previewLines,
      extraCount ? `${extraCount} more match${extraCount === 1 ? '' : 'es'} not shown.` : ''
    ].filter(Boolean).join('\n');
  }
  if (status === 'no_match') {
    return `No inventory matches found${query ? ` for "${query}"` : ''}.`;
  }
  return '';
}

function summarizeNotebookLookup(lookup) {
  const payload = lookup && typeof lookup === 'object' ? lookup : {};
  const status = trimText(payload.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    const followUps = asArray(payload.follow_up_questions).map((item) => trimText(item, 280)).filter(Boolean);
    return followUps.join(' ') || 'I need more details to run notebook lookup.';
  }
  const query = trimText(payload.query, 220);
  const items = asArray(payload.items);
  if (status === 'matched' && items.length) {
    const previewLines = items
      .slice(0, 3)
      .map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const label = trimText(source.title || source.id, 140);
        if (!label) {
          return '';
        }
        const recordType = trimText(source.record_type, 40).replace(/_/g, ' ');
        const details = [
          trimText(source.project_name, 180) ? `project ${trimText(source.project_name, 180)}` : '',
          trimText(source.linked_protocol_name, 180) ? `protocol ${trimText(source.linked_protocol_name, 180)}` : '',
          trimText(source.updated_at, 80) ? `updated ${trimText(source.updated_at, 80)}` : ''
        ].filter(Boolean).slice(0, 3);
        return `${index + 1}. ${recordType ? `${recordType}: ` : ''}${label}${details.length ? ` (${details.join('; ')})` : ''}`;
      })
      .filter(Boolean);
    const extraCount = Math.max(0, items.length - previewLines.length);
    return [
      `Found ${items.length} notebook match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}.`,
      ...previewLines,
      extraCount ? `${extraCount} more match${extraCount === 1 ? '' : 'es'} not shown.` : ''
    ].filter(Boolean).join('\n');
  }
  if (status === 'no_match') {
    return `No notebook matches found${query ? ` for "${query}"` : ''}.`;
  }
  return '';
}

function summarizePurchaseRecommendation(purchaseRecommendation) {
  const payload = purchaseRecommendation && typeof purchaseRecommendation === 'object' ? purchaseRecommendation : {};
  const status = trimText(payload.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => trimText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can recommend something to buy.';
  }
  const query = trimText(payload.query, 220);
  const items = asArray(payload.items);
  const requiredTerms = asArray(payload?.filters?.required_terms).map((item) => trimText(item, 120)).filter(Boolean);
  const matchMode = trimText(payload.match_mode, 20);
  if (status === 'matched' && items.length) {
    if (matchMode === 'partial') {
      return `Found ${items.length} likely product match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}, but I could not verify every requested attribute from the vendor pages.`;
    }
    return `Found ${items.length} purchase recommendation${items.length === 1 ? '' : 's'}${query ? ` for "${query}"` : ''}${requiredTerms.length ? ` matching ${requiredTerms.join(', ')}` : ''}.`;
  }
  if (status === 'no_match') {
    return `No purchase recommendations found${query ? ` for "${query}"` : ''}.`;
  }
  return '';
}

function summarizeCodexAgent(codexAgent) {
  const payload = codexAgent && typeof codexAgent === 'object' ? codexAgent : {};
  const status = trimText(payload.status, 40);
  if (!status) {
    return '';
  }
  const explicitUserQuestion = payload.user_question || payload.userQuestion;
  const userQuestion = explicitUserQuestion
    ? normalizeAgentUserQuestion(explicitUserQuestion, '')
    : null;
  if (status === 'needs_more_info') {
    if (userQuestion?.question) {
      return userQuestion.question;
    }
    return asArray(payload.follow_up_questions).map((item) => trimText(item, 500)).filter(Boolean).join(' ')
      || trimText(payload.answer, 12000)
      || 'I need more detail before I can continue.';
  }
  return trimText(payload.answer || payload.assistant_text, 12000);
}

function summarizeSkillCommand(skillCommand) {
  const payload = skillCommand && typeof skillCommand === 'object' ? skillCommand : {};
  if (!Object.keys(payload).length) return '';
  const summary = trimText(payload.summary, 12000);
  const result = payload.result && typeof payload.result === 'object' ? payload.result : {};
  const output = trimText(
    result.output || [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? '\n' : ''),
    12000
  );
  if (summary && output && !summary.includes(output)) return `${summary}\n\n${output}`;
  return summary || output;
}

function summarizeScienceResult(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const status = trimText(source.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(source.follow_up_questions).map((item) => trimText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can continue.';
  }
  const answer = trimText(source.answer, 12000);
  if (answer) {
    return answer;
  }
  const followUps = asArray(source.follow_up_questions).map((item) => trimText(item, 280)).filter(Boolean);
  return followUps.join(' ');
}

function summarizeNotebookDraft(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (asArray(source.notebooks).length > 1) return `Prepared ${source.notebooks.length} notebook drafts for individual review.`;
  const status = trimText(source.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(source.follow_up_questions).map((item) => trimText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can plan the next notebook page.';
  }
  const proposal = source.proposal && typeof source.proposal === 'object' ? source.proposal : {};
  const title = trimText(proposal.title, 220);
  const purpose = trimText(proposal.purpose, 320);
  const protocolName = trimText(source?.selected_protocol?.name, 220);
  if (status === 'proposal_ready') {
    return title && purpose
      ? `Planned notebook draft ready: ${title}. ${purpose}`
      : `Planned notebook draft ready${protocolName ? ` using protocol ${protocolName}` : ''}.`;
  }
  return '';
}

function summarizeNotebookAppend(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (trimText(source.status, 40) !== 'proposal_ready') {
    return '';
  }
  const sectionTitle = trimText(source?.proposal?.section_title, 220);
  return `Notebook enrichment is ready for review${sectionTitle ? `: ${sectionTitle}` : ''}.`;
}

function summarizeProtocolGeneration(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const protocols = asArray(source.protocols).length
    ? asArray(source.protocols)
    : (source.protocol && typeof source.protocol === 'object' ? [source.protocol] : []);
  if (!protocols.length) {
    return '';
  }
  const names = protocols.map((protocol) => trimText(protocol?.name || protocol?.title, 160)).filter(Boolean);
  const status = trimText(source.status, 40);
  const prefix = protocols.length === 1
    ? `Generated protocol ready${names[0] ? `: ${names[0]}` : ''}.`
    : `Generated ${protocols.length} protocols${names.length ? `: ${names.slice(0, 3).join(', ')}` : ''}.`;
  if (status === 'awaiting_user_approval') {
    return `${prefix} Review it before adding it to Protocol Module.`;
  }
  return `${prefix} Review it before adding it to Protocol Module.`;
}

function extractStructuredThinkingTrace(result) {
  const source = result && typeof result === 'object' ? result : {};
  const candidates = [
    source.thinking_trace,
    source.general_science_question?.thinking_trace,
    source.project_science_question?.thinking_trace,
    source.result_analysis?.thinking_trace
  ];
  return candidates.find((candidate) => (
    candidate
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
  )) || null;
}

return {
  extractStructuredThinkingTrace,
  summarizeCodexAgent,
  summarizeInventoryLookup,
  summarizeNotebookAppend,
  summarizeNotebookDraft,
  summarizeNotebookLookup,
  summarizeProtocolGeneration,
  summarizePurchaseRecommendation,
  summarizeScienceResult,
  summarizeSkillCommand
};
}
