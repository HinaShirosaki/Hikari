module.exports = function registerEdgeCloningAssemblySuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    const cloningAssemblyPath = path.join(
      __dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-assembly'
    );
    const restriction = loadEsmStyleModule(path.join(cloningAssemblyPath, 'restriction-ligation.js'));
    const primerRecords = loadEsmStyleModule(path.join(cloningAssemblyPath, 'primer-records.js'));
    const overlapEvaluation = loadEsmStyleModule(path.join(cloningAssemblyPath, 'overlap-evaluation.js'));
    const assembly = loadEsmStyleModule(
      path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-assembly.js')
    );

    // --- Fix #2: restriction-site matching must honor IUPAC ambiguity codes ---
    test('[EDGE] cloning sequenceContainsSite matches a degenerate site (GTMKAC)', () => {
      // GTAGAC satisfies GTMKAC (M=A/C, K=G/T); the bare 4-mer GTAC must not.
      assert.equal(restriction.sequenceContainsSite('AAAGTAGACAAA', 'GTMKAC'), true);
      assert.equal(restriction.sequenceContainsSite('AAAGTACAAA', 'GTMKAC'), false);
    });

    test('[EDGE] cloning sequenceContainsSite honors N runs (CACNNNGTG)', () => {
      assert.equal(restriction.sequenceContainsSite('CCCCACAAAGTGCCC', 'CACNNNGTG'), true);
      // Old strip-to-CACGTG behavior would have missed this.
      assert.equal(restriction.sequenceContainsSite('CCCCACGTGCCC', 'CACNNNGTG'), false);
    });

    test('[EDGE] cloning sequenceContainsSite finds reverse-strand and exact sites', () => {
      // GAGACC is the reverse complement of GGTCTC (BsaI).
      assert.equal(restriction.sequenceContainsSite('TTTGAGACCTTT', 'GGTCTC'), true);
      assert.equal(restriction.sequenceContainsSite('AAGAATTCAA', 'GAATTC'), true);
      assert.equal(restriction.sequenceContainsSite('AAAAAAAA', 'GAATTC'), false);
    });

    // --- Fix #1: route feasibility honors a relaxable overlap-Tm threshold ---
    test('[EDGE] cloning evaluateGibsonAssembly honors the overlap-Tm threshold', () => {
      const overlap = 'GCGCGCATATATGCGC';
      const fragments = [
        { id: 'f1', type: 'insert', sequence: `AAAAAAAA${overlap}` },
        { id: 'f2', type: 'insert', sequence: `${overlap}TTTTTTTT` }
      ];
      const loose = overlapEvaluation.evaluateGibsonAssembly(fragments, {
        thresholds: { overlapTm: { min: 0, max: 500 }, primerLength: { min: 1, max: 80 }, primerTm: { min: 0, max: 500 } }
      });
      const impossible = overlapEvaluation.evaluateGibsonAssembly(fragments, {
        thresholds: { overlapTm: { min: 999, max: 1000 }, primerLength: { min: 1, max: 80 }, primerTm: { min: 0, max: 500 } }
      });
      assert.equal(loose.feasible, true);
      assert.equal(impossible.feasible, false);
    });

    test('[EDGE] cloning assembleCloningPlan tags each route with a threshold level', () => {
      const result = assembly.assembleCloningPlan({
        hostVectors: [{ id: 'h', name: 'pHost', sequence: 'ATGCGATCGATCGGCTAGCTAGCTAGCATCGATCGGCTAGCGCGATCGATCGTAGCTAGCTAGC', topology: 'circular' }],
        fragments: [
          { id: 'a', type: 'insert', sequence: 'ATGGGCAGCAGCCATCATCATCATCATCACAGCAGCGGCC' },
          { id: 'b', type: 'insert', sequence: 'GAAAACCTGTATTTTCAGGGCGCCATGGATCCGGAATTCG' }
        ]
      });
      assert.ok(['strict', 'moderate', 'relaxed'].includes(result.routeEvaluations.gibson.thresholdLevel));
      assert.ok(['strict', 'moderate', 'relaxed'].includes(result.routeEvaluations.overlapPCR.thresholdLevel));
    });

    // --- Fix #4: primerTmDifferences reports forward/reverse pair gaps ---
    test('[EDGE] cloning summarizePrimerPlan reports forward/reverse pair Tm gaps', () => {
      const primers = [
        { name: 'ins_F', tm: 60 },
        { name: 'ins_R', tm: 64 },
        { name: 'x_F', tm: 58 },
        { name: 'x_R', tm: 59 },
        { name: 'tile_1', tm: 62 }
      ];
      const summary = primerRecords.summarizePrimerPlan(primers);
      const byPair = Object.fromEntries(summary.primerTmDifferences.map((d) => [d.pair, d.tmDifference]));
      assert.equal(summary.primerTmDifferences.length, 2); // tile_1 excluded
      assert.equal(byPair.ins, 4);
      assert.equal(byPair.x, 1);
    });

    // --- Megaprimer restriction-ligation mutagenesis route ---
    test('[EDGE] cloning buildMegaprimerRestrictionPlan builds a 3-primer megaprimer protocol', () => {
      const mega = loadEsmStyleModule(path.join(cloningAssemblyPath, 'megaprimer-restriction.js'));
      const filler = 'ACAGTCATGACTTGACATGTCAGT'.repeat(3);
      const left = 'TTGACCATGGTACCATTGACCATGGTACCATTGACCA';
      const right = 'GGTTCAAGTTCGATGCTAGCTTGACCATGGTTCAAGT';
      const original = `${filler}GAATTC${left}G${right}GGATCC${filler}`;
      const editIndex = filler.length + 6 + left.length; // the single G between the flanks
      const edited = `${original.slice(0, editIndex)}A${original.slice(editIndex + 1)}`;

      const plan = mega.buildMegaprimerRestrictionPlan({
        originalSequence: original,
        editedSequence: edited,
        editRequest: {
          type: 'point-mutation',
          start: editIndex + 1,
          end: editIndex + 1,
          originalSequence: 'G',
          editedSequence: 'A'
        },
        recordName: 'pTest',
        topology: 'circular'
      });

      assert.equal(plan.feasible, true);
      assert.equal(plan.primers.length, 3);
      // one mutagenesis primer + two native-site primers, first added across two PCRs
      assert.equal(plan.primers.filter((p) => p.groupLabel === 'PCR 1').length, 2);
      assert.equal(plan.primers.filter((p) => p.groupLabel === 'PCR 2').length, 1);
      const enzymes = plan.plans[0].plan.restrictionEnzymeSelection;
      assert.equal(enzymes.length, 2);
      assert.notEqual(enzymes[0].site, enzymes[1].site);
      assert.equal(plan.plans[0].plan.stepByStepProcedure.length, 6);
    });

    test('[EDGE] cloning buildMegaprimerRestrictionPlan reports when no flanking sites exist', () => {
      const mega = loadEsmStyleModule(path.join(cloningAssemblyPath, 'megaprimer-restriction.js'));
      const original = 'ATATATATATATATATATATATATATATATATATATATAT';
      const plan = mega.buildMegaprimerRestrictionPlan({
        originalSequence: original,
        editedSequence: `${original.slice(0, 20)}C${original.slice(21)}`,
        editRequest: { type: 'point-mutation', start: 21, end: 21, originalSequence: 'A', editedSequence: 'C' },
        recordName: 'pFlat',
        topology: 'circular'
      });
      assert.equal(plan.feasible, false);
      assert.ok(plan.warnings.length >= 1);
    });

    // --- Q5 / KLD site-directed mutagenesis route ---
    test('[EDGE] cloning buildQ5KldPlan uses non-overlapping primers and a KLD finish', () => {
      const q5 = loadEsmStyleModule(path.join(cloningAssemblyPath, 'q5-kld-mutagenesis.js'));
      const sequence = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'calculations', 'sequence.js'));
      const filler = 'ACAGTCATGACTTGACATGTCAGTACGT'.repeat(4);
      const original = `${filler}GGTACCTATTGACCATG${filler}`;
      const editIndex = filler.length + 6; // the T
      const edited = `${original.slice(0, editIndex)}A${original.slice(editIndex + 1)}`;

      const plan = q5.buildQ5KldPlan({
        originalSequence: original,
        editedSequence: edited,
        editRequest: { type: 'point-mutation', start: editIndex + 1, end: editIndex + 1, originalSequence: 'T', editedSequence: 'A' },
        recordName: 'pT',
        topology: 'circular'
      });

      assert.equal(plan.feasible, true);
      assert.equal(plan.primers.length, 2);
      const forward = plan.primers.find((p) => p.name === 'q5_F');
      const reverse = plan.primers.find((p) => p.name === 'q5_R');
      // back-to-back divergent primers, NOT the overlapping complementary QuikChange pair
      assert.notEqual(sequence.reverseComplementDna(forward.sequence), reverse.sequence);
      assert.equal(forward.sequence.startsWith('A'), true); // edit rides the forward 5' end
      const steps = plan.plans[0].plan.stepByStepProcedure;
      assert.equal(steps.length, 4);
      assert.ok(/KLD/.test(steps[2].details));
      assert.equal(plan.plans[0].plan.restrictionEnzymeSelection, null);
    });

    // --- Golden Gate (Type IIS) route ---
    test('[EDGE] cloning buildGoldenGatePlan tails primers with a clean Type IIS enzyme', () => {
      const gg = loadEsmStyleModule(path.join(cloningAssemblyPath, 'golden-gate.js'));
      const seq = `${'ACAGTCATGACTTGACATGTCAGTACGT'.repeat(3)}CATTGCAGATCTTAGGCCATTAGCTAACGTTAGCGATCGT${'TTGACATGTCAGTACGT'.repeat(3)}`;
      const start = 84;
      const end = 124;
      const insert = seq.slice(start, end);

      const plan = gg.buildGoldenGatePlan({ sequence: seq, range: { start, end }, recordName: 'pGG', topology: 'circular' });
      assert.equal(plan.feasible, true);
      assert.equal(plan.primers.length, 2);
      const enzyme = plan.plans[0].plan.restrictionEnzymeSelection[0];
      assert.equal(plan.primers.every((p) => p.sequence.includes(enzyme.site)), true);
      // scarless: the exposed overhang is the native first 4 nt of the insert
      assert.equal(plan.primers[0].bindingSequence.slice(0, 4), insert.slice(0, 4));
    });

    test('[EDGE] cloning buildGoldenGatePlan reports when the insert needs domestication', () => {
      const gg = loadEsmStyleModule(path.join(cloningAssemblyPath, 'golden-gate.js'));
      const dirty = 'GGTCTCAAAAGAAGACAAAACGTCTCAAAAAAAAAA'; // contains BsaI + BbsI + BsmBI
      const plan = gg.buildGoldenGatePlan({ sequence: `AAAAAAAA${dirty}AAAAAAAA`, range: { start: 8, end: 8 + dirty.length }, recordName: 'pDirty' });
      assert.equal(plan.feasible, false);
      assert.ok(/domesticate/i.test(plan.warnings[0]));
    });

    // --- sequence_viewer / sequence_edit MCP contract core ---
    test('[EDGE] sequence-viewer agent API reads, proposes without mutating, and re-verifies targets', () => {
      const agentApi = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'agent', 'agent-api.js'));
      const filler = 'ACAGTCATGACTTGACATGTCAGTACGT'.repeat(4);
      const seq = `${filler}GGTACCTATTGACCATG${filler}`;
      const records = [{ id: 'genbank_1', name: 'pTest', topology: 'circular', sequence: seq, features: [{ id: 'f1', name: 'CDS1', type: 'CDS', strand: 1, segments: [{ start: 10, end: 40 }] }] }];
      const api = agentApi.createSequenceViewerAgentApi({
        getRecords: () => records,
        getSelectedIndex: () => 0,
        getActiveEntryId: () => 'entry_9',
        getCloningDesignSource: () => null,
        createToken: () => 'tok1'
      });

      const rec = api.getRecord({ recordId: 'genbank_1', include: ['stats', 'features'] });
      assert.equal(rec.target.baseDigest, agentApi.sequenceDigest(seq));
      assert.equal(rec.features[0].segments[0].start, 11); // 1-based

      const editIndex = filler.length + 7;
      const proposal = api.proposeEdit({ target: rec.target, mode: 'replace', start: editIndex, end: editIndex, sequence: 'A' });
      assert.equal(proposal.pending_approval, true);
      assert.equal(records[0].sequence, seq); // propose never mutates
      assert.ok(api.verifyTarget(proposal.target).record);

      records[0] = { ...records[0], sequence: `${seq}AAA` }; // simulate drift
      assert.equal(api.verifyTarget(proposal.target).error.code, 'TARGET_CHANGED');
      records[0] = { ...records[0], sequence: seq };
    });

    test('[EDGE] sequence-viewer agent API design_cloning is compute-only and normalizes strategy', () => {
      const agentApi = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'agent', 'agent-api.js'));
      const filler = 'ACAGTCATGACTTGACATGTCAGTACGT'.repeat(4);
      const seq = `${filler}GGTACCTATTGACCATG${filler}`;
      const records = [{ id: 'genbank_1', name: 'pTest', topology: 'circular', sequence: seq, features: [] }];
      const api = agentApi.createSequenceViewerAgentApi({ getRecords: () => records });
      const editIndex = filler.length + 7;

      const result = api.designCloning({ recordId: 'genbank_1', strategy: 'q5-kld', edit: { mode: 'replace', start: editIndex, end: editIndex, sequence: 'A' } });
      assert.equal(result.strategy, 'q5-kld');           // echoes contract id
      assert.equal(result.engineRoute, 'site-directed-mutagenesis'); // raw engine route surfaced
      assert.ok(Array.isArray(result.primers));
      assert.equal(records[0].sequence, seq);            // compute-only, no mutation
    });
  }
};
