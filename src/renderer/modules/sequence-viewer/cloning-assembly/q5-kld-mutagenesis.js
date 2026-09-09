import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { reverseComplementDna } from '../calculations/sequence.js';
import { asArray, describeAmbiguousDna, normalizeSequence } from './sequence-utils.js';
import { normalizeEditRequest } from './edit-map.js';
import { describeBindingWindowFailure, selectBindingWindow } from './overlap-windows.js';
import { buildPrimerRecord, summarizePrimerPlan } from './primer-records.js';
import { designWithThresholdFallback } from './strategy.js';

// Q5 / KLD site-directed mutagenesis (NEBaseChanger style). Two *non-overlapping*
// back-to-back (divergent) primers amplify the whole plasmid exponentially. A
// short edit rides on the forward 5' tail; a longer edit can be distributed
// across both 5' tails. The linear product is then circularised with KLD
// (Kinase-Ligase-DpnI). This differs from the QuikChange
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

function buildProcedure(recordName, editLabel, changeTail, splitTail = false) {
  const forwardNote = changeTail
    ? (splitTail
        ? `the two 5' tails reconstruct the ${editLabel} after circularisation`
        : `the forward primer carries the ${editLabel} (${changeTail}) at its 5' end`)
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
  // Accepts one warning or a list, so a route can say what blocked it as well
  // as that it was blocked.
  const infeasible = (warning) => {
    const warnings = [warning].flat().filter(Boolean);
    return {
      feasible: false,
      plans: [{ label: 'Q5/KLD site-directed mutagenesis', plan: { feasible: false, recommendedAssemblyStrategy: 'site-directed-mutagenesis', primerOligoPlan: null, restrictionEnzymeSelection: null, stepByStepProcedure: [], warnings } }],
      primers: [],
      warnings,
      summary
    };
  };

  const ambiguityWarnings = [
    describeAmbiguousDna(payload?.originalSequence, 'Q5/KLD template'),
    describeAmbiguousDna(payload?.editedSequence, 'Q5/KLD result'),
    describeAmbiguousDna(payload?.editRequest?.originalSequence, 'Q5/KLD edited source'),
    describeAmbiguousDna(payload?.editRequest?.editedSequence, 'Q5/KLD edited bases')
  ].filter(Boolean);
  if (ambiguityWarnings.length) {
    return infeasible(ambiguityWarnings);
  }

  if (!originalSequence.length || !normalizedEdit) {
    return infeasible('Edit the sequence before designing a Q5/KLD route.');
  }
  if (!circular) {
    return infeasible('Q5/KLD whole-plasmid mutagenesis requires a circular plasmid template. Use overlap PCR or an assembly route for a linear template.');
  }

  const editLabel = EDIT_LABELS[normalizedEdit.type] || 'edit';
  const changeTail = normalizedEdit.type === 'deletion' ? '' : normalizeSequence(normalizedEdit.editedSequence || '');
  const { downstream, upstream } = flankWindows(originalSequence, normalizedEdit.startIndex, normalizedEdit.endIndex, circular);
  let selectedSplitTail = false;

  const design = designWithThresholdFallback((thresholds) => {
    const specificityConfig = {
      ...config,
      specificitySequence: originalSequence,
      specificityCircular: circular
    };
    const splits = [0];
    for (let split = 1; split < changeTail.length; split += 1) {
      splits.push(split);
    }
    let best = null;
    splits.forEach((split) => {
      const upstreamAddedSequence = changeTail.slice(0, split);
      const downstreamAddedSequence = changeTail.slice(split);
      const forwardTail = downstreamAddedSequence;
      const reverseTail = reverseComplementDna(upstreamAddedSequence);
      const forwardBinding = selectBindingWindow(downstream, 'forward', thresholds, forwardTail.length, specificityConfig);
      const reverseBinding = selectBindingWindow(upstream, 'reverse', thresholds, reverseTail.length, specificityConfig);
      if (!forwardBinding || !reverseBinding) {
        return;
      }
      const totalForwardLength = forwardTail.length + forwardBinding.length;
      const totalReverseLength = reverseTail.length + reverseBinding.length;
      const score = Math.abs(totalForwardLength - totalReverseLength)
        + Math.max(totalForwardLength, totalReverseLength) * 0.05
        + Math.abs(forwardBinding.tm - reverseBinding.tm)
        + (split > 0 ? 1000 : 0);
      if (!best || score < best.score) {
        best = { split, forwardTail, reverseTail, forwardBinding, reverseBinding, score };
      }
    });
    if (!best) {
      // Probe with no tail: the most room a binding window can get here.
      const reason = describeBindingWindowFailure(downstream, 'forward', thresholds, 0, specificityConfig)
        || describeBindingWindowFailure(upstream, 'reverse', thresholds, 0, specificityConfig);
      return {
        feasible: false,
        warnings: [
          `No unique back-to-back primer pair matched the current threshold band${changeTail.length ? ' after distributing the edit across the available 5\' tail capacity' : ''}.`,
          reason
        ].filter(Boolean)
      };
    }
    selectedSplitTail = best.split > 0;

    const primers = [
      buildPrimerRecord({
        name: 'q5_F',
        role: 'mutagenesis-forward',
        sequence: `${best.forwardTail}${best.forwardBinding.bindingSequence}`,
        tailSequence: best.forwardTail,
        bindingSequence: best.forwardBinding.bindingSequence,
        warnings: [changeTail
          ? (selectedSplitTail ? `Carries the downstream ${best.forwardTail.length} nt of the ${editLabel}.` : `Carries the ${editLabel} (${changeTail}) at the 5' end.`)
          : `Anneals immediately 3' of the ${editLabel}.`]
      }),
      buildPrimerRecord({
        name: 'q5_R',
        role: 'mutagenesis-reverse',
        sequence: `${best.reverseTail}${best.reverseBinding.bindingSequence}`,
        tailSequence: best.reverseTail,
        bindingSequence: best.reverseBinding.bindingSequence,
        warnings: [selectedSplitTail
          ? `Carries the reverse complement of the upstream ${best.split} nt of the ${editLabel}; KLD ligation reconstructs the full edit.`
          : "Anneals back-to-back with the forward primer (5' ends abut for KLD ligation)."]
      })
    ];
    return { feasible: true, primers, warnings: [], ...summarizePrimerPlan(primers) };
  });

  if (!design.feasible) {
    return infeasible(asArray(design.warnings).filter(Boolean).length ? asArray(design.warnings) : 'Unable to design the Q5/KLD primer pair.');
  }

  // Hairpins, self-dimers and homopolymers reach the caller through
  // design.warnings; dropping them here left the route reporting "no warnings"
  // on a primer the quality check had already flagged.
  const warnings = asArray(design.warnings).filter(Boolean);

  const plan = {
    feasible: true,
    recommendedAssemblyStrategy: 'site-directed-mutagenesis',
    primerOligoPlan: {
      primers: design.primers,
      selectedThresholdLevel: design.selectedThresholdLevel,
      warnings
    },
    restrictionEnzymeSelection: null,
    stepByStepProcedure: buildProcedure(recordName, editLabel, changeTail, selectedSplitTail),
    warnings
  };

  return {
    feasible: true,
    plans: [{ label: 'Q5/KLD site-directed mutagenesis', plan }],
    primers: design.primers.map((primer) => ({ ...primer, groupLabel: 'Whole-plasmid PCR' })),
    warnings,
    summary
  };
}
