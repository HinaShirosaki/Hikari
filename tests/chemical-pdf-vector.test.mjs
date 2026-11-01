import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfDrawingPath, chemicalPdfOperators } from '../src/renderer/app/plugin-bridge/chemical-pdf-vector.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readChemicalClipboard } = require('../src/main/preload/api/chemical-clipboard-api.js');

test('the native reader preserves original PDF vector bytes alongside bitmap previews', () => {
  const bytes = Buffer.from('%PDF-1.4\nvector bonds and glyphs\n%%EOF');
  const clipboard = readChemicalClipboard({ availableFormats: () => ['com.adobe.pdf'], readBuffer: () => bytes,
    readImage: () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AAAA' }) });
  assert.equal(clipboard.candidates.find(candidate => candidate.pdfDataBase64)?.pdfDataBase64, bytes.toString('base64'));
  assert.ok(clipboard.candidates.some(candidate => candidate.imageDataUrl));
});

test('macOS native PDF and SVG are found when availableFormats only advertises a tiny PNG preview', () => {
  const pdf = Buffer.from('%PDF-1.4\noriginal ChemDraw drawing\n%%EOF');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 73 40"><path d="M0 0L73 40"/></svg>';
  const read = vector => readChemicalClipboard({ availableFormats: () => ['image/png'],
    readBuffer: format => vector === 'pdf' && ['com.adobe.pdf', 'Apple PDF pasteboard type'].includes(format) ? pdf
      : vector === 'svg' && format === 'public.svg-image' ? Buffer.from(svg) : Buffer.alloc(0),
    readImage: () => ({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AAAA' }) });
  const result = read('pdf');
  assert.deepEqual(result.formats, ['image/png', 'com.adobe.pdf', 'Apple PDF pasteboard type']);
  assert.equal(result.candidates.filter(candidate => candidate.pdfDataBase64).length, 1, 'PDF aliases do not cause duplicate conversion');
  assert.equal(result.candidates.find(candidate => candidate.pdfDataBase64).pdfDataBase64, pdf.toString('base64'));
  const nativeSvg = read('svg');
  assert.ok(nativeSvg.formats.includes('public.svg-image'));
  assert.ok(nativeSvg.candidates.some(candidate => decodeURIComponent(candidate.imageDataUrl || '').includes(svg)));
  assert.deepEqual(read('none').formats, ['image/png'], 'absent native formats are not reported');
});

test('PDF drawing commands become exact SVG segments, curves and glyph outlines', () => {
  assert.equal(pdfDrawingPath(new Float32Array([0, 1, 2, 1, 3, 4, 2, 5, 6, 7, 8, 9, 10, 4])), 'M1 2 L3 4 C5 6 7 8 9 10 Z');
  assert.throws(() => pdfDrawingPath([99]), /unsupported/);
  assert.throws(() => pdfDrawingPath([0, NaN, 2]), /non-finite/);
  const OPS = { setLineWidth: 1, setStrokeRGBColor: 2, constructPath: 3, stroke: 20, beginText: 4, setFont: 5, moveText: 6, showText: 7, endText: 8, setTextMatrix: 9 };
  const objects = new Map([['font', { loadedName: 'font', fontMatrix: [.001, 0, 0, .001, 0, 0] }],
    ['font_path_O', { path: new Float32Array([0, 0, 0, 1, 1, 0, 1, 1, 1, 4]) }]]);
  const page = { getViewport: () => ({ width: 200, height: 100, transform: [1, 0, 0, -1, 0, 100] }), commonObjs: objects };
  const list = { fnArray: [1, 2, 3, 4, 5, 9, 6, 7, 8], argsArray: [[1.5], ['#000000'], [20, [[0, 10, 50, 1, 50, 75]]], null, ['font', 18], [1, 0, 0, 1, 0, 0], [70, 50], [[{ fontChar: 'O', width: 700 }]], null] };
  const result = chemicalPdfOperators(page, list, OPS);
  assert.equal(result.width, 200);
  assert.match(result.svg, /M10 50 L50 75/);
  assert.match(result.svg, /matrix\(18 0 0 -18 70 50\)/);
  assert.doesNotMatch(result.svg, /<image|data:image|<text/);
  assert.throws(() => chemicalPdfOperators(page, { fnArray: [999], argsArray: [[]] }, OPS), /unsupported/);
  objects.delete('font_path_O');
  assert.throws(() => chemicalPdfOperators(page, list, OPS), /missing atom glyph/);
});
