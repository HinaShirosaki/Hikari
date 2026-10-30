import { i18n } from './index.js';
import { escapeHtml } from '../html.js';
import { ATTRIBUTE_BINDINGS, setTranslatedText, setTranslatedAttribute, translateTree, translatedParts } from './dom.js';
import { messageSpan } from './markup.js';

// Source-owned presentation messages. The extraction tool writes these stable
// IDs into the owning module's English catalog; user content is never looked up.
export function presentationKey(text) {
  let hash = 2166136261;
  const source = String(text);
  for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return `full.${(hash >>> 0).toString(16)}`;
}
const parameters = values => Object.fromEntries(Object.entries(values || {}).map(([key, value]) => [key,
  typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean' || typeof value === 'string' ? value : String(value)
]));
const namespacePresentations = new Map();

export function createPresentation(namespace) {
  if (!namespacePresentations.has(namespace)) namespacePresentations.set(namespace, { recent: new Map(), revision: -1, exact: new Map(), patterns: [], known: new Set() });
  const cache = namespacePresentations.get(namespace);
  function message(english, params = {}) {
    const id = presentationKey(english), i18nKey = `${namespace}.${id}`;
    // Copy missing from the catalog renders (and refreshes to) its English
    // source in every helper below, never the raw key.
    if (!cache.known.has(i18nKey)) {
      if (!i18n.has(i18nKey)) i18n.registerMessages('en', namespace, { [id]: String(english) });
      cache.known.add(i18nKey);
    }
    return { i18nKey, i18nParams: parameters(params), fallback: english };
  }
  const text = value => value?.i18nParts ? translatedParts(value.i18nParts) : value?.i18nKey ? i18n.t(value.i18nKey, value.i18nParams, value.fallback) : String(value ?? '');
  // Explicit UI-owned formatter output only: never call this for record names,
  // editor contents, prompts, sequences or other user-owned fields.
  function owned(value) {
    if (value?.i18nKey || typeof value !== 'string') return value;
    if (cache.recent.has(value)) return cache.recent.get(value);
    if (cache.revision !== i18n.catalogRevision()) {
      cache.revision = i18n.catalogRevision(); cache.exact.clear(); cache.patterns = [];
      for (const [key, english] of i18n.englishEntries(namespace)) {
        if (typeof english !== 'string' || !english) continue;
        const names = [...english.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
        if (!names.length) { if (!cache.exact.has(english)) cache.exact.set(english, key); continue; }
        const escaped = english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '([\\s\\S]*?)');
        cache.patterns.push({ key, names, expression: new RegExp(`^${escaped}$`), weight: english.replace(/\{\w+\}/g, '').length });
      }
      cache.patterns.sort((a, b) => b.weight - a.weight);
    }
    const exact = cache.exact.get(value);
    if (exact) return { i18nKey: exact, i18nParams: {} };
    for (const pattern of cache.patterns) {
      if (pattern.weight < 5) continue;
      const match = pattern.expression.exec(value);
      if (match) return { i18nKey: pattern.key, i18nParams: Object.fromEntries(pattern.names.map((name, i) => [name, match[i + 1]])) };
    }
    return value;
  }
  const bind = (element, value) => {
    if (!element) return value;
    element.removeAttribute?.('data-i18n-parts');
    if (value?.i18nParts) {
      element.removeAttribute?.('data-i18n');
      element.setAttribute?.('data-i18n-parts', JSON.stringify(value.i18nParts));
      element.textContent = text(value);
    } else if (value?.i18nKey) setTranslatedText(element, value.i18nKey, value.i18nParams);
    else {
      element.removeAttribute?.('data-i18n');
      if (!Object.keys(ATTRIBUTE_BINDINGS).some(binding => element.hasAttribute?.(binding))) element.removeAttribute?.('data-i18n-params');
      element.textContent = text(value);
    }
    return value?.i18nKey || value?.i18nParts ? text(value) : value;
  };
  return {
    message,
    compose(parts) { return { i18nParts: parts.flatMap(part => part?.i18nParts || [part?.i18nKey ? { key: part.i18nKey, params: part.i18nParams } : text(part)]) }; },
    text(english, params) {
      const value = message(english, params), rendered = text(value);
      cache.recent.set(rendered, value);
      if (cache.recent.size > 500) cache.recent.delete(cache.recent.keys().next().value);
      return rendered;
    },
    value: text,
    owned,
    renderOwned: value => { const message = owned(value); return message?.i18nKey ? messageSpan(message.i18nKey, message.i18nParams) : escapeHtml(text(value)); },
    clean: value => value?.i18nKey || value?.i18nParts ? value : String(value || '').trim(),
    html: (english, params) => { const value = message(english, params); return messageSpan(value.i18nKey, value.i18nParams); },
    render: value => value?.i18nParts ? `<span data-i18n-parts="${escapeHtml(JSON.stringify(value.i18nParts))}">${escapeHtml(text(value))}</span>` : value?.i18nKey ? messageSpan(value.i18nKey, value.i18nParams) : escapeHtml(text(value)),
    svg(english, params) {
      const value = message(english, params);
      return `<tspan data-i18n="${escapeHtml(value.i18nKey)}" data-i18n-params="${escapeHtml(JSON.stringify(value.i18nParams))}">${escapeHtml(text(value))}</tspan>`;
    },
    textBinding(english, params) { const value = message(english, params); return `data-i18n="${escapeHtml(value.i18nKey)}" data-i18n-params="${escapeHtml(JSON.stringify(value.i18nParams))}"`; },
    plainText: (english, params) => escapeHtml(text(message(english, params))),
    option(value, label) {
      const binding = label?.i18nKey ? ` data-i18n="${escapeHtml(label.i18nKey)}" data-i18n-params="${escapeHtml(JSON.stringify(label.i18nParams))}"` : '';
      return `<option value="${escapeHtml(value)}"${binding}>${escapeHtml(text(label))}</option>`;
    },
    attribute(attribute, english) {
      if (!['title', 'placeholder', 'aria-label', 'alt', 'data-caption', 'data-hover-caption', 'label'].includes(attribute)) throw new TypeError('Unsupported UI attribute');
      const value = message(english);
      return `data-i18n-${attribute.replace(/^data-/, '')}="${value.i18nKey}" ${attribute}="${escapeHtml(text(value))}"`;
    },
    attributeMessage(attribute, value) {
      if (!['title', 'placeholder', 'aria-label', 'alt', 'data-caption', 'data-hover-caption', 'label'].includes(attribute)) throw new TypeError('Unsupported UI attribute');
      if (value?.i18nParts) return `data-i18n-${attribute.replace(/^data-/, '')}-parts="${escapeHtml(JSON.stringify(value.i18nParts))}" ${attribute}="${escapeHtml(text(value))}"`;
      if (!value?.i18nKey) return `${attribute}="${escapeHtml(text(value))}"`;
      const binding = `data-i18n-${attribute.replace(/^data-/, '')}`;
      return `${binding}="${value.i18nKey}" ${binding}-params="${escapeHtml(JSON.stringify(value.i18nParams))}" ${attribute}="${escapeHtml(text(value))}"`;
    },
    setText: bind,
    setOwnedText: (element, value) => bind(element, owned(value)),
    setHtml(element, html) {
      if (!element) return html;
      element.innerHTML = String(html ?? '');
      translateTree(element);
      return html;
    },
    appendText(element, value) {
      if (!element) return value;
      let previous;
      try { previous = JSON.parse(element.getAttribute?.('data-i18n-parts') || 'null'); } catch { /* Raw output is preserved below. */ }
      if (!Array.isArray(previous)) {
        const key = element.getAttribute?.('data-i18n');
        let params = {};
        try { params = JSON.parse(element.getAttribute?.('data-i18n-params') || '{}'); } catch { /* Existing visible text is the fallback. */ }
        previous = key ? [{ key, params }] : [String(element.textContent || '')];
      }
      const parts = [...previous, value?.i18nKey ? { key: value.i18nKey, params: value.i18nParams } : text(value)];
      element.removeAttribute?.('data-i18n');
      element.removeAttribute?.('data-i18n-params');
      element.setAttribute?.('data-i18n-parts', JSON.stringify(parts));
      element.textContent = parts.map(part => typeof part === 'string' ? part : i18n.t(part.key, part.params)).join('');
      return element.textContent;
    },
    setAttribute(element, attribute, value) {
      if (!element) return;
      if (value?.i18nParts) {
        const binding = `data-i18n-${attribute.replace(/^data-/, '')}`;
        if (!Object.values(ATTRIBUTE_BINDINGS).includes(attribute)) throw new TypeError('Unsupported UI attribute');
        element.removeAttribute?.(binding);
        element.setAttribute?.(`${binding}-parts`, JSON.stringify(value.i18nParts));
        element.setAttribute?.(attribute, text(value));
      } else if (value?.i18nKey) setTranslatedAttribute(element, attribute, value.i18nKey, value.i18nParams);
      else {
        const binding = `data-i18n-${attribute.replace(/^data-/, '')}`;
        element.removeAttribute?.(binding);
        element.removeAttribute?.(`${binding}-params`);
        element.removeAttribute?.(`${binding}-parts`);
        element.setAttribute?.(attribute, text(value));
        if (['title', 'placeholder', 'alt'].includes(attribute)) element[attribute] = text(value);
      }
      return value?.i18nKey ? text(value) : value;
    }
  };
}
