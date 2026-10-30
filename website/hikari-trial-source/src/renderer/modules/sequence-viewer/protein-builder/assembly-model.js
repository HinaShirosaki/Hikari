import { cleanProteinSequence } from '../calculations/sequence.js';
import { PROTEIN_ASSEMBLY_LIBRARY, PROTEIN_ASSEMBLY_PART_TYPES, PROTEIN_ASSEMBLY_PART_TYPE_LABELS } from './assembly-library/part-catalog.js';

export function getProteinAssemblyTypeLabel(type) {
  return PROTEIN_ASSEMBLY_PART_TYPE_LABELS[type] || 'Custom';
}

export function getProteinAssemblyLibraryByType(type) {
  return PROTEIN_ASSEMBLY_LIBRARY[type] || [];
}

export function sanitizeProteinAssemblySequence(raw, allowStop = true) {
  const cleaned = cleanProteinSequence(raw, allowStop);
  if (!allowStop) {
    return cleaned;
  }
  return cleaned.replace(/\*{2,}/g, '*');
}

function normalizePartType(rawType) {
  const type = String(rawType || '').trim().toLowerCase();
  if (PROTEIN_ASSEMBLY_PART_TYPES.some((item) => item.id === type)) {
    return type;
  }
  return 'custom';
}

function resolveLibraryPart(type, libraryId) {
  const library = getProteinAssemblyLibraryByType(type);
  if (!library.length) {
    return null;
  }
  const normalizedId = String(libraryId || '').trim();
  if (!normalizedId) {
    return library[0];
  }
  return library.find((item) => item.id === normalizedId) || null;
}

export function defaultProteinAssemblyRows() {
  return [
    { type: 'tag', libraryId: 'his6' },
    { type: 'cleavage', libraryId: 'tev' },
    { type: 'poi' }
  ];
}

function hasPoiInRows(rows) {
  return rows.some((row) => normalizePartType(row.type) === 'poi');
}

export function buildProteinAssemblyConstruct(payload = {}) {
  const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = rawRows.length ? rawRows : defaultProteinAssemblyRows();
  const constructName = String(payload.constructName || '').trim();
  const poiName = String(payload.poiName || '').trim();
  const poiSequence = sanitizeProteinAssemblySequence(payload.poiSequence || '', true);

  const errors = [];
  const warnings = [];
  const parts = [];
  let hasPoi = false;
  let missingPoiSequence = false;

  rows.forEach((row, index) => {
    const type = normalizePartType(row.type);

    if (type === 'poi') {
      hasPoi = true;
      if (!poiSequence.length) {
        missingPoiSequence = true;
        return;
      }
      parts.push({
        index: index + 1,
        type,
        typeLabel: getProteinAssemblyTypeLabel(type),
        id: 'poi',
        label: poiName || 'Protein of Interest',
        sequence: poiSequence,
        note: 'User-supplied POI sequence'
      });
      return;
    }

    if (type === 'custom') {
      const customLabel = String(row.customLabel || '').trim() || `Custom Part ${index + 1}`;
      const customSequence = sanitizeProteinAssemblySequence(row.customSequence || '', true);
      if (!customSequence.length) {
        errors.push(`Row ${index + 1}: custom sequence is empty.`);
        return;
      }
      parts.push({
        index: index + 1,
        type,
        typeLabel: getProteinAssemblyTypeLabel(type),
        id: `custom-${index + 1}`,
        label: customLabel,
        sequence: customSequence,
        note: 'User-defined sequence'
      });
      return;
    }

    const libraryPart = resolveLibraryPart(type, row.libraryId);
    if (!libraryPart) {
      errors.push(`Row ${index + 1}: library item is missing for ${type}.`);
      return;
    }
    parts.push({
      index: index + 1,
      type,
      typeLabel: getProteinAssemblyTypeLabel(type),
      id: libraryPart.id,
      label: libraryPart.label,
      sequence: libraryPart.sequence,
      note: libraryPart.note || ''
    });
  });

  if (!hasPoiInRows(rows)) {
    warnings.push('No explicit POI block was added. Add a "Protein of Interest" block to include your POI sequence.');
  }

  if (missingPoiSequence) {
    warnings.push('POI block exists, but POI sequence is empty.');
  }

  if (!hasPoi && poiSequence.length) {
    warnings.push('POI sequence is provided but no POI block is in the assembly order.');
  }

  let cursor = 1;
  const partMap = parts.map((part) => {
    const start = cursor;
    const end = cursor + part.sequence.length - 1;
    cursor = end + 1;
    return {
      ...part,
      length: part.sequence.length,
      start,
      end
    };
  });

  const sequence = partMap.map((part) => part.sequence).join('');
  const length = sequence.length;

  if (sequence.includes('*')) {
    if (sequence.endsWith('*') && sequence.indexOf('*') === sequence.length - 1) {
      warnings.push('Construct ends with a stop symbol (*).');
    } else {
      warnings.push('Construct contains an internal stop symbol (*). Translation would terminate early.');
    }
  }
  if (length > 0 && sequence[0] !== 'M') {
    warnings.push('Construct does not start with M. Confirm N-terminus design for expression.');
  }
  if (length > 2500) {
    warnings.push('Construct is very long (>2500 aa). Verify cloning and expression feasibility.');
  }

  return {
    ok: length > 0 && errors.length === 0 && !missingPoiSequence,
    constructName: constructName || 'Untitled construct',
    poiName: poiName || 'Protein of Interest',
    hasPoi,
    rows,
    parts: partMap,
    sequence,
    length,
    errors,
    warnings
  };
}

export {
  PROTEIN_ASSEMBLY_PART_TYPES,
  PROTEIN_ASSEMBLY_TAGS,
  PROTEIN_ASSEMBLY_LINKERS,
  PROTEIN_ASSEMBLY_SELF_CLEAVING,
  PROTEIN_ASSEMBLY_CLEAVAGE_SITES,
  PROTEIN_ASSEMBLY_LIBRARY
} from './assembly-library/part-catalog.js';
