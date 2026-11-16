import { RESIZE_HANDLES, resizeCursor } from './geometry.mjs';

const NS = 'http://www.w3.org/2000/svg';
const TAGS = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop']);
const ATTRIBUTES = new Set(['id', 'viewBox', 'xmlns', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'clip-path', 'clip-rule', 'mask', 'maskUnits', 'maskContentUnits', 'clipPathUnits', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset', 'stop-color', 'stop-opacity', 'fx', 'fy', 'fr', 'preserveAspectRatio', 'vector-effect']);
const PLOT_TAGS = new Set([...TAGS, 'text', 'tspan', 'image', 'pattern']);
const PLOT_ATTRIBUTES = new Set([...ATTRIBUTES, 'style', 'xmlns:xlink', 'href', 'xlink:href', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'text-anchor', 'text-decoration', 'dominant-baseline', 'alignment-baseline', 'shape-rendering', 'image-rendering', 'text-rendering', 'overflow', 'display', 'visibility', 'white-space', 'pointer-events', 'paint-order', 'letter-spacing', 'word-spacing', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'xml:space', 'patternUnits', 'patternContentUnits', 'patternTransform']);
const PLOT_STYLES = new Set([...ATTRIBUTES, ...PLOT_ATTRIBUTES]);

export function validateSvg(source, { plot = false, chemical = false } = {}) {
  const extended = plot || chemical;
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('SVG entities and document types are not supported.');
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.localName !== 'svg' || svg.namespaceURI !== NS || parsed.querySelector('parsererror')) throw new Error('Use a complete, valid SVG with xmlns and viewBox.');
  if (extended && !svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${parseFloat(svg.getAttribute('width'))} ${parseFloat(svg.getAttribute('height'))}`);
  if (!svg.hasAttribute('viewBox')) throw new Error('SVG artwork needs a viewBox.');
  const box = svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || box.some(value => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0) throw new Error('SVG viewBox needs positive width and height.');
  const ids = new Set();
  const references = [];
  const reference = value => {
    if (!/url\s*\(/i.test(value)) return;
    const match = /^url\(\s*["']?#([a-zA-Z0-9_-]+)["']?\s*\)$/.exec(value);
    if (!match) throw new Error('SVG references must be local fragment IDs.');
    references.push(match[1]);
  };
  const visit = node => {
    if (node.nodeType === 1) {
      if (node.namespaceURI !== NS || !(extended ? PLOT_TAGS : TAGS).has(node.localName)
        || chemical && node.localName === 'image') throw new Error(`SVG <${node.localName}> is not supported. Use text objects for all labels and separate raster objects for images.`);
      for (const attr of [...node.attributes]) {
        if (extended && (['class', 'role', 'version', 'focusable'].includes(attr.name) || /^(?:data-|aria-)/.test(attr.name))) { node.removeAttribute(attr.name); continue; }
        const namespaces = extended ? ['http://www.w3.org/2000/xmlns/', 'http://www.w3.org/1999/xlink', 'http://www.w3.org/XML/1998/namespace'] : ['http://www.w3.org/2000/xmlns/'];
        if (!(extended ? PLOT_ATTRIBUTES : ATTRIBUTES).has(attr.name) || attr.namespaceURI && !namespaces.includes(attr.namespaceURI)) throw new Error(`SVG attribute ${attr.name} is not supported. Use presentation attributes instead of styles.`);
        if (chemical && ['href', 'xlink:href'].includes(attr.name)) throw new Error('Chemical vector artwork must contain only self-contained paths and text.');
        if (extended && attr.name === 'style') {
          for (const property of [...node.style]) {
            if (!PLOT_STYLES.has(property)) continue;
            const value = node.style.getPropertyValue(property).trim(); reference(value);
            node.setAttribute(property, value);
          }
          // Presentation attributes preserve Plotly's appearance under the
          // plugin's strict style-src CSP; imported inline CSS is never needed.
          node.removeAttribute('style');
        } else if (plot && ['href', 'xlink:href'].includes(attr.name)) {
          if (node.localName !== 'image' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(attr.value) || attr.value.length > 7000000) throw new Error('Plot images must contain embedded PNG, JPEG or WebP bytes.');
        } else {
          reference(attr.value);
        }
      }
      if (node.id) {
        if (!/^[a-zA-Z0-9_-]+$/.test(node.id) || ids.has(node.id)) throw new Error('SVG IDs must be unique letters, numbers, underscores or hyphens.');
        ids.add(node.id);
      }
      for (const child of node.childNodes) visit(child);
    } else if (node.nodeType === 3 && node.textContent.trim() && !extended) throw new Error('SVG artwork must be text-free. Create an independent text object.');
    else if (![3, 8].includes(node.nodeType)) throw new Error('SVG processing instructions are not supported.');
  };
  visit(svg);
  if (references.some(id => !ids.has(id))) throw new Error('SVG references must resolve inside the same object.');
  return new XMLSerializer().serializeToString(svg);
}

export function element(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function stretchSvg(source) {
  const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
  svg.setAttribute('preserveAspectRatio', 'none');
  return new XMLSerializer().serializeToString(svg);
}

function vectorArtwork(object, namespace) {
  const svg = new DOMParser().parseFromString(object.svg, 'image/svg+xml').documentElement;
  // Imported gradient/clip IDs must not collide between independently placed assets.
  const prefix = `${namespace}-svg-`;
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    if (node.id) node.id = prefix + node.id;
    for (const attr of [...node.attributes]) {
      if (/url\(/.test(attr.value)) node.setAttribute(attr.name, attr.value.replace(/url\(\s*["']?#([a-zA-Z0-9_-]+)["']?\s*\)/g, (_match, id) => `url(#${prefix}${id})`));
    }
    if (!['defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop'].includes(node.localName)) {
      if (object.fill !== undefined) node.setAttribute('fill', object.fill);
      if (object.stroke !== undefined) node.setAttribute('stroke', object.stroke);
      if (object.strokeWidth !== undefined) node.setAttribute('stroke-width', object.strokeWidth);
    }
  }
  svg.setAttribute('x', '0'); svg.setAttribute('y', '0');
  svg.setAttribute('width', String(object.width)); svg.setAttribute('height', String(object.height));
  // Keep explicit meet/slice/none. SVG's default is xMidYMid meet.
  return document.importNode(svg, true);
}

export function componentSvgSource(object) {
  // Bound the PNG preview generated by the PPTX library while retaining the
  // original vector coordinate system and full-resolution SVG artwork.
  const previewScale = Math.min(1, 2048 / Math.max(object.width, object.height));
  const svg = element('svg', { xmlns: NS, width: object.width * previewScale, height: object.height * previewScale,
    viewBox: `0 0 ${object.width} ${object.height}`, color: '#000000' });
  svg.append(vectorArtwork(object, `pptx-${object.id}`));
  return new XMLSerializer().serializeToString(svg);
}

function textArtwork(object) {
  const lineHeight = object.fontSize * 1.2;
  const lines = object.text.split('\n');
  const total = lines.length * lineHeight;
  const top = object.anchor === 'top' ? 0 : object.anchor === 'middle' ? (object.height - total) / 2 : object.height - total;
  const x = object.align === 'start' ? 0 : object.align === 'middle' ? object.width / 2 : object.width;
  const text = element('text', { x, y: top + object.fontSize, fill: object.color, 'font-family': object.fontFamily,
    'font-size': object.fontSize, 'font-weight': object.fontWeight, 'font-style': object.italic ? 'italic' : 'normal',
    'text-decoration': object.underline ? 'underline' : 'none', 'text-anchor': object.align });
  // Fix typography in figure units, independent of host CSS and display scale.
  text.style.fontOpticalSizing = 'none';
  text.style.fontKerning = 'normal';
  text.style.fontSynthesis = 'style';
  lines.forEach((line, index) => text.append(element('tspan', { x, dy: index ? lineHeight : 0 }, line)));
  return text;
}

let textMeasureSurface;
const textBoundsCache = new Map();
export function clearTextBounds() { textBoundsCache.clear(); }
function localTextBounds(object) {
  const key = JSON.stringify([object.text, object.fontFamily, object.fontSize, object.fontWeight,
    object.italic, object.underline, object.align, object.anchor, object.width, object.height]);
  if (textBoundsCache.has(key)) return textBoundsCache.get(key);
  if (!textMeasureSurface) {
    textMeasureSurface = element('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
    // Measure at a larger scale to avoid rounding whole font pixels in figure
    // units; selection stays precise even at the editor's maximum 8x zoom.
    textMeasureSurface.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;overflow:hidden;transform:scale(16);transform-origin:0 0';
    document.body.append(textMeasureSurface);
  }
  const text = textArtwork(object);
  textMeasureSurface.append(text);
  const measured = text.getBBox(); text.remove();
  // Empty labels retain a tiny target; their authored layout box is never an
  // invisible obstacle over nearby artwork. Multiline text uses the full union.
  const box = { x: measured.x, y: measured.y, width: Math.max(1, measured.width), height: Math.max(1, measured.height) };
  if (textBoundsCache.size >= 512) textBoundsCache.clear();
  textBoundsCache.set(key, box);
  return box;
}

// Painted bounds keep hit testing, guides and multi-selection close to the
// glyphs. A single selected label exposes its authored text box for resizing
// and alignment; that frame is separate from this painted target.
export function interactionBox(object) {
  if (object.type !== 'text') return object;
  const box = localTextBounds(object), angle = object.rotation * Math.PI / 180;
  const dx = box.x + box.width / 2 - object.width / 2, dy = box.y + box.height / 2 - object.height / 2;
  return { ...object, width: box.width, height: box.height,
    x: object.x + object.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle) - box.width / 2,
    y: object.y + object.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) - box.height / 2 };
}

