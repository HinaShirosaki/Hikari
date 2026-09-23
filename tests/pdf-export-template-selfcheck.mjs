import assert from 'node:assert/strict';

// Stub jsPDF: records the text/shape calls so we can assert on the rendered template.
const calls = { text: [], images: [], colors: [], iconTints: [], pages: 1, saved: '', output: '', documents: [] };

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

  // Glyph width scales with the active font size so wrap-before-font-set bugs surface.
  setFontSize(size) {
    this.fontSize = Number(size) || 10;
  }

  charWidth() {
    return (this.fontSize || 10) * 0.5;
  }

  setTextColor(...values) { calls.colors.push(values); }

  setFillColor(...values) { calls.colors.push(values); }

  setDrawColor(...values) { calls.colors.push(values); }

  setLineWidth() {}

  line() {}

  rect() {}

  roundedRect() {}

  addImage(...args) {
    calls.images.push(args);
  }

  getTextWidth(text) {
    return String(text || '').length * this.charWidth();
  }

  splitTextToSize(text, maxWidth) {
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    const perLine = Math.max(1, Math.floor(maxWidth / this.charWidth()));
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

  output(type) {
    calls.output = type;
    return new ArrayBuffer(8);
  }
}

class FakeImage {
  constructor() {
    this.width = FakeImage.naturalSize.width;
    this.height = FakeImage.naturalSize.height;
    this.naturalWidth = FakeImage.naturalSize.width;
    this.naturalHeight = FakeImage.naturalSize.height;
    this.source = '';
  }

  set src(value) {
    this.source = String(value || '');
    this.onload?.();
  }
}

FakeImage.naturalSize = { width: 256, height: 256 };

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
        if (canvas.drawnSource === './assets/loadingicon.png') {
          calls.iconTints.push(canvas.tintColor);
        }
        return canvas.drawnSource === './assets/loadingicon.png' && ['#185fa5', '#444444'].includes(canvas.tintColor)
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
const { resolveTableColumnWidths } = await import('../src/renderer/modules/pdf-export/tables.js');

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
assert.ok(rendered.includes('01') && rendered.includes('02'), 'step numbers sit in their own gutter');
assert.ok(calls.colors.every((values) => values.length < 3 || values[0] === values[1] && values[1] === values[2]), 'protocol PDF uses grayscale ink and rules');

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
calls.colors.length = 0;
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
  calls.text.find((item) => item.text === 'HIKARI  /  NOTEBOOK PAGE')?.x,
  136,
  'left staple space shifts notebook content inward by 0.5 inch'
);
assert.equal(calls.saved, 'notebook-Atlas-Microscope-capture.pdf');
const notebookCornerIcons = calls.images.filter((args) => args[0] === 'data:image/png;base64,SElLQVJJ');
const notebookFigures = calls.images.filter((args) => args[0] === 'data:image/png;base64,RklHVVJF');
assert.equal(notebookFigures.length, 1, 'attached notebook images are embedded in PDF output');
assert.equal(notebookCornerIcons.length, calls.pages, 'the Hikari icon is rendered once on every notebook PDF page');
assert.ok(calls.iconTints.includes('#444444'), 'notebook footer icon is tinted neutral gray for printing');
assert.ok(Math.abs(notebookCornerIcons[0][2] - 543.28) < 0.01, 'the Hikari icon sits in the lower-right A4 margin');
assert.ok(Math.abs(notebookCornerIcons[0][3] - 773.89) < 0.01, 'the Hikari icon aligns beside the A4 footer');
assert.equal(notebookCornerIcons[0][4], 32, 'the Hikari icon is large enough to remain visible');
assert.equal(notebookCornerIcons[0][5], 32, 'the Hikari icon remains square');
assert.ok(calls.text.some((item) => item.text.includes('cells.png')), 'attached image filename is rendered as a caption');
assert.ok(calls.text.some((item) => item.text.includes('PDF Cell Sample')), 'linked plate cells retain their saved sample labels');
assert.ok(calls.text.some((item) => item.text.includes('3.5 uM')), 'linked plate cells retain their saved concentration labels');
assert.ok(calls.text.some((item) => item.text.includes('Legend: shaded cells')), 'linked plate occupancy remains clear in monochrome');
assert.ok(calls.colors.every((values) => values.length < 3 || values[0] === values[1] && values[1] === values[2]), 'notebook PDF uses grayscale ink, tables, and plate cells');

calls.text.length = 0;
calls.images.length = 0;
calls.pages = 1;
const wideOk = await exportNotebookEntryPdf({
  entry: {
    id: 'entry-wide',
    projectName: 'Atlas',
    protocolName: 'Imaging',
    experimentName: 'Wide table',
    resultTables: [{
      columns: ['a', 'b', 'c', 'd', 'e', 'f'].map((field) => ({ field, title: field.toUpperCase() })),
      rows: [{ a: 'x'.repeat(80), b: '1', c: '2', d: '3', e: '4', f: '5' }]
    }],
    values: {}
  },
  protocol: { steps: [] },
  pdfSettings: { pageSize: 'a4', stapleEdge: 'none' }
});
assert.equal(wideOk, true, 'wide-table notebook export should report success');
assert.equal(calls.documents.at(-1).options.orientation, 'p', 'wide result tables never flip the page to landscape');
assert.equal(calls.documents.at(-1).options.format, 'a4', 'wide result tables keep the selected page size');

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
  calls.text.find((item) => item.text === 'HIKARI  /  PROJECT NOTEBOOK')?.y,
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

