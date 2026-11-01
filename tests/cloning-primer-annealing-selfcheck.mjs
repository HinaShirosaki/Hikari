import assert from 'node:assert/strict';
import test from 'node:test';
import { alignPrimerToDna, annealingStats, orientedBase, primerLengthOptions, primerTemplateRecord, replacePlanPrimer, resizedPrimer } from '../src/renderer/modules/sequence-viewer/cloning-design/primer-annealing-model.js';
import { cloningPrimerTm } from '../src/renderer/modules/sequence-viewer/calculations/oligo.js';
import { reverseComplementDna } from '../src/renderer/modules/sequence-viewer/calculations/sequence.js';
import { buildPrimerRecord } from '../src/renderer/modules/sequence-viewer/cloning-assembly/primer-records.js';
import { createSequenceViewerCloningDesignNotebookPage } from '../src/renderer/modules/sequence-viewer/cloning-design-notebook.js';

function dna(length, seed = 513) {
  let state = seed >>> 0;
  return Array.from({ length }, () => {
    state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
    return 'ACGT'[state % 4];
  }).join('');
}
const record = (sequence, topology = 'linear') => ({ sequence, topology });
const binding = 'GAGCTGACTACGATCGTACGATGCTAGC';
const tail = 'CAGTCGAT';

test('the same oligo has different matched-region Tms on template and assembled product', () => {
  const sequence = tail + binding;
  const template = annealingStats(alignPrimerToDna(sequence, record(binding)));
  const product = annealingStats(alignPrimerToDna(sequence, record(sequence)));
  assert.equal(template.paired, binding.length);
  assert.equal(template.unpaired, tail.length);
  assert.equal(template.tm, cloningPrimerTm(binding));
  assert.equal(product.paired, sequence.length);
  assert.equal(product.tm, cloningPrimerTm(sequence));
  assert.ok(product.tm > template.tm);
  assert.equal(product.gc, (sequence.match(/[GC]/g) || []).length / sequence.length * 100);
});

test('internal mismatches break the Tm region instead of being counted as paired bases', () => {
  const changed = binding.slice(0, 15) + 'T' + binding.slice(16);
  const alignment = alignPrimerToDna(binding, record(changed));
  const stats = annealingStats(alignment);
  assert.equal(stats.mismatches, 1);
  assert.equal(stats.paired, binding.length - 1);
  assert.ok(stats.tm < cloningPrimerTm(binding));
  assert.equal(stats.tmBases, 15);
});

test('internal insertions and deletions produce gapped alignments without shifting the downstream bases', () => {
  const template = dna(70, 845);
  for (const insertedInPrimer of [true, false]) {
    const inserted = template.slice(0, 35) + 'AAA' + template.slice(35);
    const alignment = alignPrimerToDna(insertedInPrimer ? inserted : template, record(insertedInPrimer ? template : inserted));
    const stats = annealingStats(alignment);
    assert.equal(alignment.ambiguous, false);
    assert.equal(stats.gaps, 3);
    assert.equal(stats.paired, template.length);
    assert.equal(alignment.columns.findLast(column => column.primerIndex !== null).paired, true);
  }
});

test('forward and reverse primers are read in oligo 5′ to 3′ orientation', () => {
  const template = record(dna(300, 61));
  for (const strand of [1, -1]) {
    const forward = template.sequence.slice(80, 110);
    const sequence = strand === 1 ? forward : reverseComplementDna(forward);
    const alignment = alignPrimerToDna(sequence, template);
    assert.equal(alignment.strand, strand);
    assert.equal(alignment.ambiguous, false);
    assert.equal(annealingStats(alignment).paired, sequence.length);
    assert.equal(alignment.columns.map(column => column.base).join(''), sequence);
    for (const column of alignment.columns) assert.equal(column.base, orientedBase(template, column.targetIndex, strand));
  }
});

