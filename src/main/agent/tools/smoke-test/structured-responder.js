'use strict';

const { cleanText } = require('./utils.js');

function createStructuredJsonResponder() {
  return async function requestStructuredJsonPayload(options = {}) {
    const stage = cleanText(options.stage);
    if (stage === 'paper_analysis_tool') {
      return {
        ok: true,
        payload: {
          brief_summary: 'The smoke-test paper context supports a short binder purification workflow.',
          key_findings: [
            'Ni-NTA resin is used for capture.',
            'Clarified lysate is loaded before elution.'
          ],
          method_overview: 'Clarify lysate, bind to resin, then elute the target protein.',
          protocol_candidate: {
            title: 'Atlas Binder Purification',
            purpose: 'Purify the Atlas binder from clarified lysate.',
            method_text: 'Clarify lysate, bind it to Ni-NTA resin for [time], then elute with imidazole.',
            materials: ['Ni-NTA resin', 'imidazole buffer'],
            steps: [
              'Clarify lysate.',
              'Bind clarified lysate to Ni-NTA resin for [time].',
              'Elute bound protein with imidazole.'
            ],
            notes: 'Keep buffers cold during purification.'
          },
          result_summary: 'Paper analysis smoke test completed.'
        }
      };
    }
    if (stage === 'protocol_tiebreak_llm') {
      return {
        ok: true,
        payload: {
          selected_protocol_id: null,
          selected_protocol_name: null,
          rationale: 'Smoke-test mode defers to deterministic ranking.'
        }
      };
    }
    if (stage === 'notebook_fill') {
      return {
        ok: true,
        payload: {
          filled_values: [],
          missing_placeholders: [],
          follow_up_questions: [],
          result_summary: 'Notebook fill smoke test completed.'
        }
      };
    }
    if (stage === 'notebook_draft_selection') {
      return {
        ok: true,
        payload: {
          selected_candidate_id: 'wf-1::block-3::prot-2::Viability Assay',
          title: 'Viability Assay After Cell Prep',
          purpose: 'Measure whether the prepared Atlas cells remain viable for the next workflow step.',
          rationale: 'The workflow places the viability assay immediately after completed cell prep.',
          planned_materials: ['Cell Prep output', 'Viability assay plate'],
          checkpoints: ['Confirm cells are ready from Cell Prep.', 'Record viability readout and observations.']
        }
      };
    }
    return {
      ok: false,
      error: `Unhandled smoke-test stage "${stage || 'unknown'}".`
    };
  };
}

module.exports = { createStructuredJsonResponder };
