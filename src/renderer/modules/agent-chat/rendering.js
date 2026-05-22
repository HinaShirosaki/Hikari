import { renderMarkdown } from './markdown.js';
import { renderUserAttachments } from './rendering-attachments.js';
import { renderEmptyHistory } from './rendering-empty-state.js';
import { renderAssistantMeta } from './rendering-meta.js';
import { renderAssistantGeneratedTrace } from './rendering-trace.js';
import { formatTime } from './rendering-time.js';
import { asArray } from './shared.js';

export function renderHistory({ historyNode, messages, state, safeText }) {
  const safeMessages = asArray(messages);
  if (!safeMessages.length) {
    renderEmptyHistory({ historyNode, state, safeText });
    return;
  }

  historyNode.innerHTML = safeMessages.map((message, index) => {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const headerLabel = role === 'assistant' ? 'Assistant' : 'You';
    const cardClass = role === 'assistant' ? 'agent-chat-item-assistant' : 'agent-chat-item-user';
    const rowClass = role === 'assistant' ? 'agent-chat-row-assistant' : 'agent-chat-row-user';
    const hasLiveProgress = Boolean(message?.meta?.live_progress && typeof message.meta.live_progress === 'object');
    const timestamp = formatTime(message.createdAt);
    const assistantGeneratedTrace = role === 'assistant'
      ? renderAssistantGeneratedTrace(message.meta, safeText, hasLiveProgress ? '' : (message.text || ''))
      : '';
    const assistantMeta = role === 'assistant'
      ? renderAssistantMeta(message.meta, message.id, {
        state,
        safeText,
        canAnswerQuestion: !safeMessages.slice(index + 1).some((item) => item?.role === 'user')
      })
      : '';
    const messageBody = role === 'assistant'
      ? `<div class="agent-chat-body agent-chat-markdown">${renderMarkdown(message.text || '', safeText)}</div>`
      : `<p class="agent-chat-body agent-chat-body-plain">${safeText(message.text || '')}</p>`;
    const liveGeneratedTrace = hasLiveProgress ? assistantGeneratedTrace : '';
    const completedGeneratedTrace = hasLiveProgress ? '' : assistantGeneratedTrace;
    return `
      <div class="agent-chat-row ${rowClass}${hasLiveProgress ? ' is-live' : ''}">
        <div class="agent-chat-identity" aria-hidden="true">
          <span class="agent-chat-avatar agent-chat-avatar-${role}">${role === 'assistant' ? 'AI' : 'You'}</span>
        </div>
        <article class="agent-chat-item ${cardClass}">
          <header class="agent-chat-header">
            <div class="agent-chat-header-copy">
              <strong>${headerLabel}</strong>
              ${hasLiveProgress ? '<span class="agent-live-pill">Working</span>' : ''}
            </div>
            <span>${safeText(timestamp)}</span>
          </header>
          ${liveGeneratedTrace}
          ${messageBody}
          ${completedGeneratedTrace}
          ${role === 'user' ? renderUserAttachments(message.attachments, safeText) : ''}
          ${assistantMeta}
        </article>
      </div>
    `;
  }).join('');

  historyNode.querySelectorAll('details[data-agent-generated-trace="true"]').forEach((traceNode) => {
    traceNode.open = traceNode?.dataset?.agentTraceOpen === 'true';
  });
}
