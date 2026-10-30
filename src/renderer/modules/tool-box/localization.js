import { toolsSpanish } from './locales/es.js';
import { createPresentation } from '../../lib/i18n/presentation.js';
const statusPresentation = createPresentation('tools');
import { i18n } from '../../lib/i18n/index.js';
import { messageSpan } from '../../lib/i18n/markup.js';
import { setTranslatedText, setTranslatedAttribute } from '../../lib/i18n/dom.js';
import { toolsEnglish } from './locales/en.js';
import { showTransientNotice } from '../../lib/notify.js';
import { escapeHtml } from '../../lib/html.js';

i18n.registerMessages('en', 'tools', toolsEnglish);
i18n.registerMessages('es', 'tools', toolsSpanish);
export const toolText = i18n.scope('tools');
export const toolMessage = (key, params) => messageSpan(`tools.${key}`, params);
export const setToolText = (element, key, params) => setTranslatedText(element, `tools.${key}`, params);
export const setToolAttribute = (element, attribute, key, params) => setTranslatedAttribute(element, attribute, `tools.${key}`, params);
export const setToolPlaceholder = (element, message) => setTranslatedAttribute(
  element, 'placeholder', `tools.bench.${message.id}`, message.params
);
export const toolUi = (key, params = {}) => ({ i18nKey: `tools.${key}`, i18nParams: params });
export const toolDisplayText = message => message?.i18nKey
  ? i18n.t(message.i18nKey, message.i18nParams) : String(message || '');
export function bindToolMessage(element, message) {
  if (!element) return;
  if (message?.i18nKey) setTranslatedText(element, message.i18nKey, message.i18nParams);
  else {
    element.removeAttribute?.('data-i18n');
    element.removeAttribute?.('data-i18n-params');
    statusPresentation.setOwnedText(element, toolDisplayText(message));
  }
}
export const toolStatusMarkup = message => message?.i18nKey
  ? messageSpan(message.i18nKey, message.i18nParams) : escapeHtml(toolDisplayText(message));
export function toolNotice(message, options) {
  message = statusPresentation.owned(message);
  showTransientNotice(toolDisplayText(message), { ...options, ...(message?.i18nKey ? message : {}) });
}
export function toolError(key, params = {}) {
  // Keep the library's existing English Error.message contract; UI uses metadata.
  const english = toolsEnglish[key].replace(/\{(\w+)\}/g, (token, name) => Object.hasOwn(params, name) ? String(params[name]) : token);
  return Object.assign(new Error(english), toolUi(key, params));
}
export const toolFailure = (error, fallbackKey) => error?.i18nKey
  ? { i18nKey: error.i18nKey, i18nParams: error.i18nParams }
  : (error?.message || (typeof error === 'string' && error) || toolUi(fallbackKey));
