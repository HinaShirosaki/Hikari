import { createPresentation } from "../../../lib/i18n/presentation.js";
import "../localization.js";
const i18nUi = createPresentation("notebook");
function getElement(doc, id) {
  return doc?.getElementById?.(id) || null;
}

function addListener(element, eventName, handler, options) {
  if (element && typeof element.addEventListener === 'function') {
    element.addEventListener(eventName, handler, options);
  }
}

function setText(element, value) {
  if (element) {
    i18nUi.setOwnedText(element, String(value || ''));
  }
}

function inputValue(element) {
  return element?.value ?? '';
}

function isHidden(element) {
  return Boolean(element?.hidden);
}

export { addListener, getElement, inputValue, isHidden, setText };
