import { validateSvg } from './artwork.mjs';
import { fitRasterBox, prepareRaster } from './raster.mjs';
import { CLIPBOARD_FORMAT } from './clipboard.mjs';

const toDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not read the pasted structure.')); reader.readAsDataURL(file);
});

export async function readChemicalClipboard(hikari, data = null) {
  // Capture DataTransfer synchronously; Chromium can clear it after the event.
  const text = data?.getData('text/plain') || '';
  // Only text that is itself an SVG document; rejected Figura JSON also contains "<svg".
  const localSvg = data?.getData('image/svg+xml') || (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text) ? text : '');
  const formats = [...(data?.types || [])];
  const files = [...(data?.files || [])].filter(file => file.type.startsWith('image/'));
  let native = null, nativeError = '';
  try { native = await hikari.call('clipboard.readChemical'); } catch (error) {
    // Native paste events can still supply an image on an older host or when
    // an existing install has not granted the optional native reader access.
    nativeError = String(error?.message || error);
  }
  const local = await Promise.all(files.map(file => {
    if (file.size > 9 * 1024 * 1024) throw new Error('The pasted structure image is too large. Copy a smaller selection.');
    return toDataUrl(file);
  }));
  if (!data && !native && !nativeError) return null;
  return { text: text || native?.text || '', images: [...new Set([...(native?.images || []), ...local])],
    vectors: [...(native?.vectors || []), ...(localSvg ? [{ svg: localSvg, source: 'svg' }] : [])], vectorError: native?.vectorError || '',
    formats: [...new Set([...(native?.formats || []), ...formats])], nativeError };
}

export function prepareChemicalVector(source) {
  if (typeof source !== 'string' || source.length > 3000000) throw new Error('The vector structure is too large.');
  // ChemDraw SVG exports may include the standard SVG public doctype. It has
  // no role in the drawing; reject entities/internal subsets before removing it.
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source)) throw new Error('SVG entities are not supported.');
  const svg = validateSvg(source.replace(/<!DOCTYPE[^>]*>/gi, ''), { chemical: true });
  const box = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  return { type: 'vector', svg, width: box[2], height: box[3] };
}

export async function prepareChemicalImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 12000000
    || !/^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml)[;,]/i.test(dataUrl)) throw new Error('The clipboard has no supported structure image.');
  if (/^data:image\/svg\+xml[;,]/i.test(dataUrl)) {
    const comma = dataUrl.indexOf(','), header = dataUrl.slice(0, comma);
    const source = /;base64/i.test(header) ? new TextDecoder().decode(Uint8Array.from(atob(dataUrl.slice(comma + 1)), c => c.charCodeAt(0)))
      : decodeURIComponent(dataUrl.slice(comma + 1));
    return prepareChemicalVector(source);
  }
  const image = await new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the pasted structure image.')); image.src = dataUrl;
  });
  const width = image.naturalWidth, height = image.naturalHeight;
  if (!width || !height || width * height > 64000000) throw new Error('Structure images must be at most 64 megapixels.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(image, 0, 0);
  const png = canvas.toDataURL('image/png');
  if (png.length > 7000000) throw new Error('The pasted structure image is too large. Copy a smaller selection.');
  return prepareRaster(png, { trim: true });
}

export function chemicalStructureSnapshot(image, canvas, offset = 0) {
  const requestedWidth = Math.min(image.width, 360, canvas.width * .6, canvas.height * .6 * image.width / image.height);
  const size = fitRasterBox(image.width, image.height, requestedWidth);
  return { format: CLIPBOARD_FORMAT, version: 1, groups: [], objects: [{
    id: 'pasted-structure', name: 'Chemical structure', type: image.svg ? 'vector' : 'raster', canvas: 'main',
    x: Math.max(0, Math.min(canvas.width - size.width, (canvas.width - size.width) / 2 + offset)),
    y: Math.max(0, Math.min(canvas.height - size.height, (canvas.height - size.height) / 2 + offset)),
    ...size, ...(image.svg ? { svg: image.svg } : { dataUrl: image.dataUrl, textFree: false }), chemicalStructure: true
  }] };
}
