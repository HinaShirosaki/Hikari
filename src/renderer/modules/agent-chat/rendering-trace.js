import { collectAssistantGeneratedTraceRows } from './rendering-trace-rows.js';

function renderCollapsibleThinkingTrace(title, rows, safeText, { open = false } = {}) {
  if (!rows.length) {
    return '';
  }
  return `
    <details
      class="agent-thinking-trace"
      ${open ? 'open ' : ''}
      data-agent-generated-trace="true"
      data-agent-trace-open="${open ? 'true' : 'false'}"
      aria-label="${safeText(title)}"
    >
      <summary class="agent-thinking-trace-summary">${safeText(title)}</summary>
      <ul class="agent-thinking-trace-list">
        ${rows.map((row) => `<li class="agent-thinking-trace-item">${safeText(row)}</li>`).join('')}
      </ul>
    </details>
  `;
}

function renderLiveGeneratedTrace(rows, safeText) {
  if (!rows.length) {
    return '';
  }
  return `
    <div class="agent-thinking-trace agent-generated-trace-live" aria-label="Agent Trace">
      <ul class="agent-thinking-trace-list">
        ${rows.map((row) => `<li class="agent-thinking-trace-item"><span class="agent-progress-flow-text">${safeText(row)}</span></li>`).join('')}
      </ul>
    </div>
  `;
}

export function renderAssistantGeneratedTrace(meta, safeText, finalText = '') {
  const rows = collectAssistantGeneratedTraceRows(meta, finalText);
  if (!rows.length) {
    return '';
  }
  const isLive = Boolean(meta?.live_progress && typeof meta.live_progress === 'object');
  if (isLive) {
    return renderLiveGeneratedTrace(rows, safeText);
  }
  return renderCollapsibleThinkingTrace('Agent Trace', rows, safeText, { open: false });
}
