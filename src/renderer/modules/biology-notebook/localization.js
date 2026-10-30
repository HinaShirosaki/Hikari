import { notebookSpanish } from './locales/es.js';
import { i18n } from '../../lib/i18n/index.js';
import { messageSpan, messageAttributes } from '../../lib/i18n/markup.js';
import { setTranslatedText, setTranslatedAttribute } from '../../lib/i18n/dom.js';
import { showTransientNotice } from '../../lib/notify.js';
import { notebookEnglish } from './locales/en.js';

i18n.registerMessages('en', 'notebook', notebookEnglish);
i18n.registerMessages('es', 'notebook', notebookSpanish);
export const notebookText = i18n.scope('notebook');
export const notebookMessage = (key, params) => messageSpan(`notebook.${key}`, params);
export const notebookAttributes = (bindings, params) => messageAttributes(
  Object.fromEntries(Object.entries(bindings).map(([attribute, key]) => [attribute, `notebook.${key}`])), params
);
export const setNotebookText = (element, key, params) => setTranslatedText(element, `notebook.${key}`, params);
export const setNotebookAttribute = (element, attribute, key, params) => setTranslatedAttribute(element, attribute, `notebook.${key}`, params);
export const notebookNotice = (key, params, options) => showTransientNotice(notebookText(key, params), {
  ...options, i18nKey: `notebook.${key}`, i18nParams: params
});
