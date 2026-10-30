import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("agent");
import { asArray, trimText } from './shared.js';
import { renderAgentChatIcon } from './icons.js';
import { agentAttributes, agentFailure, agentMessage, agentUi } from './localization.js';

function sanitizeAttachmentName(fileName = '', fallback = 'attachment') {
  return trimText(String(fileName || '').replace(/\s+/g, ' ').trim(), 180) || fallback;
}

function formatAttachmentSize(size) {
  const numeric = Number(size);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '';
  }
  if (numeric >= 1024 * 1024) {
    return `${(numeric / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (numeric >= 1024) {
    return `${Math.round(numeric / 1024)} KB`;
  }
  return `${numeric} B`;
}

function estimateDataUrlSize(dataUrl = '') {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  if (!base64) {
    return 0;
  }
  const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function buildAttachmentSummary(attachments = []) {
  const items = asArray(attachments).filter((attachment) => trimText(attachment?.name, 180));
  if (!items.length) {
    return '';
  }
  const label = items.length === 1 ? 'attachment' : 'attachments';
  return `Please consider the attached ${label}: ${items.map((attachment) => trimText(attachment.name, 120)).join(', ')}.`;
}

export function buildMessagePayloadText(messageText, attachments = []) {
  const normalizedMessage = trimText(messageText, 3000);
  const attachmentSummary = buildAttachmentSummary(attachments);
  return trimText([normalizedMessage, attachmentSummary].filter(Boolean).join('\n\n'), 3000)
    || trimText(attachmentSummary, 3000);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file?.name || 'attachment'}.`));
    reader.readAsDataURL(file);
  });
}

export function createComposerAttachmentsController({
  attachmentInput,
  attachmentList,
  createId,
  safeText,
  setStatus
}) {
  let composerAttachments = [];

  function normalizeAttachmentRecord(source = {}) {
    const dataUrl = String(source?.dataUrl || source?.data_url || '').trim();
    const inferredMimeType = trimText(String(dataUrl).match(/^data:([^;,]+)/i)?.[1], 160);
    const mimeType = trimText(source?.mimeType || source?.mime_type, 160) || inferredMimeType;
    const kind = trimText(source?.kind, 40) || (mimeType.startsWith('image/') ? 'image' : 'file');
    return {
      ...source,
      id: trimText(source?.id, 120) || createId(),
      name: sanitizeAttachmentName(source?.name, kind === 'image' ? 'image.png' : 'attachment'),
      mimeType,
      size: Number.isFinite(Number(source?.size)) && Number(source.size) > 0
        ? Number(source.size)
        : estimateDataUrlSize(dataUrl),
      dataUrl,
      kind
    };
  }

  async function normalizeAttachmentFile(file) {
    const dataUrl = await fileToDataUrl(file);
    const mimeType = trimText(file?.type, 160) || trimText(String(dataUrl).match(/^data:([^;,]+)/i)?.[1], 160);
    return normalizeAttachmentRecord({
      name: sanitizeAttachmentName(file?.name, mimeType.startsWith('image/') ? 'image' : 'attachment'),
      mimeType,
      size: Number(file?.size) || 0,
      dataUrl
    });
  }

  function render() {
    if (!attachmentList) {
      return;
    }
    const items = asArray(composerAttachments).filter((attachment) => trimText(attachment?.name, 180));
    if (!items.length) {
      i18nUi.setHtml(attachmentList, '');
      attachmentList.hidden = true;
      return;
    }
    attachmentList.hidden = false;
    i18nUi.setHtml(attachmentList, items.map((attachment) => {
      const isImage = trimText(attachment?.kind, 20) === 'image';
      const size = formatAttachmentSize(attachment?.size);
      const dataUrl = trimText(attachment?.dataUrl, 500000);
      const thumbnail = isImage && dataUrl.startsWith('data:image/')
        ? `<img class="agent-attachment-thumb" src="${safeText(dataUrl)}" alt="" aria-hidden="true" />`
        : '';
      return `
        <span class="agent-attachment-pill${isImage ? ' is-image' : ''}">
          ${thumbnail}
          <span class="agent-attachment-pill-meta">
            <span>${agentMessage(isImage ? 'attachment.image' : 'attachment.file')}</span>
            <span>${safeText(trimText(attachment?.name, 180))}</span>
            ${size ? `<span>${safeText(size)}</span>` : ''}
          </span>
          <button type="button" data-agent-remove-attachment="${safeText(trimText(attachment?.id, 120))}" ${agentAttributes({ 'aria-label': 'attachment.remove' }, { name: trimText(attachment?.name, 180) })}>${renderAgentChatIcon('close', { className: 'agent-attachment-remove-icon' })}</button>
        </span>
      `;
    }).join(''));
  }

  function reset() {
    composerAttachments = [];
    if (attachmentInput) {
      attachmentInput.value = '';
    }
    render();
  }

  function addAttachment(attachment = {}, options = {}) {
    const normalized = normalizeAttachmentRecord(attachment);
    if (!trimText(normalized?.name, 180) || !trimText(normalized?.dataUrl, 500000)) {
      return null;
    }
    composerAttachments = [...composerAttachments, normalized].slice(-8);
    render();
    if (options.announce !== false) {
      setStatus(agentUi('status.attachmentsReady', { count: composerAttachments.length }));
    }
    return { ...normalized };
  }

  async function handleSelection(files = []) {
    const incomingFiles = asArray(Array.from(files)).filter(Boolean);
    if (!incomingFiles.length) {
      return;
    }
    try {
      const nextAttachments = await Promise.all(incomingFiles.map((file) => normalizeAttachmentFile(file)));
      composerAttachments = [...composerAttachments, ...nextAttachments].slice(-8);
        render();
        setStatus(agentUi('status.attachmentsReady', { count: composerAttachments.length }));
    } catch (error) {
      setStatus(agentFailure(error, 'status.attachmentsFailed'));
    }
  }

  function removeById(attachmentId = '') {
    const targetId = trimText(attachmentId, 120);
    if (!targetId) {
      return;
    }
    composerAttachments = composerAttachments.filter((attachment) => trimText(attachment?.id, 120) !== targetId);
    render();
  }

  return {
    addAttachment,
    getAttachments: () => asArray(composerAttachments).map((attachment) => ({ ...attachment })),
    handleSelection,
    removeById,
    render,
    reset
  };
}
