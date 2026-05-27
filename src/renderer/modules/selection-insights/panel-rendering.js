import { ACTION_WHAT_IS_IT, ACTION_WHERE_TO_BUY } from './constants.js';
import {
  asArray,
  cleanText,
  escapeAttribute,
  escapeHtml,
  formatAnswerText,
  normalizeActionLabel
} from './text-utils.js';

export function buildPanelPurchaseCards(answer) {
  const payload = answer?.payload && typeof answer.payload === 'object'
    ? answer.payload
    : {};
  const items = asArray(payload.items)
    .filter((item) => item && typeof item === 'object')
    .filter((item) => cleanText(item.title, 240) && cleanText(item.vendor, 180))
    .slice(0, 6);
  if (!items.length) {
    return '';
  }
  return `
    <section class="selection-insight-answer-block">
      <section class="agent-purchase-group" aria-label="Purchase recommendations">
        <div class="agent-purchase-grid">
          ${items.map((item) => {
            const url = cleanText(item.product_url, 2000);
            const imageUrl = cleanText(item.image_url, 2000);
            const itemContent = `
              ${imageUrl ? `
                <span class="agent-purchase-image-wrap">
                  <img
                    class="agent-purchase-image"
                    src="${escapeAttribute(imageUrl)}"
                    alt="${escapeAttribute(cleanText(item.title, 220))}"
                  />
                </span>
              ` : ''}
              <span class="agent-purchase-copy">
                <strong class="agent-purchase-title">${escapeHtml(cleanText(item.title, 220))}</strong>
                ${cleanText(item.price_text, 120) ? `<span class="agent-purchase-price">${escapeHtml(cleanText(item.price_text, 120))}</span>` : ''}
                <span class="agent-purchase-vendor">${escapeHtml(cleanText(item.vendor, 180))}</span>
              </span>
            `;
            if (url) {
              return `
                <button
                  type="button"
                  class="agent-purchase-item"
                  data-selection-insight-open-url="${escapeAttribute(url)}"
                  aria-label="${escapeAttribute(`Open ${cleanText(item.title, 220)} from ${cleanText(item.vendor, 180)}`)}"
                >
                  ${itemContent}
                </button>
              `;
            }
            return `
              <div class="agent-purchase-item selection-insight-purchase-static">
                ${itemContent}
              </div>
            `;
          }).join('')}
        </div>
      </section>
    </section>
  `;
}

export function buildPanelHtml(insight) {
  if (!insight) {
    return `
      <div class="selection-insight-panel-empty">
        <p>No saved answer yet.</p>
      </div>
    `;
  }

  const whatIsIt = insight.answers?.[ACTION_WHAT_IS_IT];
  const whereToBuy = insight.answers?.[ACTION_WHERE_TO_BUY];
  const pendingAction = [whatIsIt, whereToBuy].find((answer) => cleanText(answer?.status, 40) === 'pending');
  const errorAction = [whatIsIt, whereToBuy].find((answer) => cleanText(answer?.status, 40) === 'error');

  return `
    <div class="selection-insight-panel-head">
      <span class="selection-insight-panel-kicker">Saved Answer</span>
      <h4>${escapeHtml(cleanText(insight.selectedText, 220) || 'Selected text')}</h4>
      ${cleanText(insight.segmentLabel, 120)
        ? `<p class="selection-insight-panel-meta">${escapeHtml(cleanText(insight.segmentLabel, 120))}</p>`
        : ''}
    </div>
    ${pendingAction ? `
      <div class="selection-insight-answer-block is-pending">
        <h5>${escapeHtml(normalizeActionLabel(pendingAction.actionType))}</h5>
        <p>Thinking about this selection...</p>
      </div>
    ` : ''}
    ${whatIsIt && cleanText(whatIsIt.status, 40) === 'completed' && cleanText(whatIsIt.text, 12000) ? `
      <section class="selection-insight-answer-block">
        <h5>${escapeHtml(normalizeActionLabel(ACTION_WHAT_IS_IT))}</h5>
        <div class="selection-insight-answer-copy">${formatAnswerText(whatIsIt.text)}</div>
      </section>
    ` : ''}
    ${whereToBuy && cleanText(whereToBuy.status, 40) === 'completed' && cleanText(whereToBuy.summary, 12000) ? `
      <section class="selection-insight-answer-block">
        <h5>${escapeHtml(normalizeActionLabel(ACTION_WHERE_TO_BUY))}</h5>
        <div class="selection-insight-answer-copy">${formatAnswerText(whereToBuy.summary)}</div>
      </section>
    ` : ''}
    ${whereToBuy && cleanText(whereToBuy.status, 40) === 'completed' ? buildPanelPurchaseCards(whereToBuy) : ''}
    ${errorAction && cleanText(errorAction.error, 1200) ? `
      <div class="selection-insight-answer-block is-error">
        <h5>${escapeHtml(normalizeActionLabel(errorAction.actionType))}</h5>
        <p>${escapeHtml(cleanText(errorAction.error, 1200))}</p>
      </div>
    ` : ''}
  `;
}
