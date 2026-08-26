import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { reverseComplementDna } from '../calculations/sequence.js';
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
const MINIMUM_TYPE_IIS_FLANK = 6;

function pickEnzyme(insert) {
  return TYPE_IIS_ENZYMES.find((enzyme) => !sequenceContainsSite(insert, enzyme.site)) || null;
}

function buildProcedure(recordName, enzyme, upstreamOverhang, downstreamOverhang, insertTemplateName = '') {
  const insertTemplate = String(insertTemplateName || '').trim() || recordName;
  return [
    { title: 'Order insert and backbone primers', details: `The four ${enzyme.name} (${enzyme.site})-tailed primers generate the matched ${upstreamOverhang}/${downstreamOverhang} junction overhangs.` },
    { title: 'Amplify both fragments', details: `PCR the insert from ${insertTemplate} and the linearized ${recordName} backbone separately, verify single products, and purify both amplicons.` },
    { title: 'One-pot Golden Gate', details: `Combine the two amplicons with ${enzyme.name} + T4 DNA ligase and cycle digest-ligation (e.g. 37 C / 16 C).` },
    { title: 'Transform and screen', details: 'Transform the assembly, then confirm both junctions by colony PCR and sequencing.' }
  ];
}

function buildTypeIisFlank(config) {
  const configured = normalizeSequence(config?.primerClampSequence || '');
  let flank = configured;
  const padding = 'GCGCGC';
  while (flank.length < MINIMUM_TYPE_IIS_FLANK) {
    flank += padding[flank.length % padding.length];
  }
  return flank;
}

