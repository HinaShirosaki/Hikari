import { cleanProteinSequence } from './sequence.js';

export const PROTEIN_ASSEMBLY_PART_TYPES = Object.freeze([
  { id: 'tag', label: 'Tag' },
  { id: 'linker', label: 'Linker' },
  { id: 'cleavage', label: 'Cleavage Site' },
  { id: 'poi', label: 'Protein of Interest' },
  { id: 'custom', label: 'Custom' }
]);

export const PROTEIN_ASSEMBLY_TAGS = Object.freeze([
  {
    id: 'his6',
    label: '6xHis',
    sequence: 'HHHHHH',
    note: 'Classic IMAC affinity tag.'
  },
  {
    id: 'his8',
    label: '8xHis',
    sequence: 'HHHHHHHH',
    note: 'Higher-affinity His-tag variant.'
  },
  {
    id: 'flag',
    label: 'FLAG',
    sequence: 'DYKDDDDK',
    note: 'Common epitope tag for detection/purification.'
  },
  {
    id: 'ha',
    label: 'HA',
    sequence: 'YPYDVPDYA',
    note: 'Hemagglutinin epitope tag.'
  },
  {
    id: 'myc',
    label: 'c-Myc',
    sequence: 'EQKLISEEDL',
    note: 'Small c-Myc epitope tag.'
  },
  {
    id: 'strep2',
    label: 'Strep-II',
    sequence: 'WSHPQFEK',
    note: 'Strep-Tactin affinity tag.'
  },
  {
    id: 'twin_strep',
    label: 'Twin-Strep',
    sequence: 'WSHPQFEKGGGSGGGSGGSAWSHPQFEK',
    note: 'High-affinity tandem Strep-II tag.'
  },
  {
    id: 'v5',
    label: 'V5',
    sequence: 'GKPIPNPLLGLDST',
    note: 'Short V5 epitope tag.'
  },
  {
    id: 'avitag',
    label: 'AviTag',
    sequence: 'GLNDIFEAQKIEWHE',
    note: 'Biotin ligase recognition tag.'
  },
  {
    id: 'alfa',
    label: 'ALFA',
    sequence: 'PSRLEEELRRRLTEP',
    note: 'Compact nanobody-compatible epitope tag.'
  },
  {
    id: 'spytag',
    label: 'SpyTag',
    sequence: 'AHIVMVDAYKPTK',
    note: 'Covalent ligation peptide tag.'
  },
  {
    id: 'stag',
    label: 'S-tag',
    sequence: 'KETAAAKFERQHMDS',
    note: 'RNase S-protein binding peptide tag.'
  },
  {
    id: 'ctag',
    label: 'C-tag',
    sequence: 'EPEA',
    note: 'Minimal four-residue C-terminal tag.'
  }
]);

export const PROTEIN_ASSEMBLY_LINKERS = Object.freeze([
  {
    id: 'ggs',
    label: 'GGS',
    sequence: 'GGS',
    note: 'Very short flexible linker.'
  },
  {
    id: 'g4s',
    label: '(GGGGS)1',
    sequence: 'GGGGS',
    note: 'Standard flexible linker.'
  },
  {
    id: 'g4s2',
    label: '(GGGGS)2',
    sequence: 'GGGGSGGGGS',
    note: 'Flexible linker for multi-domain fusions.'
  },
  {
    id: 'g4s3',
    label: '(GGGGS)3',
    sequence: 'GGGGSGGGGSGGGGS',
    note: 'Long flexible linker.'
  },
  {
    id: 'eaaak',
    label: '(EAAAK)1',
    sequence: 'EAAAK',
    note: 'Short rigid alpha-helical linker.'
  },
  {
    id: 'eaaak2',
    label: '(EAAAK)2',
    sequence: 'EAAAKEAAAK',
    note: 'Rigid linker for domain separation.'
  },
  {
    id: 'gpgpg',
    label: 'GPGPG',
    sequence: 'GPGPG',
    note: 'Hinge-like linker with proline.'
  }
]);

export const PROTEIN_ASSEMBLY_CLEAVAGE_SITES = Object.freeze([
  {
    id: 'tev',
    label: 'TEV protease',
    sequence: 'ENLYFQG',
    note: 'Canonical TEV site (cleaves between Q|G).'
  },
  {
    id: 'prescission',
    label: 'PreScission / HRV 3C',
    sequence: 'LEVLFQGP',
    note: 'HRV 3C protease site (cleaves between Q|G).'
  },
  {
    id: 'thrombin',
    label: 'Thrombin',
    sequence: 'LVPRGS',
    note: 'Thrombin cleavage motif.'
  },
  {
    id: 'enterokinase',
    label: 'Enterokinase',
    sequence: 'DDDDK',
    note: 'Enterokinase cleavage motif.'
  },
  {
    id: 'factorxa',
    label: 'Factor Xa',
    sequence: 'IEGR',
    note: 'Factor Xa cleavage motif.'
  }
]);

export const PROTEIN_ASSEMBLY_LIBRARY = Object.freeze({
  tag: PROTEIN_ASSEMBLY_TAGS,
  linker: PROTEIN_ASSEMBLY_LINKERS,
  cleavage: PROTEIN_ASSEMBLY_CLEAVAGE_SITES
});

const PROTEIN_ASSEMBLY_PART_TYPE_LABELS = Object.freeze(
  PROTEIN_ASSEMBLY_PART_TYPES.reduce((acc, item) => {
    acc[item.id] = item.label;
    return acc;
  }, {})
);

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
