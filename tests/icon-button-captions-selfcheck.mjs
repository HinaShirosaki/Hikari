import assert from 'node:assert/strict';
import {
  applyIconButtonCaption,
  installIconButtonCaptions,
  isCaptionableIconButton
} from '../src/renderer/app/icon-button-captions.js';

function makeButton({ ariaLabel = '', title = '', text = '', hasSvg = true } = {}) {
  const attributes = new Map();
  if (ariaLabel) {
    attributes.set('aria-label', ariaLabel);
  }
  if (title) {
    attributes.set('title', title);
  }

  return {
    tagName: 'BUTTON',
    textContent: text,
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    querySelector(selector) {
      return hasSvg && selector.includes('svg') ? {} : null;
    },
    cloneNode() {
      return {
        textContent: text,
        querySelectorAll() {
          return [];
        }
      };
    }
  };
}

const iconButton = makeButton({ ariaLabel: 'Underline' });
assert.equal(isCaptionableIconButton(iconButton), true);
assert.equal(applyIconButtonCaption(iconButton), true);
assert.equal(iconButton.getAttribute('title'), 'Underline');

const explicitCaptionButton = makeButton({ ariaLabel: 'Delete sample', title: 'Delete' });
assert.equal(applyIconButtonCaption(explicitCaptionButton), false);
assert.equal(explicitCaptionButton.getAttribute('title'), 'Delete');

const textButton = makeButton({ ariaLabel: 'Edit concentration', text: 'Edit Conc.' });
assert.equal(isCaptionableIconButton(textButton), false);
assert.equal(applyIconButtonCaption(textButton), false);
assert.equal(textButton.getAttribute('title'), null);

const styledCaptionButton = makeButton({ ariaLabel: 'Open buffer preparer' });
styledCaptionButton.setAttribute('data-hover-caption', 'Buffer preparer');
assert.equal(applyIconButtonCaption(styledCaptionButton), false);
assert.equal(styledCaptionButton.getAttribute('title'), null);

const glyphButton = makeButton({ ariaLabel: 'Add sample', text: '+', hasSvg: false });
assert.equal(applyIconButtonCaption(glyphButton), true);
assert.equal(glyphButton.getAttribute('title'), 'Add sample');

const initialButton = makeButton({ ariaLabel: 'Copy selected text' });
let observer = null;
class MockMutationObserver {
  constructor(callback) {
    this.callback = callback;
    observer = this;
  }

  observe() {}
  disconnect() {}
}
const root = {
  tagName: 'BODY',
  querySelectorAll(selector) {
    return selector === 'button' ? [initialButton] : [];
  }
};
installIconButtonCaptions({
  documentObject: { body: root },
  windowObject: { MutationObserver: MockMutationObserver }
});
assert.equal(initialButton.getAttribute('title'), 'Copy selected text');

const renderedButton = makeButton({ ariaLabel: 'Remove attachment', text: '×', hasSvg: false });
observer.callback([{ type: 'childList', addedNodes: [renderedButton] }]);
assert.equal(renderedButton.getAttribute('title'), 'Remove attachment');

initialButton.setAttribute('aria-label', 'Copied');
observer.callback([{ type: 'attributes', target: initialButton }]);
assert.equal(initialButton.getAttribute('title'), 'Copied');

console.log('icon-button-captions-selfcheck: ok');
