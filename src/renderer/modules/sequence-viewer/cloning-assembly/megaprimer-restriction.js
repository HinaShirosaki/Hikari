import { buildCommercialRestrictionFeatures } from '../restriction-analysis.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, normalizeSequence } from './sequence-utils.js';
import { normalizeEditRequest } from './edit-map.js';
import { selectBindingWindow } from './overlap-windows.js';
import { buildPrimerRecord, summarizePrimerPlan } from './primer-records.js';
import { designSimpleMutagenesisPrimers } from './mutagenesis-simple.js';
import { designWithThresholdFallback } from './strategy.js';
import { normalizeVendorFilter, restrictionCutOverhang } from './restriction-ligation.js';

// Megaprimer restriction-ligation mutagenesis. Uses two *native* unique cutters
// that flank the edit in the plasmid:
//   PCR1: mutagenesis primer (carries the edit) + downstream restriction primer
//         -> megaprimer spanning edit..downstream site
//   PCR2: purified megaprimer + upstream restriction primer, on the plasmid
//         -> full fragment carrying both sites and the edit
//   double digest the fragment and the backbone, then ligate.
// The primers only bind across sites already present, so nothing is appended.

function featureCut(feature) {
  if (feature?.cut) {
    return feature.cut;
  }
  const patterns = asArray(feature?.cutPatterns);
  return patterns.length ? patterns[0] : '';
}

function isSticky(feature) {
  return restrictionCutOverhang(featureCut(feature)).type === 'sticky';
}

// Nearest flanking unique cutter, sticky-overhang preferred. `side` picks which
// edge of the edit the site must sit outside of.
function pickFlankingSite(features, side, editStart, editEnd, excludeSite) {
  const candidates = features
    .filter((feature) => feature.site && feature.site !== excludeSite)
    .map((feature) => {
      const start = Number(feature?.segments?.[0]?.start);
      const end = Number(feature?.segments?.[0]?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
      }
      if (side === 'upstream' && end > editStart) {
        return null;
      }
      if (side === 'downstream' && start < editEnd) {
        return null;
      }
      const distance = side === 'upstream' ? editStart - end : start - editEnd;
      return { feature, distance };
    })
    .filter(Boolean);
  candidates.sort((left, right) => {
    const stickyGap = (isSticky(right.feature) ? 1 : 0) - (isSticky(left.feature) ? 1 : 0);
    return stickyGap || (left.distance - right.distance);
  });
  return candidates[0]?.feature || null;
}

function withGroup(primer, groupLabel) {
  return primer ? { ...primer, groupLabel } : primer;
}

function buildProcedure(recordName, siteUp, siteDn) {
  const upName = siteUp.name || siteUp.site;
  const dnName = siteDn.name || siteDn.site;
  return [
    { title: 'PCR 1 — introduce the edit', details: `Amplify ${recordName} with the mutagenesis primer (carries the edit) paired with the ${dnName} restriction primer. The product is the megaprimer, spanning the edit through the ${dnName} site.` },
    { title: 'Purify PCR 1 product', details: 'Gel- or column-purify the megaprimer so no template or primers carry into the next reaction.' },
    { title: 'PCR 2 — extend to both sites', details: `Amplify ${recordName} again using the purified megaprimer together with the ${upName} restriction primer. The product spans ${upName}..${dnName} and now carries the edit plus both native restriction sites.` },
    { title: 'Double digest', details: `Digest the PCR 2 fragment and the ${recordName} backbone with ${upName} + ${dnName}, then purify both.` },
    { title: 'Ligate', details: `Ligate the digested fragment into the ${upName}/${dnName}-cut backbone.` },
    { title: 'Transform and screen', details: 'Transform competent cells, then confirm the edit window and both junctions by colony PCR and sequencing.' }
  ];
}

