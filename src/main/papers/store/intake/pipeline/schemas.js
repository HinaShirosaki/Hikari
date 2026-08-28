'use strict';

const { DOC_TYPES } = require('../intake-store.js');

const CLASSIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['doc_type', 'confidence', 'reason'],
  properties: {
    doc_type: { type: 'string', enum: [...DOC_TYPES] },
    confidence: { type: 'number' },
    reason: { type: 'string' }
  }
};

const RESEARCH_PAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['experiments', 'request_next_page'],
  properties: {
    experiments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'technique', 'variables', 'figure_ref', 'outcome', 'evidence'],
        properties: {
          title: { type: 'string' },
          technique: { type: 'string' },
          variables: { type: 'string' },
          figure_ref: { type: 'string' },
          outcome: { type: 'string' },
          evidence: { type: 'string' }
        }
      }
    },
    request_next_page: { type: 'boolean' }
  }
};

const RESEARCH_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['one_sentence_summary'],
  properties: {
    one_sentence_summary: { type: 'string' }
  }
};

const NON_RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['one_sentence_summary', 'structure_outline', 'notable_claims'],
  properties: {
    one_sentence_summary: { type: 'string' },
    structure_outline: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'summary'],
        properties: {
          section: { type: 'string' },
          summary: { type: 'string' }
        }
      }
    },
    notable_claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'claim'],
        properties: {
          section: { type: 'string' },
          claim: { type: 'string' }
        }
      }
    }
  }
};

module.exports = {
  CLASSIFICATION_SCHEMA,
  NON_RESEARCH_SCHEMA,
  RESEARCH_PAGE_SCHEMA,
  RESEARCH_SUMMARY_SCHEMA
};
