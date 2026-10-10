import { RESIZE_HANDLES, resizeCursor } from './geometry.mjs';
import { selectionBounds } from './grouping.mjs';

const NS = 'http://www.w3.org/2000/svg';
const TAGS = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop']);
const ATTRIBUTES = new Set(['id', 'viewBox', 'xmlns', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'clip-path', 'clip-rule', 'mask', 'maskUnits', 'maskContentUnits', 'clipPathUnits', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset', 'stop-color', 'stop-opacity', 'fx', 'fy', 'fr', 'preserveAspectRatio', 'vector-effect']);

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
  return object.type === 'text' && object.fontFamily.split(',').some(name => name.trim().replace(/^['"]|['"]$/g, '').toLowerCase() === 'inter');
}

export function validateSvg(source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('SVG entities and document types are not supported.');
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.localName !== 'svg' || svg.namespaceURI !== NS || parsed.querySelector('parsererror')) throw new Error('Use a complete, valid SVG with xmlns and viewBox.');
  if (!svg.hasAttribute('viewBox')) throw new Error('SVG artwork needs a viewBox.');
  const box = svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || box.some(value => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0) throw new Error('SVG viewBox needs positive width and height.');
  const ids = new Set();
  const references = [];
  const visit = node => {
    if (node.nodeType === 1) {
      if (node.namespaceURI !== NS || !TAGS.has(node.localName)) throw new Error(`SVG <${node.localName}> is not supported. Use text objects for all labels and separate raster objects for images.`);
      for (const attr of node.attributes) {
        if (!ATTRIBUTES.has(attr.name) || (attr.namespaceURI && attr.namespaceURI !== 'http://www.w3.org/2000/xmlns/')) throw new Error(`SVG attribute ${attr.name} is not supported. Use presentation attributes instead of styles.`);
        if (/url\s*\(/i.test(attr.value)) {
          if (!/^url\(#[a-zA-Z0-9_-]+\)$/.test(attr.value)) throw new Error('SVG references must be local fragment IDs.');
          references.push(attr.value.slice(5, -1));
        }
      }
      if (node.id) {
        if (!/^[a-zA-Z0-9_-]+$/.test(node.id) || ids.has(node.id)) throw new Error('SVG IDs must be unique letters, numbers, underscores or hyphens.');
        ids.add(node.id);
      }
      for (const child of node.childNodes) visit(child);
    } else if (node.nodeType === 3 && node.textContent.trim()) throw new Error('SVG artwork must be text-free. Create an independent text object.');
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
      if (attr.value.startsWith('url(#')) node.setAttribute(attr.name, `url(#${prefix}${attr.value.slice(5, -1)})`);
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

// Editing bounds are separate from the saved layout box, which determines
// text alignment, anchoring and rotation. No saved label or export moves.
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
  const artwork = object.type === 'vector' ? vectorArtwork(object, namespace)
    : object.type === 'text' ? textArtwork(object)
      : element('image', { width: object.width, height: object.height, href: object.dataUrl, preserveAspectRatio: 'none' });
  if (interactive) artwork.setAttribute('pointer-events', 'none');
  group.append(artwork);
  return group;
}

export function scene(documentState, canvas, { interactive = false, selectedId = '', selectedIds = [], selectionBox } = {}) {
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
    if (members.length > 1) {
      const outlines = element('g', { class: 'selection-members', 'pointer-events': 'none', 'aria-hidden': 'true' });
      for (const object of members.filter(object => object.visible)) {
        outlines.append(element('rect', { width: object.width, height: object.height,
          transform: `translate(${object.x} ${object.y}) rotate(${object.rotation} ${object.width / 2} ${object.height / 2})`,
          fill: 'none', stroke: '#3977c3', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke',
          class: 'selection-member', 'data-selected-object-id': object.id }));
      }
      svg.append(outlines);
    }
    const single = documentState.objects.find(obj => obj.id === selectedId && obj.canvas === canvas && obj.visible);
    const selected = selectionBox || (members.length > 1 && members.some(object => object.visible)
      ? { ...selectionBounds(members), id: 'selection' }
      : single && interactionBox(single));
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

export async function svgSource(documentState, canvas) {
  const svg = scene(documentState, canvas);
  const interObjects = documentState.objects.filter(object => object.canvas === canvas && object.visible && usesInter(object));
  if (interObjects.length) {
    const dataUrl = await embeddedInter();
    await Promise.all(interObjects.map(object => document.fonts.load(`${object.italic ? 'italic ' : ''}${object.fontWeight} ${object.fontSize}px Inter`, object.text)));
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
