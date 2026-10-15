'use strict';

const fs = require('fs/promises');
const path = require('path');
const { writeFileAtomic } = require('../lib/shared-json-file');
const { normalizePrimerLibrary } = require('../../shared/primer-library.mjs');

function primerLibraryPath(storageRoot) {
  return storageRoot ? path.join(storageRoot, 'DNA', 'primer-library.json') : '';
}

async function writePrimerLibrary(storageRoot, snapshot, updatedAt) {
  if (!Array.isArray(snapshot?.primerLibrary)) return '';
  const target = primerLibraryPath(storageRoot);
  if (!target) return '';
  await fs.mkdir(path.dirname(target), { recursive: true });
  await writeFileAtomic(fs, target, JSON.stringify({
    schema_name: 'hikari_primer_library', schema_version: '1.0.0',
    updated_at: updatedAt, primers: normalizePrimerLibrary(snapshot?.primerLibrary)
  }, null, 2));
  return target;
}

async function readPrimerLibrary(storageRoot) {
  const target = primerLibraryPath(storageRoot);
  if (!target) return { ok: false, exists: false };
  try {
    const payload = JSON.parse(await fs.readFile(target, 'utf8'));
    if (payload?.schema_name !== 'hikari_primer_library' || !Array.isArray(payload.primers)) {
      throw new Error('Unrecognized primer library format.');
    }
    return { ok: true, exists: true, primers: normalizePrimerLibrary(payload.primers) };
  } catch (error) {
    return error?.code === 'ENOENT' ? { ok: false, exists: false }
      : { ok: false, exists: true, error: `Failed to read primer library: ${error.message}` };
  }
}

module.exports = { primerLibraryPath, readPrimerLibrary, writePrimerLibrary };
