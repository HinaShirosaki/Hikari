// FCS binary list-mode reader. Offsets are relative to the start of a dataset;
// HEADER and TEXT specify inclusive segment ends.
const HEADER_SIZE = 58;
const MAX_TEXT_SIZE = 8 * 1024 * 1024;
const matrixKeywords = ['$SPILLOVER', 'SPILLOVER', '$SPILL', 'SPILL', '$COMP', 'COMP'];
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const utf8 = new TextDecoder();
const legacy = new TextDecoder('windows-1252');

function uint(text) {
  if (!/^\d+$/.test(text?.trim() ?? '')) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

function readText(bytes, start, end, delimiter = String.fromCharCode(bytes[start])) {
  if (start < HEADER_SIZE || end < start || end >= bytes.length || end - start + 1 > MAX_TEXT_SIZE) {
    throw new Error('The FCS text segment is missing, truncated, or too large.');
  }
  if (delimiter.charCodeAt(0) < 1 || delimiter.charCodeAt(0) > 126) {
    throw new Error('The FCS text delimiter is invalid.');
  }
  const source = bytes.subarray(start, end + 1);
  let decoded = utf8.decode(source);
  if (decoded.includes('\uFFFD')) decoded = legacy.decode(source);
  // A few writers pad TEXT after the final delimiter with spaces or NULs.
  const tail = decoded.lastIndexOf(delimiter);
  if (tail < 1 || /[^\0 ]/.test(decoded.slice(tail + 1))) {
    throw new Error('The FCS text segment has no closing delimiter.');
  }
  const keywords = new Map();
  let token = '';
  let key = null;
  function afterEmptyValue(offset) {
    if (offset > tail || decoded[offset] === '$') return true;
    const name = decoded.slice(offset, decoded.indexOf(delimiter, offset)).trim().toUpperCase();
    return matrixKeywords.includes(name) || name === 'APPLY COMPENSATION';
  }
  for (let index = decoded[0] === delimiter ? 1 : 0; index <= tail; index++) {
    const character = decoded[index];
    if (character !== delimiter) {
      token += character;
    } else if (index < tail && decoded[index + 1] === delimiter
      // Some exports leave a value empty before a standard or spillover keyword.
      && !(key === null && afterEmptyValue(index + 2))) {
      token += delimiter;
      index++;
    } else {
      if (key === null) key = token.trim().toUpperCase();
      else {
        if (key) keywords.set(key, token.trim());
        key = null;
      }
      token = '';
    }
  }
  if (key !== null) throw new Error('The FCS text segment has an incomplete keyword pair.');
  return keywords;
}

function dataSegment(pairs, textStart, textEnd, length, fileSize, nextData) {
  function fits(start, end, exclusive) {
    if (start === null || end === null || start < HEADER_SIZE || end >= fileSize) return false;
    const last = start + length - 1;
    return end + (exclusive ? 0 : 1) - start === length
      && (last < textStart || start > textEnd)
      && (!nextData || last < nextData);
  }
  // A few exporters record an exclusive end; accept it only when the expected
  // event stride and count match exactly. Prefer a valid inclusive pair.
  for (const exclusive of [false, true]) {
    for (const [start, end] of pairs) {
      if (exclusive && end === fileSize && fits(start, end - 1, false)) return start;
      if (fits(start, end, exclusive)) return start;
    }
  }
  throw new Error('The FCS data offsets do not match the event count and channel widths. The file may be incomplete.');
}

function binaryReader(view, type, width, little) {
  if (type === 'F' && width === 4) return offset => view.getFloat32(offset, little);
  if (type === 'D' && width === 8) return offset => view.getFloat64(offset, little);
  if (type === 'I') {
    if (width === 1) return offset => view.getUint8(offset);
    if (width === 2) return offset => view.getUint16(offset, little);
    if (width === 3) {
      return little
        ? offset => view.getUint16(offset, true) + 65536 * view.getUint8(offset + 2)
        : offset => 65536 * view.getUint8(offset) + view.getUint16(offset + 1, false);
    }
    if (width === 4) return offset => view.getUint32(offset, little);
  }
  throw new Error(`Unsupported FCS measurement encoding: ${type || 'unspecified'}, ${width * 8} bits.`);
}

function findChannel(channels, field, name) {
  const matches = predicate => channels.flatMap((channel, index) => predicate(channel[field]) ? [index] : []);
  let indices = matches(value => value === name);
  if (!indices.length) indices = matches(value => value?.toUpperCase() === name.toUpperCase());
  if (indices.length > 1) throw new Error(`The spillover matrix has an ambiguous channel: ${name}.`);
  return indices[0] ?? -1;
}

function matrixChannels(names, channels) {
  const detectors = names.map(name => findChannel(channels, 'name', name));
  const numbers = names.map(uint);
  // Some instruments use 1-based acquisition parameter numbers. Interpret
  // the list as numbers only if every entry agrees with that convention.
  const indexed = detectors.includes(-1) && numbers.every((number, index) =>
    number > 0 && number <= channels.length && (detectors[index] === -1 || detectors[index] === number - 1));
  const indices = indexed ? numbers.map(number => number - 1) : detectors.map((index, column) => {
    const name = names[column];
    if (index >= 0) return index;
    const label = name ? findChannel(channels, 'label', name) : -1;
    if (label < 0) throw new Error(`The spillover matrix names an unknown channel: ${name || '(blank)'}.`);
    return label;
  });
  if (new Set(indices).size !== names.length) throw new Error('The spillover matrix lists a channel more than once.');
  return indices;
}

function invertMatrix(values, size) {
  // Gauss-Jordan with partial pivoting on [S | I].
  const width = size * 2;
  const rows = Array.from({ length: size }, (_, row) => {
    const augmented = new Float64Array(width);
    augmented.set(values.slice(row * size, (row + 1) * size));
    augmented[size + row] = 1;
    return augmented;
  });
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    const scale = rows[pivot][column];
    if (!Number.isFinite(scale) || Math.abs(scale) < 1e-9) throw new Error('The spillover matrix cannot be inverted.');
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const base = rows[column];
    for (let entry = column; entry < width; entry++) base[entry] /= scale;
    for (let row = 0; row < size; row++) {
      const factor = rows[row][column];
      if (row === column || !factor) continue;
      for (let entry = column; entry < width; entry++) rows[row][entry] -= factor * base[entry];
    }
  }
  const inverse = rows.map(row => Array.from(row.subarray(size)));
  if (inverse.some(row => !row.every(Number.isFinite))) throw new Error('The spillover matrix cannot be inverted.');
  return inverse;
}

