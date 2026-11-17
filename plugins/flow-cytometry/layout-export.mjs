const COLUMN = 410;
const GAP = 14;
const MARGIN = 22;
const CARD_PAD = 10;
const TITLE_FONT = 'bold 20px Arial';
const CARD_FONT = 'bold 14px Arial';
const NOTE_FONT = '12px Arial';
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 12_000;
const SAVE_LIMIT = 24_000_000;
const SVG_PAINT = [
  'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'vector-effect', 'paint-order', 'opacity',
  'font-family', 'font-size', 'font-weight', 'text-anchor'
];

function svgSnapshot(layer) {
  const copy = layer.cloneNode(true);
  copy.removeAttribute('style');
  const originals = [layer, ...layer.querySelectorAll('*')];
  const clones = [copy, ...copy.querySelectorAll('*')];
  for (const [index, original] of originals.entries()) {
    const style = getComputedStyle(original);
    for (const property of SVG_PAINT) {
      clones[index].style.setProperty(property, style.getPropertyValue(property));
    }
  }
  return copy;
}

function exportCard(tile) {
  const frame = tile.figure.querySelector('.layout-plot-frame');
  const [width, height] = frame.style.aspectRatio.split('/').map(Number);
  const layers = [...frame.children].map(layer => ({
    rect: ['left', 'top', 'width', 'height'].map(property => parseFloat(layer.style[property]) / 100),
    canvas: layer instanceof HTMLCanvasElement ? layer : null,
    svg: layer instanceof SVGElement ? svgSnapshot(layer) : null,
    pixelated: layer.classList.contains('layout-pixelated')
  }));
  const notes = tile.figure.querySelector('figcaption');
  const legends = [...(notes?.querySelectorAll('.histogram-legend li') ?? [])].map(item => {
    const path = item.querySelector('path');
    const dash = path.getAttribute('stroke-dasharray');
    return { text: item.textContent, color: path.getAttribute('stroke'),
      dash: dash === 'none' ? [] : dash.split(' ').map(Number) };
  });
  const captions = Array.from(notes?.childNodes ?? []).filter(node => node.nodeType === 3 || node.nodeName === 'P')
    .map(node => node.textContent.trim()).filter(Boolean);
  return { name: tile.name, kind: tile.kind, wide: tile.wide, ratio: height / width,
    layers, captions, legends, density: Boolean(notes?.querySelector('.legend-ramp')) };
}

