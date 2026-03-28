# Cloning Assembly Agent Idea

## Goal
Build an agent-assisted cloning workflow that helps users assemble tags and multiple protein coding sequences into a single plasmid construct.

The system should support practical lab design decisions rather than only sequence manipulation.

## Core assumptions
- Protein coding sequences are already available in stock.
- For short inserts or edits shorter than about 30 amino acids, the system should prefer introducing them through primers or existing template sequence rather than gene synthesis.
- Full synthesis followed by in-house cloning is generally not meaningful when the needed sequence is already available.
- The workflow should choose between **traditional restriction-ligation cloning** and **Gibson assembly** based on construct structure and feasibility.

## Agent role
The LLM agent should help:
- plan cloning strategy
- choose assembly method
- design cloning logic
- call tools for primer and oligo generation
- generate a detailed experimental plan

The agent may reason about primers, overlaps, and restriction sites, but it is **not allowed to directly output primer sequences** in free text.

Instead, primer or oligo sequences must only be returned through a dedicated tool call that also reports relevant parameters such as:
- oligo sequence
- melting temperature (Tm)
- length
- GC content
- optional warnings

## Required functions

### 1. `overlap_pcr(array)`
Determine whether a set of input sequences can be assembled by overlap PCR.

**Expected behavior:**
- evaluate whether adjacent fragments contain sufficient overlap potential
- determine whether overlap PCR is feasible for the full assembly
- report calculated overlap Tm values
- identify problematic junctions
- suggest whether additional primer-introduced overlap is required

**Suggested output:**
- feasible: true/false
- junction-by-junction summary
- overlap lengths
- overlap Tm values
- warnings and failure reasons

### 2. `gibson_assemble(array)`
Determine whether a set of input sequences can be assembled by Gibson assembly.

**Expected behavior:**
- evaluate whether required overlaps can be created or already exist
- determine whether the full fragment set is suitable for Gibson assembly
- identify assembly bottlenecks
- report overlap quality and expected compatibility

**Suggested output:**
- feasible: true/false
- fragment order
- junction overlap summary
- overlap Tm values
- warnings and failure reasons

### 3. Site-directed mutagenesis function
Support point mutation, small insertion, deletion, or short sequence replacement workflows.

**Expected behavior:**
- determine whether the requested edit is suitable for site-directed mutagenesis
- recommend mutagenesis versus re-assembly when appropriate
- call primer-design tools when mutagenesis is feasible
- provide a mutation validation plan

## Decision logic
The agent should choose the cloning route using rules like these:
- use **restriction-ligation** when suitable unique restriction sites exist and the cloning path is simple
- use **Gibson assembly** when multiple fragments must be assembled or when restriction sites are limiting
- use **overlap PCR** when fragment fusion can be achieved efficiently through PCR-generated overlaps
- use **site-directed mutagenesis** for local edits rather than rebuilding the whole construct

## Final output
The final system output should include:
- recommended assembly strategy
- ordered fragment map
- assembled vector design
- primer/oligo tool calls where needed
- restriction enzyme selection when applicable
- expected junction logic
- step-by-step PCR and assembly procedure
- validation plan, including colony PCR or sequencing recommendations

## Future extensions
Possible future improvements:
- automatic backbone selection
- codon optimization recommendation when stock sequence is unsuitable
- cloning scar detection
- tag orientation and linker recommendation
- reading frame validation
- enzyme compatibility checking
- automated plasmid map rendering

## Primer design fallback logic for long peptide insertion
For long peptide insertions introduced by primers, the system should support **multi-primer tiling** rather than assuming the full insert must be encoded in a single primer.

### Design rule
- if the peptide or encoded DNA addition is too long for a single primer with acceptable Tm and length, split the added region across multiple primers
- the system should evaluate adjacent primer overlap compatibility for multi-primer introduction workflows
- the agent should attempt strict primer design thresholds first, then relax thresholds in controlled steps only if necessary
- every relaxation step should be explicitly reported in the design result

### Three-level threshold check
The primer design tool should support three threshold levels when evaluating candidate primers:

#### Level 1: strict
- use preferred primer length window
- use preferred Tm window
- use strict maximum forward/reverse primer Tm difference
- use preferred overlap Tm window for adjacent primer-introduced segments

