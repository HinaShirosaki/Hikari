import { normalizeSequenceText, computeGcPercent, clamp } from '../shared.js';
import { buildCommercialRestrictionFeatures } from '../restriction-analysis.js';
import { buildOrfFeatures } from '../orf-analysis.js';
import { buildSequenceEditDesignSource } from '../runtime/sequence-edit-helpers.js';
import { designCloningRoute } from './cloning-adapter.js';
import { asArray } from '../../../lib/normalize.js';

// Pure core for the sequence_viewer / sequence_edit MCP contract. It never
// mutates: reads are windowed, `design_cloning` is compute-only, and the
// `propose_*` actions return an approval envelope (target identity + preview)
// that the host must re-verify and apply. Injected accessors keep it testable
// and let the renderer executor bind it to live state.

const MAX_SEQUENCE_WINDOW = 20000;
const PREVIEW_FLANK = 20;
const INSERT_RANGE_STRATEGIES = new Set(['golden-gate', 'gibson', 'in-fusion', 'overlap-extension']);

const CODON_TABLE = {
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L', CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M', GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S', CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T', GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*', CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K', GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W', CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R', GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G'
};

function fail(code, message) {
  return { error: { code, message } };
}

// FNV-1a 32-bit hex. Not cryptographic — only used to detect that the base
// sequence a proposal was computed against still matches at approval time.
export function sequenceDigest(sequence) {
  const text = normalizeSequenceText(sequence || '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function translate(sequence) {
  const clean = normalizeSequenceText(sequence || '');
  let protein = '';
  for (let index = 0; index + 3 <= clean.length; index += 3) {
    protein += CODON_TABLE[clean.slice(index, index + 3)] || 'X';
  }
  return protein;
}

export function createSequenceViewerAgentApi(context = {}) {
  const getRecords = typeof context.getRecords === 'function' ? context.getRecords : () => [];
  const getSelectedIndex = typeof context.getSelectedIndex === 'function' ? context.getSelectedIndex : () => 0;
  const getActiveEntryId = typeof context.getActiveEntryId === 'function' ? context.getActiveEntryId : () => null;
  const getCloningDesignSource = typeof context.getCloningDesignSource === 'function'
    ? context.getCloningDesignSource
    : () => null;
  const createToken = typeof context.createToken === 'function'
    ? context.createToken
    : () => `seqedit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  function recordIdAt(record, index) {
    return String(record?.id || record?.recordId || `record_${index}`);
  }

  function resolveRecord(ref = {}) {
    const records = asArray(getRecords());
    const recordId = typeof ref === 'string' ? ref : (ref.recordId || ref.id || '');
    if (recordId) {
      const byId = records.findIndex((record, index) => recordIdAt(record, index) === String(recordId));
      if (byId >= 0) {
        return { record: records[byId], index: byId };
      }
    }
    const index = Number(ref?.recordIndex);
    if (Number.isFinite(index) && records[index]) {
      return { record: records[index], index };
    }
    return { record: null, index: -1 };
  }

  function buildTarget(record, index) {
    const sequence = normalizeSequenceText(record?.sequence || '');
    return {
      entryId: getActiveEntryId() || record?.entryId || null,
      recordId: recordIdAt(record, index),
      recordIndex: index,
      baseLength: sequence.length,
      baseDigest: sequenceDigest(sequence)
    };
  }

  // Re-verify a proposal's target at approval time. Never trusts the live
  // selection — resolves by id/index and requires digest + length to still match.
  function verifyTarget(target = {}) {
    const { record, index } = resolveRecord(target);
    if (!record) {
      return fail('TARGET_NOT_FOUND', 'The proposal target record is no longer loaded.');
    }
    const sequence = normalizeSequenceText(record.sequence || '');
    if (sequence.length !== Number(target.baseLength) || sequenceDigest(sequence) !== String(target.baseDigest)) {
      return fail('TARGET_CHANGED', 'The record changed since the proposal was made; re-read and re-propose.');
    }
    return { record, index };
  }

  function listRecords() {
    return {
      records: asArray(getRecords()).map((record, index) => ({
        id: recordIdAt(record, index),
        name: record?.name || `record ${index + 1}`,
        length: normalizeSequenceText(record?.sequence || '').length,
        topology: String(record?.topology || 'linear').toLowerCase() === 'circular' ? 'circular' : 'linear',
        featureCount: asArray(record?.features).length,
        selected: index === getSelectedIndex()
      }))
    };
  }

  function getFeatures(input = {}) {
    const { record } = resolveRecord(input);
    if (!record) {
      return fail('RECORD_NOT_FOUND', 'No record matches the requested id/index.');
    }
    const typeFilter = String(input.type || '').toLowerCase();
    const features = asArray(record.features)
      .map((feature, index) => ({
        id: feature?.id || `feature_${index}`,
        name: feature?.name || '',
        type: feature?.type || '',
        strand: Number(feature?.strand) || 0,
        segments: asArray(feature?.segments).map((segment) => ({
          start: Math.round(Number(segment?.start) || 0) + 1,
          end: Math.round(Number(segment?.end) || 0)
        }))
      }))
      .filter((feature) => !typeFilter || feature.type.toLowerCase() === typeFilter);
    return { features };
  }

  function getRecord(input = {}) {
    const { record, index } = resolveRecord(input);
    if (!record) {
      return fail('RECORD_NOT_FOUND', 'No record matches the requested id/index.');
    }
    const include = new Set(asArray(input.include).map((value) => String(value)));
    const sequence = normalizeSequenceText(record.sequence || '');
    const payload = {
      id: recordIdAt(record, index),
      name: record?.name || `record ${index + 1}`,
      length: sequence.length,
      topology: String(record?.topology || 'linear').toLowerCase() === 'circular' ? 'circular' : 'linear',
      hasQuality: typeof record?.quality === 'string' && record.quality.length > 0,
      target: buildTarget(record, index)
    };
    if (include.has('stats')) {
      payload.gcPercent = computeGcPercent(sequence);
    }
    if (include.has('features')) {
      payload.features = getFeatures(input).features;
    }
    if (include.has('sequence')) {
      if (sequence.length > MAX_SEQUENCE_WINDOW) {
        payload.sequenceTruncated = true;
        payload.sequence = sequence.slice(0, MAX_SEQUENCE_WINDOW);
      } else {
        payload.sequence = sequence;
      }
    }
    return payload;
  }

  function getSequence(input = {}) {
    const { record } = resolveRecord(input);
    if (!record) {
      return fail('RECORD_NOT_FOUND', 'No record matches the requested id/index.');
    }
    const sequence = normalizeSequenceText(record.sequence || '');
    const start = Math.round(Number(input.start));
    const end = Math.round(Number(input.end));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start || end > sequence.length) {
      return fail('RANGE_OUT_OF_BOUNDS', `start/end must be 1..${sequence.length} with start <= end.`);
    }
    if (end - start + 1 > MAX_SEQUENCE_WINDOW) {
      return fail('RANGE_OUT_OF_BOUNDS', `Window exceeds ${MAX_SEQUENCE_WINDOW} nt; read in slices.`);
    }
    const slice = sequence.slice(start - 1, end);
    return { start, end, length: slice.length, sequence: slice, gcPercent: computeGcPercent(slice) };
  }

  function analyze(input = {}) {
    const { record } = resolveRecord(input);
    if (!record) {
      return fail('RECORD_NOT_FOUND', 'No record matches the requested id/index.');
    }
    const sequence = normalizeSequenceText(record.sequence || '');
    const topology = String(record?.topology || 'linear').toLowerCase() === 'circular' ? 'circular' : 'linear';
    const kind = String(input.kind || '').toLowerCase();
    const hasRange = Number.isFinite(Number(input.start)) && Number.isFinite(Number(input.end));
    const start = hasRange ? clamp(Math.round(Number(input.start)) - 1, 0, sequence.length) : 0;
    const end = hasRange ? clamp(Math.round(Number(input.end)), start, sequence.length) : sequence.length;
    const region = sequence.slice(start, end);

    if (kind === 'gc') {
      return { kind, gcPercent: computeGcPercent(region), length: region.length };
    }
    if (kind === 'translation') {
      return { kind, frame: 1, protein: translate(region), length: region.length };
    }
    if (kind === 'restriction') {
      const sites = buildCommercialRestrictionFeatures(sequence, topology, {}).map((feature) => ({
        name: feature?.name || feature?.site,
        site: feature?.site || '',
        cut: feature?.cut || '',
        positions: asArray(feature?.segments).map((segment) => Math.round(Number(segment?.start) || 0) + 1)
      }));
      return { kind, sites };
    }
    if (kind === 'orf') {
      const orfs = asArray(buildOrfFeatures(sequence, topology, {})).map((feature) => ({
        name: feature?.name || 'ORF',
        strand: Number(feature?.strand) || 1,
        segments: asArray(feature?.segments).map((segment) => ({
          start: Math.round(Number(segment?.start) || 0) + 1,
          end: Math.round(Number(segment?.end) || 0)
        }))
      }));
      return { kind, orfs };
    }
    return fail('UNKNOWN_ANALYSIS', `Unknown analyze kind "${input.kind}".`);
  }

  // Build the edited sequence for a delta (1-based inclusive coords).
  function applyDelta(sequence, input = {}) {
    const mode = String(input.mode || '');
    const start = Math.round(Number(input.start));
    const end = input.mode === 'insert' ? start : Math.round(Number(input.end));
    const insert = mode === 'delete' ? '' : normalizeSequenceText(input.sequence || '');
    if (!Number.isFinite(start) || start < 1 || start > sequence.length + 1) {
      return { error: fail('RANGE_OUT_OF_BOUNDS', 'start is out of range.') };
    }
    if (mode !== 'insert' && (!Number.isFinite(end) || end < start || end > sequence.length)) {
      return { error: fail('RANGE_OUT_OF_BOUNDS', 'end is out of range.') };
    }
    if (mode !== 'delete' && !insert.length) {
      return { error: fail('EDIT_EMPTY_RESULT', 'Provide at least one base for insert/replace.') };
    }
    const next = mode === 'insert'
      ? `${sequence.slice(0, start - 1)}${insert}${sequence.slice(start - 1)}`
      : `${sequence.slice(0, start - 1)}${insert}${sequence.slice(end)}`;
    if (!next.length) {
      return { error: fail('EDIT_EMPTY_RESULT', 'The edit would empty the sequence.') };
    }
    return { next, start, end: mode === 'insert' ? start - 1 : end, insert };
  }

  function affectedFeatures(record, editStart, editEnd, delta) {
    return asArray(record?.features).map((feature, index) => {
      const segments = asArray(feature?.segments);
      const featureStart = segments.length ? Math.min(...segments.map((s) => Number(s.start) || 0)) : 0;
      const featureEnd = segments.length ? Math.max(...segments.map((s) => Number(s.end) || 0)) : 0;
      if (featureEnd <= editStart) {
        return null; // entirely upstream, unaffected
      }
      const overlaps = featureStart < editEnd && featureEnd > editStart;
      return { id: feature?.id || `feature_${index}`, name: feature?.name || '', shift: overlaps ? null : delta };
    }).filter(Boolean);
  }

  function proposeEdit(input = {}) {
    const { record, index } = resolveRecord(input.target || input);
    if (!record) {
      return fail('RECORD_NOT_FOUND', 'No record matches the proposal target.');
    }
    const sequence = normalizeSequenceText(record.sequence || '');
    const applied = applyDelta(sequence, input);
    if (applied.error) {
      return applied.error;
    }
    const { next, start, end, insert } = applied;
    const delta = next.length - sequence.length;
    const removed = sequence.slice(start - 1, end);
    const editStart0 = start - 1;
    const flankStart = Math.max(0, editStart0 - PREVIEW_FLANK);
    return {
      pending_approval: true,
      kind: 'edit',
      target: buildTarget(record, index),
      mode: input.mode,
      // Echo the raw request so the host can re-apply after approval (1-based).
      edit: {
        mode: input.mode,
        start,
        end: input.mode === 'insert' ? start : Math.round(Number(input.end)),
        sequence: input.mode === 'delete' ? '' : insert
      },
      summary: input.mode === 'delete'
        ? `Delete ${removed.length} bp at ${start}..${end}`
        : input.mode === 'insert'
          ? `Insert ${insert.length} bp at ${start}`
          : `Replace ${removed.length} bp (${removed || '-'}->${insert}) at ${start}..${end}`,
      preview: {
        before: `${sequence.slice(flankStart, editStart0)}|${removed}|${sequence.slice(end, end + PREVIEW_FLANK)}`,
        after: `${sequence.slice(flankStart, editStart0)}|${insert}|${sequence.slice(end, end + PREVIEW_FLANK)}`,
        newLength: next.length
      },
      affectedFeatures: affectedFeatures(record, editStart0, end, delta),
      approvalToken: createToken()
    };
  }

  function proposeAnnotation(input = {}) {
    const { record, index } = resolveRecord(input.target || input);
    if (!record) {
      return fail('RECORD_NOT_FOUND', 'No record matches the proposal target.');
    }
    const mode = String(input.mode || '');
    if (!['add', 'edit', 'delete'].includes(mode)) {
      return fail('UNKNOWN_ANNOTATION_MODE', `mode must be add|edit|delete, got "${input.mode}".`);
    }
    if (mode !== 'add') {
      const ref = input.featureRef || {};
      const matches = asArray(record.features).filter((feature, featureIndex) => (
        (ref.id && feature?.id === ref.id)
        || (Number.isFinite(Number(ref.index)) && Number(ref.index) === featureIndex)
        || (ref.name && feature?.name === ref.name)
      ));
      if (matches.length !== 1) {
        return fail('AMBIGUOUS_FEATURE', `featureRef matched ${matches.length} features; it must match exactly one.`);
      }
    }
    if (mode !== 'delete' && !asArray(input.segments).length) {
      return fail('RANGE_OUT_OF_BOUNDS', 'add/edit require at least one segment.');
    }
    return {
      pending_approval: true,
      kind: 'annotation',
      target: buildTarget(record, index),
      mode,
      summary: mode === 'delete'
        ? `Delete feature "${input.featureRef?.name || input.featureRef?.id || 'feature'}"`
        : `${mode === 'add' ? 'Add' : 'Edit'} feature "${input.name || ''}" (${input.type || 'misc_feature'})`,
      feature: {
        name: input.name || '',
        type: input.type || '',
        strand: Number(input.strand) || 0,
        description: input.description || '',
        segments: asArray(input.segments).map((segment) => ({
          start: Math.round(Number(segment?.start) || 0),
          end: Math.round(Number(segment?.end) || 0)
        }))
      },
      featureRef: input.featureRef || null,
      approvalToken: createToken()
    };
  }

  function designCloning(input = {}) {
    const { record } = resolveRecord(input);
    if (!record) {
      return fail('RECORD_NOT_FOUND', 'No record matches the requested id/index.');
    }
    const strategy = String(input.strategy || '');
    let source = getCloningDesignSource();
    // A hypothetical edit lets the agent explore routes without applying anything.
    if (input.edit && typeof input.edit === 'object') {
      const sequence = normalizeSequenceText(record.sequence || '');
      const applied = applyDelta(sequence, input.edit);
      if (applied.error) {
        return applied.error;
      }
      source = buildSequenceEditDesignSource({ record, originalSequence: sequence, nextSequence: applied.next });
    }
    if (!source?.editRequest) {
      return fail('NO_EDIT_CONTEXT', 'design_cloning needs a hypothetical `edit` or an active edited record.');
    }
    const designRecord = input.edit ? { ...record, sequence: source.editedSequence } : record;
    let range;
    if (INSERT_RANGE_STRATEGIES.has(strategy)) {
      if (!input.insertRange || typeof input.insertRange !== 'object') {
        return fail('INSERT_RANGE_REQUIRED', `design_cloning strategy "${strategy}" requires insertRange.start and insertRange.end.`);
      }
      const start = Number(input.insertRange.start);
      const end = Number(input.insertRange.end);
      const sequenceLength = normalizeSequenceText(designRecord.sequence || '').length;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > sequenceLength) {
        return fail('INVALID_INSERT_RANGE', `insertRange must be a 1-based inclusive range inside the ${sequenceLength}-base designed record.`);
      }
      range = { start: start - 1, end };
    }
    let donor = null;
    if (input.donorRecordId || Number.isFinite(Number(input.donorRecordIndex))) {
      const donorRef = {
        recordId: input.donorRecordId || '',
        recordIndex: input.donorRecordIndex
      };
      const resolvedDonor = resolveRecord(donorRef);
      if (!resolvedDonor.record) {
        return fail('DONOR_RECORD_NOT_FOUND', 'No loaded record matches donorRecordId/donorRecordIndex.');
      }
      donor = {
        id: recordIdAt(resolvedDonor.record, resolvedDonor.index),
        name: resolvedDonor.record?.name || `record ${resolvedDonor.index + 1}`,
        topology: String(resolvedDonor.record?.topology || 'linear').toLowerCase() === 'circular' ? 'circular' : 'linear',
        sequence: normalizeSequenceText(resolvedDonor.record?.sequence || '')
      };
    }
    return designCloningRoute({ strategy, source, record: designRecord, range, donor });
  }

  function getCloningDesign() {
    const source = getCloningDesignSource();
    if (!source?.editRequest) {
      return { hasDesign: false };
    }
    return {
      hasDesign: true,
      recordName: source.recordName,
      edit: source.editRequest,
      updatedAt: source.updatedAt || null
    };
  }

  return {
    listRecords,
    getRecord,
    getSequence,
    getFeatures,
    analyze,
    designCloning,
    getCloningDesign,
    proposeEdit,
    proposeAnnotation,
    verifyTarget
  };
}
