import assert from 'node:assert/strict';
import test from 'node:test';
import { alignPrimerToDna, annealingStats, buildPrimerReferenceFrame, clampPrimerEnd, normalizePrimerTmFloor, orientedBase, primerAlignmentInReferenceFrame, primerResizeWindow, primerTemplateRecord, primerWithTemplateBinding, replacePlanPrimer, resizePrimerInterval, templateBindingTooLow } from '../src/renderer/modules/sequence-viewer/cloning-design/primer-annealing-model.js';
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
function resized3(primer, length, product) {
  const options = primerResizeWindow(primer, product);
  return resizePrimerInterval(primer, clampPrimerEnd({ start: 0, end: primer.sequence.length }, '3', length, options), options);
}

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
    const longer = resized3(primer, 35, product);
    const expected = strand === 1 ? product.sequence.slice(80, 115) : reverseComplementDna(product.sequence.slice(75, 110));
    assert.equal(longer.sequence, expected);
    assert.equal(longer.tailSequence, primer.tailSequence);
    assert.equal(longer.bindingSequence, expected.slice(8));
    assert.equal(resized3(primer, 0, product).length, 8);
  }
});

test('linear ends, ambiguous products and original oligos above 120 nt cannot gain invented extension bases', () => {
  const product = record(dna(160, 662));
  const primer = { sequence: product.sequence.slice(-30), bindingSequence: product.sequence.slice(-30) };
  assert.equal(resized3(primer, 100, product).length, 30);
  const duplicate = record(primer.sequence + dna(30) + primer.sequence);
  assert.equal(resized3(primer, 100, duplicate).length, 30);
  const longPrimer = { sequence: product.sequence.slice(0, 130) };
  assert.equal(resized3(longPrimer, 150, product).length, 130);
});

