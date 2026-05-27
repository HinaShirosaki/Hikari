module.exports = function registerEdgeToolBoxSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('[EDGE] tool-box designCloningPrimers falls back to relaxed thresholds when needed', () => {
  const primerPlan = toolBox.designCloningPrimers({
    strategy: 'restriction-ligation',
    preferences: {
      maxPrimerLength: 25
    },
    fragmentMap: {
      fragments: [
        {
          id: 'insert-1',
          name: 'Insert 1',
          role: 'insert',
          sequence: 'GCGCGCGCGCGCGATTTTTTTTTTGCGCGCGCGCGCGAT'
        }
      ]
    },
    routeEvaluations: {
      restrictionLigation: {
        selectedSites: [
          { name: 'BamHI', site: 'GGATCC' },
          { name: 'KpnI', site: 'GGTACC' }
        ]
      }
    }
  });

  assert.equal(primerPlan.feasible, true);
  assert.equal(primerPlan.selectedThresholdLevel, 'relaxed');
  assert.equal(primerPlan.primers.length, 2);
});
test('[EDGE] tool-box designCloningPrimers supports multi-primer tiling for long insertions', () => {
  const primerPlan = toolBox.designCloningPrimers({
    strategy: 'site-directed-mutagenesis',
    selectedHost: {
      id: 'host-1',
      name: 'Template',
      sequence: 'GCGCGCGCGCGCGATATATATATATATATATATAGCGCGCGCGCGCGAT'
    },
    editRequest: {
      type: 'insertion',
      position: 25,
      editedSequence: 'GCGCGCGCGCGCGATGCGCGCGCGCGCGATGCGCGCGCGCGCGATGCGCGCGCGCGCGATGCGCGCGCGCGCGAT'
    }
  });

  assert.equal(primerPlan.feasible, true);
  assert.equal(primerPlan.primerCount > 2, true);
  assert.equal(primerPlan.primerOrder.includes('tile_outer_left'), true);
});
test('[EDGE] tool-box designPcrPrimerPair designs a forward and reverse primer for a selected sequence', () => {
  const primerPlan = toolBox.designPcrPrimerPair(
    'GCGCGCGCGCGCGATATATATATATATATATATAGCGCGCGCGCGCGAT',
    { name: 'selected_region' }
  );

  assert.equal(primerPlan.feasible, true);
  assert.equal(primerPlan.primerCount, 2);
  assert.equal(primerPlan.primers[0].name, 'selected_region_F');
  assert.equal(primerPlan.primers[1].name, 'selected_region_R');
  assert.equal(primerPlan.primers[0].role, 'pcr-forward');
  assert.equal(primerPlan.primers[1].role, 'pcr-reverse');
});
test('[EDGE] tool-box assembleCloningPlan prefers restriction-ligation for simple host-plus-insert cases', () => {
  const plan = toolBox.assembleCloningPlan({
    hostVectors: [
      {
        id: 'host-1',
        name: 'Host Backbone',
        topology: 'circular',
        sequence: 'TTTGGATCCAAAAAAGGTACCTTT'
      }
    ],
    hostVectorId: 'host-1',
    fragments: [
      {
        id: 'insert-1',
        name: 'Insert 1',
        type: 'insert',
        sequence: 'GCGCGCGCGCGCGATTTTTTTTTTGCGCGCGCGCGCGAT'
      }
    ]
  });

  assert.equal(plan.feasible, true);
  assert.equal(plan.recommendedAssemblyStrategy, 'restriction-ligation');
  assert.equal(Array.isArray(plan.stepByStepProcedure), true);
  assert.equal(plan.stepByStepProcedure.length >= 4, true);
  assert.equal(Array.isArray(plan.validationPlan), true);
  assert.equal(plan.primerOligoPlan.feasible, true);
});
test('[EDGE] tool-box assembleCloningPlan reports infeasible inputs with alternate guidance', () => {
  const plan = toolBox.assembleCloningPlan({
    fragments: [
      {
        id: 'insert-1',
        name: 'Insert 1',
        type: 'insert',
        sequence: 'ATGC'
      }
    ]
  });

  assert.equal(plan.feasible, false);
  assert.equal(typeof plan.alternateStrategyRecommendation, 'string');
  assert.equal(plan.alternateStrategyRecommendation.length > 0, true);
  assert.equal(Array.isArray(plan.warnings), true);
  assert.equal(plan.warnings.length > 0, true);
});
test('[EDGE] protein-builder cloning notebook page includes PCR program and primer table', () => {
  const notebookAdapter = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder-cloning-notebook.js')
  );
  const state = {
    projects: [],
    protocols: [],
    notebookEntries: []
  };
  let nextId = 0;
  let persisted = false;
  let changedCount = 0;
  const created = notebookAdapter.createProteinBuilderCloningNotebookPage({
    state,
    persist: () => {
      persisted = true;
    },
    createId: () => `id-${nextId += 1}`,
    onNotebookEntriesChanged: () => {
      changedCount += 1;
    },
    constructName: 'His6-TEV-POI',
    backbone: {
      hostVectorName: 'Host Backbone',
      topology: 'circular',
      backboneSequence: 'TTTGGATCCAAAAAAGGTACCTTT'
    },
    dnaConstruct: {
      sequence: 'GCGCGCGCGCGCGATTTTTTTTTTGCGCGCGCGCGCGAT',
      length: 43,
      parts: [{ label: 'POI', dnaSequence: 'GCGCGCGCGCGCGATTTTTTTTTTGCGCGCGCGCGCGAT' }]
    },
    assembledRecord: {
      name: 'His6-TEV-POI (Host Backbone)',
      sequence: 'TTTGGATCCAAAAAAGGTACCTTTGCGCGCGCGCGCGATTTTTTTTTTGCGCGCGCGCGCGAT'
    }
  });

  assert.equal(Boolean(created?.entry), true);
  assert.equal(persisted, true);
  assert.equal(changedCount, 1);
  assert.equal(state.projects.length, 1);
  assert.equal(state.protocols.length, 1);
  assert.equal(state.notebookEntries.length, 1);
  assert.equal(state.notebookEntries[0].notebookState, 'planned');
  assert.match(state.notebookEntries[0].result, /PCR program/i);
  assert.match(state.notebookEntries[0].result, /Primers/i);
  assert.equal(state.notebookEntries[0].resultTable.rows.length > 0, true);
  assert.equal(created.plan.primerOligoPlan.feasible, true);
});
test('[EDGE] protein-builder Gibson backbone keeps primer design on the Gibson route', () => {
  const notebookAdapter = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder-cloning-notebook.js')
  );
  const leftOverlap = 'ATGCGTACGATCGTACGATCGTACGATCGA';
  const rightOverlap = 'CGATGCTAGCTAGCATGCTAGCATGCTAGC';
  const backboneSequence = `${rightOverlap}TTTTTATATATATATATAT${leftOverlap}`;
  const insertSequence = `${leftOverlap}GGGGGGCCCCCCC${rightOverlap}`;
  const plan = notebookAdapter.buildProteinBuilderCloningPlan({
    constructName: 'Overlap-POI',
    backbone: {
      hostVectorName: 'Host Backbone',
      topology: 'circular',
      variantMode: 'gibson',
      backboneSequence
    },
    dnaConstruct: {
      sequence: insertSequence,
      length: insertSequence.length,
      parts: [{ label: 'POI', dnaSequence: insertSequence }]
    },
    assembledRecord: {
      name: 'Overlap-POI (Host Backbone)',
      sequence: `${backboneSequence}${insertSequence}`
    }
  });

  assert.equal(plan.recommendedAssemblyStrategy, 'gibson');
  assert.equal(plan.restrictionEnzymeSelection, null);
  assert.equal(plan.primerOligoPlan.feasible, true);
  assert.equal(plan.primerOligoPlan.primers.some((primer) => /restriction/i.test(primer.role)), false);
  assert.equal(plan.primerOligoPlan.primers.some((primer) => /Adds .* to the 5' end/i.test(String(primer.warnings || ''))), false);
});
test('[EDGE] protein-builder Gibson backbone uses the saved insertion offset for junction primers', () => {
  const notebookAdapter = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder-cloning-notebook.js')
  );
  const fileStart = 'GGATCTGCGATCGCTCCGGTGCCCGTCAGTG';
  const leftFlank = 'ATGCGTACGATCGTACGATCGTACGATCGA';
  const rightFlank = 'GTGCTAGCTGGCCAGACATGATAAGATACATTG';
  const upstreamBackbone = `${fileStart}TTTTTATATATATATATATAT${leftFlank}`;
  const downstreamBackbone = `${rightFlank}GGCCGATATATATATATCGCGCGC`;
  const backboneSequence = `${upstreamBackbone}${downstreamBackbone}`;
  const insertSequence = [
    'CACCACCACCACCACCACGAAAAC',
    'GCGCGATTTTTTTTTTGCGCGAT',
    'CACCGTGAAAGTGAATGCCCCGTAT'
  ].join('');
  const plan = notebookAdapter.buildProteinBuilderCloningPlan({
    constructName: 'Offset-POI',
    backbone: {
      hostVectorName: 'Host Backbone',
      topology: 'circular',
      variantMode: 'gibson',
      insertionOffset: upstreamBackbone.length,
      backboneSequence
    },
    dnaConstruct: {
      sequence: insertSequence,
      length: insertSequence.length,
      parts: [{ label: 'POI', dnaSequence: insertSequence }]
    },
    assembledRecord: {
      name: 'Offset-POI (Host Backbone)',
      sequence: `${upstreamBackbone}${insertSequence}${downstreamBackbone}`
    }
  });
  const wrapJunction = plan.routeEvaluations.gibson.junctions.find((junction) => junction.wrapAround);
  const hostForward = plan.primerOligoPlan.primers.find((primer) => primer.name === 'Host Backbone_F');
  const insertReverse = plan.primerOligoPlan.primers.find((primer) => primer.name === 'Offset-POI_R');

  assert.equal(plan.recommendedAssemblyStrategy, 'gibson');
  assert.equal(plan.primerOligoPlan.feasible, true);
  assert.equal(wrapJunction.overlapSequence.startsWith(rightFlank.slice(0, 16)), true);
  assert.equal(wrapJunction.overlapSequence.startsWith(fileStart.slice(0, 16)), false);
  assert.equal(hostForward.bindingSequence.startsWith(rightFlank.slice(0, 16)), true);
  assert.equal(insertReverse.tailSequence, toolBox.reverseComplementDna(wrapJunction.overlapSequence));
});
test('[EDGE] protein-builder Gibson insert primers bind the linked source CDS and add missing tags as tails', () => {
  const notebookAdapter = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder-cloning-notebook.js')
  );
  const leftFlank = 'ATGCGTACGATCGTACGATCGTACGATCGA';
  const rightFlank = 'GTGCTAGCTGGCCAGACATGATAAGATACATTG';
  const upstreamBackbone = `TTTTTATATATATATATATAT${leftFlank}`;
  const downstreamBackbone = `${rightFlank}GGCCGATATATATATATCGCGCGC`;
  const backboneSequence = `${upstreamBackbone}${downstreamBackbone}`;
  const tagAndLinker = 'ATGCACCACCACCACCACCACGAAAACCTGTACTTC';
  const sourceCds = 'CAGGGCGCGTTTACCGTGACCGTGCCGAAAGATCTGTACGTGGTGGAATACGGCAGCAACATGACC';
  const insertSequence = `${tagAndLinker}${sourceCds}`;
  const plan = notebookAdapter.buildProteinBuilderCloningPlan({
    constructName: 'Tagged-POI',
    backbone: {
      hostVectorName: 'Host Backbone',
      topology: 'circular',
      variantMode: 'gibson',
      insertionOffset: upstreamBackbone.length,
      backboneSequence
    },
    dnaConstruct: {
      sequence: insertSequence,
      length: insertSequence.length,
      parts: [
        { label: '6xHis-TEV', dnaSequence: tagAndLinker, length: tagAndLinker.length },
        {
          label: 'PD-L1',
          dnaSequence: sourceCds,
          templateSequence: sourceCds,
          length: sourceCds.length
        }
      ]
    },
    assembledRecord: {
      name: 'Tagged-POI (Host Backbone)',
      sequence: `${upstreamBackbone}${insertSequence}${downstreamBackbone}`
    }
  });
  const insertForward = plan.primerOligoPlan.primers.find((primer) => primer.name === 'Tagged-POI_F');
  const insertReverse = plan.primerOligoPlan.primers.find((primer) => primer.name === 'Tagged-POI_R');
  const wrapJunction = plan.routeEvaluations.gibson.junctions.find((junction) => junction.wrapAround);

  assert.equal(plan.recommendedAssemblyStrategy, 'gibson');
  assert.equal(plan.primerOligoPlan.feasible, true);
  assert.equal(insertForward.tailSequence, tagAndLinker);
  assert.equal(insertForward.bindingSequence.startsWith(sourceCds.slice(0, 18)), true);
  assert.equal(insertForward.bindingSequence.startsWith(tagAndLinker.slice(0, 18)), false);
  assert.equal(insertForward.warnings.some((warning) => /Adds 36 nt at the 5' end/i.test(warning)), true);
  assert.equal(insertReverse.bindingSequence, toolBox.reverseComplementDna(sourceCds.slice(sourceCds.length - insertReverse.bindingSequence.length)));
  assert.equal(insertReverse.tailSequence, toolBox.reverseComplementDna(wrapJunction.overlapSequence));
});
[
  [[1, 2, 3], [2, 4, 6], { slope: 2, intercept: 0, rSquared: 1 }],
  [[1, 2, 3], [3, 2, 1], { slope: -1, intercept: 4, rSquared: 1 }],
  [[1, 1, 1], [2, 3, 4], null],
  [[1], [2], null],
  [[], [], null]
].forEach(([xValues, yValues, expected], idx) => {
  test(`[EDGE] tool-box linearRegression case ${idx + 1}`, () => {
    const result = toolBox.linearRegression(xValues, yValues);
    if (!expected) {
      assert.equal(result, null);
      return;
    }
    assertClose(result.slope, expected.slope, 1e-9);
    assertClose(result.intercept, expected.intercept, 1e-9);
    assertClose(result.rSquared, expected.rSquared, 1e-9);
  });
});
[
  ['a b-c_d', 'ABCD'],
  ['123abc', 'ABC'],
  ['a\nb\tc', 'ABC'],
  ['', ''],
  [null, '']
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box cleanSequence case ${idx + 1}`, () => {
    assert.equal(toolBox.cleanSequence(input), expected);
  });
});
[
  ['AAAB', { A: 3, B: 1 }],
  ['', {}],
  ['XYZ', { X: 1, Y: 1, Z: 1 }]
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box countResidues case ${idx + 1}`, () => {
    assert.equal(JSON.stringify(toolBox.countResidues(input)), JSON.stringify(expected));
  });
});
[
  ['', 0],
  ['A', 71.08 + 18.015],
  ['AC', 71.08 + 103.15 + 18.015],
  ['Z', 18.015]
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box calculatePeptideMass case ${idx + 1}`, () => {
    assertClose(toolBox.calculatePeptideMass(input), expected, 1e-6);
  });
});
[
  ['KRR', 7, true],
  ['DEE', 7, false],
  ['AAAA', 7, false]
].forEach(([sequence, ph, isPositive], idx) => {
  test(`[EDGE] tool-box calculateNetCharge sign case ${idx + 1}`, () => {
    const charge = toolBox.calculateNetCharge(sequence, ph);
    assert.equal(isPositive ? charge > 0 : charge < 0, true);
  });
});
[
  ['', 0],
  ['KRR', 0],
  ['DEE', 0],
  ['ACDEFGHIKLMNPQRSTVWY', 0]
].forEach(([sequence], idx) => {
  test(`[EDGE] tool-box estimatePI bounds case ${idx + 1}`, () => {
    const value = toolBox.estimatePI(sequence);
    assert.equal(value >= 0, true);
    assert.equal(value <= 14, true);
  });
});
[
  [{ C: 1, A: 2, B: 3 }, 'A:2  B:3  C:1'],
  [{}, '']
].forEach(([counts, expected], idx) => {
  test(`[EDGE] tool-box residueSummary case ${idx + 1}`, () => {
    assert.equal(toolBox.residueSummary(counts), expected);
  });
});
[
  ['ACDE', 4],
  ['WWYYCC', 6],
  ['', 0],
  ['ABCXYZ', 6]
].forEach(([sequence, expectedLength], idx) => {
  test(`[EDGE] tool-box peptideStats case ${idx + 1}`, () => {
    const stats = toolBox.peptideStats(sequence);
    assert.equal(stats.length, expectedLength);
    assert.equal(typeof stats.mass, 'number');
    assert.equal(Array.isArray(stats.invalidResidues), true);
  });
});
test('[EDGE] tool-box renderChemicalOptions includes Custom option', () => {
  const html = toolBox.renderChemicalOptions();
  assert.match(html, /Custom<\/option>/);
  assert.match(html, /<option value="[^"]+">/);
});
test('[EDGE] tool-box parseCrisprTargetsInput parses FASTA entries and normalizes sequence', () => {
  const parsed = toolBox.parseCrisprTargetsInput(`
>Target_A
ACGTNNNN
>Target_B
acgu---
`);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'Target_A');
  assert.equal(parsed[0].sequence, 'ACGTNNNN');
  assert.equal(parsed[1].name, 'Target_B');
  assert.equal(parsed[1].sequence, 'ACGT');
});
test('[EDGE] tool-box collectCrisprPamSites finds forward NGG protospacers', () => {
  const target = {
    id: 'target-1',
    name: 'Target 1',
    sequence: 'ATATATATAGGAAAA'
  };
  const sites = toolBox.collectCrisprPamSites(target, 4, 'NGG');
  assert.equal(sites.length, 1);
  assert.equal(sites[0].strand, '+');
  assert.equal(sites[0].guideSequence, 'ATAT');
  assert.equal(sites[0].pamSequence, 'AGG');
  assert.equal(sites[0].start, 5);
  assert.equal(sites[0].end, 8);
});
test('[EDGE] tool-box computeCrisprOffTargetStats buckets mismatch counts', () => {
  const candidate = {
    key: 'k1',
    guideSequence: 'AAAAAAAAAAAAAAAAAAAA'
  };
  const background = [
    { key: 'k1', guideSequence: 'AAAAAAAAAAAAAAAAAAAA' },
    { key: 'k2', guideSequence: 'AAAAAAAAAAAAAAAAAAAA' },
    { key: 'k3', guideSequence: 'CAAAAAAAAAAAAAAAAAAA' },
    { key: 'k4', guideSequence: 'CCAAAAAAAAAAAAAAAAAA' },
    { key: 'k5', guideSequence: 'CCCAAAAAAAAAAAAAAAAA' },
    { key: 'k6', guideSequence: 'CCCCAAAAAAAAAAAAAAAA' }
  ];
  const stats = toolBox.computeCrisprOffTargetStats(candidate, background, 1);
  assert.equal(stats.mismatchCounts.exact, 1);
  assert.equal(stats.mismatchCounts.mismatch1, 1);
  assert.equal(stats.mismatchCounts.mismatch2, 1);
  assert.equal(stats.mismatchCounts.mismatch3, 1);
  assertClose(stats.offTargetRate, 27.84, 1e-9);
  assertClose(stats.specificityScore, 72.16, 1e-9);
});
test('[EDGE] tool-box designCrisprGuides returns ranked sgRNA candidates', () => {
  const selectedTargets = [{
    id: 'target-1',
    name: 'Target 1',
    sequence: 'ATATATATAGGAAAA'
  }];
  const result = toolBox.designCrisprGuides({
    selectedTargets,
    backgroundTargets: selectedTargets,
    guideLength: 4,
    pamPattern: toolBox.normalizeIupacPattern('NGG'),
    minGc: 0,
    maxGc: 100,
    topCount: 10,
    genomeMultiplier: 1
  });
  assert.equal(result.totalPamMatches, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].guideSequence, 'ATAT');
  assert.equal(result.candidates[0].pamSequence, 'AGG');
  assertClose(result.candidates[0].offTargetRate, 0, 1e-9);
  assertClose(result.candidates[0].specificityScore, 100, 1e-9);
});
  }
};