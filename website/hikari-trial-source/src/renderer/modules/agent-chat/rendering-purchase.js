import { asArray, trimText } from './shared.js';

export function renderPurchaseRecommendationCards(purchaseRecommendation, safeText) {
  const payload = purchaseRecommendation && typeof purchaseRecommendation === 'object' ? purchaseRecommendation : {};
  const items = asArray(payload.items).filter((item) => (
    trimText(item?.title, 320)
    && trimText(item?.vendor, 220)
    && trimText(item?.price_text, 120)
    && trimText(item?.image_url, 2000)
    && trimText(item?.product_url, 2000)
  ));
  if (!items.length) {
    return '';
  }
  return `
    <section class="agent-purchase-group" aria-label="Purchase recommendations">
      <div class="agent-purchase-grid">
        ${items.map((item) => `
          <button
            type="button"
            class="agent-purchase-item"
            data-agent-open-external-url="${safeText(trimText(item.product_url, 2000))}"
            aria-label="${safeText(`Open ${trimText(item.title, 220)} from ${trimText(item.vendor, 180)}`)}"
          >
            <span class="agent-purchase-image-wrap">
              <img
                class="agent-purchase-image"
                src="${safeText(trimText(item.image_url, 2000))}"
                alt="${safeText(trimText(item.title, 220))}"
              />
            </span>
            <span class="agent-purchase-copy">
              <strong class="agent-purchase-title">${safeText(trimText(item.title, 220))}</strong>
              <span class="agent-purchase-price">${safeText(trimText(item.price_text, 120))}</span>
              <span class="agent-purchase-vendor">${safeText(trimText(item.vendor, 180))}</span>
            </span>
          </button>
        `).join('')}
      </div>
    </section>
  `;
}
