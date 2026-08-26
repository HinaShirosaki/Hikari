// Confirming a design writes two library entries. Getting the ids wrong would
// overwrite the parent plasmid with the product, so the writes are pinned here.
import assert from 'node:assert/strict';
import {
  confirmCloningDesign,
  describeCloningDesignConfirmation
} from '../src/renderer/modules/sequence-viewer/cloning-design-confirm.js';

const STORAGE = '/tmp/library';
const FORWARD = 'ATGGCACGTTTAGGCCATAC';
const REVERSE_SITE = 'GGTTCCAAGGCTTAACCGTA';
const FILLER = 'CCTAGGTTGACATCGGATCCTTAAGGCACTGACTGGACTTCAGGTTACCA';
const PARENT_SEQUENCE = `${FORWARD}${FILLER}${REVERSE_SITE}`;
// The product carries an inserted cassette between the two primer sites.
const PRODUCT_SEQUENCE = `${FORWARD}${FILLER}GAATTCAAGCTTGCGGCCGC${REVERSE_SITE}`;

function reverseComplement(sequence) {
  const complement = { A: 'T', T: 'A', G: 'C', C: 'G' };
  return [...sequence].reverse().map((base) => complement[base]).join('');
}

const PRIMERS = [
  { name: 'cassette_F', role: 'forward', sequence: FORWARD, bindingSequence: FORWARD, tm: 61.2 },
  {
    name: 'cassette_R',
    role: 'reverse',
    sequence: reverseComplement(REVERSE_SITE),
    bindingSequence: reverseComplement(REVERSE_SITE),
    tm: 60.4
  }
];

// Reuses one bridge's recorded calls while serving a different parent file.
function makeBridgeWithGbk(bridge, gbkText) {
  return { ...bridge, sequenceLibraryGet: async (request) => {
    const response = await bridge.sequenceLibraryGet(request);
    return { ...response, gbkText };
  } };
}

function makeBridge({ parentEntry = null, parentGbk = '', getFails = false } = {}) {
  const calls = { upserts: [], gets: [] };
  let nextId = 0;
  return {
    calls,
    async sequenceLibraryGet(request) {
      calls.gets.push(request);
      if (getFails) {
        return { ok: false, error: 'Entry not found.' };
      }
      return { ok: true, entry: parentEntry, gbkText: parentGbk, alignments: [{ id: 'aln-1' }] };
    },
    async sequenceLibraryUpsert(request) {
      calls.upserts.push(request);
      const id = request.id || `new-${(nextId += 1)}`;
      return { ok: true, entry: { id, name: request.name, status: request.status } };
    }
  };
}

const productRecordInput = {
  name: 'pBase cassette',
  sequence: PRODUCT_SEQUENCE,
  topology: 'circular',
  features: [{ id: 'ori', name: 'ori', type: 'rep_origin', segments: [{ start: 0, end: 10 }] }]
};
const source = { parentEntryId: 'parent-7', recordName: 'pBase cassette' };

// The parent file as it sits on disk: written by some other tool, carrying a
// qualifier and header fields the viewer does not model. Built off a real
// serialisation so the ORIGIN block parses back to PARENT_SEQUENCE.
const gbkBridge = makeBridge();
await confirmCloningDesign({
  record: { name: 'pBase', sequence: PARENT_SEQUENCE, topology: 'circular', features: [] },
  source: {},
  primers: PRIMERS,
  bridge: gbkBridge,
  storagePath: STORAGE
});
const PARENT_GBK = gbkBridge.calls.upserts[0].gbkText
  .replace('ACCESSION   .', 'ACCESSION   <unknown id>')
  .replace(
    'FEATURES             Location/Qualifiers\n',
    'FEATURES             Location/Qualifiers\n'
      + '     promoter        1..6\n'
      + '                     /parts="1:-35;3:-10"\n'
      + '                     /label="lac promoter"\n'
  );
assert.equal(PARENT_GBK.includes('/parts="1:-35;3:-10"'), true);

const bridge = makeBridge({
  parentEntry: { id: 'parent-7', name: 'pBase', status: 'saved' },
  parentGbk: PARENT_GBK
});
const result = await confirmCloningDesign({
  record: productRecordInput,
  source,
  primers: PRIMERS,
  bridge,
  storagePath: STORAGE
});