export function buildGoldenGatePlan(payload = {}) {
  const config = { ...DEFAULT_CLONING_PREFERENCES, ...(payload?.preferences || {}) };
  const sequence = normalizeSequence(payload?.sequence || '');
  const recordName = String(payload?.recordName || '').trim() || 'the plasmid';
  const topology = String(payload?.topology || '').toLowerCase() === 'linear' ? 'linear' : 'circular';
  const donorSequence = normalizeSequence(payload?.donor?.sequence || '');
  const donorName = String(payload?.donor?.name || '').trim();
  const vectorTemplateSequence = normalizeSequence(payload?.vectorTemplateSequence || sequence);
  const start = Math.max(0, Math.min(sequence.length, Math.round(Number(payload?.range?.start) || 0)));
  const end = Math.max(start, Math.min(sequence.length, Math.round(Number(payload?.range?.end) || start)));
  const insert = sequence.slice(start, end);
  const backbone = `${sequence.slice(end)}${sequence.slice(0, start)}`;

  const summary = {
    templateLength: sequence.length,
    resultLength: sequence.length,
    insertLength: insert.length,
    backboneLength: backbone.length
  };
  // Accepts one warning or a list, so a route can say what blocked it as well
  // as that it was blocked.
  const infeasible = (warning) => {
    const warnings = [warning].flat().filter(Boolean);
    return {
      feasible: false,
      plans: [{ label: 'Golden Gate assembly', plan: { feasible: false, recommendedAssemblyStrategy: 'golden-gate', primerOligoPlan: null, restrictionEnzymeSelection: null, stepByStepProcedure: [], warnings } }],
      primers: [],
      warnings,
      summary
    };
  };

  if (insert.length < OVERHANG * 2 || backbone.length < OVERHANG * 2) {
    return infeasible('The selected insert and remaining backbone must each support two Golden Gate junctions.');
  }

  const enzyme = pickEnzyme(sequence);
  if (!enzyme) {
    return infeasible('The designed insert/backbone sequence contains every candidate Type IIS site (BsaI/BbsI/BsmBI); domesticate one before using Golden Gate.');
  }

  const upstreamOverhang = insert.slice(0, OVERHANG);
  const downstreamOverhang = backbone.slice(0, OVERHANG);
  if (
    upstreamOverhang === downstreamOverhang
    || upstreamOverhang === reverseComplementDna(downstreamOverhang)
    || upstreamOverhang === reverseComplementDna(upstreamOverhang)
    || downstreamOverhang === reverseComplementDna(downstreamOverhang)
  ) {
    return infeasible('The native 4 nt junction overhangs are identical, reverse-complementary, or self-complementary. Shift the insert boundaries before using Golden Gate.');
  }

  const baseTail = `${buildTypeIisFlank(config)}${enzyme.site}${SPACER_BASE.repeat(enzyme.spacer)}`;
  const design = designWithThresholdFallback((thresholds) => {
    // Candidate windows come from the desired fragments, while uniqueness is
    // checked against the DNA actually present in each PCR tube. The insert
    // tube holds the donor when one is given, otherwise this record -- the
    // pre-edit vector is the backbone's template, and never carries the insert.
    const insertConfig = {
      ...config,
      specificitySequence: donorSequence || sequence,
      specificityCircular: donorSequence
        ? String(payload?.donor?.topology || 'circular').toLowerCase() !== 'linear'
        : topology === 'circular'
    };
    const backboneConfig = {
      ...config,
      specificitySequence: vectorTemplateSequence,
      specificityCircular: topology === 'circular'
    };
    const insertForward = selectBindingWindow(insert, 'forward', thresholds, baseTail.length, insertConfig);
    const insertReverseTail = `${baseTail}${reverseComplementDna(downstreamOverhang)}`;
    const insertReverse = selectBindingWindow(insert, 'reverse', thresholds, insertReverseTail.length, insertConfig);
    const backboneForward = selectBindingWindow(backbone, 'forward', thresholds, baseTail.length, backboneConfig);
    const backboneReverseTail = `${baseTail}${reverseComplementDna(upstreamOverhang)}`;
    const backboneReverse = selectBindingWindow(backbone, 'reverse', thresholds, backboneReverseTail.length, backboneConfig);
    if (!insertForward || !insertReverse || !backboneForward || !backboneReverse) {
      return { feasible: false, warnings: ['No complete, unique insert/backbone primer set matched the current threshold band for the Golden Gate tails.'] };
    }
    const primers = [
      buildPrimerRecord({
        name: 'gg_insert_F',
        role: 'golden-gate-forward',
        sequence: `${baseTail}${insertForward.bindingSequence}`,
        tailSequence: baseTail,
        bindingSequence: insertForward.bindingSequence,
        groupLabel: 'Golden Gate insert PCR',
        ampliconLength: insert.length,
        templateId: 'golden_gate_insert',
        warnings: [`${enzyme.name} cut exposes the native ${upstreamOverhang} overhang.`]
      }),
      buildPrimerRecord({
        name: 'gg_insert_R',
        role: 'golden-gate-reverse',
        sequence: `${insertReverseTail}${insertReverse.bindingSequence}`,
        tailSequence: insertReverseTail,
        bindingSequence: insertReverse.bindingSequence,
        groupLabel: 'Golden Gate insert PCR',
        ampliconLength: insert.length,
        templateId: 'golden_gate_insert',
        warnings: [`${enzyme.name} cut exposes the matched ${downstreamOverhang} junction overhang.`]
      }),
      buildPrimerRecord({
        name: 'gg_backbone_F',
        role: 'golden-gate-backbone-forward',
        sequence: `${baseTail}${backboneForward.bindingSequence}`,
        tailSequence: baseTail,
        bindingSequence: backboneForward.bindingSequence,
        groupLabel: 'Golden Gate backbone PCR',
        ampliconLength: backbone.length,
        templateId: 'golden_gate_backbone',
        warnings: [`${enzyme.name} cut exposes the native ${downstreamOverhang} overhang.`]
      }),
      buildPrimerRecord({
        name: 'gg_backbone_R',
        role: 'golden-gate-backbone-reverse',
        sequence: `${backboneReverseTail}${backboneReverse.bindingSequence}`,
        tailSequence: backboneReverseTail,
        bindingSequence: backboneReverse.bindingSequence,
        groupLabel: 'Golden Gate backbone PCR',
        ampliconLength: backbone.length,
        templateId: 'golden_gate_backbone',
        warnings: [`${enzyme.name} cut exposes the matched ${upstreamOverhang} junction overhang.`]
      })
    ];
    return { feasible: true, primers, warnings: [], ...summarizePrimerPlan(primers) };
  });

  if (!design.feasible) {
    return infeasible(asArray(design.warnings).filter(Boolean).length ? asArray(design.warnings) : 'Unable to design the Golden Gate primer pair.');
  }

  const warnings = [
    ...asArray(design.warnings),
    'Native junction overhangs were checked for identity, reverse complementarity, and self-complementarity; review ligation-fidelity data before ordering.'
  ].filter(Boolean);

  const plan = {
    feasible: true,
    recommendedAssemblyStrategy: 'golden-gate',
    primerOligoPlan: { primers: design.primers, selectedThresholdLevel: design.selectedThresholdLevel, warnings },
    restrictionEnzymeSelection: [{ name: enzyme.name, site: enzyme.site, cut: enzyme.cut }],
    stepByStepProcedure: buildProcedure(recordName, enzyme, upstreamOverhang, downstreamOverhang, donorName),
    warnings
  };

  return {
    feasible: true,
    plans: [{ label: 'Golden Gate assembly', plan }],
    primers: design.primers,
    warnings,
    summary
  };
}
