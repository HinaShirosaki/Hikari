import { createI18n } from './runtime.js';
import { commonEnglish } from './en.js';
import { commonSpanish } from './es.js';

export { createI18n } from './runtime.js';
export { DEFAULT_LOCALE, SUPPORTED_LOCALES, normalizeLocale } from './locale.js';

// Only bundled catalogs are used: no network, browser-language detection, or
// asynchronous initialization on the normal renderer startup path.
export const i18n = createI18n({ catalogs: { en: { common: commonEnglish }, es: { common: commonSpanish } } });
export const t = (...args) => i18n.t(...args);
