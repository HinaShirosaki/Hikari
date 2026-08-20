module.exports = function registerEdgeToolBoxSuitePart01(context = {}) {
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
  ['nL', 1e-9],
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
test('[EDGE] sequence-viewer evaluateOverlapPcr recognizes strong existing terminal overlaps', () => {
  const overlap = 'GCGCGCGCGCGCGCGCG';
  const result = sequenceViewerInternals.evaluateOverlapPcr([
    { id: 'frag-a', name: 'Fragment A', sequence: `AAATTT${overlap}` },
    { id: 'frag-b', name: 'Fragment B', sequence: `${overlap}TTTAAA` }
  ]);

  assert.equal(result.feasible, true);
  assert.equal(result.junctions.length, 1);
  assert.equal(result.junctions[0].mode, 'existing');
  assert.equal(result.junctions[0].overlapSequence, overlap);
});
test('[EDGE] sequence-viewer evaluateOverlapPcr can propose primer-introduced overlaps', () => {
  const result = sequenceViewerInternals.evaluateOverlapPcr([
    { id: 'frag-a', name: 'Fragment A', sequence: 'ATATATATATATGGGGGGGGGGGGGGAAAA' },
    { id: 'frag-b', name: 'Fragment B', sequence: 'GCGCGCGCGCGCGCGCGTTTAAAATTTAAA' }
  ]);

  assert.equal(result.feasible, true);
  assert.equal(result.junctions.length, 1);
  assert.equal(result.junctions[0].mode, 'primer-introduced');
  assert.equal(result.junctions[0].overlapLength >= 12, true);
});
test('[EDGE] sequence-viewer evaluateGibsonAssembly supports multi-fragment junction analysis', () => {
  const overlapOne = 'GCGCGCGCGCGCGCGCG';
  const overlapTwo = 'CGCGCGCGCGCGCGCGC';
  const result = sequenceViewerInternals.evaluateGibsonAssembly([
    { id: 'frag-a', name: 'Fragment A', sequence: `AAA${overlapOne}` },
    { id: 'frag-b', name: 'Fragment B', sequence: `${overlapOne}TTT${overlapTwo}` },
    { id: 'frag-c', name: 'Fragment C', sequence: `${overlapTwo}GGGAAA` }
  ]);

  assert.equal(result.feasible, true);
  assert.equal(result.junctions.length, 2);
  assert.equal(result.junctions.every((junction) => junction.feasible), true);
});
test('[EDGE] sequence-viewer evaluateRestrictionLigation selects a clean unique cutter pair', () => {
  const result = sequenceViewerInternals.evaluateRestrictionLigation({
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
test('[EDGE] sequence-viewer evaluateRestrictionLigation rejects insert-conflicting site pairs', () => {
  const result = sequenceViewerInternals.evaluateRestrictionLigation({
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
test('[EDGE] sequence-viewer evaluateSiteDirectedMutagenesis supports point mutation requests', () => {
  const result = sequenceViewerInternals.evaluateSiteDirectedMutagenesis({
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
test('[EDGE] sequence-viewer evaluateSiteDirectedMutagenesis supports short insertion requests', () => {
  const result = sequenceViewerInternals.evaluateSiteDirectedMutagenesis({
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
test('[EDGE] sequence-viewer designCloningPrimers designs simple site-directed mutagenesis primers', () => {
  const template = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG'
    + 'TTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACA'
    + 'CTCAGAAACAGAACTCGGGTAATTTTGACAGGTCACGCAGAGGC';
  const mutationStart = 40;
  const primerPlan = sequenceViewerInternals.designCloningPrimers({
    strategy: 'site-directed-mutagenesis',
    selectedHost: {
      id: 'host-1',
      name: 'Template',
      sequence: template
    },
    editRequest: {
      type: 'point-mutation',
      start: mutationStart + 1,
      end: mutationStart + 3,
      originalSequence: template.slice(mutationStart, mutationStart + 3),
      editedSequence: 'GAA'
    }
  });

  assert.equal(primerPlan.feasible, true);
  assert.equal(primerPlan.primerCount, 2);
  assert.equal(primerPlan.primers[0].role, 'mutagenesis-forward');
  assert.equal(primerPlan.primers[1].role, 'mutagenesis-reverse');
  assert.equal(primerPlan.primers[0].tailSequence, 'GAA');
  assert.equal(primerPlan.primers[1].tailSequence, 'TTC');
  assert.equal(primerPlan.primerTmDifferences[0].pair, 'mutagenesis');
  assert.equal(primerPlan.primerTmDifferences[0].tmDifference, 0);
});
test('[EDGE] sequence-viewer designCloningPrimers preserves insertion boundaries for mutagenesis primers', () => {
  const template = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG'
    + 'TTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACA'
    + 'CTCAGAAACAGAACTCGGGTAATTTTGACAGGTCACGCAGAGGC';
  const insertAt = 70;
  const insertedSequence = 'CCATGG';
  const primerPlan = sequenceViewerInternals.designCloningPrimers({
    strategy: 'site-directed-mutagenesis',
    selectedHost: {
      id: 'host-1',
      name: 'Template',
      sequence: template
    },
    editRequest: {
      type: 'insertion',
      position: insertAt + 1,
      start: insertAt + 1,
      end: insertAt + 1,
      originalSequence: '',
      editedSequence: insertedSequence
    }
  });

  assert.equal(primerPlan.feasible, true);
  const forwardPrimer = primerPlan.primers[0];
  const insertionIndex = forwardPrimer.sequence.indexOf(insertedSequence);
  assert.equal(insertionIndex >= 0, true);
  const leftArm = forwardPrimer.sequence.slice(0, insertionIndex);
  const rightArm = forwardPrimer.sequence.slice(insertionIndex + insertedSequence.length);
  assert.equal(leftArm, template.slice(insertAt - leftArm.length, insertAt));
  assert.equal(rightArm, template.slice(insertAt, insertAt + rightArm.length));
});
  }
};
