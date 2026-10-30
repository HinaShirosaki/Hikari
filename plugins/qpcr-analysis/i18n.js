// Standalone first-party plugin presentation layer. Only explicit UI bindings
// are refreshed; document objects, editor values and scientific output stay raw.
(function installUi(root) {
  'use strict';
  if (root.HikariUi) { if (typeof module === 'object' && module.exports) module.exports = root.HikariUi; return; }
  const catalogs = new Map([['en', new Map()]]), listeners = new Set(), caches = new Map();
  let locale = 'en', revision = 0;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const keyFor = text => { const source = String(text); let h = 2166136261; for (let index = 0; index < source.length; index++) h = Math.imul(h ^ source.charCodeAt(index), 16777619); return `full.${(h >>> 0).toString(16)}`; };
  const validParams = params => params && typeof params === 'object' && !Array.isArray(params) && Object.values(params).every(v => typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v));
  const scalar = params => Object.fromEntries(Object.entries(params || {}).map(([k, v]) => [k, ['string','number','boolean'].includes(typeof v) ? v : String(v)]));
  function register(language, namespace, messages) {
    const lang = Intl.getCanonicalLocales(language)[0];
    if (!messages || typeof messages !== 'object' || Array.isArray(messages) || Object.values(messages).some(value => typeof value !== 'string')) throw new TypeError('Invalid plugin UI catalog');
    if (!catalogs.has(lang)) catalogs.set(lang, new Map());
    for (const [key, value] of Object.entries(messages)) catalogs.get(lang).set(`${namespace}.${key}`, value);
    revision++;
  }
  function t(key, params = {}, fallback = key) {
    const message = catalogs.get(locale)?.get(key) ?? catalogs.get('en').get(key) ?? fallback;
    return String(message).replace(/\{(\w+)\}/g, (token, name) => Object.hasOwn(params, name) ? String(params[name]) : token);
  }
  const value = message => message?.i18nKey ? t(message.i18nKey, message.i18nParams, message.fallback) : String(message ?? '');
  const attrs = ['title', 'placeholder', 'aria-label', 'alt', 'data-caption', 'data-hover-caption', 'label'];
  const bindingFor = attribute => { if (!attrs.includes(attribute)) throw new TypeError('Unsupported UI attribute'); return `data-i18n-${attribute.replace(/^data-/, '')}`; };
  const selector = ['[data-i18n]', '[data-i18n-parts]', ...attrs.map(a => `[${bindingFor(a)}]`)].join(',');
  function readParams(node, binding = 'data-i18n') {
    const params = JSON.parse(node.getAttribute(`${binding}-params`) || node.getAttribute('data-i18n-params') || '{}');
    if (!validParams(params)) throw new TypeError('Invalid UI parameters');
    return params;
  }
  function partsText(parts) {
    if (!Array.isArray(parts) || !parts.every(p => typeof p === 'string' || p && typeof p.key === 'string' && validParams(p.params))) throw new TypeError('Invalid UI parts');
    return parts.map(p => typeof p === 'string' ? p : t(p.key, p.params)).join('');
  }
  function refresh(doc = typeof document === 'object' ? document : null) {
    const nodes = [...(doc?.querySelectorAll?.(selector) || [])];
    if (doc?.matches?.(selector)) nodes.unshift(doc);
    for (const node of nodes) {
      try {
        const key = node.getAttribute('data-i18n');
        const leaf = !node.children?.length && !node.isContentEditable && !/^(INPUT|TEXTAREA|SELECT|SCRIPT|STYLE)$/.test(node.tagName) && !(node.tagName === 'OPTION' && !node.hasAttribute('value'));
        if (key && leaf) node.textContent = t(key, readParams(node), node.textContent);
        if (leaf && node.hasAttribute('data-i18n-parts')) node.textContent = partsText(JSON.parse(node.getAttribute('data-i18n-parts')));
        for (const attribute of attrs) {
          const binding = bindingFor(attribute), k = node.getAttribute(binding);
          if (k) node.setAttribute(attribute, t(k, readParams(node, binding), node.getAttribute(attribute)));
        }
      } catch { /* Malformed metadata never changes data or interrupts editing. */ }
    }
  }
  function createPresentation(namespace) {
    if (!caches.has(namespace)) caches.set(namespace, { revision: -1, exact: new Map(), patterns: [], recent: new Map() });
    const cache = caches.get(namespace);
    const message = (english, params = {}) => ({ i18nKey: `${namespace}.${keyFor(english)}`, i18nParams: scalar(params), fallback: english });
    const render = m => m?.i18nKey ? `<span data-i18n="${m.i18nKey}" data-i18n-params="${escape(JSON.stringify(m.i18nParams))}">${escape(value(m))}</span>` : escape(value(m));
    // Explicit UI formatter output only. Callers keep object names and content raw.
    function owned(text) {
      if (typeof text !== 'string') return text;
      if (cache.recent.has(text)) return cache.recent.get(text);
      if (cache.revision !== revision) {
        cache.revision = revision; cache.exact.clear(); cache.patterns = [];
        for (const [key, english] of catalogs.get('en')) {
          if (!key.startsWith(namespace + '.')) continue;
          const names = [...english.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
          if (!names.length) { cache.exact.set(english, key); continue; }
          const weight = english.replace(/\{\w+\}/g, '').length;
          if (weight < 5) continue;
          const pattern = english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '([\\s\\S]*?)');
          cache.patterns.push({ key, names, expression: new RegExp(`^${pattern}$`), weight });
        }
        cache.patterns.sort((a, b) => b.weight - a.weight);
      }
      if (cache.exact.has(text)) return { i18nKey: cache.exact.get(text), i18nParams: {} };
      for (const pattern of cache.patterns) { const match = pattern.expression.exec(text); if (match) return { i18nKey: pattern.key, i18nParams: Object.fromEntries(pattern.names.map((name, i) => [name, match[i + 1]])) }; }
      return text;
    }
    function setText(node, m) {
      if (!node) return m;
      node.removeAttribute?.('data-i18n-parts');
      if (m?.i18nKey) { node.setAttribute?.('data-i18n', m.i18nKey); node.setAttribute?.('data-i18n-params', JSON.stringify(m.i18nParams)); }
      else node.removeAttribute?.('data-i18n');
      node.textContent = value(m); return m?.i18nKey ? value(m) : m;
    }
    return { message, value, owned, render,
      englishText(m) { const original = m?.i18nKey ? catalogs.get('en').get(m.i18nKey) ?? m.fallback : m; return String(original ?? '').replace(/\{(\w+)\}/g, (token, name) => Object.hasOwn(m?.i18nParams || {}, name) ? String(m.i18nParams[name]) : token); }, clean: m => m?.i18nKey ? m : String(m || '').trim(),
      text(english, params) { const m = message(english, params), text = value(m); cache.recent.set(text, m); if (cache.recent.size > 500) cache.recent.delete(cache.recent.keys().next().value); return text; },
      svg: (english, params) => render(message(english, params)).replace(/^<span /, '<tspan ').replace(/<\/span>$/, '</tspan>'),
      textBinding(english, params) { const m = message(english, params); return `data-i18n="${m.i18nKey}" data-i18n-params="${escape(JSON.stringify(m.i18nParams))}"`; },
      plainText: (english, params) => escape(value(message(english, params))),
      html: (english, params) => render(message(english, params)), renderOwned: text => render(owned(text)), setText, setOwnedText: (node, text) => setText(node, owned(text)),
      setHtml(node, html) { if (node) { node.innerHTML = String(html ?? ''); refresh(node); } return html; },
      appendText(node, m) { if (!node) return m; let parts; try { parts = JSON.parse(node.getAttribute('data-i18n-parts') || 'null'); } catch { /* Use current visible text. */ } if (!Array.isArray(parts)) parts = node.getAttribute('data-i18n') ? [{ key: node.getAttribute('data-i18n'), params: readParams(node) }] : [String(node.textContent || '')]; parts.push(m?.i18nKey ? { key: m.i18nKey, params: m.i18nParams } : value(m)); node.removeAttribute('data-i18n'); node.setAttribute('data-i18n-parts', JSON.stringify(parts)); node.textContent = partsText(parts); return node.textContent; },
      attribute(attribute, english) { const m = message(english); return `${bindingFor(attribute)}="${m.i18nKey}" ${attribute}="${escape(value(m))}"`; },
      attributeMessage(attribute, m) { const binding = bindingFor(attribute); return m?.i18nKey ? `${binding}="${m.i18nKey}" ${binding}-params="${escape(JSON.stringify(m.i18nParams))}" ${attribute}="${escape(value(m))}"` : `${attribute}="${escape(value(m))}"`; },
      setAttribute(node, attribute, m) { if (!node) return m; const binding = bindingFor(attribute); if (m?.i18nKey) { node.setAttribute?.(binding, m.i18nKey); node.setAttribute?.(`${binding}-params`, JSON.stringify(m.i18nParams)); } else { node.removeAttribute?.(binding); node.removeAttribute?.(`${binding}-params`); } node.setAttribute?.(attribute, value(m)); if (['title','placeholder','alt'].includes(attribute)) node[attribute] = value(m); return m?.i18nKey ? value(m) : m; }
    };
  }
  root.HikariUi = { createPresentation, registerMessages: register, t, refresh, keyFor, getLocale: () => locale, setLocale(language) { let next; try { next = Intl.getCanonicalLocales(language)[0]; } catch { next = 'en'; } const resolved = catalogs.has(next) ? next : catalogs.has(next.split('-')[0]) ? next.split('-')[0] : 'en'; if (resolved === locale) return locale; locale = resolved; refresh(); for (const listener of listeners) listener(locale); return locale; }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
  for (const [namespace, messages] of Object.entries(root.HikariUiEnglish || {})) register('en', namespace, messages);
  for (const [namespace, messages] of Object.entries(root.HikariUiSpanish || {})) register('es', namespace, messages);
  if (typeof module === 'object' && module.exports) module.exports = root.HikariUi;
}(typeof window === 'object' ? window : globalThis));
