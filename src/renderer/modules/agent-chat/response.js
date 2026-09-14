import { asArray, normalizeAgentUserQuestion, trimText } from './shared.js';
import { extractStructuredThinkingTrace, summarizeCodexAgent, summarizeInventoryLookup, summarizeNotebookAppend, summarizeNotebookDraft, summarizeNotebookLookup, summarizeProtocolGeneration, summarizePurchaseRecommendation, summarizeScienceResult } from './response/result-summaries.js';

export function normalizeAgentResponse(result) {
  const protocolWorkflow = result?.protocol_to_notebook && typeof result.protocol_to_notebook === 'object'
    ? result.protocol_to_notebook
    : null;
  const notebookDraftWorkflow = result?.notebook_draft && typeof result.notebook_draft === 'object'
    ? result.notebook_draft
    : null;
  const notebookAppendWorkflow = result?.notebook_append && typeof result.notebook_append === 'object'
    ? result.notebook_append
    : null;
  const protocolGeneration = result?.protocol_generation && typeof result.protocol_generation === 'object'
    ? result.protocol_generation
    : (result?.protocolGeneration && typeof result.protocolGeneration === 'object'
      ? result.protocolGeneration
      : null);
  const notebookPayload = protocolWorkflow?.notebook && typeof protocolWorkflow.notebook === 'object'
    ? protocolWorkflow.notebook
    : (notebookDraftWorkflow?.notebook && typeof notebookDraftWorkflow.notebook === 'object'
      ? notebookDraftWorkflow.notebook
      : result?.notebookDraft);
  const parser = result?.parser && typeof result.parser === 'object' ? result.parser : {};
  const protocolStatus = trimText(protocolWorkflow?.status, 40);
  const followUpQuestions = asArray(protocolWorkflow?.follow_up_questions).map((item) => trimText(item, 320)).filter(Boolean);
  const completedNotebookText = trimText(
    protocolWorkflow?.notebook?.entry_template?.result
      || protocolWorkflow?.notebook?.save?.reason
      || '',
    12000
  );
  const inventoryLookup = result?.inventory_lookup && typeof result.inventory_lookup === 'object'
    ? result.inventory_lookup
    : null;
  const notebookLookup = result?.notebook_lookup && typeof result.notebook_lookup === 'object'
    ? result.notebook_lookup
    : null;
  const purchaseRecommendation = result?.purchase_recommendation && typeof result.purchase_recommendation === 'object'
    ? result.purchase_recommendation
    : null;
  const codexAgent = result?.codex_agent && typeof result.codex_agent === 'object'
    ? result.codex_agent
    : null;
  const explicitUserQuestion = result?.user_question
    || result?.userQuestion
    || codexAgent?.user_question
    || codexAgent?.userQuestion;
  const codexStatus = trimText(codexAgent?.status, 40);
  const keepUserQuestion = Boolean(
    explicitUserQuestion
    && (
      codexStatus === 'needs_more_info'
      || codexStatus === 'needs_user_answer'
      || (!codexAgent && parser?.needs_clarification === true)
    )
  );
  const userQuestion = keepUserQuestion
    ? normalizeAgentUserQuestion(explicitUserQuestion, '')
    : null;
  const generalScienceQuestion = result?.general_science_question && typeof result.general_science_question === 'object'
    ? result.general_science_question
    : null;
  const projectScienceQuestion = result?.project_science_question && typeof result.project_science_question === 'object'
    ? result.project_science_question
    : null;
  const resultAnalysis = result?.result_analysis && typeof result.result_analysis === 'object'
    ? result.result_analysis
    : null;
  const inventorySummaryText = summarizeInventoryLookup(inventoryLookup);
  const notebookSummaryText = summarizeNotebookLookup(notebookLookup);
  const purchaseRecommendationText = summarizePurchaseRecommendation(purchaseRecommendation);
  const codexAgentText = summarizeCodexAgent(codexAgent);
  const notebookDraftText = summarizeNotebookDraft(notebookDraftWorkflow);
  const notebookAppendText = summarizeNotebookAppend(notebookAppendWorkflow);
  const protocolGenerationText = summarizeProtocolGeneration(protocolGeneration);
  const scienceAnswerText = summarizeScienceResult(generalScienceQuestion)
    || summarizeScienceResult(projectScienceQuestion)
    || summarizeScienceResult(resultAnalysis);
  const assistantText = notebookAppendText
    || notebookDraftText
    || protocolGenerationText
    || codexAgentText
    || (protocolStatus === 'completed'
      ? (completedNotebookText
        || `Notebook draft completed using protocol ${trimText(protocolWorkflow?.selected_protocol?.name, 220) || 'selection'}.`)
      : (protocolStatus === 'needs_more_info'
      ? (followUpQuestions.join(' ') || 'More details are needed to fill the remaining notebook placeholders.')
      : (scienceAnswerText
          || purchaseRecommendationText
          || inventorySummaryText
          || notebookSummaryText
          || trimText(parser.reasoning_summary, 12000)
          || 'Intent parsing completed.')));

  return {
    htmlArtifacts: asArray(result?.html_artifacts),
    imageArtifacts: asArray(result?.image_artifacts),
    parser,
    protocolWorkflow,
    notebookDraftWorkflow,
    notebookAppendWorkflow,
    protocolGeneration,
    notebookPayload,
    purchaseRecommendation,
    codexAgent,
    userQuestion,
    inventoryLookup,
    notebookLookup,
    generalScienceQuestion,
    projectScienceQuestion,
    resultAnalysis,
    thinkingTrace: extractStructuredThinkingTrace(result),
    assistantText
  };
}

export { collectAgentActivityRows } from './response/activity-rows.js';
export {
  summarizeInventoryLookup,
  summarizeNotebookLookup,
  summarizePurchaseRecommendation,
  summarizeCodexAgent,
  summarizeScienceResult,
  summarizeNotebookDraft,
  summarizeNotebookAppend,
  summarizeProtocolGeneration
} from './response/result-summaries.js';
