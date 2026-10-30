import { agentSpanish } from './locales/es.js';
import { createPresentation } from '../../lib/i18n/presentation.js';
const statusPresentation = createPresentation('agent');
import { createI18n, i18n } from '../../lib/i18n/index.js';
import { escapeHtml } from '../../lib/html.js';
import { messageSpan, messageAttributes } from '../../lib/i18n/markup.js';
import { setTranslatedText, setTranslatedAttribute } from '../../lib/i18n/dom.js';
import { showTransientNotice } from '../../lib/notify.js';
import { agentEnglish } from './locales/en.js';

i18n.registerMessages('en', 'agent', agentEnglish);
i18n.registerMessages('es', 'agent', agentSpanish);
// The Home status pill picks its tone from English words, whatever the UI language.
const english = createI18n({ catalogs: { en: { agent: agentEnglish } } });
export const agentText = i18n.scope('agent');
export const agentMessage = (key, params) => messageSpan(`agent.${key}`, params);
export const agentAttributes = (bindings, params) => messageAttributes(
  Object.fromEntries(Object.entries(bindings).map(([attribute, key]) => [attribute, `agent.${key}`])), params
);
export const setAgentText = (element, key, params) => setTranslatedText(element, `agent.${key}`, params);
export const setAgentAttribute = (element, attribute, key, params) => setTranslatedAttribute(element, attribute, `agent.${key}`, params);
export const agentOption = (value, key, params = {}) => `<option value="${escapeHtml(value)}" data-i18n="agent.${escapeHtml(key)}" data-i18n-params="${escapeHtml(JSON.stringify(params))}">${escapeHtml(agentText(key, params))}</option>`;

// Status/notice descriptors keep their binding; agent and backend text stays verbatim.
export const agentUi = (key, params = {}) => ({ i18nKey: `agent.${key}`, i18nParams: params });
export const agentDisplayText = message => message?.i18nKey
  ? i18n.t(message.i18nKey, message.i18nParams) : String(message?.message || message || '');
export const agentEnglishText = message => message?.i18nKey
  ? english.t(message.i18nKey, message.i18nParams) : String(message?.message || message || '');
export function bindAgentMessage(element, message) {
  if (!element) return;
  if (message?.i18nKey) {
    setTranslatedText(element, message.i18nKey, message.i18nParams);
    return;
  }
  element.removeAttribute?.('data-i18n');
  element.removeAttribute?.('data-i18n-params');
  statusPresentation.setOwnedText(element, agentDisplayText(message));
}
export const agentNotice = (message, options) => {
  message = statusPresentation.owned(message);
  return showTransientNotice(agentDisplayText(message), {
  ...options, ...(message?.i18nKey ? { i18nKey: message.i18nKey, i18nParams: message.i18nParams } : {})
  });
};
export const agentFailure = (error, fallbackKey) => (error?.i18nKey
  ? { i18nKey: error.i18nKey, i18nParams: error.i18nParams }
  : (error?.message || (typeof error === 'string' && error) || agentUi(fallbackKey)));

// Folder-tree disclosure labels for the session rail.
export function agentFolderDisclosure(name, expanded, general = false) {
  const key = `tree.${expanded ? 'collapse' : 'expand'}${general ? 'General' : ''}`;
  return {
    disclosureLabel: agentText(key, { name }),
    disclosureAttributes: { 'data-i18n-aria-label': `agent.${key}`, 'data-i18n-params': JSON.stringify({ name }) }
  };
}
