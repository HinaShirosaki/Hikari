export const COMMON_SEQUENCE_FEATURE_TYPES = Object.freeze([
  Object.freeze({ value: 'cds', label: 'CDS', genbankKey: 'CDS', color: '#2f80ed' }),
  Object.freeze({ value: 'promoter', label: 'Promoter', genbankKey: 'promoter', color: '#2f9e44' }),
  Object.freeze({ value: 'terminator', label: 'Terminator', genbankKey: 'terminator', color: '#f76707' }),
  Object.freeze({ value: 'gene', label: 'Gene', genbankKey: 'gene', color: '#5f3dc4' }),
  Object.freeze({ value: 'enhancer', label: 'Enhancer', genbankKey: 'enhancer', color: '#c2255c' }),
  Object.freeze({ value: 'operator', label: 'Operator', genbankKey: 'operator', color: '#495057' }),
  Object.freeze({ value: 'attenuator', label: 'Attenuator', genbankKey: 'attenuator', color: '#0b7285' }),
  Object.freeze({ value: 'rbs', label: 'RBS', genbankKey: 'RBS', color: '#e67700' }),
  Object.freeze({ value: 'ribosome_entry_site', label: 'Ribosome entry site', genbankKey: 'RBS', color: '#12b886' }),
  Object.freeze({ value: 'rep_origin', label: 'Origin of replication', genbankKey: 'rep_origin', color: '#e03131' }),
  Object.freeze({ value: 'primer_bind', label: 'Primer binding site', genbankKey: 'primer_bind', color: '#1098ad' }),
  Object.freeze({ value: 'protein_bind', label: 'Protein binding site', genbankKey: 'protein_bind', color: '#7048e8' }),
  Object.freeze({ value: 'exon', label: 'Exon', genbankKey: 'exon', color: '#1971c2' }),
  Object.freeze({ value: 'intron', label: 'Intron', genbankKey: 'intron', color: '#868e96' }),
  Object.freeze({ value: '5_utr', label: "5' UTR", genbankKey: "5'UTR", color: '#9c36b5' }),
  Object.freeze({ value: '3_utr', label: "3' UTR", genbankKey: "3'UTR", color: '#6741d9' }),
  Object.freeze({ value: 'mrna', label: 'mRNA', genbankKey: 'mRNA', color: '#0ca678' }),
  Object.freeze({ value: 'trna', label: 'tRNA', genbankKey: 'tRNA', color: '#087f5b' }),
  Object.freeze({ value: 'rrna', label: 'rRNA', genbankKey: 'rRNA', color: '#1864ab' }),
  Object.freeze({ value: 'ncrna', label: 'ncRNA', genbankKey: 'ncRNA', color: '#364fc7' }),
  Object.freeze({ value: 'misc_rna', label: 'misc RNA', genbankKey: 'misc_RNA', color: '#4c6ef5' }),
  Object.freeze({ value: 'signal_peptide', label: 'Signal peptide', genbankKey: 'sig_peptide', color: '#d9480f' }),
  Object.freeze({ value: 'transit_peptide', label: 'Transit peptide', genbankKey: 'transit_peptide', color: '#c2410c' }),
  Object.freeze({ value: 'mat_peptide', label: 'Mature peptide', genbankKey: 'mat_peptide', color: '#a61e4d' }),
  Object.freeze({ value: 'poly_a_signal', label: 'Poly(A) signal', genbankKey: 'polyA_signal', color: '#a16207' }),
  Object.freeze({ value: 'poly_a_site', label: 'Poly(A) site', genbankKey: 'polyA_site', color: '#ca8a04' }),
  Object.freeze({ value: 'repeat_region', label: 'Repeat region', genbankKey: 'repeat_region', color: '#6c757d' }),
  Object.freeze({ value: 'mobile_element', label: 'Mobile element', genbankKey: 'mobile_element', color: '#7c2d12' }),
  Object.freeze({ value: 'source', label: 'Source', genbankKey: 'source', color: '#0f766e' }),
  Object.freeze({ value: 'tag', label: 'Tag', genbankKey: 'misc_feature', color: '#7e22ce' }),
  Object.freeze({ value: 'linker', label: 'Linker', genbankKey: 'misc_feature', color: '#64748b' }),
  Object.freeze({ value: 'misc_feature', label: 'Misc feature', genbankKey: 'misc_feature', color: '#6c757d' })
]);

const FEATURE_TYPE_ALIASES = Object.freeze({
  '3_prime_utr': '3_utr',
  '3_utr': '3_utr',
  '3utr': '3_utr',
  '5_prime_utr': '5_utr',
  '5_utr': '5_utr',
  '5utr': '5_utr',
  cds: 'cds',
  coding_region: 'cds',
  coding_sequence: 'cds',
  misc_rna: 'misc_rna',
  miscrna: 'misc_rna',
  mrna: 'mrna',
  mobile_element: 'mobile_element',
  ncrna: 'ncrna',
  origin: 'rep_origin',
  origin_of_replication: 'rep_origin',
  ori: 'rep_origin',
  poly_a_signal: 'poly_a_signal',
  poly_a_site: 'poly_a_site',
  polya_signal: 'poly_a_signal',
  polya_site: 'poly_a_site',
  primer_binding_site: 'primer_bind',
  protein_binding_site: 'protein_bind',
  rbs: 'rbs',
  rep_origin: 'rep_origin',
  ribosome_binding_site: 'rbs',
  rrna: 'rrna',
  sig_peptide: 'signal_peptide',
  signal_peptide: 'signal_peptide',
  transcription_terminator: 'terminator',
  trna: 'trna'
});

const COMMON_FEATURE_TYPE_BY_VALUE = Object.freeze(Object.fromEntries(
  COMMON_SEQUENCE_FEATURE_TYPES.map((entry) => [entry.value, entry])
));

function normalizeUtrText(value) {
  return String(value || '')
    .replace(/\b5\s*['’]?\s*utr\b/gi, '5_utr')
    .replace(/\b3\s*['’]?\s*utr\b/gi, '3_utr');
}

export function normalizeFeatureType(type, fallback = 'misc_feature') {
  const cleaned = normalizeUtrText(type || fallback)
    .trim()
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const normalized = cleaned || fallback;
  return FEATURE_TYPE_ALIASES[normalized] || normalized;
}

export function getFeatureTypeDefinition(type) {
  return COMMON_FEATURE_TYPE_BY_VALUE[normalizeFeatureType(type, '')] || null;
}

export function getFeatureTypeColor(type) {
  return getFeatureTypeDefinition(type)?.color || '';
}

export function getFeatureTypeGenbankKey(type) {
  return getFeatureTypeDefinition(type)?.genbankKey || '';
}
