import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installDialogLayout, measureDialogTopClearance } from '../src/renderer/app/dialog-layout.js';
import { initNotebookWidget } from '../src/renderer/modules/home-dashboard/notebook.js';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const [
  dialogCss,
  gelDialogCss,
  agentHtml,
  homeHtml,
  homeNotebookJs,
  protocolCss,
  shellEndHtml,
  unsavedChangesJs,
  gelHtml
] = await Promise.all([
  read('ui/css/overrides/universal-dialogs.css'),
  read('src/plugins/gel/vendor/css/overrides/universal-dialogs.css'),
  read('ui/html/views/agent-view.html'),
  read('ui/html/views/home-view.html'),
  read('src/renderer/modules/home-dashboard/notebook.js'),
  read('ui/css/views/protocol-management-view.css'),
  read('ui/html/shell/end.html'),
  read('src/renderer/services/unsavedChangesService.js'),
  read('src/plugins/gel/vendor/gel-view.html')
]);

assert.equal(gelDialogCss, dialogCss, 'Gel must carry the same shared dialog stylesheet as the host');
assert.match(dialogCss, /--app-dialog-safe-top/);
assert.match(dialogCss, /max-height:\s*min\(var\(--app-dialog-max-height\), var\(--app-dialog-available-height\)\)/);
assert.match(dialogCss, /\.app-dialog-head > button\.app-dialog-close-btn[\s\S]*inset-inline-end:\s*0/);
assert.match(dialogCss, /\.unsaved-changes-dialog\.app-dialog-surface\s*\{[^}]*--app-dialog-width:\s*440px/s);
assert.match(dialogCss, /\.unsaved-changes-list li\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent/s);

assert.match(agentHtml, /class="agent-review-dialog app-dialog-surface"/);
assert.match(agentHtml, /class="agent-review-dialog-header app-dialog-head"/);
assert.match(gelHtml, /id="gel-peak-editor-overlay"[^>]*app-dialog-overlay app-dialog-overlay--center/);
assert.match(gelHtml, /class="gel-peak-editor-dialog app-dialog-surface"/);
assert.match(gelHtml, /class="gel-peak-editor-header app-dialog-head"/);
assert.match(homeHtml, /id="dashboard-notebook-note-dialog-close-btn"[^>]*class="app-dialog-close-btn"/s);
assert.match(homeNotebookJs, /noteDialogCloseBtn\.addEventListener\('click', closeNotebookNoteDialog\)/);
assert.doesNotMatch(protocolCss, /padding:\s*max\((?:76|86)px,\s*env\(safe-area-inset-top/);
assert.match(protocolCss, /height:\s*min\(760px,\s*var\(--app-dialog-available-height\)\)/);
assert.match(shellEndHtml, /id="unsaved-changes-close-btn"[^>]*class="app-dialog-close-btn"/s);
assert.match(unsavedChangesJs, /closeButton\?\.addEventListener\('click', cancelClose\)/);

assert.equal(measureDialogTopClearance({
  getBoundingClientRect: () => ({ bottom: 154.2 })
}), 167);
assert.equal(measureDialogTopClearance(null), 76);

const styleValues = new Map();
const windowListeners = new Map();
let observedElement = null;
let observerDisconnected = false;
const topbar = {
  getBoundingClientRect: () => ({ bottom: 102.1 })
};
const cleanup = installDialogLayout({
  documentObject: {
    documentElement: {
      style: {
        setProperty: (name, value) => styleValues.set(name, value)
      }
    },
    querySelector: (selector) => (selector === '.topbar' ? topbar : null)
  },
  windowObject: {
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    removeEventListener: (type) => windowListeners.delete(type),
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
      }

      observe(element) {
        observedElement = element;
      }

      disconnect() {
        observerDisconnected = true;
      }
    }
  }
});

assert.equal(styleValues.get('--app-dialog-safe-top'), 'max(115px, calc(env(safe-area-inset-top, 0px) + 12px))');
assert.equal(observedElement, topbar);
assert.equal(typeof windowListeners.get('resize'), 'function');
cleanup();
assert.equal(observerDisconnected, true);
assert.equal(windowListeners.has('resize'), false);

class MockElement {
  constructor() {
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    this.listeners.get('click')?.({ target: this });
  }

  reset() {
    this.value = '';
  }
}

const notebookElements = {
  pagesStatus: new MockElement(),
  pageList: new MockElement(),
  noteDialogOverlay: new MockElement(),
  noteDialogForm: new MockElement(),
  noteDialogCloseBtn: new MockElement(),
  noteDialogPage: new MockElement(),
  noteInput: new MockElement(),
  noteClarifyBtn: new MockElement()
};
initNotebookWidget({
  state: { notebookEntries: [], settings: {} },
  persist() {},
  safeText: (value) => String(value || ''),
  render() {},
  elements: notebookElements
});
notebookElements.noteDialogOverlay.hidden = false;
notebookElements.noteDialogPage.textContent = 'Page 1';
notebookElements.noteDialogCloseBtn.click();
assert.equal(notebookElements.noteDialogOverlay.hidden, true);
assert.equal(notebookElements.noteDialogPage.textContent, '');

console.log('dialog style selfcheck OK');
