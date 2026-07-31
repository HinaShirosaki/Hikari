'use strict';

// Local genome library: lets the user point Hikari at reference genome FASTA files that already
// live on their disk, and lets any feature read regions out of them.
//
// Design notes:
// - Genome files are never copied or moved. Only a path plus an index is persisted, because a
//   reference assembly is far too large to duplicate into app storage.
// - The renderer never supplies a filesystem path. `addGenome` opens the native picker in the main
//   process, and every read is addressed by registered genome id. That keeps a compromised or buggy
//   renderer from turning this into an arbitrary-file-read bridge.
// - Adding a genome indexes it in one streaming pass so later region reads seek directly to the
//   bases they need instead of walking the file.

const crypto = require('node:crypto');

const FILE_VERSION = 1;
const MAX_GENOMES = 32;
const MAX_RECORDS_PER_GENOME = 50_000;
const MAX_REGION_BASES = 5_000_000;
const MAX_LABEL_LENGTH = 120;
const SUPPORTED_EXTENSIONS = Object.freeze(['.fa', '.fasta', '.fna', '.fas', '.ffn', '.seq']);
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const GREATER_THAN = 0x3e;

function fallbackCleanText(value, maxLength = 2000) {
  const text = String(value || '').trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Streaming FASTA indexer. Consumes chunks in order and records, per sequence, the byte offset of
// its first base plus its line geometry. When every line but the last is the same width, any base
// maps to a byte offset arithmetically, so a region read is one seek instead of a full scan.
function createFastaScanner() {
  const records = [];
  let current = null;
  let pending = Buffer.alloc(0);
  let pendingOffset = 0;
  let totalRead = 0;

  function closeCurrent() {
    if (current) {
      records.push({
        name: current.name,
        length: current.length,
        dataOffset: current.dataOffset,
        lineBases: current.lineBases,
        lineBytes: current.lineBytes,
        // A record with no bases can never be seeked into meaningfully.
        seekable: current.seekable && current.length > 0
      });
      current = null;
    }
  }

  function readHeaderName(content) {
    const text = content.subarray(1).toString('utf8').trim();
    const name = text.split(/\s+/)[0] || '';
    return name || `record-${records.length + 1}`;
  }

  function handleLine(line, lineOffset, totalBytes) {
    // Tolerate CRLF: the \r is part of the terminator, not of the sequence.
    const content = line.length && line[line.length - 1] === CARRIAGE_RETURN
      ? line.subarray(0, line.length - 1)
      : line;

    if (content.length && content[0] === GREATER_THAN) {
      closeCurrent();
      if (records.length >= MAX_RECORDS_PER_GENOME) {
        throw new Error(`This file has more than ${MAX_RECORDS_PER_GENOME.toLocaleString()} sequences, which is more than the genome library indexes.`);
      }
      current = {
        name: readHeaderName(content),
        length: 0,
        dataOffset: lineOffset + totalBytes,
        lineBases: 0,
        lineBytes: 0,
        seekable: true,
        shortLineSeen: false
      };
      return;
    }

    if (!current) {
      // Junk ahead of the first header; ignore it rather than failing the whole file.
      return;
    }

    if (!content.length) {
      // A blank line is only harmless after the final sequence line of a record.
      current.shortLineSeen = true;
      return;
    }

    const bases = content.length;
    if (current.lineBases === 0) {
      current.lineBases = bases;
      current.lineBytes = totalBytes;
    } else if (current.shortLineSeen) {
      // Something already ended the uniform run, so the offset arithmetic no longer holds.
      current.seekable = false;
    } else if (bases > current.lineBases) {
      current.seekable = false;
    } else if (bases < current.lineBases) {
      current.shortLineSeen = true;
    } else if (totalBytes < current.lineBytes) {
      // Same bases, fewer bytes: a missing terminator, valid only on the last line.
      current.shortLineSeen = true;
    } else if (totalBytes > current.lineBytes) {
      current.seekable = false;
    }
    current.length += bases;
  }

  return {
    push(chunk) {
      const buffer = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const bufferOffset = pending.length ? pendingOffset : totalRead;
      totalRead += chunk.length;

      let cursor = 0;
      for (;;) {
        const newlineAt = buffer.indexOf(NEWLINE, cursor);
        if (newlineAt === -1) {
          break;
        }
        handleLine(
          buffer.subarray(cursor, newlineAt),
          bufferOffset + cursor,
          (newlineAt - cursor) + 1
        );
        cursor = newlineAt + 1;
      }
      pending = buffer.subarray(cursor);
      pendingOffset = bufferOffset + cursor;
    },
    finish() {
      if (pending.length) {
        handleLine(pending, pendingOffset, pending.length);
        pending = Buffer.alloc(0);
      }
      closeCurrent();
      return records;
    }
  };
}

// Byte offset of a 0-based base index within a uniformly wrapped record.
function byteOffsetOfBase(record, baseIndex) {
  const fullLines = Math.floor(baseIndex / record.lineBases);
  return record.dataOffset + (fullLines * record.lineBytes) + (baseIndex % record.lineBases);
}

function createGenomeService({
  fs,
  path,
  cleanText = fallbackCleanText,
  getGenomeLibraryPath,
  pickGenomeFile = null,
  now = () => Date.now(),
  createId = () => crypto.randomUUID()
} = {}) {
  if (!fs || !path || typeof getGenomeLibraryPath !== 'function') {
    throw new Error('createGenomeService requires fs, path, and getGenomeLibraryPath.');
  }

  let cache = null;

  async function readLibrary() {
    if (cache) {
      return cache;
    }
    try {
      const raw = await fs.promises.readFile(getGenomeLibraryPath(), 'utf8');
      const parsed = JSON.parse(raw);
      cache = {
        version: FILE_VERSION,
        genomes: Array.isArray(parsed?.genomes) ? parsed.genomes : []
      };
    } catch {
      // A missing or unreadable library file just means nothing has been connected yet.
      cache = { version: FILE_VERSION, genomes: [] };
    }
    return cache;
  }

  async function writeLibrary(library) {
    cache = library;
    const target = getGenomeLibraryPath();
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, `${JSON.stringify(library, null, 2)}\n`, 'utf8');
  }

  // Metadata only. Sequence records stay out of the list payload because a scaffold-heavy
  // assembly has thousands of them and the caller almost never wants that up front.
  function summarize(genome, missing) {
    return {
      id: genome.id,
      label: genome.label,
      filePath: genome.filePath,
      byteSize: genome.byteSize,
      totalLength: genome.totalLength,
      recordCount: Array.isArray(genome.records) ? genome.records.length : 0,
      addedAt: genome.addedAt,
      missing: missing === true
    };
  }

  async function listGenomes() {
    const library = await readLibrary();
    return Promise.all(library.genomes.map(async (genome) => {
      // Report a vanished file instead of failing later: the user owns these paths and may
      // move or unmount them between sessions.
      let missing = false;
      try {
        const stats = await fs.promises.stat(genome.filePath);
        missing = !stats.isFile();
      } catch {
        missing = true;
      }
      return summarize(genome, missing);
    }));
  }

  async function findGenome(id) {
    const wanted = cleanText(id, 160);
    if (!wanted) {
      return null;
    }
    const library = await readLibrary();
    return library.genomes.find((genome) => genome.id === wanted) || null;
  }

  async function getGenome(payload = {}) {
    const genome = await findGenome(ensureObject(payload).id);
    if (!genome) {
      return null;
    }
    return {
      ...summarize(genome, false),
      sequences: (genome.records || []).map((record) => ({
        name: record.name,
        length: record.length
      }))
    };
  }

  async function indexGenomeFile(filePath) {
    const scanner = createFastaScanner();
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => {
        try {
          scanner.push(chunk);
        } catch (error) {
          stream.destroy();
          reject(error);
        }
      });
      stream.on('error', reject);
      stream.on('end', resolve);
    });
    return scanner.finish();
  }

  // Register a genome file that is already on disk. Not exposed over IPC on purpose — the
  // renderer must go through addGenome so the path always comes from a user-driven picker.
  async function registerGenomePath(payload = {}) {
    const input = ensureObject(payload);
    const filePath = cleanText(input.filePath, 4096);
    if (!filePath) {
      throw new Error('A genome file path is required.');
    }

    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.gz' || extension === '.zip' || extension === '.bgz') {
      throw new Error('Compressed genomes are not supported yet. Decompress the FASTA first so regions can be read without scanning the whole file.');
    }
    if (!SUPPORTED_EXTENSIONS.includes(extension)) {
      throw new Error(`Unsupported genome file type "${extension || 'none'}". Expected one of ${SUPPORTED_EXTENSIONS.join(', ')}.`);
    }

    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      throw new Error('The selected genome path is not a file.');
    }

    const library = await readLibrary();
    if (library.genomes.some((genome) => genome.filePath === filePath)) {
      throw new Error('That genome file is already connected.');
    }
    if (library.genomes.length >= MAX_GENOMES) {
      throw new Error(`The genome library holds at most ${MAX_GENOMES} genomes. Remove one first.`);
    }

    const records = await indexGenomeFile(filePath);
    if (!records.length) {
      throw new Error('No FASTA sequences were found in that file.');
    }

    const genome = {
      id: `genome-${createId()}`,
      label: cleanText(input.label, MAX_LABEL_LENGTH) || path.basename(filePath, extension),
      filePath,
      byteSize: stats.size,
      totalLength: records.reduce((sum, record) => sum + record.length, 0),
      addedAt: new Date(now()).toISOString(),
      records
    };
    await writeLibrary({
      version: FILE_VERSION,
      genomes: [...library.genomes, genome]
    });
    return getGenome({ id: genome.id });
  }

  async function addGenome(payload = {}) {
    if (typeof pickGenomeFile !== 'function') {
      throw new Error('Connecting a genome file is unavailable in this environment.');
    }
    const picked = await pickGenomeFile();
    if (!picked?.filePath) {
      return { canceled: true };
    }
    const genome = await registerGenomePath({
      filePath: picked.filePath,
      label: ensureObject(payload).label
    });
    return { canceled: false, genome };
  }

  async function removeGenome(payload = {}) {
    const id = cleanText(ensureObject(payload).id, 160);
    const library = await readLibrary();
    const remaining = library.genomes.filter((genome) => genome.id !== id);
    if (remaining.length === library.genomes.length) {
      return { removed: false };
    }
    // Only the registration is dropped. The user's genome file is theirs and is left alone.
    await writeLibrary({ version: FILE_VERSION, genomes: remaining });
    return { removed: true };
  }

  function readByteRange(filePath, start, end) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  // Read bases from a connected genome. 1-based inclusive coordinates, matching how genome
  // browsers and the rest of the app talk about positions.
  // ponytail: returns uppercase, so soft-mask (lowercase repeat) information is dropped. Return
  // the raw case here if repeat-aware filtering ever needs it.
  async function readRegion(payload = {}) {
    const input = ensureObject(payload);
    const genome = await findGenome(input.id);
    if (!genome) {
      throw new Error('That genome is not connected.');
    }

    const sequenceName = cleanText(input.sequenceName, 512);
    const record = (genome.records || []).find((entry) => entry.name === sequenceName);
    if (!record) {
      throw new Error(`Sequence "${sequenceName || ''}" is not in this genome.`);
    }

    const start = Math.min(Math.max(toPositiveInteger(input.start, 1), 1), record.length);
    const end = Math.min(Math.max(toPositiveInteger(input.end, record.length), start), record.length);
    const span = (end - start) + 1;
    if (span > MAX_REGION_BASES) {
      throw new Error(`Requested ${span.toLocaleString()} bases, but a single read is capped at ${MAX_REGION_BASES.toLocaleString()}.`);
    }

    let bases = '';
    if (record.seekable) {
      const buffer = await readByteRange(
        genome.filePath,
        byteOffsetOfBase(record, start - 1),
        byteOffsetOfBase(record, end - 1)
      );
      bases = buffer.toString('latin1').replace(/[\r\n]/g, '');
    } else {
      // Irregular line widths, so the offsets cannot be computed. Walk the record instead.
      const buffer = await readByteRange(genome.filePath, record.dataOffset, Number.MAX_SAFE_INTEGER);
      const text = buffer.toString('latin1');
      const headerAt = text.indexOf('>');
      const body = headerAt === -1 ? text : text.slice(0, headerAt);
      bases = body.replace(/[\r\n]/g, '').slice(start - 1, end);
    }

    return {
      id: genome.id,
      sequenceName: record.name,
      start,
      end,
      bases: bases.toUpperCase()
    };
  }

  return {
    listGenomes,
    getGenome,
    addGenome,
    registerGenomePath,
    removeGenome,
    readRegion
  };
}

module.exports = {
  createGenomeService,
  createFastaScanner,
  byteOffsetOfBase,
  MAX_REGION_BASES
};
