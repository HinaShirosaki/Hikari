// Self-check: Add Table asks for its size in a popover pinned to its own
// button -- the toolbox floats, so a fixed spot on the page would not do.
const path = require('node:path');
const assert = require('node:assert/strict');
const { createMockDocument, loadEsmStyleModule, trigger } = require('./support/runtime.js');
const ROOT = path.join(__dirname, '..');

function build({ anchorRect, viewport }) {
  const document = createMockDocument([
    'biology-notebook-project-select','biology-notebook-protocol-search','biology-notebook-protocol-select',
    'biology-notebook-page-starter','biology-notebook-page-starter-project','biology-notebook-empty-state',
    'biology-notebook-protocol-area','biology-notebook-protocol-title','biology-notebook-protocol-meta',
    'biology-notebook-export-btn','biology-notebook-mark-executed-btn','biology-notebook-steps',
    'biology-notebook-result','biology-notebook-result-file','biology-notebook-layout',
    'biology-notebook-tool-sidebar','biology-notebook-tool-fold-toggle','biology-notebook-tool-collapse-btn',
    'biology-notebook-tool-workspace','biology-notebook-tool-calculations','save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn','biology-notebook-entry-list',
    'biology-notebook-add-table-btn','biology-notebook-table-size-overlay','biology-notebook-table-size-form',
    'biology-notebook-table-size-columns','biology-notebook-table-size-rows'
  ]);
  const documentListeners = new Map();
  document.addEventListener = (type, handler) => {
    documentListeners.set(type, (documentListeners.get(type) || []).concat(handler));
  };
  const fireOnDocument = (type, event) => (documentListeners.get(type) || []).forEach((h) => h(event));
  document.querySelector = (s) => (s === '[data-notebook-tool-sidebar]' ? document.getElementById('biology-notebook-tool-sidebar') : null);
  document.documentElement = { clientWidth: viewport.w, clientHeight: viewport.h };
  document.body.contains = () => false;
  document.getElementById('biology-notebook-add-table-btn').getBoundingClientRect = () => anchorRect;
  const popover = document.getElementById('biology-notebook-table-size-overlay');
  popover.getBoundingClientRect = () => ({ width: 184, height: 120 });
  popover.contains = () => false;
  const state = { projects:[], protocols:[], notebookEntries:[], assays:[], gelAnalyses:[], settings:{storagePath:''} };
  const mod = loadEsmStyleModule(path.join(ROOT,'src','renderer','modules','biology-notebook','index.js'),
    { document, window: { hikariApi: {}, innerWidth: viewport.w, innerHeight: viewport.h, addEventListener(){}, } });
  mod.initLabNotebook({ state, persist:()=>{}, createId:()=>'x', safeText:(v)=>String(v??''), onNotebookEntriesChanged:()=>{} });
  return { document, popover, fireOnDocument };
}

// Room on the right: the popover sits just past the button.
let { document, popover, fireOnDocument } = build({ anchorRect: { left: 300, right: 340, top: 200 }, viewport: { w: 1200, h: 800 } });
trigger(document.getElementById('biology-notebook-add-table-btn'), 'click');
assert.equal(popover.hidden, false);
assert.equal(popover.style.left, '348px', 'sits 8px to the right of the button');
assert.equal(popover.style.top, '200px', 'lines up with the button top');

// No room on the right: it flips to the button's left.
({ document, popover, fireOnDocument } = build({ anchorRect: { left: 1100, right: 1150, top: 200 }, viewport: { w: 1200, h: 800 } }));
trigger(document.getElementById('biology-notebook-add-table-btn'), 'click');
assert.equal(popover.style.left, '908px', 'flips to the left of the button');

// Near the bottom: it lifts to stay on screen.
({ document, popover, fireOnDocument } = build({ anchorRect: { left: 300, right: 340, top: 760 }, viewport: { w: 1200, h: 800 } }));
trigger(document.getElementById('biology-notebook-add-table-btn'), 'click');
assert.equal(popover.style.top, '672px', 'clamped above the viewport edge');

// Escape closes it.
fireOnDocument('keydown', { key: 'Escape' });
assert.equal(popover.hidden, true, 'Escape closes the popover');

// A click outside closes it; a click inside does not.
trigger(document.getElementById('biology-notebook-add-table-btn'), 'click');
assert.equal(popover.hidden, false);
popover.contains = (node) => node === popover;
fireOnDocument('click', { target: popover });
assert.equal(popover.hidden, false, 'a click inside the popover keeps it open');
fireOnDocument('click', { target: document.getElementById('biology-notebook-steps') });
assert.equal(popover.hidden, true, 'a click outside closes it');

console.log('table-size popover selfcheck OK');
