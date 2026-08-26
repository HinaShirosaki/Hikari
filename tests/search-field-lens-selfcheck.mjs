import assert from 'node:assert/strict';
import {
  applySearchFieldLens,
  installSearchFieldLens,
  runSearchInput
} from '../src/renderer/lib/search-field-lens.js';

class FakeKeyboardEvent {
  constructor(type, init = {}) {
    Object.assign(this, init);
    this.type = type;
  }
}

function makeDocument() {
  const documentObject = {
    defaultView: { KeyboardEvent: FakeKeyboardEvent, MutationObserver: null },
    createElement(tagName) {
      return makeElement(documentObject, tagName.toUpperCase());
    }
  };
  return documentObject;
}

function makeElement(documentObject, tagName, attributes = {}) {
  const element = {
    tagName,
    ownerDocument: documentObject,
    parentNode: null,
    children: [],
    attributes: new Map(Object.entries(attributes)),
    listeners: new Map(),
    dispatched: [],
    focused: 0,
    get classList() {
      const names = String(element.className || '').split(/\s+/).filter(Boolean);
      return { contains: (name) => names.includes(name) };
    },
    getAttribute: (name) => element.attributes.get(name) ?? null,
    setAttribute(name, value) { element.attributes.set(name, String(value)); },
    addEventListener(type, handler) { element.listeners.set(type, handler); },
    dispatchEvent(event) { element.dispatched.push(event); return true; },
    focus() { element.focused += 1; },
    insertBefore(node, reference) {
      const index = element.children.indexOf(reference);
      element.children.splice(index < 0 ? element.children.length : index, 0, node);
      node.parentNode = element;
    },
    appendChild(node) {
      node.parentNode?.children?.splice(node.parentNode.children.indexOf(node), 1);
      element.children.push(node);
      node.parentNode = element;
      return node;
    },
    querySelectorAll(selector) {
      const matches = [];
      const walk = (node) => node.children.forEach((child) => {
        if (selector === 'input[type="search"]'
          && child.tagName === 'INPUT'
          && child.getAttribute('type') === 'search') {
          matches.push(child);
        }
        walk(child);
      });
      walk(element);
      return matches;
    }
  };
  return element;
}

// A search input gets wrapped once, and the lens replays Enter on it.
const documentObject = makeDocument();
const host = makeElement(documentObject, 'DIV');
const input = makeElement(documentObject, 'INPUT', { type: 'search' });
host.appendChild(input);

assert.equal(applySearchFieldLens(input), true);
const field = host.children[0];
assert.equal(field.className, 'search-field');
assert.equal(field.children[0], input);

const lens = field.children[1];
assert.equal(lens.tagName, 'BUTTON');
assert.equal(lens.getAttribute('aria-label'), 'Search');
lens.listeners.get('click')();
assert.equal(input.focused, 1);
assert.equal(input.dispatched.length, 1);
assert.equal(input.dispatched[0].type, 'keydown');
assert.equal(input.dispatched[0].key, 'Enter');
assert.equal(input.dispatched[0].bubbles, true);

// Wrapping is idempotent, so a re-scan never nests a second lens.
assert.equal(applySearchFieldLens(input), false);
assert.equal(field.children.length, 2);

// Non-search inputs are left alone.
const textInput = makeElement(documentObject, 'INPUT', { type: 'text' });
host.appendChild(textInput);
assert.equal(applySearchFieldLens(textInput), false);
assert.equal(textInput.parentNode, host);

// Inputs rendered after boot are wrapped by the observer, not by callers.
let observer = null;
class MockMutationObserver {
  constructor(callback) {
    this.callback = callback;
    observer = this;
  }

  observe() {}
  disconnect() {}
}
const bootDocument = makeDocument();
const body = makeElement(bootDocument, 'BODY');
const bootInput = makeElement(bootDocument, 'INPUT', { type: 'search' });
body.appendChild(bootInput);
installSearchFieldLens({
  documentObject: { body, createElement: bootDocument.createElement },
  windowObject: { MutationObserver: MockMutationObserver }
});
assert.equal(bootInput.parentNode.className, 'search-field');

const lateHost = makeElement(bootDocument, 'DIV');
const lateInput = makeElement(bootDocument, 'INPUT', { type: 'search' });
lateHost.appendChild(lateInput);
body.appendChild(lateHost);
observer.callback([{ addedNodes: [lateHost] }]);
assert.equal(lateInput.parentNode.className, 'search-field');

// Without a KeyboardEvent constructor the lens degrades instead of throwing.
assert.equal(runSearchInput({ ownerDocument: {}, dispatchEvent() {} }), false);

console.log('search-field-lens-selfcheck: ok');
