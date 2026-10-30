import { chemicalsSpanish } from './locales/es.js';
import { createPresentation } from '../../lib/i18n/presentation.js';
const statusPresentation = createPresentation('chemicals');
import { i18n } from '../../lib/i18n/index.js';
import { messageSpan, messageAttributes } from '../../lib/i18n/markup.js';
import { setTranslatedText } from '../../lib/i18n/dom.js';
import { showTransientNotice } from '../../lib/notify.js';
import { chemicalsEnglish } from './locales/en.js';

i18n.registerMessages('en', 'chemicals', chemicalsEnglish);
i18n.registerMessages('es', 'chemicals', chemicalsSpanish);
export const chemicalText = i18n.scope('chemicals');
export const chemicalMessage = (key, params) => messageSpan(`chemicals.${key}`, params);
export const chemicalAttributes = (bindings, params) => messageAttributes(
  Object.fromEntries(Object.entries(bindings).map(([attribute, key]) => [attribute, `chemicals.${key}`])), params
);
export const setChemicalText = (element, key, params) => setTranslatedText(element, `chemicals.${key}`, params);
export const chemicalUi = (key, params = {}) => ({ i18nKey: `chemicals.${key}`, i18nParams: params });
export const chemicalDisplayText = message => message?.i18nKey
  ? i18n.t(message.i18nKey, message.i18nParams) : String(message?.message || message || '');
export function bindChemicalMessage(element, message) {
  if (!element) return;
  if (message?.i18nKey) setTranslatedText(element, message.i18nKey, message.i18nParams);
  else if (!message) setChemicalText(element, 'empty');
  else {
    element.removeAttribute?.('data-i18n');
    element.removeAttribute?.('data-i18n-params');
    statusPresentation.setOwnedText(element, chemicalDisplayText(message));
  }
}
export const chemicalNotice = (message, options) => {
  message = statusPresentation.owned(message);
  return showTransientNotice(chemicalDisplayText(message), {
  ...options, ...(message?.i18nKey ? { i18nKey: message.i18nKey, i18nParams: message.i18nParams } : {})
  });
};
export const chemicalError = (key, params) => Object.assign(new Error(chemicalText(key, params)), chemicalUi(key, params));
export function chemicalImportFailure(error) {
  // Local parser/validation errors have a complete translated failure sentence.
  // Backend/parser-provider details are parameters and stay verbatim.
  const key = `${error?.i18nKey || ''}.failed`;
  return i18n.has(key) ? { i18nKey: key, i18nParams: error.i18nParams }
    : chemicalUi('import.failed', { error: String(error?.message || error) });
}