// The matrix is ordered source dye by detector. Row vectors of recorded
// values are multiplied by its inverse in the listed detector order.
export function parseSpillover(text, channels) {
  const parts = text.split(',').map(part => part.trim());
  const size = uint(parts[0]);
  if (!size || size > channels.length || parts.length !== 1 + size + size * size) {
    throw new Error('The spillover matrix is malformed.');
  }
  const indices = matrixChannels(parts.slice(1, size + 1), channels);
  const entries = parts.slice(size + 1);
  const values = entries.map(Number);
  if (!entries.every(entry => decimal.test(entry)) || !values.every(Number.isFinite)) {
    throw new Error('The spillover matrix has non-numeric values.');
  }
  return { indices, inverse: invertMatrix(values, size) };
}

function readCompensation(keywords, channels, logarithmic) {
  let failure;
  const recorded = (keyword, message) => ({ spillover: null, compensation: { applied: false, keyword, message } });
  for (const keyword of matrixKeywords) {
    const text = keywords.get(keyword);
    if (!text) continue;
    if (keyword.replace(/^\$/, '') === 'COMP') {
      const parts = text.split(',').map(part => part.trim());
      const size = uint(parts[0]);
      // FCS 3.0 $COMP can describe acquisition compensation as percentages
      // in acquisition order. It is not the named spillover representation.
      const hasCount = size > 0 && size <= channels.length && parts.length === 1 + size * size;
      const fullMatrix = parts.length === channels.length ** 2;
      if ((hasCount || fullMatrix) && parts.slice(hasCount ? 1 : 0).every(part => decimal.test(part))) {
        return recorded(keyword, 'Legacy acquisition compensation metadata.');
      }
    }
    try {
      const spillover = parseSpillover(text, channels);
      if (/^spectroflo\b/i.test(keywords.get('CREATOR') ?? '')
        && keywords.get('APPLY COMPENSATION')?.toUpperCase() === 'FALSE') {
        return recorded(keyword, 'Compensation is disabled in the SpectroFlo file.');
      }
      const identity = spillover.inverse.every((row, index) => row.every((value, column) => value === +(index === column)));
      if (identity) return recorded(keyword, 'The spillover matrix is an identity matrix.');
      if (spillover.indices.some(index => logarithmic.has(index))) {
        return recorded(keyword, 'The matrix includes a logarithmically recorded channel.');
      }
      return { spillover, compensation: { applied: true, keyword, channels: spillover.indices.length } };
    } catch (error) {
      failure ??= recorded(keyword, error.message);
    }
  }
  const legacy = [...keywords.keys()].find(key => /^\$DFC\d+TO\d+$/.test(key));
  if (legacy) return recorded(legacy, 'Legacy acquisition compensation metadata.');
  return failure ?? { spillover: null, compensation: null };
}

