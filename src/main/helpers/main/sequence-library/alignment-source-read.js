'use strict';

const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { ALIGNMENTS_MANIFEST_FILE_NAME } = require('./constants');
const { ensurePathWithinRoot, toPosixRelative } = require('./paths');
const {
  normalizeName,
  normalizeSequenceText,
  sanitizeFileName,
  stripExtension
} = require('./utils');
const { normalizeAlignmentQueryRecord } = require('./alignment-normalize');

const SOURCE_FILE_EXTENSIONS = Object.freeze(new Set([
  '.ab1',
  '.abi',
  '.fa',
  '.fas',
  '.fasta',
  '.gb',
  '.gbk',
  '.genbank',
  '.seq',
  '.txt'
]));

const SOURCE_FILE_PRIORITY = Object.freeze([
  '.ab1',
  '.abi',
  '.fasta',
  '.fa',
  '.fas',
  '.gbk',
  '.gb',
  '.genbank',
  '.seq',
  '.txt'
]);

let sequenceViewerParserPromise = null;

function getExtension(fileName = '') {
  return path.extname(String(fileName || '').trim()).toLowerCase();
}

function getSourceFilePriority(fileName = '') {
  const extension = getExtension(fileName);
  const index = SOURCE_FILE_PRIORITY.indexOf(extension);
  return index >= 0 ? index : SOURCE_FILE_PRIORITY.length;
}

function isSupportedSourceFile(fileName = '') {
  const name = String(fileName || '').trim();
  return name && name !== ALIGNMENTS_MANIFEST_FILE_NAME && SOURCE_FILE_EXTENSIONS.has(getExtension(name));
}

function inferSourceFormat(fileName = '', fallback = '') {
  const normalizedFallback = String(fallback || '').trim().toLowerCase();
  if (normalizedFallback && normalizedFallback !== 'unknown') {
    return normalizedFallback;
  }
  const extension = getExtension(fileName);
  if (extension === '.ab1' || extension === '.abi') {
    return 'ab1';
  }
  if (extension === '.gb' || extension === '.gbk' || extension === '.genbank') {
    return 'genbank';
  }
  if (extension === '.fa' || extension === '.fas' || extension === '.fasta') {
    return 'fasta';
  }
  return 'raw';
}

function toArrayBuffer(buffer) {
  if (buffer instanceof ArrayBuffer) {
    return buffer;
  }
  if (ArrayBuffer.isView(buffer)) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  return null;
}

async function loadSequenceViewerParser() {
  if (!sequenceViewerParserPromise) {
    const parserPath = path.resolve(__dirname, '../../../../renderer/modules/sequence-viewer/parsing.js');
    sequenceViewerParserPromise = import(pathToFileURL(parserPath).href);
  }
  return sequenceViewerParserPromise;
}

function detectTextSequenceFormat(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) {
    return 'empty';
  }
  if (/^\s*LOCUS\b/im.test(text) && /^\s*ORIGIN\b/im.test(text)) {
    return 'genbank';
  }
  if (/^\s*>/m.test(text)) {
    return 'fasta';
  }
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 4 && lines[0].startsWith('@') && lines.findIndex((line, index) => index > 0 && line.startsWith('+')) >= 2) {
    return 'fastq';
  }
  return 'raw';
}

function parseFastaSource(text = '', fileName = '') {
  const lines = String(text || '').replace(/\r\n?/gu, '\n').split('\n');
  let header = '';
  const body = [];
  for (const line of lines) {
    if (line.startsWith('>')) {
      if (header || body.length) {
        break;
      }
      header = line.slice(1).trim();
      continue;
    }
    if (header || line.trim()) {
      body.push(line.trim());
    }
  }
  const [nameToken = ''] = header.split(/\s+/u);
  return {
    name: normalizeName(nameToken || stripExtension(fileName) || 'alignment_query', 'alignment_query'),
    sourceFormat: 'fasta',
    topology: 'linear',
    sequence: normalizeSequenceText(body.join('')),
    quality: ''
  };
}

function parseGenBankSource(text = '', fileName = '') {
  const block = String(text || '').split(/^\s*\/\/\s*$/m)[0] || '';
  const locusMatch = block.match(/^\s*LOCUS\s+(\S+)(.*)$/im);
  const locusTail = String(locusMatch?.[2] || '');
  const originMatch = block.match(/^\s*ORIGIN\b([\s\S]*)$/im);
  return {
    name: normalizeName(locusMatch?.[1] || stripExtension(fileName) || 'alignment_query', 'alignment_query'),
    sourceFormat: 'genbank',
    topology: /\bcircular\b/i.test(locusTail) ? 'circular' : 'linear',
    sequence: normalizeSequenceText(originMatch?.[1] || ''),
    quality: ''
  };
}

function parseRawSource(text = '', fileName = '') {
  return {
    name: normalizeName(stripExtension(fileName) || 'alignment_query', 'alignment_query'),
    sourceFormat: 'raw',
    topology: 'linear',
    sequence: normalizeSequenceText(text),
    quality: ''
  };
}

