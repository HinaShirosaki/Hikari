'use strict';

const { asArray, cloneJson } = require('../../../lib/normalize.js');
const { cleanText } = require('./text-utils.js');
const { normalizeAgentUserQuestion } = require('./agent-questions.js');

// Build a concise assistant-facing summary from inventory lookup results.
function summarizeInventoryLookup(lookup) {
  const payload = lookup && typeof lookup === 'object' ? lookup : {};
  const status = cleanText(payload.status);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => cleanText(item)).filter(Boolean).join(' ')
      || 'I need more details to run inventory lookup.';
  }
  const query = cleanText(payload.query);
  const items = asArray(payload.items);
  if (status === 'matched' && items.length) {
    const previewLines = items
      .slice(0, 3)
      .map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const label = cleanText(source.name || source.id);
        if (!label) {
          return '';
        }
        const details = [
          cleanText(source.location) ? `location ${cleanText(source.location)}` : '',
          cleanText(source.container_name) ? `container ${cleanText(source.container_name)}` : '',
          Number.isFinite(Number(source.well_index)) ? `well ${Number(source.well_index)}` : '',
          cleanText(source.quantity)
            ? `${cleanText(source.kind) === 'personal_sample' ? 'concentration' : 'quantity'} ${cleanText(source.quantity)}`
            : '',
          cleanText(source.amount) ? `amount ${cleanText(source.amount)}` : '',
          cleanText(source.supplier) ? `supplier ${cleanText(source.supplier)}` : '',
          !cleanText(source.location) && cleanText(source.zone) ? `zone ${cleanText(source.zone)}` : ''
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

// Build a concise assistant-facing summary from notebook lookup results.
function summarizeNotebookLookup(lookup) {
  const payload = lookup && typeof lookup === 'object' ? lookup : {};
  const status = cleanText(payload.status);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => cleanText(item)).filter(Boolean).join(' ')
      || 'I need more details to run notebook lookup.';
  }
  const query = cleanText(payload.query);
  const items = asArray(payload.items);
  if (status === 'matched' && items.length) {
    const previewLines = items
      .slice(0, 3)
      .map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const label = cleanText(source.title || source.id);
        if (!label) {
          return '';
        }
        const recordType = cleanText(source.record_type).replace(/_/g, ' ');
        const details = [
          cleanText(source.project_name) ? `project ${cleanText(source.project_name)}` : '',
          cleanText(source.linked_protocol_name) ? `protocol ${cleanText(source.linked_protocol_name)}` : '',
          cleanText(source.updated_at) ? `updated ${cleanText(source.updated_at)}` : ''
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
  const status = cleanText(payload.status);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => cleanText(item)).filter(Boolean).join(' ')
      || 'I need more detail before I can recommend something to buy.';
  }
  const query = cleanText(payload.query);
  const items = asArray(payload.items);
  const requiredTerms = asArray(payload?.filters?.required_terms).map((item) => cleanText(item)).filter(Boolean);
  const matchMode = cleanText(payload.match_mode);
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
  const status = cleanText(payload.status);
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
    return asArray(payload.follow_up_questions).map((item) => cleanText(item)).filter(Boolean).join(' ')
      || cleanText(payload.answer)
      || 'I need more detail before I can continue.';
  }
  return cleanText(payload.answer || payload.assistant_text);
}

function summarizeSkillCommand(skillCommand) {
  const payload = skillCommand && typeof skillCommand === 'object' ? skillCommand : {};
  if (!Object.keys(payload).length) {
    return '';
  }
  const summary = cleanText(payload.summary);
  const result = payload.result && typeof payload.result === 'object' ? payload.result : {};
  const output = cleanText(
    result.output
      || [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? '\n' : ''));
  if (summary && output && !summary.includes(output)) {
    return `${summary}\n\n${output}`;
  }
  return summary || output;
}

// Extract the main answer or follow-up prompt from a science-question result payload.
function summarizeScienceResult(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const status = cleanText(source.status);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(source.follow_up_questions).map((item) => cleanText(item)).filter(Boolean).join(' ')
      || 'I need more detail before I can continue.';
  }
  const answer = cleanText(source.answer);
  if (answer) {
    return answer;
  }
  return asArray(source.follow_up_questions).map((item) => cleanText(item)).filter(Boolean).join(' ');
}

// Build a concise assistant-facing summary from notebook draft proposal results.
function summarizeNotebookDraft(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const status = cleanText(source.status);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(source.follow_up_questions).map((item) => cleanText(item)).filter(Boolean).join(' ')
      || 'I need more detail before I can plan the next notebook page.';
  }
  const proposal = source.proposal && typeof source.proposal === 'object' ? source.proposal : {};
  const title = cleanText(proposal.title);
  const purpose = cleanText(proposal.purpose);
  const protocolName = cleanText(source?.selected_protocol?.name);
  if (status === 'proposal_ready') {
    return title && purpose
      ? `Planned notebook draft ready: ${title}. ${purpose}`
      : `Planned notebook draft ready${protocolName ? ` using protocol ${protocolName}` : ''}.`;
  }
  return '';
}

function summarizeNotebookAppend(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (cleanText(source.status) !== 'proposal_ready') {
    return '';
  }
  const sectionTitle = cleanText(source?.proposal?.section_title);
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
  const names = protocols.map((protocol) => cleanText(protocol?.name || protocol?.title)).filter(Boolean);
  const prefix = protocols.length === 1
    ? `Generated protocol ready${names[0] ? `: ${names[0]}` : ''}.`
    : `Generated ${protocols.length} protocols${names.length ? `: ${names.slice(0, 3).join(', ')}` : ''}.`;
  return `${prefix} Review it before adding it to Protocol Module.`;
}

function extractStructuredThinkingTrace(result) {
  const payload = result && typeof result === 'object' ? result : {};
  const candidates = [
    payload.thinking_trace,
    payload.general_science_question?.thinking_trace,
    payload.project_science_question?.thinking_trace,
    payload.result_analysis?.thinking_trace
  ];
  const match = candidates.find((candidate) => (
    candidate
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
  ));
  return match ? cloneJson(match, null) : null;
}

function ensureThinkingTraceMeta(meta) {
  const payload = meta && typeof meta === 'object' ? cloneJson(meta, {}) : {};
  if (payload.thinking_trace && typeof payload.thinking_trace === 'object' && !Array.isArray(payload.thinking_trace)) {
    return payload;
  }
  payload.thinking_trace = extractStructuredThinkingTrace(payload);
  return payload;
}

module.exports = {
  summarizeInventoryLookup,
  summarizeNotebookLookup,
  summarizePurchaseRecommendation,
  summarizeCodexAgent,
  summarizeSkillCommand,
  summarizeScienceResult,
  summarizeNotebookDraft,
  summarizeNotebookAppend,
  summarizeProtocolGeneration,
  extractStructuredThinkingTrace,
  ensureThinkingTraceMeta
};