export function objectGroup(object, interactive = false, scope = 'thumbnail') {
  // Length-prefix the logical ID so hyphens cannot merge two different pairs.
  // Scopes also separate canvas objects from their layer thumbnails.
  const namespace = `si-${scope}-${object.id.length}-${object.id}`;
  const group = element('g', { id: `${namespace}-object`, 'data-object-id': object.id, color: '#000000',
    transform: `translate(${object.x} ${object.y}) rotate(${object.rotation} ${object.width / 2} ${object.height / 2})`, opacity: object.opacity });
  if (interactive) {
    group.setAttribute('role', 'button'); group.setAttribute('tabindex', '0');
    group.setAttribute('aria-label', `${object.name}, ${object.type}`);
    const box = object.type === 'text' ? localTextBounds(object) : { x: 0, y: 0, width: object.width, height: object.height };
    group.append(element('rect', { ...box, fill: 'transparent', 'pointer-events': 'all', class: 'object-hit' }));
  }
  const artwork = ['vector', 'plot'].includes(object.type) ? vectorArtwork(object, namespace)
    : object.type === 'text' ? textArtwork(object)
      : element('image', { width: object.width, height: object.height, href: object.dataUrl, preserveAspectRatio: 'none' });
  if (interactive) artwork.setAttribute('pointer-events', 'none');
  group.append(artwork);
  return group;
}

