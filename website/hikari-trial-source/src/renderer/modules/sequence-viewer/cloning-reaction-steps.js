import { cleanText } from './shared.js';
import { asArray } from '../../lib/normalize.js';

// Every cloning route is more than its PCR: the plan ends in a digest, a
// ligation, a KLD, or a one-pot assembly, and each of those is a tube someone
// has to pipette. This turns the selected strategy into the downstream
// reactions, so each one can become its own notebook page with its own
// fixed-volume table.

function selectedEnzymes(displayPlan) {
  return asArray(displayPlan?.plans)
    .flatMap((entry) => asArray(entry?.plan?.restrictionEnzymeSelection));
}

function ampliconNames(pcrPrograms) {
  return asArray(pcrPrograms)
    .map((program) => cleanText(program?.label, 120).replace(/\s*PCR\s*$/i, '').trim())
    .filter(Boolean);
}

// One row per amplicon the assembly consumes, so the tube lists what it takes
// rather than a generic "fragments" line.
function ampliconRows(pcrPrograms, startIndex) {
  const names = ampliconNames(pcrPrograms);
  const volumeFormula = 'Target pmol x fragment length (bp) x 0.66 ng/(pmol x bp) / stock concentration (ng/uL)';
  // Some routes hand over a single unlabelled program; then the tube can only
  // say "the fragments", and the protocol steps carry the amounts.
  if (!names.length) {
    return [{ rowIndex: startIndex, name: 'Purified fragments (molar input)', volumeFormula }];
  }
  return names.map((name, index) => ({
    rowIndex: startIndex + index,
    // Fragment labels often already end in "amplicon"; do not say it twice.
    name: /amplicon$/i.test(name) ? `Purified ${name}` : `Purified ${name} amplicon`,
    volumeFormula
  }));
}

function digestionStep(displayPlan) {
  const selections = selectedEnzymes(displayPlan);
  const enzymes = selections.map((enzyme) => cleanText(enzyme?.name || enzyme?.site, 60)).filter(Boolean);
  const pair = enzymes.length >= 2 ? enzymes.slice(0, 2) : [enzymes[0] || 'Restriction enzyme 1', 'Restriction enzyme 2'];
  return {
    id: 'digestion',
    name: 'Restriction Digestion',
    purpose: `Cut the insert fragment and the backbone with ${pair.join(' + ')} so the ends match before ligation.`,
    // Backbone and insert are cut in separate tubes from the same recipe. Which
    // amplicon is the insert depends on the route, so it is named by its part.
    reactionLabels: ['Backbone plasmid', 'Insert fragment'],
    totalVolume: '50 uL',
    reagents: [
      // A mass, not a volume: with the concentration blank the table keeps the
      // formula, which is what a miniprep of unknown yield needs.
      { rowIndex: 1, name: 'DNA to digest (1 ug)', finalConcentration: '20 ng/uL' },
      { rowIndex: 2, name: '10x manufacturer-recommended restriction buffer', stockConcentration: '10x', finalConcentration: '1x' },
      { rowIndex: 3, name: pair[0], manualVolumeValue: '1 uL' },
      { rowIndex: 4, name: pair[1], manualVolumeValue: '1 uL' }
    ],
    steps: [
      `Before setup, verify ${pair.join(' and ')} share a manufacturer-approved buffer and incubation temperature with acceptable activity and no methylation conflict.`,
      'If the enzymes do not share validated conditions, digest sequentially and purify or exchange buffer between enzymes.',
      'Combine the reaction on ice in the volumes given by the reaction table, one tube per DNA to be cut.',
      'Incubate and heat-inactivate only at the temperatures and times specified for the selected enzyme formulation; purify when either enzyme cannot be heat-inactivated under the same conditions.',
      'Gel-purify the cut backbone away from the excised stuffer, and column-purify the cut insert.'
    ],
    materials: ['Backbone plasmid', 'Purified insert amplicon', 'Manufacturer-recommended restriction buffer', ...pair, 'Nuclease-free water']
  };
}

function ligationStep() {
  return {
    id: 'ligation',
    name: 'T4 Ligation',
    purpose: 'Ligate the digested insert into the digested backbone at a 3:1 insert:vector molar ratio.',
    totalVolume: '20 uL',
    reagents: [
      { rowIndex: 1, name: '10x T4 DNA ligase buffer', stockConcentration: '10x', finalConcentration: '1x' },
      { rowIndex: 2, name: 'Digested backbone (50 ng)', finalConcentration: '2.5 ng/uL' },
      {
        rowIndex: 3,
        name: 'Digested insert (3:1 molar)',
        volumeFormula: '(3 x 50 ng x insert length bp / backbone length bp) / insert stock concentration (ng/uL)'
      },
      { rowIndex: 4, name: 'T4 DNA ligase', manualVolumeValue: '1 uL' }
    ],
    steps: [
      'Thaw the ligase buffer fully and vortex it: the ATP in it does not survive repeated freeze-thaw.',
      'Calculate the insert mass as 3 x 50 ng x insert length / backbone length, then divide by the measured insert stock concentration to enter its volume in the reaction table.',
      'Combine the reaction on ice in the volumes given by the reaction table.',
      'Incubate at 16 C overnight for sticky ends, or at room temperature for 10 min if only speed matters.',
      'Heat-inactivate at 65 C for 10 min, then transform 2-5 uL into competent cells.',
      'Run a no-insert control ligation alongside to measure backbone self-ligation.'
    ],
    materials: ['Digested backbone', 'Digested insert', '10x T4 DNA ligase buffer', 'T4 DNA ligase', 'Nuclease-free water']
  };
}

