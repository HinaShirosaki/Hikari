import { componentSvgSource } from './artwork.mjs';
import { prepareRaster } from './raster.mjs';
import { encodeText } from './workspace.mjs';

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
    else slide.addImage({ ...options, data: object.type === 'vector'
      ? `data:image/svg+xml;base64,${encodeText(componentSvgSource(object))}` : await rasterData(object) });
  }
  const dataBase64 = await presentation.write({ outputType: 'base64', compression: true });
  if (dataBase64.length > 24000000) throw new Error('The PowerPoint file exceeds the export size limit. Use smaller raster assets.');
  return dataBase64;
}
