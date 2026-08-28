import { clamp, normalizeRecordName, normalizeSequenceText } from '../shared.js';
import { postProcessAb1Trace } from '../algorithms/ab1-trace-postprocess.js';

function readAsciiString(bytes) {
  let result = '';
  const safeBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  for (let index = 0; index < safeBytes.length; index += 1) {
    const code = safeBytes[index];
    if (code === 0) {
      continue;
    }
    result += String.fromCharCode(code);
  }
  return result;
}

function readUint32Be(view, offset) {
  return view.getUint32(offset, false);
}

function readUint16Be(view, offset) {
  return view.getUint16(offset, false);
}

function parseAbifDirectoryEntry(view, offset) {
  return {
    name: String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    ),
    number: readUint32Be(view, offset + 4),
    elementType: readUint16Be(view, offset + 8),
    elementSize: readUint16Be(view, offset + 10),
    elementCount: readUint32Be(view, offset + 12),
    dataSize: readUint32Be(view, offset + 16),
    dataOffset: readUint32Be(view, offset + 20),
    entryOffset: offset
  };
}

function getAbifEntryData(buffer, entry) {
  const safeEntry = entry && typeof entry === 'object' ? entry : null;
  if (!safeEntry) {
    return new Uint8Array(0);
  }

  const dataSize = Math.max(0, Number(safeEntry.dataSize) || 0);
  if (!dataSize) {
    return new Uint8Array(0);
  }

  if (dataSize <= 4) {
    return new Uint8Array(buffer.slice(safeEntry.entryOffset + 20, safeEntry.entryOffset + 20 + dataSize));
  }

  const start = Math.max(0, Number(safeEntry.dataOffset) || 0);
  const end = start + dataSize;
  if (end > buffer.byteLength) {
    throw new Error(`AB1 entry ${safeEntry.name}${safeEntry.number} points outside the file.`);
  }
  return new Uint8Array(buffer.slice(start, end));
}

function buildAbifDirectoryMap(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 34) {
    throw new Error('AB1 file is truncated.');
  }
  if (String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  ) !== 'ABIF') {
    throw new Error('Selected file is not a valid AB1/ABIF trace.');
  }

  const root = parseAbifDirectoryEntry(view, 6);
  const directoryCount = Math.max(0, Number(root.elementCount) || 0);
  const directoryOffset = Math.max(0, Number(root.dataOffset) || 0);
  const directoryMap = new Map();

  for (let index = 0; index < directoryCount; index += 1) {
    const entryOffset = directoryOffset + (index * 28);
    if (entryOffset + 28 > buffer.byteLength) {
      throw new Error('AB1 directory table is truncated.');
    }
    const entry = parseAbifDirectoryEntry(view, entryOffset);
    directoryMap.set(`${entry.name}${entry.number}`, entry);
  }

  return directoryMap;
}

function getAbifEntryByPreference(directoryMap, ...keys) {
  for (const key of keys) {
    if (directoryMap.has(key)) {
      return directoryMap.get(key);
    }
  }
  return null;
}

function readNumericSeriesFromEntry(buffer, entry, options = {}) {
  const bytes = getAbifEntryData(buffer, entry);
  const elementSize = Math.max(1, Number(entry?.elementSize) || 1);
  const elementCount = Math.max(0, Number(entry?.elementCount) || 0);
  const availableCount = Math.floor(bytes.byteLength / elementSize);
  const count = elementCount > 0 ? Math.min(elementCount, availableCount) : availableCount;
  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signed = options?.signed === true;
  const values = [];

  for (let index = 0; index < count; index += 1) {
    const offset = index * elementSize;
    let value = 0;
    if (elementSize === 1) {
      value = signed ? dataView.getInt8(offset) : dataView.getUint8(offset);
    } else if (elementSize === 2) {
      value = signed ? dataView.getInt16(offset, false) : dataView.getUint16(offset, false);
    } else if (elementSize === 4) {
      value = signed ? dataView.getInt32(offset, false) : dataView.getUint32(offset, false);
    } else {
      for (let byteIndex = 0; byteIndex < elementSize; byteIndex += 1) {
        value = (value * 256) + dataView.getUint8(offset + byteIndex);
      }
    }
    values.push(value);
  }

  return values;
}

function normalizeAb1BaseOrder(rawValue) {
  const cleaned = String(rawValue || '')
    .toUpperCase()
    .replace(/[^ACGT]/g, '')
    .slice(0, 4);
  if (cleaned.length !== 4) {
    return ['G', 'A', 'T', 'C'];
  }
  const unique = new Set(cleaned.split(''));
  if (unique.size !== 4) {
    return ['G', 'A', 'T', 'C'];
  }
  return cleaned.split('');
}

