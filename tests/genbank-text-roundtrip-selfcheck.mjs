// The sequence library keeps every record as GenBank and re-reads it on open,
// so each save is a write-then-parse. A feature note or a description that the
// parser shortens is lost for good on the next save.
import assert from 'node:assert/strict';
import { parseGenBankRecords } from '../src/renderer/modules/sequence-viewer/parsing/genbank.js';
import { buildRecordGenbankText } from '../src/renderer/modules/sequence-viewer/storage.js';

const LONG_NOTE = `Codon-optimized for E. coli; ${'removed a BsaI site with silent T123C, verified by Sanger; '.repeat(4).trim()}`;
const QUOTED_NOTE = `He said ""fine"" and wrote "${'word '.repeat(12)}"done" """`;

const record = {
  name: 'pET28a-His6-SUMO-GFP_mutant_v3',
  description: 'Expression vector, verified clone #7',
  topology: 'circular',
  sequence: 'ATGC'.repeat(100),
  features: [
    { name: 'GFP', type: 'CDS', strand: 1, segments: [{ start: 0, end: 90 }], description: LONG_NOTE, qualifiers: { note: LONG_NOTE, gene: 'gfp' } },
    { name: 'quoted', type: 'misc_feature', strand: 1, segments: [{ start: 100, end: 120 }], description: QUOTED_NOTE, qualifiers: {} }
  ]
};

let saved = record;
for (let pass = 0; pass < 3; pass += 1) {
  saved = parseGenBankRecords(buildRecordGenbankText(saved)).records[0];
}
assert.equal(saved.features[0].description, LONG_NOTE);
assert.equal(saved.features[1].description, QUOTED_NOTE);
assert.equal(saved.description, record.description);

// With no description the writer puts the name in DEFINITION; that must not
// come back as a description.
const unnamed = parseGenBankRecords(buildRecordGenbankText({ ...record, description: '' })).records[0];
assert.equal(unnamed.description, '');

// A file from elsewhere keeps its wrapped DEFINITION.
const ncbi = parseGenBankRecords([
  'LOCUS       NM_007294               8 bp    mRNA    linear   PRI 01-JAN-2020',
  'DEFINITION  Homo sapiens BRCA1 DNA repair associated (BRCA1), transcript',
  '            variant 1, mRNA.',
  'ACCESSION   NM_007294',
  'FEATURES             Location/Qualifiers',
  'ORIGIN',
  '        1 atgcatgc',
  '//'
].join('\n')).records[0];
assert.equal(ncbi.description, 'Homo sapiens BRCA1 DNA repair associated (BRCA1), transcript variant 1, mRNA.');

console.log('genbank text round-trip self-check passed');
