module.exports = function registerEdgeToolBoxSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
[
  ['0', 0],
  ['1', 1],
  ['1.5', 1.5],
  ['-2.5', -2.5],
  ['1e3', 1000],
  ['', 0],
  [' ', 0],
  ['abc', 0],
  [null, 0],
  [undefined, 0],
  [NaN, 0],
  [Infinity, 0],
  ['0x10', 16],
  [true, 1],
  [false, 0]
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box toNumber case ${idx + 1}`, () => {
    assert.equal(toolBox.toNumber(input), expected);
  });
});

[
  ['fM', 1e-15],
  ['pM', 1e-12],
  ['nM', 1e-9],
  ['uM', 1e-6],
  ['mM', 1e-3],
  ['M', 1]
].forEach(([unit, factor]) => {
  [-3, -1, 0, 0.25, 2, 10].forEach((value, idx) => {
    test(`[EDGE] tool-box concentration roundtrip ${unit} value case ${idx + 1}`, () => {
      const inM = toolBox.concentrationToM(value, unit);
      assertClose(inM, value * factor, 1e-12);
      const back = toolBox.concentrationFromM(inM, unit);
      assertClose(back, value, 1e-9);
    });
  });
});

[
  ['uL', 1e-6],
  ['mL', 1e-3],
  ['L', 1]
].forEach(([unit, factor]) => {
  [-2, -1, 0, 0.5, 2, 100].forEach((value, idx) => {
    test(`[EDGE] tool-box volume roundtrip ${unit} value case ${idx + 1}`, () => {
      const inL = toolBox.volumeToL(value, unit);
      assertClose(inL, value * factor, 1e-12);
      const back = toolBox.volumeFromL(inL, unit);
      assertClose(back, value, 1e-9);
    });
  });
});

[
  ['ug', 1e-6],
  ['mg', 1e-3],
  ['g', 1],
  ['kg', 1e3]
].forEach(([unit, factor]) => {
  [-1, 0, 0.1, 1, 12.5].forEach((value, idx) => {
    test(`[EDGE] tool-box mass roundtrip ${unit} value case ${idx + 1}`, () => {
      const inG = toolBox.massToG(value, unit);
      assertClose(inG, value * factor, 1e-9);
      const back = toolBox.massFromG(inG, unit);
      assertClose(back, value, 1e-9);
    });
  });
});

[
  ['ACGT', 'DNA', 'ACGT'],
  ['acgt', 'DNA', 'ACGT'],
  ['acgu', 'DNA', 'ACGT'],
  ['acgt', 'RNA', 'ACGU'],
  ['acgu', 'RNA', 'ACGU'],
  ['A C-G_T', 'DNA', 'ACGT'],
  ['NNNACGTNN', 'DNA', 'ACGT'],
  ['NNNACGUNN', 'RNA', 'ACGU'],
  ['ttrryy', 'DNA', 'TT'],
  ['uuxxyy', 'RNA', 'UU'],
  ['123456', 'DNA', ''],
  [null, 'DNA', ''],
  [undefined, 'RNA', ''],
  ['ATUG', 'RNA', 'AUUG'],
  ['ATUG', 'DNA', 'ATTG']
].forEach(([raw, type, expected], idx) => {
  test(`[EDGE] tool-box cleanNucleotideSequence case ${idx + 1}`, () => {
    assert.equal(toolBox.cleanNucleotideSequence(raw, type), expected);
  });
});

[
  ['ATGC', 'GCAT'],
  ['AAAA', 'TTTT'],
  ['CCCC', 'GGGG'],
  ['NNNN', 'NNNN'],
  ['', ''],
  ['ATGX', 'NCAT']
].forEach(([input, expected], idx) => {
  test(`[EDGE] tool-box reverseComplementDna case ${idx + 1}`, () => {
    assert.equal(toolBox.reverseComplementDna(input), expected);
  });
});

[
  { seq: 'ATGGCC', frame: 1, stopMode: 'star', protein: 'MA', codons: 2, strand: '+', remainder: 0 },
  { seq: 'ATGGCC', frame: 2, stopMode: 'star', protein: 'W', codons: 1, strand: '+', remainder: 2 },
  { seq: 'ATGGCC', frame: 3, stopMode: 'star', protein: 'G', codons: 1, strand: '+', remainder: 1 },
  { seq: 'ATGTAAATG', frame: 1, stopMode: 'trim', protein: 'M', codons: 2, strand: '+', remainder: 0 },
  { seq: 'ATGTAAATG', frame: 1, stopMode: 'star', protein: 'M*M', codons: 3, strand: '+', remainder: 0 },
  { seq: 'ATGAAA', frame: -1, stopMode: 'star', protein: 'FH', codons: 2, strand: '-', remainder: 0 },
  { seq: 'ATGAAA', frame: -2, stopMode: 'star', protein: 'F', codons: 1, strand: '-', remainder: 2 }
].forEach((scenario, idx) => {
  test(`[EDGE] tool-box translateDnaSequence case ${idx + 1}`, () => {
    const result = toolBox.translateDnaSequence(scenario.seq, scenario.frame, scenario.stopMode);
    assert.equal(result.protein, scenario.protein);
    assert.equal(result.codons, scenario.codons);
    assert.equal(result.strand, scenario.strand);
    assert.equal(result.remainderBases, scenario.remainder);
  });
});

[
  ['m k*t1', true, 'MK*T'],
  ['m k*t1', false, 'MKT'],
  ['bjouxz*', true, 'BJOUXZ*'],
  ['', true, ''],
  [null, true, '']
].forEach(([input, allowStop, expected], idx) => {
  test(`[EDGE] tool-box cleanProteinSequence case ${idx + 1}`, () => {
    assert.equal(toolBox.cleanProteinSequence(input, allowStop), expected);
  });
});

[
  ['gaattc AAGCTT ggtctc', ['GAATTC', 'AAGCTT', 'GGTCTC'], []],
  ['EcoRI NNNN atg', ['ATG'], ['ECORI', 'NNNN']],
  ['', [], []]
].forEach(([input, expectedSites, expectedIgnored], idx) => {
  test(`[EDGE] tool-box parseRestrictionSites case ${idx + 1}`, () => {
    const parsed = toolBox.parseRestrictionSites(input);
    assert.equal(JSON.stringify(parsed.sites), JSON.stringify(expectedSites));
    assert.equal(JSON.stringify(parsed.ignoredTokens), JSON.stringify(expectedIgnored));
  });
});

test('[EDGE] tool-box parseRestrictionSites expands reverse complement motifs', () => {
  const parsed = toolBox.parseRestrictionSites('GGTCTC');
  assert.equal(parsed.expandedSites.includes('GGTCTC'), true);
  assert.equal(parsed.expandedSites.includes('GAGACC'), true);
});

test('[EDGE] tool-box reverseTranslateProteinSequence basic translation is valid', () => {
  const result = toolBox.reverseTranslateProteinSequence('MRA', { organism: 'ecoli' });
  assert.equal(result.ok, true);
  assert.equal(result.dna.length, 9);
  assert.equal(toolBox.translateDnaSequence(result.dna, 1, 'star').protein, 'MRA');
});

test('[EDGE] tool-box reverseTranslateProteinSequence reflects organism codon preferences', () => {
  const ecoli = toolBox.reverseTranslateProteinSequence('RRR', { organism: 'ecoli' });
  const yeast = toolBox.reverseTranslateProteinSequence('RRR', { organism: 'yeast' });
  assert.equal(ecoli.ok, true);
  assert.equal(yeast.ok, true);
  assert.notEqual(ecoli.dna, yeast.dna);
});

[
  'mouse',
  'rat',
  'pichia',
  'arabidopsis',
  'drosophila',
  'c_elegans',
  'zebrafish',
  'pseudomonas',
  'salmonella'
].forEach((organismKey, idx) => {
  test(`[EDGE] tool-box reverseTranslateProteinSequence supports extra species case ${idx + 1}`, () => {
    const result = toolBox.reverseTranslateProteinSequence('MRT', { organism: organismKey });
    assert.equal(result.ok, true);
    assert.equal(result.organism, organismKey);
    assert.equal(toolBox.translateDnaSequence(result.dna, 1, 'star').protein, 'MRT');
  });
});

test('[EDGE] tool-box reverseTranslateProteinSequence applies new species codon preferences', () => {
  const ecoli = toolBox.reverseTranslateProteinSequence('KKK', { organism: 'ecoli' });
  const pseudomonas = toolBox.reverseTranslateProteinSequence('KKK', { organism: 'pseudomonas' });
  assert.equal(ecoli.ok, true);
  assert.equal(pseudomonas.ok, true);
  assert.notEqual(ecoli.dna, pseudomonas.dna);
});

test('[EDGE] tool-box reverseTranslateProteinSequence can avoid a requested restriction site', () => {
  const unconstrained = toolBox.reverseTranslateProteinSequence('EF', { organism: 'ecoli' });
  const constrained = toolBox.reverseTranslateProteinSequence('EF', {
    organism: 'ecoli',
    restrictionSites: ['GAATTC']
  });

  assert.equal(unconstrained.ok, true);
  assert.equal(constrained.ok, true);
  assert.equal(unconstrained.dna.includes('GAATTC'), true);
  assert.equal(constrained.dna.includes('GAATTC'), false);
  assert.equal(toolBox.translateDnaSequence(constrained.dna, 1, 'star').protein, 'EF');
});

test('[EDGE] tool-box reverseTranslateProteinSequence reports impossible restriction constraints', () => {
  const blocked = toolBox.reverseTranslateProteinSequence('M', {
    organism: 'ecoli',
    restrictionSites: ['ATG']
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'restriction_conflict');
  assert.equal(blocked.blockedPosition, 1);
});

test('[EDGE] tool-box reverseTranslateProteinSequence appends stop codon when requested', () => {
  const withStop = toolBox.reverseTranslateProteinSequence('MA', {
    organism: 'ecoli',
    appendStopCodon: true
  });
  assert.equal(withStop.ok, true);
  assert.equal(withStop.protein, 'MA*');
  assert.equal(toolBox.translateDnaSequence(withStop.dna, 1, 'star').protein, 'MA*');

  const alreadyStopped = toolBox.reverseTranslateProteinSequence('MA*', {
    organism: 'ecoli',
    appendStopCodon: true
  });
  assert.equal(alreadyStopped.ok, true);
  assert.equal(alreadyStopped.protein, 'MA*');
  assert.equal(toolBox.translateDnaSequence(alreadyStopped.dna, 1, 'star').protein, 'MA*');
});

test('[EDGE] tool-box reverseTranslateProteinSequence rejects unsupported amino acids', () => {
  const result = toolBox.reverseTranslateProteinSequence('MX');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported_residue');
  assert.equal(result.unsupportedResidues.includes('X'), true);
});

[
  ['A', 'DNA', 313.21, 15400],
  ['AT', 'DNA', 617.41, 24100],
  ['AU', 'RNA', 635.38, 25300],
  ['GGCC', 'DNA', (329.21 * 2) + (289.18 * 2), (11500 * 2) + (7400 * 2)]
].forEach(([sequence, type, mwExpected, extExpected], idx) => {
  test(`[EDGE] tool-box oligo properties case ${idx + 1}`, () => {
    assertClose(toolBox.oligoMolecularWeight(sequence, type), mwExpected, 1e-4);
    assert.equal(toolBox.oligoExtinction(sequence, type), extExpected);
  });
});

[
  ['ATGC', 'DNA', 12],
  ['ATGCGCATATGCAT', 'DNA', 64.9 + (41 * (6 - 16.4)) / 14],
  ['AUGC', 'RNA', 12],
  ['', 'DNA', 0]
].forEach(([sequence, type, expected], idx) => {
  test(`[EDGE] tool-box oligoTm case ${idx + 1}`, () => {
    assertClose(toolBox.oligoTm(sequence, type), expected, 1e-6);
  });
});

test('[EDGE] tool-box evaluateOverlapPcr recognizes strong existing terminal overlaps', () => {
  const overlap = 'GCGCGCGCGCGCGCGCG';
  const result = toolBox.evaluateOverlapPcr([
    { id: 'frag-a', name: 'Fragment A', sequence: `AAATTT${overlap}` },
    { id: 'frag-b', name: 'Fragment B', sequence: `${overlap}TTTAAA` }
  ]);

  assert.equal(result.feasible, true);
  assert.equal(result.junctions.length, 1);
  assert.equal(result.junctions[0].mode, 'existing');
  assert.equal(result.junctions[0].overlapSequence, overlap);
});

test('[EDGE] tool-box evaluateOverlapPcr can propose primer-introduced overlaps', () => {
  const result = toolBox.evaluateOverlapPcr([
    { id: 'frag-a', name: 'Fragment A', sequence: 'ATATATATATATGGGGGGGGGGGGGGAAAA' },
    { id: 'frag-b', name: 'Fragment B', sequence: 'GCGCGCGCGCGCGCGCGTTTAAAATTTAAA' }
  ]);

  assert.equal(result.feasible, true);
  assert.equal(result.junctions.length, 1);
  assert.equal(result.junctions[0].mode, 'primer-introduced');
  assert.equal(result.junctions[0].overlapLength >= 12, true);
});

test('[EDGE] tool-box evaluateGibsonAssembly supports multi-fragment junction analysis', () => {
  const overlapOne = 'GCGCGCGCGCGCGCGCG';
  const overlapTwo = 'CGCGCGCGCGCGCGCGC';
  const result = toolBox.evaluateGibsonAssembly([
    { id: 'frag-a', name: 'Fragment A', sequence: `AAA${overlapOne}` },
    { id: 'frag-b', name: 'Fragment B', sequence: `${overlapOne}TTT${overlapTwo}` },
    { id: 'frag-c', name: 'Fragment C', sequence: `${overlapTwo}GGGAAA` }
  ]);

  assert.equal(result.feasible, true);
  assert.equal(result.junctions.length, 2);
  assert.equal(result.junctions.every((junction) => junction.feasible), true);
});

test('[EDGE] tool-box evaluateRestrictionLigation selects a clean unique cutter pair', () => {
  const result = toolBox.evaluateRestrictionLigation({
    host: {
      id: 'host-1',
      name: 'Host Backbone',
      topology: 'circular',
      sequence: 'TTTGGATCCAAAAAAGGTACCTTT'
    },
    fragments: [
      {
        id: 'insert-1',
        name: 'Insert 1',
        type: 'insert',
        sequence: 'GCGCGCGCGCGCGATTTTTTTTTTGCGCGCGCGCGCGAT'
      }
    ]
  });

  assert.equal(result.feasible, true);
  assert.equal(Array.isArray(result.selectedSites), true);
  assert.equal(result.selectedSites.length, 2);
  assert.equal(new Set(result.selectedSites.map((site) => site.segments[0].start)).size, 2);
  assert.equal(result.selectedSites.every((site) => (
    !'GCGCGCGCGCGCGATTTTTTTTTTGCGCGCGCGCGCGAT'.includes(String(site.site || '').replace(/[^ACGT]/g, ''))
  )), true);
});

test('[EDGE] tool-box evaluateRestrictionLigation rejects insert-conflicting site pairs', () => {
  const result = toolBox.evaluateRestrictionLigation({
    host: {
      id: 'host-1',
      name: 'Host Backbone',
      topology: 'circular',
      sequence: 'TTTGGATCCAAAAAAGGTACCTTT'
    },
    fragments: [
      {
        id: 'insert-1',
        name: 'Insert 1',
        type: 'insert',
        sequence: 'AAAGGATCCGGGGGTACC'
      }
    ]
  });

  assert.equal(result.feasible, false);
  assert.equal(result.selectedSites, null);
});

test('[EDGE] tool-box evaluateSiteDirectedMutagenesis supports point mutation requests', () => {
  const result = toolBox.evaluateSiteDirectedMutagenesis({
    host: {
      id: 'host-1',
      name: 'Template',
      sequence: 'ATGAAACCCGGGTTTAAACCCGGG'
    },
    editRequest: {
      type: 'point-mutation',
      start: 4,
      end: 6,
      originalSequence: 'AAA',
      editedSequence: 'GAA'
    }
  });

  assert.equal(result.feasible, true);
  assert.equal(result.editType, 'point-mutation');
});

test('[EDGE] tool-box evaluateSiteDirectedMutagenesis supports short insertion requests', () => {
  const result = toolBox.evaluateSiteDirectedMutagenesis({
    host: {
      id: 'host-1',
      name: 'Template',
      sequence: 'ATGAAACCCGGGTTTAAACCCGGG'
    },
    editRequest: {
      type: 'insertion',
      position: 10,
      editedSequence: 'GCGCGC'
    }
  });

  assert.equal(result.feasible, true);
  assert.equal(result.editType, 'insertion');
});

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

test('[EDGE] tool-box designCrisprGuides respects GC filtering', () => {
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
    minGc: 50,
    maxGc: 100,
    topCount: 10,
    genomeMultiplier: 1
  });
  assert.equal(result.totalPamMatches, 1);
  assert.equal(result.filteredCandidateCount, 0);
  assert.equal(result.candidates.length, 0);
});

  }
};
