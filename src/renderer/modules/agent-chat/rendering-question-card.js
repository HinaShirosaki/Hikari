import { asArray, normalizeAgentUserQuestion, trimText } from './shared.js';

export function renderUserQuestionCard(meta, messageId = '', safeText, { disabled = false } = {}) {
  const explicitUserQuestion = meta?.user_question
    || meta?.userQuestion
    || meta?.codex_agent?.user_question
    || meta?.codex_agent?.userQuestion;
  const codexStatus = trimText(meta?.codex_agent?.status, 40);
  const keepUserQuestion = Boolean(
    explicitUserQuestion
    && (
      codexStatus === 'needs_more_info'
      || codexStatus === 'needs_user_answer'
      || (!meta?.codex_agent && meta?.parser?.needs_clarification === true)
    )
  );
  const question = keepUserQuestion
    ? normalizeAgentUserQuestion(explicitUserQuestion, '')
    : null;
  if (!question) {
    return '';
  }
  const answeredText = trimText(question.answered?.answer, 1000);
  const messageKey = trimText(messageId, 120);
  const controlsDisabled = disabled || Boolean(answeredText) || !messageKey;
  const disabledAttr = controlsDisabled ? ' disabled' : '';
  const options = asArray(question.options);
  return `
    <section
      class="agent-user-question-card${controlsDisabled ? ' is-disabled' : ''}"
      data-agent-user-question-card="${safeText(messageKey)}"
      aria-label="Clarification question"
    >
      <p class="agent-user-question-kicker">Clarification Needed</p>
      <h4>${safeText(question.question)}</h4>
      ${question.context ? `<p class="agent-user-question-context">${safeText(question.context)}</p>` : ''}
      ${options.length ? `
        <div class="agent-user-question-options">
          ${options.map((option) => `
            <button
              type="button"
              class="agent-user-question-option"
              data-agent-question-option="${safeText(messageKey)}"
              data-agent-question-answer="${safeText(option.value)}"
              ${disabledAttr}
            >
              <span>${safeText(option.label)}</span>
              ${option.description ? `<small>${safeText(option.description)}</small>` : ''}
            </button>
          `).join('')}
        </div>
      ` : ''}
      ${question.allow_custom ? `
        <div class="agent-user-question-custom">
          <textarea
            rows="2"
            data-agent-question-custom-input="${safeText(messageKey)}"
            placeholder="${safeText(question.placeholder)}"
            ${disabledAttr}
          ></textarea>
          <button
            type="button"
            class="primary-btn"
            data-agent-question-submit="${safeText(messageKey)}"
            ${disabledAttr}
          >
            ${safeText(question.submit_label)}
          </button>
        </div>
      ` : ''}
      ${answeredText ? `<p class="agent-user-question-answer">Answered: ${safeText(answeredText)}</p>` : ''}
      ${!answeredText && disabled ? '<p class="agent-user-question-answer">This thread has already continued.</p>' : ''}
    </section>
  `;
}
