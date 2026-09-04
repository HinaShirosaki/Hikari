import {
  buildVectorSequenceName,
  resolveVectorBackboneName
} from '../../sequence-naming.js';
import { clamp, cleanText, normalizeSequenceText } from '../../shared.js';

// Dropping a finished Protein Builder construct into the open vector: splices
// the DNA in through the shared sequence-edit action so downstream handoffs see
// it like any other edit.
function createVectorProteinConstruct({
  state,
  vb,
  getSelectedRecord,
  setStatus,
  persistFeatureMutation,
  onApplySequenceEdit,
  onNavigateVectorBuilder,
  clearSelection,
  hideOverlays,
  render
} = {}) {
  // Protein Builder folded in: splice a built construct straight into the open
  // vector at the site picked on the map, instead of assembling against a
  // separate stored backbone. Goes through the shared sequence-edit action so
  // the Cloning Design handoff sees the edit like any other.
  async function applyProteinConstruct({ constructName, dnaConstruct } = {}) {
    const target = vb().insertTarget;
    const record = getSelectedRecord();
    const insertSequence = normalizeSequenceText(dnaConstruct?.sequence || '');
    if (!target) {
      setStatus('Pick an insertion site on the vector map first.', true);
      return false;
    }
    if (!record?.sequence?.length || !insertSequence.length) {
      setStatus('Build the construct DNA before inserting it into the vector.', true);
      return false;
    }

    const sequenceLength = record.sequence.length;
    const mode = target.mode === 'replace' ? 'replace' : 'insert';
    const start = clamp(Math.round(Number(target.start) || 0), 0, sequenceLength);
    const end = mode === 'replace'
      ? clamp(Math.round(Number(target.end) || start), start, sequenceLength)
      : start;
    if (mode === 'replace' && end <= start) {
      setStatus('The replacement target is empty. Select a range on the map again.', true);
      return false;
    }

    const label = cleanText(constructName, 140) || 'Protein construct';
    const proteinInputAaLength = (Array.isArray(dnaConstruct?.parts) ? dnaConstruct.parts : [])
      .filter((part) => cleanText(part?.kind, 40).toLowerCase() === 'custom')
      .reduce((longest, part) => Math.max(longest, Math.max(0, Number(part?.proteinLength) || 0)), 0);
    const backboneName = resolveVectorBackboneName(record, record.name || 'Vector');
    try {
      await onApplySequenceEdit({ mode, range: { start, end }, sequence: insertSequence });
    } catch (error) {
      setStatus(error?.message || 'Failed to insert the protein construct.', true);
      return false;
    }

    const editedRecord = getSelectedRecord();
    const nextFeatures = Array.isArray(editedRecord?.features) ? [...editedRecord.features] : [];
    nextFeatures.push({
      id: `vector_builder_insert_${Date.now().toString(36)}`,
      name: label,
      type: 'insert',
      strand: 1,
      source: 'vector_builder',
      description: `Protein Builder construct inserted at ${(start + 1).toLocaleString()}.`,
      segments: [{ start, end: start + insertSequence.length }]
    });

    let cursor = start;
    (Array.isArray(dnaConstruct?.parts) ? dnaConstruct.parts : []).forEach((part, index) => {
      const partSequence = normalizeSequenceText(part?.dnaSequence || '');
      if (!partSequence.length) {
        return;
      }
      nextFeatures.push({
        id: `vector_builder_insert_part_${Date.now().toString(36)}_${index}`,
        name: cleanText(part?.label, 160) || `Block ${index + 1}`,
        type: 'misc_feature',
        strand: 1,
        source: 'vector_builder',
        description: `Protein Builder DNA block (${partSequence.length} bp).`,
        segments: [{ start: cursor, end: cursor + partSequence.length }]
      });
      cursor += partSequence.length;
    });

    const records = [...state.records];
    const selectedIndex = clamp(state.selectedRecordIndex, 0, Math.max(0, records.length - 1));
    const generatedName = buildVectorSequenceName({ backboneName, payloadName: label });
    const nextRecord = { ...records[selectedIndex], name: generatedName, features: nextFeatures };
    records[selectedIndex] = nextRecord;
    state.records = records;
    if (state.sequenceEditDesignSource) {
      state.sequenceEditDesignSource = {
        ...state.sequenceEditDesignSource,
        recordName: generatedName,
        generatedName,
        sourceKind: 'vector_builder',
        backboneName,
        constructName: label,
        proteinInputAaLength
      };
    }

    vb().insertTarget = null;
    clearSelection();
    vb().selectedFeatureIndex = -1;
    hideOverlays();
    onNavigateVectorBuilder();
    render();

    try {
      await persistFeatureMutation(nextRecord, `Inserted ${label} (${insertSequence.length} bp) into the vector.`);
    } catch (error) {
      setStatus(error?.message || 'Inserted the construct but failed to save it.', true);
      return true;
    }
    setStatus(`Inserted ${label} (${insertSequence.length.toLocaleString()} bp) into ${nextRecord.name || 'the vector'}.`);
    return true;
  }

  return { applyProteinConstruct };
}

export { createVectorProteinConstruct };
