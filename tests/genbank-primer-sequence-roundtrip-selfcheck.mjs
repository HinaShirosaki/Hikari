// A primer_bind is the one feature whose sequence is not simply "what the
// template says here": a mutagenic primer deliberately differs from the plasmid
// it was designed against. If the oligo does not survive the trip to disk, the
// reopened file rebuilds it from the template and silently hands back the
// wild-type bases instead of the primer that was ordered.
import assert from 'node:assert/strict';
import { parseInputRecords } from '../src/renderer/modules/sequence-viewer/parsing.js';
import { primerFeatureSequence } from '../src/renderer/modules/sequence-viewer/primer-hover.js';
import { buildRecordGenbankText } from '../src/renderer/modules/sequence-viewer/storage.js';

//                     codon 35 is CAG on the plasmid; the primer orders GCG.
const TEMPLATE = 'TTGACCGTATGCAGTTCCAGACCCCGTGCAGCTGCGTCACGGTTCCATGACCTGAAGTCC';
const ORDERED_FORWARD = 'ACCCCGTGGCGCTGCGTC';
const ORDERED_REVERSE = 'GACGCAGCGCCACGGGGT';
const SITE_START = TEMPLATE.indexOf('ACCCCGTGCAGCTGCGTC');
const SITE_END = SITE_START + ORDERED_FORWARD.length;
// Long enough that the qualifier wraps across GenBank lines.
const LONG_PRIMER = `${ORDERED_FORWARD}${'ACGTACGTAC'.repeat(6)}`;

const record = {
  name: 'pYDL',
  sequence: TEMPLATE,
  topology: 'circular',
  features: [
    {
      id: 'p1',
      name: 'Q35A F',
      type: 'primer_bind',
      strand: 1,
      description: 'Designed mutagenesis-forward',
      primerSequence: ORDERED_FORWARD,
      segments: [{ start: SITE_START, end: SITE_END }]
    },
    {
      id: 'p2',
      name: 'Q35A R',
      type: 'primer_bind',
      strand: -1,
      primerSequence: ORDERED_REVERSE,
      segments: [{ start: SITE_START, end: SITE_END }]
    },
    {
      id: 'p3',
      name: 'Q35A long F',
      type: 'primer_bind',
      strand: 1,
      primerSequence: LONG_PRIMER,
      segments: [{ start: SITE_START, end: SITE_END }]
    },
    // An imported primer site carries no oligo, and must stay that way.
    { id: 'p4', name: 'imported', type: 'primer_bind', strand: 1, segments: [{ start: 0, end: 20 }] },
    { id: 'f1', name: 'CDS', type: 'CDS', strand: 1, segments: [{ start: 0, end: 30 }] }
  ]
};

const gbkText = buildRecordGenbankText(record);
assert.equal(gbkText.includes(`/primer_sequence="${ORDERED_FORWARD}"`), true);
// Only primer sites get the qualifier; nothing else grows one.
assert.equal(gbkText.split('\n').filter((line) => line.includes('/primer_sequence')).length, 3);

const reopened = parseInputRecords(gbkText).records[0];
const byName = (name) => reopened.features.find((feature) => feature.name === name);

// The ordered oligo comes back verbatim, not the template's wild-type bases.
assert.equal(byName('Q35A F').primerSequence, ORDERED_FORWARD);
assert.equal(primerFeatureSequence(byName('Q35A F'), reopened.sequence), ORDERED_FORWARD);
assert.notEqual(ORDERED_FORWARD, TEMPLATE.slice(SITE_START, SITE_END));

// A reverse primer is stored 5'->3' and is not re-derived from the minus strand.
assert.equal(byName('Q35A R').primerSequence, ORDERED_REVERSE);
assert.equal(primerFeatureSequence(byName('Q35A R'), reopened.sequence), ORDERED_REVERSE);

// A qualifier long enough to wrap rejoins without the line-break whitespace.
assert.equal(byName('Q35A long F').primerSequence, LONG_PRIMER);

// A site with no oligo still has none, so the footprint fallback stays in charge.
assert.equal('primerSequence' in byName('imported'), false);
assert.equal(primerFeatureSequence(byName('imported'), reopened.sequence), TEMPLATE.slice(0, 20));
assert.equal('primerSequence' in byName('CDS'), false);

console.log('genbank-primer-sequence-roundtrip-selfcheck: ok');