export function scene(documentState, canvas, { interactive = false, selectedId = '', selectedIds = [] } = {}) {
  const { width, height, background } = documentState.canvases[canvas];
  const svg = element('svg', { xmlns: NS, viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': `${canvas} illustration canvas` });
  svg.append(element('rect', { width, height, fill: background, 'pointer-events': 'none' }));
  const groups = (documentState.groups || []).filter(group => group.canvas === canvas);
  if (groups.length) svg.append(element('metadata', { 'data-illustration-groups': 'true' }, JSON.stringify(groups)));
  for (const object of documentState.objects.filter(obj => obj.canvas === canvas && obj.visible)) {
    const group = objectGroup(object, interactive, canvas), membership = groups.find(group => group.ids.includes(object.id));
    if (interactive) group.setAttribute('aria-pressed', String(selectedIds.includes(object.id) || selectedId === object.id));
    if (membership) group.dataset.groupId = membership.id;
    svg.append(group);
  }
  if (interactive) {
    const members = documentState.objects.filter(object => selectedIds.includes(object.id) && object.canvas === canvas).map(interactionBox);
    const outlinedMembers = members.filter(object => object.visible);
    if (members.length > 1 && outlinedMembers.length) {
      const outlines = element('g', { class: 'selection-members', 'pointer-events': 'none', 'aria-hidden': 'true' });
      for (const object of outlinedMembers) {
        outlines.append(element('rect', { width: object.width, height: object.height,
          transform: `translate(${object.x} ${object.y}) rotate(${object.rotation} ${object.width / 2} ${object.height / 2})`,
          fill: 'none', stroke: '#3977c3', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke',
          class: 'selection-member', 'data-selected-object-id': object.id }));
      }
      svg.append(outlines);
    }
    const single = documentState.objects.find(obj => obj.id === selectedId && obj.canvas === canvas && obj.visible);
    const selected = members.length > 1 ? null : single;
    if (selected) {
      const { x, y, width: w, height: h, rotation } = selected;
      const handles = element('g', { transform: `translate(${x} ${y}) rotate(${rotation} ${w / 2} ${h / 2})`, class: 'selection', 'pointer-events': 'none' });
      handles.dataset.selectionWidth = w; handles.dataset.selectionHeight = h;
      handles.append(element('rect', { width: w, height: h, fill: 'none', stroke: '#3977c3', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
      for (const [direction, [horizontal, vertical]] of Object.entries(RESIZE_HANDLES)) {
        const cx = (horizontal + 1) * w / 2, cy = (vertical + 1) * h / 2;
        const resize = element('rect', { x: cx - 6, y: cy - 6, width: 12, height: 12, fill: '#ffffff', stroke: '#3977c3', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'all', class: 'resize-handle' });
        resize.style.cursor = resizeCursor(direction, rotation);
        resize.dataset.resizeId = selected.id; resize.dataset.resizeDirection = direction;
        resize.dataset.cornerX = cx; resize.dataset.cornerY = cy;
        handles.append(resize);
      }
      handles.append(element('line', { x1: w / 2, y1: 0, x2: w / 2, y2: -28,
        class: 'rotation-stem', stroke: '#3977c3', 'vector-effect': 'non-scaling-stroke' }));
      const rotate = element('g', { transform: `translate(${w / 2} -28)`, class: 'rotation-handle',
        'data-rotate-id': selected.id, role: 'button', tabindex: 0,
        'aria-label': 'Rotate selection. Arrow keys rotate; Shift snaps to 15 degrees.', 'pointer-events': 'all' });
      rotate.append(element('title', {}, 'Rotate · Shift snaps to 15°'));
      rotate.append(element('circle', { r: 12, fill: 'transparent', class: 'rotation-hit' }));
      rotate.append(element('circle', { r: 6, fill: '#ffffff', stroke: '#3977c3', 'vector-effect': 'non-scaling-stroke', class: 'rotation-knob' }));
      handles.append(rotate);
      svg.append(handles);
    }
  }
  return svg;
}

export function alphaBounds(pixels, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * 4) throw new Error('Invalid raster pixels.');
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Keep every nonzero alpha value, including faint antialiasing and shadows.
    if (pixels[(y * width + x) * 4 + 3] === 0) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function fitRasterBox(width, height, requestedWidth = width) {
  if (![width, height, requestedWidth].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid raster dimensions.');
  const minimum = 1 / Math.min(width, height), maximum = 8000 / Math.max(width, height);
  if (minimum > maximum) throw new Error('The raster aspect ratio exceeds canvas object limits. Use a less extreme crop.');
  const scale = Math.min(maximum, Math.max(minimum, requestedWidth / width));
  return { width: width * scale, height: height * scale };
}

// Keep a crop at its original visual position, including stretched/rotated layers.
export function cropRasterPatch(object, image, crop) {
  if (![image.width, image.height, crop.width, crop.height].every(value => Number.isFinite(value) && value > 0)
    || ![crop.x, crop.y].every(value => Number.isFinite(value) && value >= 0)
    || crop.x + crop.width > image.width || crop.y + crop.height > image.height) throw new Error('Choose a crop inside the image.');
  const width = object.width * crop.width / image.width, height = object.height * crop.height / image.height;
  if (width < 1 || height < 1) throw new Error('The crop is too small for this layer. Select a larger area.');
  const dx = object.width * (crop.x + crop.width / 2) / image.width - object.width / 2;
  const dy = object.height * (crop.y + crop.height / 2) / image.height - object.height / 2;
  const radians = object.rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  return { x: object.x + object.width / 2 + dx * cos - dy * sin - width / 2,
    y: object.y + object.height / 2 + dx * sin + dy * cos - height / 2, width, height };
}

export async function prepareRaster(dataUrl, { trim = false } = {}) {
  const image = await new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode raster artwork.')); image.src = dataUrl;
  });
  const width = image.naturalWidth, height = image.naturalHeight;
  if (!width || !height || width * height > 64000000) throw new Error('Raster images must be at most 64 megapixels.');
  const result = { dataUrl, width, height, original_width: width, original_height: height, trimmed: false };
  if (!trim || !dataUrl.startsWith('data:image/png;')) return result;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const bounds = alphaBounds(ctx.getImageData(0, 0, width, height).data, width, height);
  if (!bounds) throw new Error('The PNG is fully transparent. Generate visible artwork before importing it.');
  if (bounds.width === width && bounds.height === height) return result;
  const cropped = document.createElement('canvas'); cropped.width = bounds.width; cropped.height = bounds.height;
  cropped.getContext('2d').drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return { ...result, dataUrl: cropped.toDataURL('image/png'), width: bounds.width, height: bounds.height, trimmed: true, crop: bounds };
}

export const EMPTY_PLOT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"/>';

export function normalizePlotly(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['data', 'layout', 'source'].includes(key))
    || !Array.isArray(value.data) || !value.data.length || value.data.length > 100
    || value.data.some(trace => !trace || typeof trace !== 'object' || Array.isArray(trace))
    || value.layout !== undefined && (!value.layout || typeof value.layout !== 'object' || Array.isArray(value.layout))
    || value.source !== undefined && (typeof value.source !== 'string' || value.source.length > 2000)) throw new Error('Plots need plotly:{data:[traces],layout:{...},source:"optional data/processing description"}.');
  const visit = (item, depth = 0) => {
    if (depth > 32) throw new Error('The plot specification is too deeply nested.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error('Plot data must contain JSON values and finite numbers only.');
    Object.values(item).forEach(child => visit(child, depth + 1));
  };
  visit(value);
  if (JSON.stringify(value).length > 2000000) throw new Error('Plot data and layout must be at most 2 million characters.');
  return JSON.parse(JSON.stringify({ data: value.data, layout: value.layout || {}, source: value.source || '' }));
}

export async function preparePlots(next, previous, hikari, validateSvg) {
  for (const object of next.objects.filter(object => object.type === 'plot')) {
    const before = previous.objects.find(item => item.id === object.id);
    if (before?.type === 'plot' && before.width === object.width && before.height === object.height
      && before.svg === object.svg && JSON.stringify(before.plotly) === JSON.stringify(object.plotly)) continue;
    const result = await hikari.call('plotly.render', { figure: { data: object.plotly.data, layout: object.plotly.layout }, width: Math.max(64, object.width), height: Math.max(64, object.height) });
    if (typeof result?.svg !== 'string') throw new Error('This Hikari build cannot render Plotly plots. Update Hikari and try again.');
    object.svg = validateSvg(result.svg, { plot: true });
  }
}
