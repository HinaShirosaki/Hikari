import { COMMON_BLOCK_GROUPS } from '../protein-builder/constants.js';
import { CODON_USAGE_PROFILES, translateDnaCodon } from '../calculations/sequence.js';
import { buildDnaConstruct } from '../protein-builder/dna-construct.js';
import { buildConstruct } from '../protein-builder/protein-construct.js';
import { buildProteinArchitectureName } from '../sequence-naming.js';
import { dna, fail, peptide } from './model.js';
export const catalog = COMMON_BLOCK_GROUPS.flatMap(group => group.items.map(part => ({ ...part, part_id: `${group.id}:${part.id}`, type: group.id })));
export const profiles = Object.entries(CODON_USAGE_PROFILES).map(([id, value]) => ({ id, label: value.label }));
export function validateProfile(value = 'ecoli') { if (!CODON_USAGE_PROFILES[value]) fail('Unknown codon profile. Use sequence_protein_parts.'); return value; }
export function buildProtein(args, sources) {
  const rows = args.parts.map((part, index) => {
    if (part.kind === 'catalog') {
      const entry = catalog.find(item => item.part_id === part.part_id);
      if (!entry) fail(`Unknown catalog part ${part.part_id}.`);
      return { ...entry, kind: 'library', id: index + 1 };
    }
    const source = sources[index];
    const protein = source ? source.context.protein : peptide(part.amino_acids);
    const sourceDnaSequence = source ? source.context.dna.slice(0, protein.length * 3) : (part.dna ? dna(part.dna) : '');
    if (sourceDnaSequence && (sourceDnaSequence.length !== protein.length * 3 || sourceDnaSequence.match(/.{3}/g)?.map(c => translateDnaCodon(c)).join('') !== protein)) fail('Source DNA does not encode its protein block.');
    return {
      id: index + 1, type: source ? 'feature' : 'custom', kind: source ? 'feature' : 'custom',
      label: part.label || source?.feature.name || `Protein ${index + 1}`, sequence: protein,
      sourceDnaSequence, codonOptimize: part.codon_optimize === true,
      sourceFeatureId: source?.feature.id || '', sourceVectorName: source?.entry.name || '',
      sourceVectorSequence: source?.record.sequence || ''
    };
  });
  const payload = { rows, codonUsageProfile: validateProfile(args.codon_profile), constructName: args.name || buildProteinArchitectureName({ parts: rows }) };
  const protein = buildConstruct(payload);
  const construct = buildDnaConstruct(payload);
  if (!protein.ok || !construct.ok) fail([...protein.errors, ...construct.errors].join(' ') || 'Protein assembly failed.');
  if (construct.sequence.match(/.{3}/g)?.map(c => translateDnaCodon(c)).join('') !== protein.sequence) fail('Built DNA translation does not match the protein.', 'product_mismatch');
  return { payload, protein: protein.sequence, dna: construct.sequence, parts: construct.parts, protein_parts: protein.parts, warnings: [...new Set([...protein.warnings, ...construct.warnings])], name: payload.constructName };
}
