import { renderPurchaseRecommendationCards } from './rendering-purchase.js';
import {
  collectPythonSandboxRuns,
  collectRenderablePythonSandboxOutput,
  renderPythonSandboxRuns
} from './rendering-python.js';
import { renderUserQuestionCard } from './rendering-question-card.js';
import { renderDraftCards } from './rendering-drafts.js';
import { asArray, trimText } from './shared.js';

export function renderAssistantMeta(meta, messageId = '', {
  safeText,
  notebookDraftAdapter,
  protocolReviewAdapter,
  notebookEntries = [],
  canAnswerQuestion = true,
  showUserQuestion = true
}) {
  if (!meta || typeof meta !== 'object') {
    return '';
  }
  const liveProgress = meta.live_progress && typeof meta.live_progress === 'object'
    ? meta.live_progress
    : null;
  const toolTest = meta.tool_test && typeof meta.tool_test === 'object'
    ? meta.tool_test
    : null;
  if (toolTest) {
    const toolItems = asArray(toolTest.items);
    const runMode = trimText(toolTest.run_mode, 40) || (toolItems.length === 1 ? 'single' : 'all');
    const primaryItem = runMode === 'single' ? (toolItems[0] && typeof toolItems[0] === 'object' ? toolItems[0] : null) : null;
    const pythonSandboxRuns = primaryItem && trimText(primaryItem.tool_name, 120) === 'python-sandbox'
      ? [{ label: 'Manual tool test', ...collectRenderablePythonSandboxOutput(primaryItem.raw_result) }]
      : [];
    if (!pythonSandboxRuns.length) {
      return '';
    }
    return `<div class="agent-meta-grid agent-meta-grid-streamlined">${renderPythonSandboxRuns(pythonSandboxRuns, safeText)}</div>`;
  }
  if (liveProgress) {
    return '';
  }

  const hasPurchaseRecommendation = meta.purchase_recommendation && typeof meta.purchase_recommendation === 'object';
  const userQuestionCard = showUserQuestion
    ? renderUserQuestionCard(meta, messageId, safeText, {
      disabled: canAnswerQuestion !== true
    })
    : '';
  const sections = [
    userQuestionCard,
    hasPurchaseRecommendation ? renderPurchaseRecommendationCards(meta.purchase_recommendation, safeText) : '',
    renderPythonSandboxRuns(collectPythonSandboxRuns(meta), safeText),
    renderDraftCards(meta, messageId, { safeText, notebookDraftAdapter, protocolReviewAdapter, notebookEntries })
  ].filter(Boolean);
  if (!sections.length) {
    return '';
  }
  return `<div class="agent-meta-grid agent-meta-grid-streamlined">${sections.join('')}</div>`;
}
