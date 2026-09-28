import { createAgentResultSummaries } from '../../../../shared/agent-result-summaries.mjs';
import { normalizeAgentUserQuestion, trimText } from '../shared.js';

const summaries = createAgentResultSummaries({
  text: trimText,
  normalizeAgentUserQuestion
});

const {
  extractStructuredThinkingTrace,
  summarizeCodexAgent,
  summarizeInventoryLookup,
  summarizeNotebookAppend,
  summarizeNotebookDraft,
  summarizeNotebookLookup,
  summarizeProtocolGeneration,
  summarizePurchaseRecommendation,
  summarizeScienceResult
} = summaries;

export {
  extractStructuredThinkingTrace,
  summarizeCodexAgent,
  summarizeInventoryLookup,
  summarizeNotebookAppend,
  summarizeNotebookDraft,
  summarizeNotebookLookup,
  summarizeProtocolGeneration,
  summarizePurchaseRecommendation,
  summarizeScienceResult
};
