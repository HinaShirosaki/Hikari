import { workflowSpanish } from './locales/es.js';
import { workflowSimplifiedChinese } from './locales/zh-Hans.js';
import { workflowTraditionalChinese } from './locales/zh-Hant.js';
import { workflowJapanese } from './locales/ja.js';
import { i18n } from '../../lib/i18n/index.js';
import { messageSpan, messageAttributes } from '../../lib/i18n/markup.js';
import { setTranslatedText } from '../../lib/i18n/dom.js';
import { workflowEnglish } from './locales/en.js';

i18n.registerMessages('en', 'workflow', workflowEnglish);
i18n.registerMessages('es', 'workflow', workflowSpanish);
i18n.registerMessages('zh-Hans', 'workflow', workflowSimplifiedChinese);
i18n.registerMessages('zh-Hant', 'workflow', workflowTraditionalChinese);
i18n.registerMessages('ja', 'workflow', workflowJapanese);
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
