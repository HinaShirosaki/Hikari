import { ACTION_WHERE_TO_BUY } from './constants.js';
import { cleanText } from './text-utils.js';

export const SELECTION_INSIGHT_SYSTEM_PROMPT = 'You help a wet-lab scientist understand and source items mentioned in their protocols and notebook pages. Answer only about the selected text, in its given context.';

export const WHERE_TO_BUY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'items'],
  properties: {
    summary: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'vendor', 'price_text', 'product_url', 'image_url'],
        properties: {
          title: { type: 'string' },
          vendor: { type: 'string' },
          price_text: { type: 'string' },
          product_url: { type: 'string' },
          image_url: { type: 'string' }
        }
      }
    }
  }
};

export function createSelectionInsightPrompt({ actionType, selectedText, segmentText, context }) {
  const record = context?.record && typeof context.record === 'object' ? context.record : {};
  const recordName = cleanText(record?.name || record?.protocolName || context?.label, 220);
  const projectName = cleanText(record?.projectName || context?.projectName, 220);
  const segmentLabel = cleanText(context?.segmentLabel || '', 120);

  const instruction = actionType === ACTION_WHERE_TO_BUY
    ? 'Find where to buy the selected item for lab use. Search the web for specific purchasable products. Return JSON: `summary` is 1-3 sentences of buying advice; `items` lists up to 6 products, each with `title`, `vendor`, `price_text` (empty string if unknown), `product_url` (the real product page), and `image_url` (empty string if none).'
    : 'Answer "what is it?" for the selected text as used in this exact protocol or notebook context. Reply in plain prose, concise and practical, no headings.';

  return [
    instruction,
    recordName ? `Record: ${recordName}` : '',
    projectName ? `Project: ${projectName}` : '',
    segmentLabel ? `Section: ${segmentLabel}` : '',
    `Selected text: "${selectedText}"`,
    segmentText ? `Local context: "${cleanText(segmentText, 2400)}"` : ''
  ].filter(Boolean).join('\n\n');
}
