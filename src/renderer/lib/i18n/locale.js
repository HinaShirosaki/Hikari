export const DEFAULT_LOCALE = 'en';
// Preview languages use English for messages that have not been translated.
export const SUPPORTED_LOCALES = Object.freeze(['en', 'es', 'zh-Hans', 'zh-Hant', 'ja']);

export function canonicalLocale(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return Intl.getCanonicalLocales(value.trim().replaceAll('_', '-'))[0] || '';
  } catch {
    return '';
  }
}

export function localeCandidates(value) {
  const locale = canonicalLocale(value);
  const candidates = [];
  const parts = locale.split('-');
  while (parts.length && parts[0]) {
    candidates.push(parts.join('-'));
    parts.pop();
  }
  // Region-only Chinese preferences must retain their writing system (for
  // example zh-TW -> zh-Hant and zh-CN -> zh-Hans). Explicit scripts win.
  if (locale.split('-')[0] === 'zh') {
    const scriptLocale = `zh-${new Intl.Locale(locale).maximize().script}`;
    if (!candidates.includes(scriptLocale)) candidates.splice(candidates.indexOf('zh'), 0, scriptLocale);
  }
  return candidates;
}

export function normalizeLocale(value, supported = SUPPORTED_LOCALES, fallback = DEFAULT_LOCALE) {
  const locales = new Set(supported);
  return localeCandidates(value).find(locale => locales.has(locale)) || fallback;
}