function buildAb1TracePayload(buffer, directoryMap, sequenceLength, warnings) {
  const baseOrderEntry = getAbifEntryByPreference(directoryMap, 'FWO_1', 'FWO_2');
  const baseOrder = normalizeAb1BaseOrder(
    baseOrderEntry ? readAsciiString(getAbifEntryData(buffer, baseOrderEntry)) : ''
  );
  const canonicalBases = ['A', 'C', 'G', 'T'];
  const preferredTraceEntries = [9, 10, 11, 12].map((index) => directoryMap.get(`DATA${index}`) || null);
  const fallbackTraceEntries = [1, 2, 3, 4].map((index) => directoryMap.get(`DATA${index}`) || null);
  const selectedTraceEntries = preferredTraceEntries.every(Boolean)
    ? preferredTraceEntries
    : (fallbackTraceEntries.every(Boolean) ? fallbackTraceEntries : []);

  if (!selectedTraceEntries.length) {
    return null;
  }

  const rawChannelsByBase = new Map();
  selectedTraceEntries.forEach((entry, index) => {
    const base = baseOrder[index] || canonicalBases[index] || '';
    if (!base) {
      return;
    }
    const values = readNumericSeriesFromEntry(buffer, entry)
      .map((value) => Math.max(0, Math.round(Number(value) || 0)));
    rawChannelsByBase.set(base, values);
  });

  const positionsEntry = getAbifEntryByPreference(directoryMap, 'PLOC2', 'PLOC1');
  let positions = positionsEntry
    ? readNumericSeriesFromEntry(buffer, positionsEntry).map((value) => Math.max(0, Math.round(Number(value) || 0)))
    : [];

  if (positions.length && sequenceLength && positions.length > sequenceLength) {
    warnings.push('AB1 base-call positions were longer than the sequence and were truncated.');
    positions = positions.slice(0, sequenceLength);
  }

  const channels = canonicalBases
    .map((base) => ({
      base,
      values: rawChannelsByBase.get(base) || []
    }))
    .filter((channel) => channel.values.length > 0);

  if (!channels.length) {
    return null;
  }

  return {
    baseOrder,
    positions,
    channels
  };
}

function sanitizeAb1QualityBytes(bytes, sequenceLength, warnings) {
  const safeBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  if (!safeBytes.length || !sequenceLength) {
    return '';
  }

  if (safeBytes.length < sequenceLength) {
    warnings.push('AB1 quality values were shorter than the base-call sequence and were discarded.');
    return '';
  }
  if (safeBytes.length > sequenceLength) {
    warnings.push('AB1 quality values were longer than the base-call sequence and were truncated.');
  }

  return [...safeBytes.slice(0, sequenceLength)]
    .map((value) => {
      const phred = clamp(Math.round(Number(value) || 0), 0, 93);
      return String.fromCharCode(phred + 33);
    })
    .join('');
}

function coerceArrayBuffer(value) {
  if (!value) {
    return null;
  }
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

function parseAb1Record(rawInput, options = {}) {
  const warnings = [];
  const errors = [];

  try {
    const buffer = coerceArrayBuffer(rawInput);
    if (!buffer) {
      throw new Error('AB1 parsing requires an ArrayBuffer input.');
    }

    const directoryMap = buildAbifDirectoryMap(buffer);
    const baseEntry = getAbifEntryByPreference(directoryMap, 'PBAS2', 'PBAS1');
    if (!baseEntry) {
      throw new Error('AB1 file did not contain callable base tags (PBAS2/PBAS1).');
    }

    const qualityEntry = getAbifEntryByPreference(directoryMap, 'PCON2', 'PCON1');
    const baseBytes = getAbifEntryData(buffer, baseEntry);
    const sequence = normalizeSequenceText(readAsciiString(baseBytes));
    if (!sequence.length) {
      throw new Error('AB1 file did not contain any callable base sequence.');
    }

    let quality = '';
    if (qualityEntry) {
      const qualityBytes = getAbifEntryData(buffer, qualityEntry);
      quality = sanitizeAb1QualityBytes(qualityBytes, sequence.length, warnings);
    } else {
      warnings.push('AB1 quality values were not present (PCON2/PCON1 missing).');
    }
    const trace = buildAb1TracePayload(buffer, directoryMap, sequence.length, warnings);

    const fallbackName = String(options?.name || options?.fileName || 'sequencing_trace')
      .replace(/\.[^.]+$/u, '')
      .trim();

    let processedTrace = trace;
    if (trace && options?.postProcess !== false) {
      try {
        const processed = postProcessAb1Trace({ ...trace, sequence }, quality, options?.postProcessOptions || {});
        if (processed) {
          processedTrace = { ...trace, processed };
        }
      } catch (postProcessError) {
        warnings.push(`AB1 post-processing skipped: ${postProcessError?.message || 'unknown error'}.`);
      }
    }

    return {
      format: 'ab1',
      records: [{
        id: 'ab1_1',
        name: normalizeRecordName(fallbackName || 'sequencing_trace', 'sequencing_trace'),
        description: '',
        sourceFormat: 'ab1',
        topology: 'linear',
        sequence,
        quality,
        trace: processedTrace,
        features: []
      }],
      warnings,
      errors
    };
  } catch (error) {
    errors.push(error?.message || 'Failed to parse AB1 trace.');
    return {
      format: 'ab1',
      records: [],
      warnings,
      errors
    };
  }
}

export {
  parseAb1Record,
  buildAb1TracePayload,
  buildAbifDirectoryMap,
  coerceArrayBuffer,
  getAbifEntryByPreference,
  getAbifEntryData,
  readAsciiString,
  sanitizeAb1QualityBytes
};
