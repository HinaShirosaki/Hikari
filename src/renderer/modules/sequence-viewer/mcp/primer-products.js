import { reverseComplementDna } from '../calculations/sequence.js';
import { buildCommercialRestrictionFeatures } from '../restriction-analysis.js';

export function reconstructPcrProduct(forward, reverse, template) {
  if (!forward?.bindingSequence || !reverse?.bindingSequence || !template?.sequence) return '';
  const circular = template.topology === 'circular';
  const sequence = template.sequence;
  const search = circular ? sequence + sequence : sequence;
  const start = search.indexOf(forward.bindingSequence);
  let end = search.indexOf(reverseComplementDna(reverse.bindingSequence));
  if (start < 0 || end < 0 || start >= sequence.length || end >= sequence.length) return '';
  end += reverse.bindingSequence.length;
  if (end <= start && circular) end += sequence.length;
  if (end <= start || end - start > sequence.length) return '';
  return (forward.tailSequence || '') + search.slice(start, end) + reverseComplementDna(reverse.tailSequence || '');
}

// The route planner checks junction chemistry. Independently reconstruct its
// PCR fragments from physical templates and require exact full-product coverage.
export function verifyAssemblyProducts(method, plan, primers, templates, desired) {
  if (method === 'two-step-ligation') {
    const mutant = primers.find(p => p.role === 'mutagenesis-forward');
    const forward = primers.find(p => p.role === 'restriction-forward');
    const reverse = primers.find(p => p.role === 'restriction-reverse');
    if (!mutant?.binding_verified || !forward || !reverse || forward.template_id !== reverse.template_id) return false;
    // The verified mutagenesis primer introduces the only edit. The outer pair
    // extends this megaprimer in PCR 2 to the two native restriction sites.
    const fusion = reconstructPcrProduct(forward, reverse, desired);
    if (!fusion.includes(mutant.sequence)) return false;
    return verifyRestrictionProduct(plan, templates.get(forward.template_id), fusion, desired);
  }
  if (!['gibson', 'in-fusion', 'golden-gate', 'overlap-extension'].includes(method)) return false;
  if (primers.length < 4 || primers.length % 2) return false;
  const coverage = new Set();
  const circular = desired.topology === 'circular';
  const search = circular ? desired.sequence + desired.sequence : desired.sequence;
  const products = [];
  for (let i = 0; i < primers.length; i += 2) {
    const [forward, reverse] = primers.slice(i, i + 2);
    if (!forward.role.includes('forward') || !reverse.role.includes('reverse') || forward.template_id !== reverse.template_id) return false;
    let product = reconstructPcrProduct(forward, reverse, templates.get(forward.template_id));
    if (!product) return false;
    products.push(product);
    if (method === 'overlap-extension') continue;
    if (method === 'golden-gate') {
      const enzyme = plan.plans?.[0]?.plan?.restrictionEnzymeSelection?.[0];
      const spacer = Number(/\((\d+)\//.exec(enzyme?.cut || '')?.[1]);
      const siteOffset = forward.tailSequence.indexOf(enzyme?.site || '!');
      if (!enzyme?.site || !Number.isInteger(spacer) || siteOffset < 0) return false;
      const flank = forward.tailSequence.slice(0, siteOffset + enzyme.site.length + spacer);
      if (!product.startsWith(flank) || !product.endsWith(reverseComplementDna(flank))) return false;
      product = product.slice(flank.length, -flank.length);
    }
    if (product.length > desired.sequence.length) return false;
    const start = search.indexOf(product);
    if (start < 0 || start >= desired.sequence.length) return false;
    for (let j = 0; j < product.length; j++) coverage.add((start + j) % desired.sequence.length);
  }
  if (method === 'overlap-extension') {
    let fusion = products[0];
    for (const product of products.slice(1)) {
      let overlap = Math.min(fusion.length, product.length);
      while (overlap >= 10 && fusion.slice(-overlap) !== product.slice(0, overlap)) overlap--;
      if (overlap < 10) return false;
      fusion += product.slice(overlap);
    }
    return verifyRestrictionProduct(plan, templates.get(primers[0].template_id), fusion, desired);
  }
  return coverage.size === desired.sequence.length;
}

function uniqueCut(record, enzyme) {
  if (!record?.sequence || !enzyme?.cut?.includes('^')) return null;
  const sites = buildCommercialRestrictionFeatures(record.sequence, record.topology)
    .filter(f => f.site === enzyme.site);
  if (sites.length !== 1) return null;
  const site = sites[0];
  const offset = enzyme.cut.indexOf('^');
  const cut = site.segments[0].start + (site.strand === -1 ? enzyme.site.length - offset : offset);
  return record.topology === 'circular' ? cut % record.sequence.length : cut;
}

function verifyRestrictionProduct(plan, original, fusion, desired) {
  if (!original || original.topology !== 'circular' || desired.topology !== 'circular' || !fusion) return false;
  const enzymes = plan.plans?.[0]?.plan?.restrictionEnzymeSelection;
  if (enzymes?.length !== 2) return false;
  const fragment = { sequence: fusion, topology: 'linear' };
  const sourceCuts = enzymes.map(enzyme => uniqueCut(original, enzyme));
  const insertCuts = enzymes.map(enzyme => uniqueCut(fragment, enzyme));
  if ([...sourceCuts, ...insertCuts].some(cut => cut === null)) return false;
  const left = insertCuts[0] < insertCuts[1] ? 0 : 1;
  const right = 1 - left;
  const insert = fusion.slice(insertCuts[left], insertCuts[right]);
  const start = sourceCuts[right];
  let end = sourceCuts[left];
  if (end <= start) end += original.sequence.length;
  const backbone = (original.sequence + original.sequence).slice(start, end);
  const result = insert + backbone;
  return result.length === desired.sequence.length && (result + result).includes(desired.sequence);
}
