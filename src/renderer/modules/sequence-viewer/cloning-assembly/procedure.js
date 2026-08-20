import { asArray, normalizeSequence } from './sequence-utils.js';

export function buildProcedureSteps(strategyName, assemblyDesign) {
  const downstreamAssemblyMethod = assemblyDesign?.downstreamAssemblyMethod || null;

  if (strategyName === 'restriction-ligation') {
    return [
      { step: 1, title: 'Amplify insert', details: 'PCR-amplify the insert with restriction-site tails from the primer plan.', inputs: ['insert template', 'restriction-tailed primers'], expectedOutput: 'clean insert amplicon' },
      { step: 2, title: 'Digest DNA', details: 'Digest backbone and insert with the selected enzyme pair, then purify both products.', inputs: ['backbone', 'insert amplicon'], expectedOutput: 'compatible digested fragments' },
      { step: 3, title: 'Ligate construct', details: 'Ligate digested insert into the prepared backbone.', inputs: ['digested backbone', 'digested insert'], expectedOutput: 'ligation mixture' },
      { step: 4, title: 'Transform and screen', details: 'Transform competent cells and screen colonies by colony PCR and sequencing.', inputs: ['ligation mixture'], expectedOutput: 'validated recombinant clones' }
    ];
  }

  if (strategyName === 'gibson') {
    return [
      { step: 1, title: 'Amplify fragments', details: 'PCR-amplify all fragments using the overlap-bearing primer set.', inputs: ['fragment templates', 'assembly primers'], expectedOutput: 'purified assembly fragments' },
      { step: 2, title: 'Assemble reaction', details: 'Combine fragments in a Gibson-style assembly reaction using the planned overlap order.', inputs: ['purified fragments'], expectedOutput: 'assembled construct' },
      { step: 3, title: 'Transform and recover', details: 'Transform the assembly reaction into competent cells and recover colonies.', inputs: ['assembly reaction'], expectedOutput: 'candidate colonies' },
      { step: 4, title: 'Validate junctions', details: 'Screen every junction by colony PCR and sequence through the assembled insert.', inputs: ['candidate colonies'], expectedOutput: 'validated assembled plasmid' }
    ];
  }

  if (strategyName === 'overlap-pcr') {
    return [
      { step: 1, title: 'Fuse inserts', details: 'Generate the fused insert by overlap PCR across the planned fragment order.', inputs: ['insert templates', 'fusion primers'], expectedOutput: 'fused insert amplicon' },
      { step: 2, title: 'Verify fused insert', details: 'Confirm fused insert size before backbone insertion.', inputs: ['fused insert amplicon'], expectedOutput: 'validated fused insert' },
      { step: 3, title: 'Insert into backbone', details: `Insert the fused insert into the backbone using ${downstreamAssemblyMethod || 'the planned downstream assembly route'}.`, inputs: ['fused insert', 'selected backbone'], expectedOutput: 'candidate recombinant construct' },
      { step: 4, title: 'Screen and sequence', details: 'Validate both fusion and backbone junctions by PCR and sequencing.', inputs: ['candidate clones'], expectedOutput: 'validated final construct' }
    ];
  }

  if (strategyName === 'site-directed-mutagenesis') {
    return [
      { step: 1, title: 'Set up mutagenesis', details: 'Use the designed mutagenesis primers or tiled oligos on the selected template backbone.', inputs: ['template plasmid', 'mutagenesis primer set'], expectedOutput: 'edited amplification product' },
      { step: 2, title: 'Remove template background', details: 'Reduce parental-template carryover before transformation.', inputs: ['amplification product'], expectedOutput: 'enriched edited DNA' },
      { step: 3, title: 'Transform and isolate', details: 'Transform competent cells and isolate candidate colonies.', inputs: ['edited DNA'], expectedOutput: 'candidate edited clones' },
      { step: 4, title: 'Sequence edit window', details: 'Sequence the edited region and flanking sequence to confirm the requested change.', inputs: ['candidate clones'], expectedOutput: 'validated edited plasmid' }
    ];
  }

  return [
    { step: 1, title: 'Reassess inputs', details: 'No executable route was identified. Re-check backbone choice, fragment order, or edit size.', inputs: [], expectedOutput: 'revised plan inputs' }
  ];
}

export function buildValidationPlan(strategyName, fragmentMap) {
  const fragmentIds = asArray(fragmentMap?.fragments).map((fragment) => fragment.id);
  if (strategyName === 'restriction-ligation') {
    return [
      { method: 'colony-pcr', target: 'left/right cloning junctions', rationale: 'Confirm insert presence and orientation.' },
      { method: 'sanger-sequencing', target: 'entire insert region', rationale: 'Verify insert integrity after ligation.' }
    ];
  }
  if (strategyName === 'gibson') {
    return [
      { method: 'colony-pcr', target: 'all designed assembly junctions', rationale: 'Confirm that every overlap assembled as planned.' },
      { method: 'sanger-sequencing', target: 'assembled insert and adjacent backbone sequence', rationale: 'Verify seamless junction formation.' }
    ];
  }
  if (strategyName === 'overlap-pcr') {
    return [
      { method: 'gel-check', target: 'fused insert amplicon', rationale: 'Confirm expected fused-insert size before backbone insertion.' },
      { method: 'colony-pcr', target: 'fusion and backbone insertion junctions', rationale: 'Confirm the fused insert entered the backbone correctly.' },
      { method: 'sanger-sequencing', target: 'fusion boundaries', rationale: 'Verify that the fused coding sequence is scar-free and in-frame.' }
    ];
  }
  if (strategyName === 'site-directed-mutagenesis') {
    return [
      { method: 'sanger-sequencing', target: 'edited window and flanking sequence', rationale: 'Confirm the requested edit and exclude local byproducts.' }
    ];
  }
  return [
    { method: 'review-inputs', target: fragmentIds.join(', '), rationale: 'No feasible route was selected.' }
  ];
}

export function buildAssemblyDesign(strategy, fragmentMap, routeEvaluations, resultSequence) {
  const predictedResultSequence = normalizeSequence(resultSequence);
  const strategyName = strategy?.name || null;
  const routeJunctions = strategyName === 'gibson'
    ? asArray(routeEvaluations?.gibson?.junctions)
    : strategyName === 'overlap-pcr'
      ? asArray(routeEvaluations?.overlapPCR?.junctions)
      : strategyName === 'restriction-ligation'
        ? asArray(routeEvaluations?.restrictionLigation?.selectedSites).map((site, index) => ({
            mode: 'restriction-ligation',
            junction: index === 0 ? 'upstream' : 'downstream',
            enzyme: site?.name || site?.site,
            site: site?.site,
            segments: asArray(site?.segments)
          }))
        : [];

  return {
    strategy: strategyName,
    fragmentOrder: asArray(fragmentMap?.fragments).map((fragment) => ({
      id: fragment.id,
      name: fragment.name,
      role: fragment.role,
      length: fragment.sequence.length
    })),
    predictedResultSequence,
    predictedResultLength: predictedResultSequence.length,
    junctions: routeJunctions,
    downstreamAssemblyMethod: strategy?.downstreamAssemblyMethod || null,
    notes: [
      strategy?.reason || '',
      strategy?.downstreamAssemblyMethod
        ? `Downstream backbone insertion should use ${strategy.downstreamAssemblyMethod}.`
        : ''
    ].filter(Boolean)
  };
}
