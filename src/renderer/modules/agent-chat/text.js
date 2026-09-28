import { createAgentQuestionNormalizer } from '../../../shared/agent-result-summaries.mjs';

export function trimText(value, maxLength = 5000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

export const normalizeAgentUserQuestion = createAgentQuestionNormalizer({ text: trimText });
