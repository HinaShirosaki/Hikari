import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("agent");
import { collectAssistantGeneratedTraceRows } from './rendering-trace-rows.js';

function renderCollapsibleThinkingTrace(title, rows, { open = false } = {}) {
  if (!rows.length) {
    return '';
  }
  return `
    <details
      class="agent-thinking-trace"
      ${open ? 'open ' : ''}
      data-agent-generated-trace="true"
      data-agent-trace-open="${open ? 'true' : 'false'}"
      ${i18nUi.attributeMessage("aria-label", i18nUi.owned(title))}
    >
      <summary class="agent-thinking-trace-summary">${i18nUi.html("Activity")} <span class="agent-activity-count">· ${rows.length} ${i18nUi.render((rows.length === 1 ? i18nUi.message("update") : i18nUi.message("updates")))}</span></summary>
      <ul class="agent-thinking-trace-list">
        ${rows.map((row) => `<li class="agent-thinking-trace-item">${i18nUi.renderOwned(row)}</li>`).join('')}
      </ul>
    </details>
  `;
}

function renderLiveGeneratedTrace(rows) {
  if (!rows.length) {
    return '';
  }
  return `
    <div class="agent-thinking-trace agent-generated-trace-live" ${i18nUi.attribute("aria-label", "Agent Trace")}>
      <ul class="agent-thinking-trace-list">
        ${rows.map((row) => `<li class="agent-thinking-trace-item"><span class="agent-progress-flow-text">${i18nUi.renderOwned(row)}</span></li>`).join('')}
      </ul>
    </div>
  `;
}

export function renderAssistantGeneratedTrace(meta, _safeText, finalText = '') {
  const rows = collectAssistantGeneratedTraceRows(meta, finalText);
  if (!rows.length) {
    return '';
  }
  const isLive = Boolean(meta?.live_progress && typeof meta.live_progress === 'object');
  if (isLive) {
    return renderLiveGeneratedTrace(rows);
  }
  return renderCollapsibleThinkingTrace('Agent Trace', rows, { open: false });
}
