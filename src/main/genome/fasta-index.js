'use strict';

const MAX_RECORDS_PER_GENOME = 50_000;
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const GREATER_THAN = 0x3e;

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

module.exports = { byteOffsetOfBase, createFastaScanner };
