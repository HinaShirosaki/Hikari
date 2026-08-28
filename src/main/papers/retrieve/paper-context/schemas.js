'use strict';

const PAPER_CONTEXT_SOURCE_ORDER = Object.freeze([
  'europe_pmc_full_text',
  'pubmed_abstract',
  'europe_pmc_abstract',
  'crossref_abstract',
  'search_result_summary'
]);

const DEFAULT_MAX_PAPERS = 8;
const DEFAULT_MAX_BLOCKS = 50;
const DEFAULT_MAX_BLOCKS_PER_PAPER = 2;
const DEFAULT_MAX_BLOCKS_PER_PAPER_WITH_PDF = 4;
const DEFAULT_MAX_FIGURE_REVIEWS = 2;

const PAPER_CONTEXT_SELECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['selected_blocks', 'figure_review_requests'],
  properties: {
    selected_blocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['block_id', 'relevance_reason'],
        properties: {
          block_id: { type: 'string' },
          relevance_reason: { type: 'string' }
        }
      }
    },
    figure_review_requests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['paper_id', 'reason'],
        properties: {
          paper_id: { type: 'string' },
          reason: { type: 'string' }
        }
      }
    }
  }
};

const PAPER_FIGURE_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['useful', 'figure_summary', 'relevance_reason'],
  properties: {
    useful: { type: 'boolean' },
    figure_summary: { type: 'string' },
    relevance_reason: { type: 'string' }
  }
};

const PAPER_PDF_EXCERPT_SELECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['excerpts'],
  properties: {
    excerpts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section_label', 'excerpt', 'relevance_reason'],
        properties: {
          section_label: { type: 'string' },
          excerpt: { type: 'string' },
          relevance_reason: { type: 'string' }
        }
      }
    }
  }
};

const PAPER_PDF_TEXT_EXCERPT_SELECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['excerpts', 'request_pdf_review', 'pdf_review_reason'],
  properties: {
    excerpts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section_label', 'excerpt', 'relevance_reason'],
        properties: {
          section_label: { type: 'string' },
          excerpt: { type: 'string' },
          relevance_reason: { type: 'string' }
        }
      }
    },
    request_pdf_review: { type: 'boolean' },
    pdf_review_reason: { type: 'string' }
  }
};

module.exports = {
  PAPER_CONTEXT_SOURCE_ORDER,
  DEFAULT_MAX_PAPERS,
  DEFAULT_MAX_BLOCKS,
  DEFAULT_MAX_BLOCKS_PER_PAPER,
  DEFAULT_MAX_BLOCKS_PER_PAPER_WITH_PDF,
  DEFAULT_MAX_FIGURE_REVIEWS,
  PAPER_CONTEXT_SELECTION_SCHEMA,
  PAPER_FIGURE_REVIEW_SCHEMA,
  PAPER_PDF_EXCERPT_SELECTION_SCHEMA,
  PAPER_PDF_TEXT_EXCERPT_SELECTION_SCHEMA
};
