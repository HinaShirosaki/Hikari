module.exports = function registerEdgeToolBoxSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('[EDGE] sequence-viewer designCloningPrimers falls back to relaxed thresholds when needed', () => {
  const primerPlan = sequenceViewerInternals.designCloningPrimers({
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
test('[EDGE] sequence-viewer designCloningPrimers supports multi-primer tiling for long insertions', () => {
  const primerPlan = sequenceViewerInternals.designCloningPrimers({
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
test('[EDGE] sequence-viewer designCloningPrimers enforces the per-level overlap Tm-difference cap', () => {
  const fragmentMap = {
    fragments: [
      { id: 'frag-1', name: 'Frag1', role: 'insert', sequence: 'ATGGCAGCAGCAGGTGCAGCAGCAGGTGCAGCAGCAGGT' },
      { id: 'frag-2', name: 'Frag2', role: 'insert', sequence: 'GCAGCAGCAGGTGCAGCAGCAGGTATGGCAGCAGCAGGT' }
    ]
  };
  const planWithOverlapTms = (leftTm, rightTm) => sequenceViewerInternals.designCloningPrimers({
    strategy: 'overlap-pcr',
    fragmentMap,
    routeEvaluations: {
      overlapPCR: {
        junctions: [
          { leftFragmentId: 'frag-1', rightFragmentId: 'frag-2', rightFragmentName: 'Frag2', mode: 'primer-introduced', overlapSequence: 'GCAGCAGCAGGTGCAG', overlapLength: 16, overlapTm: leftTm, wrapAround: false },
          { leftFragmentId: 'frag-2', rightFragmentId: 'frag-1', rightFragmentName: 'Frag1', mode: 'primer-introduced', overlapSequence: 'GCAGCAGCAGGTGCAG', overlapLength: 16, overlapTm: rightTm, wrapAround: false }
        ]
      }
    }
  });

  // Spread of 2 degC clears the strict cap (3).
  const balanced = planWithOverlapTms(64, 66);
  assert.equal(balanced.feasible, true);
  assert.equal(balanced.selectedThresholdLevel, 'strict');

  // Spread of 8 degC clears only the relaxed cap (10), so the ladder falls through.
  const relaxedOnly = planWithOverlapTms(60, 68);
  assert.equal(relaxedOnly.feasible, true);
  assert.equal(relaxedOnly.selectedThresholdLevel, 'relaxed');

  // Spread of 14 degC exceeds even the relaxed cap and is rejected at every level.
  const rejected = planWithOverlapTms(60, 74);
  assert.equal(rejected.feasible, false);
  assert.equal(rejected.selectedThresholdLevel, null);
  assert.equal(rejected.attempts.every((attempt) => attempt.rejectedForTmDifference === true), true);
  assert.match(rejected.warnings[0], /Tm-difference cap/);
});
test('[EDGE] sequence-viewer restrictionCutOverhang distinguishes sticky from blunt cutters', () => {
  const restrictionLigation = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-assembly', 'restriction-ligation.js')
  );
  const overhang = restrictionLigation.restrictionCutOverhang;

  // Symmetric Type II cutters: '^' position determines the overhang.
  assert.equal(overhang('G^AATTC').type, 'sticky'); // EcoRI, 4 nt 5' overhang
  assert.equal(overhang('G^AATTC').length, 4);
  assert.equal(overhang('GGTAC^C').type, 'sticky'); // KpnI, 4 nt 3' overhang
  assert.equal(overhang('GAT^ATC').type, 'blunt'); // EcoRV, centred cut
  assert.equal(overhang('TTA^TAA').type, 'blunt'); // AanI/PsiI, centred cut

  // Shifted/Type IIS cutters: '(top/bottom)' offsets determine the overhang.
  assert.equal(overhang('CACCTGC(4/8)').type, 'sticky');
  assert.equal(overhang('CACCTGC(4/8)').length, 4);
  assert.equal(overhang('GATC(3/3)').type, 'blunt'); // equal offsets => blunt

  assert.equal(overhang('').type, 'unknown');
});
test('[EDGE] sequence-viewer designPcrPrimerPair designs a forward and reverse primer for a selected sequence', () => {
  const primerPlan = sequenceViewerInternals.designPcrPrimerPair(
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
test('[EDGE] bench tool calculations return instant results and substituted formulas', () => {
  const massResult = toolBox.calculateMolarityMass({
    concentrationValue: 10,
    concentrationUnit: 'mM',
    molecularWeight: 58.44,
    volumeValue: 1,
    volumeUnit: 'L',
    outputUnit: 'mg'
  });
  assert.match(massResult.resultText, /584\.4 mg/i);
  assert.match(massResult.formulaText, /10 mM x 1 L x 58\.44 g\/mol/i);

  const missingDilution = toolBox.calculateMolarityDilution({
    stockConcentrationValue: 100,
    stockConcentrationUnit: 'mM',
    finalVolumeValue: 1,
    finalVolumeUnit: 'mL'
  });
  assert.equal(missingDilution.resultText, '');
  assert.match(missingDilution.formulaText, /\[desired concentration\]/i);

  const bufferResult = toolBox.calculateBufferRecipe({
    volumeMl: 1000,
    rows: [
      { name: 'NaCl', form: 'solid', molecularWeight: 58.44, concentrationValue: 150 }
    ]
  });
  assert.match(bufferResult.resultText, /NaCl: 8766 mg/i);
  assert.match(bufferResult.formulaText, /150 mM x 1 L x 58\.44 g\/mol/i);

  const stockBufferResult = toolBox.calculateBufferRecipe({
    volumeMl: 1000,
    rows: [
      { name: 'Tween 20', stockConcentration: '2000x', finalConcentration: '1x' },
      { name: 'BSA', molecularWeight: 66430, finalConcentration: '100 ng/uL' }
    ]
  });
  assert.match(stockBufferResult.resultText, /Tween 20: 0\.5 mL/i);
  assert.match(stockBufferResult.resultText, /BSA: 100 mg/i);
  assert.match(stockBufferResult.resultText, /Solvent to add: 999\.5 mL/i);

  assert.equal(toolBox.parseBufferConcentration('2000x').kind, 'fold');
  assert.equal(toolBox.parseBufferConcentration('100 ng/uL').kind, 'massVolume');
  assert.equal(toolBox.parseBufferConcentration('0.1% m/v').percentKind, 'massVolume');

  const reactionResult = toolBox.calculateFixedReaction({
    totalVolumeValue: 100,
    totalVolumeUnit: 'uL',
    fillName: 'Water',
    reagents: [
      { name: 'ATP', stockValue: 10, stockUnit: 'mM', finalValue: 1, finalUnit: 'mM' }
    ]
  });
  assert.match(reactionResult.resultText, /ATP: 10 uL/i);
  assert.match(reactionResult.resultText, /Water: 90 uL/i);
  assert.match(reactionResult.formulaText, /ATP volume = 1 mM x 100 uL \/ 10 mM/i);

  const typedReactionResult = toolBox.calculateFixedReaction({
    totalVolumeValue: '100 uL',
    fillName: 'Solvent',
    reagents: [
      { name: 'Enzyme', stockConcentration: '2000x', finalConcentration: '1x' },
      { name: 'Carrier', stockConcentration: '1 mg/mL', finalConcentration: '100 ng/uL' }
    ]
  });
  assert.match(typedReactionResult.resultText, /Enzyme: 0\.05 uL/i);
  assert.match(typedReactionResult.resultText, /Carrier: 10 uL/i);
  assert.match(typedReactionResult.resultText, /Solvent: 89\.95 uL/i);
});
test('[EDGE] tool-box buffer and fixed reaction UI use typed table cells', () => {
  const ids = [
    'buffer-volume-ml', 'buffer-ph', 'buffer-rows', 'add-buffer-chemical-btn', 'buffer-total-result',
    'buffer-solvent-output', 'buffer-naoh-output', 'buffer-hcl-output',
    'fixed-reaction-rows', 'fixed-reaction-add-row-btn', 'fixed-reaction-fill-name',
    'fixed-reaction-total-volume', 'fixed-reaction-solvent-output'
  ];
  for (let index = 1; index <= 6; index += 1) {
    ids.push(
      `buffer-row-${index}`,
      `buffer-name-${index}`,
      `buffer-mw-${index}`,
      `buffer-stock-${index}`,
      `buffer-final-${index}`,
      `buffer-output-${index}`,
      `buffer-suggestions-${index}`,
      `fixed-reaction-row-${index}`,
      `fixed-reaction-name-${index}`,
      `fixed-reaction-stock-${index}`,
      `fixed-reaction-final-${index}`,
      `fixed-reaction-volume-${index}`,
      `fixed-reaction-output-${index}`
    );
  }
  const document = createMockDocument(ids);
  for (let index = 3; index <= 6; index += 1) {
    document.getElementById(`buffer-row-${index}`).hidden = true;
  }
  for (let index = 2; index <= 6; index += 1) {
    document.getElementById(`fixed-reaction-row-${index}`).hidden = true;
  }

  document.getElementById('buffer-volume-ml').value = '1000';
  document.getElementById('buffer-name-1').value = 'NaCl';
  document.getElementById('buffer-mw-1').value = '58.44';
  document.getElementById('buffer-final-1').value = '150 mM';
  document.getElementById('buffer-name-2').value = 'Tween 20';
  document.getElementById('buffer-stock-2').value = '2000x';
  document.getElementById('buffer-final-2').value = '1x';
  document.getElementById('fixed-reaction-total-volume').value = '100 uL';
  document.getElementById('fixed-reaction-fill-name').value = 'Water';
  document.getElementById('fixed-reaction-name-1').value = 'Carrier';
  document.getElementById('fixed-reaction-stock-1').value = '1 mg/mL';
  document.getElementById('fixed-reaction-final-1').value = '100 ng/uL';

  const bufferUi = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'tool-box', 'buffer-ui.js'));
  const reactionUi = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'tool-box', 'fixed-reaction-ui.js'));
  bufferUi.initBufferTool({
    document,
    getStoredCompounds: () => [{ name: 'Stored Salt', molecularWeight: 111.1, casNumber: '1-2-3' }]
  });
  reactionUi.initFixedReactionTool({ document });

  assert.match(document.getElementById('buffer-output-1').textContent, /8766 mg/i);
  assert.match(document.getElementById('buffer-output-2').textContent, /0\.5 mL/i);
  assert.match(document.getElementById('buffer-solvent-output').textContent, /999\.5 mL/i);
  assert.match(document.getElementById('fixed-reaction-output-1').textContent, /10 uL/i);
  assert.match(document.getElementById('fixed-reaction-solvent-output').textContent, /90 uL/i);

  document.getElementById('buffer-name-1').value = 'Stored';
  trigger(document.getElementById('buffer-name-1'), 'input');
  assert.match(document.getElementById('buffer-suggestions-1').innerHTML, /Stored Salt/);
});
test('[EDGE] sequence-viewer assembleCloningPlan prefers restriction-ligation for simple host-plus-insert cases', () => {
  const plan = sequenceViewerInternals.assembleCloningPlan({
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
test('[EDGE] sequence-viewer assembleCloningPlan reports infeasible inputs with alternate guidance', () => {
  const plan = sequenceViewerInternals.assembleCloningPlan({
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
