import { buildCommercialRestrictionFeatures } from '../restriction-analysis.js';
import { DEFAULT_CLONING_PREFERENCES } from './constants.js';
import { asArray, describeAmbiguousDna, normalizeSequence } from './sequence-utils.js';
import { designAssemblyPrimersForRoute } from './assembly-primers.js';
import { evaluateOverlapPcr } from './overlap-evaluation.js';
import { summarizePrimerPlan } from './primer-records.js';
import { designWithThresholdFallback } from './strategy.js';
import {
  expandRestrictionFeatureVariants,
  normalizeVendorFilter,
  restrictionCutEnd,
  restrictionCutOverhang,
  restrictionEndsAreCrossCompatible,
  sequenceContainsSite
} from './restriction-ligation.js';

// Overlap-extension cloning for an insert whose vector cut sites are out of
// primer reach. A primer carries at most ~40 nt of 5' tail, so a unique site
// sitting hundreds of bp from the insertion point cannot simply be tailed onto
// the insert primers (that is the plain restriction-ligation route). Instead the
// vector stretch between the insertion point and the nearest usable cutter is
// amplified on each side as its own fragment, and the three products are fused:
//   PCR 1: upstream vector flank, upstream site -> insertion point
//   PCR 2: the DNA of interest (off the donor plasmid, when one is given)
//   PCR 3: downstream vector flank, insertion point -> downstream site
//   SOE:   the three amplicons prime each other on their shared ends -> one
//          fragment that now carries both native sites, so it digests and
//          ligates into the cut vector normally.
// Both flanks are native vector sequence, so the ligated product is scarless;
// only the outer clamp bases are added, and the digest cuts those off.

// A site closer than this to the insertion point is reachable from a primer
// tail, and this route's two extra PCRs would buy nothing.
const PRIMER_TAIL_REACH = 40;

function featureCut(feature) {
  if (feature?.cut) {
    return feature.cut;
  }
  const patterns = [...new Set(asArray(feature?.cutPatterns).filter(Boolean))];
  return patterns.length === 1 ? patterns[0] : '';
}

function isSticky(feature) {
  return restrictionCutOverhang(featureCut(feature)).type === 'sticky';
}

function siteName(feature) {
  return feature?.name || feature?.site || 'restriction site';
}

