import { escapeHtml } from '../html.js';
import { i18n } from './index.js';
import { ATTRIBUTE_BINDINGS, translatedDate } from './dom.js';

// Generated labels remain bound during a locale switch; no result container,
// form, graph, or list needs to be rebuilt just to change its UI text.
export function messageSpan(key, params = {}) {
  return `<span data-i18n="${escapeHtml(key)}" data-i18n-params="${escapeHtml(JSON.stringify(params))}">${escapeHtml(i18n.t(key, params))}</span>`;
}

export function messageAttributes(bindings, params = {}) {
  const attributes = Object.entries(bindings).map(([attribute, key]) => {
    const binding = Object.keys(ATTRIBUTE_BINDINGS).find(name => ATTRIBUTE_BINDINGS[name] === attribute);
    if (!binding) throw new TypeError(`Unsupported translated attribute: ${attribute}`);
    return `${binding}="${escapeHtml(key)}" ${attribute}="${escapeHtml(i18n.t(key, params))}"`;
  });
  return [...attributes, `data-i18n-params="${escapeHtml(JSON.stringify(params))}"`].join(' ');
}

export function dateSpan(value, fallback, options = {}) {
  return `<span data-i18n-date="${escapeHtml(value)}" data-i18n-date-fallback="${escapeHtml(fallback)}" data-i18n-date-options="${escapeHtml(JSON.stringify(options))}">${escapeHtml(translatedDate(value, fallback, options))}</span>`;
}