assert.equal(bridge.calls.upserts.length, 2);
const [productWrite, parentWrite] = bridge.calls.upserts;

// The product is a new file: no id goes out, so the parent is never overwritten.
assert.equal(productWrite.id, '');
// It lands unsaved so the user still has to Save it deliberately.
assert.equal(productWrite.status, 'temporary');
assert.equal(productWrite.name, 'pBase cassette');
assert.equal(productWrite.sequence, PRODUCT_SEQUENCE);
assert.equal(productWrite.gbkText.includes('LOCUS'), true);
assert.deepEqual(
  productWrite.features.filter((feature) => feature.type === 'primer_bind').map((feature) => feature.name),
  ['cassette_F', 'cassette_R']
);
// Features the record already carried survive the annotation pass.
assert.equal(productWrite.features.some((feature) => feature.id === 'ori'), true);
assert.equal(result.productPlaced, 2);
assert.deepEqual(result.productUnplaced, []);

// The parent keeps its identity and only grows features.
assert.equal(parentWrite.id, 'parent-7');
assert.equal(parentWrite.name, 'pBase');
assert.equal(parentWrite.status, 'saved');
assert.equal(parentWrite.sequence, PARENT_SEQUENCE);
assert.deepEqual(parentWrite.alignmentSessions, [{ id: 'aln-1' }]);
assert.deepEqual(
  parentWrite.features.filter((feature) => feature.type === 'primer_bind').map((feature) => feature.name),
  ['cassette_F', 'cassette_R']
);
assert.equal(result.parentPlaced, 2);

// The parent's own file is spliced, not regenerated: the qualifier and header
// fields a re-serialisation would drop are still there, and the only additions
// are the primer sites.
assert.equal(parentWrite.gbkText.includes('/parts="1:-35;3:-10"'), true);
assert.equal(parentWrite.gbkText.includes('ACCESSION   <unknown id>'), true);
assert.equal(parentWrite.gbkText.includes('     promoter        1..6'), true);
assert.equal(
  parentWrite.gbkText.split('\n').filter((line) => line.startsWith('     primer_bind')).length,
  2
);
PARENT_GBK.split('\n').forEach((line) => {
  assert.equal(parentWrite.gbkText.includes(line), true, `parent line lost: ${JSON.stringify(line)}`);
});

// The product is a brand new file, so it is serialised from the record.
assert.equal(productWrite.gbkText.includes('Exported from Sequence Viewer'), true);
assert.equal(result.parentError, '');
assert.equal(result.parentEntry.id, 'parent-7');

// A reverse primer must land on the minus strand on both plasmids.
assert.equal(
  parentWrite.features.find((feature) => feature.name === 'cassette_R').strand,
  -1
);

// A mutagenic primer matches the parent nowhere -- it carries the edit -- so it
// cannot be found there by sequence. It still has an exact footprint on the
// parent, mapped back through the edit, and must be annotated at it.
const LEFT = 'TTGACCGTATGCAGTTCCAG';
const RIGHT = 'ACGGTTCCATGACCTGAAGT';
const MUT_PARENT = `${FILLER}${LEFT}CTG${RIGHT}${FILLER}`;
const MUT_PRODUCT = `${FILLER}${LEFT}GCG${RIGHT}${FILLER}`;
const codonStart = FILLER.length + LEFT.length;
const mutSource = {
  parentEntryId: 'parent-9',
  recordName: 'L28A',
  originalRange: { start: codonStart, end: codonStart + 3 },
  editedRange: { start: codonStart, end: codonStart + 3 }
};
const mutPrimer = {
  name: 'L28A_F',
  role: 'mutagenesis-forward',
  sequence: `${LEFT}GCG${RIGHT}`,
  bindingSequence: `${LEFT}${RIGHT}`,
  tm: 68
};
assert.equal(MUT_PARENT.includes(mutPrimer.sequence), false, 'the primer must not match the parent');
assert.equal(MUT_PARENT.includes(mutPrimer.bindingSequence), false, 'nor must its binding half');

