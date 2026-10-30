import { settingsSpanish } from './locales/es.js';
import { i18n } from '../../lib/i18n/index.js';
import { messageSpan, messageAttributes } from '../../lib/i18n/markup.js';
import { setTranslatedText, setTranslatedAttribute } from '../../lib/i18n/dom.js';
import { settingsEnglish } from './locales/en.js';

i18n.registerMessages('en', 'settings', settingsEnglish);
i18n.registerMessages('es', 'settings', settingsSpanish);
export const settingsText = i18n.scope('settings');
export const settingsMessage = (key, params) => messageSpan(`settings.${key}`, params);
export const settingsAttributes = (bindings, params) => messageAttributes(
  Object.fromEntries(Object.entries(bindings).map(([attribute, key]) => [attribute, `settings.${key}`])), params
);
export const setSettingsText = (element, key, params) => setTranslatedText(element, `settings.${key}`, params);
export const setSettingsAttribute = (element, attribute, key, params) => setTranslatedAttribute(element, attribute, `settings.${key}`, params);
