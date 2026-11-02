const english = require('./locales/en.json');
const spanish = require('./locales/es.json');
const catalogs = new Map([
  ['en', english], ['es', spanish],
  ['zh-Hans', require('./locales/zh-Hans.json')],
  ['zh-Hant', require('./locales/zh-Hant.json')],
  ['ja', require('./locales/ja.json')]
]);
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
  try { canonical = typeof language === 'string' ? Intl.getCanonicalLocales(language.trim().replaceAll('_', '-'))[0] : ''; } catch { canonical = ''; }
  const candidates = [], parts = String(canonical || '').split('-');
  while (parts.length && parts[0]) {
    candidates.push(parts.join('-'));
    parts.pop();
  }
  // Match the renderer's Chinese script/region resolution.
  if (canonical?.split('-')[0] === 'zh') {
    const scriptLocale = `zh-${new Intl.Locale(canonical).maximize().script}`;
    if (!candidates.includes(scriptLocale)) candidates.splice(candidates.indexOf('zh'), 0, scriptLocale);
  }
  locale = candidates.find(candidate => catalogs.has(candidate)) || 'en';
  return locale;
}
module.exports = { nativeText, setLocale, keyFor };