async function parseSourceRecord(sourcePath, sourceFormat = '') {
  const fileName = path.basename(sourcePath);
  const inferredFormat = inferSourceFormat(fileName, sourceFormat);
  if (inferredFormat === 'ab1') {
    const parser = await loadSequenceViewerParser();
    const bytes = await fs.readFile(sourcePath);
    const parsed = parser.parseAb1Record(toArrayBuffer(bytes), {
      name: stripExtension(fileName) || 'sequencing_trace',
      postProcess: false
    });
    return normalizeAlignmentQueryRecord(parsed?.records?.[0], 0);
  }

  const text = await fs.readFile(sourcePath, 'utf8');
  const textFormat = detectTextSequenceFormat(text);
  if (textFormat === 'fastq' || textFormat === 'empty') {
    return null;
  }
  const record = textFormat === 'genbank'
    ? parseGenBankSource(text, fileName)
    : (textFormat === 'fasta' ? parseFastaSource(text, fileName) : parseRawSource(text, fileName));
  return normalizeAlignmentQueryRecord(record, 0);
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function directoryExists(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function findFirstSourceFile(dirPath) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && isSupportedSourceFile(entry.name))
    .map((entry) => path.join(dirPath, entry.name))
    .sort((left, right) => {
      const priority = getSourceFilePriority(path.basename(left)) - getSourceFilePriority(path.basename(right));
      return priority || path.basename(left).localeCompare(path.basename(right));
    })[0] || '';
}

async function resolveStoredSourcePath(libraryRoot, storedSourceRelPath = '') {
  const relPath = String(storedSourceRelPath || '').trim();
  if (!libraryRoot || !relPath) {
    return '';
  }
  const sourcePath = ensurePathWithinRoot(libraryRoot, relPath);
  return await fileExists(sourcePath) ? sourcePath : '';
}

async function resolveSessionSourcePath({ alignmentsDir, libraryRoot, session }) {
  const storedSourcePath = await resolveStoredSourcePath(libraryRoot, session?.storedSourceRelPath);
  if (storedSourcePath) {
    return storedSourcePath;
  }

  const sessionId = String(session?.id || '').trim();
  if (!sessionId) {
    return '';
  }
  const candidateDirs = [
    path.join(alignmentsDir, sessionId),
    path.join(alignmentsDir, sanitizeFileName(sessionId, sessionId))
  ];
  const originalFileName = String(session?.originalFileName || '').trim();
  for (const candidateDir of [...new Set(candidateDirs)]) {
    if (!(await directoryExists(candidateDir))) {
      continue;
    }
    if (originalFileName) {
      const originalPath = path.join(candidateDir, originalFileName);
      if (await fileExists(originalPath)) {
        return originalPath;
      }
    }
    const discoveredPath = await findFirstSourceFile(candidateDir);
    if (discoveredPath) {
      return discoveredPath;
    }
  }
  return '';
}

async function hydrateAlignmentSessionFromSource({ alignmentsDir, libraryRoot, session, index = 0 }) {
  const safeSession = session && typeof session === 'object' ? session : {};
  const sourcePath = await resolveSessionSourcePath({ alignmentsDir, libraryRoot, session: safeSession });
  if (!sourcePath) {
    return null;
  }

  const sourceFileName = path.basename(sourcePath);
  const queryRecord = await parseSourceRecord(sourcePath, safeSession.sourceFormat);
  if (!queryRecord) {
    return null;
  }

  const id = String(safeSession.id || '').trim()
    || sanitizeFileName(stripExtension(sourceFileName), `alignment_${index + 1}`);
  return {
    ...safeSession,
    id,
    name: normalizeName(safeSession.name || queryRecord.name || stripExtension(sourceFileName), `alignment_${index + 1}`),
    sourceKind: safeSession.sourceKind || 'file',
    sourceFormat: inferSourceFormat(sourceFileName, safeSession.sourceFormat || queryRecord.sourceFormat),
    originalFileName: safeSession.originalFileName || sourceFileName,
    storedSourceRelPath: safeSession.storedSourceRelPath || (libraryRoot ? toPosixRelative(libraryRoot, sourcePath) : ''),
    queryRecord
  };
}

async function discoverAlignmentSourceSessions({ alignmentsDir, libraryRoot, existingSessionIds = [] }) {
  const existingIds = new Set(
    (Array.isArray(existingSessionIds) ? existingSessionIds : [])
      .map((id) => String(id || '').trim().toLowerCase())
      .filter(Boolean)
  );
  let entries;
  try {
    entries = await fs.readdir(alignmentsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const sessions = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (existingIds.has(entry.name.toLowerCase())) {
        continue;
      }
      const hydrated = await hydrateAlignmentSessionFromSource({
        alignmentsDir,
        libraryRoot,
        session: { id: entry.name },
        index: sessions.length
      });
      if (hydrated) {
        existingIds.add(String(hydrated.id || '').trim().toLowerCase());
        sessions.push(hydrated);
      }
      continue;
    }

    if (!entry.isFile() || !isSupportedSourceFile(entry.name)) {
      continue;
    }
    const id = sanitizeFileName(stripExtension(entry.name), `alignment_${sessions.length + 1}`);
    if (existingIds.has(id.toLowerCase())) {
      continue;
    }
    const hydrated = await hydrateAlignmentSessionFromSource({
      alignmentsDir,
      libraryRoot,
      session: {
        id,
        originalFileName: entry.name,
        storedSourceRelPath: libraryRoot ? toPosixRelative(libraryRoot, path.join(alignmentsDir, entry.name)) : ''
      },
      index: sessions.length
    });
    if (hydrated) {
      existingIds.add(String(hydrated.id || '').trim().toLowerCase());
      sessions.push(hydrated);
    }
  }
  return sessions;
}

module.exports = {
  discoverAlignmentSourceSessions,
  hydrateAlignmentSessionFromSource
};
