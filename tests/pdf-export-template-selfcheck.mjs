import assert from 'node:assert/strict';

// Stub jsPDF: records the text/shape calls so we can assert on the rendered template.
const calls = { text: [], images: [], pages: 1, saved: '' };

class FakeDoc {
  constructor() {
    this.currentPage = 1;
    this.internal = {
      pageSize: { getWidth: () => 612, getHeight: () => 792 },
      getNumberOfPages: () => calls.pages
    };
  }

  setFont() {}

  setFontSize() {}

  setTextColor() {}

  setFillColor() {}

  setDrawColor() {}

  setLineWidth() {}

  line() {}

  rect() {}

  roundedRect() {}

  addImage(...args) {
    calls.images.push(args);
  }

  getTextWidth(text) {
    return String(text || '').length * 5;
  }

  splitTextToSize(text, maxWidth) {
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    const perLine = Math.max(1, Math.floor(maxWidth / 5));
    const lines = [];
    let current = '';
    words.forEach((word) => {
      if (!current) {
        current = word;
      } else if ((current.length + word.length + 1) <= perLine) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    });
    if (current) {
      lines.push(current);
    }
    return lines.length ? lines : [''];
  }

  text(value, x, y) {
    const parts = Array.isArray(value) ? value : [value];
    parts.forEach((part) => calls.text.push({ text: String(part ?? ''), x, y }));
  }

  addPage() {
    calls.pages += 1;
    this.currentPage = calls.pages;
  }

  setPage(page) {
    this.currentPage = page;
  }

  save(name) {
    calls.saved = name;
  }
}

globalThis.window = { jspdf: { jsPDF: FakeDoc }, alert: () => {} };

const {
  exportNotebookEntryPdf,
  exportProjectNotebookEntriesPdf,
  exportProtocolPdf
} = await import('../src/renderer/modules/pdf-export/index.js');

const ok = exportProtocolPdf({
  name: 'Plasmid mini-prep',
  purpose: 'Recover plasmid DNA.',
  materials: ['Buffer P1', 'Buffer P2'],
  steps: [{ id: 's1', text: 'Pellet the culture.' }, { id: 's2', text: 'Resuspend the pellet.' }],
  troubleshooting: 'Low yield means the culture was overgrown.',
  createdAt: '2026-02-04T10:00:00Z',
  updatedAt: '2026-03-12T10:00:00Z'
});

const rendered = calls.text.map((item) => item.text);
const hasText = (needle) => rendered.some((line) => line.includes(needle));

assert.equal(ok, true, 'export should report success');
assert.equal(calls.saved, 'protocol-Plasmid-mini-prep.pdf');
assert.ok(hasText('PROTOCOL'), 'header eyebrow is rendered');
assert.ok(hasText('Plasmid mini-prep'), 'title is rendered');
assert.ok(hasText('STEPS'), 'section headings are uppercased');
assert.ok(hasText('MATERIALS'), 'materials section is rendered');
assert.ok(hasText('•'), 'material bullets are rendered');
assert.ok(rendered.includes('1') && rendered.includes('2'), 'step numbers sit in their own gutter');

// Footer runs on every page, with the page count resolved after all content is laid out.
const footers = rendered.filter((line) => line.startsWith('Page ') && line.includes(' of '));
assert.equal(footers.length, calls.pages, 'one footer per page');
footers.forEach((footer, index) => {
  assert.equal(footer, `Page ${index + 1} of ${calls.pages}`);
});
assert.ok(hasText('Protocol · Plasmid mini-prep'), 'footer carries the document label');

// Nothing may be drawn below the footer rule.
const bottomLimit = 792 - 40;
const overflow = calls.text.filter((item) => item.y > bottomLimit);
assert.equal(overflow.length, 0, `no content past the footer baseline, got ${JSON.stringify(overflow)}`);

calls.text.length = 0;
calls.images.length = 0;
calls.pages = 1;
calls.saved = '';
const notebookOk = await exportNotebookEntryPdf({
  entry: {
    id: 'page-1',
    projectName: 'Atlas',
    protocolName: 'Imaging',
    experimentName: 'Microscope capture',
    result: 'Cells were imaged.',
    resultFiles: ['cells.png'],
    resultFileRecords: [{ name: 'cells.png', mimeType: 'image/png' }],
    resultTables: [],
    toolCalculations: [],
    values: {},
    notebookState: 'executed',
    updatedAt: '2026-07-21T12:00:00Z'
  },
  protocol: { steps: [] },
  linkedAssay: {
    name: 'Export visibility assay',
    plateType: '6',
    wellLayout: [{ well: 'A1', sampleId: 'PDF Cell Sample', concentration: '3.5 uM' }]
  },
  resultFileImages: [{ name: 'cells.png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }]
});
assert.equal(notebookOk, true, 'notebook export should report success');
assert.equal(calls.saved, 'notebook-Atlas-Microscope-capture.pdf');
assert.equal(calls.images.length, 1, 'attached notebook images are embedded in PDF output');
assert.ok(calls.text.some((item) => item.text.includes('cells.png')), 'attached image filename is rendered as a caption');
assert.ok(calls.text.some((item) => item.text.includes('PDF Cell Sample')), 'linked plate cells retain their saved sample labels');
assert.ok(calls.text.some((item) => item.text.includes('3.5 uM')), 'linked plate cells retain their saved concentration labels');

calls.text.length = 0;
calls.images.length = 0;
calls.pages = 1;
calls.saved = '';
const projectNotebookOk = await exportProjectNotebookEntriesPdf({
  project: { id: 'atlas', name: 'Atlas' },
  entries: [{
    id: 'page-1',
    projectName: 'Atlas',
    protocolName: 'Imaging',
    experimentName: 'Microscope capture',
    result: 'Cells were imaged.',
    resultFiles: ['cells.png'],
    resultTables: [],
    toolCalculations: [],
    values: {},
    notebookState: 'executed',
    updatedAt: '2026-07-21T12:00:00Z'
  }],
  linkedAssayByEntryId: new Map([
    ['page-1', {
      name: 'Export visibility assay',
      plateType: '6',
      wellLayout: [{ well: 'A1', sampleId: 'Project PDF Sample', concentration: '7 uM' }]
    }]
  ]),
  resultFileImagesByEntryId: new Map([
    ['page-1', [{ name: 'cells.png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }]]
  ])
});
assert.equal(projectNotebookOk, true, 'project notebook export should report success');
assert.equal(calls.saved, 'project-notebook-Atlas.pdf');
assert.equal(calls.images.length, 1, 'attached images are embedded in whole-project notebook PDFs');
assert.ok(calls.text.some((item) => item.text.includes('Project PDF Sample')), 'project notebook PDFs retain linked plate sample labels');
assert.ok(calls.text.some((item) => item.text.includes('7 uM')), 'project notebook PDFs retain linked plate concentration labels');

console.log('pdf-export template selfcheck passed');
