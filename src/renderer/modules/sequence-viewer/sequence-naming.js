import { translateDnaCodon } from './calculations/sequence.js';
import { normalizeFeatureType } from './feature-types.js';
import {
  cleanText,
  normalizeRecordName,
  normalizeSequenceText,
  reverseComplementIupac
} from './shared.js';
import { asArray } from '../../lib/normalize.js';

const CODING_FEATURE_TYPES = new Set(['cds', 'gene', 'open_reading_frame']);
const CONSTRUCT_SEPARATOR = ' · ';
const PROTEIN_PART_SEPARATOR = '–';
const PROTEIN_VARIANT_PATTERN = '(?:[A-Z*]\\d+(?:[A-Z*=*]|fs|del)|[A-Z*]\\d+_[A-Z*]\\d+(?:del|ins[A-Z*]+))(?:\\/(?:[A-Z*]\\d+(?:[A-Z*=*]|fs|del)|[A-Z*]\\d+_[A-Z*]\\d+(?:del|ins[A-Z*]+)))*';

function featureSegments(feature) {
  return asArray(feature?.segments)
    .map((segment) => ({
      start: Math.max(0, Math.round(Number(segment?.start) || 0)),
      end: Math.max(0, Math.round(Number(segment?.end) || 0))
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start);
}

function codingFeatureEntries(record) {
  return asArray(record?.features)
    .map((feature) => ({ feature, segments: featureSegments(feature) }))
    .filter(({ feature, segments }) => (
      segments.length
      && CODING_FEATURE_TYPES.has(normalizeFeatureType(feature?.type, ''))
    ));
}

// Prefer the most specific coding annotation when a CDS is nested in a gene.
function findCodingFeatureAt(record, index) {
  return codingFeatureEntries(record)
    .filter(({ segments }) => segments.some((segment) => index >= segment.start && index < segment.end))
    .sort((left, right) => (
      left.segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0)
      - right.segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0)
    ))[0] || null;
}

function codingSequenceOf(sequence, segments, strand) {
  const joined = segments.map((segment) => sequence.slice(segment.start, segment.end)).join('');
  return strand === -1 ? reverseComplementIupac(joined) : joined;
}

// Position of a genomic index along the spliced coding strand.
function codingIndexOf(segments, strand, index) {
  let seen = 0;
  let found = -1;
  segments.forEach((segment) => {
    if (index >= segment.start && index < segment.end) {
      found = seen + (index - segment.start);
    }
    seen += segment.end - segment.start;
  });
  if (found < 0) {
    return -1;
  }
  return strand === -1 ? seen - 1 - found : found;
}

function cleanName(value, fallback = 'sequence') {
  return normalizeRecordName(value, fallback);
}

