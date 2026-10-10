import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockDocument, trigger } from './support/runtime.js';
import { getSequenceViewerElements } from '../src/renderer/modules/sequence-viewer/dom.js';
import { createSequenceViewerSequenceEditingController } from '../src/renderer/modules/sequence-viewer/detail-sequence-editing.js';
import { reverseComplementDna, translateDnaSequence } from '../src/renderer/modules/sequence-viewer/calculations/sequence.js';
import { buildPeptideInsertDna, getCodingOffsetAtBoundary, getInsertionCodingFeatures, PEPTIDE_INSERT_GROUPS } from '../src/renderer/modules/sequence-viewer/sequence-edit-peptides.js';

function fixture(features = [], selectedFeature = features[0], boundary = 12) {
  const record = { sequence: 'ACG'.repeat(40), topology: 'circular', features };
  const document = createMockDocument();
  const elements = getSequenceViewerElements(document);
  elements.featureEditorOverlay.hidden = true;
  elements.backboneDialogOverlay.hidden = true;
  const edits = [];
  const controller = createSequenceViewerSequenceEditingController({
    rootDocument: document, elements, state: { sequenceCursorBase: boundary },
    getSelectedRecord: () => record,
    getSelectedFeature: () => selectedFeature,
    onApplySequenceEdit: async (edit) => {
      edits.push(edit);
      record.sequence = record.sequence.slice(0, edit.range.start) + edit.sequence + record.sequence.slice(edit.range.end);
    }
  });
  controller.openSequenceEditDialog('insert', { range: { start: boundary, end: boundary } });
  const change = (key, value) => {
    elements[key].value = value;
    trigger(elements[key], 'change');
  };
  return { record, elements, edits, controller, change };
}

test('every shared tag, linker, and cleavage site encodes its peptide in both orientations', () => {
  for (const { id: type, items } of PEPTIDE_INSERT_GROUPS) {
    for (const tag of items) {
      for (const strand of [1, -1]) {
        for (const orientation of ['along', 'reverse']) {
          const result = buildPeptideInsertDna(`${type}:${tag.id}`, strand, orientation);
          assert.equal(result.sequence.length, tag.sequence.length * 3);
          const codingDna = result.strand === -1 ? reverseComplementDna(result.sequence) : result.sequence;
          assert.equal(translateDnaSequence(codingDna).protein, tag.sequence);
        }
      }
    }
  }
});

for (const [key, peptide, group] of [
  ['linker:gs', 'GS', 'Linkers'],
  ['cleavage:tev', 'ENLYFQG', 'Protease cleavage sites']
]) {
  test(`${key} is selectable and inserts its coding DNA with the shared orientation controls`, async () => {
    const feature = { name: 'Reverse CDS', type: 'CDS', strand: -1, segments: [{ start: 6, end: 30 }] };
    const { elements, controller, edits, change } = fixture([feature]);
    assert.ok(elements.sequenceEditTagSelect.innerHTML.includes(`<optgroup label="${group}">`));
    change('sequenceEditTagSelect', key);
    const aligned = elements.sequenceEditTextarea.value;
    assert.equal(translateDnaSequence(reverseComplementDna(aligned)).protein, peptide);
    change('sequenceEditTagOrientation', 'reverse');
    const opposite = elements.sequenceEditTextarea.value;
    assert.equal(translateDnaSequence(opposite).protein, peptide);
    await controller.applySequenceEditDialog();
    assert.equal(edits[0].sequence, opposite);
    assert.equal(edits[0].sequence.length, peptide.length * 3);
  });
}

test('coding offsets respect joined features, both strands, and circular origin boundaries', () => {
  const record = { sequence: 'ACG'.repeat(40), topology: 'circular' };
  const segments = [{ start: 108, end: 120 }, { start: 0, end: 18 }];
  for (const boundary of [0, 120]) {
    assert.equal(getCodingOffsetAtBoundary(record, { segments, strand: 1 }, boundary), 12);
    assert.equal(getCodingOffsetAtBoundary(record, { segments, strand: -1 }, boundary), 18);
  }
  const joined = [{ start: 3, end: 12 }, { start: 24, end: 42 }];
  assert.equal(getCodingOffsetAtBoundary(record, { segments: joined, strand: 1 }, 27), 12);
  assert.equal(getCodingOffsetAtBoundary(record, { segments: joined, strand: -1 }, 9), 21);
  assert.equal(getCodingOffsetAtBoundary(record, { segments: joined }, 18), null);
});

