import { protocolSpanish } from './locales/es.js';
import { createPresentation } from '../../lib/i18n/presentation.js';
const statusPresentation = createPresentation('protocol');
import { i18n } from '../../lib/i18n/index.js';
import { messageSpan, messageAttributes } from '../../lib/i18n/markup.js';
import { setTranslatedText, setTranslatedAttribute } from '../../lib/i18n/dom.js';
import { escapeHtml } from '../../lib/html.js';
import { showTransientNotice } from '../../lib/notify.js';
import { protocolEnglish } from './locales/en.js';

i18n.registerMessages('en', 'protocol', protocolEnglish);
i18n.registerMessages('es', 'protocol', protocolSpanish);
export const protocolText = i18n.scope('protocol');
export const protocolMessage = (key, params) => messageSpan(`protocol.${key}`, params);
export const protocolAttributes = (bindings, params) => messageAttributes(
  Object.fromEntries(Object.entries(bindings).map(([attribute, key]) => [attribute, `protocol.${key}`])), params
);
export const setProtocolText = (element, key, params) => setTranslatedText(element, `protocol.${key}`, params);
export const setProtocolAttribute = (element, attribute, key, params) => setTranslatedAttribute(element, attribute, `protocol.${key}`, params);

// Local UI descriptors retain bindings through progress/error state changes.
// Plain backend messages stay verbatim and clear any preceding local binding.
export const protocolUi = (key, params = {}) => ({ i18nKey: `protocol.${key}`, i18nParams: params });
export const protocolDisplayText = message => message?.i18nKey
  ? i18n.t(message.i18nKey, message.i18nParams) : String(message?.message || message || '');
export const protocolDisplayMarkup = message => message?.i18nKey
  ? messageSpan(message.i18nKey, message.i18nParams) : escapeHtml(protocolDisplayText(message));
export function bindProtocolMessage(element, message) {
  if (!element) return;
  if (message?.i18nKey) setTranslatedText(element, message.i18nKey, message.i18nParams);
  else if (!message) setProtocolText(element, 'empty');
  else {
    element.removeAttribute?.('data-i18n');
    element.removeAttribute?.('data-i18n-params');
    statusPresentation.setOwnedText(element, protocolDisplayText(message).trim());
  }
}
export function protocolError(key, params) {
  const message = protocolUi(key, params);
  return Object.assign(new Error(protocolDisplayText(message)), message);
}
export const protocolNotice = (message, options) => {
  message = statusPresentation.owned(message);
  return showTransientNotice(protocolDisplayText(message), {
  ...options, ...(message?.i18nKey ? { i18nKey: message.i18nKey, i18nParams: message.i18nParams } : {})
  });
};
