const extensions = ['.fcs', '.lmd', '.csv', '.tsv', '.txt'];
export const EVENT_FILE_ACCEPT = [...extensions, '.gz'].join(',');
export const EVENT_FILE_LIMIT = 256 * 1024 * 1024;
const COLUMN_LIMIT = 1024;
const BLOCK_VALUES = 8192;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const missing = /^(?:na|n\/a|nan|null)$/i;

function fileExtension(name) {
  const base = name.toLowerCase().replace(/\.gz$/, '');
  return extensions.find(extension => base.endsWith(extension));
}

export function isEventFileName(name) {
  return Boolean(fileExtension(name));
}

async function inflate(file, limit, limitError) {
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      total += chunk.byteLength;
      if (total > limit) throw limitError();
      chunks.push(chunk);
    }
  } catch (error) {
    if (total > limit) throw error;
    throw new Error('The gzip file is damaged or incomplete.');
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

// Read one logical row at a time, including quoted fields that contain newlines.
function* records(text, delimiter) {
  const boundary = delimiter === '\t' ? /[\t\r\n"]/g : delimiter === ';' ? /[;\r\n"]/g : /[,\r\n"]/g;
  let start = 0;
  let number = 1;
  let cells = [];
  while (start < text.length) {
    const quoted = text[start] === '"';
    let value;
    let end;
    if (quoted) {
      let quote = text.indexOf('"', start + 1);
      while (quote !== -1 && text[quote + 1] === '"') quote = text.indexOf('"', quote + 2);
      if (quote === -1) throw new Error('Unclosed quoted field in row ' + number + '.');
      value = text.slice(start + 1, quote).replaceAll('""', '"').trim();
      end = quote + 1;
      while (text[end] === ' ' || (delimiter !== '\t' && text[end] === '\t')) end++;
      if (end < text.length && text[end] !== delimiter && text[end] !== '\r' && text[end] !== '\n') {
        throw new Error('Unexpected characters after a quoted field in row ' + number + '.');
      }
    } else {
      boundary.lastIndex = start;
      end = boundary.exec(text)?.index ?? text.length;
      if (text[end] === '"') throw new Error('Unexpected quote in row ' + number + '.');
      value = text.slice(start, end).trim();
    }
    cells.push(value);
    if (text[end] === delimiter) {
      if (cells.length === COLUMN_LIMIT) throw new Error('Event tables can have up to 1,024 channels.');
      start = end + 1;
      if (start < text.length) continue;
      cells.push('');
    } else {
      start = end + (text[end] === '\r' && text[end + 1] === '\n' ? 2 : 1);
    }
    if (cells.length > 1 || value || quoted) yield { cells, number };
    cells = [];
    number++;
  }
}

function eventValue(cell, delimiter) {
  if (!cell || missing.test(cell)) return NaN;
  const value = delimiter === ';' ? cell.replace(',', '.') : cell;
  if (!decimal.test(value)) return undefined;
  return Number(value);
}

function chooseDelimiter(text, extension) {
  if (extension === '.tsv') return '\t';
  const choices = extension === '.txt' ? ['\t', ',', ';'] : [',', ';'];
  // Check that the first data row matches the first row's width. A stray
  // delimiter in a channel name or a decimal comma cannot decide the dialect.
  for (const delimiter of choices) {
    try {
      const rows = records(text, delimiter);
      const first = rows.next().value?.cells;
      if (!first || first.length < 2) continue;
      const second = rows.next().value?.cells ?? first;
      if (first.length === second.length && second.every(cell => eventValue(cell, delimiter) !== undefined)) return delimiter;
    } catch {
      // Let the full parse for the chosen delimiter report syntax errors.
    }
  }
  return choices[0];
}

function channelNames(cells, header) {
  const used = new Set();
  return cells.map((cell, index) => {
    const base = (header && cell) || 'Channel ' + (index + 1);
    let name = base;
    for (let suffix = 2; used.has(name.toUpperCase()); suffix++) name = base + ' (' + suffix + ')';
    used.add(name.toUpperCase());
    return { name, label: '' };
  });
}

function decodeTable(bytes) {
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  let text;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Save the event table as UTF-8 or UTF-16 text.');
  }
  if (text.includes('\0')) throw new Error('This file does not contain a plain-text event table.');
  return text;
}

function parseTable(bytes, extension, limit, limitError) {
  const text = decodeTable(bytes);
  const delimiter = chooseDelimiter(text, extension);
  const rows = records(text, delimiter);
  const first = rows.next().value;
  if (!first) throw new Error('The event table is empty.');
  const header = first.cells.some(cell => eventValue(cell, delimiter) === undefined);
  const channels = channelNames(first.cells, header);
  const width = channels.length;
  const blocks = [];
  const valueLimit = Math.floor(limit / Float64Array.BYTES_PER_ELEMENT);
  let length = 0;
  let hasValues = false;

  function append({ cells, number }) {
    if (cells.length !== width) throw new Error('Row ' + number + ' has ' + cells.length + ' columns. Expected ' + width + '.');
    if (length + width > valueLimit) throw limitError();
    for (let column = 0; column < width; column++) {
      const value = eventValue(cells[column], delimiter);
      if (value === undefined) throw new Error('Row ' + number + ', column ' + (column + 1) + ' must contain a number or a blank value.');
      if (Math.abs(value) === Infinity) throw new Error('Row ' + number + ', column ' + (column + 1) + ' is outside the numeric range.');
      const within = length % BLOCK_VALUES;
      if (within === 0) blocks.push(new Float64Array(Math.min(BLOCK_VALUES, valueLimit - length)));
      blocks.at(-1)[within] = value;
      hasValues ||= Number.isFinite(value);
      length++;
    }
  }

  if (!header) append(first);
  for (const row of rows) append(row);
  if (!hasValues) throw new Error('The table has no numeric events. Export one row per event.');
  const last = blocks.at(-1);
  const used = length % BLOCK_VALUES;
  if (used && used < last.length) blocks[blocks.length - 1] = last.slice(0, used);

  return {
    size: length * Float64Array.BYTES_PER_ELEMENT,
    dataset: {
      version: delimiter === '\t' ? 'TSV' : extension === '.txt' ? 'Text' : 'CSV',
      channels, count: length / width, instrument: '', hasMore: false, compensation: null,
      reader: channel => index => {
        const position = index * width + channel;
        return blocks[Math.floor(position / BLOCK_VALUES)][position % BLOCK_VALUES];
      }
    }
  };
}

export async function readEventFile(file, available = EVENT_FILE_LIMIT) {
  if (file.size > EVENT_FILE_LIMIT) throw new Error('The file exceeds the 256 MiB limit.');
  const limit = Math.min(available, EVENT_FILE_LIMIT);
  const limitError = () => new Error(limit < EVENT_FILE_LIMIT
    ? 'Close other data files to free space in this session.'
    : 'The decoded event data exceeds the 256 MiB limit.');
  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const compressed = signature[0] === 0x1f && signature[1] === 0x8b;
  if (!compressed && /\.gz$/i.test(file.name)) throw new Error('The file does not have a gzip header.');
  if (!compressed && file.size > limit) throw limitError();
  const buffer = compressed ? await inflate(file, limit, limitError) : await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const prefix = String.fromCharCode(...bytes.subarray(0, 6));
  const extension = fileExtension(file.name);
  if (/^FCS\d\.\d$/.test(prefix) || extension === '.fcs' || extension === '.lmd') {
    const { parseFcs } = await import('./fcs.mjs');
    return { dataset: parseFcs(buffer), size: buffer.byteLength };
  }
  if (extension) return parseTable(bytes, extension, limit, limitError);
  throw new Error('Export the events as FCS, LMD, CSV, TSV, or delimited TXT.');
}
