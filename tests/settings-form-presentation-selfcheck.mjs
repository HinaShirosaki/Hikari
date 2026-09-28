import assert from 'node:assert/strict';
import { createSettingsFormPresentation } from '../src/renderer/modules/settings/form-presentation.js';

function control(properties = {}) {
  const listeners = new Map();
  return {
    ...properties,
    addEventListener(type, callback) { listeners.set(type, callback); },
    async emit(type) { await listeners.get(type)?.({ preventDefault() {} }); }
  };
}
function form(id, inputs) {
  const submit = control();
  const discard = control();
  const status = control();
  const element = control({
    id,
    querySelectorAll: () => inputs,
    querySelector: (selector) => ({
      '[type="submit"]': submit,
      '[data-settings-discard]': discard,
      '[data-settings-save-status]': status
    })[selector]
  });
  return { element, submit, discard, status };
}
const input = control({ id: 'font', value: '16' });
const checkbox = control({ id: 'remember', type: 'checkbox', checked: false });
const appearance = form('appearance-form', [input]);
const startup = form('startup-form', [checkbox]);
const presentation = createSettingsFormPresentation({
  document: { getElementById: () => null, querySelectorAll: () => [] },
  onRestoreModel: () => {}
});
let saveCount = 0;
let release;
let rejectSave = false;
presentation.bind(appearance.element, async () => {
  saveCount += 1;
  if (rejectSave) throw new Error('Persistence unavailable');
  await new Promise(resolve => { release = resolve; });
});
presentation.bind(startup.element, () => {});
presentation.rendered(new Map());
assert.equal(appearance.submit.disabled, true);
input.value = '18';
await appearance.element.emit('input');
checkbox.checked = true;
await startup.element.emit('change');
assert.equal(appearance.status.textContent, 'Unsaved changes');
const drafts = presentation.captureDrafts();
input.value = '14'; // A refresh picks up a newly persisted baseline.
checkbox.checked = false;
presentation.rendered(drafts);
assert.equal(input.value, '18', 'refresh preserves an unsaved value');
assert.equal(checkbox.checked, true, 'refresh preserves checkbox drafts independently');
await appearance.discard.emit('click');
assert.equal(input.value, '14', 'discard restores the latest persisted baseline');
assert.equal(checkbox.checked, true, 'discard is scoped to its own form');
input.value = '18';
await appearance.element.emit('change');
const pendingSave = appearance.element.emit('submit');
assert.equal(appearance.element.inert, true);
assert.equal(appearance.status.textContent, 'Saving…');
await appearance.element.emit('submit');
assert.equal(saveCount, 1, 'a second submit cannot start another pending save');
release();
await pendingSave;
assert.equal(appearance.status.textContent, 'Changes saved');
assert.equal(appearance.submit.disabled, true);
assert.equal(appearance.element.inert, false);
input.value = '16';
await appearance.element.emit('input');
rejectSave = true;
await appearance.element.emit('submit');
assert.match(appearance.status.textContent, /Could not save/);
assert.equal(appearance.submit.disabled, false, 'failure remains retryable');
assert.equal(appearance.element.inert, false);
await appearance.discard.emit('click');
assert.equal(input.value, '18', 'a failed save does not replace the committed baseline');
console.log('Settings form presentation selfcheck passed.');