const mutBridge = makeBridge({
  parentEntry: { id: 'parent-9', name: 'pETDuet-1-NdeI-F', status: 'saved' },
  parentGbk: ''
});
const mutParentRecord = {
  name: 'pETDuet-1-NdeI-F', sequence: MUT_PARENT, topology: 'circular', features: []
};
const mutGbkBridge = makeBridge();
await confirmCloningDesign({
  record: mutParentRecord, source: {}, primers: [mutPrimer], bridge: mutGbkBridge, storagePath: STORAGE
});
mutBridge.parentGbkText = mutGbkBridge.calls.upserts[0].gbkText;
const mutResult = await confirmCloningDesign({
  record: { name: 'L28A', sequence: MUT_PRODUCT, topology: 'circular', features: [] },
  source: mutSource,
  primers: [mutPrimer],
  bridge: makeBridgeWithGbk(mutBridge, mutGbkBridge.calls.upserts[0].gbkText),
  storagePath: STORAGE
});
assert.equal(mutResult.productPlaced, 1, 'the product carries the primer verbatim');
assert.equal(mutResult.parentPlaced, 1, 'the parent gets it too, mapped through the edit');
assert.deepEqual(mutResult.parentUnplaced, []);
const mutParentWrite = mutBridge.calls.upserts.at(-1);
const mappedSite = mutParentWrite.features.find((feature) => feature.type === 'primer_bind');
// The footprint spans the mutated codon on the parent's own coordinates.
assert.deepEqual(mappedSite.segments, [{ start: FILLER.length, end: FILLER.length + LEFT.length + 3 + RIGHT.length }]);
assert.equal(mappedSite.segments[0].start < codonStart, true);
assert.equal(mappedSite.segments[0].end > codonStart + 3, true);
assert.match(mappedSite.description, /binds with mismatches here/);

// Confirming twice must refresh the parent's primer sites, not stack a second
// copy: a GenBank round-trip strips the marker that marks them as ours.
const reconfirmBridge = makeBridge({
  parentEntry: { id: 'parent-7', name: 'pBase', status: 'saved' },
  parentGbk: PARENT_GBK
});
await confirmCloningDesign({
  record: productRecordInput, source, primers: PRIMERS, bridge: reconfirmBridge, storagePath: STORAGE
});
assert.equal(
  reconfirmBridge.calls.upserts[1].features.filter((feature) => feature.type === 'primer_bind').length,
  2
);

// An unreadable parent costs the run its annotation, never the product file.
const orphanBridge = makeBridge({ getFails: true });
const orphan = await confirmCloningDesign({
  record: productRecordInput,
  source,
  primers: PRIMERS,
  bridge: orphanBridge,
  storagePath: STORAGE
});
assert.equal(orphanBridge.calls.upserts.length, 1);
assert.equal(orphan.productEntry.id, 'new-1');
assert.equal(orphan.parentEntry, null);
assert.match(orphan.parentError, /Entry not found/);
assert.match(describeCloningDesignConfirmation(orphan), /parent plasmid was not updated/);

// A design with no recorded parent still writes the product and says nothing
// about a parent it never had.
const rootBridge = makeBridge();
const rootless = await confirmCloningDesign({
  record: productRecordInput,
  source: {},
  primers: PRIMERS,
  bridge: rootBridge,
  storagePath: STORAGE
});
assert.equal(rootBridge.calls.gets.length, 0);
assert.equal(rootBridge.calls.upserts.length, 1);
assert.equal(rootless.parentError, '');
assert.doesNotMatch(describeCloningDesignConfirmation(rootless), /parent/);

// Nothing is written when the inputs cannot produce a file.
const guard = makeBridge();
for (const [args, pattern] of [
  [{ record: productRecordInput, primers: [], bridge: guard, storagePath: STORAGE }, /Design primers/],
  [{ record: productRecordInput, primers: PRIMERS, bridge: guard, storagePath: '' }, /Storage Folder Path/],
  [{ record: { sequence: '' }, primers: PRIMERS, bridge: guard, storagePath: STORAGE }, /Load a sequence/],
  [{ record: productRecordInput, primers: PRIMERS, bridge: {}, storagePath: STORAGE }, /storage API unavailable/]
]) {
  await assert.rejects(() => confirmCloningDesign(args), pattern);
}
assert.equal(guard.calls.upserts.length, 0);

assert.match(
  describeCloningDesignConfirmation(result),
  /Created pBase cassette with 2 of 2 primers annotated\. Use Save to keep it in the library\. Annotated 2 on pBase\./
);

console.log('cloning-design-confirm-selfcheck: ok');
