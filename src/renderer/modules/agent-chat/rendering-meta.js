import { renderPurchaseRecommendationCards } from './rendering-purchase.js';
import {
  collectPythonSandboxRuns,
  collectRenderablePythonSandboxOutput,
  renderPythonSandboxRuns
} from './rendering-python.js';
import { renderUserQuestionCard } from './rendering-question-card.js';
import { asArray, trimText } from './shared.js';

export function renderAssistantMeta(meta, messageId = '', {
  safeText,
  notebookDraftAdapter,
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

  const notebookDraft = notebookDraftAdapter?.normalizeDraft?.(meta.notebookDraft) || null;
  const existingNotebookEntry = notebookDraftAdapter?.findEntryForDraft?.(notebookDraft) || null;
  const hasMessageId = Boolean(trimText(messageId, 120));
  const showCreatePlannedPageButton = Boolean(
    notebookDraft
    && notebookDraft?.save?.mode === 'confirm_before_save'
    && notebookDraft?.save?.applied !== true
    && trimText(notebookDraft?.save?.status, 80) !== 'rejected'
    && hasMessageId
    && !existingNotebookEntry
  );
  const showOpenNotebookPageButton = Boolean(notebookDraft && existingNotebookEntry && hasMessageId);
  const notebookAppend = meta.notebookAppend && typeof meta.notebookAppend === 'object'
    ? meta.notebookAppend
    : (meta.notebook_append && typeof meta.notebook_append === 'object' ? meta.notebook_append : null);
  const showReviewNotebookAppendButton = Boolean(
    notebookAppend?.proposal?.content_markdown
    && notebookAppend?.save?.mode === 'confirm_before_append'
    && notebookAppend?.save?.applied !== true
    && trimText(notebookAppend?.save?.status, 80) !== 'rejected'
    && hasMessageId
  );
  const notebookAppendProposal = notebookAppend?.proposal || {};
  const notebookAppendSources = asArray(notebookAppendProposal.sources).map((source) => {
    const label = trimText(source?.label || source?.record_id || source?.url, 320);
    const detail = trimText(source?.detail, 420);
    return [label, detail].filter(Boolean).join(' — ');
  }).filter(Boolean);
  const openNotebookButtonLabel = notebookDraftAdapter?.normalizeState?.(existingNotebookEntry?.notebookState) === 'planned'
    ? 'Open Planned Page'
    : 'Open Notebook Page';
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
    showReviewNotebookAppendButton ? `
      <section class="agent-notebook-append-card">
        <div class="agent-notebook-append-card__header">
          <strong>${safeText(trimText(notebookAppendProposal.section_title, 220) || 'Suggested notebook enrichment')}</strong>
          <span>Review before appending</span>
        </div>
        ${notebookAppendProposal.rationale ? `<p>${safeText(notebookAppendProposal.rationale)}</p>` : ''}
        <pre class="agent-review-append-text">${safeText(notebookAppendProposal.content_markdown)}</pre>
        ${notebookAppendSources.length ? `
          <div class="agent-notebook-append-card__sources">
            <span>Sources</span>
            <ul>${notebookAppendSources.map((source) => `<li>${safeText(source)}</li>`).join('')}</ul>
          </div>
        ` : ''}
        <div class="agent-notebook-append-card__actions">
          <button
            type="button"
            class="primary-btn"
            data-agent-append-notebook="${safeText(trimText(messageId, 120))}"
          >
            Append to Page
          </button>
          <button
            type="button"
            class="ghost-btn"
            data-agent-reject-notebook-append="${safeText(trimText(messageId, 120))}"
          >
            Reject
          </button>
        </div>
      </section>
    ` : '',
    showCreatePlannedPageButton ? `
      <section class="agent-draft-actions">
        <button
          type="button"
          class="primary-btn"
          data-agent-create-planned-page="${safeText(trimText(messageId, 120))}"
        >
          Create Planned Page
        </button>
      </section>
    ` : '',
    showOpenNotebookPageButton ? `
      <section class="agent-draft-actions">
        <button
          type="button"
          class="ghost-btn"
          data-agent-open-notebook-page="${safeText(trimText(messageId, 120))}"
        >
          ${safeText(openNotebookButtonLabel)}
        </button>
      </section>
    ` : ''
  ].filter(Boolean);
  if (!sections.length) {
    return '';
  }
  return `<div class="agent-meta-grid agent-meta-grid-streamlined">${sections.join('')}</div>`;
}
