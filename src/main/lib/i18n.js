const english = require('./locales/en.json');
const spanish = require('./locales/es.json');
const catalogs = new Map([['en', english], ['es', spanish]]);
let locale = 'en';
function keyFor(text) {
  let hash = 2166136261;
  const source = String(text);
  for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return `ui.${(hash >>> 0).toString(16)}`;
}
function nativeText(fallback, params = {}) {
  const key = keyFor(fallback);
  const message = catalogs.get(locale)?.[key] ?? english[key] ?? fallback;
  return String(message).replace(/\{(\w+)\}/g, (token, name) => Object.hasOwn(params, name) ? String(params[name]) : token);
}
function setLocale(language) {
  let canonical;
  try { canonical = Intl.getCanonicalLocales(language)[0]; } catch { canonical = 'en'; }
  const candidates = String(canonical || '').split('-');
  while (candidates.length && !catalogs.has(candidates.join('-'))) candidates.pop();
  locale = candidates.join('-') || 'en';
  return locale;
}
module.exports = { nativeText, setLocale, keyFor };
