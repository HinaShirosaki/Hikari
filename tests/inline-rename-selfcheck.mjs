import assert from 'node:assert/strict';
import { startInlineRename } from '../src/renderer/lib/folder-tree.js';

// Minimal stand-in for the row DOM the folder trees hand to startInlineRename.
function createRow() {
  const doc = {
    createElement() {
      return {
        style: {},
        attributes: new Map(),
        listeners: {},
        value: '',
        setAttribute(name, value) {
          this.attributes.set(name, value);
        },
        addEventListener(type, listener) {
          (this.listeners[type] = this.listeners[type] || []).push(listener);
        },
        dispatch(type, event = {}) {
          (this.listeners[type] || []).forEach((listener) => listener({
            preventDefault() {},
            stopPropagation() {},
            ...event
          }));
        },
        focus() {
          this.focused = true;
        },
        select() {
          this.selected = true;
        },
        remove() {
          this.parentNode.children = this.parentNode.children.filter((item) => item !== this);
          this.removed = true;
        }
      };
    }
  };
  const parent = {
    children: [],
    insertBefore(node) {
      node.parentNode = parent;
      parent.children.push(node);
      return node;
    }
  };
  const target = { style: { display: 'grid' }, ownerDocument: doc, parentNode: parent };
  return { parent, target };
}

function rename(finish, nextValue = 'Renamed') {
  const committed = [];
  const { parent, target } = createRow();
  const input = startInlineRename(target, {
    value: 'Original',
    onCommit: (name) => committed.push(name)
  });
  assert.equal(input.value, 'Original');
  assert.equal(input.focused, true, 'the input takes focus');
  assert.equal(input.selected, true, 'the current name starts selected');
  assert.equal(target.style.display, 'none', 'the row control is hidden while editing');
  assert.equal(parent.children.length, 1);
  input.value = nextValue;
  finish(input);
  assert.equal(target.style.display, 'grid', 'the row control comes back');
  assert.equal(parent.children.length, 0, 'the input is removed');
  return committed;
}

assert.deepEqual(rename((input) => input.dispatch('keydown', { key: 'Enter' })), ['Renamed']);
assert.deepEqual(rename((input) => input.dispatch('blur')), ['Renamed']);
assert.deepEqual(rename((input) => input.dispatch('keydown', { key: 'Escape' })), []);
// Escape then the blur that follows losing focus must not commit after all.
assert.deepEqual(rename((input) => {
  input.dispatch('keydown', { key: 'Escape' });
  input.dispatch('blur');
}), []);
assert.equal(startInlineRename(null, {}), null, 'a missing row is a no-op');

console.log('inline-rename-selfcheck passed');