function kldStep() {
  return {
    id: 'kld',
    name: 'KLD Treatment',
    purpose: 'Phosphorylate, circularise, and remove parental template from the whole-plasmid PCR product in one tube.',
    totalVolume: '10 uL',
    reagents: [
      { rowIndex: 1, name: 'PCR product', manualVolumeValue: '1 uL' },
      { rowIndex: 2, name: '2x KLD reaction buffer', stockConcentration: '2x', finalConcentration: '1x' },
      { rowIndex: 3, name: '10x KLD enzyme mix', stockConcentration: '10x', finalConcentration: '1x' }
    ],
    steps: [
      'Confirm a single PCR product on a gel before treating it; KLD will circularise whatever it is given.',
      'Combine the reaction at room temperature in the volumes given by the reaction table.',
      'Incubate at room temperature for 5 min.',
      'Transform 5 uL of the KLD reaction into competent cells; do not purify it first.'
    ],
    materials: ['Whole-plasmid PCR product', '2x KLD reaction buffer', '10x KLD enzyme mix', 'Nuclease-free water']
  };
}

function dpnIStep() {
  return {
    id: 'dpni',
    name: 'DpnI Template Removal',
    purpose: 'Digest the methylated parental plasmid so only the newly synthesised, edited strands transform.',
    totalVolume: '20 uL',
    reagents: [
      { rowIndex: 1, name: 'PCR product', manualVolumeValue: '15 uL' },
      { rowIndex: 2, name: '10x restriction buffer', stockConcentration: '10x', finalConcentration: '1x' },
      { rowIndex: 3, name: 'DpnI', manualVolumeValue: '1 uL' }
    ],
    steps: [
      'Combine the reaction in the volumes given by the reaction table.',
      'Incubate at 37 C for 1 h.',
      'Transform 5 uL directly into competent cells.',
      'A no-DpnI control shows how much of the colony count is parental background.'
    ],
    materials: ['Whole-plasmid PCR product', '10x restriction buffer', 'DpnI', 'Nuclease-free water']
  };
}

function gibsonStep(pcrPrograms) {
  return {
    id: 'gibson',
    name: 'Gibson Assembly',
    purpose: 'Join the purified amplicons at their designed overlaps in a single isothermal reaction.',
    totalVolume: '20 uL',
    reagents: [
      { rowIndex: 1, name: '2x Gibson assembly master mix', stockConcentration: '2x', finalConcentration: '1x' },
      ...ampliconRows(pcrPrograms, 2)
    ],
    steps: [
      'Use 0.02-0.5 pmol of each purified fragment; equimolar for 2-3 fragments, and a 2-fold excess of insert over vector works well for short inserts.',
      'Combine the reaction on ice in the volumes given by the reaction table.',
      'Incubate at 50 C for 15 min (2-3 fragments) or 60 min (4-6 fragments).',
      'Transform 2 uL into competent cells, or store the reaction at -20 C.',
      'Run a vector-only reaction alongside to measure uncut or re-circularised background.'
    ],
    materials: ['Purified assembly amplicons', '2x Gibson assembly master mix', 'Nuclease-free water']
  };
}

function inFusionStep(pcrPrograms) {
  return {
    id: 'in-fusion',
    name: 'In-Fusion Assembly',
    purpose: 'Fuse the linearized vector and insert through their method-specific 15-21 bp designed overlaps.',
    totalVolume: '10 uL',
    reagents: [
      { rowIndex: 1, name: '5x In-Fusion Snap Assembly master mix', stockConcentration: '5x', finalConcentration: '1x' },
      ...ampliconRows(pcrPrograms, 2)
    ],
    steps: [
      'Use 50-200 ng of linearized vector and a 2:1 insert:vector molar ratio.',
      'Combine the reaction on ice in the volumes given by the reaction table.',
      'Incubate at 50 C for 15 min, then place on ice.',
      'Transform 2.5 uL into competent cells.'
    ],
    materials: ['Linearized vector amplicon', 'Purified insert amplicon', '5x In-Fusion Snap Assembly master mix', 'Nuclease-free water']
  };
}