#### Level 2: moderate fallback
- allow slightly broader primer length window
- allow slightly broader Tm window
- allow slightly larger Tm difference
- allow slightly broader overlap Tm tolerance

#### Level 3: relaxed fallback
- allow the broadest acceptable primer length window
- allow the broadest acceptable Tm window
- allow the largest acceptable Tm difference still considered experimentally reasonable
- allow broader overlap Tm tolerance, but return warnings that optimization may be required

### Expected behavior
- attempt primer design using **Level 1** thresholds first
- if no valid design exists, retry using **Level 2** thresholds
- if Level 2 still fails, retry using **Level 3** thresholds
- if all three levels fail, report that primer-based introduction is not recommended and suggest alternate strategies such as Gibson assembly, overlap PCR, or gene synthesis
- if multi-primer insertion is selected, report primer order, overlap logic, and which threshold level succeeded

### Suggested helper function
```javascript
const PRIMER_TM_THRESHOLDS = {
  strict: {
    primerLength: { min: 18, max: 32 },
    primerTm: { min: 58, max: 64 },
    maxPrimerTmDifference: 2,
    overlapTm: { min: 60, max: 68 },
    maxOverlapTmDifference: 2
  },
  moderate: {
    primerLength: { min: 16, max: 36 },
    primerTm: { min: 56, max: 66 },
    maxPrimerTmDifference: 4,
    overlapTm: { min: 58, max: 70 },
    maxOverlapTmDifference: 4
  },
  relaxed: {
    primerLength: { min: 15, max: 40 },
    primerTm: { min: 54, max: 68 },
    maxPrimerTmDifference: 6,
    overlapTm: { min: 56, max: 72 },
    maxOverlapTmDifference: 6
  }
};

function evaluatePrimerPair(forwardPrimer, reversePrimer, thresholds) {
  const tmF = getTm(forwardPrimer.sequence);
  const tmR = getTm(reversePrimer.sequence);
  const lenF = forwardPrimer.sequence.length;
  const lenR = reversePrimer.sequence.length;

  const lengthOk =
    lenF >= thresholds.primerLength.min &&
    lenF <= thresholds.primerLength.max &&
    lenR >= thresholds.primerLength.min &&
    lenR <= thresholds.primerLength.max;

  const tmOk =
    tmF >= thresholds.primerTm.min &&
    tmF <= thresholds.primerTm.max &&
    tmR >= thresholds.primerTm.min &&
    tmR <= thresholds.primerTm.max;

  const tmDifferenceOk = Math.abs(tmF - tmR) <= thresholds.maxPrimerTmDifference;

  return {
    feasible: lengthOk && tmOk && tmDifferenceOk,
    tmF,
    tmR,
    lenF,
    lenR,
    tmDifference: Math.abs(tmF - tmR),
    checks: {
      lengthOk,
      tmOk,
      tmDifferenceOk
    }
  };
}

function evaluateOverlapPair(leftPrimer, rightPrimer, thresholds) {
  const overlapSequence = longestCommonSubstring(leftPrimer.sequence, rightPrimer.sequence);
  const overlapTm = getTm(overlapSequence);

  const overlapTmOk =
    overlapTm >= thresholds.overlapTm.min &&
    overlapTm <= thresholds.overlapTm.max;

  return {
    overlapSequence,
    overlapLength: overlapSequence.length,
    overlapTm,
    feasible: overlapTmOk,
    checks: {
      overlapTmOk
    }
  };
}

function designWithThresholdFallback(designCallback) {
  const levels = [
    ["strict", PRIMER_TM_THRESHOLDS.strict],
    ["moderate", PRIMER_TM_THRESHOLDS.moderate],
    ["relaxed", PRIMER_TM_THRESHOLDS.relaxed]
  ];

  const attempts = [];

  for (const [levelName, thresholds] of levels) {
    const result = designCallback(thresholds, levelName);
    attempts.push({
      level: levelName,
      feasible: !!result?.feasible,
      result
    });

    if (result?.feasible) {
      return {
        feasible: true,
        selectedThresholdLevel: levelName,
        thresholds,
        attempts,
        result
      };
    }
  }

  return {
    feasible: false,
    selectedThresholdLevel: null,
    attempts,
    warning:
      "Primer design failed under strict, moderate, and relaxed thresholds. Consider Gibson assembly, overlap PCR, or synthesis."
  };
}
```