test('circular origin sites work on either strand and linear DNA never wraps', () => {
  const sequence = dna(300, 112);
  const acrossOrigin = sequence.slice(-15) + sequence.slice(0, 20);
  for (const primer of [acrossOrigin, reverseComplementDna(acrossOrigin)]) {
    const aligned = alignPrimerToDna(primer, record(sequence, 'circular'));
    assert.equal(aligned.ambiguous, false);
    assert.equal(annealingStats(aligned).paired, primer.length);
    assert.ok(annealingStats(alignPrimerToDna(primer, record(sequence))).paired < primer.length);
  }
});

test('repeated sites are flagged and unresolved bases never count as exact pairing', () => {
  const alignment = alignPrimerToDna(binding, record(binding + dna(60, 13) + binding));
  assert.equal(alignment.ambiguous, true);
  assert.equal(alignment.siteCount, 2);
  assert.equal(alignPrimerToDna('N'.repeat(20), record('N'.repeat(100))), null);
  assert.equal(alignPrimerToDna('ACGT', record('ACGT')), null);
  assert.equal(annealingStats(null).tm, null);
});

test('3′ resizing follows the product on either strand and retains the original 5′ tail', () => {
  const product = record(dna(400, 918));
  for (const strand of [1, -1]) {
    const oligo = strand === 1 ? product.sequence.slice(80, 110) : reverseComplementDna(product.sequence.slice(80, 110));
    const primer = buildPrimerRecord({ name: 'PCR F', sequence: oligo, tailSequence: oligo.slice(0, 8), bindingSequence: oligo.slice(8) });
    const options = primerLengthOptions(primer, product);
    const longer = resizedPrimer(primer, 35, options);
    const expected = strand === 1 ? product.sequence.slice(80, 115) : reverseComplementDna(product.sequence.slice(75, 110));
    assert.equal(longer.sequence, expected);
    assert.equal(longer.tailSequence, primer.tailSequence);
    assert.equal(longer.bindingSequence, expected.slice(8));
    assert.equal(resizedPrimer(primer, 0, options).length, 16);
  }
});

test('linear ends, ambiguous products and original oligos above 120 nt cannot gain invented extension bases', () => {
  const product = record(dna(160, 662));
  const primer = { sequence: product.sequence.slice(-30), bindingSequence: product.sequence.slice(-30) };
  assert.equal(primerLengthOptions(primer, product).max, 30);
  const duplicate = record(primer.sequence + dna(30) + primer.sequence);
  assert.equal(primerLengthOptions(primer, duplicate).max, 30);
  const longPrimer = { sequence: product.sequence.slice(0, 130) };
  assert.equal(primerLengthOptions(longPrimer, product).max, 130);
});

test('shortening keeps a mutagenic base plus a downstream binding anchor', () => {
  const template = dna(60, 217);
  const mutation = template[30] === 'A' ? 'C' : 'A';
  const product = record(template.slice(0, 30) + mutation + template.slice(31));
  const primer = { sequence: product.sequence.slice(10, 50) };
  const options = primerLengthOptions(primer, product, alignPrimerToDna(primer.sequence, product), alignPrimerToDna(primer.sequence, record(template)));
  assert.ok(options.min >= 29, 'the edit at primer index 20 retains eight downstream bases');
});

test('template identity uses the assigned stock and never substitutes the parent for an unavailable donor', () => {
  const source = { parentEntryId: 'vector', originalSequence: dna(300), recordName: 'Parent' };
  const donor = { id: 'donor', sequence: dna(200, 73), name: 'Donor', topology: 'circular' };
  const context = { source, record: record(dna(400)), donor };
  assert.equal(primerTemplateRecord({ ...context, primer: { templateEntryId: 'donor' } }), donor);
  assert.equal(primerTemplateRecord({ ...context, primer: { templateEntryId: 'vector' } }).sequence, source.originalSequence);
  const missing = primerTemplateRecord({ ...context, primer: { templateEntryId: 'other-donor' } });
  assert.equal(missing.entryId, 'other-donor');
  assert.equal(missing.sequence, '');
  const intermediate = primerTemplateRecord({ ...context, primer: { templateEntryId: 'vector', template_kind: 'hypothetical_intermediate' } });
  assert.equal(intermediate.sequence, '');
  assert.equal(intermediate.name, 'Intermediate DNA');
});