test('users can shorten through a mutation and see the resulting weak template binding', () => {
  const template = dna(60, 217);
  const mutation = template[30] === 'A' ? 'C' : 'A';
  const product = record(template.slice(0, 30) + mutation + template.slice(31));
  const primer = { sequence: product.sequence.slice(10, 50) };
  const short = resized3(primer, 12, product);
  assert.equal(short.sequence, primer.sequence.slice(0, 12));
  assert.equal(templateBindingTooLow(alignPrimerToDna(short.sequence, record(template))), true);
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
  const next = resized3(original, 33, product);
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
  const short = resized3(original, 12, product);
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

test('resizing preserves a fixed DNA reference on both strands through shortening and extension', () => {
  const product = record(dna(400, 177));
  for (const strand of [1, -1]) {
    const sequence = strand === 1 ? product.sequence.slice(80, 110) : reverseComplementDna(product.sequence.slice(80, 110));
    const primer = { sequence, bindingSequence: sequence };
    const original = alignPrimerToDna(sequence, product);
    const options = primerResizeWindow(primer, product, original);
    const frame = buildPrimerReferenceFrame(product, original, options.maxLength, options);
    const reference = structuredClone(frame.columns);
    for (const length of [options.minLength, 25, 40, options.maxLength, 30]) {
      const resized = resized3(primer, length, product);
      const alignment = primerAlignmentInReferenceFrame(resized.sequence, product, frame, alignPrimerToDna(resized.sequence, product));
      assert.deepEqual(frame.columns, reference);
      assert.equal(product.sequence.length, 400);
      assert.equal(alignment.strand, strand);
      assert.equal(alignment.columns[0].targetIndex, original.columns[0].targetIndex);
      assert.equal(annealingStats(alignment).paired, resized.sequence.length);
    }
  }
});

test('the template reference keeps insertion slots and a primer cannot jump to an earlier repeated site when shortened', () => {
  const template = record(dna(80, 931));
  const oligo = template.sequence.slice(10, 35) + 'AAA' + template.sequence.slice(35, 55);
  const original = alignPrimerToDna(oligo, template);
  const frame = buildPrimerReferenceFrame(template, original, 70);
  const reference = structuredClone(frame.columns);
  const shorter = primerAlignmentInReferenceFrame(oligo.slice(0, -5), template, frame);
  assert.equal(annealingStats(shorter).gaps, 3);
  assert.deepEqual(frame.columns, reference);
  const repeat = dna(20, 647), unique = dna(15, 334);
  const plasmid = record(repeat + dna(50, 73) + repeat + unique + dna(50, 75));
  const site = alignPrimerToDna(repeat + unique, plasmid);
  const repeatedFrame = buildPrimerReferenceFrame(plasmid, site, 60);
  const search = alignPrimerToDna(repeat, plasmid);
  assert.equal(search.ambiguous, true);
  assert.equal(search.start, 0);
  const anchored = primerAlignmentInReferenceFrame(repeat, plasmid, repeatedFrame, search);
  assert.equal(anchored.columns[0].targetIndex, 70);
  assert.equal(anchored.ambiguous, true);
});

test('both endpoints resize from the product on forward and reverse strands while retaining a fixed reference', () => {
  const product = record(dna(400, 718));
  for (const strand of [1, -1]) {
    const sequence = strand === 1 ? product.sequence.slice(100, 130) : reverseComplementDna(product.sequence.slice(100, 130));
    const primer = { sequence, bindingSequence: sequence };
    const initial = alignPrimerToDna(sequence, product);
    const window = primerResizeWindow(primer, product, initial);
    const frame = buildPrimerReferenceFrame(product, initial, window.maxLength, window);
    const reference = structuredClone(frame.columns);
    for (const range of [{ start: -5, end: 33 }, { start: 5, end: 27 }, { start: -10, end: -2 }, { start: 33, end: 44 }]) {
      const resized = resizePrimerInterval(primer, range, window);
      const expected = strand === 1 ? product.sequence.slice(100 + range.start, 100 + range.end)
        : reverseComplementDna(product.sequence.slice(130 - range.end, 130 - range.start));
      assert.equal(resized.sequence, expected);
      const projected = primerAlignmentInReferenceFrame(resized.sequence, product, frame, alignPrimerToDna(resized.sequence, product), range.start);
      assert.equal(projected.columns.map(column => column.base).join(''), expected);
      assert.equal(annealingStats(projected).paired, expected.length);
      assert.deepEqual(frame.columns, reference);
    }
  }
});

test('5′ and 3′ extensions use product bases that differ from the template', () => {
  const template = record(dna(300, 627));
  const mutate = text => [...text].map(base => base === 'A' ? 'C' : 'A').join('');
  const product = record(template.sequence.slice(0, 90) + mutate(template.sequence.slice(90, 100))
    + template.sequence.slice(100, 130) + mutate(template.sequence.slice(130, 140)) + template.sequence.slice(140));
  const primer = { sequence: product.sequence.slice(100, 130) };
  const window = primerResizeWindow(primer, product);
  const resized = resizePrimerInterval(primer, { start: -10, end: 40 }, window);
  assert.equal(resized.sequence, product.sequence.slice(90, 140));
  assert.notEqual(resized.sequence, template.sequence.slice(90, 140));
  const frame = buildPrimerReferenceFrame(template, alignPrimerToDna(primer.sequence, template), window.maxLength, window);
  const projected = primerAlignmentInReferenceFrame(resized.sequence, template, frame, alignPrimerToDna(resized.sequence, template), -10);
  assert.equal(annealingStats(projected).mismatches, 20);
});

test('5′ resizing crosses circular origins on either strand and stops at linear boundaries or unresolved bases', () => {
  const sequence = dna(300, 883);
  for (const strand of [1, -1]) {
    const segment = strand === 1 ? sequence.slice(0, 30) : reverseComplementDna(sequence.slice(-30));
    const primer = { sequence: segment };
    const circularProduct = record(sequence, 'circular');
    const window = primerResizeWindow(primer, circularProduct);
    const resized = resizePrimerInterval(primer, { start: -5, end: 30 }, window);
    const expected = strand === 1 ? sequence.slice(-5) + sequence.slice(0, 30)
      : reverseComplementDna(sequence.slice(-30) + sequence.slice(0, 5));
    assert.equal(resized.sequence, expected);
    assert.equal(primerResizeWindow(primer, record(sequence)).minStart, 0);
  }
  const withN = record(sequence.slice(0, 95) + 'N' + sequence.slice(96));
  assert.equal(primerResizeWindow({ sequence: sequence.slice(100, 130) }, withN).minStart, -4);
});

test('either end can reach an eight-base weak primer, recover its length, and respect the maximum size', () => {
  const product = record(dna(300, 911));
  const primer = { sequence: product.sequence.slice(100, 130) };
  const window = primerResizeWindow(primer, product);
  const five = clampPrimerEnd({ start: 0, end: 30 }, '5', 1000, window);
  assert.deepEqual(five, { start: 22, end: 30 });
  assert.equal(templateBindingTooLow(alignPrimerToDna(resizePrimerInterval(primer, five, window).sequence, product)), true);
  const three = clampPrimerEnd({ start: 0, end: 30 }, '3', -1000, window);
  assert.deepEqual(three, { start: 0, end: 8 });
  assert.equal(clampPrimerEnd(five, '5', -1000, window).end - clampPrimerEnd(five, '5', -1000, window).start, 120);
  assert.equal(clampPrimerEnd(three, '3', 1000, window).end, 120);
});

test('red binding status depends on template temperature even when product binding is strong', () => {
  const sequence = dna(40, 228);
  const product = alignPrimerToDna(sequence, record(sequence));
  const template = alignPrimerToDna(sequence, record(sequence.slice(-12)));
  assert.ok(annealingStats(product).tm >= 54);
  assert.equal(templateBindingTooLow(product), false);
  assert.ok(annealingStats(template).tm < 54);
  assert.equal(templateBindingTooLow(template), true);
});

test('users can set the template Tm floor, including zero, without changing the binding temperature', () => {
  const alignment = alignPrimerToDna(binding, record(binding));
  const tm = annealingStats(alignment).tm;
  assert.equal(templateBindingTooLow(alignment, tm - 0.1), false);
  assert.equal(templateBindingTooLow(alignment, tm), false);
  assert.equal(templateBindingTooLow(alignment, tm + 0.1), true);
  assert.equal(annealingStats(alignment).tm, tm);
  assert.equal(normalizePrimerTmFloor(), 54);
  assert.equal(normalizePrimerTmFloor(''), 54);
  assert.equal(normalizePrimerTmFloor(0), 0);
  assert.equal(normalizePrimerTmFloor(-10), 0);
  assert.equal(normalizePrimerTmFloor(200), 100);
  assert.equal(normalizePrimerTmFloor(61.5), 61.5);
});

test('trimming a 5′ tail refreshes binding metadata and retains internal insertion slots', () => {
  const seed = dna(70, 674);
  const sequence = seed.slice(10, 35) + 'AAA' + seed.slice(35, 55);
  const template = record(seed);
  const primer = { sequence: tail + sequence, tailSequence: tail, bindingSequence: sequence };
  const product = record(primer.sequence);
  const window = primerResizeWindow(primer, product);
  const range = { start: tail.length + 2, end: primer.sequence.length - 3 };
  const frame = buildPrimerReferenceFrame(template, alignPrimerToDna(primer.sequence, template), window.maxLength, window);
  const resized = resizePrimerInterval(primer, range, window);
  const projected = primerAlignmentInReferenceFrame(resized.sequence, template, frame, alignPrimerToDna(resized.sequence, template), range.start);
  const bound = primerWithTemplateBinding(resized, projected);
  assert.equal(bound.bindingSequence, seed.slice(35, 52));
  assert.equal(bound.tailSequence + bound.bindingSequence, resized.sequence);
  assert.equal(annealingStats(projected).gaps, 3);
  assert.equal(projected.columns.find(column => column.targetIndex === null).sourcePrimerIndex, tail.length + 25);
});
