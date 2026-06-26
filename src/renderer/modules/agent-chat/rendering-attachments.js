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
          ${trimText(attachment?.kind, 20) === 'image' && trimText(attachment?.dataUrl, 500000).startsWith('data:image/')
            ? `<img class="agent-attachment-thumb" src="${safeText(trimText(attachment.dataUrl, 500000))}" alt="" aria-hidden="true" />`
            : ''}
          <span class="agent-attachment-pill-meta">
            <span>${safeText(trimText(attachment?.kind, 20) === 'image' ? 'Image' : 'File')}</span>
            <span>${safeText(trimText(attachment?.name, 240))}</span>
          </span>
        </span>
      `).join('')}
    </div>
  `;
}
