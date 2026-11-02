import { homeSpanish } from './locales/es.js';
import { homeSimplifiedChinese } from './locales/zh-Hans.js';
import { homeTraditionalChinese } from './locales/zh-Hant.js';
import { homeJapanese } from './locales/ja.js';
import { i18n } from '../../lib/i18n/index.js';
import { messageSpan, messageAttributes } from '../../lib/i18n/markup.js';
import { setTranslatedText, setTranslatedAttribute } from '../../lib/i18n/dom.js';
import { homeEnglish } from './locales/en.js';

i18n.registerMessages('en', 'home', homeEnglish);
i18n.registerMessages('es', 'home', homeSpanish);
i18n.registerMessages('zh-Hans', 'home', homeSimplifiedChinese);
i18n.registerMessages('zh-Hant', 'home', homeTraditionalChinese);
i18n.registerMessages('ja', 'home', homeJapanese);
export const homeText = i18n.scope('home');
export const homeMessage = (key, params) => messageSpan(`home.${key}`, params);
export const homeAttributes = (bindings, params) => messageAttributes(
  Object.fromEntries(Object.entries(bindings).map(([attribute, key]) => [attribute, `home.${key}`])), params
);
export const setHomeText = (element, key, params) => setTranslatedText(element, `home.${key}`, params);
export const setHomeAttribute = (element, attribute, key, params) => setTranslatedAttribute(element, attribute, `home.${key}`, params);
