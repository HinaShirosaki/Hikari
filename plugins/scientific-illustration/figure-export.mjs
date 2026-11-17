import { componentSvgSource, element, prepareRaster, scene } from './artwork.mjs';
import { encodeText } from './library.mjs';
import { createPresentation } from './i18n.mjs';

const i18nUi = createPresentation('figura');

let interFontData;
function embeddedInter() {
  if (!interFontData) interFontData = (async () => {
    // This URL is always the plugin's bundled font, never user-supplied artwork.
    const response = await fetch(new URL('./vendor/fonts/InterVariable.woff2', import.meta.url));
    if (!response.ok) throw new Error('Could not load the bundled Inter font for export.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return `data:font/woff2;base64,${btoa(binary)}`;
  })().catch(error => { interFontData = undefined; throw error; });
  return interFontData;
}
function usesInter(object) {
  if (object.type === 'plot') return !object.plotly.layout.font?.family || /\bInter\b/i.test(object.plotly.layout.font.family);
  return object.type === 'text' && object.fontFamily.split(',').some(name => name.trim().replace(/^['"]|['"]$/g, '').toLowerCase() === 'inter');
}

export async function svgSource(documentState, canvas) {
  const svg = scene(documentState, canvas);
  const interObjects = documentState.objects.filter(object => object.canvas === canvas && object.visible && usesInter(object));
  if (interObjects.length) {
    const dataUrl = await embeddedInter();
    await Promise.all(interObjects.map(object => object.type === 'plot' ? document.fonts.load('16px Inter') : document.fonts.load(`${object.italic ? 'italic ' : ''}${object.fontWeight} ${object.fontSize}px Inter`, object.text)));
    const defs = element('defs');
    defs.append(element('style', {}, `@font-face{font-family:Inter;src:url("${dataUrl}") format("woff2");font-weight:100 900;font-style:normal;}`));
    svg.prepend(defs);
  }
  return new XMLSerializer().serializeToString(svg);
}
export async function renderPreview(documentState, canvas, maxDimension = 1600) {
  const source = await svgSource(documentState, canvas);
  const image = new Image();
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Could not render the canvas artwork.')); image.src = url; });
    const dimensions = documentState.canvases[canvas];
    const scale = Math.min(1, maxDimension / Math.max(dimensions.width, dimensions.height));
    const preview = document.createElement('canvas');
    preview.width = Math.ceil(dimensions.width * scale); preview.height = Math.ceil(dimensions.height * scale);
    preview.getContext('2d').drawImage(image, 0, 0, preview.width, preview.height);
    return { canvas, width: preview.width, height: preview.height, mime_type: 'image/png', data_url: preview.toDataURL('image/png') };
  } finally { URL.revokeObjectURL(url); }
}

const METRES_PER_INCH = 0.0254;
const PHYS = 0x70485973; // pHYs
const IDAT = 0x49444154;
const DEFAULT_PNG_PPI = 96;
const MAX_PNG_PPI = Math.floor(0xffffffff * METRES_PER_INCH);

function densityChunk(ppi) {
  const chunk = new Uint8Array(21);
  const fields = new DataView(chunk.buffer);
  const pixelsPerMetre = Math.round(ppi / METRES_PER_INCH);
  fields.setUint32(0, 9);
  fields.setUint32(4, PHYS);
  fields.setUint32(8, pixelsPerMetre);
  fields.setUint32(12, pixelsPerMetre);
  fields.setUint8(16, 1); // Metres
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 17)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  fields.setUint32(17, crc ^ 0xffffffff);
  return chunk;
}

// Replace the browser's resolution metadata while keeping the pixel data intact.
function setPngPpi(dataBase64, ppi) {
  if (!Number.isInteger(ppi) || ppi < 1 || ppi > MAX_PNG_PPI) throw new RangeError('Invalid PNG resolution.');
  const png = Uint8Array.fromBase64(dataBase64);
  const fields = new DataView(png.buffer);
  if (png.length >= 8 && fields.getUint32(0) === 0x89504e47 && fields.getUint32(4) === 0x0d0a1a0a) {
    for (let offset = 8; offset + 12 <= png.length;) {
      const end = offset + fields.getUint32(offset) + 12;
      if (end > png.length) break;
      const type = fields.getUint32(offset + 4);
      if (type === PHYS || type === IDAT) {
        const remainder = type === PHYS ? end : offset;
        const density = densityChunk(ppi);
        const output = new Uint8Array(offset + density.length + png.length - remainder);
        output.set(png.subarray(0, offset));
        output.set(density, offset);
        output.set(png.subarray(remainder), offset + density.length);
        return output.toBase64();
      }
      offset = end;
    }
  }
  throw new Error('Could not read the PNG for export.');
}

let exporterLoad;
function loadExporter() {
  if (typeof globalThis.PptxGenJS === 'function') return Promise.resolve(globalThis.PptxGenJS);
  if (!exporterLoad) exporterLoad = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/pptxgenjs/pptxgen.bundle.js', import.meta.url).href;
    script.onload = () => typeof globalThis.PptxGenJS === 'function'
      ? resolve(globalThis.PptxGenJS) : reject(new Error('The PowerPoint exporter could not load.'));
    script.onerror = () => { script.remove(); reject(new Error('The PowerPoint exporter could not load. Try exporting again.')); };
    document.head.append(script);
  }).catch(error => { exporterLoad = undefined; throw error; });
  return exporterLoad;
}

