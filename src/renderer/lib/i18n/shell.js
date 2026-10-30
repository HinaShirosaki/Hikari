import { i18n } from './index.js';
import { shellEnglish } from './shell-en.js';
import { shellSpanish } from './shell-es.js';
import { setTranslatedText, setTranslatedAttribute } from './dom.js';
import { showTransientNotice } from '../notify.js';

i18n.registerMessages('en', 'shell', shellEnglish);
i18n.registerMessages('es', 'shell', shellSpanish);
export const shellText = i18n.scope('shell');
export const setShellText = (element, key, params) => setTranslatedText(element, `shell.${key}`, params);
export const setShellAttribute = (element, attribute, key, params) => setTranslatedAttribute(element, attribute, `shell.${key}`, params);
export const appLabel = app => shellText(`app.${app?.id}`, {}, app?.label || '');
export const shellUi = (key, params = {}) => ({ i18nKey: `shell.${key}`, i18nParams: params });
export function bindShellMessage(element, message) {
  if (!element) return;
  if (message?.i18nKey) setTranslatedText(element, message.i18nKey, message.i18nParams);
  else {
    element.removeAttribute?.('data-i18n');
    element.removeAttribute?.('data-i18n-params');
    element.textContent = String(message || '');
  }
}
export function shellNotice(message, options) {
  showTransientNotice(i18n.t(message.i18nKey, message.i18nParams), { ...options, ...message });
}

// Registry IDs, aliases and plugin/user titles remain canonical data.
export function setAppSubtitle(element, viewId, titles) {
  if (!element) return;
  const key = `subtitle.${viewId}`;
  if (shellEnglish[key] === titles[viewId]) setShellText(element, key);
  else {
    element.removeAttribute?.('data-i18n');
    element.removeAttribute?.('data-i18n-params');
    element.textContent = titles[viewId] || '';
  }
}

export function bindAppLabel(button, label, app) {
  const key = `app.${app.id}`;
  if (Object.hasOwn(shellEnglish, key)) {
    setShellText(label, key);
    setShellAttribute(button, 'title', key);
    setShellAttribute(button, 'aria-label', key);
  } else {
    label.textContent = app.label;
    button.title = app.label;
    button.setAttribute('aria-label', app.label);
  }
  button.dataset.label = appLabel(app);
}
