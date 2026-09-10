import assert from 'node:assert/strict';
import { createNotebookPdfSettingsController } from '../src/renderer/modules/settings/notebook-pdf-controller.js';

const state = {
  settings: {
    notebookPdf: {
      pageSize: 'a4',
      stapleEdge: 'top'
    }
  }
};
const pageSizeInput = { value: '' };
const stapleEdgeInput = { value: '' };
let persistCalls = 0;
const controller = createNotebookPdfSettingsController({
  state,
  persist: () => { persistCalls += 1; },
  pageSizeInput,
  stapleEdgeInput
});

controller.render();
assert.equal(pageSizeInput.value, 'a4');
assert.equal(stapleEdgeInput.value, 'top');

pageSizeInput.value = 'legal';
stapleEdgeInput.value = 'left';
let prevented = false;
controller.save({ preventDefault: () => { prevented = true; } });
assert.equal(prevented, true);
assert.equal(state.settings.notebookPdf.pageSize, 'legal');
assert.equal(state.settings.notebookPdf.stapleEdge, 'left');
assert.equal(persistCalls, 1);

pageSizeInput.value = 'poster';
stapleEdgeInput.value = 'right';
controller.save({ preventDefault() {} });
assert.equal(state.settings.notebookPdf.pageSize, 'letter');
assert.equal(state.settings.notebookPdf.stapleEdge, 'none');
assert.equal(persistCalls, 2);

console.log('notebook PDF settings selfcheck passed');
