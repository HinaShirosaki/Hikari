export const DEFAULT_LOCALE = 'en';
// Spanish is a preview; missing messages fall back to English.
export const SUPPORTED_LOCALES = Object.freeze(['en', 'es']);

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
  return candidates;
}

export function normalizeLocale(value, supported = SUPPORTED_LOCALES, fallback = DEFAULT_LOCALE) {
  const locales = new Set(supported);
  return localeCandidates(value).find(locale => locales.has(locale)) || fallback;
}
