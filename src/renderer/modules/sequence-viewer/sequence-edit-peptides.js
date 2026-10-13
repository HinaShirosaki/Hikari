import { reverseComplementDna, reverseTranslateProteinSequence } from './calculations/sequence.js';
import { normalizeFeatureType } from './feature-types.js';
import { getOrfFeaturesForRecord } from './orf-analysis.js';
import {
  PROTEIN_ASSEMBLY_CLEAVAGE_SITES,
  PROTEIN_ASSEMBLY_LINKERS,
  PROTEIN_ASSEMBLY_TAGS
} from './protein-builder/assembly-library/part-catalog.js';
import { normalizeRecordSegments } from './protein-builder/segments.js';

export const PEPTIDE_INSERT_GROUPS = Object.freeze([
  { id: 'tag', label: 'Peptide tags', items: PROTEIN_ASSEMBLY_TAGS },
  { id: 'linker', label: 'Linkers', items: PROTEIN_ASSEMBLY_LINKERS },
  { id: 'cleavage', label: 'Protease cleavage sites', items: PROTEIN_ASSEMBLY_CLEAVAGE_SITES }
]);

function isCodingFeature(feature) {
  return ['cds', 'orf', 'open_reading_frame'].includes(normalizeFeatureType(feature?.type, ''))
    || Boolean(feature?.translation || feature?.proteinSequence);
}

// Count from the coding 5' end, keeping recorded segment order across joins and
// the circular origin. A boundary at either end of a segment is also usable.
export function getCodingOffsetAtBoundary(record, feature, boundary) {
  const length = String(record?.sequence || '').length;
  const segments = normalizeRecordSegments(feature?.segments, length);
  const reverse = Number(feature?.strand) === -1;
  const ordered = reverse ? [...segments].reverse() : segments;
  const boundaries = record?.topology === 'circular' && (boundary === 0 || boundary === length)
    ? [boundary, boundary === 0 ? length : 0]
    : [boundary];
  let offset = 0;
  for (const segment of ordered) {
    for (const at of boundaries) {
      if (at >= segment.start && at <= segment.end) {
        return offset + (reverse ? segment.end - at : at - segment.start);
      }
    }
    offset += segment.end - segment.start;
  }
  return null;
}

export function getInsertionCodingFeatures(record, boundary, selectedFeature = null, visibleFeatures = []) {
  const candidates = [selectedFeature, ...(record?.features || []), ...visibleFeatures];
  const seen = new Set();
  const collect = (features) => features.filter((feature) => {
    if (!isCodingFeature(feature) || getCodingOffsetAtBoundary(record, feature, boundary) === null) return false;
    const key = `${Number(feature.strand) === -1 ? -1 : 1}|${JSON.stringify(feature.segments)}|${feature?.qualifiers?.codon_start || 1}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const annotated = collect(candidates);
  return annotated.length ? annotated : collect(getOrfFeaturesForRecord(record));
}

export function buildPeptideInsertDna(partKey, referenceStrand = 1, orientation = 'along') {
  const [type, id] = String(partKey || '').split(':');
  const part = PEPTIDE_INSERT_GROUPS.find((group) => group.id === type)?.items.find((item) => item.id === id);
  if (!part) return null;
  const translated = reverseTranslateProteinSequence(part.sequence);
  if (!translated?.ok || !translated.dna) return null;
  const strand = (Number(referenceStrand) === -1 ? -1 : 1) * (orientation === 'reverse' ? -1 : 1);
  return { part, type, strand, sequence: strand === -1 ? reverseComplementDna(translated.dna) : translated.dna };
}
