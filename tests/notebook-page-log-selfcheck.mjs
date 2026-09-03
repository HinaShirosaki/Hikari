// Self-check: the notebook page audit log records what actually changed.
// Two regressions this pins down: `values` is rebuilt from a DOM query on
// every save, so key reordering used to log a phantom edit, and
// `toolCalculations` had no describer, so both sides logged "[object Object]".
import assert from 'node:assert/strict';

const warnings = [];
globalThis.window = {
  hikariApi: {
    appendNotebookPageLog: async (payload) => {
      appended.push(payload);
      return { ok: true };
    }
  }
};
const appended = [];
console.warn = (...args) => warnings.push(args.join(' '));

const {
  changedFieldList,
  describeNotebookEntryChanges,
  logNotebookPageEvent
} = await import('../src/renderer/modules/biology-notebook/storage/page-log.js');

const calculation = (result) => ({
  id: 'calc-1', type: 'dilution', title: 'Dilution', result, summary: '', inputs: {}
});

// Reordered keys and reordered-but-identical objects are not an edit.
const unchanged = describeNotebookEntryChanges(
  { values: { 's1:p1': 'x', 's1:p2': 'y' }, sampleLinks: [{ placeholderKey: 's1:p1', sampleId: 'sm1' }] },
  { values: { 's1:p2': 'y', 's1:p1': 'x' }, sampleLinks: [{ sampleId: 'sm1', placeholderKey: 's1:p1' }] }
);
assert.deepEqual(changedFieldList(unchanged), [], 'key order alone is not a change');

// A real value edit still lands, split into added / removed / modified.
const valueChange = describeNotebookEntryChanges(
  { values: { 's1:p1': 'x', 's1:gone': 'g' } },
  { values: { 's1:p1': 'z', 's1:new': 'n' } }
);
assert.deepEqual(changedFieldList(valueChange), ['values']);
assert.deepEqual(valueChange.values.added, { 's1:new': 'n' });
assert.deepEqual(valueChange.values.removed, { 's1:gone': 'g' });
assert.deepEqual(valueChange.values.modified, { 's1:p1': { before: 'x', after: 'z' } });

// Tool calculations diff by id and report the changed result, not "[object Object]".
const calcChange = describeNotebookEntryChanges(
  { toolCalculations: [calculation('12 uL')] },
  { toolCalculations: [calculation('99 uL'), { id: 'calc-2', type: 'molarity', title: 'Molarity', result: '5 mM' }] }
);
assert.deepEqual(changedFieldList(calcChange), ['toolCalculations']);
assert.equal(calcChange.toolCalculations.beforeCount, 1);
assert.equal(calcChange.toolCalculations.afterCount, 2);
assert.equal(calcChange.toolCalculations.added[0].title, 'Molarity');
assert.deepEqual(
  [calcChange.toolCalculations.modified[0].before.result, calcChange.toolCalculations.modified[0].after.result],
  ['12 uL', '99 uL']
);
assert.equal(
  JSON.stringify(calcChange).includes('[object Object]'),
  false,
  'no field may degrade to a stringified object'
);

// Reordering a list is not an edit either, but a dropped entry is.
const reordered = describeNotebookEntryChanges(
  { toolCalculations: [calculation('12 uL'), { id: 'calc-2', type: 'molarity', title: 'Molarity' }] },
  { toolCalculations: [{ id: 'calc-2', type: 'molarity', title: 'Molarity' }, calculation('12 uL')] }
);
assert.deepEqual(changedFieldList(reordered), [], 'list order alone is not a change');

// A skipped write warns instead of vanishing.
const outside = await logNotebookPageEvent({
  entry: { id: 'n1', storageFolder: '/root/Other/Notebook/page' },
  storagePath: '/root/Storage',
  action: 'update'
});
assert.equal(outside.ok, false);
assert.equal(appended.length, 0, 'a folder outside the storage root is never written');
assert.equal(warnings.length, 1, 'a skipped log write warns');

const written = await logNotebookPageEvent({
  entry: { id: 'n1', storageFolder: '/root/Storage/Project/Atlas/Notebook/page' },
  storagePath: '/root/Storage',
  action: 'delete',
  summary: 'Deleted notebook page',
  details: { reason: 'protocol-deleted' }
});
assert.equal(written.ok, true);
assert.equal(appended.length, 1);
assert.equal(appended[0].action, 'delete');
assert.deepEqual(appended[0].details, { reason: 'protocol-deleted' });
assert.equal(warnings.length, 1, 'a successful write stays quiet');

console.log('notebook page log selfcheck OK');
