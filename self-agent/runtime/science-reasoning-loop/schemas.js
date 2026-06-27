'use strict';

const SCIENCE_RESULT_EVALUATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'satisfied',
    'reason',
    'missing_requirements',
    'should_continue',
    'next_tool_hint',
    'can_answer_with_limitations',
    'trace_sentence'
  ],
  properties: {
    satisfied: { type: 'boolean' },
    reason: { type: 'string' },
    missing_requirements: {
      type: 'array',
      items: { type: 'string' }
    },
    should_continue: { type: 'boolean' },
    next_tool_hint: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['tool_name', 'reason'],
          properties: {
            tool_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            query: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            reason: { type: 'string' }
          }
        }
      ]
    },
    can_answer_with_limitations: { type: 'boolean' },
    trace_sentence: { type: 'string' }
  }
};

module.exports = {
  SCIENCE_RESULT_EVALUATION_SCHEMA
};
