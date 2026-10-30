import { dnaSpanish } from './locales/es.js';
import { createPresentation } from '../../lib/i18n/presentation.js';
const statusPresentation = createPresentation('dna');
import { i18n } from '../../lib/i18n/index.js';
import { messageSpan, messageAttributes } from '../../lib/i18n/markup.js';
import { setTranslatedText, setTranslatedAttribute } from '../../lib/i18n/dom.js';
import { showTransientNotice } from '../../lib/notify.js';
import { dnaEnglish } from './locales/en.js';

i18n.registerMessages('en', 'dna', dnaEnglish);
i18n.registerMessages('es', 'dna', dnaSpanish);
export const dnaText = i18n.scope('dna');
export const dnaMessage = (key, params) => messageSpan(`dna.${key}`, params);
export const dnaAttributes = (bindings, params) => messageAttributes(
  Object.fromEntries(Object.entries(bindings).map(([attribute, key]) => [attribute, `dna.${key}`])), params
);
export const setDnaText = (element, key, params) => setTranslatedText(element, `dna.${key}`, params);
export const setDnaAttribute = (element, attribute, key, params) => setTranslatedAttribute(element, attribute, `dna.${key}`, params);

// Notice/status descriptors keep their binding; parser and backend text stays verbatim.
export const dnaUi = (key, params = {}) => ({ i18nKey: `dna.${key}`, i18nParams: params });
export const dnaDisplayText = message => message?.i18nKey
  ? i18n.t(message.i18nKey, message.i18nParams) : String(message?.message || message || '').trim();
export function bindDnaMessage(element, message) {
  if (!element) return;
  if (message?.i18nKey) {
    setTranslatedText(element, message.i18nKey, message.i18nParams);
    return;
  }
  element.removeAttribute?.('data-i18n');
  element.removeAttribute?.('data-i18n-params');
  statusPresentation.setOwnedText(element, dnaDisplayText(message));
}
export const dnaNotice = (message, options) => {
  message = statusPresentation.owned(message);
  return showTransientNotice(dnaDisplayText(message), {
  ...options, ...(message?.i18nKey ? { i18nKey: message.i18nKey, i18nParams: message.i18nParams } : {})
  });
};
export const dnaFailure = (error, fallbackKey) => (error?.i18nKey
  ? { i18nKey: error.i18nKey, i18nParams: error.i18nParams }
  : (error?.message || (typeof error === 'string' && error) || dnaUi(fallbackKey)));

// Folder-tree disclosure labels for the sequence library rail.
export function dnaFolderDisclosure(name, expanded) {
  const key = expanded ? 'tree.collapse' : 'tree.expand';
  return {
    disclosureLabel: dnaText(key, { name }),
    disclosureAttributes: { 'data-i18n-aria-label': `dna.${key}`, 'data-i18n-params': JSON.stringify({ name }) }
  };
}
