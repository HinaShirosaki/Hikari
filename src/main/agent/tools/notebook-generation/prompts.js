'use strict';

// Placeholder token patterns, the structured-fill response schema, and the
// system prompt / rules / examples the fill call is built from.
  const PROTOCOL_PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;
  const PROTOCOL_INLINE_PLACEHOLDER_REGEX = /\[([^[\]]{1,80})\]/g;

  const PROTOCOL_NOTEBOOK_FILL_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['filled_values', 'missing_placeholders', 'follow_up_questions', 'result_summary'],
    properties: {
      filled_values: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['placeholder_key', 'value', 'source'],
          properties: {
            placeholder_key: { type: 'string' },
            value: { type: 'string' },
            source: { type: 'string' }
          }
        }
      },
      missing_placeholders: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['placeholder_key', 'reason'],
          properties: {
            placeholder_key: { type: 'string' },
            reason: { type: 'string' }
          }
        }
      },
      follow_up_questions: {
        type: 'array',
        items: { type: 'string' }
      },
      result_summary: { anyOf: [{ type: 'string' }, { type: 'null' }] }
    }
  };

  const PROTOCOL_TO_NOTEBOOK_FILL_SYSTEM_PROMPT = [
    'You generate a protocol-based notebook draft.',
    'Use the selected protocol, user context, and optional tool evidence.',
    'Fill placeholders only when supported by evidence.',
    'Return JSON only.'
  ].join(' ');

  const PROTOCOL_TO_NOTEBOOK_FILL_RULES = [
    'Fill placeholders using evidence priority: user message, recent conversation, parser entities, project context, optional tool context.',
    'Extract exact value spans from the latest user text when they semantically match unresolved placeholders.',
    'Prefer exact copy of entity strings from user text, including punctuation and hyphenated identifiers.',
    'When unresolved placeholders already exist and the latest user message is a direct answer, map it to the best matching unresolved placeholder.',
    'filled_values.placeholder_key must exactly match one of the provided placeholder_key values.',
    'If optional tool context is provided, use it only when directly relevant.',
    'Do not fabricate values.',
    'Ask follow_up_questions only when ambiguity remains after using user text, conversation, parser data, and optional tool context.',
    'For unresolved placeholders, return missing_placeholders and concise follow_up_questions.'
  ];

  const PROTOCOL_TO_NOTEBOOK_FILL_EXAMPLES = [
    [
      'Example single-turn:',
      'User message: "I did pET28a-SUMO1 transformation today."',
      'Given one unresolved placeholder for a named construct/plasmid, fill it immediately by copying "pET28a-SUMO1" exactly into filled_values.'
    ].join(' '),
    [
      'Example follow-up:',
      'If a previous turn left one unresolved placeholder and user now says "It was pET28a-SUMO1",',
      'treat this as a direct answer and return that exact value for the unresolved placeholder_key.'
    ].join(' ')
  ];

module.exports = {
  PROTOCOL_PLACEHOLDER_TOKEN_REGEX,
  PROTOCOL_INLINE_PLACEHOLDER_REGEX,
  PROTOCOL_NOTEBOOK_FILL_RESPONSE_SCHEMA,
  PROTOCOL_TO_NOTEBOOK_FILL_SYSTEM_PROMPT,
  PROTOCOL_TO_NOTEBOOK_FILL_RULES,
  PROTOCOL_TO_NOTEBOOK_FILL_EXAMPLES
};
