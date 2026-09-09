import { buildDisplayPlan } from '../cloning-design/plan-building.js';
import { STRATEGIES } from '../cloning-design/strategies.js';
import { buildSequenceEditDesignSource } from '../runtime/sequence-edit-helpers.js';
import { countPrimerBindingSites } from '../cloning-assembly/primer-quality.js';
import { reverseComplementDna } from '../calculations/sequence.js';
import { applyPatches } from './edits.js';
import { verifyAssemblyProducts } from './primer-products.js';

function circularEqual(a, b, circular) { return a.length === b.length && (a === b || (circular && (a + a).includes(b))); }
function q5Product(plan, template, circular) {
  const [forward, reverse] = plan.primers || [];
  if (!forward?.bindingSequence || !reverse?.bindingSequence) return '';
  const haystack = circular ? template + template : template;
  const start = haystack.indexOf(forward.bindingSequence);
  let end = haystack.indexOf(reverseComplementDna(reverse.bindingSequence));
  if (start < 0 || end < 0) return '';
  end += reverse.bindingSequence.length;
  if (end <= start && circular) end += template.length;
  return reverseComplementDna(reverse.tailSequence || '') + (forward.tailSequence || '') + haystack.slice(start, end);
}
function splitBindingVerified(primer, template, source) {
  if (!String(primer.role).startsWith('mutagenesis-')) return false;
  const sequence = primer.role.endsWith('reverse') ? reverseComplementDna(primer.sequence) : primer.sequence;
  const edit = source.editRequest;
  const start = edit.start - 1;
  const end = edit.type === 'insertion' ? start : edit.end;
  const replacement = edit.editedSequence || '';
  for (let left = 10; left + replacement.length + 10 <= sequence.length; left++) {
    const right = sequence.length - left - replacement.length;
    const before = template.sequence.slice(start - left, start);
    const after = template.sequence.slice(end, end + right);
    if (before.length !== left || after.length !== right) continue;
    if (sequence === before + replacement + after
      && countPrimerBindingSites(template.sequence, before, template.topology === 'circular') === 1
      && countPrimerBindingSites(template.sequence, after, template.topology === 'circular') === 1) return true;
  }
  return false;
}
function predictedEditProduct(source) {
  const edit = source.editRequest;
  const start = edit.start - 1;
  const end = edit.type === 'insertion' ? start : edit.end;
  if (source.originalSequence.slice(start, end) !== (edit.originalSequence || '')) return '';
  return source.originalSequence.slice(0, start) + (edit.editedSequence || '') + source.originalSequence.slice(end);
}
export function comparePrimerRoutes(sourceRecord, desiredRecord, patches, methods, donor, sourceId = 'original', sourceKind = 'supplied_template') {
  const selected = STRATEGIES.filter(s => !methods || methods.includes(s.id));
  const stages = [];
  let template = sourceRecord;
  // Descending original coordinates preserve every independent edit site.
  for (const patch of [...patches].sort((a, b) => b.start - a.start)) {
    const next = applyPatches(template, [patch]).record;
    stages.push({ template, next, patch });
    template = next;
  }
  if (!stages.length || template.sequence !== desiredRecord.sequence) return { status: 'no_feasible_design', routes: [], warnings: ['Recorded DNA edits do not reconstruct this plasmid.'] };
  const routes = selected.map((method, methodIndex) => {
    const designs = stages.map(({ template: stageTemplate, next }, stageIndex) => {
      const source = buildSequenceEditDesignSource({ record: stageTemplate, originalSequence: stageTemplate.sequence, nextSequence: next.sequence });
      let plan;
      try { plan = buildDisplayPlan({ strategy: method.id, source, record: next, range: source.editedRange, donor }); }
      catch (error) { plan = { feasible: false, primers: [], warnings: [error.message] }; }
      const warnings = [...(plan.warnings || [])];
      const primers = (plan.primers || []).map(primer => {
        const candidates = [{ id: stageIndex ? `intermediate_${stageIndex}` : sourceId, record: stageTemplate }, ...(donor ? [{ id: donor.id, record: donor }] : [])];
        const matches = candidates.filter(c => countPrimerBindingSites(c.record.sequence, primer.bindingSequence, c.record.topology === 'circular') === 1);
        // Complementary whole-plasmid primers have split annealing arms; their
        // combined bindingSequence includes the deleted/replaced junction.
        const splitBinding = splitBindingVerified(primer, stageTemplate, source);
        if (matches.length !== 1 && !splitBinding) warnings.push(`${primer.name}: a unique physical-template binding site was not verified.`);
        return { ...primer, template_id: matches[0]?.id || (splitBinding ? (stageIndex ? `intermediate_${stageIndex}` : sourceId) : null), template_kind: matches[0]?.id === donor?.id ? 'supplied_template' : (stageIndex ? 'hypothetical_intermediate' : sourceKind), binding_verified: matches.length === 1 || splitBinding };
      });
      const productMatches = method.id === 'q5-kld'
        ? circularEqual(q5Product(plan, stageTemplate.sequence, stageTemplate.topology === 'circular'), next.sequence, next.topology === 'circular')
        : method.id === 'whole-plasmid'
          ? primers.length === 2 && primers.every(p => splitBindingVerified(p, stageTemplate, source))
            && primers[0].sequence === reverseComplementDna(primers[1].sequence)
            && circularEqual(predictedEditProduct(source), next.sequence, next.topology === 'circular')
          : (method.id !== 'two-step-ligation' || primers.filter(p => p.role.startsWith('mutagenesis-')).every(p => splitBindingVerified(p, stageTemplate, source)))
            && verifyAssemblyProducts(method.id, plan, primers, new Map([[stageIndex ? `intermediate_${stageIndex}` : sourceId, stageTemplate], ...(donor ? [[donor.id, donor]] : [])]), next);
      if (plan.feasible && !productMatches) warnings.push('The route did not provide a verified complete predicted product.');
      return { ...plan, primers, warnings, feasible: Boolean(plan.feasible && primers.length && primers.every(p => p.binding_verified) && productMatches), source, product_matches: productMatches, product_validation: method.id === 'whole-plasmid' ? 'complementary_mutagenesis_primers' : 'primer_reconstruction', stage: stageIndex + 1, template_kind: stageIndex ? 'hypothetical_intermediate' : sourceKind };
    });
    return { method: method.id, label: method.label, feasible: designs.every(d => d.feasible), stages: designs, stage_count: designs.length * (method.id === 'two-step-ligation' || method.id === 'overlap-extension' ? 2 : 1), edit_site_count: designs.length, primer_count: designs.reduce((n, d) => n + d.primers.length, 0), warning_count: designs.reduce((n, d) => n + d.warnings.length, 0), method_index: methodIndex };
  });
  routes.sort((a, b) => Number(b.feasible) - Number(a.feasible) || a.stage_count - b.stage_count || a.primer_count - b.primer_count || a.warning_count - b.warning_count || a.method_index - b.method_index);
  const recommended = routes.find(r => r.feasible);
  return { status: recommended ? 'design_ready' : 'no_feasible_design', routes, recommended_method: recommended?.method || null, ranking_reason: 'Feasible routes first, then fewer stages, fewer primers, fewer quality warnings, and existing strategy order.', warnings: stages.length > 1 ? ['Multiple edit sites require sequential stages; later templates are hypothetical intermediates until produced and verified.'] : [] };
}
