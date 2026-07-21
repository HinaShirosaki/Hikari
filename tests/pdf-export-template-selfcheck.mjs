import assert from 'node:assert/strict';

// Stub jsPDF: records the text/shape calls so we can assert on the rendered template.
const calls = { text: [], pages: 1, saved: '' };

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

  addImage() {}

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

const { exportProtocolPdf } = await import('../src/renderer/modules/pdf-export/index.js');

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

console.log('pdf-export template selfcheck passed');
