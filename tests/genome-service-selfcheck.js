#!/usr/bin/env node
'use strict';

// Self-check for the local genome library service. The FASTA indexer and the byte-offset
// arithmetic are the parts that can silently return the wrong bases, so every case here reads a
// real temp file and compares against the sequence the test itself built.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createGenomeService,
  createFastaScanner
} = require('../src/main/core/services/create-genome-service.js');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-genome-'));
let libraryCounter = 0;

function makeService(overrides = {}) {
  libraryCounter += 1;
  const libraryPath = path.join(tempRoot, `library-${libraryCounter}.json`);
  return createGenomeService({
    fs,
    path,
    getGenomeLibraryPath: () => libraryPath,
    createId: () => `id-${libraryCounter}`,
    ...overrides
  });
}

function writeGenome(name, contents) {
  const filePath = path.join(tempRoot, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function wrap(sequence, width, terminator = '\n') {
  const lines = [];
  for (let i = 0; i < sequence.length; i += width) {
    lines.push(sequence.slice(i, i + width));
  }
  return lines.join(terminator);
}

function randomSequence(length, seed = 1) {
  const bases = 'ACGT';
  let value = seed;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    out += bases[value % 4];
  }
  return out;
}

async function main() {
  // --- scanner geometry ---
  {
    const scanner = createFastaScanner();
    scanner.push(Buffer.from('>chr1 test description\nACGTACGTAC\nACGTA\n>chr2\nTTTT\n'));
    const records = scanner.finish();
    assert.equal(records.length, 2, 'two records');
    assert.equal(records[0].name, 'chr1', 'header name stops at first whitespace');
    assert.equal(records[0].length, 15, 'bases summed across lines');
    assert.equal(records[0].seekable, true, 'uniform width then a short final line stays seekable');
    assert.equal(records[1].name, 'chr2');
    assert.equal(records[1].length, 4);
  }

  // A short line in the MIDDLE of a record breaks the offset arithmetic and must be detected.
  {
    const scanner = createFastaScanner();
    scanner.push(Buffer.from('>c\nACGTACGTAC\nACG\nACGTACGTAC\n'));
    const [record] = scanner.finish();
    assert.equal(record.length, 23);
    assert.equal(record.seekable, false, 'interior short line must disable seeking');
  }

  // Chunk boundaries must not change the result: the scanner carries partial lines across pushes.
  {
    const text = '>chr1\nACGTACGTAC\nACGTACGTAC\nACGT\n>chr2\nGGGGCCCC\n';
    const whole = createFastaScanner();
    whole.push(Buffer.from(text));
    const expected = whole.finish();

    for (const size of [1, 3, 7, 11]) {
      const scanner = createFastaScanner();
      const buffer = Buffer.from(text);
      for (let i = 0; i < buffer.length; i += size) {
        scanner.push(buffer.subarray(i, Math.min(i + size, buffer.length)));
      }
      assert.deepEqual(scanner.finish(), expected, `chunk size ${size} matches a single push`);
    }
  }

  // --- region reads against a known sequence ---
  {
    const sequence = randomSequence(2500, 7);
    const service = makeService();
    const filePath = writeGenome('uniform.fa', `>chr1 uniform\n${wrap(sequence, 60)}\n`);
    const genome = await service.registerGenomePath({ filePath, label: 'Uniform' });
    assert.equal(genome.label, 'Uniform');
    assert.equal(genome.sequences[0].length, 2500, 'indexed length matches');

    const cases = [
      [1, 1], [1, 60], [1, 61], [60, 61], [59, 62],
      [61, 120], [121, 180], [2490, 2500], [2500, 2500], [1, 2500], [777, 1333]
    ];
    for (const [start, end] of cases) {
      const region = await service.readRegion({ id: genome.id, sequenceName: 'chr1', start, end });
      assert.equal(
        region.bases,
        sequence.slice(start - 1, end),
        `bases for ${start}-${end} must match the source sequence`
      );
    }
  }

  // CRLF line endings must not leak \r into the bases or shift the offsets.
  {
    const sequence = randomSequence(500, 11);
    const service = makeService();
    const filePath = writeGenome('crlf.fa', `>chr1\r\n${wrap(sequence, 70, '\r\n')}\r\n`);
    const genome = await service.registerGenomePath({ filePath });
    assert.equal(genome.sequences[0].length, 500, 'CRLF must not count toward length');
    for (const [start, end] of [[1, 70], [70, 71], [200, 400], [1, 500]]) {
      const region = await service.readRegion({ id: genome.id, sequenceName: 'chr1', start, end });
      assert.equal(region.bases, sequence.slice(start - 1, end), `CRLF bases ${start}-${end}`);
    }
  }

  // A full-width final line with no trailing newline is common and must stay seekable.
  {
    const sequence = randomSequence(120, 13);
    const service = makeService();
    const filePath = writeGenome('no-trailing-newline.fa', `>chr1\n${wrap(sequence, 60)}`);
    const genome = await service.registerGenomePath({ filePath });
    assert.equal(genome.sequences[0].length, 120);
    const region = await service.readRegion({ id: genome.id, sequenceName: 'chr1', start: 61, end: 120 });
    assert.equal(region.bases, sequence.slice(60, 120), 'last full line without newline reads correctly');
  }

  // Irregular widths must still return correct bases via the sequential fallback.
  {
    const service = makeService();
    const parts = ['ACGTACGTAC', 'GG', 'TTTTTTTTTTTT', 'ACG'];
    const sequence = parts.join('');
    const filePath = writeGenome('ragged.fa', `>chr1\n${parts.join('\n')}\n>chr2\nAAAA\n`);
    const genome = await service.registerGenomePath({ filePath });
    for (const [start, end] of [[1, 5], [10, 14], [1, sequence.length], [12, 25]]) {
      const region = await service.readRegion({ id: genome.id, sequenceName: 'chr1', start, end });
      assert.equal(region.bases, sequence.slice(start - 1, end), `ragged bases ${start}-${end}`);
    }
    // The fallback must stop at the next header rather than bleeding into chr2.
    const tail = await service.readRegion({ id: genome.id, sequenceName: 'chr1', start: sequence.length, end: sequence.length });
    assert.equal(tail.bases, 'G', 'fallback must not read past the record');
  }

  // Soft-masked (lowercase) genomes come back uppercase.
  {
    const service = makeService();
    const filePath = writeGenome('masked.fa', '>chr1\nacgtACGTacgt\n');
    const genome = await service.registerGenomePath({ filePath });
    const region = await service.readRegion({ id: genome.id, sequenceName: 'chr1', start: 1, end: 12 });
    assert.equal(region.bases, 'ACGTACGTACGT', 'soft-masked bases are uppercased');
  }

  // --- coordinate clamping and validation ---
  {
    const service = makeService();
    const filePath = writeGenome('clamp.fa', '>chr1\nACGTACGTAC\n');
    const genome = await service.registerGenomePath({ filePath });

    const past = await service.readRegion({ id: genome.id, sequenceName: 'chr1', start: 5, end: 9999 });
    assert.equal(past.bases, 'ACGTAC', 'end clamps to the sequence length');
    assert.equal(past.end, 10);

    const before = await service.readRegion({ id: genome.id, sequenceName: 'chr1', start: -5, end: 4 });
    assert.equal(before.bases, 'ACGT', 'start clamps to 1');

    const whole = await service.readRegion({ id: genome.id, sequenceName: 'chr1' });
    assert.equal(whole.bases, 'ACGTACGTAC', 'omitted coordinates read the whole record');

    await assert.rejects(
      () => service.readRegion({ id: genome.id, sequenceName: 'nope', start: 1, end: 2 }),
      /is not in this genome/,
      'unknown sequence name is rejected'
    );
    await assert.rejects(
      () => service.readRegion({ id: 'genome-missing', sequenceName: 'chr1', start: 1, end: 2 }),
      /not connected/,
      'unknown genome id is rejected'
    );
  }

  // --- registry behaviour ---
  {
    const service = makeService();
    const filePath = writeGenome('registry.fa', '>chr1\nACGTACGTAC\n');
    const added = await service.registerGenomePath({ filePath });

    const listed = await service.listGenomes();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].missing, false);
    assert.equal(listed[0].totalLength, 10);
    assert.equal(listed[0].label, 'registry', 'label defaults to the file basename');

    await assert.rejects(
      () => service.registerGenomePath({ filePath }),
      /already connected/,
      'the same file cannot be connected twice'
    );

    // A file that disappears is reported, not thrown from list.
    fs.rmSync(filePath);
    const afterDelete = await service.listGenomes();
    assert.equal(afterDelete[0].missing, true, 'a vanished genome file is flagged');

    const removed = await service.removeGenome({ id: added.id });
    assert.equal(removed.removed, true);
    assert.equal((await service.listGenomes()).length, 0, 'disconnect drops the registration');
    assert.equal((await service.removeGenome({ id: added.id })).removed, false, 'removing twice is a no-op');
  }

  // Rejected inputs.
  {
    const service = makeService();
    await assert.rejects(
      () => service.registerGenomePath({ filePath: writeGenome('bad.gz', 'x') }),
      /Compressed genomes are not supported/,
      'gzip is rejected with an actionable message'
    );
    await assert.rejects(
      () => service.registerGenomePath({ filePath: writeGenome('bad.docx', 'x') }),
      /Unsupported genome file type/,
      'unrelated extensions are rejected'
    );
    await assert.rejects(
      () => service.registerGenomePath({ filePath: writeGenome('empty.fa', 'no header here\n') }),
      /No FASTA sequences/,
      'a file with no records is rejected'
    );
    await assert.rejects(
      () => service.registerGenomePath({ filePath: '' }),
      /required/,
      'an empty path is rejected'
    );
  }

  // The picker is the only way a path reaches the library from outside.
  {
    const chosen = writeGenome('picked.fa', '>chr1\nACGT\n');
    const service = makeService({ pickGenomeFile: async () => ({ filePath: chosen }) });
    const result = await service.addGenome({ label: 'Picked' });
    assert.equal(result.canceled, false);
    assert.equal(result.genome.label, 'Picked');

    const canceling = makeService({ pickGenomeFile: async () => ({ filePath: '' }) });
    assert.equal((await canceling.addGenome({})).canceled, true, 'a canceled picker adds nothing');

    const unavailable = makeService({ pickGenomeFile: null });
    await assert.rejects(() => unavailable.addGenome({}), /unavailable/, 'no picker means no add');
  }

  // Persistence survives a fresh service over the same library file.
  {
    libraryCounter += 1;
    const libraryPath = path.join(tempRoot, `shared-${libraryCounter}.json`);
    const deps = { fs, path, getGenomeLibraryPath: () => libraryPath };
    const filePath = writeGenome('persist.fa', '>chrA\nACGTACGTAC\nACGTA\n');
    await createGenomeService(deps).registerGenomePath({ filePath, label: 'Persisted' });

    const reopened = createGenomeService(deps);
    const listed = await reopened.listGenomes();
    assert.equal(listed.length, 1, 'library reloads from disk');
    assert.equal(listed[0].label, 'Persisted');
    const region = await reopened.readRegion({ id: listed[0].id, sequenceName: 'chrA', start: 9, end: 12 });
    assert.equal(region.bases, 'ACAC', 'reads work against a reloaded index');
  }

  // An oversized read is refused rather than buffering unbounded memory into the main process.
  {
    const service = makeService();
    const sequence = 'ACGT'.repeat(1_300_000); // 5.2 Mb, just past the 5 Mb cap
    const filePath = writeGenome('cap.fa', `>chr1\n${wrap(sequence, 60)}\n`);
    const genome = await service.registerGenomePath({ filePath });
    assert.equal(genome.sequences[0].length, sequence.length);

    await assert.rejects(
      () => service.readRegion({ id: genome.id, sequenceName: 'chr1', start: 1, end: sequence.length }),
      /capped at/,
      'a read past the cap is refused'
    );

    // Just under the cap still works, and still returns the right bases from deep in the file.
    const region = await service.readRegion({ id: genome.id, sequenceName: 'chr1', start: 5_000_000, end: 5_000_020 });
    assert.equal(region.bases, sequence.slice(4_999_999, 5_000_020), 'deep offsets stay correct');
  }

  console.log('genome-service-selfcheck: all assertions passed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
