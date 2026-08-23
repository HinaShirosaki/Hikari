import { buildDisplayPlan } from '../cloning-design.js';
import { asArray } from '../../../lib/normalize.js';

// Adapter for the sequence_viewer MCP `design_cloning` action. The UI-facing
// strategy IDs (q5-kld, two-step-ligation, in-fusion, ...) are not the engine's
// route names (site-directed-mutagenesis, restriction-ligation, gibson, ...), so
// this normalizes buildDisplayPlan output into one stable contract shape: it
// echoes the requested contract `strategy`, exposes the raw `engineRoute`, and
// flattens the nested plans[].plan.* structure (renaming gcContent -> gcPercent,
// groupLabel -> group).

const CONTRACT_STRATEGIES = new Set([
  'whole-plasmid',
  'q5-kld',
  'two-step-ligation',
  'golden-gate',
  'gibson',
  'in-fusion'
]);

function normalizePrimer(primer = {}) {
  return {
    name: primer.name || 'primer',
    role: primer.role || 'primer',
    sequence: primer.sequence || '',
    tailSequence: primer.tailSequence || '',
    bindingSequence: primer.bindingSequence || '',
    tm: Number.isFinite(Number(primer.tm)) ? Number(primer.tm) : null,
    gcPercent: Number.isFinite(Number(primer.gcContent)) ? Number(primer.gcContent) : null,
    length: Number(primer.length) || String(primer.sequence || '').length,
    group: primer.groupLabel || ''
  };
}

function normalizeEnzymes(displayPlan) {
  const selection = asArray(displayPlan?.plans)
    .map((entry) => asArray(entry?.plan?.restrictionEnzymeSelection))
    .find((list) => list.length);
  if (!selection) {
    return null;
  }
  return selection.map((enzyme) => ({
    name: enzyme?.name || enzyme?.site || 'enzyme',
    site: enzyme?.site || '',
    cut: enzyme?.cut || asArray(enzyme?.cutPatterns)[0] || ''
  }));
}

function flattenProcedure(displayPlan) {
  const steps = [];
  asArray(displayPlan?.plans).forEach((entry) => {
    const group = entry?.label || '';
    asArray(entry?.plan?.stepByStepProcedure).forEach((step) => {
      steps.push({
        step: steps.length + 1,
        title: step?.title || group || `Step ${steps.length + 1}`,
        details: group && step?.group ? `${group}: ${step.details || ''}` : (step?.details || '')
      });
    });
  });
  return steps;
}

export function isContractStrategy(strategy) {
  return CONTRACT_STRATEGIES.has(String(strategy || ''));
}

export function normalizeCloningDesign(displayPlan = {}, requestedStrategy = '') {
  const engineRoute = asArray(displayPlan?.plans)
    .map((entry) => entry?.plan?.recommendedAssemblyStrategy)
    .find(Boolean) || null;
  return {
    feasible: Boolean(displayPlan?.feasible),
    strategy: String(requestedStrategy || displayPlan?.strategy || ''),
    engineRoute,
    primers: asArray(displayPlan?.primers).map(normalizePrimer),
    enzymes: normalizeEnzymes(displayPlan),
    procedure: flattenProcedure(displayPlan),
    warnings: asArray(displayPlan?.warnings),
    summary: displayPlan?.summary || {}
  };
}

// Full compute path: hypothetical edit -> design source -> plan -> normalized shape.
export function designCloningRoute({ strategy, source, record, range }) {
  if (!isContractStrategy(strategy)) {
    return { error: { code: 'UNKNOWN_STRATEGY', message: `Unknown cloning strategy "${strategy}".` } };
  }
  const displayPlan = buildDisplayPlan({ strategy, source, record, range });
  return normalizeCloningDesign(displayPlan, strategy);
}
