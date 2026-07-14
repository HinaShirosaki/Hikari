import { reverseComplementDna } from '../calculations/sequence.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, normalizeSequence } from './sequence-utils.js';
import { selectBindingWindow } from './overlap-windows.js';
import { buildPrimerRecord, summarizePrimerPlan } from './primer-records.js';
import { designWithThresholdFallback } from './strategy.js';
import { sequenceContainsSite } from './restriction-ligation.js';

// Golden Gate (Type IIS) assembly of the edited insert. The enzyme cuts *outside*
// its recognition site, so tailing each insert primer with GGTCTC + spacer leaves
// a defined 4 nt overhang taken from the native junction sequence -> scarless,
// directional. Recognition sites present inside the insert would be cut mid-part,
// so the enzyme is auto-picked to avoid them (domestication otherwise required).
const TYPE_IIS_ENZYMES = [
  { name: 'BsaI', site: 'GGTCTC', spacer: 1, cut: 'GGTCTC(1/5)' },
  { name: 'BbsI', site: 'GAAGAC', spacer: 2, cut: 'GAAGAC(2/6)' },
  { name: 'BsmBI', site: 'CGTCTC', spacer: 1, cut: 'CGTCTC(1/5)' }
];

const OVERHANG = 4;
const SPACER_BASE = 'A';

function pickEnzyme(insert) {
  return TYPE_IIS_ENZYMES.find((enzyme) => !sequenceContainsSite(insert, enzyme.site)) || null;
}

function buildProcedure(recordName, enzyme, upstreamOverhang, downstreamOverhang) {
  return [
    { title: 'Order tailed insert primers', details: `Add ${enzyme.name} (${enzyme.site}) tails to the insert primers; the cuts leave native 4 nt overhangs ${upstreamOverhang} and ${downstreamOverhang}, so the junctions are scarless.` },
    { title: 'Amplify the insert', details: `PCR the insert from ${recordName} with the ${enzyme.name}-tailed primers and purify the amplicon.` },
    { title: 'One-pot Golden Gate', details: `Combine the insert with a ${enzyme.name}-compatible destination backbone that exposes the complementary ${upstreamOverhang}/${downstreamOverhang} overhangs; add ${enzyme.name} + T4 DNA ligase and cycle digest-ligation (e.g. 37 C / 16 C).` },
    { title: 'Transform and screen', details: 'Transform the assembly, then confirm both junctions by colony PCR and sequencing.' }
  ];
}

export function buildGoldenGatePlan(payload = {}) {
  const config = { ...DEFAULT_CLONING_PREFERENCES, ...(payload?.preferences || {}) };
  const sequence = normalizeSequence(payload?.sequence || '');
  const recordName = String(payload?.recordName || '').trim() || 'the plasmid';
  const start = Math.max(0, Math.min(sequence.length, Math.round(Number(payload?.range?.start) || 0)));
  const end = Math.max(start, Math.min(sequence.length, Math.round(Number(payload?.range?.end) || start)));
  const insert = sequence.slice(start, end);

  const summary = { templateLength: sequence.length, resultLength: sequence.length, insertLength: insert.length };
  const infeasible = (warning) => ({
    feasible: false,
    plans: [{ label: 'Golden Gate assembly', plan: { feasible: false, recommendedAssemblyStrategy: 'golden-gate', primerOligoPlan: null, restrictionEnzymeSelection: null, stepByStepProcedure: [], warnings: [warning] } }],
    primers: [],
    warnings: [warning],
    summary
  });

  if (insert.length < OVERHANG * 2) {
    return infeasible('The insert is too short for two distinct Golden Gate fusion overhangs.');
  }

  const enzyme = pickEnzyme(insert);
  if (!enzyme) {
    return infeasible('The insert contains every candidate Type IIS site (BsaI/BbsI/BsmBI); domesticate one before using Golden Gate.');
  }

  const upstreamOverhang = insert.slice(0, OVERHANG);
  const downstreamOverhang = insert.slice(insert.length - OVERHANG);
  const overhangWarnings = [];
  if (upstreamOverhang === downstreamOverhang) {
    overhangWarnings.push('Both junction overhangs are identical; the insert may ligate in either orientation. Shift the insert boundaries for a directional assembly.');
  }

  const tail = `${normalizeSequence(config.primerClampSequence)}${enzyme.site}${SPACER_BASE.repeat(enzyme.spacer)}`;
  const design = designWithThresholdFallback((thresholds) => {
    const forwardBinding = selectBindingWindow(insert, 'forward', thresholds, tail.length, config);
    const reverseBinding = selectBindingWindow(insert, 'reverse', thresholds, tail.length, config);
    if (!forwardBinding || !reverseBinding) {
      return { feasible: false, warnings: ['No insert-binding primer windows matched the current threshold band for the Golden Gate tails.'] };
    }
    const primers = [
      buildPrimerRecord({
        name: 'gg_insert_F',
        role: 'golden-gate-forward',
        sequence: `${tail}${forwardBinding.bindingSequence}`,
        tailSequence: tail,
        bindingSequence: forwardBinding.bindingSequence,
        warnings: [`${enzyme.name} cut exposes the ${upstreamOverhang} overhang.`]
      }),
      buildPrimerRecord({
        name: 'gg_insert_R',
        role: 'golden-gate-reverse',
        sequence: `${tail}${reverseBinding.bindingSequence}`,
        tailSequence: tail,
        bindingSequence: reverseBinding.bindingSequence,
        warnings: [`${enzyme.name} cut exposes the ${downstreamOverhang} overhang.`]
      })
    ];
    return { feasible: true, primers, warnings: [], ...summarizePrimerPlan(primers) };
  });

  if (!design.feasible) {
    return infeasible(asArray(design.warnings)[0] || 'Unable to design the Golden Gate primer pair.');
  }

  const warnings = [
    ...overhangWarnings,
    'The destination backbone must expose the complementary overhangs (a Type IIS entry vector, or a PCR-linearised backbone with matching tails).'
  ].filter(Boolean);

  const plan = {
    feasible: true,
    recommendedAssemblyStrategy: 'golden-gate',
    primerOligoPlan: { primers: design.primers, selectedThresholdLevel: design.selectedThresholdLevel, warnings },
    restrictionEnzymeSelection: [{ name: enzyme.name, site: enzyme.site, cut: enzyme.cut }],
    stepByStepProcedure: buildProcedure(recordName, enzyme, upstreamOverhang, downstreamOverhang),
    warnings
  };

  return {
    feasible: true,
    plans: [{ label: 'Golden Gate assembly', plan }],
    primers: design.primers.map((primer) => ({ ...primer, groupLabel: 'Insert PCR' })),
    warnings,
    summary
  };
}
