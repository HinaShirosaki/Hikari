import { samplesSpanish } from './locales/es.js';
import { createPresentation } from '../../lib/i18n/presentation.js';
const statusPresentation = createPresentation('samples');
import { i18n } from '../../lib/i18n/index.js';
import { messageSpan, messageAttributes } from '../../lib/i18n/markup.js';
import { setTranslatedText, setTranslatedAttribute } from '../../lib/i18n/dom.js';
import { getContainerLayout, normalizeContainerType } from '../../lib/inventory-containers.js';
import { samplesEnglish } from './locales/en.js';
import { escapeHtml } from '../../lib/html.js';
import { showTransientNotice } from '../../lib/notify.js';

i18n.registerMessages('en', 'samples', samplesEnglish);
i18n.registerMessages('es', 'samples', samplesSpanish);
export const sampleText = i18n.scope('samples');
export const sampleMessage = (key, params) => messageSpan(`samples.${key}`, params);
export const sampleAttributes = (bindings, params) => messageAttributes(
  Object.fromEntries(Object.entries(bindings).map(([attribute, key]) => [attribute, `samples.${key}`])), params
);
export const setSampleText = (element, key, params) => setTranslatedText(element, `samples.${key}`, params);
export const setSampleAttribute = (element, attribute, key, params) => setTranslatedAttribute(element, attribute, `samples.${key}`, params);
export const sampleUi = (key, params = {}) => ({ i18nKey: `samples.${key}`, i18nParams: params });
export function sampleStatusMarkup(message) {
  if (Array.isArray(message)) return message.map(sampleStatusMarkup).join('');
  return message?.i18nKey ? messageSpan(message.i18nKey, message.i18nParams) : escapeHtml(String(message || ''));
}
export function bindSampleStatus(element, message) {
  if (!element) return;
  if (message?.i18nKey) setTranslatedText(element, message.i18nKey, message.i18nParams);
  else {
    element.removeAttribute?.('data-i18n');
    element.removeAttribute?.('data-i18n-params');
    statusPresentation.setOwnedText(element, String(message || ''));
  }
}
export function sampleNotice(message, options) {
  message = statusPresentation.owned(message);
  showTransientNotice(message?.i18nKey ? i18n.t(message.i18nKey, message.i18nParams) : String(message || ''), {
    ...options, ...(message?.i18nKey ? message : {})
  });
}
export function sampleClipboardMessage(formats = []) {
  const visible = [...new Set((Array.isArray(formats) ? formats : []).map(format => String(format || '').trim()).filter(Boolean))];
  return sampleUi(visible.length ? 'structure.notFoundFormats' : 'structure.notFound', visible.length ? { formats: visible.slice(0, 8).join(', ') } : {});
}

// UI-only labels; shared layout helpers and stored type IDs stay canonical.
export function sampleContainerType(container) {
  const type = normalizeContainerType(container && typeof container === 'object' ? container.type : container);
  const layout = type === 'customGrid' ? getContainerLayout(container) : null;
  return { key: `type.${type}`, params: layout ? { rows: layout.rows, cols: layout.cols } : {} };
}
export function sampleContainerTypeMessage(container) {
  const { key, params } = sampleContainerType(container);
  return sampleMessage(key, params);
}
