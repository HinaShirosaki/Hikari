import { createNotebookHistoryActions } from './history-notebook-actions.js';
import { trimText } from './shared.js';

export function createHistoryActionController({
  api,
  state,
  input,
  createId,
  persist,
  setStatus,
  syncComposerHeight,
  renderContextSummary,
  renderHistoryView,
  answerAssistantQuestion,
  onNotebookEntriesChanged,
  onOpenNotebookEntry
}) {
  const notebookActions = createNotebookHistoryActions({
    state,
    persist,
    createId,
    setStatus,
    renderContextSummary,
    renderHistoryView,
    onNotebookEntriesChanged,
    onOpenNotebookEntry
  });

  async function onHistoryClick(event) {
    const suggestedPromptButton = event?.target?.closest?.('[data-agent-suggest-prompt]')
      || (event?.target?.dataset?.agentSuggestPrompt ? event.target : null);
    if (suggestedPromptButton) {
      const prompt = trimText(suggestedPromptButton.dataset.agentSuggestPrompt, 3000);
      if (!prompt) {
        return;
      }
      input.value = prompt;
      syncComposerHeight();
      input.focus();
      setStatus('Prompt ready.');
      return;
    }

    const questionOptionButton = event?.target?.closest?.('[data-agent-question-option]')
      || (event?.target?.dataset?.agentQuestionOption ? event.target : null);
    if (questionOptionButton) {
      const messageId = trimText(questionOptionButton.dataset.agentQuestionOption, 120);
      const answer = trimText(questionOptionButton.dataset.agentQuestionAnswer, 3000)
        || trimText(questionOptionButton.textContent, 3000);
      await answerAssistantQuestion(messageId, answer);
      return;
    }

    const questionSubmitButton = event?.target?.closest?.('[data-agent-question-submit]')
      || (event?.target?.dataset?.agentQuestionSubmit ? event.target : null);
    if (questionSubmitButton) {
      const messageId = trimText(questionSubmitButton.dataset.agentQuestionSubmit, 120);
      const card = questionSubmitButton.closest?.('[data-agent-user-question-card]');
      const answerInput = card?.querySelector?.('[data-agent-question-custom-input]');
      await answerAssistantQuestion(messageId, trimText(answerInput?.value, 3000));
      return;
    }

    const externalButton = event?.target?.closest?.('[data-agent-open-external-url]')
      || (event?.target?.dataset?.agentOpenExternalUrl ? event.target : null);
    if (externalButton) {
      const url = trimText(externalButton.dataset.agentOpenExternalUrl, 2000);
      if (!url) {
        return;
      }
      if (!api?.openExternalUrl) {
        setStatus('External link opening is unavailable in this build.');
        return;
      }
      const result = await api.openExternalUrl(url);
      setStatus(result?.ok === true ? 'Opened product page.' : (trimText(result?.error, 320) || 'Failed to open product page.'));
      return;
    }

    const openNotebookButton = event?.target?.closest?.('[data-agent-open-notebook-page]')
      || (event?.target?.dataset?.agentOpenNotebookPage ? event.target : null);
    if (openNotebookButton) {
      notebookActions.openNotebookPage(openNotebookButton.dataset.agentOpenNotebookPage);
      return;
    }

    const createButton = event?.target?.closest?.('[data-agent-create-planned-page]')
      || (event?.target?.dataset?.agentCreatePlannedPage ? event.target : null);
    if (createButton) {
      notebookActions.createPlannedPage(createButton.dataset.agentCreatePlannedPage);
    }
  }

  return { onHistoryClick };
}