for (const strand of [1, -1]) {
  test(`tag insertion follows a selected ${strand === 1 ? 'forward' : 'reverse'} CDS and reverses relative to it`, async () => {
    const feature = { name: 'Target CDS', type: 'CDS', strand, segments: [{ start: 6, end: 30 }] };
    const { record, elements, controller, edits, change } = fixture([feature]);
    const original = record.sequence;
    assert.equal(elements.sequenceEditTagOrfSelect.value, '0');
    change('sequenceEditTagSelect', 'tag:flag');
    const aligned = elements.sequenceEditTextarea.value;
    assert.equal(translateDnaSequence(strand === -1 ? reverseComplementDna(aligned) : aligned).protein, 'DYKDDDDK');
    assert.match(elements.sequenceEditTagPreview.textContent, /at a codon boundary/);
    change('sequenceEditTagOrientation', 'reverse');
    const reversed = elements.sequenceEditTextarea.value;
    assert.equal(reversed, reverseComplementDna(aligned));
    assert.match(elements.sequenceEditTagPreview.textContent, /opposite to this ORF/);
    await controller.applySequenceEditDialog();
    assert.deepEqual(edits[0], { mode: 'insert', range: { start: 12, end: 12 }, sequence: reversed });
    assert.equal(record.sequence, original.slice(0, 12) + reversed + original.slice(12));
    assert.equal(elements.sequenceEditOverlay.hidden, true);
  });
}

test('overlapping coding features require an explicit reference unless a coding feature is selected', () => {
  const plus = { name: 'Plus', type: 'CDS', strand: 1, segments: [{ start: 6, end: 30 }] };
  const minus = { ...plus, name: 'Minus', strand: -1 };
  const { elements, change } = fixture([plus, minus], null);
  assert.equal(elements.sequenceEditTagOrfSelect.value, '');
  change('sequenceEditTagSelect', 'tag:his6');
  assert.match(elements.sequenceEditTagOrientation.innerHTML, /Forward strand/);
  const plusDna = elements.sequenceEditTextarea.value;
  change('sequenceEditTagOrfSelect', '1');
  assert.equal(elements.sequenceEditTextarea.value, reverseComplementDna(plusDna));
  assert.match(elements.sequenceEditTagOrientation.innerHTML, /Along ORF/);
});

test('frame feedback respects codon_start and flags a split codon without moving the edit', async () => {
  const feature = { name: 'Partial CDS', type: 'CDS', qualifiers: { codon_start: 2 }, segments: [{ start: 6, end: 30 }] };
  const { elements, controller, edits, change } = fixture([feature], feature, 12);
  change('sequenceEditTagSelect', 'tag:ha');
  assert.match(elements.sequenceEditTagPreview.textContent, /inside a codon/);
  await controller.applySequenceEditDialog();
  assert.equal(edits[0].range.start, 12);
  controller.openSequenceEditDialog('insert', { range: { start: 13, end: 13 } });
  change('sequenceEditTagSelect', 'tag:ha');
  assert.match(elements.sequenceEditTagPreview.textContent, /at a codon boundary/);
});

test('manual DNA edits and dialog reopen clear the library selection; other edit modes hide tags', () => {
  const { elements, controller, change } = fixture();
  change('sequenceEditTagSelect', 'tag:ha');
  assert.equal(elements.sequenceEditTagOptions.hidden, false);
  elements.sequenceEditTextarea.value = 'ACGT';
  trigger(elements.sequenceEditTextarea, 'input');
  assert.equal(elements.sequenceEditTagSelect.value, '');
  assert.equal(elements.sequenceEditTagOptions.hidden, true);
  assert.equal(elements.sequenceEditTextarea.value, 'ACGT');
  controller.hideSequenceEditDialog();
  controller.openSequenceEditFromKeyboardEvent({ key: 'g', target: {} });
  assert.equal(elements.sequenceEditTagWrap.hidden, false);
  assert.equal(elements.sequenceEditTextarea.value, 'G');
  assert.equal(elements.sequenceEditTagSelect.value, '');
  for (const mode of ['replace', 'delete']) {
    controller.openSequenceEditDialog(mode, { range: { start: 6, end: 9 } });
    assert.equal(elements.sequenceEditTagWrap.hidden, true);
    assert.equal(elements.sequenceEditTagOptions.hidden, true);
  }
});

test('unannotated insertion points can use a detected ORF; unrelated features do not supply its strand', () => {
  const record = { sequence: 'ATG' + 'GCT'.repeat(90) + 'TAA', topology: 'linear', features: [] };
  const nonCoding = { type: 'promoter', strand: -1, segments: [{ start: 0, end: 90 }] };
  const candidates = getInsertionCodingFeatures(record, 30, nonCoding);
  assert.ok(candidates.some((feature) => feature.strand === 1));
  assert.ok(candidates.every((feature) => feature !== nonCoding));
});
