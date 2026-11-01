import { installPdfJsCompat } from '../../modules/papers/pdfjs-compat.js';

const identity = [1, 0, 0, 1, 0, 0];
const multiply = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const transform = matrix => `matrix(${matrix.join(' ')})`;
const unsupported = name => { throw new Error(`The PDF structure uses unsupported vector content (${name}). Copy it as SVG to preserve its exact drawing.`); };

// These are the compact DrawOPS emitted by the vendored PDF.js. No coordinates
// are sampled: bonds, curves and glyph outlines stay SVG paths throughout.
export function pdfDrawingPath(data) {
  const commands = ['M', 'L', 'C', 'Q', 'Z'], counts = [2, 2, 6, 4, 0], output = [];
  for (let index = 0; index < data.length;) {
    const op = data[index++], count = counts[op];
    if (count === undefined || index + count > data.length) unsupported('path');
    const values = Array.from(data.slice(index, index + count));
    if (!values.every(Number.isFinite)) unsupported('non-finite coordinates');
    output.push(commands[op] + values.join(' ')); index += count;
  }
  return output.join(' ');
}

export function chemicalPdfOperators(page, list, OPS) {
  if (list.fnArray.length > 50000) throw new Error('The copied PDF structure is too complex. Copy a smaller selection.');
  const viewport = page.getViewport({ scale: 1 }), body = [], defs = [], stack = [];
  let pendingClip = '', clipId = 0;
  let state = { matrix: viewport.transform, clips: [], fill: '#000000', stroke: '#000000', fillAlpha: 1, strokeAlpha: 1,
    width: 1, cap: 0, join: 0, miter: 10, dash: [], dashOffset: 0, textMatrix: identity,
    x: 0, y: 0, lineX: 0, lineY: 0, leading: 0, charSpace: 0, wordSpace: 0, hScale: 1, rise: 0, textMode: 0, fontSize: 0, direction: 1 };
  const save = () => stack.push({ ...state, clips: [...state.clips] });
  const restore = () => { if (!stack.length) unsupported('unbalanced restore'); state = stack.pop(); };
  const color = value => { if (typeof value !== 'string' || !/^#[a-f\d]{6}$/i.test(value)) unsupported('color'); return value; };
  const emit = (d, fill, stroke, matrix = state.matrix, evenOdd = false) => {
    if (!d || (!fill && !stroke)) return;
    const shape = `<path d="${d}" transform="${transform(matrix)}" fill="${fill ? state.fill : 'none'}"${fill ? ` fill-opacity="${state.fillAlpha}"${evenOdd ? ' fill-rule="evenodd"' : ''}` : ''}${stroke ? ` stroke="${state.stroke}" stroke-opacity="${state.strokeAlpha}" stroke-width="${state.width || .1}" stroke-linecap="${['butt', 'round', 'square'][state.cap]}" stroke-linejoin="${['miter', 'round', 'bevel'][state.join]}" stroke-miterlimit="${state.miter}"${state.dash.length ? ` stroke-dasharray="${state.dash.join(' ')}" stroke-dashoffset="${state.dashOffset}"` : ''}` : ''}/>`;
    body.push(state.clips.map(id => `<g clip-path="url(#${id})">`).join('') + shape + '</g>'.repeat(state.clips.length));
  };
  const addClip = (d, evenOdd = false) => {
    const id = `chemical-clip-${++clipId}`;
    defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${d}" transform="${transform(state.matrix)}"${evenOdd ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
    state.clips = [...state.clips, id];
  };
  const moveText = (x, y) => { state.x = state.lineX += x; state.y = state.lineY += y; };
  const showText = glyphs => {
    const font = state.font;
    if (!font || font.isType3Font || font.vertical || state.textMode > 3) unsupported('font or text clipping');
    const size = state.fontSize, horizontal = state.hScale * state.direction;
    let cursor = 0;
    let matrix = multiply(state.matrix, state.textMatrix);
    matrix = multiply(matrix, [1, 0, 0, 1, state.x, state.y + state.rise]);
    matrix = multiply(matrix, [horizontal, 0, 0, state.direction > 0 ? -1 : 1, 0, 0]);
    const glyph = (character, x, y) => {
      const id = `${font.loadedName}_path_${character}`;
      if (!page.commonObjs.has(id)) unsupported('missing atom glyph outline');
      const data = page.commonObjs.get(id).path;
      if (!data) unsupported('missing atom glyph outline');
      const glyphMatrix = multiply(multiply(matrix, [1, 0, 0, 1, x, y]), [size, 0, 0, -size, 0, 0]);
      emit(pdfDrawingPath(data), state.textMode === 0 || state.textMode === 2, state.textMode === 1 || state.textMode === 2, glyphMatrix);
    };
    for (const item of glyphs) {
      if (typeof item === 'number') { cursor -= item * size / 1000; continue; }
      if (!item.isSpace && state.textMode !== 3) {
        glyph(item.fontChar, cursor, 0);
        if (item.accent) glyph(item.accent.fontChar, cursor + size * item.accent.offset.x, -size * item.accent.offset.y);
      }
      cursor += item.width * size * (font.fontMatrix?.[0] || .001) + (item.isSpace ? state.wordSpace : 0) + state.charSpace * state.direction;
    }
    state.x += cursor * horizontal;
  };
  const names = Object.fromEntries(Object.entries(OPS).map(([name, value]) => [value, name]));
  for (let index = 0; index < list.fnArray.length; index++) {
    const name = names[list.fnArray[index]], args = list.argsArray[index] || [];
    switch (name) {
      case 'dependency': case 'markPoint': case 'markPointProps': case 'beginMarkedContent': case 'beginMarkedContentProps': case 'endMarkedContent': case 'beginCompat': case 'endCompat': case 'endText': break;
      case 'save': save(); break;
      case 'restore': restore(); break;
      case 'transform': state.matrix = multiply(state.matrix, args); break;
      case 'setLineWidth': state.width = args[0]; break;
      case 'setLineCap': state.cap = args[0]; break;
      case 'setLineJoin': state.join = args[0]; break;
      case 'setMiterLimit': state.miter = args[0]; break;
      case 'setDash': [state.dash, state.dashOffset] = args; break;
      case 'setRenderingIntent': case 'setFlatness': break;
      case 'setFillRGBColor': state.fill = color(args[0]); break;
      case 'setStrokeRGBColor': state.stroke = color(args[0]); break;
      case 'setFillTransparent': state.fillAlpha = 0; break;
      case 'setStrokeTransparent': state.strokeAlpha = 0; break;
      case 'setGState':
        for (const [key, value] of args[0]) {
          const property = { LW: 'width', LC: 'cap', LJ: 'join', ML: 'miter', CA: 'strokeAlpha', ca: 'fillAlpha' }[key];
          if (property) state[property] = value;
          else if (key === 'D') [state.dash, state.dashOffset] = value;
          else if (key === 'BM' && value === 'source-over' || key === 'SMask' && !value || ['RI', 'FL'].includes(key)) continue;
          else unsupported(`graphics state ${key}`);
        }
        break;
      case 'clip': pendingClip = 'nonzero'; break;
      case 'eoClip': pendingClip = 'evenodd'; break;
      case 'constructPath': {
        const operation = names[args[0]], d = pdfDrawingPath(args[1][0]);
        const fill = ['fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke'].includes(operation);
        const stroke = ['stroke', 'closeStroke', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke'].includes(operation);
        if (!fill && !stroke && operation !== 'endPath') unsupported(operation);
        emit(d + (operation.startsWith('close') ? ' Z' : ''), fill, stroke, state.matrix, operation.toLowerCase().includes('eo'));
        if (pendingClip) { addClip(d, pendingClip === 'evenodd'); pendingClip = ''; }
        break;
      }
      case 'paintFormXObjectBegin':
        save();
        if (args[0]) state.matrix = multiply(state.matrix, args[0]);
        if (args[1]) { const [x, y, right, top] = args[1]; addClip(`M${x} ${y} L${right} ${y} L${right} ${top} L${x} ${top} Z`); }
        break;
      case 'paintFormXObjectEnd': restore(); break;
      case 'beginText': state.textMatrix = identity; state.x = state.y = state.lineX = state.lineY = 0; break;
      case 'setFont': state.font = page.commonObjs.get(args[0]); state.fontSize = Math.abs(args[1]); state.direction = args[1] < 0 ? -1 : 1; break;
      case 'setCharSpacing': state.charSpace = args[0]; break;
      case 'setWordSpacing': state.wordSpace = args[0]; break;
      case 'setHScale': state.hScale = args[0] / 100; break;
      case 'setLeading': state.leading = -args[0]; break;
      case 'setTextRise': state.rise = args[0]; break;
      case 'setTextRenderingMode': state.textMode = args[0]; break;
      case 'setTextMatrix': state.textMatrix = args.length === 1 ? args[0] : args; state.x = state.y = state.lineX = state.lineY = 0; break;
      case 'moveText': moveText(...args); break;
      case 'setLeadingMoveText': state.leading = -args[1]; moveText(...args); break;
      case 'nextLine': moveText(0, state.leading); break;
      case 'showText': showText(args[0]); break;
      case 'showSpacedText': showText(args[0]); break;
      case 'nextLineShowText': moveText(0, state.leading); showText(args[0]); break;
      case 'nextLineSetSpacingShowText': state.wordSpace = args[0]; state.charSpace = args[1]; moveText(0, state.leading); showText(args[2]); break;
      default: unsupported(name);
    }
  }
  if (!body.length || stack.length) unsupported('empty or unbalanced page');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewport.width} ${viewport.height}" width="${viewport.width}" height="${viewport.height}"><defs>${defs.join('')}</defs>${body.join('')}</svg>`;
  if (svg.length > 3000000) throw new Error('The vector structure is too large. Copy a smaller selection.');
  return { svg, width: viewport.width, height: viewport.height };
}

export async function chemicalPdfVector(dataBase64) {
  if (typeof dataBase64 !== 'string' || dataBase64.length > 7000000 || !/^[A-Za-z\d+/]+={0,2}$/.test(dataBase64)) throw new Error('Invalid clipboard PDF.');
  installPdfJsCompat();
  const pdfjs = await import('../../../../vendor/pdfjs/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../../../vendor/pdfjs/build/pdf.worker.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({ data: Uint8Array.from(atob(dataBase64), c => c.charCodeAt(0)),
    disableFontFace: true, fontExtraProperties: true, isEvalSupported: false, useSystemFonts: false,
    standardFontDataUrl: new URL('../../../../vendor/pdfjs/web/standard_fonts/', import.meta.url).href });
  let timer;
  try {
    return await Promise.race([(async () => {
      const pdf = await task.promise;
      if (pdf.numPages !== 1) throw new Error('Copy a single-page chemical structure.');
      const page = await pdf.getPage(1), list = await page.getOperatorList();
      return chemicalPdfOperators(page, list, pdfjs.OPS);
    })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The copied PDF took too long to convert. Copy it as SVG instead.')), 7000); })]);
  } finally { clearTimeout(timer); await task.destroy(); }
}
