import { reverseComplementDna } from '../../tool-box/sequence.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, normalizeSequence } from './sequence-utils.js';
import { normalizeEditRequest } from './edit-map.js';
import { selectBindingWindow } from './overlap-windows.js';
import { buildPrimerRecord, summarizePrimerPlan } from './primer-records.js';
import { designWithThresholdFallback } from './strategy.js';

// Q5 / KLD site-directed mutagenesis (NEBaseChanger style). Two *non-overlapping*
// back-to-back (divergent) primers amplify the whole plasmid exponentially; only
// the forward primer carries the edit (as a 5' tail). The linear product is then
// circularised with KLD (Kinase-Ligase-DpnI). This differs from the QuikChange
// whole-plasmid route, which uses overlapping complementary primers + DpnI only.

const EDIT_LABELS = {
  'point-mutation': 'substitution',
  replacement: 'replacement',
  insertion: 'insertion',
  deletion: 'deletion'
};

// For circular templates the annealing regions may need to wrap past the origin,
// so extend the flanks with a copy of the plasmid; linear templates cannot wrap.
function flankWindows(sequence, startIndex, endIndex, circular) {
  const extension = circular ? sequence : '';
  const downstream = `${sequence.slice(endIndex)}${extension}`.slice(0, 60);
  const upstreamFull = `${extension}${sequence.slice(0, startIndex)}`;
  return { downstream, upstream: upstreamFull.slice(-60) };
}

function buildProcedure(recordName, editLabel, changeTail) {
  const forwardNote = changeTail
    ? `the forward primer carries the ${editLabel} (${changeTail}) at its 5' end`
    : `the primers anneal back-to-back across the ${editLabel} junction`;
  return [
    { title: 'Prepare divergent primers', details: `Order the non-overlapping primer pair; ${forwardNote}. 5'-phosphorylate them, or rely on the kinase in the KLD mix.` },
    { title: 'Whole-plasmid PCR', details: `Exponentially amplify the entire ${recordName} with the divergent primer pair to produce a single linear product.` },
    { title: 'KLD treatment', details: 'Incubate the PCR product with Kinase, Ligase, and DpnI (KLD) to phosphorylate the ends, circularise the plasmid, and digest parental template.' },
    { title: 'Transform and screen', details: 'Transform the KLD reaction into competent cells, then confirm the edit by colony PCR and sequencing.' }
  ];
}

export function buildQ5KldPlan(payload = {}) {
  const config = { ...DEFAULT_CLONING_PREFERENCES, ...(payload?.preferences || {}) };
  const originalSequence = normalizeSequence(payload?.originalSequence || '');
  const editedSequence = normalizeSequence(payload?.editedSequence || '');
  const recordName = String(payload?.recordName || '').trim() || 'the plasmid';
  const circular = String(payload?.topology || '').toLowerCase() !== 'linear';
  const normalizedEdit = normalizeEditRequest(payload?.editRequest, originalSequence);

  const summary = { templateLength: originalSequence.length, resultLength: editedSequence.length };
  const infeasible = (warning) => ({
    feasible: false,
    plans: [{ label: 'Q5/KLD site-directed mutagenesis', plan: { feasible: false, recommendedAssemblyStrategy: 'site-directed-mutagenesis', primerOligoPlan: null, restrictionEnzymeSelection: null, stepByStepProcedure: [], warnings: [warning] } }],
    primers: [],
    warnings: [warning],
    summary
  });

  if (!originalSequence.length || !normalizedEdit) {
    return infeasible('Edit the sequence before designing a Q5/KLD route.');
  }

  const editLabel = EDIT_LABELS[normalizedEdit.type] || 'edit';
  const changeTail = normalizedEdit.type === 'deletion' ? '' : normalizeSequence(normalizedEdit.editedSequence || '');
  const { downstream, upstream } = flankWindows(originalSequence, normalizedEdit.startIndex, normalizedEdit.endIndex, circular);
  const topologyWarnings = circular ? [] : ['Q5/KLD circularisation assumes a circular plasmid template.'];

  const design = designWithThresholdFallback((thresholds) => {
    // ponytail: whole edit rides on the forward 5' tail; a very long insertion can
    // overrun maxPrimerLength and fail here. Split the tail across both primers if
    // large synthetic insertions become common.
    const forwardBinding = selectBindingWindow(downstream, 'forward', thresholds, changeTail.length, config);
    const reverseBinding = selectBindingWindow(upstream, 'reverse', thresholds, 0, config);
    if (!forwardBinding || !reverseBinding) {
      return { feasible: false, warnings: [`No back-to-back primer pair matched the current threshold band${changeTail.length ? ' (the edit may be too long for a single 5\' tail)' : ''}.`] };
    }

    const primers = [
      buildPrimerRecord({
        name: 'q5_F',
        role: 'mutagenesis-forward',
        sequence: `${changeTail}${forwardBinding.bindingSequence}`,
        tailSequence: changeTail,
        bindingSequence: forwardBinding.bindingSequence,
        warnings: [changeTail ? `Carries the ${editLabel} (${changeTail}) at the 5' end.` : `Anneals immediately 3' of the ${editLabel}.`]
      }),
      buildPrimerRecord({
        name: 'q5_R',
        role: 'mutagenesis-reverse',
        sequence: reverseBinding.bindingSequence,
        bindingSequence: reverseBinding.bindingSequence,
        warnings: ["Anneals back-to-back with the forward primer (5' ends abut for KLD ligation)."]
      })
    ];
    return { feasible: true, primers, warnings: [], ...summarizePrimerPlan(primers) };
  });

  if (!design.feasible) {
    return infeasible(asArray(design.warnings)[0] || 'Unable to design the Q5/KLD primer pair.');
  }

  const plan = {
    feasible: true,
    recommendedAssemblyStrategy: 'site-directed-mutagenesis',
    primerOligoPlan: {
      primers: design.primers,
      selectedThresholdLevel: design.selectedThresholdLevel,
      warnings: topologyWarnings
    },
    restrictionEnzymeSelection: null,
    stepByStepProcedure: buildProcedure(recordName, editLabel, changeTail),
    warnings: topologyWarnings
  };

  return {
    feasible: true,
    plans: [{ label: 'Q5/KLD site-directed mutagenesis', plan }],
    primers: design.primers.map((primer) => ({ ...primer, groupLabel: 'Whole-plasmid PCR' })),
    warnings: topologyWarnings,
    summary
  };
}
