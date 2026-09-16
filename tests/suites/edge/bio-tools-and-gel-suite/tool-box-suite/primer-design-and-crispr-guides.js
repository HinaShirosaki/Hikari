module.exports = function registerEdgeToolBoxSuitePrimerDesignAndCrisprGuides(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
function deterministicDna(length, seed) {
  let state = seed >>> 0;
  let result = '';
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    result += 'ACGT'[state % 4];
  }
  return result;
}
test('[EDGE] sequence-viewer designCloningPrimers falls back to relaxed thresholds when needed', () => {
  const primerPlan = sequenceViewerInternals.designCloningPrimers({
    strategy: 'restriction-ligation',
    preferences: {
      // Six clamp bases plus a six-base site leave room for the relaxed
      // 15-base binding minimum in a 27-mer.
      maxPrimerLength: 27
    },
    fragmentMap: {
      fragments: [
        {
          id: 'insert-1',
          name: 'Insert 1',
          role: 'insert',
          sequence: 'GCGCCGCGGCCGCGATATGACGTAGCTAGCCCGCGGCGCCGGCGC'
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
test('[EDGE] sequence-viewer designCloningPrimers rejects non-annealing same-strand insertion tiles', () => {
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

  assert.equal(primerPlan.feasible, false);
  assert.equal(primerPlan.primers.length, 0);
  assert.match(primerPlan.warnings.join(' '), /Q5\/KLD split-tail primers/);
});
test('[EDGE] sequence-viewer primer fallback enforces the per-level overlap Tm-difference cap', () => {
  const strategy = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-assembly', 'strategy.js'));
  const planWithOverlapTms = (leftTm, rightTm) => strategy.designWithThresholdFallback(() => ({
    feasible: true,
    primers: [{ name: 'fragment_F', tm: 60 }, { name: 'fragment_R', tm: 60 }],
    overlapSummary: [{ overlapTm: leftTm }, { overlapTm: rightTm }]
  }));

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
    deterministicDna(120, 1),
    { name: 'selected_region' }
  );

  assert.equal(primerPlan.feasible, true);
  assert.equal(primerPlan.primerCount, 2);
  assert.equal(primerPlan.primers[0].name, 'selected_region F');
  assert.equal(primerPlan.primers[1].name, 'selected_region R');
  assert.equal(primerPlan.primers[0].role, 'pcr-forward');
  assert.equal(primerPlan.primers[1].role, 'pcr-reverse');
});
test('[EDGE] bench tool calculations return instant results and substituted formulas', () => {
  const massResult = toolBox.calculateMolarityMass({
    concentrationValue: 10,
    concentrationUnit: 'mM',
    molecularWeight: 58.44,
    volumeValue: 1,
    volumeUnit: 'L'
  });
  assert.match(massResult.resultText, /584\.4 mg/i);
  assert.match(massResult.formulaText, /10 mM x 1 L x 58\.44 g\/mol/i);

  [
    { volumeValue: 1, volumeUnit: 'L', expected: '1 g' },
    { volumeValue: 1, volumeUnit: 'mL', expected: '1 mg' },
    { volumeValue: 1, volumeUnit: 'uL', expected: '1 ug' },
    { volumeValue: 1, volumeUnit: 'nL', expected: '1 ng' }
  ].forEach(({ volumeValue, volumeUnit, expected }) => {
    const adaptiveMass = toolBox.calculateMolarityMass({
      concentrationValue: 1,
      concentrationUnit: 'M',
      molecularWeight: 1,
      volumeValue,
      volumeUnit
    });
    assert.equal(adaptiveMass.resultText, `Mass needed: ${expected}.`);
  });

  [
    { massValue: 1, massUnit: 'g', expected: '1 L' },
    { massValue: 10, massUnit: 'mg', expected: '10 mL' },
    { massValue: 10, massUnit: 'ug', expected: '10 uL' },
    { massValue: 0.01, massUnit: 'ug', expected: '10 nL' }
  ].forEach(({ massValue, massUnit, expected }) => {
    const volumeResult = toolBox.calculateMolarityVolume({
      massValue,
      massUnit,
      molecularWeight: 1,
      concentrationValue: 1,
      concentrationUnit: 'M'
    });
    assert.equal(volumeResult.resultText, `Final volume: ${expected}.`);
  });

  [
    { massValue: 1, massUnit: 'g', expected: '1 M' },
    { massValue: 1, massUnit: 'mg', expected: '1 mM' },
    { massValue: 1, massUnit: 'ug', expected: '1 uM' },
    { massValue: 0.001, massUnit: 'ug', expected: '1 nM' }
  ].forEach(({ massValue, massUnit, expected }) => {
    const adaptiveConcentration = toolBox.calculateMolarityConcentration({
      massValue,
      massUnit,
      molecularWeight: 1,
      volumeValue: 1,
      volumeUnit: 'L'
    });
    assert.equal(adaptiveConcentration.resultText, `Concentration: ${expected}.`);
  });

  const adaptiveDilution = toolBox.calculateMolarityDilution({
    stockConcentrationValue: 1000,
    stockConcentrationUnit: 'mM',
    targetConcentrationValue: 0.01,
    targetConcentrationUnit: 'mM',
    finalVolumeValue: 1,
    finalVolumeUnit: 'mL'
  });
  assert.match(adaptiveDilution.resultText, /Use 10 nL stock \+ 1000 uL diluent\./i);

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
  assert.match(bufferResult.resultText, /NaCl: 8\.766 g\./i);
  assert.match(bufferResult.formulaText, /150 mM x 1 L x 58\.44 g\/mol/i);

  const microliterBufferResult = toolBox.calculateBufferRecipe({
    volumeValue: 1000,
    volumeUnit: 'uL',
    rows: [
      { name: 'NaCl', form: 'solid', molecularWeight: 58.44, concentrationValue: 150 }
    ]
  });
  assert.match(microliterBufferResult.resultText, /NaCl: 8\.766 mg/i);
  assert.equal(microliterBufferResult.inputs.volumeMl, 1);
  assert.equal(microliterBufferResult.inputs.volumeUnit, 'uL');

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

  // Tris base is titrated from the free base, not from the pKa midpoint:
  // 50 mM x 1 L x (1 - 0.4655) = 26.7 mmol HCl -> 4.45 mL of 6 M.
  const trisBufferResult = toolBox.calculateBufferRecipe({
    volumeMl: 1000,
    pH: 8,
    rows: [
      { name: 'Tris Base', finalConcentration: '50 mM' },
      { name: 'NaCl', finalConcentration: '150 mM' }
    ]
  });
  assert.match(trisBufferResult.phAdjustment.hclText, /^4\.45\d mL estimated from Tris Base pKa 8\.06$/);
  assert.equal(trisBufferResult.phAdjustment.naohText, '0 uL');
  const trisStockResult = toolBox.calculateBufferRecipe({
    volumeMl: 1000,
    pH: 8,
    rows: [{ name: 'tris-hcl', stockConcentration: '1 M', finalConcentration: '50 mM' }]
  });
  assert.equal(trisStockResult.phAdjustment.hclText, '0 uL');
  assert.equal(trisStockResult.phAdjustment.naohText, '0 uL');

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

  // A NanoDrop reads ng/uL, so a bare number (or "ng") in Stock Conc. against
  // a ng/uL final is that unit too, not the millimolar default.
  const templateResult = toolBox.calculateFixedReaction({
    totalVolumeValue: '50 uL',
    reagents: [
      { name: 'Template', stockConcentration: '50', finalConcentration: '0.2 ng/uL' },
      { name: 'Template ng', stockConcentration: '50 ng', finalConcentration: '0.2 ng/uL' }
    ]
  });
  assert.match(templateResult.resultText, /Template: 0\.2 uL/i);
  assert.match(templateResult.resultText, /Template ng: 0\.2 uL/i);
  assert.match(templateResult.formulaText, /Template volume = 0\.2 ng\/uL x 50 uL \/ 50 ng\/uL/i);
  assert.doesNotMatch(templateResult.resultText, /matching unit types/i);
});
test('[EDGE] tool-box buffer and fixed reaction UI use typed table cells', () => {
  const ids = [
    'buffer-volume-ml', 'buffer-volume-unit', 'buffer-ph', 'buffer-rows', 'add-buffer-chemical-btn', 'buffer-total-result',
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
      `buffer-amount-${index}`,
      `buffer-note-${index}`,
      `buffer-suggestions-${index}`,
      `fixed-reaction-row-${index}`,
      `fixed-reaction-name-${index}`,
      `fixed-reaction-stock-${index}`,
      `fixed-reaction-final-${index}`,
      `fixed-reaction-volume-${index}`,
      `fixed-reaction-note-${index}`
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
  document.getElementById('buffer-volume-unit').value = 'mL';
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

  assert.match(document.getElementById('buffer-amount-1').placeholder, /8\.766 g/i);
  assert.match(document.getElementById('buffer-amount-2').placeholder, /0\.5 mL/i);
  assert.match(document.getElementById('buffer-solvent-output').textContent, /999\.5 mL/i);
  assert.match(document.getElementById('fixed-reaction-volume-1').placeholder, /10 uL/i);
  assert.match(document.getElementById('fixed-reaction-solvent-output').textContent, /90 uL/i);

  // A weighed-out amount is typed straight over the calculated one.
  document.getElementById('buffer-amount-1').value = '8.8 g';
  trigger(document.getElementById('buffer-amount-1'), 'input');
  assert.match(document.getElementById('buffer-solvent-output').textContent, /999\.5 mL/i);
  document.getElementById('buffer-amount-1').value = '';
  trigger(document.getElementById('buffer-amount-1'), 'input');

  document.getElementById('buffer-volume-unit').value = 'uL';
  trigger(document.getElementById('buffer-volume-unit'), 'change');
  assert.match(document.getElementById('buffer-amount-1').placeholder, /8\.766 mg/i);

  document.getElementById('buffer-name-1').value = 'Stored';
  trigger(document.getElementById('buffer-name-1'), 'input');
  assert.match(document.getElementById('buffer-suggestions-1').innerHTML, /Stored Salt/);
  assert.equal(document.getElementById('buffer-name-1').getAttribute('aria-expanded'), 'true');

  const floatingInput = document.getElementById('buffer-name-1');
  const floatingMenu = document.getElementById('buffer-suggestions-1');
  floatingInput.getBoundingClientRect = () => ({
    top: 720,
    right: 360,
    bottom: 760,
    left: 120,
    width: 240,
    height: 40
  });
  floatingMenu.scrollHeight = 220;
  document.documentElement = { clientWidth: 1000, clientHeight: 800 };
  document.body = {
    appendChild(element) {
      element.parentElement = this;
    }
  };

  trigger(floatingInput, 'focus');
  assert.equal(floatingMenu.classList.contains('tool-box-buffer-suggestions--floating'), true);
  assert.equal(floatingMenu.style.top, 'auto');
  assert.equal(floatingMenu.style.bottom, '81px');
  assert.equal(floatingMenu.style.maxHeight, '230px');
  assert.equal(floatingMenu.style.width, '242px');
});
test('[EDGE] sequence-viewer assembleCloningPlan can prefer restriction-ligation when no final product was supplied', () => {
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
        sequence: 'GCGCCGCGGCCGCGATATGACGTAGCTAGCCCGCGGCGCCGGCGC'
      }
    ]
  });

  assert.equal(plan.feasible, true);
  assert.equal(plan.recommendedAssemblyStrategy, 'restriction-ligation');
  assert.equal(Array.isArray(plan.stepByStepProcedure), true);
  assert.equal(plan.stepByStepProcedure.length >= 4, true);
  assert.equal(Array.isArray(plan.validationPlan), true);
  assert.equal(plan.primerOligoPlan.feasible, true);
  assert.equal(plan.warnings.some((warning) => /No terminal overlap/.test(warning)), false);
  assert.equal(plan.warnings.some((warning) => /manufacturer-recommended buffer/.test(warning)), true);
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
test('[EDGE] builder cloning notebook page uses a thermocycle protocol and prefilled PCR reaction', () => {
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
  const backboneSequence = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG'
    + 'TTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACA'
    + 'CTCAGAAACAGAACTCGGGTAATTTTGACAGGTCACGCAGAGGC';
  const insertSequence = 'ATGCGTACGATCCGATGCTAGCTACGATCGTACCTGACTGATCGTAGCTAGCATGCTACGATCG';
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
      variantMode: 'gibson',
      backboneSequence
    },
    dnaConstruct: {
      sequence: insertSequence,
      length: insertSequence.length,
      parts: [{ label: 'POI', dnaSequence: insertSequence }]
    },
    assembledRecord: {
      name: 'His6-TEV-POI (Host Backbone)',
      sequence: `${backboneSequence}${insertSequence}`
    }
  });

  assert.equal(Boolean(created?.entry), true);
  assert.equal(persisted, true);
  assert.equal(changedCount, 1);
  assert.equal(state.projects.length, 1);
  // The PCR page, plus the Gibson tube this route ends in.
  assert.deepEqual(
    Array.from(state.protocols).map((protocol) => protocol.name),
    ['PCR Thermocycle Program', 'Gibson Assembly']
  );
  assert.equal(state.notebookEntries.length, 2);
  assert.equal(state.notebookEntries[0].notebookState, 'planned');
  assert.equal(created.protocol.name, 'PCR Thermocycle Program');
  const assembly = created.stepEntries[0];
  assert.equal(assembly.experimentName, 'His6-TEV-POI Gibson Assembly');
  assert.equal(assembly.toolCalculations[0].table.rows[0][0], '2x Gibson assembly master mix');
  assert.equal(assembly.toolCalculations[0].table.metaRows[0][1], '20 uL');
  assert.match(created.protocol.steps[0].text, /Initial denaturation.*98 C.*30 s/i);
  assert.match(created.protocol.steps[1].text, /Repeat for 30 cycles.*Denaturation.*Annealing.*Extension/i);
  assert.doesNotMatch(created.protocol.steps.map((step) => step.text).join('\n'), /Transform|ligation|assembly reaction/i);
  assert.equal(state.notebookEntries[0].protocolSnapshot.name, 'PCR Thermocycle Program');
  assert.match(state.notebookEntries[0].result, /PCR program/i);
  assert.match(state.notebookEntries[0].result, /Primers/i);
  assert.equal(state.notebookEntries[0].resultTable.rows.length > 0, true);
  assert.equal(state.notebookEntries[0].toolCalculations.length, 1);
  const reaction = state.notebookEntries[0].toolCalculations[0];
  assert.equal(reaction.title, 'Fixed Volume Reaction');
  assert.deepEqual(Array.from(reaction.table.headers), ['Item', 'Stock Conc.', 'Final Conc.', 'Volume', 'Note']);
  assert.deepEqual(Array.from(reaction.table.rows).map((row) => row[0]), [
    'Forward primer',
    'Reverse primer',
    'dNTP mix',
    'High-fidelity DNA polymerase',
    '5x polymerase buffer',
    'Template DNA (10 ng)'
  ]);
  assert.equal(reaction.table.metaRows[0][1], '50 uL');
  assert.equal(reaction.table.footerRows[0][0], 'Nuclease-free water');
  // The template mass is a final concentration; its own stock is unknown until
  // the miniprep is measured, so both it and the water stay as formulas.
  assert.match(reaction.table.rows[5][3], /0\.2 ng\/uL x 50 uL \/ \[stock concentration\]/);
  assert.match(reaction.table.footerRows[0][3], /50 uL - .*\[Template DNA \(10 ng\) volume\]/);
  assert.equal(created.plan.primerOligoPlan.feasible, true);
});
test('[EDGE] builder cloning notebook migration replaces only legacy assembly protocols', () => {
  const notebookAdapter = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder-cloning-notebook.js')
  );
  const pcrProgram = {
    steps: [
      { label: 'Initial denaturation', temperature: '98 C', time: '30 s', cycles: '1' },
      { label: 'Denaturation', temperature: '98 C', time: '10 s', cycles: '30' },
      { label: 'Annealing', temperature: '57 C', time: '20 s', cycles: '30' },
      { label: 'Extension', temperature: '72 C', time: '1 min 45 s', cycles: '30' },
      { label: 'Final extension', temperature: '72 C', time: '2 min', cycles: '1' },
      { label: 'Hold', temperature: '4 C', time: 'hold', cycles: '1' }
    ]
  };
  const legacyEntry = {
    id: 'legacy-cloning-page',
    protocolId: 'protein-builder-cloning-assembly-protocol',
    protocolName: 'Protein Builder Cloning Assembly',
    protocolSnapshot: {
      id: 'protein-builder-cloning-assembly-protocol',
      name: 'Protein Builder Cloning Assembly',
      steps: [{ id: 'legacy-step', text: 'Assemble reaction.', placeholders: [] }]
    },
    proteinBuilderCloningDesign: { source: 'protein_builder_cloning_assembly', pcrProgram }
  };
  const editedEntry = {
    ...legacyEntry,
    id: 'edited-cloning-page',
    protocolName: 'My edited PCR protocol',
    protocolSnapshot: {
      id: 'protein-builder-cloning-assembly-protocol',
      name: 'My edited PCR protocol',
      steps: [{ id: 'edited-step', text: 'Use my validated cycling conditions.', placeholders: [] }]
    }
  };
  const state = {
    protocols: [{
      id: 'protein-builder-cloning-assembly-protocol',
      name: 'Protein Builder Cloning Assembly',
      steps: legacyEntry.protocolSnapshot.steps,
      createdAt: '2026-04-27T00:00:00.000Z'
    }],
    notebookEntries: [legacyEntry, editedEntry]
  };

  assert.equal(notebookAdapter.migrateProteinBuilderCloningNotebookState(state), 1);
  assert.equal(state.protocols[0].name, 'PCR Thermocycle Program');
  assert.equal(state.protocols[0].createdAt, '2026-04-27T00:00:00.000Z');
  assert.equal(state.notebookEntries[0].protocolName, 'PCR Thermocycle Program');
  assert.match(state.notebookEntries[0].protocolSnapshot.steps[1].text, /Annealing - 57 C.*Extension - 72 C - 1 min 45 s/i);
  assert.equal(state.notebookEntries[1].protocolName, 'My edited PCR protocol');
  assert.equal(state.notebookEntries[1].protocolSnapshot.steps[0].text, 'Use my validated cycling conditions.');
});
test('[EDGE] protein-builder Gibson backbone keeps primer design on the Gibson route', () => {
  const notebookAdapter = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder-cloning-notebook.js')
  );
  const backboneSequence = deterministicDna(240, 211);
  const insertSequence = deterministicDna(120, 223);
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
  const hostForward = plan.primerOligoPlan.primers.find((primer) => primer.name === 'vector F');
  const insertReverse = plan.primerOligoPlan.primers.find((primer) => primer.name === 'Offset-POI R');

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
  const insertForward = plan.primerOligoPlan.primers.find((primer) => primer.name === '6xHis Tagged-POI F');
  const insertReverse = plan.primerOligoPlan.primers.find((primer) => primer.name === 'Tagged-POI R');
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
test('[EDGE] tool-box parseCrisprTargetsInput keeps sequences when a prose line is present', () => {
  const parsed = toolBox.parseCrisprTargetsInput([
    'Source: Addgene plasmid',
    'GAGTCCGAGCAGAAGAAGAAGGGACGTACGTACGT',
    'ACGTACGTACGTTTTACGTACGTACGTAGGACGTA'
  ].join('\n'));
  const sequences = parsed.map((target) => target.sequence);
  assert.equal(sequences.includes('GAGTCCGAGCAGAAGAAGAAGGGACGTACGTACGT'), true);
  assert.equal(sequences.includes('ACGTACGTACGTTTTACGTACGTACGTAGGACGTA'), true);
});
test('[EDGE] tool-box parseCrisprTargetsInput splits ragged lines instead of fusing them', () => {
  const parsed = toolBox.parseCrisprTargetsInput('ACGTACGTACGTACGTACGTACGTAGG\nACGTACGT');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].sequence, 'ACGTACGTACGTACGTACGTACGTAGG');
  assert.equal(parsed[1].sequence, 'ACGTACGT');
});
test('[EDGE] tool-box parseCrisprTargetsInput joins one fixed-width wrapped sequence', () => {
  const lines = ['ACGTACGTAC'.repeat(6), 'TTGGCCAATT'.repeat(6), 'ACGTAGG'];
  const parsed = toolBox.parseCrisprTargetsInput(lines.join('\n'));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].sequence, lines.join(''));
});
test('[EDGE] tool-box parseCrisprTargetsInput names every line of a fully named list', () => {
  const parsed = toolBox.parseCrisprTargetsInput('TP53: ACGTACGTACGTACGTACGT\nBRCA1 | GGGGACGTACGTACGTACGT');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, 'TP53');
  assert.equal(parsed[0].id, 'target-1');
  assert.equal(parsed[1].name, 'BRCA1');
  assert.equal(parsed[1].id, 'target-2');
});
test('[EDGE] tool-box designCrisprGuides handles targets with over 130k PAM sites', () => {
  // Every position is an NGG site, so this clears the ~130k spread-argument limit cheaply.
  const targets = [{ id: 'target-1', name: 'Big', sequence: 'G'.repeat(150000) }];
  const result = toolBox.designCrisprGuides({
    selectedTargets: targets,
    backgroundTargets: targets,
    guideLength: 20,
    pamPattern: 'NGG',
    minGc: 0,
    maxGc: 100,
    topCount: 5
  });
  assert.equal(result.totalPamMatches > 130000, true);
  assert.equal(result.candidates.length, 5);
});
test('[EDGE] tool-box designCrisprGuides flags guides needing a U6 G prefix', () => {
  const withG = toolBox.designCrisprGuides({
    selectedTargets: [{ id: 'target-1', name: 'T', sequence: 'ATATGTATAGGAAAA' }],
    backgroundTargets: [],
    guideLength: 4,
    pamPattern: 'NGG',
    minGc: 0,
    maxGc: 100,
    topCount: 5
  });
  const withoutG = toolBox.designCrisprGuides({
    selectedTargets: [{ id: 'target-1', name: 'T', sequence: 'ATATATATAGGAAAA' }],
    backgroundTargets: [],
    guideLength: 4,
    pamPattern: 'NGG',
    minGc: 0,
    maxGc: 100,
    topCount: 5
  });
  assert.equal(withG.candidates[0].guideSequence, 'GTAT');
  assert.equal(withG.candidates[0].notes.includes('prepend G for U6'), false);
  assert.equal(withoutG.candidates[0].guideSequence, 'ATAT');
  assert.equal(withoutG.candidates[0].notes.includes('prepend G for U6'), true);
});
test('[EDGE] tool-box buildCrisprGuideTsv emits a header plus one row per guide', () => {
  const result = toolBox.designCrisprGuides({
    selectedTargets: [{ id: 'target-1', name: 'Target\tOne', sequence: 'ATATATATAGGAAAA' }],
    backgroundTargets: [],
    guideLength: 4,
    pamPattern: 'NGG',
    minGc: 0,
    maxGc: 100,
    topCount: 5
  });
  const lines = toolBox.buildCrisprGuideTsv(result.candidates).split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].split('\t').length, 13);
  const cells = lines[1].split('\t');
  assert.equal(cells.length, 13, 'a tab in the target name must not add a column');
  assert.equal(cells[0], '1');
  assert.equal(cells[1], 'Target One');
  assert.equal(cells[5], 'ATAT');
  assert.equal(cells[6], 'AGG');
});
test('[EDGE] tool-box buildCrisprGuideTsv returns just the header with no guides', () => {
  assert.equal(toolBox.buildCrisprGuideTsv([]).split('\n').length, 1);
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
  const stats = toolBox.computeCrisprOffTargetStats(candidate, background);
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
    topCount: 10
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