// Print reuses the exact same PDF builder: bytes go to the print dialog, nothing is saved.
calls.saved = '';
calls.output = '';
exportProtocolPdf({ name: 'Print me', steps: [] }, { print: true });
assert.equal(calls.saved, '', 'print mode never saves a file');
assert.equal(calls.output, 'arraybuffer', 'print mode hands the rendered PDF bytes to the print dialog');

// Built-in Helvetica is WinAnsi-only: Greek mu becomes the micro sign, and hard-wrapped
// generator text flows like the on-screen view (blank lines still break paragraphs).
calls.text.length = 0;
calls.pages = 1;
exportProtocolPdf({
  name: 'Encoding',
  purpose: 'Line one\nline two\n\nSecond paragraph',
  steps: [{ id: 's1', text: 'Add 5 \u03bcL at \u2265 4 \u00b0C\nthen mix.' }],
  troubleshooting: 'Check \u03b1-tubulin \u2192 signal'
});
const drawn = calls.text.map((item) => item.text);
assert.ok(drawn.includes('Add 5 \u00b5L at >= 4 \u00b0C then mix.'), `mu/>= substituted and newline flowed, got ${JSON.stringify(drawn)}`);
assert.ok(drawn.includes('Line one line two'), 'single newline in purpose flows into one line');
assert.ok(drawn.includes('Second paragraph'), 'blank line keeps the paragraph break');
assert.ok(drawn.includes('Check alpha-tubulin -> signal'), 'other non-WinAnsi symbols get readable substitutes');
assert.ok(drawn.every((line) => !/[^\u0000-\u00ff\u2018-\u2022\u2013\u2014\u2026\u2122]/.test(line)), 'nothing outside WinAnsi reaches jsPDF');

// The first step after a heading must wrap with the body font, not the heading font.
calls.text.length = 0;
calls.pages = 1;
const longStep = 'Prepare complete medium and maintain cells under validated culture conditions and confirm they are healthy and free of contamination before seeding.';
exportProtocolPdf({ name: 'Wrap', materials: [longStep], steps: [{ id: 'a', text: longStep }, { id: 'b', text: longStep }] });
const stepLines = calls.text.filter((item) => item.x === 72 + 30).map((item) => item.text);
assert.ok(stepLines.length >= 2, 'both steps rendered');
assert.equal(stepLines[0], stepLines[stepLines.length / 2], 'first step wraps identically to a later step');
const bulletLines = calls.text.filter((item) => item.x === 72 + 14).map((item) => item.text);
assert.ok(bulletLines[0].startsWith(stepLines[0]), 'wider material text uses the same body font as steps');

// Many columns: narrow ones sit at the floor, the rest absorb it — the table never exceeds the margin.
{
  const doc = new FakeDoc({ format: 'letter' });
  doc.setFontSize(8.5);
  const headers = ['#', 'Step', 'Primer', 'Role', 'Sequence', 'Len', 'Tm', 'GC%', 'Notes'];
  const rows = [['1', 'Upstream vector backbone PCR', 'F1', 'Assembly', 'A'.repeat(60), '25', '62.1', '48', 'x'.repeat(80)]];
  const widths = resolveTableColumnWidths({ doc, maxWidth: 468 }, headers, rows);
  const total = widths.reduce((sum, width) => sum + width, 0);
  assert.ok(Math.abs(total - 468) < 0.01, `column widths fill the content width exactly, got ${total}`);
}

// Attachments are rasterized to the figure box, never to the source resolution:
// a 7650x9900 scan embedded whole took ~10s and produced a 200MB PDF.
{
  const { preparePdfImageAsset } = await import('../src/renderer/modules/pdf-export/figures.js');
  const box = { maxWidthPt: 468, maxHeightPt: 320 };
  const pixelCap = (points) => Math.ceil((points * 200) / 72);

  FakeImage.naturalSize = { width: 7650, height: 9900 };
  const big = await preparePdfImageAsset('data:image/png;base64,aW1hZ2U=', box);
  assert.equal(big.format, 'JPEG', 'figures go in as JPEG so jsPDF does not re-deflate every pixel');
  assert.ok(big.width <= pixelCap(box.maxWidthPt), `raster width capped at print dpi, got ${big.width}`);
  assert.ok(big.height <= pixelCap(box.maxHeightPt), `raster height capped at print dpi, got ${big.height}`);
  assert.ok(
    Math.abs((big.width / big.height) - (7650 / 9900)) < 0.01,
    `aspect ratio survives the downscale, got ${big.width}x${big.height}`
  );

  FakeImage.naturalSize = { width: 240, height: 120 };
  const small = await preparePdfImageAsset('data:image/png;base64,aW1hZ2U=', box);
  assert.equal(small.width, 240, 'an image that already fits is never upscaled');
  assert.equal(small.height, 120, 'an image that already fits keeps its height');

  FakeImage.naturalSize = { width: 256, height: 256 };
}

console.log('pdf-export template selfcheck passed');