function normalizedIdentity(value) {
  return cleanText(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function nameContainsTarget(name, target) {
  const normalizedName = normalizedIdentity(name);
  const normalizedTarget = normalizedIdentity(target);
  return Boolean(normalizedName && normalizedTarget && normalizedName.includes(normalizedTarget));
}

function joinVariantName(baseName, groups) {
  const base = cleanName(baseName, 'sequence');
  const usable = asArray(groups).filter((group) => cleanText(group?.mutation, 120));
  if (!usable.length) {
    return base;
  }
  if (usable.length === 1) {
    const group = usable[0];
    const target = cleanText(group?.target, 120);
    return cleanName(
      target && !nameContainsTarget(base, target)
        ? `${base}${CONSTRUCT_SEPARATOR}${target} ${group.mutation}`
        : `${base} ${group.mutation}`,
      base
    );
  }
  const suffix = usable
    .map((group) => {
      const target = cleanText(group?.target, 120);
      return target ? `${target}(${group.mutation})` : group.mutation;
    })
    .join(' + ');
  return cleanName(`${base}${CONSTRUCT_SEPARATOR}${suffix}`, base);
}

function translateCodons(sequence) {
  const protein = [];
  for (let index = 0; index + 2 < sequence.length; index += 3) {
    protein.push(translateDnaCodon(sequence.slice(index, index + 3)) || '');
  }
  return protein;
}

function formatProteinPartLabel(part = {}) {
  const type = cleanText(part?.type, 40).toLowerCase();
  const rawLabel = cleanText(part?.label || part?.name, 160).trim();
  const label = type === 'cleavage' ? rawLabel.replace(/\s+protease$/i, '') : rawLabel;
  const match = label.match(new RegExp(`^(.+?)\\s+(${PROTEIN_VARIANT_PATTERN})$`));
  return match ? `${match[1]}(${match[2]})` : label;
}

export function buildProteinTargetLabel({ recordName, targetName } = {}) {
  const target = cleanText(targetName, 140).trim();
  const record = cleanText(recordName, 160).trim();
  if (!target || !record) {
    return target || record;
  }
  const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = record.match(new RegExp(`${escapedTarget}\\s+(${PROTEIN_VARIANT_PATTERN})$`));
  return match ? `${target} ${match[1]}` : target;
}

function changedIndexes(original, edited) {
  if (!original.length || original.length !== edited.length) {
    return [];
  }
  const indexes = [];
  for (let index = 0; index < original.length; index += 1) {
    if (original[index] !== edited[index]) {
      indexes.push(index);
    }
  }
  return indexes;
}

function describeEqualLengthChanges(record, original, edited) {
  const changes = changedIndexes(original, edited);
  const codingGroups = [];
  const assignedIndexes = new Set();
  const seenFeatures = new Set();

  changes.forEach((index) => {
    const coding = findCodingFeatureAt(record, index);
    if (!coding || seenFeatures.has(coding.feature)) {
      return;
    }
    seenFeatures.add(coding.feature);
    const strand = Number(coding.feature?.strand) === -1 ? -1 : 1;
    const originalCoding = codingSequenceOf(original, coding.segments, strand);
    const editedCoding = codingSequenceOf(edited, coding.segments, strand);
    if (originalCoding.length !== editedCoding.length) {
      return;
    }
    const originalProtein = translateCodons(originalCoding);
    const editedProtein = translateCodons(editedCoding);
    const variants = [];
    for (let residue = 0; residue < Math.min(originalProtein.length, editedProtein.length); residue += 1) {
      const wild = originalProtein[residue];
      const next = editedProtein[residue];
      const originalCodon = originalCoding.slice(residue * 3, residue * 3 + 3);
      const editedCodon = editedCoding.slice(residue * 3, residue * 3 + 3);
      if (!wild || !next || originalCodon === editedCodon) {
        continue;
      }
      variants.push(`${wild}${residue + 1}${wild === next ? '=' : next}`);
    }
    if (!variants.length) {
      return;
    }
    coding.segments.forEach((segment) => {
      changes.forEach((index) => {
        if (index >= segment.start && index < segment.end) {
          assignedIndexes.add(index);
        }
      });
    });
    codingGroups.push({
      target: cleanText(coding.feature?.name, 120) || cleanText(record?.name, 120),
      mutation: variants.join('/')
    });
  });

  const nucleotideVariants = changes
    .filter((index) => !assignedIndexes.has(index))
    .slice(0, 4)
    .map((index) => `g.${index + 1}${original[index]}>${edited[index]}`);
  if (nucleotideVariants.length) {
    codingGroups.push({ target: '', mutation: nucleotideVariants.join('/') });
  }
  return codingGroups;
}

function insertionProteinToken(originalCoding, codingIndex, insertedSequence) {
  if (codingIndex < 0 || codingIndex % 3 !== 0 || insertedSequence.length % 3 !== 0) {
    return '';
  }
  const inserted = translateCodons(insertedSequence).join('');
  if (!inserted) {
    return '';
  }
  const leftResidue = Math.max(0, Math.floor(codingIndex / 3) - 1);
  const rightResidue = Math.min(Math.floor(originalCoding.length / 3) - 1, Math.floor(codingIndex / 3));
  const left = translateDnaCodon(originalCoding.slice(leftResidue * 3, leftResidue * 3 + 3));
  const right = translateDnaCodon(originalCoding.slice(rightResidue * 3, rightResidue * 3 + 3));
  if (!left || !right) {
    return '';
  }
  return `${left}${leftResidue + 1}_${right}${rightResidue + 1}ins${inserted}`;
}

function deletionProteinToken(originalCoding, codingIndex, deletedSequence) {
  if (codingIndex < 0 || codingIndex % 3 !== 0 || deletedSequence.length % 3 !== 0) {
    return '';
  }
  const deleted = translateCodons(deletedSequence);
  if (!deleted.length || deleted.some((residue) => !residue)) {
    return '';
  }
  const firstPosition = Math.floor(codingIndex / 3) + 1;
  const lastPosition = firstPosition + deleted.length - 1;
  return deleted.length === 1
    ? `${deleted[0]}${firstPosition}del`
    : `${deleted[0]}${firstPosition}_${deleted.at(-1)}${lastPosition}del`;
}

function describeLengthChange(record, original, editRequest = {}) {
  const start = Math.max(0, Math.round(Number(editRequest?.start) || 1) - 1);
  const originalEdit = normalizeSequenceText(editRequest?.originalSequence || '');
  const editedEdit = normalizeSequenceText(editRequest?.editedSequence || '');
  const coding = findCodingFeatureAt(record, Math.min(start, Math.max(0, original.length - 1)));
  const delta = editedEdit.length - originalEdit.length;
  if (coding) {
    const strand = Number(coding.feature?.strand) === -1 ? -1 : 1;
    const anchorIndex = strand === -1 && originalEdit.length
      ? start + originalEdit.length - 1
      : start;
    let codingIndex = codingIndexOf(
      coding.segments,
      strand,
      Math.min(anchorIndex, Math.max(0, original.length - 1))
    );
    if (strand === -1 && !originalEdit.length && codingIndex >= 0) {
      codingIndex += 1;
    }
    const originalCoding = codingSequenceOf(original, coding.segments, strand);
    const originalCodingEdit = strand === -1 ? reverseComplementIupac(originalEdit) : originalEdit;
    const editedCodingEdit = strand === -1 ? reverseComplementIupac(editedEdit) : editedEdit;
    let mutation = '';
    if (delta % 3 !== 0) {
      const residue = Math.max(0, Math.floor(codingIndex / 3));
      const wild = translateDnaCodon(originalCoding.slice(residue * 3, residue * 3 + 3)) || 'X';
      mutation = `${wild}${residue + 1}fs`;
    } else if (!editedEdit.length && originalEdit.length) {
      mutation = deletionProteinToken(originalCoding, codingIndex, originalCodingEdit);
    } else if (!originalEdit.length && editedEdit.length) {
      mutation = insertionProteinToken(originalCoding, codingIndex, editedCodingEdit);
    }
    if (mutation) {
      return [{
        target: cleanText(coding.feature?.name, 120) || cleanText(record?.name, 120),
        mutation
      }];
    }
  }

  if (!originalEdit.length && editedEdit.length) {
    return [{ target: '', mutation: `g.${start}_${start + 1}ins${editedEdit.length <= 12 ? editedEdit : `${editedEdit.length}bp`}` }];
  }
  if (originalEdit.length && !editedEdit.length) {
    const end = start + originalEdit.length;
    return [{ target: '', mutation: originalEdit.length === 1 ? `g.${start + 1}del` : `g.${start + 1}_${end}del` }];
  }
  return [{ target: '', mutation: `g.${start + 1}delins${editedEdit.length <= 12 ? editedEdit : `${editedEdit.length}bp`}` }];
}

export function describeSequenceChanges({ record, originalSequence, editedSequence, editRequest } = {}) {
  const original = normalizeSequenceText(originalSequence || '');
  const edited = normalizeSequenceText(editedSequence || record?.sequence || '');
  if (!original.length || !edited.length || original === edited) {
    return [];
  }
  if (original.length === edited.length) {
    return describeEqualLengthChanges(record, original, edited);
  }
  return describeLengthChange(record, original, editRequest);
}

export function buildEditedSequenceName({ record, baseName, originalSequence, editedSequence, editRequest } = {}) {
  const base = cleanName(baseName || record?.name || 'sequence', 'sequence');
  return joinVariantName(base, describeSequenceChanges({
    record,
    originalSequence,
    editedSequence,
    editRequest
  }));
}

export function buildProteinArchitectureName({ parts, fallback = 'Protein construct' } = {}) {
  const labels = asArray(parts)
    .map((part) => formatProteinPartLabel(part))
    .filter(Boolean);
  return cleanName(labels.join(PROTEIN_PART_SEPARATOR), fallback);
}

export function resolveVectorBackboneName(record = {}, fallback = 'Vector') {
  const featureName = asArray(record?.features)
    .find((feature) => normalizeFeatureType(feature?.type, '') === 'backbone')?.name;
  const rawFeatureName = cleanText(featureName, 160);
  const parenthesized = rawFeatureName.match(/^Backbone\s*\((.+)\)$/i)?.[1];
  if (parenthesized) {
    return cleanName(parenthesized, fallback);
  }
  const recordName = cleanText(record?.name, 160);
  if (recordName.includes(CONSTRUCT_SEPARATOR)) {
    return cleanName(recordName.split(CONSTRUCT_SEPARATOR)[0], fallback);
  }
  return cleanName(recordName || rawFeatureName, fallback);
}

export function buildVectorSequenceName({ backboneName, payloadName, fallback = 'Vector construct' } = {}) {
  const backbone = cleanText(backboneName, 160).trim();
  const payload = cleanText(payloadName, 160).trim();
  if (!backbone) {
    return cleanName(payload, fallback);
  }
  if (!payload || normalizedIdentity(backbone) === normalizedIdentity(payload)) {
    return cleanName(backbone, fallback);
  }
  return cleanName(`${backbone}${CONSTRUCT_SEPARATOR}${payload}`, fallback);
}

// Kept as the compact, single-edit descriptor used by primer labels.
export function describeEditTarget({ record, originalSequence, editRequest } = {}) {
  const edited = normalizeSequenceText(record?.sequence || '');
  const original = normalizeSequenceText(originalSequence || '');
  const start = Math.max(0, Math.round(Number(editRequest?.start) || 1) - 1);
  const originalEdit = normalizeSequenceText(editRequest?.originalSequence || '');
  const editedEdit = normalizeSequenceText(editRequest?.editedSequence || '');
  const coding = findCodingFeatureAt(record, start);
  const gene = cleanText(coding?.feature?.name, 60) || cleanText(record?.name, 60);

  if (!edited.length || originalEdit.length !== editedEdit.length) {
    const delta = Math.abs(editedEdit.length - originalEdit.length);
    const change = editedEdit.length > originalEdit.length ? `ins${delta}` : `del${delta}`;
    return { gene, mutation: delta ? change : '' };
  }

  const nucleotideChange = original.length === edited.length && original[start] && edited[start]
    ? `${original[start]}${start + 1}${edited[start]}`
    : '';
  if (!coding) {
    return { gene, mutation: nucleotideChange };
  }

  const strand = Number(coding.feature?.strand) === -1 ? -1 : 1;
  const codingIndex = codingIndexOf(coding.segments, strand, start);
  if (codingIndex < 0) {
    return { gene, mutation: nucleotideChange };
  }

  const residue = Math.floor(codingIndex / 3);
  const codonAt = (sequence) => codingSequenceOf(sequence, coding.segments, strand)
    .slice(residue * 3, residue * 3 + 3);
  const wild = translateDnaCodon(codonAt(original));
  const mutant = translateDnaCodon(codonAt(edited));
  if (!wild || !mutant || wild === mutant) {
    return { gene, mutation: nucleotideChange };
  }
  return { gene, mutation: `${wild}${residue + 1}${mutant}` };
}
