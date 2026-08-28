import { asArray } from '../../../lib/normalize.js';

const STRATEGY_WHOLE_PLASMID = 'whole-plasmid';
const STRATEGY_Q5_KLD = 'q5-kld';
const STRATEGY_TWO_STEP_LIGATION = 'two-step-ligation';
const STRATEGY_GOLDEN_GATE = 'golden-gate';
const STRATEGY_GIBSON = 'gibson';
const STRATEGY_IN_FUSION = 'in-fusion';
const STRATEGY_OVERLAP_EXTENSION = 'overlap-extension';

function cloningStrategyUsesInsertRange(strategy) {
  return [
    STRATEGY_GOLDEN_GATE,
    STRATEGY_GIBSON,
    STRATEGY_IN_FUSION,
    STRATEGY_OVERLAP_EXTENSION
  ].includes(strategy);
}

function cloningStrategyUsesDonor(strategy) {
  return cloningStrategyUsesInsertRange(strategy);
}

function isCloningDesignPlanActionable(displayPlan) {
  return Boolean(displayPlan?.feasible && asArray(displayPlan?.primers).length);
}

const IN_FUSION_PROCEDURE = Object.freeze([
  { title: 'Linearize the vector', details: 'Linearize the backbone by PCR or a single restriction cut at the insertion point, then purify.' },
  { title: 'Amplify insert with 15 bp overlaps', details: "PCR the insert with primers whose 5' extensions match the flanking vector ends (the overlaps designed above)." },
  { title: 'In-Fusion reaction', details: 'Combine the linearized vector and insert with In-Fusion enzyme (15 min, 50 C); it fuses the homologous 15 bp ends.' },
  { title: 'Transform and screen', details: 'Transform competent cells and confirm both junctions by colony PCR and sequencing.' }
]);

const STRATEGIES = Object.freeze([
  {
    id: STRATEGY_WHOLE_PLASMID,
    label: 'Amplify Whole Plasmid',
    shortLabel: 'Whole plasmid PCR'
  },
  {
    id: STRATEGY_Q5_KLD,
    label: 'Q5 / KLD Site-Directed Mutagenesis',
    shortLabel: 'Q5/KLD SDM'
  },
  {
    id: STRATEGY_TWO_STEP_LIGATION,
    label: 'Two-Step PCR + Digestion Ligation',
    shortLabel: 'Two-step ligation'
  },
  {
    id: STRATEGY_GOLDEN_GATE,
    label: 'Golden Gate (Type IIS)',
    shortLabel: 'Golden Gate'
  },
  {
    id: STRATEGY_GIBSON,
    label: 'Gibson Assembly',
    shortLabel: 'Gibson assembly'
  },
  {
    id: STRATEGY_IN_FUSION,
    label: 'In-Fusion Cloning',
    shortLabel: 'In-Fusion'
  },
  {
    id: STRATEGY_OVERLAP_EXTENSION,
    label: 'Overlap PCR + Distant Restriction Sites',
    shortLabel: 'Overlap-extension'
  }
]);

export {
  IN_FUSION_PROCEDURE,
  STRATEGIES,
  STRATEGY_GIBSON,
  STRATEGY_GOLDEN_GATE,
  STRATEGY_IN_FUSION,
  STRATEGY_OVERLAP_EXTENSION,
  STRATEGY_Q5_KLD,
  STRATEGY_TWO_STEP_LIGATION,
  STRATEGY_WHOLE_PLASMID,
  cloningStrategyUsesDonor,
  cloningStrategyUsesInsertRange,
  isCloningDesignPlanActionable
};
