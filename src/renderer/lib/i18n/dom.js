import { i18n as appI18n } from './index.js';

export const ATTRIBUTE_BINDINGS = Object.freeze({
  'data-i18n-title': 'title',
  'data-i18n-placeholder': 'placeholder',
  'data-i18n-aria-label': 'aria-label',
  'data-i18n-aria-valuetext': 'aria-valuetext',
  'data-i18n-alt': 'alt',
  'data-i18n-caption': 'data-caption',
  'data-i18n-hover-caption': 'data-hover-caption',
  // <optgroup label>: plain text, never a URL or handler.
  'data-i18n-label': 'label'
});
const SELECTOR = ['[data-i18n]', '[data-i18n-parts]', '[data-i18n-date]', ...Object.keys(ATTRIBUTE_BINDINGS).flatMap(name => [`[${name}]`, `[${name}-parts]`])].join(',');

export function translatedDate(value, fallback, options = {}, translator = appI18n) {
  if (translator.getLocale() === 'en') return fallback;
  try {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? translator.formatDate(date, options) : fallback;
  } catch {
    return fallback;
  }
}

function translationParams(element) {
  const raw = element.getAttribute?.('data-i18n-params');
  if (!raw) return {};
  try {
    const params = JSON.parse(raw);
    return params && typeof params === 'object' && !Array.isArray(params)
      && Object.values(params).every(value => ['string', 'number', 'boolean'].includes(typeof value))
      ? params : null;
  } catch {
    return null;
  }
}

export function translatedParts(raw, translator = appI18n) {
  const parts = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(parts) || !parts.every(part => typeof part === 'string' || (
    part && typeof part.key === 'string' && part.params && typeof part.params === 'object' && !Array.isArray(part.params)
    && Object.values(part.params).every(value => ['string', 'number', 'boolean'].includes(typeof value))
  ))) throw new TypeError('Invalid presentation parts');
  return parts.map(part => typeof part === 'string' ? part : translator.t(part.key, part.params)).join('');
}

export function setTranslatedText(element, key, params = {}, translator = appI18n) {
  if (!element) return;
  element.removeAttribute?.('data-i18n-parts');
  element.setAttribute?.('data-i18n', key);
  element.setAttribute?.('data-i18n-params', JSON.stringify(params));
  element.textContent = translator.t(key, params);
}

export function setTranslatedAttribute(element, attribute, key, params = {}, translator = appI18n) {
  if (!element) return;
  const binding = Object.keys(ATTRIBUTE_BINDINGS).find(name => ATTRIBUTE_BINDINGS[name] === attribute);
  if (!binding) throw new TypeError(`Unsupported translated attribute: ${attribute}`);
  element.removeAttribute?.(`${binding}-parts`);
  // A numbered row can bind both its aria-label and a computed placeholder.
  // Preserve their shared index when adding quantity/message parameters.
  const merged = { ...(translationParams(element) || {}), ...params };
  element.setAttribute?.(binding, key);
  element.setAttribute?.(`${binding}-params`, JSON.stringify(merged));
  const text = translator.t(key, merged);
  element.setAttribute?.(attribute, text);
  if (['placeholder', 'title', 'alt'].includes(attribute)) element[attribute] = text;
}

// Opt-in leaves and a small attribute allowlist only. Never walk text nodes,
// use innerHTML, change form values, or replace a container's child controls.
export function translateTree(root, translator = appI18n) {
  if (!root) return;
  const elements = [...(root.querySelectorAll?.(SELECTOR) || [])];
  if (root.matches?.(SELECTOR)) elements.unshift(root);
  for (const element of elements) {
    if (typeof element.getAttribute !== 'function') continue;
    const params = translationParams(element);
    if (!params) continue;
    const key = element.getAttribute('data-i18n');
    const canTranslateText = !element.children?.length && !element.isContentEditable
      && !element.matches?.('input, textarea, select, script, style')
      && !(element.matches?.('option') && !element.hasAttribute('value'));
    if (key && canTranslateText && translator.has(key)) {
      const text = translator.t(key, params);
      if (element.textContent !== text) element.textContent = text;
    }
    if (canTranslateText && element.hasAttribute?.('data-i18n-parts')) {
      try {
        element.textContent = translatedParts(element.getAttribute('data-i18n-parts'), translator);
      } catch { /* Malformed presentation metadata never changes the current UI. */ }
    }
    const dateValue = element.getAttribute('data-i18n-date');
    if (dateValue && canTranslateText) {
      try {
        const fallback = element.getAttribute('data-i18n-date-fallback') || '';
        const options = JSON.parse(element.getAttribute('data-i18n-date-options') || '{}');
        if (options && typeof options === 'object' && !Array.isArray(options)) {
          const text = translatedDate(dateValue, fallback, options, translator);
          if (element.textContent !== text) element.textContent = text;
        }
      } catch { /* Invalid formatting metadata must not affect editing. */ }
    }
    for (const [source, target] of Object.entries(ATTRIBUTE_BINDINGS)) {
      if (element.hasAttribute?.(`${source}-parts`)) {
        try { element.setAttribute(target, translatedParts(element.getAttribute(`${source}-parts`), translator)); } catch { /* Keep malformed bindings unchanged. */ }
        continue;
      }
      const attributeKey = element.getAttribute(source);
      if (attributeKey && translator.has(attributeKey)) {
        let attributeParams = params;
        try {
          const raw = element.getAttribute(`${source}-params`);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.values(parsed).every(value => ['string', 'number', 'boolean'].includes(typeof value))) continue;
            attributeParams = parsed;
          }
        } catch { continue; }
        const text = translator.t(attributeKey, attributeParams);
        if (element.getAttribute(target) !== text) element.setAttribute(target, text);
      }
    }
  }
}

export function bindTranslations(root, translator = appI18n) {
  const refresh = () => translateTree(root, translator);
  refresh();
  const disconnect = translator.subscribe(refresh);
  return { refresh, disconnect };
}
