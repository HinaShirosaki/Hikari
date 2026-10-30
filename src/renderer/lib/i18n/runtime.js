import { canonicalLocale, DEFAULT_LOCALE, localeCandidates, normalizeLocale } from './locale.js';

const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

// Catalogs contain plain text only. Escaping belongs at the output boundary:
// textContent for DOM nodes, escapeHtml for strings inserted into HTML.
export function createI18n({ fallbackLocale = DEFAULT_LOCALE, locale = fallbackLocale, catalogs = {} } = {}) {
  const fallback = canonicalLocale(fallbackLocale) || DEFAULT_LOCALE;
  const messagesByLocale = new Map([[fallback, new Map()]]);
  const listeners = new Set();
  let catalogRevision = 0;
  let currentLocale = fallback;

  function registerMessages(language, namespace, messages) {
    const canonical = canonicalLocale(language);
    if (!canonical || typeof namespace !== 'string' || !/^[a-z][a-z0-9-]*$/i.test(namespace)) {
      throw new TypeError('A valid locale and message namespace are required.');
    }
    if (!messages || typeof messages !== 'object' || Array.isArray(messages)) {
      throw new TypeError('A message catalog must be an object.');
    }
    const entries = Object.entries(messages);
    // Validate before mutating so a bad catalog cannot leave a partial update.
    const validated = entries.map(([key, value]) => {
      if (!key || !(typeof value === 'string' || (
        value && typeof value === 'object' && !Array.isArray(value)
        && typeof value.other === 'string'
        && Object.entries(value).every(([category, text]) => PLURAL_CATEGORIES.has(category) && typeof text === 'string')
      ))) throw new TypeError(`Invalid translation: ${namespace}.${key}`);
      return [`${namespace}.${key}`, typeof value === 'string' ? value : Object.freeze({ ...value })];
    });
    if (!messagesByLocale.has(canonical)) messagesByLocale.set(canonical, new Map());
    const catalog = messagesByLocale.get(canonical);
    validated.forEach(([key, value]) => catalog.set(key, value));
    catalogRevision++;
  }

  for (const [language, namespaces] of Object.entries(catalogs)) {
    for (const [namespace, messages] of Object.entries(namespaces)) {
      registerMessages(language, namespace, messages);
    }
  }
  currentLocale = normalizeLocale(locale, messagesByLocale.keys(), fallback);

  function findMessage(key) {
    const candidates = [...new Set([...localeCandidates(currentLocale), ...localeCandidates(fallback)])];
    for (const language of candidates) {
      const catalog = messagesByLocale.get(language);
      if (catalog?.has(key)) return { value: catalog.get(key), language };
    }
    return null;
  }

  function t(key, params = {}, defaultValue = key) {
    const message = findMessage(key);
    let text = message?.value ?? defaultValue;
    if (text && typeof text === 'object') {
      const count = params?.count;
      const category = typeof count === 'number' && Number.isFinite(count)
        ? new Intl.PluralRules(message.language).select(count) : 'other';
      text = text[category] ?? text.other;
    }
    return String(text).replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (placeholder, name) => (
      params && Object.hasOwn(params, name) ? String(params[name]) : placeholder
    ));
  }

  return {
    t,
    has: key => findMessage(key) !== null,
    catalogRevision: () => catalogRevision,
    englishEntries: namespace => [...(messagesByLocale.get(fallback)?.entries() || [])]
      .filter(([key]) => key.startsWith(`${namespace}.`)),
    scope: namespace => (key, params, defaultValue) => t(`${namespace}.${key}`, params, defaultValue),
    registerMessages,
    getLocale: () => currentLocale,
    getAvailableLocales: () => [...messagesByLocale.keys()],
    setLocale(value) {
      const next = normalizeLocale(value, messagesByLocale.keys(), fallback);
      if (next === currentLocale) return currentLocale;
      currentLocale = next;
      listeners.forEach(listener => listener(currentLocale));
      return currentLocale;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    formatDate: (value, options) => new Intl.DateTimeFormat(currentLocale, options).format(value)
  };
}