export function buildMegaprimerRestrictionPlan(payload = {}) {
  const config = { ...DEFAULT_CLONING_PREFERENCES, ...(payload?.preferences || {}) };
  const originalSequence = normalizeSequence(payload?.originalSequence || '');
  const editedSequence = normalizeSequence(payload?.editedSequence || '');
  const recordName = String(payload?.recordName || '').trim() || 'the plasmid';
  const topology = String(payload?.topology || '').toLowerCase() === 'linear' ? 'linear' : 'circular';
  const normalizedEdit = normalizeEditRequest(payload?.editRequest, originalSequence);

  const summary = {
    templateLength: originalSequence.length,
    resultLength: editedSequence.length,
    insertLength: 0
  };
  const infeasible = (warning) => ({
    feasible: false,
    plans: [{ label: 'Megaprimer restriction cloning', plan: { feasible: false, recommendedAssemblyStrategy: 'restriction-ligation', primerOligoPlan: null, restrictionEnzymeSelection: null, stepByStepProcedure: [], warnings: [warning] } }],
    primers: [],
    warnings: [warning],
    summary
  });

  if (!originalSequence.length || !normalizedEdit) {
    return infeasible('Edit the sequence before designing a megaprimer restriction route.');
  }

  const features = buildCommercialRestrictionFeatures(originalSequence, topology, {
    vendorFilter: normalizeVendorFilter(config.vendorFilter)
  }).filter((feature) => String(feature?.type || '').toLowerCase() === 'restriction_site');

  const siteUp = pickFlankingSite(features, 'upstream', normalizedEdit.startIndex, normalizedEdit.endIndex);
  const siteDn = pickFlankingSite(features, 'downstream', normalizedEdit.startIndex, normalizedEdit.endIndex, siteUp?.site);
  if (!siteUp || !siteDn) {
    return infeasible('No pair of unique restriction sites flanks the edit on both sides; try a different route or add sites.');
  }

  summary.insertLength = Math.max(0, Number(siteDn.segments[0].end) - Number(siteUp.segments[0].start));

  const design = designWithThresholdFallback((thresholds) => {
    const mutagenesis = designSimpleMutagenesisPrimers(originalSequence, normalizedEdit, thresholds, config);
    const mutForward = asArray(mutagenesis?.primers).find((primer) => primer.role === 'mutagenesis-forward');
    const forwardWindow = selectBindingWindow(originalSequence.slice(Number(siteUp.segments[0].start)), 'forward', thresholds, 0, config);
    const reverseWindow = selectBindingWindow(originalSequence.slice(0, Number(siteDn.segments[0].end)), 'reverse', thresholds, 0, config);
    if (!mutForward || !forwardWindow || !reverseWindow) {
      return { feasible: false, warnings: ['No primer set matched the current threshold band for the megaprimer route.'] };
    }

    const primers = [
      buildPrimerRecord({
        name: `${siteUp.name || siteUp.site}_F`,
        role: 'restriction-forward',
        sequence: forwardWindow.bindingSequence,
        bindingSequence: forwardWindow.bindingSequence,
        warnings: [`Binds across the native ${siteUp.name || siteUp.site} (${siteUp.site}) site upstream of the edit.`]
      }),
      { ...mutForward, name: 'mutagenesis_F' },
      buildPrimerRecord({
        name: `${siteDn.name || siteDn.site}_R`,
        role: 'restriction-reverse',
        sequence: reverseWindow.bindingSequence,
        bindingSequence: reverseWindow.bindingSequence,
        warnings: [`Binds across the native ${siteDn.name || siteDn.site} (${siteDn.site}) site downstream of the edit.`]
      })
    ];
    return { feasible: true, primers, warnings: [], ...summarizePrimerPlan(primers) };
  });

  if (!design.feasible) {
    return infeasible(asArray(design.warnings)[0] || 'Unable to design the megaprimer primer set.');
  }

  const [restrictionForward, mutForward, restrictionReverse] = design.primers;
  const plan = {
    feasible: true,
    recommendedAssemblyStrategy: 'restriction-ligation',
    primerOligoPlan: {
      primers: design.primers,
      selectedThresholdLevel: design.selectedThresholdLevel,
      warnings: []
    },
    restrictionEnzymeSelection: [siteUp, siteDn],
    stepByStepProcedure: buildProcedure(recordName, siteUp, siteDn),
    warnings: []
  };

  return {
    feasible: true,
    plans: [{ label: 'Megaprimer restriction cloning', plan }],
    // groupLabel marks the PCR the primer is first added to (see procedure).
    primers: [
      withGroup(mutForward, 'PCR 1'),
      withGroup(restrictionReverse, 'PCR 1'),
      withGroup(restrictionForward, 'PCR 2')
    ],
    warnings: [],
    summary
  };
}
