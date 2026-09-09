import assert from 'node:assert/strict';

// Stub jsPDF: records the text/shape calls so we can assert on the rendered template.
const calls = { text: [], images: [], pages: 1, saved: '', documents: [] };

class FakeDoc {
  constructor(options = {}) {
    this.options = options;
    this.currentPage = 1;
    calls.documents.push(this);
    const portraitSizes = {
      a4: [595.28, 841.89],
      a5: [419.53, 595.28],
      legal: [612, 1008],
      letter: [612, 792]
    };
    const pageSize = portraitSizes[options.format] || portraitSizes.letter;
    const landscape = options.orientation === 'l' || options.orientation === 'landscape';
    this.internal = {
      pageSize: {
        getWidth: () => (landscape ? pageSize[1] : pageSize[0]),
        getHeight: () => (landscape ? pageSize[0] : pageSize[1])
      },
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

class FakeImage {
  constructor() {
    this.width = 256;
    this.height = 256;
    this.naturalWidth = 256;
    this.naturalHeight = 256;
    this.source = '';
  }

  set src(value) {
    this.source = String(value || '');
    this.onload?.();
  }
}

globalThis.Image = FakeImage;
globalThis.document = {
  createElement(tagName) {
    if (tagName !== 'canvas') {
      return {};
    }
    const canvas = {
      width: 0,
      height: 0,
      drawnSource: '',
      tintColor: '',
      getContext() {
        return {
          fillStyle: '',
          globalCompositeOperation: 'source-over',
          clearRect() {},
          fillRect() {
            if (this.globalCompositeOperation === 'source-in') {
              canvas.tintColor = this.fillStyle;
            }
          },
          drawImage(image) {
            canvas.drawnSource = String(image?.source || '');
          }
        };
      },
      toDataURL() {
        return canvas.drawnSource === './assets/loadingicon.png' && canvas.tintColor === '#185fa5'
          ? 'data:image/png;base64,SElLQVJJ'
          : 'data:image/png;base64,RklHVVJF';
      }
    };
    return canvas;
  }
};
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
  resultFileImages: [{ name: 'cells.png', dataUrl: 'data:image/png;base64,aW1hZ2U=' }],
  pdfSettings: { pageSize: 'a4', stapleEdge: 'left' }
});
assert.equal(notebookOk, true, 'notebook export should report success');
assert.equal(calls.documents.at(-1).options.format, 'a4', 'notebook export uses the selected page size');
assert.equal(
  calls.text.find((item) => item.text === 'NOTEBOOK PAGE')?.x,
  108,
  'left staple space shifts notebook content inward by 0.5 inch'
);
assert.equal(calls.saved, 'notebook-Atlas-Microscope-capture.pdf');
const notebookCornerIcons = calls.images.filter((args) => args[0] === 'data:image/png;base64,SElLQVJJ');
const notebookFigures = calls.images.filter((args) => args[0] === 'data:image/png;base64,RklHVVJF');
assert.equal(notebookFigures.length, 1, 'attached notebook images are embedded in PDF output');
assert.equal(notebookCornerIcons.length, calls.pages, 'the Hikari icon is rendered once on every notebook PDF page');
assert.ok(Math.abs(notebookCornerIcons[0][2] - 543.28) < 0.01, 'the Hikari icon sits in the lower-right A4 margin');
assert.ok(Math.abs(notebookCornerIcons[0][3] - 773.89) < 0.01, 'the Hikari icon aligns beside the A4 footer');
assert.equal(notebookCornerIcons[0][4], 32, 'the Hikari icon is large enough to remain visible');
assert.equal(notebookCornerIcons[0][5], 32, 'the Hikari icon remains square');
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
  ]),
  pdfSettings: { pageSize: 'legal', stapleEdge: 'top' }
});
assert.equal(projectNotebookOk, true, 'project notebook export should report success');
assert.equal(calls.documents.at(-1).options.format, 'legal', 'project notebook export uses the selected page size');
assert.equal(
  calls.text.find((item) => item.text === 'PROJECT NOTEBOOK')?.y,
  108,
  'top staple space shifts project notebook content downward by 0.5 inch'
);
assert.equal(calls.saved, 'project-notebook-Atlas.pdf');
const projectCornerIcons = calls.images.filter((args) => args[0] === 'data:image/png;base64,SElLQVJJ');
const projectFigures = calls.images.filter((args) => args[0] === 'data:image/png;base64,RklHVVJF');
assert.equal(projectFigures.length, 1, 'attached images are embedded in whole-project notebook PDFs');
assert.equal(projectCornerIcons.length, calls.pages, 'the Hikari icon is repeated on every project notebook PDF page');
assert.ok(calls.text.some((item) => item.text.includes('Project PDF Sample')), 'project notebook PDFs retain linked plate sample labels');
assert.ok(calls.text.some((item) => item.text.includes('7 uM')), 'project notebook PDFs retain linked plate concentration labels');

console.log('pdf-export template selfcheck passed');
