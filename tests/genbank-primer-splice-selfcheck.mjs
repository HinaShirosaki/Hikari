// Annotating a plasmid the user already has must leave its file alone apart
// from the primer sites. Re-serialising a parsed record silently drops every
// qualifier and header field the viewer does not model, so this pins the splice.
import assert from 'node:assert/strict';
import { withPrimerFeaturesInGenbankText } from '../src/renderer/modules/sequence-viewer/genbank-primer-splice.js';

const ORIGINAL = [
  'LOCUS       pBase                       31 bp    DNA     circular UNK 01-JAN-1980',
  'DEFINITION  .',
  'ACCESSION   <unknown id>',
  'VERSION     <unknown id>',
  'KEYWORDS    .',
  'SOURCE      .',
  '  ORGANISM  .',
  '            .',
  'FEATURES             Location/Qualifiers',
  '     promoter        join(1..6,7..24,25..31)',
  '                     /parts="1:-35;3:-10"',
  '                     /note="promoter for the E. coli lac operon"',
  '                     /label="lac promoter"',
  'ORIGIN',
  '        1 tttacacttt atgcttccgg ctcgtatgtt g',
  '//',
  ''
].join('\n');

const primer = {
  name: 'cassette_F',
  type: 'primer_bind',
  strand: 1,
  description: 'Designed forward primer',
  segments: [{ start: 0, end: 20 }]
};

const annotated = withPrimerFeaturesInGenbankText(ORIGINAL, [primer], 31);
const originalLines = ORIGINAL.split('\n');
const annotatedLines = annotated.split('\n');

// Every original line survives, in order, with nothing edited.
let cursor = 0;
originalLines.forEach((line) => {
  const found = annotatedLines.indexOf(line, cursor);
  assert.notEqual(found, -1, `original line lost: ${JSON.stringify(line)}`);
  cursor = found + 1;
});
// The qualifier the viewer does not model is exactly what a rewrite would drop.
assert.equal(annotated.includes('/parts="1:-35;3:-10"'), true);
assert.equal(annotated.includes('ACCESSION   <unknown id>'), true);
assert.equal(annotated.includes('01-JAN-1980'), true);
assert.equal(annotated.includes('Exported from Sequence Viewer'), false);

// The only additions are the primer's own lines, and they sit inside FEATURES.
const added = annotatedLines.filter((line, index) => originalLines[index - (annotatedLines.length - originalLines.length)] !== line
  && !originalLines.includes(line));
assert.deepEqual(added, [
  '     primer_bind     1..20',
  '                     /label="cassette_F"',
  '                     /note="Designed forward primer"'
]);
assert.equal(
  annotatedLines.indexOf('     primer_bind     1..20') > annotatedLines.indexOf('FEATURES             Location/Qualifiers'),
  true
);
assert.equal(
  annotatedLines.indexOf('     primer_bind     1..20') < annotatedLines.indexOf('ORIGIN'),
  true
);

// Re-annotating replaces the primer's block rather than stacking a second copy.
const twice = withPrimerFeaturesInGenbankText(annotated, [primer], 31);
assert.equal(twice.split('\n').filter((line) => line.startsWith('     primer_bind')).length, 1);
assert.equal(twice, annotated);

// Qualifiers longer than one GenBank line are still the same primer identity.
const longPrimer = {
  ...primer,
  name: 'primer_name_that_is_deliberately_longer_than_the_available_genbank_qualifier_line_width_for_reconfirmation'
};
const longAnnotated = withPrimerFeaturesInGenbankText(ORIGINAL, [longPrimer], 31);
assert.equal(longAnnotated.split('\n').filter((line) => line.startsWith('     primer_bind')).length, 1);
assert.equal(longAnnotated.includes(`/label="${longPrimer.name}"`), false, 'fixture must wrap the label');
const longTwice = withPrimerFeaturesInGenbankText(longAnnotated, [longPrimer], 31);
assert.equal(longTwice.split('\n').filter((line) => line.startsWith('     primer_bind')).length, 1);
assert.equal(longTwice, longAnnotated);

// A renamed primer leaves the old site alone: only same-named blocks are replaced.
const renamed = withPrimerFeaturesInGenbankText(annotated, [{ ...primer, name: 'cassette_F2' }], 31);
assert.equal(renamed.split('\n').filter((line) => line.startsWith('     primer_bind')).length, 2);

// A record with no FEATURES block gets one instead of falling back to a rewrite.
const bare = 'LOCUS       bare        20 bp    DNA     linear   UNK 01-JAN-1980\nORIGIN\n        1 acgt\n//\n';
const withHeader = withPrimerFeaturesInGenbankText(bare, [primer], 31);
assert.equal(withHeader.includes('FEATURES             Location/Qualifiers'), true);
assert.equal(withHeader.includes('     primer_bind     1..20'), true);
assert.equal(withHeader.indexOf('primer_bind') < withHeader.indexOf('ORIGIN'), true);

// Nothing to splice into, or nothing to add: say so rather than guess.
assert.equal(withPrimerFeaturesInGenbankText('not a genbank file', [primer], 31), '');
assert.equal(withPrimerFeaturesInGenbankText('', [primer], 31), '');
assert.equal(withPrimerFeaturesInGenbankText(ORIGINAL, [], 31), ORIGINAL);

console.log('genbank-primer-splice-selfcheck: ok');
