import { asArray } from '../../lib/normalize.js';
import { cleanText } from './shared.js';

// templateId identifies an amplicon inside a plan; templateEntryId identifies
// the actual library record used in that PCR. Never choose a template by name
// or by finding the primer sequence in unrelated stocks.
export function assignPrimerTemplateEntries(primers, { fragments = [], parentEntryId = '', donorEntryId = '' } = {}) {
  const byId = new Map(asArray(fragments).map((fragment) => [fragment.id, fragment]));
  return asArray(primers).map((primer) => {
    let entryId = '';
    const fragment = byId.get(primer.templateId);
    const metadata = fragment?.metadata || {};
    if (['hypothetical_intermediate', 'oligo_pool'].includes(primer.template_kind) || metadata.source === 'synthesis') {
      entryId = '';
    } else if (Object.hasOwn(primer, 'templateEntryId')) {
      entryId = primer.templateEntryId;
    } else if (Object.hasOwn(primer, 'template_id')) {
      entryId = primer.template_id;
    } else if (Object.hasOwn(metadata, 'templateEntryId')) {
      entryId = metadata.templateEntryId;
    } else if (metadata.source === 'protein_builder_template') {
      entryId = ''; // Older blocks may name a donor without its durable ID.
    } else if (fragment?.role === 'backbone' || fragment?.type === 'backbone'
      || ['host_backbone', 'golden_gate_backbone', 'oe_upstream_flank', 'oe_downstream_flank'].includes(primer.templateId)) {
      entryId = parentEntryId;
    } else if (fragment || ['edited_amplicon', 'golden_gate_insert', 'oe_insert'].includes(primer.templateId)) {
      entryId = donorEntryId || parentEntryId;
    } else {
      entryId = parentEntryId;
    }
    return { ...primer, templateEntryId: cleanText(entryId, 200) };
  });
}
