import { DEFAULT_MAX_RECORDS } from './constants.js';
import { parseAb1Record, parseInputRecords } from './parsing.js';
import { buildSequenceSignature } from './shared.js';
import { cloneJson } from '../../lib/normalize.js';

function getFileExtension(name) {
  const text = String(name || '').trim().toLowerCase();
  const match = text.match(/\.([a-z0-9]+)$/u);
  return match?.[1] || '';
}

function stripExtension(name, fallback = 'record') {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/\.[^.]+$/u, '') || fallback;
}

export function clampIndex(value, length) {
  const safeLength = Math.max(0, Number(length) || 0);
  if (!safeLength) {
    return 0;
  }
  const numeric = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(safeLength - 1, numeric));
}

export function createEmptySourceState(role) {
  return {
    role,
    fileName: '',
    format: '',
    records: [],
    warnings: [],
    errors: [],
    selectedRecordIndex: 0,
    rawText: '',
    rawBinary: null,
    sourceKind: '',
    originalFileName: '',
    sourceSessionId: ''
  };
}

function isRecordObject(value) {
  return Boolean(value && typeof value === 'object' && typeof value.sequence === 'string');
}

export function coerceArrayBuffer(value) {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return null;
}

async function readTextInput(input, readFileAsText) {
  if (typeof input === 'string') {
    return input;
  }

  const source = input?.file || input;
  if (typeof source?.text === 'function') {
    return await source.text();
  }
  if (typeof input?.text === 'string') {
    return input.text;
  }
  if (typeof input?.content === 'string') {
    return input.content;
  }
  if (source && typeof readFileAsText === 'function') {
    return await readFileAsText(source);
  }
  throw new Error('Unable to read the selected text input.');
}

async function readArrayBufferInput(input, readFileAsArrayBuffer) {
  const direct = coerceArrayBuffer(input?.arrayBuffer ?? input?.buffer ?? input);
  if (direct) {
    return direct;
  }

  const source = input?.file || input;
  if (typeof source?.arrayBuffer === 'function') {
    return await source.arrayBuffer();
  }
  if (source && typeof readFileAsArrayBuffer === 'function') {
    return await readFileAsArrayBuffer(source);
  }
  throw new Error('Unable to read the selected binary input.');
}

function normalizeParsedBundle(parsed, fallbackName) {
  const safeParsed = parsed && typeof parsed === 'object' ? parsed : {};
  const records = Array.isArray(safeParsed.records) ? safeParsed.records : [];
  const warnings = Array.isArray(safeParsed.warnings) ? safeParsed.warnings : [];
  const errors = Array.isArray(safeParsed.errors) ? safeParsed.errors : [];

  return {
    format: String(safeParsed.format || '').trim() || 'unknown',
    records: records.map((record, index) => ({
      ...record,
      name: String(record?.name || '').trim() || `${fallbackName || 'record'}_${index + 1}`
    })),
    warnings,
    errors,
    rawText: typeof safeParsed.rawText === 'string' ? safeParsed.rawText : '',
    rawBinary: coerceArrayBuffer(safeParsed.rawBinary)
  };
}

export const parseAlignmentInput = async (role, input, helpers = {}) => {
  if (Array.isArray(input?.records)) {
    return normalizeParsedBundle({
      ...input,
      rawText: typeof input?.rawText === 'string' ? input.rawText : '',
      rawBinary: coerceArrayBuffer(input?.rawBinary)
    }, role);
  }

  if (isRecordObject(input?.record)) {
    return normalizeParsedBundle({
      format: String(input?.record?.sourceFormat || 'external'),
      records: [input.record],
      warnings: [],
      errors: [],
      rawText: typeof input?.rawText === 'string' ? input.rawText : '',
      rawBinary: coerceArrayBuffer(input?.rawBinary)
    }, role);
  }

  if (isRecordObject(input)) {
    return normalizeParsedBundle({
      format: String(input?.sourceFormat || 'external'),
      records: [input],
      warnings: [],
      errors: [],
      rawText: typeof input?.rawText === 'string' ? input.rawText : '',
      rawBinary: coerceArrayBuffer(input?.rawBinary)
    }, role);
  }

  if (typeof input?.sequence === 'string') {
    return normalizeParsedBundle({
      format: String(input?.sourceFormat || 'raw'),
      records: [input],
      warnings: [],
      errors: [],
      rawText: typeof input?.rawText === 'string' ? input.rawText : '',
      rawBinary: coerceArrayBuffer(input?.rawBinary)
    }, role);
  }

  const name = String(input?.name || input?.fileName || input?.file?.name || input?.label || '').trim();
  const extension = getFileExtension(name);
  const isAb1 = extension === 'ab1'
    || extension === 'abi'
    || String(input?.format || input?.sourceFormat || '').toLowerCase() === 'ab1';
  if (isAb1) {
    if (role === 'reference') {
      throw new Error('AB1 traces are only supported for the query input.');
    }
    const buffer = await readArrayBufferInput(input, helpers.readFileAsArrayBuffer);
    return normalizeParsedBundle({
      ...parseAb1Record(buffer, { name: stripExtension(name, 'sequencing_trace') }),
      rawBinary: buffer
    }, role);
  }

  const text = await readTextInput(input, helpers.readFileAsText);
  const parsed = normalizeParsedBundle({
    ...parseInputRecords(text, { maxRecords: DEFAULT_MAX_RECORDS }),
    rawText: text
  }, stripExtension(name, role));
  if (parsed.format === 'fastq') {
    throw new Error('Sequencing alignment accepts AB1, FASTA, GenBank, or plain sequence text inputs, not FASTQ.');
  }
  return parsed;
};

export function describeSelectedRecord(record) {
  if (!record?.sequence?.length) {
    return 'No record selected.';
  }
  const topology = String(record.topology || 'linear');
  const format = String(record.sourceFormat || 'unknown').toUpperCase();
  return `${record.name} | ${record.sequence.length.toLocaleString()} bp | ${topology} | ${format}`;
}

export function buildSessionName(queryRecord, source) {
  const queryName = String(queryRecord?.name || '').trim();
  if (queryName) {
    return queryName;
  }
  const originalFileName = String(source?.originalFileName || '').trim();
  if (originalFileName) {
    return stripExtension(originalFileName, 'alignment_query');
  }
  return 'alignment_query';
}

export function buildReferenceRecordKey(record) {
  return buildSequenceSignature(record?.sequence || '', 'ref');
}

export function upsertAlignmentSessionInList(sessions, session) {
  const next = Array.isArray(sessions) ? [...sessions] : [];
  const safeSession = session && typeof session === 'object' ? session : null;
  if (!safeSession?.id) {
    return next;
  }

  const existingIndex = next.findIndex((item) => String(item?.id || '') === String(safeSession.id));
  if (existingIndex >= 0) {
    next.splice(existingIndex, 1, safeSession);
  } else {
    next.unshift(safeSession);
  }

  return next.sort((left, right) => String(right?.updatedAt || '').localeCompare(String(left?.updatedAt || '')));
}

export { cloneJson };