### Multi-primer insertion planning
For long inserts introduced by primers, the tool should also support a workflow like this:
- split the inserted DNA across 2 or more primers
- require adjacent inserted segments to share a defined overlap region
- evaluate overlap Tm and overlap length for every adjacent primer pair
- reject designs where only the outer primers pass but internal overlap primers are unstable
- return a full ordered primer set rather than only a forward/reverse pair

### Suggested result fields
- feasible: true/false
- selectedThresholdLevel: strict/moderate/relaxed/null
- primerCount
- primerOrder
- primerTmSummary
- primerTmDifferences
- overlapSummary
- warnings

## Suggested full assemble function scaffold
```javascript
function assembleCloningPlan({
  hostVectors = [],
  fragments = [],
  resultSequence = "",
  editRequest = null,
  preferences = {}
}) {
  const normalizedResultSequence = normalizeSequence(resultSequence);
  const warnings = [];
  const routeEvaluations = {};

  const defaultPreferences = {
    preferRestrictionLigation: true,
    preferGibsonForMultiFragment: true,
    maxPrimerEncodedInsertionAA: 30,
    maxPrimerLength: 60,
    requireUniqueRestrictionSites: true
  };

  const config = {
    ...defaultPreferences,
    ...preferences
  };

  if (!normalizedResultSequence && !editRequest && (!Array.isArray(fragments) || fragments.length === 0)) {
    return {
      feasible: false,
      recommendedStrategy: null,
      warnings: ["No valid input was provided for assembly planning."],
      alternateStrategyRecommendation: "Provide fragments, a target sequence, or an edit request."
    };
  }

  const normalizedFragments = (fragments || []).map((fragment, index) => ({
    id: fragment.id ?? `fragment_${index + 1}`,
    name: fragment.name ?? `fragment_${index + 1}`,
    sequence: normalizeSequence(fragment.sequence || ""),
    type: fragment.type ?? "insert",
    metadata: fragment.metadata ?? {}
  }));

  const hostMatches = normalizedResultSequence
    ? findHostVector(hostVectors, normalizedResultSequence)
    : [];

  const selectedHost = hostMatches.length > 0 ? hostMatches[0] : null;

  const fragmentMap = buildOrderedFragmentMap({
    host: selectedHost,
    fragments: normalizedFragments,
    resultSequence: normalizedResultSequence,
    editRequest
  });

  if (editRequest) {
    routeEvaluations.siteDirectedMutagenesis = evaluateSiteDirectedMutagenesis({
      editRequest,
      host: selectedHost,
      resultSequence: normalizedResultSequence,
      config
    });
  }

  if (fragmentMap.fragments.length >= 2) {
    routeEvaluations.overlapPCR = overlap_pcr(fragmentMap.fragments);
    routeEvaluations.gibson = gibson_assemble(fragmentMap.fragments);
  } else if (fragmentMap.fragments.length === 1 && selectedHost) {
    routeEvaluations.gibson = gibson_assemble([selectedHost.sequence, fragmentMap.fragments[0].sequence]);
  }

  routeEvaluations.restrictionLigation = evaluateRestrictionLigation({
    host: selectedHost,
    fragmentMap,
    config
  });

  const recommendedStrategy = chooseAssemblyStrategy({
    routeEvaluations,
    fragmentMap,
    editRequest,
    config
  });

  const assemblyDesign = buildAssemblyDesign({
    recommendedStrategy,
    selectedHost,
    fragmentMap,
    normalizedResultSequence,
    editRequest,
    config
  });

  const primerDesign = buildPrimerAndOligoPlan({
    recommendedStrategy,
    assemblyDesign,
    selectedHost,
    config
  });

  if (!primerDesign.feasible) {
    warnings.push(...(primerDesign.warnings || []));
  }

  const procedure = buildAssemblyProcedure({
    recommendedStrategy,
    assemblyDesign,
    primerDesign,
    selectedHost,
    config
  });

  const validationPlan = buildValidationPlan({
    recommendedStrategy,
    assemblyDesign,
    selectedHost,
    editRequest
  });

  warnings.push(...collectGlobalWarnings({
    selectedHost,
    fragmentMap,
    primerDesign,
    routeEvaluations,
    recommendedStrategy
  }));

  return {
    feasible: !!recommendedStrategy?.feasible,
    recommendedAssemblyStrategy: recommendedStrategy?.name ?? null,
    selectedHost: selectedHost
      ? {
          name: selectedHost.name,
          overlapSequence: selectedHost.overlapSequence,
          overlapLength: selectedHost.overlapLength
        }
      : null,
    orderedFragmentMap: fragmentMap,
    routeEvaluations,
    assembledVectorDesign: assemblyDesign,
    primerOligoPlan: primerDesign,
    restrictionEnzymeSelection:
      recommendedStrategy?.name === "restriction-ligation"
        ? routeEvaluations.restrictionLigation?.selectedSites ?? null
        : null,
    expectedJunctionLogic: assemblyDesign?.junctions ?? [],
    stepByStepProcedure: procedure,
    validationPlan,
    warnings,
    alternateStrategyRecommendation:
      recommendedStrategy?.feasible
        ? null
        : buildAlternateStrategyRecommendation(routeEvaluations)
  };
}

function normalizeSequence(seq) {
  return (seq || "").toUpperCase().replace(/[^ATCG]/g, "");
}

function buildOrderedFragmentMap({ host, fragments, resultSequence, editRequest }) {
  const orderedFragments = [];

  if (host) {
    orderedFragments.push({
      id: "host_backbone",
      name: host.name,
      role: "backbone",
      sequence: normalizeSequence(host.sequence || "")
    });
  }

  for (const fragment of fragments) {
    orderedFragments.push({
      id: fragment.id,
      name: fragment.name,
      role: fragment.type,
      sequence: fragment.sequence,
      metadata: fragment.metadata
    });
  }

  if (editRequest) {
    orderedFragments.push({
      id: "edit_request",
      name: "Requested edit",
      role: "edit",
      sequence: normalizeSequence(editRequest.editedSequence || "")
    });
  }

  return {
    fragments: orderedFragments,
    fragmentCount: orderedFragments.length,
    resultSequence,
    editSummary: editRequest
      ? {
          type: editRequest.type ?? null,
          position: editRequest.position ?? null,
          size: editRequest.size ?? null
        }
      : null
  };
}

function evaluateSiteDirectedMutagenesis({ editRequest, host, resultSequence, config }) {
  const editedLength = normalizeSequence(editRequest?.editedSequence || "").length;
  const originalLength = normalizeSequence(editRequest?.originalSequence || "").length;
  const deltaLength = Math.abs(editedLength - originalLength);
  const aaDelta = deltaLength / 3;

  const feasible =
    !!host &&
    ["point-mutation", "insertion", "deletion", "replacement"].includes(editRequest?.type) &&
    aaDelta <= config.maxPrimerEncodedInsertionAA;

  return {
    feasible,
    editType: editRequest?.type ?? null,
    deltaLength,
    aminoAcidDelta: aaDelta,
    reason: feasible
      ? "Local edit is suitable for mutagenesis-style primer design."
      : "Edit is too large or lacks a suitable template backbone for site-directed mutagenesis."
  };
}

function evaluateRestrictionLigation({ host, fragmentMap, config }) {
  if (!host || fragmentMap.fragments.length < 2) {
    return {
      feasible: false,
      reason: "Restriction-ligation requires a host backbone and at least one insert fragment."
    };
  }

  const selectedSites = findRestrictionCandidates(host.sequence, fragmentMap.fragments, config);
  const feasible = selectedSites.length > 0;

  return {
    feasible,
    selectedSites: feasible ? selectedSites.slice(0, 2) : null,
    reason: feasible
      ? "Suitable restriction sites were identified."
      : "No clean restriction-ligation path was identified."
  };
}

function findRestrictionCandidates(hostSequence, fragments, config) {
  const enzymeLibrary = [
    { name: "EcoRI", site: "GAATTC" },
    { name: "XhoI", site: "CTCGAG" },
    { name: "BamHI", site: "GGATCC" },
    { name: "NheI", site: "GCTAGC" },
    { name: "NotI", site: "GCGGCCGC" }
  ];

  const normalizedHost = normalizeSequence(hostSequence || "");
  const fragmentSequences = fragments.map(f => normalizeSequence(f.sequence || ""));

  return enzymeLibrary.filter(enzyme => {
    const hostCount = countOccurrences(normalizedHost, enzyme.site);
    const insertCounts = fragmentSequences.map(seq => countOccurrences(seq, enzyme.site));

    if (config.requireUniqueRestrictionSites && hostCount !== 1) return false;
    return insertCounts.every(count => count === 0);
  });
}

function countOccurrences(sequence, motif) {
  if (!sequence || !motif) return 0;
  let count = 0;
  let start = 0;

  while (true) {
    const index = sequence.indexOf(motif, start);
    if (index === -1) break;
    count += 1;
    start = index + 1;
  }

  return count;
}

function chooseAssemblyStrategy({ routeEvaluations, fragmentMap, editRequest, config }) {
  if (editRequest && routeEvaluations.siteDirectedMutagenesis?.feasible) {
    return {
      feasible: true,
      name: "site-directed mutagenesis",
      reason: routeEvaluations.siteDirectedMutagenesis.reason
    };
  }

  if (routeEvaluations.restrictionLigation?.feasible && fragmentMap.fragments.length <= 2 && config.preferRestrictionLigation) {
    return {
      feasible: true,
      name: "restriction-ligation",
      reason: routeEvaluations.restrictionLigation.reason
    };
  }

  if (routeEvaluations.gibson?.feasible && fragmentMap.fragments.length > 2 && config.preferGibsonForMultiFragment) {
    return {
      feasible: true,
      name: "Gibson assembly",
      reason: "Multi-fragment assembly is best handled by Gibson assembly."
    };
  }

  if (routeEvaluations.overlapPCR?.feasible) {
    return {
      feasible: true,
      name: "overlap PCR",
      reason: "Fragments have suitable overlap potential for PCR-based fusion."
    };
  }

  if (routeEvaluations.gibson?.feasible) {
    return {
      feasible: true,
      name: "Gibson assembly",
      reason: "Gibson assembly remains the best feasible fallback route."
    };
  }

  return {
    feasible: false,
    name: null,
    reason: "No assembly route passed feasibility checks."
  };
}

function buildAssemblyDesign({ recommendedStrategy, selectedHost, fragmentMap, normalizedResultSequence, editRequest }) {
  const orderedNames = fragmentMap.fragments.map(fragment => fragment.name);
  const junctions = [];

  for (let i = 0; i < fragmentMap.fragments.length - 1; i += 1) {
    const left = fragmentMap.fragments[i];
    const right = fragmentMap.fragments[i + 1];
    junctions.push({
      leftFragment: left.name,
      rightFragment: right.name,
      junctionType: recommendedStrategy?.name ?? "undetermined"
    });
  }

  return {
    strategy: recommendedStrategy?.name ?? null,
    hostBackbone: selectedHost?.name ?? null,
    orderedFragments: orderedNames,
    targetSequenceLength: normalizedResultSequence.length,
    editRequest: editRequest ?? null,
    junctions
  };
}

function buildPrimerAndOligoPlan({ recommendedStrategy, assemblyDesign, selectedHost, config }) {
  if (!recommendedStrategy?.feasible) {
    return {
      feasible: false,
      warnings: ["Primer planning was skipped because no assembly strategy was feasible."],
      toolCalls: []
    };
  }

  const strategyName = recommendedStrategy.name;

  if (strategyName === "site-directed mutagenesis") {
    return {
      feasible: true,
      mode: "mutagenesis",
      toolCalls: [
        {
          tool: "design_mutagenesis_primers",
          input: {
            backbone: selectedHost?.name ?? null,
            strategy: "site-directed mutagenesis"
          }
        }
      ],
      warnings: []
    };
  }

  if (strategyName === "Gibson assembly" || strategyName === "overlap PCR") {
    return {
      feasible: true,
      mode: strategyName,
      toolCalls: [
        {
          tool: "design_overlap_primers",
          input: {
            strategy: strategyName,
            orderedFragments: assemblyDesign.orderedFragments
          }
        }
      ],
      warnings: []
    };
  }

  if (strategyName === "restriction-ligation") {
    return {
      feasible: true,
      mode: "restriction-ligation",
      toolCalls: [
        {
          tool: "design_cloning_primers",
          input: {
            backbone: selectedHost?.name ?? null,
            addRestrictionSites: true
          }
        }
      ],
      warnings: []
    };
  }

  return {
    feasible: false,
    warnings: ["No primer design path matched the chosen assembly strategy."],
    toolCalls: []
  };
}

function buildAssemblyProcedure({ recommendedStrategy, assemblyDesign, primerDesign, selectedHost }) {
  if (!recommendedStrategy?.feasible) return [];

  const commonStart = [
    "Confirm source templates and ordered fragment layout.",
    "Generate primer or oligo designs through the appropriate sequence-design tool.",
    "PCR amplify required fragments using high-fidelity polymerase.",
    "Validate amplicons by gel electrophoresis and purify the correct bands."
  ];

  if (recommendedStrategy.name === "Gibson assembly") {
    return [
      ...commonStart,
      "Prepare overlapping DNA fragments according to the design plan.",
      "Set up the Gibson assembly reaction with equimolar fragment input.",
      "Transform competent cells with the assembly product.",
      "Plate colonies on the correct selection medium."
    ];
  }

  if (recommendedStrategy.name === "overlap PCR") {
    return [
      ...commonStart,
      "Run overlap extension PCR to fuse adjacent fragments.",
      "Re-amplify the full-length fused product with outer primers.",
      "Clone the final fused product into the destination vector.",
      "Transform competent cells and plate for selection."
    ];
  }

  if (recommendedStrategy.name === "restriction-ligation") {
    return [
      ...commonStart,
      "Digest vector and insert with the selected restriction enzymes.",
      "Purify digested DNA and set up ligation with insert-to-vector ratio optimization.",
      "Transform competent cells with the ligation product.",
      "Plate on selective medium and isolate colonies."
    ];
  }

  if (recommendedStrategy.name === "site-directed mutagenesis") {
    return [
      "Design mutagenic primers spanning the requested edit.",
      "Run whole-plasmid or fragment-based high-fidelity PCR.",
      "Digest parental template if required.",
      "Transform competent cells and recover edited clones."
    ];
  }

  return [];
}

function buildValidationPlan({ recommendedStrategy, assemblyDesign, selectedHost, editRequest }) {
  return {
    recommendedChecks: [
      "Colony PCR across key junctions.",
      "Diagnostic digest if restriction sites allow clear confirmation.",
      "Sanger sequencing across all engineered junctions and edited regions."
    ],
    focusRegions: [
      ...(assemblyDesign?.junctions || []).map(j => `${j.leftFragment} -> ${j.rightFragment}`),
      ...(editRequest ? ["edited locus"] : [])
    ],
    hostBackbone: selectedHost?.name ?? null,
    strategy: recommendedStrategy?.name ?? null
  };
}

function collectGlobalWarnings({ selectedHost, fragmentMap, primerDesign, routeEvaluations, recommendedStrategy }) {
  const warnings = [];

  if (!selectedHost) {
    warnings.push("No host backbone match was confidently identified from the target sequence.");
  }

  if (fragmentMap.fragments.length > 4) {
    warnings.push("High fragment count may reduce assembly efficiency and increase screening burden.");
  }

  if (!primerDesign.feasible) {
    warnings.push("Primer or oligo planning is incomplete and requires manual review.");
  }

  if (!recommendedStrategy?.feasible) {
    warnings.push("No route passed the current feasibility filters.");
  }

  if (routeEvaluations.restrictionLigation && !routeEvaluations.restrictionLigation.feasible) {
    warnings.push("Restriction-ligation was evaluated but no clean enzyme path was found.");
  }

  return warnings;
}

function buildAlternateStrategyRecommendation(routeEvaluations) {
  if (routeEvaluations.gibson?.feasible) {
    return "Use Gibson assembly as an alternate route.";
  }

  if (routeEvaluations.overlapPCR?.feasible) {
    return "Use overlap PCR followed by cloning into the destination backbone.";
  }

  return "Consider redesigning the fragment layout or using gene synthesis.";
}
```

### Notes on this scaffold
- `assembleCloningPlan(...)` is designed as the top-level orchestration function for route selection, primer tool planning, procedure generation, and validation output
- `buildPrimerAndOligoPlan(...)` deliberately returns tool-call descriptors rather than raw primer sequences
- helper functions such as `findHostVector(...)`, `overlap_pcr(...)`, and `gibson_assemble(...)` are assumed to exist elsewhere in the codebase
- the next implementation step should be connecting this scaffold to real overlap scoring, Tm calculations, restriction-site analysis, and the multi-primer threshold fallback logic above