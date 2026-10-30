import { asArray, normalizeAgentUserQuestion, trimText } from './shared.js';

export function createAssistantQuestionController({
  api,
  state,
  input,
  setStatus,
  persist,
  renderHistoryView,
  syncComposerHeight,
  isInFlight,
  sendMessage
}) {
  function findChatMessageById(messageId = '') {
    const targetId = trimText(messageId, 120);
    if (!targetId) {
      return null;
    }
    return asArray(state.agentChat.messages).find((item) => trimText(item?.id, 120) === targetId) || null;
  }

  function getAssistantUserQuestion(message) {
    const meta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
    const explicitUserQuestion = meta.user_question
      || meta.userQuestion
      || meta.codex_agent?.user_question
      || meta.codex_agent?.userQuestion;
    const codexStatus = trimText(meta.codex_agent?.status, 40);
    const keepUserQuestion = Boolean(
      explicitUserQuestion
      && trimText(explicitUserQuestion?.status, 40).toLowerCase() !== 'answered'
      && !trimText(explicitUserQuestion?.answered?.answer, 1000)
      && (
        codexStatus === 'needs_more_info'
        || codexStatus === 'needs_user_answer'
        || (!meta.codex_agent && meta.parser?.needs_clarification === true)
      )
    );
    return keepUserQuestion ? normalizeAgentUserQuestion(explicitUserQuestion, '') : null;
  }

  function markAssistantQuestionAnswered(messageId, answerText) {
    const message = findChatMessageById(messageId);
    const question = getAssistantUserQuestion(message);
    if (!message || !question) {
      return null;
    }
    const answeredQuestion = {
      ...question,
      status: 'answered',
      answered: {
        answer: trimText(answerText, 1000),
        answered_at: new Date().toISOString()
      }
    };
    message.meta = {
      ...(message.meta && typeof message.meta === 'object' ? message.meta : {}),
      user_question: answeredQuestion
    };
    if (message.meta.codex_agent && typeof message.meta.codex_agent === 'object') {
      message.meta.codex_agent = {
        ...message.meta.codex_agent,
        user_question: answeredQuestion
      };
    }
    return answeredQuestion;
  }

  async function answerAssistantQuestion(messageId, answerText) {
    if (isInFlight()) {
      return;
    }
    if (!api?.agentChat) {
      setStatus('Agent IPC is unavailable.');
      return;
    }
    const answer = trimText(answerText, 3000);
    if (!answer) {
      setStatus('Add an answer first.');
      return;
    }
    const question = markAssistantQuestionAnswered(messageId, answer);
    if (!question) {
      setStatus('Question is unavailable.');
      return;
    }
    persist();
    renderHistoryView({ forceScroll: true });
    input.value = answer;
    syncComposerHeight();
    await sendMessage();
  }

  return {
    answerAssistantQuestion,
    findChatMessageById,
    getAssistantUserQuestion,
    markAssistantQuestionAnswered
  };
}