function goldenGateStep(displayPlan, pcrPrograms) {
  const enzymeSelection = selectedEnzymes(displayPlan)[0] || {};
  const enzyme = cleanText(enzymeSelection?.name || enzymeSelection?.site, 60) || 'BsaI-HFv2';
  const digestTemperature = Math.round(Number(enzymeSelection?.digestTemperatureC) || 37);
  return {
    id: 'golden-gate',
    name: 'Golden Gate Assembly',
    purpose: `Cut and ligate in one pot: ${enzyme} releases the designed 4 nt overhangs and T4 ligase seals the matched pairs.`,
    totalVolume: '20 uL',
    reagents: [
      { rowIndex: 1, name: '10x T4 DNA ligase buffer', stockConcentration: '10x', finalConcentration: '1x' },
      ...ampliconRows(pcrPrograms, 2),
      { rowIndex: 90, name: enzyme, manualVolumeValue: '1 uL' },
      { rowIndex: 91, name: 'T4 DNA ligase', manualVolumeValue: '1 uL' }
    ],
    steps: [
      'Use roughly equimolar amounts of each purified amplicon, 0.05-0.1 pmol per part.',
      'Combine the reaction on ice in the volumes given by the reaction table.',
      `Cycle 30 x (${digestTemperature} C 5 min, 16 C 5 min), then hold 60 C for 5 min to finish the digest.`,
      'Transform 2-5 uL into competent cells.',
      `Any surviving ${enzyme} site inside a part is cut mid-assembly; domesticate it if colonies carry truncated inserts.`
    ],
    materials: ['Purified insert and backbone amplicons', '10x T4 DNA ligase buffer', enzyme, 'T4 DNA ligase', 'Nuclease-free water']
  };
}

function overlapFusionStep(pcrPrograms) {
  return {
    id: 'overlap-fusion',
    name: 'Overlap-Extension Fusion PCR',
    purpose: 'Fuse the purified flank and insert amplicons through their shared ends, then amplify the full-length product with the outer primer pair.',
    totalVolume: '50 uL',
    reagents: [
      { rowIndex: 1, name: '5x polymerase buffer', stockConcentration: '5x', finalConcentration: '1x' },
      { rowIndex: 2, name: 'dNTP mix', stockConcentration: '10 mM', finalConcentration: '0.2 mM' },
      ...ampliconRows(pcrPrograms, 3),
      { rowIndex: 88, name: 'Outer forward primer (add after fusion cycles)', stockConcentration: '10 uM', finalConcentration: '0.5 uM' },
      { rowIndex: 89, name: 'Outer reverse primer (add after fusion cycles)', stockConcentration: '10 uM', finalConcentration: '0.5 uM' },
      { rowIndex: 90, name: 'High-fidelity DNA polymerase', manualVolumeValue: '0.5 uL' }
    ],
    steps: [
      'Mix the purified amplicons in equimolar amounts. Carried-over template or primers seed the wrong fusion here.',
      'Reserve the two 2.5 uL outer-primer aliquots shown in the table. Combine every other component, including the table water amount, as a 45 uL primer-free fusion mix on ice.',
      'Run 5-10 cycles (98 C 10 s, 60 C 20 s, 72 C 30 s/kb of the full fusion) so the shared ends prime each other.',
      'Add the reserved outer primer pair to reach 0.5 uM each and a final volume of 50 uL, then run 25 further cycles and a final extension.',
      'Gel-purify the full-length fusion before the digest.'
    ],
    materials: ['Purified flank and insert amplicons', '5x polymerase buffer', 'dNTP mix', 'High-fidelity DNA polymerase', 'Outer primer pair', 'Nuclease-free water']
  };
}

// Routes are named one way in the design UI and another inside the assembly
// engine ('two-step-ligation' vs 'restriction-ligation'); both reach the same
// bench reactions.
const STRATEGY_ALIASES = {
  'restriction-ligation': 'two-step-ligation',
  'site-directed-mutagenesis': 'whole-plasmid',
  'overlap-pcr': 'overlap-fusion-only'
};

export function buildCloningReactionSteps({ strategy = '', displayPlan = {}, pcrPrograms = [] } = {}) {
  const raw = cleanText(strategy, 80);
  const name = STRATEGY_ALIASES[raw] || raw;
  if (name === 'overlap-fusion-only') {
    return [overlapFusionStep(pcrPrograms)];
  }
  if (name === 'q5-kld') {
    return [kldStep()];
  }
  if (name === 'whole-plasmid') {
    return [dpnIStep()];
  }
  if (name === 'gibson') {
    return [gibsonStep(pcrPrograms)];
  }
  if (name === 'in-fusion') {
    return [inFusionStep(pcrPrograms)];
  }
  if (name === 'golden-gate') {
    return [goldenGateStep(displayPlan, pcrPrograms)];
  }
  if (name === 'two-step-ligation') {
    return [digestionStep(displayPlan), ligationStep()];
  }
  if (name === 'overlap-extension') {
    return [overlapFusionStep(pcrPrograms), digestionStep(displayPlan), ligationStep()];
  }
  return [];
}