test('Protein Builder primers use their complete source DNA from fragment metadata', () => {
  const host = dna(500, 74);
  const resolved = primerTemplateRecord({ primer: { templateId: 'domain', templateEntryId: 'stock' }, displayPlan: {
    plans: [{ plan: { orderedFragmentMap: { fragments: [{ id: 'domain', metadata: {
      templateName: 'Protein source', specificitySequence: host, specificityCircular: true, templateSequence: host.slice(60, 160)
    } }] } } }]
  } });
  assert.equal(resolved.sequence, host);
  assert.equal(resolved.topology, 'circular');
});

test('applying a length changes table and nested PCR records, recalculates quality, and retains routing', () => {
  const product = record(dna(300, 81));
  const original = { ...buildPrimerRecord({ name: 'Named F', role: 'forward', sequence: product.sequence.slice(60, 90), bindingSequence: product.sequence.slice(60, 90), templateId: 'insert' }), templateEntryId: 'donor' };
  const plan = { feasible: true, primers: [original], warnings: [], plans: [{ plan: { primerOligoPlan: { primers: [{ ...original, name: 'engine_F' }] } } }] };
  const next = resizedPrimer(original, 33, primerLengthOptions(original, product));
  const applied = replacePlanPrimer(plan, 0, next, alignPrimerToDna(next.sequence, product));
  assert.equal(applied.primers[0].sequence, product.sequence.slice(60, 93));
  assert.equal(applied.primers[0].templateEntryId, 'donor');
  const nested = applied.plans[0].plan.primerOligoPlan;
  assert.equal(nested.primers[0].sequence, applied.primers[0].sequence);
  assert.equal(nested.primers[0].name, 'engine_F');
  assert.equal(nested.primerTmSummary.mean, applied.primers[0].tm);
  assert.deepEqual(plan.primers, [original], 'the previous plan stays intact');
  assert.ok(applied.warnings.some(warning => warning.includes('manually')));
  const invalid = replacePlanPrimer(plan, 0, next, null);
  assert.equal(invalid.feasible, false);
  assert.equal(invalid.primers[0].tm, 0);
});

test('weak binding temperatures need review and restoring a valid length clears that review', () => {
  const product = record(binding + dna(80, 94));
  const original = buildPrimerRecord({ name: 'PCR F', role: 'forward', sequence: binding, bindingSequence: binding });
  const plan = { feasible: true, primers: [original], warnings: [] };
  const short = resizedPrimer(original, 12, primerLengthOptions(original, product));
  const review = replacePlanPrimer(plan, 0, short, alignPrimerToDna(short.sequence, product));
  assert.equal(review.feasible, false);
  assert.ok(review.warnings.some(warning => warning.includes('needs review')));
  const restored = replacePlanPrimer(review, 0, original, alignPrimerToDna(original.sequence, product));
  assert.equal(restored.feasible, true);
  assert.equal(restored.warnings.some(warning => warning.includes('needs review')), false);
});

test('a manually adjusted review draft refreshes its notebook with current primers and explicit review status', () => {
  const state = {};
  const product = record(binding + dna(80, 94));
  const primer = buildPrimerRecord({ name: 'PCR F', sequence: binding.slice(0, 12), bindingSequence: binding.slice(0, 12) });
  const args = { state, record: product, source: { originalSequence: product.sequence }, displayPlan: {
    feasible: false, strategy: 'q5-kld', primers: [primer], warnings: ['The adjusted primer needs review.'], plans: []
  } };
  assert.equal(createSequenceViewerCloningDesignNotebookPage(args), null);
  const saved = createSequenceViewerCloningDesignNotebookPage({ ...args, allowReviewDraft: true });
  assert.equal(saved.entry.sequenceViewerCloningDesign.needsReview, true);
  assert.equal(saved.entry.resultTable.rows[0].sequence, primer.sequence);
  assert.ok(saved.entry.result.includes('Design status: Needs review'));
});