export function powerPointLayout(canvas) {
  if (!canvas || ![canvas.width, canvas.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('PowerPoint export needs a valid canvas.');
  // CSS pixels become inches at 96 dpi. PowerPoint slide sides must be 1–56in;
  // exceptionally large or narrow figures keep their aspect ratio within that.
  const scale = Math.min(1 / 96, 56 / Math.max(canvas.width, canvas.height));
  const width = Math.max(1, canvas.width * scale), height = Math.max(1, canvas.height * scale);
  return { width, height, scale, x: (width - canvas.width * scale) / 2, y: (height - canvas.height * scale) / 2 };
}
export function powerPointPaint(value, opacity = 1) {
  if (!/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) throw new Error('PowerPoint export needs a hex color.');
  const alpha = value.length === 9 ? parseInt(value.slice(7), 16) / 255 : 1;
  return { color: value.slice(1, 7).toUpperCase(), transparency: (1 - alpha * opacity) * 100 };
}
export function powerPointObject(object, layout) {
  const box = { x: layout.x + object.x * layout.scale, y: layout.y + object.y * layout.scale,
    w: object.width * layout.scale, h: object.height * layout.scale,
    rotate: ((object.rotation % 360) + 360) % 360, objectName: object.name || object.id };
  if (object.type !== 'text') return { ...box, transparency: (1 - object.opacity) * 100, altText: object.name || object.id };
  return { ...box, ...powerPointPaint(object.color, object.opacity),
    fontFace: object.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, ''),
    fontSize: object.fontSize * layout.scale * 72, bold: object.fontWeight >= 600,
    italic: object.italic, underline: object.underline,
    align: { start: 'left', middle: 'center', end: 'right' }[object.align],
    valign: { top: 'top', middle: 'middle', bottom: 'bottom' }[object.anchor],
    margin: 0, paraSpaceBefore: 0, paraSpaceAfter: 0,
    lineSpacing: object.fontSize * layout.scale * 72 * 1.2, wrap: false, fit: 'none', isTextBox: true };
}
async function rasterData(object) {
  if (!object.dataUrl.startsWith('data:image/webp;')) return object.dataUrl;
  // Office does not consistently decode WebP. Keep each image independent and
  // convert only its bytes to transparent PNG, preserving its slide geometry.
  const raster = await prepareRaster(object.dataUrl);
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error(`Could not export ${object.name}.`)); image.src = object.dataUrl; });
  const canvas = document.createElement('canvas'); canvas.width = raster.width; canvas.height = raster.height;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function exportPowerPoint(documentState, canvas = 'main') {
  // Freeze the exported revision before loading the library or decoding images.
  const snapshot = structuredClone(documentState), layout = powerPointLayout(snapshot.canvases[canvas]);
  const PptxGenJS = await loadExporter(), presentation = new PptxGenJS();
  presentation.defineLayout({ name: 'FIGURA', width: layout.width, height: layout.height });
  presentation.layout = 'FIGURA'; presentation.author = 'Hikari Figura'; presentation.company = 'Hikari';
  presentation.title = snapshot.title; presentation.subject = 'Scientific figure with adjustable components';
  const slide = presentation.addSlide();
  slide.background = powerPointPaint(snapshot.canvases[canvas].background);
  for (const object of snapshot.objects.filter(object => object.canvas === canvas && object.visible)) {
    const options = powerPointObject(object, layout);
    if (object.type === 'text') slide.addText(object.text, options);
    else slide.addImage({ ...options, data: ['vector', 'plot'].includes(object.type)
      ? `data:image/svg+xml;base64,${encodeText(componentSvgSource(object))}` : await rasterData(object) });
  }
  const dataBase64 = await presentation.write({ outputType: 'base64', compression: true });
  if (dataBase64.length > 24000000) throw new Error('The PowerPoint file exceeds the export size limit. Use smaller raster assets.');
  return dataBase64;
}

