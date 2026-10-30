import { papersSpanish } from './locales/es.js';
import { createPresentation } from '../../lib/i18n/presentation.js';
const statusPresentation = createPresentation('papers');
import { i18n } from '../../lib/i18n/index.js';
import { messageSpan, messageAttributes } from '../../lib/i18n/markup.js';
import { setTranslatedText, setTranslatedAttribute } from '../../lib/i18n/dom.js';
import { showTransientNotice } from '../../lib/notify.js';
import { papersEnglish } from './locales/en.js';

i18n.registerMessages('en', 'papers', papersEnglish);
i18n.registerMessages('es', 'papers', papersSpanish);
export const paperText = i18n.scope('papers');
export const paperMessage = (key, params) => messageSpan(`papers.${key}`, params);
export const paperAttributes = (bindings, params) => messageAttributes(
  Object.fromEntries(Object.entries(bindings).map(([attribute, key]) => [attribute, `papers.${key}`])), params
);
export const setPaperText = (element, key, params) => setTranslatedText(element, `papers.${key}`, params);
export const setPaperAttribute = (element, attribute, key, params) => setTranslatedAttribute(element, attribute, `papers.${key}`, params);

// Notice/status descriptors keep their binding; backend text stays verbatim.
export const paperUi = (key, params = {}) => ({ i18nKey: `papers.${key}`, i18nParams: params });
export const paperDisplayText = message => message?.i18nKey
  ? i18n.t(message.i18nKey, message.i18nParams) : String(message?.message || message || '');
export function bindPaperMessage(element, message) {
  if (!element) return;
  if (message?.i18nKey) {
    setTranslatedText(element, message.i18nKey, message.i18nParams);
    return;
  }
  element.removeAttribute?.('data-i18n');
  element.removeAttribute?.('data-i18n-params');
  statusPresentation.setOwnedText(element, paperDisplayText(message));
}
export const paperNotice = (message, options) => {
  message = statusPresentation.owned(message);
  return showTransientNotice(paperDisplayText(message), {
  ...options, ...(message?.i18nKey ? { i18nKey: message.i18nKey, i18nParams: message.i18nParams } : {})
  });
};
export const paperFailure = (error, fallbackKey) => (error?.i18nKey
  ? { i18nKey: error.i18nKey, i18nParams: error.i18nParams }
  : (error?.message || (typeof error === 'string' && error) || paperUi(fallbackKey)));

// Folder-tree disclosure labels for the library rail.
export function paperFolderDisclosure(name, expanded) {
  const key = expanded ? 'tree.collapse' : 'tree.expand';
  return {
    disclosureLabel: paperText(key, { name }),
    disclosureAttributes: { 'data-i18n-aria-label': `papers.${key}`, 'data-i18n-params': JSON.stringify({ name }) }
  };
}

// UI-only compact age; model.formatRelativePaperTime() keeps its output.
export function relativePaperTimeMessage(timestamp, now = Date.now()) {
  const parsed = Date.parse(String(timestamp || ''));
  if (!Number.isFinite(parsed)) return null;
  const minutes = Math.max(now - parsed, 0) / 60000;
  if (minutes < 60) return { key: 'time.minutes', params: { count: Math.max(1, Math.round(minutes)) } };
  if (minutes < 1440) return { key: 'time.hours', params: { count: Math.max(1, Math.round(minutes / 60)) } };
  if (minutes < 10080) return { key: 'time.days', params: { count: Math.max(1, Math.round(minutes / 1440)) } };
  return { key: 'time.weeks', params: { count: Math.max(1, Math.round(minutes / 10080)) } };
}
