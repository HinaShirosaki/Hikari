import { ACTION_WHERE_TO_BUY } from './constants.js';
import { cleanText } from './text-utils.js';

export function createSelectionInsightPrompt({ actionType, selectedText, segmentText, context }) {
  const record = context?.record && typeof context.record === 'object' ? context.record : {};
  const recordName = cleanText(record?.name || record?.protocolName || context?.label, 220);
  const projectName = cleanText(record?.projectName || context?.projectName, 220);
  const segmentLabel = cleanText(context?.segmentLabel || '', 120);
  const heading = actionType === ACTION_WHERE_TO_BUY
    ? 'Help me figure out where to buy this selected lab item.'
    : 'Help me explain this selected lab term in context.';

  const instruction = actionType === ACTION_WHERE_TO_BUY
    ? 'Recommend where to buy the selected item for lab use. Prefer specific products or vendors when you can identify them.'
    : 'Answer the question "what is it?" for the selected text in this exact protocol or notebook context. Keep it concise and practical.';

  return [
    heading,
    instruction,
    recordName ? `Record: ${recordName}` : '',
    projectName ? `Project: ${projectName}` : '',
    segmentLabel ? `Section: ${segmentLabel}` : '',
    `Selected text: "${selectedText}"`,
    segmentText ? `Local context: "${cleanText(segmentText, 2400)}"` : ''
  ].filter(Boolean).join('\n\n');
}