export function createFigureExporter({ document, hikari, workspace, getIllustrationId, flushImagePreferences, status }) {
  const $ = id => document.getElementById(id);

  let exporting = false;
  let pngPpi = DEFAULT_PNG_PPI;
  const pngExportDialog = $('png-export-dialog'), pngExportPpi = $('png-export-ppi');
  pngExportPpi.max = MAX_PNG_PPI;
  $('cancel-png-export').addEventListener('click', () => pngExportDialog.close());
  function choosePngPpi() {
    pngExportPpi.value = pngPpi;
    pngExportDialog.returnValue = '';
    pngExportDialog.showModal();
    pngExportPpi.focus();
    pngExportPpi.select();
    return new Promise(resolve => pngExportDialog.addEventListener('close', () => {
      if (pngExportDialog.returnValue !== 'export') { resolve(null); return; }
      pngPpi = pngExportPpi.valueAsNumber;
      resolve(pngPpi);
    }, { once: true }));
  }
  async function exportFigure(format, id = getIllustrationId()) {
    if (exporting) return;
    exporting = true;
    const buttons = ['export-svg', 'export-png', 'export-pptx'].map($);
    try {
      await flushImagePreferences();
      const documentState = await workspace.getExportDocument(id);
      const ppi = format === 'png' ? await choosePngPpi() : null;
      if (format === 'png' && ppi === null) { status(i18nUi.text("Export canceled")); return; }
      buttons.forEach(button => { button.disabled = true; });
      if (format === 'pptx') status(i18nUi.text("Preparing PowerPoint…"));
      const dataBase64 = format === 'pptx' ? await exportPowerPoint(documentState)
        : format === 'svg' ? encodeText(await svgSource(documentState, 'main'))
        : setPngPpi((await renderPreview(documentState, 'main', 8000)).data_url.split(',')[1], ppi);
      const result = await hikari.call('downloads.save', { fileName: `${documentState.title || 'figure'}.${format}`, dataBase64 });
      status((result.saved ? i18nUi.text("Exported {p0}", { p0: format.toUpperCase() }) : i18nUi.text("Export canceled")));
    } catch (error) { status(error.message); }
    finally { exporting = false; buttons.forEach(button => { button.disabled = false; }); }
  }
  $('export-svg').addEventListener('click', () => void exportFigure('svg'));
  $('export-png').addEventListener('click', () => {
    const menu = $('export-menu');
    menu.open = false;
    menu.querySelector('summary').focus();
    void exportFigure('png');
  });
  $('export-pptx').addEventListener('click', () => void exportFigure('pptx'));

  return exportFigure;
}
