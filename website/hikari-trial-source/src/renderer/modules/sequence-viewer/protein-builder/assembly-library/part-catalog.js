const PROTEIN_ASSEMBLY_PART_TYPES = Object.freeze([
  { id: 'tag', label: 'Tag' },
  { id: 'linker', label: 'Linker' },
  { id: 'cleavage', label: 'Cleavage Site' },
  { id: 'poi', label: 'Protein of Interest' },
  { id: 'custom', label: 'Custom' }
]);

const PROTEIN_ASSEMBLY_TAGS = Object.freeze([
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
  },
  {
    id: 'his10',
    label: '10xHis',
    sequence: 'HHHHHHHHHH',
    note: 'Extended His-tag for difficult IMAC purifications.'
  },
  {
    id: 'flag3x',
    label: '3xFLAG',
    sequence: 'DYKDHDGDYKDHDIDYKDDDDK',
    note: 'Tandem FLAG for low-abundance detection.'
  },
  {
    id: 't7tag',
    label: 'T7-tag',
    sequence: 'MASMTGGQQMG',
    note: 'T7 gene10 leader epitope; N-terminal use.'
  },
  {
    id: 'strep1',
    label: 'Strep-tag I',
    sequence: 'AWRHPQFGG',
    note: 'Original streptavidin-binding tag.'
  },
  {
    id: 'xpress',
    label: 'Xpress',
    sequence: 'DLYDDDDK',
    note: 'Epitope tag with a built-in enterokinase site.'
  },
  {
    id: 'vsvg',
    label: 'VSV-G',
    sequence: 'YTDIEMNRLGK',
    note: 'Vesicular stomatitis virus G epitope.'
  },
  {
    id: 'glu_glu',
    label: 'Glu-Glu (EE)',
    sequence: 'EYMPME',
    note: 'Compact polyoma middle-T epitope.'
  },
  {
    id: 'spot',
    label: 'Spot-Tag',
    sequence: 'PDRVRAVSHWSS',
    note: 'Short nanobody-detected epitope.'
  },
  {
    id: 'hibit',
    label: 'HiBiT',
    sequence: 'VSGWRLFKKIS',
    note: 'Split-luciferase peptide for luminescent quantitation.'
  },
  {
    id: 'rho1d4',
    label: 'Rho1D4',
    sequence: 'TETSQVAPA',
    note: 'Rhodopsin C-terminal tag for membrane proteins.'
  },
  {
    id: 'spytag003',
    label: 'SpyTag003',
    sequence: 'RGVPHIVMVDAYKRYK',
    note: 'Faster SpyCatcher003 partner for covalent conjugation.'
  },
  {
    id: 'snooptag',
    label: 'SnoopTag',
    sequence: 'KLGDIEFIKVNK',
    note: 'SnoopCatcher partner; orthogonal to SpyTag.'
  }
]);

const PROTEIN_ASSEMBLY_LINKERS = Object.freeze([
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
  },
  {
    id: 'gs',
    label: 'GS',
    sequence: 'GS',
    note: 'Minimal two-residue spacer.'
  },
  {
    id: 'ggs3',
    label: '(GGS)3',
    sequence: 'GGSGGSGGS',
    note: 'Short flexible repeat.'
  },
  {
    id: 'g4s4',
    label: '(GGGGS)4',
    sequence: 'GGGGSGGGGSGGGGSGGGGS',
    note: 'Long flexible linker for well-separated domains.'
  },
  {
    id: 'eaaak3',
    label: '(EAAAK)3',
    sequence: 'EAAAKEAAAKEAAAK',
    note: 'Rigid helical linker; keeps domains apart.'
  },
  {
    id: 'xten16',
    label: 'XTEN16',
    sequence: 'SGSETPGTSESATPES',
    note: 'Unstructured XTEN spacer; protease resistant.'
  },
  {
    id: 'papap',
    label: 'PAPAP',
    sequence: 'PAPAP',
    note: 'Proline-rich rigid linker.'
  }
]);

// Ribosome-skipping "self-cleaving" 2A peptides. The skip happens between the
// final Gly and Pro, so the upstream product keeps the 2A minus that proline and
// the downstream product starts with one. Each carries the GSG spacer that most
// vectors include -- it raises skipping efficiency -- so the listed length is
// three residues longer than the bare 2A.
const PROTEIN_ASSEMBLY_SELF_CLEAVING = Object.freeze([
  {
    id: 'p2a',
    label: 'P2A',
    sequence: 'GSGATNFSLLKQAGDVEENPGP',
    note: 'GSG-P2A (porcine teschovirus-1); typically the highest skipping efficiency.'
  },
  {
    id: 't2a',
    label: 'T2A',
    sequence: 'GSGEGRGSLLTCGDVEENPGP',
    note: 'GSG-T2A (Thosea asigna virus); shortest of the common set.'
  },
  {
    id: 'e2a',
    label: 'E2A',
    sequence: 'GSGQCTNYALLKLAGDVESNPGP',
    note: 'GSG-E2A (equine rhinitis A virus).'
  },
  {
    id: 'f2a',
    label: 'F2A',
    sequence: 'GSGVKQTLNFDLLKLAGDVESNPGP',
    note: 'GSG-F2A (foot-and-mouth disease virus).'
  }
]);

const PROTEIN_ASSEMBLY_CLEAVAGE_SITES = Object.freeze([
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
  },
  {
    id: 'tev_s',
    label: 'TEV (ENLYFQ/S)',
    sequence: 'ENLYFQS',
    note: 'TEV variant leaving a serine instead of glycine.'
  },
  {
    id: 'tvmv',
    label: 'TVMV protease',
    sequence: 'ETVRFQS',
    note: 'Orthogonal to TEV; useful for tandem tag removal.'
  },
  {
    id: 'sortase_a',
    label: 'Sortase A (LPETG)',
    sequence: 'LPETGG',
    note: 'Sortase-mediated ligation and tag exchange.'
  },
  {
    id: 'granzyme_b',
    label: 'Granzyme B',
    sequence: 'IEPD',
    note: 'Compact four-residue protease motif.'
  }
]);

const PROTEIN_ASSEMBLY_LIBRARY = Object.freeze({
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

export {
  PROTEIN_ASSEMBLY_CLEAVAGE_SITES,
  PROTEIN_ASSEMBLY_LIBRARY,
  PROTEIN_ASSEMBLY_LINKERS,
  PROTEIN_ASSEMBLY_PART_TYPES,
  PROTEIN_ASSEMBLY_PART_TYPE_LABELS,
  PROTEIN_ASSEMBLY_SELF_CLEAVING,
  PROTEIN_ASSEMBLY_TAGS
};