export function parseFcs(buffer) {
  const bytes = new Uint8Array(buffer);
  const header = utf8.decode(bytes.subarray(0, HEADER_SIZE));
  const version = header.slice(0, 6);
  if (bytes.length < HEADER_SIZE || !/^FCS(?:2\.0|3\.[012])$/.test(version)) {
    throw new Error('This is not a supported FCS 2.0, 3.0, 3.1, or 3.2 file.');
  }
  const field = start => uint(header.slice(start, start + 8));
  const textStart = field(10);
  const textEnd = field(18);
  const keywords = readText(bytes, textStart ?? -1, textEnd ?? -1);
  const word = key => keywords.get('$' + key);
  const count = uint(word('TOT'));
  const channelCount = uint(word('PAR'));
  const nextData = uint(word('NEXTDATA'));
  const mode = word('MODE')?.toUpperCase();
  if ((mode && mode !== 'L') || (!mode && version !== 'FCS3.2')) {
    throw new Error('This FCS file does not contain list-mode events.');
  }
  if (count === null || !channelCount || channelCount > 1024) {
    throw new Error('The FCS event count or channel count is invalid.');
  }
  const byteOrder = word('BYTEORD')?.replace(/\s/g, '');
  const little = byteOrder === '1,2,3,4' || byteOrder === '1,2';
  if (!little && byteOrder !== '4,3,2,1' && byteOrder !== '2,1') {
    throw new Error('This FCS byte order is unsupported.');
  }
  const supplementalStart = uint(word('BEGINSTEXT'));
  const supplementalEnd = uint(word('ENDSTEXT'));
  if (supplementalStart && supplementalEnd) {
    const extra = readText(bytes, supplementalStart, supplementalEnd, String.fromCharCode(bytes[textStart]));
    for (const [key, value] of extra) {
      if (!keywords.has(key)) keywords.set(key, value);
    }
  }
  const view = new DataView(buffer);
  const readers = [];
  const channels = [];
  const logarithmic = new Set();
  let stride = 0;
  for (let index = 1; index <= channelCount; index++) {
    const keyword = key => word(`P${index}${key}`);
    const bits = uint(keyword('B'));
    const type = (keyword('DATATYPE') || word('DATATYPE'))?.toUpperCase();
    if (type === 'I' && Number(keyword('E')?.split(',')[0]) > 0) logarithmic.add(index - 1);
    if (!bits || bits % 8 !== 0) {
      throw new Error(`Unsupported bit width for channel ${index}. Bit-packed FCS data is not supported.`);
    }
    const width = bits / 8;
    const read = binaryReader(view, type, width, little);
    const range = Number(keyword('R'));
    if (type === 'I' && !(range >= 1 && range <= 2 ** bits)) {
      throw new Error(`Invalid integer range for channel ${index}.`);
    }
    const maskSize = type === 'I' && range < 2 ** bits ? 2 ** Math.ceil(Math.log2(range)) : 0;
    const offset = stride;
    readers.push(maskSize ? start => read(start + offset) % maskSize : start => read(start + offset));
    const name = keyword('N') || `Channel ${index}`;
    const label = keyword('S') || [keyword('TAG'), keyword('ANALYTE')].filter(Boolean).join(' ');
    channels.push({ name, label: label === name ? '' : (label || '') });
    stride += width;
  }
  const length = count * stride;
  if (!Number.isSafeInteger(length) || length > buffer.byteLength) throw new Error('The FCS event data is truncated.');
  const start = count ? dataSegment([
    [uint(word('BEGINDATA')), uint(word('ENDDATA'))],
    [field(26), field(34)]
  ], textStart, textEnd, length, buffer.byteLength, nextData) : 0;
  const { spillover, compensation } = readCompensation(keywords, channels, logarithmic);
  return {
    version, channels, count, instrument: word('CYT') || '',
    hasMore: Boolean(nextData),
    compensation,
    // Keep event rows in the original buffer; opening a file needs no decoded copy.
    reader(channel) {
      const position = spillover ? spillover.indices.indexOf(channel) : -1;
      if (position < 0) {
        const read = readers[channel];
        return index => read(start + index * stride);
      }
      const terms = spillover.indices.flatMap((source, row) => {
        const weight = spillover.inverse[row][position];
        return weight === 0 ? [] : [{ read: readers[source], weight }];
      });
      return index => {
        const offset = start + index * stride;
        let value = 0;
        for (const { read, weight } of terms) value += read(offset) * weight;
        return value;
      };
    }
  };
}

