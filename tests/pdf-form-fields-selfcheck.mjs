import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isFillableWidgetAnnotation } from '../src/renderer/modules/papers/pdf-viewer/pdf-viewer-rendering.js';
import { buildPageRecords } from '../src/renderer/modules/papers/pdf-viewer/pdf-viewer-page-records.js';

const WIDGET = 20; // pdfjsLib.AnnotationType.WIDGET
const LINK = 2;

const fillable = [
  { annotationType: WIDGET, fieldType: 'Tx' },
  { annotationType: WIDGET, fieldType: 'Ch' },
  { annotationType: WIDGET, fieldType: 'Btn', checkBox: true },
  { annotationType: WIDGET, fieldType: 'Btn', radioButton: true }
];
const skipped = [
  { annotationType: WIDGET, fieldType: 'Btn' }, // push button needs a link service we do not run
  { annotationType: WIDGET, fieldType: 'Sig' },
  { annotationType: LINK, url: 'https://example.org' },
  {}
];

fillable.forEach((annotation) => {
  assert.equal(isFillableWidgetAnnotation(annotation, WIDGET), true, `${annotation.fieldType} must be fillable`);
});
skipped.forEach((annotation) => {
  assert.equal(isFillableWidgetAnnotation(annotation, WIDGET), false, `${JSON.stringify(annotation)} must be skipped`);
});

// The layer the fields render into has to exist on every page record.
const stubDocument = {
  createElement: () => ({
    className: '',
    dataset: {},
    style: { setProperty() {} },
    setAttribute() {},
    append() {}
  })
};
const [record] = buildPageRecords({ doc: stubDocument, pageMetrics: [{ width: 612, height: 792 }] });
assert.ok(record.formLayer, 'page records must carry a form layer');
assert.equal(record.renderedForms, false);

const css = await readFile(new URL('../ui/css/views/papers-view/viewer-and-annotations.css', import.meta.url), 'utf8');
assert.match(css, /\.papers-viewer-form-layer section \{[^}]*pointer-events: auto/s);

// Saving a filled form overwrites the stored PDF in place; a de-duplicated
// copy would leave the library pointing at the unfilled original.
const require = createRequire(import.meta.url);
const { createStorageFileHelpers } = require('../src/main/ipc/register-data-ipc/storage-files.js');
const fsPromises = require('node:fs/promises');

const root = await mkdtemp(path.join(os.tmpdir(), 'hikari-form-save-'));
const folder = path.join(root, 'Papers', 'Journal_Club');
await mkdir(folder, { recursive: true });
await writeFile(path.join(folder, 'form.pdf'), 'unfilled');

const helpers = createStorageFileHelpers({
  fs: fsPromises,
  cleanText: (value) => String(value || ''),
  getStorageRootPointerPath: () => path.join(root, '.pointer'),
  getStorageRoot: () => root,
  paperKnowledgeDatabaseRuntime: null
});
const saved = await helpers.storeImportedFile({
  storagePath: root,
  targetFolder: folder,
  fileName: 'form.pdf',
  dataBytes: new Uint8Array([102, 105, 108, 108, 101, 100]).buffer,
  overwrite: true
});
assert.equal(saved.filePath, path.join(folder, 'form.pdf'), 'filled PDF must replace the stored file');
assert.equal(await readFile(saved.filePath, 'utf8'), 'filled');
await rm(root, { recursive: true, force: true });

console.log('pdf form fields selfcheck passed');
