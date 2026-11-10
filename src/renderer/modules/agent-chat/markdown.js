import { renderMarkdown as renderDocumentMarkdown } from '../../lib/markdown.js';
import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("agent");

// A remote image URL written by the model can carry chat data to any host, so
// images load only after the user clicks their placeholder. Loaded URLs stay
// loaded across re-renders for the rest of the session.
const allowedImageUrls = new Set();

export function allowChatImage(url) {
  allowedImageUrls.add(String(url || ''));
}

function renderChatImage(alt, src, safeText) {
  let imageUrl;
  try {
    imageUrl = new URL(src.replace(/^<|>$/g, ''));
  } catch {
    return safeText(alt);
  }
  if (!/^https?:$/.test(imageUrl.protocol)) {
    return safeText(alt);
  }
  if (!allowedImageUrls.has(imageUrl.href)) {
    return (
      `<button type="button" class="agent-chat-image-placeholder" data-agent-load-image="${safeText(imageUrl.href)}" data-agent-image-alt="${safeText(alt)}" title="${safeText(imageUrl.href)}">${i18nUi.html("Load image")}${alt ? `: ${safeText(alt)}` : ''} <span>(${safeText(imageUrl.host)})</span></button>`
    );
  }
  return (
    `<img class="agent-chat-inline-image" src="${safeText(imageUrl.href)}" alt="${safeText(alt)}" referrerpolicy="no-referrer" decoding="async" />`
  );
}

export function renderMarkdown(text, safeText, options = {}) {
  return renderDocumentMarkdown(text, safeText, { ...options, classPrefix: 'agent-chat', renderImage: renderChatImage });
}
