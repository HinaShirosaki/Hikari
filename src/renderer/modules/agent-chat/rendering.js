import { renderAgentHtml, mountAgentHtml } from './html-artifacts.js';
import { updateHistoryKeepingHtmlFrames } from './html-history.js';
import { renderAgentImages } from './image-artifacts.js';
import { renderSequenceActions } from '../sequence-viewer/mcp/action-rendering.js';
import { renderMarkdown } from './markdown.js';
import { renderUserAttachments } from './rendering-attachments.js';
import { renderEmptyHistory } from './rendering-empty-state.js';
import { renderAssistantMeta } from './rendering-meta.js';
import { renderAssistantGeneratedTrace } from './rendering-trace.js';
import { renderUserQuestionCard } from './rendering-question-card.js';
import { formatTime } from './rendering-time.js';
import { asArray, trimText } from './shared.js';
import { renderAgentChatIcon } from './icons.js';

export { updateHistoryKeepingHtmlFrames };

function getLiveStreamText(message) {
  const liveProgress = message?.meta?.live_progress && typeof message.meta.live_progress === 'object'
    ? message.meta.live_progress
    : null;
  if (!liveProgress) {
    return '';
  }
  return trimText(
    liveProgress.response_text
      || liveProgress.responseText
      || liveProgress.stream_text
      || liveProgress.streamText,
    120000
  );
}

function renderLiveActivityLine(message, safeText) {
  const rows = asArray(message?.meta?.live_progress?.activity_rows);
  const pending = rows.filter((row) => row?.status === 'pending').pop();
  const text = trimText(pending?.text, 240);
  if (!text) {
    return '';
  }
  return `<div class="agent-stream-activity agent-progress-flow-text">${safeText(text)}</div>`;
}

function renderAssistantMessageBody(message, safeText, { hasLiveProgress = false } = {}) {
  const liveStreamText = hasLiveProgress ? getLiveStreamText(message) : '';
  if (liveStreamText) {
    return `
      <div class="agent-chat-body agent-chat-markdown agent-stream-live">${renderMarkdown(liveStreamText, safeText)}</div>
      ${renderLiveActivityLine(message, safeText)}
    `;
  }
  if (hasLiveProgress) {
    return `<div class="agent-chat-body agent-chat-body-plain agent-progress-flow-text">${safeText(message.text || 'Working on this...')}</div>`;
  }
  return `<div class="agent-chat-body agent-chat-markdown">${renderMarkdown(message.text || '', safeText)}</div>`;
}

export function renderActiveUserQuestion(messages, safeText) {
  const safeMessages = asArray(messages);
  for (let index = safeMessages.length - 1; index >= 0; index -= 1) {
    const message = safeMessages[index];
    if (message?.role === 'user') {
      return '';
    }
    if (message?.role !== 'assistant') {
      continue;
    }
    const card = renderUserQuestionCard(message.meta, message.id, safeText);
    if (card) {
      return card;
    }
  }
  return '';
}

export function renderHistory({
  historyNode,
  messages,
  state,
  safeText,
  notebookDraftAdapter,
  protocolReviewAdapter,
  api = historyNode?.ownerDocument?.defaultView?.hikariApi,
  showUserQuestions = true
}) {
  const safeMessages = asArray(messages);
  if (!safeMessages.length) {
    renderEmptyHistory({ historyNode, state, safeText });
    return;
  }

  const markup = safeMessages.map((message, index) => {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const headerLabel = role === 'assistant' ? 'Hikari' : 'You';
    const cardClass = role === 'assistant' ? 'agent-chat-item-assistant' : 'agent-chat-item-user';
    const rowClass = role === 'assistant' ? 'agent-chat-row-assistant' : 'agent-chat-row-user';
    const hasLiveProgress = Boolean(message?.meta?.live_progress && typeof message.meta.live_progress === 'object');
    const timestamp = formatTime(message.createdAt);
    const assistantGeneratedTrace = role === 'assistant'
      ? (hasLiveProgress ? '' : renderAssistantGeneratedTrace(message.meta, safeText, message.text || ''))
      : '';
    const assistantMeta = role === 'assistant'
      ? renderAssistantMeta(message.meta, message.id, {
        safeText,
        notebookDraftAdapter,
        protocolReviewAdapter,
        notebookEntries: state.notebookEntries,
        canAnswerQuestion: !safeMessages.slice(index + 1).some((item) => item?.role === 'user'),
        showUserQuestion: showUserQuestions
      })
      : '';
    const messageBody = role === 'assistant'
      ? renderAssistantMessageBody(message, safeText, { hasLiveProgress })
      : `<p class="agent-chat-body agent-chat-body-plain">${safeText(message.text || '')}</p>`;
    return `
      <div data-agent-render-key="${safeText(`${state.agentChat?.currentSessionId || ''}:${index}:${message.meta?.html_artifacts?.[0]?.id || message.id || ''}`)}" class="agent-chat-row ${rowClass}${hasLiveProgress ? ' is-live' : ''}">
        <article class="agent-chat-item ${cardClass}${message.meta?.parser?.clarification_reason === 'agent_error' ? ' is-error' : ''}" aria-label="${role === 'assistant' ? 'Hikari response' : 'Your message'}">
          <header class="agent-chat-header${role === 'user' ? ' sr-only' : ''}">
            <div class="agent-chat-header-copy">
              <strong>${headerLabel}</strong>
            </div>
            <time class="agent-chat-time">${safeText(timestamp)}</time>
          </header>
          ${assistantGeneratedTrace}
          ${messageBody}
          ${role === 'assistant' ? renderAgentImages(message.meta, safeText) : ''}
          ${role === 'assistant' ? renderAgentHtml(message.meta, safeText) : ''}
          ${role === 'user' ? renderUserAttachments(message.attachments, safeText) : ''}
          ${assistantMeta}
          ${role === 'assistant' ? renderSequenceActions(message.meta, safeText) : ''}
          ${role === 'assistant' && !hasLiveProgress && trimText(message.text) && message.id ? `
            <footer class="agent-message-actions">
              <button type="button" class="ghost-btn agent-message-copy" data-agent-copy-message="${safeText(message.id)}" aria-label="Copy response" title="Copy response">
                ${renderAgentChatIcon('copy', { className: 'agent-message-copy-icon' })}
              </button>
            </footer>` : ''}
        </article>
      </div>
    `;
  }).join('');
  updateHistoryKeepingHtmlFrames(historyNode, markup);
  mountAgentHtml(historyNode, safeMessages, api);

}