// Synthetic FCS sample with three event populations and a fluorescence channel
// with negative values, so the different display scales can be tried offline.
export function makeDemoFcs({ count = 16000, seed = 421, panel = false, stained = true, thresholds = [.19, .74] } = {}) {
  const header = [
    '$MODE', 'L', '$DATATYPE', 'F', '$BYTEORD', '1,2,3,4', '$PAR', '4',
    '$TOT', String(count), '$NEXTDATA', '0', '$CYT', 'Synthetic sample'
  ];
  const names = panel ? ['FSC-A', 'SSC-A', 'B525', 'R660'] : ['FSC-A', 'SSC-A', 'FL1-A', 'FL2-A'];
  names.forEach((name, index) => {
    header.push(`$P${index + 1}N`, name, `$P${index + 1}B`, '32', `$P${index + 1}R`, '262144');
  });
  if (!panel) header.push('$P3S', 'GFP', '$P4S', 'mCherry');
  const meta = '|' + header.join('|') + '|';
  const data = 58 + meta.length;
  const length = data + count * 16;
  const buffer = new ArrayBuffer(length);
  const fields = [58, data - 1, data, length - 1, 0, 0].map(value => String(value).padStart(8));
  new Uint8Array(buffer).set(new TextEncoder().encode('FCS3.1    ' + fields.join('') + meta));
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  const view = new DataView(buffer);
  for (let index = 0; index < count; index++) {
    const chance = random();
    const population = chance < thresholds[0] ? 0 : chance < thresholds[1] ? 1 : 2;
    const spread = normal();
    const scatter = [21500, 76000, 127000][population];
    const fsc = Math.max(0, scatter + (population ? 13000 : 5600) * spread);
    const ssc = Math.max(0, [15300, 44500, 100000][population] + 5800 * spread + normal() * (population ? 8600 : 4200));
    const green = stained && population === 2 ? Math.exp(8.5 + 0.53 * normal()) : 35 + 270 * normal();
    const red = stained && population === 1 ? Math.exp(7.9 + 0.48 * normal()) : 20 + 230 * normal();
    [fsc, ssc, green, red].forEach((value, channel) => view.setFloat32(data + index * 16 + channel * 4, value, true));
  }
  return buffer;
}