function wrap(context, text, width, font) {
  context.font = font;
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    for (const character of word) {
      if (line && context.measureText(line + character).width > width) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function planLayout(layout) {
  const { name, columns } = layout;
  const width = MARGIN * 2 + columns * COLUMN + (columns - 1) * GAP;
  const context = document.createElement('canvas').getContext('2d');
  const title = wrap(context, name, width - 2 * MARGIN, TITLE_FONT);
  const header = MARGIN + title.length * 25 + 12;
  const rows = [];
  let row = null;
  let column = columns;
  for (const tile of layout.tiles) {
    const card = exportCard(tile);
    const span = card.wide && columns > 1 ? 2 : 1;
    if (column + span > columns) {
      row = { cards: [], height: 0 };
      rows.push(row);
      column = 0;
    }
    const cardWidth = COLUMN * span + GAP * (span - 1);
    const inner = cardWidth - 2 * CARD_PAD;
    const title = wrap(context, card.name, inner, CARD_FONT);
    const captions = card.captions.flatMap(text => wrap(context, text, inner, NOTE_FONT));
    const legends = card.legends.map(legend => ({ ...legend, lines: wrap(context, legend.text, inner - 26, NOTE_FONT) }));
    const notes = captions.length + legends.reduce((count, legend) => count + legend.lines.length, 0)
      + Number(card.density);
    const chartTop = CARD_PAD + title.length * 17 + 17;
    const chartHeight = cardWidth * card.ratio;
    const height = chartTop + chartHeight + (notes ? notes * 16 + 12 : 0);
    row.cards.push({ ...card, title, captions, legends, x: MARGIN + column * (COLUMN + GAP),
      width: cardWidth, chartTop, chartHeight, height });
    row.height = Math.max(row.height, height);
    column += span;
  }
  return { width, title, header, rows };
}

function textLines(context, lines, x, top, font, leading, color = '#18191c') {
  context.font = font;
  context.fillStyle = color;
  context.textBaseline = 'top';
  for (const [index, line] of lines.entries()) context.fillText(line, x, top + index * leading);
}

async function drawSvg(context, svg, x, y, width, height) {
  const scale = context.getTransform().a;
  svg.setAttribute('width', Math.max(1, Math.ceil(width * scale)));
  svg.setAttribute('height', Math.max(1, Math.ceil(height * scale)));
  const source = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    context.drawImage(image, x, y, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawDensityLegend(context, width, top, stops) {
  const rampX = width - CARD_PAD - 106;
  const rampY = top + 5;
  const gradient = context.createLinearGradient(rampX, 0, rampX + 76, 0);
  for (const [index, color] of stops.entries()) gradient.addColorStop(index / (stops.length - 1), color);
  context.fillStyle = gradient;
  context.fillRect(rampX, rampY, 76, 6);
  textLines(context, ['Low'], rampX - 26, top, NOTE_FONT, 16);
  textLines(context, ['High'], rampX + 81, top, NOTE_FONT, 16);
}

async function drawCard(context, card, stops) {
  const { width, chartTop, chartHeight } = card;
  textLines(context, card.title, CARD_PAD, CARD_PAD, CARD_FONT, 17);
  textLines(context, [card.kind], CARD_PAD, CARD_PAD + card.title.length * 17, NOTE_FONT, 16, '#4a4b50');
  context.save();
  context.beginPath();
  context.rect(0, chartTop, width, chartHeight);
  context.clip();
  for (const { rect, svg, canvas, pixelated } of card.layers) {
    const [x, y, w, h] = [width * rect[0], chartTop + chartHeight * rect[1], width * rect[2], chartHeight * rect[3]];
    if (canvas) {
      context.imageSmoothingEnabled = !pixelated;
      context.drawImage(canvas, x, y, w, h);
    } else if (svg) {
      await drawSvg(context, svg, x, y, w, h);
    }
  }
  context.restore();

  let top = chartTop + chartHeight + 5;
  textLines(context, card.captions, CARD_PAD, top, NOTE_FONT, 16);
  top += 16 * card.captions.length;
  for (const { lines, color, dash } of card.legends) {
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 1.6;
    context.setLineDash(dash);
    context.beginPath();
    context.moveTo(CARD_PAD, top + 7);
    context.lineTo(CARD_PAD + 20, top + 7);
    context.stroke();
    context.restore();
    textLines(context, lines, CARD_PAD + 26, top, NOTE_FONT, 16);
    top += 16 * lines.length;
  }
  if (card.density) drawDensityLegend(context, width, top, stops);
  context.strokeStyle = '#d8d8dc';
  context.lineWidth = 1;
  context.strokeRect(.5, .5, width - 1, card.height - 1);
}

function pageRows(rows, available) {
  const pages = [];
  let page = [];
  let used = 0;
  for (const row of rows) {
    const height = Math.min(available, row.height);
    if (page.length && used + GAP + height > available) {
      pages.push(page);
      page = [];
      used = 0;
    }
    if (page.length) used += GAP;
    page.push({ ...row, top: used, scale: height / row.height });
    used += height;
  }
  if (page.length) pages.push(page);
  return pages;
}

function canvasFor(width, height) {
  const scale = Math.min(2, MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  return { canvas, scale };
}

async function renderPage(plan, rows, height, stops, pageNumber) {
  const { canvas, scale } = canvasFor(plan.width, height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(scale, scale);
  textLines(context, plan.title, MARGIN, MARGIN, TITLE_FONT, 25);
  for (const row of rows) {
    for (const card of row.cards) {
      context.save();
      const offset = (plan.width - plan.width * row.scale) / 2;
      context.translate(offset + card.x * row.scale, plan.header + row.top);
      context.scale(row.scale, row.scale);
      await drawCard(context, card, stops);
      context.restore();
    }
  }
  if (pageNumber) textLines(context, [pageNumber], MARGIN, height - 20, NOTE_FONT, 16, '#4a4b50');
  return canvas;
}

async function pngBytes(canvas) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the layout as a PNG.');
  return new Uint8Array(await blob.arrayBuffer());
}

async function pdfImage(canvas) {
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  for (let source = 0, destination = 0; source < rgba.length; source += 4, destination += 3) {
    rgb[destination] = rgba[source];
    rgb[destination + 1] = rgba[source + 1];
    rgb[destination + 2] = rgba[source + 2];
  }
  const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'));
  return { width, height, data: new Uint8Array(await new Response(stream).arrayBuffer()) };
}

async function pdfBytes(images, [width, height]) {
  const encoder = new TextEncoder();
  const offsets = [0];
  const parts = [];
  let length = 0;
  function add(value) {
    const part = typeof value === 'string' ? encoder.encode(value) : value;
    parts.push(part);
    length += part.byteLength;
  }
  function object(value, stream) {
    const id = offsets.length;
    offsets.push(length);
    add(`${id} 0 obj\n`);
    add(value);
    if (stream) {
      add('\nstream\n');
      add(stream);
      add('\nendstream');
    }
    add('\nendobj\n');
  }
  add('%PDF-1.4\n%âãÏÓ\n');
  object('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = images.map((_, index) => `${3 + 3 * index} 0 R`).join(' ');
  object(`<< /Type /Pages /Count ${images.length} /Kids [${kids}] >>`);
  for (const image of images) {
    const page = offsets.length;
    object(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${page + 1} 0 R /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> >>`);
    const commands = encoder.encode(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`);
    object(`<< /Length ${commands.byteLength} >>`, commands);
    object(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.data.byteLength} >>`, image.data);
  }
  const xref = length;
  add(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1)) add(String(offset).padStart(10, '0') + ' 00000 n \n');
  add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}

export async function saveLayout(layout, format, hikari) {
  if (!hikari) throw new Error('Open the layout in Hikari to export it.');
  if (!layout.tiles.length) throw new Error('Add a plot before exporting the layout.');
  const name = layout.name;
  const plan = planLayout(layout);
  const stops = getComputedStyle(document.documentElement).getPropertyValue('--density-colors').split(',').map(color => color.trim());
  let bytes;
  if (format === 'png') {
    const height = plan.header + plan.rows.reduce((sum, row) => sum + row.height + GAP, 0) - GAP + MARGIN;
    const [rows] = pageRows(plan.rows, height);
    bytes = await pngBytes(await renderPage(plan, rows, height, stops));
  } else {
    const size = layout.columns > 2 ? [792, 612] : [612, 792];
    const height = plan.width * size[1] / size[0];
    const pages = pageRows(plan.rows, height - plan.header - MARGIN - 18);
    const images = [];
    for (const [index, page] of pages.entries()) {
      const number = pages.length > 1 ? `${index + 1} / ${pages.length}` : '';
      const canvas = await renderPage(plan, page, height, stops, number);
      images.push(await pdfImage(canvas));
      canvas.width = canvas.height = 1;
    }
    bytes = await pdfBytes(images, size);
  }
  if (Math.ceil(bytes.byteLength / 3) * 4 > SAVE_LIMIT) {
    throw new Error('The export is too large. Try exporting a layout with fewer plots.');
  }
  return hikari.call('downloads.save', { fileName: `${name}.${format}`, dataBase64: bytes.toBase64() });
}
