import { plateSpanish } from './locales/es.js';
import { createPresentation } from '../../lib/i18n/presentation.js';
const statusPresentation = createPresentation('plate');
import { i18n } from '../../lib/i18n/index.js';
import { escapeHtml } from '../../lib/html.js';
import { messageSpan, messageAttributes } from '../../lib/i18n/markup.js';
import { setTranslatedText, setTranslatedAttribute } from '../../lib/i18n/dom.js';
import { showTransientNotice } from '../../lib/notify.js';
import { formatTimestamp } from './shared.js';
import { plateEnglish } from './locales/en.js';

i18n.registerMessages('en', 'plate', plateEnglish);
i18n.registerMessages('es', 'plate', plateSpanish);
export const plateText = i18n.scope('plate');
export const plateMessage = (key, params) => messageSpan(`plate.${key}`, params);
export const plateAttributes = (bindings, params) => messageAttributes(
  Object.fromEntries(Object.entries(bindings).map(([attribute, key]) => [attribute, `plate.${key}`])), params
);
export const setPlateText = (element, key, params) => setTranslatedText(element, `plate.${key}`, params);
export const setPlateAttribute = (element, attribute, key, params) => setTranslatedAttribute(element, attribute, `plate.${key}`, params);
// <option> cannot hold a bound <span>, so the option itself carries the binding.
export const plateOption = (value, key, params = {}) => `<option value="${escapeHtml(value)}" data-i18n="plate.${escapeHtml(key)}" data-i18n-params="${escapeHtml(JSON.stringify(params))}">${escapeHtml(plateText(key, params))}</option>`;

// Status descriptors keep their binding through async imports and later locale
// switches. Plain strings (backend errors) stay verbatim.
export const plateUi = (key, params = {}) => ({ i18nKey: `plate.${key}`, i18nParams: params });
export const plateDisplayText = message => message?.i18nKey
  ? i18n.t(message.i18nKey, message.i18nParams) : String(message?.message || message || '');
export function bindPlateMessage(element, message) {
  if (!element) return;
  if (message?.i18nKey) {
    setTranslatedText(element, message.i18nKey, message.i18nParams);
    return;
  }
  element.removeAttribute?.('data-i18n');
  element.removeAttribute?.('data-i18n-params');
  statusPresentation.setOwnedText(element, plateDisplayText(message));
}
export const plateNotice = (message, options) => {
  message = statusPresentation.owned(message);
  return showTransientNotice(plateDisplayText(message), {
  ...options, ...(message?.i18nKey ? { i18nKey: message.i18nKey, i18nParams: message.i18nParams } : {})
  });
};
export const plateError = (key, params) => Object.assign(new Error(plateText(key, params)), plateUi(key, params));
// Errors from this module keep their key; backend/parser text stays verbatim.
export const plateFailure = (error, fallbackKey) => (error?.i18nKey
  ? { i18nKey: error.i18nKey, i18nParams: error.i18nParams }
  : (error?.message || (typeof error === 'string' && error) || plateUi(fallbackKey)));

// UI-only notebook option label; shared.notebookLabel() keeps its English output.
export function notebookOptionMessage(entry) {
  const name = String(entry?.experimentName || entry?.protocolName || '-').trim() || '-';
  return {
    key: entry?.notebookType === 'biology' ? 'form.notebookBiology' : 'form.notebookSynthesis',
    params: { name, updated: formatTimestamp(entry?.updatedAt) }
  };
}
