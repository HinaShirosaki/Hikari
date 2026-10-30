import { workflowSpanish } from './locales/es.js';
import { i18n } from '../../lib/i18n/index.js';
import { messageSpan, messageAttributes } from '../../lib/i18n/markup.js';
import { setTranslatedText } from '../../lib/i18n/dom.js';
import { workflowEnglish } from './locales/en.js';

i18n.registerMessages('en', 'workflow', workflowEnglish);
i18n.registerMessages('es', 'workflow', workflowSpanish);
export const workflowText = i18n.scope('workflow');
export const workflowMessage = (key, params) => messageSpan(`workflow.${key}`, params);
export const setWorkflowText = (element, key, params) => setTranslatedText(element, `workflow.${key}`, params);
export const workflowAttributes = (bindings, params) => messageAttributes(
  Object.fromEntries(Object.entries(bindings).map(([attribute, key]) => [attribute, `workflow.${key}`])), params
);
export function workflowError(key, params = {}) {
  const error = new Error(workflowText(key, params));
  error.i18nKey = `workflow.${key}`;
  error.i18nParams = params;
  return error;
}