// Unique cutters on one side of the insertion point, ordered by how much vector
// the fusion fragment has to carry to reach them. Sticky cutters come first:
// they ligate directionally and far more efficiently than blunt ones.
function rankSites(features, side, backboneLength, insert, excludeSite) {
  return features
    .filter((feature) => (
      feature.site
      && feature.site !== excludeSite
      // Both sites sit at an end of the fusion fragment, so the enzyme has to
      // cut inside its own recognition sequence ('G^AATTC'). A Type IIS/III
      // cutter ('CAGCAG(25/27)') would cut past the end of the fragment.
      && featureCut(feature).includes('^')
      // A site inside the insert would be cut mid-fragment during the digest.
      && !sequenceContainsSite(insert, feature.site)
    ))
    .map((feature) => {
      const start = Number(feature?.segments?.[0]?.start);
      const end = Number(feature?.segments?.[0]?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }
      return {
        feature,
        start,
        end,
        flankLength: side === 'upstream' ? backboneLength - start : end
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      ((isSticky(right.feature) ? 1 : 0) - (isSticky(left.feature) ? 1 : 0))
      || (left.flankLength - right.flankLength)
    ));
}

function describeMissingSite(ranked, side) {
  const nearest = ranked.reduce(
    (best, candidate) => (!best || candidate.flankLength < best.flankLength ? candidate : best),
    null
  );
  return nearest
    ? `The nearest ${side} unique cutter (${siteName(nearest.feature)}) sits ${nearest.flankLength} bp from the insertion point, within primer-tail reach; use restriction-ligation instead.`
    : `No unique commercial restriction site lies ${side} of the insertion point outside the insert.`;
}

function buildProcedure({
  recordName,
  templateName,
  upstreamSite,
  downstreamSite,
  upstreamLength,
  insertLength,
  downstreamLength,
  fusionLength
}) {
  const upName = siteName(upstreamSite);
  const dnName = siteName(downstreamSite);
  return [
    { title: `PCR 1 — upstream vector flank (${upstreamLength} bp)`, details: `Amplify ${recordName} from the ${upName} site through to the insertion point. The forward primer adds a short clamp so ${upName} cuts the end efficiently; the reverse primer carries the overlap into the insert.` },
    { title: `PCR 2 — insert (${insertLength} bp)`, details: `Amplify the DNA of interest from ${templateName}. Its reverse primer carries the overlap into the downstream vector flank.` },
    { title: `PCR 3 — downstream vector flank (${downstreamLength} bp)`, details: `Amplify ${recordName} from the insertion point through the ${dnName} site; the reverse primer adds the clamp for that end.` },
    { title: 'Purify the three amplicons', details: 'Gel- or column-purify each product and quantify it. Carried-over template or primers seed the wrong fusion in the next step.' },
    { title: `Overlap-extension PCR (${fusionLength} bp)`, details: 'Mix the three purified amplicons in equimolar amounts and run 5-10 cycles with no primers so the shared ends prime each other, then add the outer pair (upstream flank forward + downstream flank reverse) and amplify the full-length fusion.' },
    { title: 'Double digest', details: `Digest the fusion product and ${recordName} with ${upName} + ${dnName}, then purify both.` },
    { title: 'Ligate, transform, screen', details: `Ligate the digested fusion into the ${upName}/${dnName}-cut vector, transform competent cells, and confirm both vector junctions and the insert by colony PCR and sequencing.` }
  ];
}

export function buildOverlapExtensionLigationPlan(payload = {}) {
  const config = { ...DEFAULT_CLONING_PREFERENCES, ...(payload?.preferences || {}) };
  const sequence = normalizeSequence(payload?.sequence || '');
  const recordName = String(payload?.recordName || '').trim() || 'the vector';
  const topology = String(payload?.topology || '').toLowerCase() === 'linear' ? 'linear' : 'circular';
  const start = Math.max(0, Math.min(sequence.length, Math.round(Number(payload?.range?.start) || 0)));
  const end = Math.max(start, Math.min(sequence.length, Math.round(Number(payload?.range?.end) || start)));
  const insert = sequence.slice(start, end);
  const backbone = `${sequence.slice(end)}${sequence.slice(0, start)}`;
  const donorSequence = normalizeSequence(payload?.donor?.sequence || '');
  const donorName = String(payload?.donor?.name || '').trim();
  // Specificity for the flank primers is judged over the whole plasmid they are
  // amplified from, not just the flank: a window unique to the flank can still
  // prime elsewhere on the vector.
  const vectorSequence = normalizeSequence(payload?.vectorSequence || '') || backbone;

  const summary = {
    templateLength: vectorSequence.length,
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
      plans: [{ label: 'Overlap-extension cloning', plan: { feasible: false, recommendedAssemblyStrategy: 'restriction-ligation', primerOligoPlan: null, restrictionEnzymeSelection: null, stepByStepProcedure: [], warnings } }],
      primers: [],
      warnings,
      summary
    };
  };

  const ambiguityWarnings = [
    describeAmbiguousDna(payload?.sequence, 'Overlap-extension result'),
    describeAmbiguousDna(payload?.donor?.sequence, 'Overlap-extension donor'),
    describeAmbiguousDna(payload?.insertTemplate, 'Overlap-extension insert template'),
    describeAmbiguousDna(payload?.vectorSequence, 'Overlap-extension vector template')
  ].filter(Boolean);
  if (ambiguityWarnings.length) {
    return infeasible(ambiguityWarnings);
  }

  if (!insert.length || !backbone.length) {
    return infeasible('Select an insert range inside the construct before designing an overlap-extension route.');
  }
  // Sites are searched on the backbone as a linear stretch: the two ends of that
  // stretch meet only through the insertion point, so a match spanning the join
  // does not exist in the finished construct.
  const features = buildCommercialRestrictionFeatures(backbone, 'linear', {
    vendorFilter: normalizeVendorFilter(config.vendorFilter)
  })
    .filter((feature) => String(feature?.type || '').toLowerCase() === 'restriction_site')
    .flatMap(expandRestrictionFeatureVariants);

  const downstreamRanked = rankSites(features, 'downstream', backbone.length, insert, '');
  const downstream = downstreamRanked.find((candidate) => candidate.flankLength >= PRIMER_TAIL_REACH);
  if (!downstream) {
    return infeasible(describeMissingSite(downstreamRanked, 'downstream'));
  }
  const upstreamRanked = rankSites(features, 'upstream', backbone.length, insert, downstream.feature.site);
  const upstream = upstreamRanked.find((candidate) => (
    candidate.flankLength >= PRIMER_TAIL_REACH
    && candidate.start >= downstream.end
    && !restrictionEndsAreCrossCompatible(
      restrictionCutEnd(candidate.feature, backbone),
      restrictionCutEnd(downstream.feature, backbone)
    )
  ));
  if (!upstream) {
    return infeasible(describeMissingSite(upstreamRanked, 'upstream'));
  }

  // No template named is a note on the insert primers, not a blocked route: the
  // user picks the template in Vector Builder / Protein Builder, and the design
  // proceeds off the assembled sequence either way.
  const insertTemplate = donorSequence || normalizeSequence(payload?.insertTemplate || '');

  const clamp = normalizeSequence(config.primerClampSequence || DEFAULT_CLONING_PREFERENCES.primerClampSequence);
  const upstreamFlank = backbone.slice(upstream.start);
  const downstreamFlank = backbone.slice(0, downstream.end);
  const vectorMetadata = {
    specificitySequence: vectorSequence,
    specificityCircular: topology === 'circular'
  };
  // The clamp rides on the desired sequence rather than the template, so the
  // shared primer designer emits it as a 5' tail on the outer two primers.
  const fragments = [
    {
      id: 'oe_upstream_flank',
      name: 'Upstream vector backbone',
      type: 'insert',
      sequence: `${clamp}${upstreamFlank}`,
      metadata: { ...vectorMetadata, templateSequence: upstreamFlank }
    },
    {
      id: 'oe_insert',
      name: 'Insert',
      type: 'insert',
      sequence: insert,
      metadata: {
        source: donorSequence ? 'donor_plasmid' : 'sequence_viewer_edit',
        templateSequence: insertTemplate,
        templateName: donorName || recordName,
        specificitySequence: donorSequence || normalizeSequence(payload?.insertTemplateHostSequence || '') || insertTemplate,
        specificityCircular: donorSequence
          ? String(payload?.donor?.topology || 'circular').toLowerCase() !== 'linear'
          : Boolean(payload?.insertTemplateCircular)
      }
    },
    {
      id: 'oe_downstream_flank',
      name: 'Downstream vector backbone',
      type: 'insert',
      sequence: `${downstreamFlank}${clamp}`,
      metadata: { ...vectorMetadata, templateSequence: downstreamFlank }
    }
  ];

  const design = designWithThresholdFallback((thresholds) => {
    const overlapPcr = evaluateOverlapPcr(fragments, { preferences: config, thresholds });
    if (!overlapPcr.feasible) {
      return {
        feasible: false,
        primers: [],
        warnings: [...asArray(overlapPcr.failureReasons), ...asArray(overlapPcr.warnings)]
      };
    }
    const base = designAssemblyPrimersForRoute(fragments, overlapPcr.junctions, thresholds, config);
    if (!base.feasible) {
      return base;
    }
    // A primer-introduced overlap is the point of this route, so the junction
    // notes that say so are not warnings here -- but what the stated insert
    // template could not confirm still is, and `base.warnings` now carries only
    // those.
    return { ...base, ...summarizePrimerPlan(base.primers, overlapPcr.junctions) };
  });

  if (!design.feasible) {
    return infeasible(asArray(design.warnings).filter(Boolean).length
      ? asArray(design.warnings)
      : 'Unable to design a complete overlap-extension primer set.');
  }

  const fusionLength = fragments.reduce((total, fragment) => total + fragment.sequence.length, 0);
  const enzymes = [upstream.feature, downstream.feature];
  const warnings = [
    ...asArray(design.warnings),
    `Neither ${siteName(upstream.feature)} nor ${siteName(downstream.feature)} cuts inside the insert or a second time in the vector, so the fusion survives the digest intact.`
  ].filter(Boolean);

  const plan = {
    feasible: true,
    recommendedAssemblyStrategy: 'restriction-ligation',
    primerOligoPlan: {
      primers: design.primers,
      selectedThresholdLevel: design.selectedThresholdLevel,
      warnings
    },
    restrictionEnzymeSelection: enzymes,
    stepByStepProcedure: buildProcedure({
      recordName,
      templateName: donorName || recordName,
      upstreamSite: upstream.feature,
      downstreamSite: downstream.feature,
      upstreamLength: fragments[0].sequence.length,
      insertLength: insert.length,
      downstreamLength: fragments[2].sequence.length,
      fusionLength
    }),
    warnings
  };

  return {
    feasible: true,
    plans: [{ label: 'Overlap-extension cloning', plan }],
    primers: design.primers,
    warnings,
    summary: { ...summary, fusionLength }
  };
}
