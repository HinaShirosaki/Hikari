import { asArray, trimText } from './shared.js';

export function renderUserAttachments(attachments, safeText) {
  const items = asArray(attachments).filter((attachment) => trimText(attachment?.name, 240));
  if (!items.length) {
    return '';
  }
  return `
    <div class="agent-attachment-list">
      ${items.map((attachment) => `
        <span class="agent-attachment-pill${trimText(attachment?.kind, 20) === 'image' ? ' is-image' : ''}">
          <span>${safeText(trimText(attachment?.kind, 20) === 'image' ? 'Image' : 'File')}</span>
          <span>${safeText(trimText(attachment?.name, 240))}</span>
        </span>
      `).join('')}
    </div>
  `;
}
