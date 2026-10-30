import { toolMessage } from '../localization.js';

// UI presentation only. Marker filtering and model results stay in the controller.
export function colonySummaryMarkup({ count, total, hasMask, lastCountSource }) {
  const key = lastCountSource === 'model' ? 'colony.modelCount' : 'colony.manualCount';
  const maskNote = hasMask && total !== count
    ? `<p class="small-note">${toolMessage('colony.maskSummary', { inside: count, count: total })}</p>` : '';
  return `<p><strong>${toolMessage(key)}</strong> ${count}</p>${maskNote}`;
}
