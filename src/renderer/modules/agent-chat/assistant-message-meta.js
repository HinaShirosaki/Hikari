import { mergeAgentHtmlArtifacts } from './html-artifacts.js';
import { mergeSourceEvidence } from '../../../shared/paper-evidence.mjs';
import { mergeAgentImageArtifacts } from './image-artifacts.js';
import { mergeAgentPlotlyGraphArtifacts } from './plotly-artifacts.js';

export function buildAssistantResponseMessage({
  createId,
  response,
  notebookDraft,
  notebookDrafts,
  traceRows,
  messageText
}) {
  return {
    id: createId(),
    role: 'assistant',
    text: response.assistantText,
    createdAt: new Date().toISOString(),
    meta: {
      paper_evidence: mergeSourceEvidence(traceRows.paperEvidence, response.paperEvidence),
      parser: response.parser,
      protocol_to_notebook: response.protocolWorkflow,
      notebook_draft: response.notebookDraftWorkflow,
      notebook_append: response.notebookAppendWorkflow,
      notebookAppend: response.notebookAppendWorkflow,
      ...(response.protocolEdits?.length ? { protocol_edits: response.protocolEdits } : {}),
      protocol_generation: response.protocolGeneration,
      codex_agent: response.codexAgent,
      user_question: response.userQuestion,
      purchase_recommendation: response.purchaseRecommendation,
      inventory_lookup: response.inventoryLookup,
      notebook_lookup: response.notebookLookup,
      general_science_question: response.generalScienceQuestion,
      project_science_question: response.projectScienceQuestion,
      result_analysis: response.resultAnalysis,
      thinking_trace: response.thinkingTrace,
      notebookDraft: notebookDraft || null,
      notebookDrafts: notebookDrafts || (notebookDraft ? [notebookDraft] : []),
      html_artifacts: mergeAgentHtmlArtifacts(traceRows.htmlArtifacts, response.htmlArtifacts),
      image_artifacts: mergeAgentImageArtifacts(traceRows.imageArtifacts, response.imageArtifacts),
      plotly_graph_artifacts: mergeAgentPlotlyGraphArtifacts(traceRows.plotlyArtifacts, response.plotlyArtifacts),
      sequence_actions: traceRows.sequenceActions || [],
      thinking_trace_rows: traceRows.thinking,
      activity_trace_rows: traceRows.activity,
      codex_cli_display_rows: traceRows.codexCliDisplay,
      requestText: messageText
    }
  };
}

export function buildAssistantErrorMessage({
  createId,
  error,
  traceRows,
  messageText
}) {
  const errorText = String(error?.message || error);
  return {
    id: createId(),
    role: 'assistant',
    text: `Agent failed: ${errorText}`,
    createdAt: new Date().toISOString(),
    meta: {
      paper_evidence: mergeSourceEvidence(traceRows.paperEvidence),
      parser: {
        primary_intent: 'unclear',
        reasoning_effort: 0,
        direct_answer: null,
        needs_clarification: true,
        clarification_reason: 'agent_error',
        entities: {},
        inventory_search: {
          candidate_terms: []
        },
        protocol_candidates: [],
        reasoning_summary: `Agent failed: ${errorText}`
      },
      protocol_to_notebook: null,
      notebook_draft: null,
      notebook_append: null,
      notebookAppend: null,
      protocol_generation: null,
      purchase_recommendation: null,
      inventory_lookup: null,
      notebook_lookup: null,
      general_science_question: null,
      project_science_question: null,
      result_analysis: null,
      thinking_trace: null,
      notebookDraft: null,
      html_artifacts: traceRows.htmlArtifacts || [],
      image_artifacts: traceRows.imageArtifacts || [],
      plotly_graph_artifacts: traceRows.plotlyArtifacts || [],
      sequence_actions: traceRows.sequenceActions || [],
      thinking_trace_rows: traceRows.thinking,
      activity_trace_rows: traceRows.activity,
      codex_cli_display_rows: traceRows.codexCliDisplay,
      requestText: messageText
    }
  };
}
