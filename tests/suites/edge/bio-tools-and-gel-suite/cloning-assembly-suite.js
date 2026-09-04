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
      assert.equal(plan.primers.every((primer) => primer.ampliconLength > 0), true);
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

    test('[EDGE] cloning buildQ5KldPlan splits a long insertion across correctly oriented 5-prime tails', () => {
      const q5 = loadEsmStyleModule(path.join(cloningAssemblyPath, 'q5-kld-mutagenesis.js'));
      const sequence = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'calculations', 'sequence.js'));
      const left = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG';
      const right = 'TTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACA';
      const insertion = 'ATGCGTACGATCCGATGCTAGCTACGATCGTACCTGACTGATCGTAGCTAGCATGCTACGATCG';
      const original = `${left}${right}`;
      const plan = q5.buildQ5KldPlan({
        originalSequence: original,
        editedSequence: `${left}${insertion}${right}`,
        editRequest: { type: 'insertion', position: left.length + 1, editedSequence: insertion },
        recordName: 'pLong',
        topology: 'circular'
      });

      assert.equal(plan.feasible, true);
      const forward = plan.primers.find((primer) => primer.name === 'q5_F');
      const reverse = plan.primers.find((primer) => primer.name === 'q5_R');
      assert.equal(forward.length <= 60, true);
      assert.equal(reverse.length <= 60, true);
      assert.equal(`${sequence.reverseComplementDna(reverse.tailSequence)}${forward.tailSequence}`, insertion);
      assert.equal(original.includes(forward.sequence.slice(-12)), true);
      assert.equal(original.includes(sequence.reverseComplementDna(reverse.sequence.slice(-12))), true);
    });

    test('[EDGE] cloning buildQ5KldPlan rejects a linear template', () => {
      const q5 = loadEsmStyleModule(path.join(cloningAssemblyPath, 'q5-kld-mutagenesis.js'));
      const original = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG';
      const plan = q5.buildQ5KldPlan({
        originalSequence: original,
        editedSequence: `${original.slice(0, 30)}A${original.slice(31)}`,
        editRequest: { type: 'point-mutation', start: 31, end: 31, originalSequence: original[30], editedSequence: 'A' },
        topology: 'linear'
      });
      assert.equal(plan.feasible, false);
      assert.match(plan.warnings[0], /circular plasmid template/);
    });

    // --- Golden Gate (Type IIS) route ---
    test('[EDGE] cloning buildGoldenGatePlan tails primers with a clean Type IIS enzyme', () => {
      const gg = loadEsmStyleModule(path.join(cloningAssemblyPath, 'golden-gate.js'));
      const seq = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG'
        + 'TTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACA'
        + 'CTCAGAAACAGAACTCGGGTAATTTTGACAGGTCACGCAGAGGC';
      const start = 20;
      const end = 80;
      const insert = seq.slice(start, end);

      const plan = gg.buildGoldenGatePlan({ sequence: seq, range: { start, end }, recordName: 'pGG', topology: 'circular' });
      assert.equal(plan.feasible, true);
      assert.equal(plan.primers.length, 4);
      assert.equal(new Set(plan.primers.map((primer) => primer.groupLabel)).size, 2);
      const enzyme = plan.plans[0].plan.restrictionEnzymeSelection[0];
      assert.equal(plan.primers.every((p) => p.sequence.includes(enzyme.site)), true);
      assert.equal(plan.primers.every((p) => p.sequence.indexOf(enzyme.site) >= 6), true);
      // scarless: the exposed overhang is the native first 4 nt of the insert
      assert.equal(plan.primers[0].bindingSequence.slice(0, 4), insert.slice(0, 4));
    });

    test('[EDGE] cloning restriction-ligation rejects a digest that cannot recreate the requested construct', () => {
      const host = 'TTTGGATCCAAAAAAGGTACCTTT';
      const insert = 'GCGCCGCGGCCGCGATATGACGTAGCTAGCCCGCGGCGCCGGCGC';
      const plan = assembly.assembleCloningPlan({
        hostVectors: [{ id: 'h', name: 'Host', topology: 'circular', sequence: host }],
        hostVectorId: 'h',
        fragments: [{ id: 'i', name: 'Insert', type: 'insert', sequence: insert }],
        resultSequence: `${host}${insert}`
      });

      assert.equal(plan.routeEvaluations.restrictionLigation.feasible, false);
      assert.match(plan.routeEvaluations.restrictionLigation.reason, /matches the requested result/i);
      assert.notEqual(plan.recommendedAssemblyStrategy, 'restriction-ligation');
    });

    test('[EDGE] cloning megaprimer restriction design wraps flanking sites across a circular origin', () => {
      const mega = loadEsmStyleModule(path.join(cloningAssemblyPath, 'megaprimer-restriction.js'));
      const core = 'ACAGTCATGACTTGACATGTCAGTACGT'.repeat(4);
      const original = `ATGCGTACGGATCC${core}GAATTCTGCA`;
      const plan = mega.buildMegaprimerRestrictionPlan({
        originalSequence: original,
        editedSequence: `C${original.slice(1)}`,
        editRequest: { type: 'point-mutation', start: 1, end: 1, originalSequence: 'A', editedSequence: 'C' },
        recordName: 'pOrigin',
        topology: 'circular'
      });

      assert.equal(plan.feasible, true);
      const selected = plan.plans[0].plan.restrictionEnzymeSelection;
      assert.equal(selected[0].segments[0].start > selected[1].segments[0].start, true);
      const pcrOneLength = plan.primers.find((primer) => primer.groupLabel === 'PCR 1').ampliconLength;
      const pcrTwoLength = plan.primers.find((primer) => primer.groupLabel === 'PCR 2').ampliconLength;
      assert.equal(pcrOneLength < original.length, true);
      assert.equal(pcrTwoLength < original.length, true);
    });

    test('[EDGE] cloning PCR primer design rejects exact multi-site binding', () => {
      const unit = 'GCGTACGATCGTACGCGTATCGATGCTAGCCAGTACGATGCGTACGATCG';
      const repeated = `${unit}AATTCCGG${unit}TTGGCCAA${unit}`;
      const result = assembly.designPcrPrimerPair(repeated, { name: 'repeat' });
      assert.equal(result.feasible, false);
      assert.equal(result.primers.length, 0);

      // The amplicon can be only one copy of a repeated feature. Specificity is
      // still judged against the complete plasmid used as the PCR template.
      const selectedCopy = assembly.designPcrPrimerPair(unit, {
        name: 'selected copy',
        specificitySequence: repeated,
        specificityCircular: true
      });
      assert.equal(selectedCopy.feasible, false);
      assert.match(selectedCopy.warnings.join(' '), /binds more than one site/);
    });

    test('[EDGE] cloning buildGoldenGatePlan reports when the insert needs domestication', () => {
      const gg = loadEsmStyleModule(path.join(cloningAssemblyPath, 'golden-gate.js'));
      const dirty = 'GGTCTCAAAAGAAGACAAAACGTCTCAAAAAAAAAA'; // contains BsaI + BbsI + BsmBI
      const plan = gg.buildGoldenGatePlan({ sequence: `AAAAAAAA${dirty}AAAAAAAA`, range: { start: 8, end: 8 + dirty.length }, recordName: 'pDirty' });
      assert.equal(plan.feasible, false);
      assert.ok(/domesticate/i.test(plan.warnings[0]));
    });

    test('[EDGE] cloning buildGoldenGatePlan rejects reverse-complementary junction overhangs', () => {
      const gg = loadEsmStyleModule(path.join(cloningAssemblyPath, 'golden-gate.js'));
      const insert = 'AAGCATGCGTACCTAGGCACTGATCCGTA';
      const backbone = 'GCTTTACGATGCCATAGTCCGATACGTA'; // GCTT is reverse-complementary to AAGC.
      const plan = gg.buildGoldenGatePlan({
        sequence: `${insert}${backbone}`,
        range: { start: 0, end: insert.length },
        recordName: 'pCrossCompatible'
      });
      assert.equal(plan.feasible, false);
      assert.match(plan.warnings[0], /reverse-complementary/i);
    });

    // --- Overlap-extension route: cut sites out of primer reach ---
    // Deterministic non-repeating filler; random-looking sequence is what makes
    // unique primer windows and unique cutters available at all.
    function filler(length, seed) {
      let state = seed >>> 0;
      let out = '';
      for (let index = 0; index < length; index += 1) {
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5; state >>>= 0;
        out += 'ACGT'[state % 4];
      }
      return out;
    }

    test('[EDGE] Golden Gate checks the whole vector and selected donor as PCR templates', () => {
      const gg = loadEsmStyleModule(path.join(cloningAssemblyPath, 'golden-gate.js'));
      const cloningDesign = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-design.js')
      );
      let fixture = null;
      for (let seed = 1; seed <= 80 && !fixture; seed += 1) {
        const insert = filler(180, seed * 7);
        const backbone = filler(520, (seed * 11) + 3);
        const sequence = `${insert}${backbone}`;
        const range = { start: 0, end: insert.length };
        const plan = gg.buildGoldenGatePlan({
          sequence,
          range,
          recordName: 'pGolden',
          topology: 'circular',
          vectorTemplateSequence: sequence
        });
        if (plan.feasible) {
          fixture = { insert, backbone, sequence, range };
        }
      }
      assert.ok(fixture, 'expected a deterministic feasible Golden Gate fixture');

      const duplicatedVector = `${fixture.insert}${fixture.backbone}${fixture.insert}`;
      const duplicateVectorPlan = gg.buildGoldenGatePlan({
        sequence: duplicatedVector,
        range: fixture.range,
        recordName: 'pDuplicated',
        topology: 'circular',
        vectorTemplateSequence: duplicatedVector
      });
      assert.equal(duplicateVectorPlan.feasible, false);

      const displayPlanForDonor = (donor) => cloningDesign.buildDisplayPlan({
        strategy: 'golden-gate',
        source: {
          recordName: 'pGolden',
          originalSequence: fixture.sequence,
          editedSequence: fixture.sequence,
          editRequest: { type: 'replacement', start: 1, end: 1, originalSequence: 'A', editedSequence: 'A' }
        },
        record: { name: 'pGolden', topology: 'circular', sequence: fixture.sequence, features: [] },
        range: fixture.range,
        donor
      });
      const uniqueDonorPlan = displayPlanForDonor({
        name: 'pUniqueDonor',
        topology: 'circular',
        sequence: `${filler(240, 97)}${fixture.insert}${filler(230, 103)}`
      });
      assert.equal(uniqueDonorPlan.feasible, true);
      assert.match(uniqueDonorPlan.plans[0].plan.stepByStepProcedure[1].details, /pUniqueDonor/);

      const duplicateDonorPlan = displayPlanForDonor({
        name: 'pDuplicateDonor',
        topology: 'circular',
        sequence: `${filler(240, 97)}${fixture.insert}${filler(210, 101)}${fixture.insert}${filler(230, 103)}`
      });
      assert.equal(duplicateDonorPlan.feasible, false);
      assert.equal(duplicateDonorPlan.primers.length, 0);

      assert.equal(cloningDesign.cloningStrategyUsesDonor('golden-gate'), true);
      assert.equal(cloningDesign.cloningStrategyUsesDonor('overlap-extension'), true);
      assert.equal(cloningDesign.cloningStrategyUsesDonor('two-step-ligation'), false);
      assert.equal(cloningDesign.cloningStrategyUsesInsertRange('overlap-extension'), true);
      assert.equal(cloningDesign.isCloningDesignPlanActionable({ feasible: false, primers: [{ name: 'partial' }] }), false);
      assert.equal(cloningDesign.isCloningDesignPlanActionable({ feasible: true, primers: [{ name: 'complete' }] }), true);
    });

    test('[EDGE] Golden Gate templates the insert off this record when no donor is chosen', () => {
      const cloningDesign = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-design.js')
      );
      // A real insertion edit: the pre-edit vector cannot carry the insert, so
      // checking insert specificity against it rejects every window and the
      // route reports a threshold failure it can never recover from.
      const planFor = (seed) => {
        const gene = filler(240, (seed * 7) + 1);
        const vector = filler(900, (seed * 13) + 5);
        const edited = `${vector.slice(0, 400)}${gene}${vector.slice(400)}`;
        return {
          gene,
          plan: cloningDesign.buildDisplayPlan({
            strategy: 'golden-gate',
            source: {
              recordName: 'pVec',
              originalSequence: vector,
              editedSequence: edited,
              editRequest: { type: 'insertion', start: 401, end: 400, originalSequence: '', editedSequence: gene }
            },
            record: { name: 'pVec', topology: 'circular', sequence: edited, features: [] },
            range: { start: 400, end: 400 + gene.length }
          })
        };
      };

      let fixture = null;
      for (let seed = 1; seed <= 40 && !fixture; seed += 1) {
        const candidate = planFor(seed);
        if (!/every candidate Type IIS/.test(candidate.plan.warnings?.[0] || '')) {
          fixture = candidate;
        }
      }
      assert.ok(fixture, 'expected a fixture with a usable Type IIS enzyme');
      assert.equal(fixture.plan.feasible, true);
      // Both insert primers anneal to sequence that exists in the tube.
      const complement = { A: 'T', C: 'G', G: 'C', T: 'A' };
      const revComp = (sequence) => [...sequence].reverse().map((base) => complement[base] || base).join('');
      fixture.plan.primers
        .filter((primer) => primer.name.startsWith('gg_insert'))
        .forEach((primer) => {
          assert.ok(
            fixture.gene.includes(primer.bindingSequence)
              || fixture.gene.includes(revComp(primer.bindingSequence)),
            `${primer.name} does not bind the insert`
          );
        });
    });

    test('[EDGE] an AT-rich Gibson seam splits its overlap across both primers', () => {
      const windows = loadEsmStyleModule(path.join(cloningAssemblyPath, 'overlap-windows.js'));
      const assemblyPrimers = loadEsmStyleModule(path.join(cloningAssemblyPath, 'assembly-primers.js'));
      const constants = loadEsmStyleModule(path.join(cloningAssemblyPath, 'constants.js'));
      const oligo = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'calculations', 'oligo.js')
      );
      const thresholds = constants.CLONING_PRIMER_TM_THRESHOLDS.relaxed;
      const config = constants.DEFAULT_CLONING_PREFERENCES;

      const chars = (length, seed, alphabet) => {
        let state = (seed >>> 0) || 1;
        let out = '';
        for (let index = 0; index < length; index += 1) {
          state ^= state << 13; state >>>= 0;
          state ^= state >>> 17;
          state ^= state << 5; state >>>= 0;
          out += alphabet[state % alphabet.length];
        }
        return out;
      };
      // 20% GC at both sides of the seam: the AmpR->KanR swap in pETDuet-1 has
      // exactly this shape, and it needed ~35 nt of overlap to reach Tm.
      const atRich = (length, seed) => chars(length, seed, 'ATATATATGC');
      const insert = `${atRich(40, 15)}${chars(600, 27, 'ACGT')}`;
      const backbone = `${chars(1500, 51, 'ACGT')}${atRich(40, 69)}`;
      const fragments = [
        { id: 'host_backbone', name: 'backbone', type: 'backbone', sequence: backbone },
        { id: 'edited_amplicon', name: 'insert', type: 'insert', sequence: insert }
      ];

      // Hanging the whole overlap off the left fragment's reverse primer, as the
      // route used to, cannot solve this seam at any overlap length: the tail and
      // the binding window an AT-rich flank needs do not fit in one oligo.
      const oneSidedWorks = (left, right) => {
        for (let length = 12; length <= 40; length += 1) {
          const overlap = right.slice(0, length);
          const tm = oligo.cloningPrimerTm(overlap);
          if (tm < thresholds.overlapTm.min || tm > thresholds.overlapTm.max) {
            continue;
          }
          if (windows.selectBindingWindow(left, 'reverse', thresholds, length, config)) {
            return true;
          }
        }
        return false;
      };
      assert.equal(oneSidedWorks(backbone, insert), false);

      const evaluation = overlapEvaluation.evaluateFragmentAssembly(fragments, { circular: true, thresholds });
      assert.equal(evaluation.feasible, true);
      evaluation.junctions.forEach((junction) => {
        assert.equal(junction.mode, 'primer-introduced');
        assert.equal(junction.rightForwardTail.length + junction.leftReverseTail.length, junction.overlapLength);
      });
      // The AT-rich seam is the one that has to be split; the other junction is
      // ordinary and keeps the cheaper one-sided tail.
      const atRichJunction = evaluation.junctions.find((junction) => junction.leftFragmentId === 'host_backbone');
      assert.ok(atRichJunction.rightForwardTail.length > 0, 'AT-rich seam was not split');
      assert.ok(atRichJunction.leftReverseTail.length > 0, 'AT-rich seam was not split');

      const design = assemblyPrimers.designAssemblyPrimersForRoute(
        evaluation.fragments, evaluation.junctions, thresholds, config
      );
      assert.equal(design.feasible, true);
      assert.equal(design.primers.length, 4);
      design.primers.forEach((primer) => {
        assert.ok(primer.length <= config.maxPrimerLength, `${primer.name} is ${primer.length} nt`);
      });

      // The two amplicons have to share both seams and rebuild the plasmid.
      const complement = { A: 'T', C: 'G', G: 'C', T: 'A' };
      const revComp = (sequence) => [...sequence].reverse().map((base) => complement[base] || base).join('');
      const ampliconFor = (fragmentId, sequence) => {
        const forward = design.primers.find((primer) => primer.templateId === fragmentId && / F$|_F$/.test(primer.name));
        const reverse = design.primers.find((primer) => primer.templateId === fragmentId && / R$|_R$/.test(primer.name));
        return `${forward.tailSequence}${sequence}${revComp(reverse.tailSequence)}`;
      };
      const backboneAmplicon = ampliconFor('host_backbone', backbone);
      const insertAmplicon = ampliconFor('edited_amplicon', insert);
      const seam = (left, right) => {
        for (let length = Math.min(left.length, right.length); length >= 10; length -= 1) {
          if (left.slice(left.length - length) === right.slice(0, length)) {
            return length;
          }
        }
        return 0;
      };
      const forwardSeam = seam(backboneAmplicon, insertAmplicon);
      const wrapSeam = seam(insertAmplicon, backboneAmplicon);
      assert.ok(forwardSeam >= 20, `forward seam is only ${forwardSeam} nt`);
      assert.ok(wrapSeam >= 20, `wrap seam is only ${wrapSeam} nt`);
      const assembled = backboneAmplicon.slice(0, backboneAmplicon.length - forwardSeam)
        + insertAmplicon.slice(0, insertAmplicon.length - wrapSeam);
      // The product is circular, so it rebuilds the plasmid up to rotation.
      assert.equal(assembled.length, backbone.length + insert.length);
      assert.ok(`${backbone}${insert}${backbone}${insert}`.includes(assembled), 'assembly does not rebuild the plasmid');
    });

    test('[EDGE] a donor that does not carry the insert is rejected without a long scan', () => {
      const insert = filler(1500, 31);
      // Nothing in common: the old length-by-length scan took ~20 s here.
      const started = Date.now();
      assert.equal(primerRecords.findTemplateCoreInDesiredSequence(insert, filler(10000, 77)), null);
      assert.ok(Date.now() - started < 2000, 'wrong-donor rejection must not block the renderer');

      // A donor carrying the gene still yields the core, tag and all.
      const tag = 'CATCATCATCATCATCAC';
      const donor = `${filler(800, 11)}${insert}${filler(700, 13)}`;
      const core = primerRecords.findTemplateCoreInDesiredSequence(`${tag}${insert}`, donor);
      // Cross-realm objects fail strict deepEqual, so compare the fields.
      assert.equal(core.desiredStart, tag.length);
      assert.equal(core.templateStart, 800);
      assert.equal(core.length, insert.length);

      // And so does one that shares only part of it.
      const partial = primerRecords.findTemplateCoreInDesiredSequence(
        insert,
        `${filler(600, 41)}${insert.slice(200, 900)}${filler(600, 43)}`
      );
      assert.equal(partial.length, 700);
      assert.equal(partial.desiredStart, 200);
      assert.equal(partial.templateStart, 600);
    });

    test('[EDGE] a vector picked in Vector Builder arrives as the cloning design donor', async () => {
      const cloningDesign = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-design.js')
      );
      const storage = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'storage.js')
      );
      const makeElement = () => ({
        hidden: false,
        disabled: false,
        value: '',
        textContent: '',
        innerHTML: '',
        style: {},
        classList: (() => {
          const tokens = new Set();
          return {
            add: (token) => tokens.add(token),
            remove: (token) => tokens.delete(token),
            contains: (token) => tokens.has(token),
            toggle: (token, on) => (on ? tokens.add(token) : tokens.delete(token))
          };
        })(),
        listeners: {},
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        }
      });
      const elements = {
        cloningDesignWorkspace: makeElement(),
        cloningDesignStrategyList: makeElement(),
        cloningDesignEditSummary: makeElement(),
        cloningDesignRangePanel: makeElement(),
        cloningDesignInsertStartInput: makeElement(),
        cloningDesignInsertEndInput: makeElement(),
        cloningDesignDonorPanel: makeElement(),
        cloningDesignDonorSelect: makeElement(),
        cloningDesignDonorNote: makeElement(),
        cloningDesignRunBtn: makeElement(),
        cloningDesignConfirmBtn: makeElement(),
        cloningDesignStatus: makeElement(),
        cloningDesignResult: makeElement()
      };
      const original = filler(360, 211);
      const edited = `${original.slice(0, 120)}A${original.slice(121)}`;
      const record = { name: 'pSeed', topology: 'circular', sequence: edited, features: [] };
      // The Vector Builder replace names the vector it took the feature from.
      const source = {
        recordName: 'pSeed edit',
        originalSequence: original,
        editedSequence: edited,
        donorEntryId: 'donor-a',
        donorName: 'Donor A',
        editRequest: { type: 'replacement', start: 121, end: 121, originalSequence: original[120], editedSequence: 'A' }
      };
      const state = {
        records: [record],
        selectedRecordIndex: 0,
        libraryEntries: [{ id: 'donor-a', name: 'Donor A' }],
        cloningDesign: {}
      };
      const controller = cloningDesign.createSequenceViewerCloningDesignController({
        elements,
        state,
        getSelectedRecord: () => record,
        getCloningDesignSource: () => source,
        getBridge: () => ({
          sequenceLibraryGet: async () => ({
            ok: true,
            entry: { id: 'donor-a', name: 'Donor A' },
            gbkText: storage.buildRecordGenbankText({
              name: 'Donor_A',
              topology: 'circular',
              sequence: filler(420, 223),
              features: []
            })
          })
        }),
        getStoragePath: () => '/tmp/sequence-library'
      });
      controller.bindEvents();
      controller.render();

      // No dropdown interaction: the donor is already the chosen vector.
      assert.equal(state.cloningDesign.donorEntryId, 'donor-a');
      await flushAsync();
      await flushAsync();
      assert.match(elements.cloningDesignDonorNote.textContent, /Donor_A/);
      assert.equal(elements.cloningDesignRunBtn.disabled, false);
    });

    test('[EDGE] cloning design ignores stale donor hydration and blocks incomplete actions', async () => {
      const cloningDesign = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-design.js')
      );
      const storage = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'storage.js')
      );
      const makeElement = () => ({
        hidden: false,
        disabled: false,
        value: '',
        textContent: '',
        innerHTML: '',
        style: {},
        classList: (() => {
          const tokens = new Set();
          return {
            add: (token) => tokens.add(token),
            remove: (token) => tokens.delete(token),
            contains: (token) => tokens.has(token),
            toggle: (token, on) => (on ? tokens.add(token) : tokens.delete(token))
          };
        })(),
        listeners: {},
        addEventListener(type, listener) {
          this.listeners[type] = listener;
        }
      });
      const elements = {
        cloningDesignWorkspace: makeElement(),
        cloningDesignStrategyList: makeElement(),
        cloningDesignEditSummary: makeElement(),
        cloningDesignRangePanel: makeElement(),
        cloningDesignInsertStartInput: makeElement(),
        cloningDesignInsertEndInput: makeElement(),
        cloningDesignDonorPanel: makeElement(),
        cloningDesignDonorSelect: makeElement(),
        cloningDesignDonorNote: makeElement(),
        cloningDesignRunBtn: makeElement(),
        cloningDesignConfirmBtn: makeElement(),
        cloningDesignStatus: makeElement(),
        cloningDesignResult: makeElement()
      };
      const original = filler(360, 151);
      const edited = `${original.slice(0, 120)}A${original.slice(121)}`;
      const record = { name: 'pRace', topology: 'circular', sequence: edited, features: [] };
      const source = {
        recordName: 'pRace edit',
        originalSequence: original,
        editedSequence: edited,
        editRequest: { type: 'replacement', start: 121, end: 121, originalSequence: original[120], editedSequence: 'A' }
      };
      const pending = new Map();
      const bridge = {
        sequenceLibraryGet({ id }) {
          return new Promise((resolve) => pending.set(id, resolve));
        }
      };
      const state = {
        records: [record],
        selectedRecordIndex: 0,
        libraryEntries: [
          { id: 'donor-a', name: 'Donor A' },
          { id: 'donor-b', name: 'Donor B' }
        ],
        cloningDesign: {}
      };
      const statuses = [];
      let orderCalls = 0;
      const controller = cloningDesign.createSequenceViewerCloningDesignController({
        elements,
        state,
        getSelectedRecord: () => record,
        getCloningDesignSource: () => source,
        getBridge: () => bridge,
        getStoragePath: () => '/tmp/sequence-library',
        setStatus(message, isError) {
          statuses.push({ message, isError });
        },
        onRequestPrimerOrder() {
          orderCalls += 1;
        }
      });
      controller.bindEvents();
      controller.render();

      elements.cloningDesignStrategyList.listeners.click({
        target: {
          closest(selector) {
            return selector === '[data-cloning-design-strategy]'
              ? { dataset: { cloningDesignStrategy: 'gibson' } }
              : null;
          }
        }
      });

      elements.cloningDesignDonorSelect.value = 'donor-a';
      elements.cloningDesignDonorSelect.listeners.change();
      elements.cloningDesignDonorSelect.value = 'donor-b';
      elements.cloningDesignDonorSelect.listeners.change();
      assert.equal(elements.cloningDesignRunBtn.disabled, true);

      const donorGbk = (name, seed) => storage.buildRecordGenbankText({
        name,
        topology: 'circular',
        sequence: filler(420, seed),
        features: []
      });
      pending.get('donor-a')({ ok: true, entry: { id: 'donor-a', name: 'Donor A' }, gbkText: donorGbk('Donor_A', 157) });
      await flushAsync();
      await flushAsync();
      assert.equal(elements.cloningDesignRunBtn.disabled, true, 'stale A must not clear B loading');
      assert.equal(elements.cloningDesignDonorNote.textContent.includes('Donor_A'), false);

      pending.get('donor-b')({ ok: true, entry: { id: 'donor-b', name: 'Donor B' }, gbkText: donorGbk('Donor_B', 163) });
      await flushAsync();
      await flushAsync();
      assert.equal(elements.cloningDesignRunBtn.disabled, false);
      assert.match(elements.cloningDesignDonorNote.textContent, /Donor_B/);
      assert.equal(state.cloningDesign.donorEntryId, 'donor-b');

      state.cloningDesign.displayPlan = {
        strategy: 'gibson',
        feasible: false,
        plans: [],
        primers: [{ name: 'partial F', role: 'assembly-forward', sequence: 'ACGT', bindingSequence: 'ACGT' }],
        warnings: ['Insert reverse primer failed.'],
        summary: {}
      };
      controller.render();
      assert.equal(elements.cloningDesignConfirmBtn.disabled, true);
      assert.equal(elements.cloningDesignResult.innerHTML.includes('Order Primers'), false);
      assert.equal(await controller.confirmDesign(), null);
      elements.cloningDesignResult.listeners.click({
        preventDefault() {},
        target: {
          closest(selector) {
            return selector === '[data-cloning-design-action="order-primers"]' ? {} : null;
          }
        }
      });
      assert.equal(orderCalls, 0);
      assert.equal(statuses.some((entry) => /feasible, complete primer design/.test(entry.message)), true);
    });

    test('[EDGE] cloning buildOverlapExtensionLigationPlan fuses vector flanks around the insert', () => {
      const oe = loadEsmStyleModule(path.join(cloningAssemblyPath, 'overlap-extension-ligation.js'));
      const insert = filler(600, 23);
      const start = 306;
      const construct = `${filler(start, 7)}${insert}${filler(306, 11)}${filler(1200, 31)}`;
      const end = start + insert.length;

      const plan = oe.buildOverlapExtensionLigationPlan({
        sequence: construct,
        range: { start, end },
        recordName: 'pOverlap',
        topology: 'circular'
      });

      assert.equal(plan.feasible, true);
      // Three PCRs: upstream vector flank, insert, downstream vector flank.
      assert.equal(plan.primers.length, 6);
      assert.equal(new Set(plan.primers.map((primer) => primer.groupLabel)).size, 3);

      const [upstream, downstream] = plan.plans[0].plan.restrictionEnzymeSelection;
      // Both ends are cut by enzymes that cut inside their own site, or the
      // digest would fall off the end of the fusion fragment.
      assert.equal(upstream.cut.includes('^') && downstream.cut.includes('^'), true);

      const backbone = `${construct.slice(end)}${construct.slice(0, start)}`;
      const upstreamStart = upstream.segments[0].start;
      const downstreamEnd = downstream.segments[0].end;
      // Both flanks are longer than a primer tail could carry, which is what
      // makes this route worth its two extra PCRs.
      assert.equal(backbone.length - upstreamStart > 40 && downstreamEnd > 40, true);

      // Digest and ligate: the vector arc that survives the double digest, plus
      // the fusion fragment, must circularize back into the designed construct.
      const product = `${backbone.slice(downstreamEnd, upstreamStart)}${backbone.slice(upstreamStart)}${insert}${backbone.slice(0, downstreamEnd)}`;
      assert.equal(product.length, construct.length);
      assert.equal(`${product}${product}`.includes(construct), true);

      // Outer primers clamp the sites; inner ones carry the fusion overlaps.
      assert.equal(plan.primers[0].tailSequence, 'GCGC');
      assert.equal(plan.primers[5].tailSequence, 'GCGC');
      assert.equal(plan.primers[1].tailSequence.length > 8, true);
      assert.equal(plan.primers[3].tailSequence.length > 8, true);
    });

    test('[EDGE] cloning buildOverlapExtensionLigationPlan defers when a site is within primer reach', () => {
      const oe = loadEsmStyleModule(path.join(cloningAssemblyPath, 'overlap-extension-ligation.js'));
      const insert = 'ATGGCCCTCCTCGCAATGGCCTAGGCTTAACCGGTTACCGATCGATTACGCAGTCCTGAA';
      // AT repeats carry no unique cutter, so the planted site by the insertion
      // point is the only one to find - and it is a primer tail away.
      const backbone = `GAATTC${'AT'.repeat(60)}`;
      const plan = oe.buildOverlapExtensionLigationPlan({
        sequence: `${insert}${backbone}`,
        range: { start: 0, end: insert.length },
        recordName: 'pClose',
        topology: 'circular'
      });

      assert.equal(plan.feasible, false);
      assert.equal(plan.primers.length, 0);
      assert.match(plan.warnings[0], /within primer-tail reach/);
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
      // The echoed edit is what the approval overlay re-applies; it must be the
      // 1-based request verbatim so the host can convert it back to a 0-based edit.
      assert.equal(proposal.edit.mode, 'replace');
      assert.equal(proposal.edit.start, editIndex);
      assert.equal(proposal.edit.end, editIndex);
      assert.equal(proposal.edit.sequence, 'A');
      const insertProposal = api.proposeEdit({ target: rec.target, mode: 'insert', start: editIndex, sequence: 'TT' });
      assert.equal(insertProposal.edit.mode, 'insert');
      assert.equal(insertProposal.edit.start, editIndex);
      assert.equal(insertProposal.edit.end, editIndex); // insert echoes end === start
      assert.equal(insertProposal.edit.sequence, 'TT');
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

      const missingRange = api.designCloning({
        recordId: 'genbank_1',
        strategy: 'gibson',
        edit: { mode: 'replace', start: editIndex, end: editIndex, sequence: 'A' }
      });
      assert.equal(missingRange.error.code, 'INSERT_RANGE_REQUIRED');
      const invalidRange = api.designCloning({
        recordId: 'genbank_1',
        strategy: 'gibson',
        insertRange: { start: 20, end: 10 },
        edit: { mode: 'replace', start: editIndex, end: editIndex, sequence: 'A' }
      });
      assert.equal(invalidRange.error.code, 'INVALID_INSERT_RANGE');

      const toolSchema = JSON.parse(fs.readFileSync(
        path.join(__dirname, 'src', 'main', 'agent', 'tools', 'Tool-call.json'),
        'utf8'
      ))['sequence-viewer'].input_schema;
      assert.deepEqual(toolSchema.properties.insertRange.required, ['start', 'end']);
      assert.equal(
        toolSchema.anyOf.some((branch) => branch.required?.includes('insertRange')
          && branch.properties?.strategy?.enum?.includes('gibson')),
        true
      );
    });

    test('[EDGE] designed primers land on the sequence as primer_bind features', () => {
      const primerAnnotation = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'primer-annotation.js')
      );
      // Non-repeating, so a 22-mer has exactly one match on the template.
      const sequence = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG'
        + 'TTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACA'
        + 'CTCAGAAACAGAACTCGGGTAATTTTGACAGGTCACGCAGAGGC';
      const record = { name: 'pTest', topology: 'circular', sequence, features: [] };
      const forwardBinding = record.sequence.slice(20, 42);
      const reverseBinding = record.sequence.slice(80, 102);

      const result = primerAnnotation.withPrimerBindFeatures(record, [
        // A 5' tail must not be annotated: only the binding half is on the template.
        { name: 'ins_F', role: 'gibson-forward', tm: 62, sequence: `CACCAGGGGGG${forwardBinding}`, bindingSequence: forwardBinding },
        { name: 'ins_R', role: 'gibson-reverse', tm: 61, sequence: reverseBinding, bindingSequence: reverseBinding },
        { name: 'nowhere', role: 'pcr-forward', sequence: 'GGGGGGGGGGGGGGGGGGGGGG' }
      ]);

      // Cross-realm objects fail strict deepEqual, so compare plain snapshots.
      const plain = (value) => JSON.parse(JSON.stringify(value));
      assert.deepEqual(plain(result.unplaced), ['nowhere']);
      assert.equal(result.added.length, 2);
      assert.deepEqual(plain(result.added[0].segments), [{ start: 20, end: 42 }]);
      assert.equal(result.added[0].type, 'primer_bind');
      assert.equal(result.added[0].strand, 1);
      // The reverse primer is given plus-strand here, so it must resolve as -1
      // only when the template match is the reverse complement.
      assert.equal(result.added[1].strand, 1);
      assert.deepEqual(plain(result.added[1].segments), [{ start: 80, end: 102 }]);

      const revcomp = [...reverseBinding].reverse()
        .map((base) => ({ A: 'T', T: 'A', G: 'C', C: 'G' }[base] || 'N')).join('');
      const reversed = primerAnnotation.withPrimerBindFeatures(record, [
        { name: 'ins_R', role: 'pcr-reverse', sequence: revcomp, bindingSequence: revcomp }
      ]);
      assert.equal(reversed.added[0].strand, -1);
      assert.deepEqual(plain(reversed.added[0].segments), [{ start: 80, end: 102 }]);

      // A primer straddling the origin of a plasmid wraps into two segments.
      const wrapping = record.sequence.slice(-10) + record.sequence.slice(0, 12);
      const wrapped = primerAnnotation.withPrimerBindFeatures(record, [
        { name: 'origin_F', role: 'pcr-forward', sequence: wrapping, bindingSequence: wrapping }
      ]);
      assert.deepEqual(plain(wrapped.added[0].segments), [
        { start: record.sequence.length - 10, end: record.sequence.length },
        { start: 0, end: 12 }
      ]);

      // A mutagenesis primer carries the edit, so its binding half matches no
      // template; the full oligo is what lands on the edited construct.
      const mutagenic = primerAnnotation.withPrimerBindFeatures(record, [{
        name: 'mutagenesis_F',
        role: 'mutagenesis-forward',
        sequence: sequence.slice(50, 74),
        bindingSequence: `${sequence.slice(50, 62)}GGGGGGGGGGGG`
      }]);
      assert.deepEqual(plain(mutagenic.added[0].segments), [{ start: 50, end: 74 }]);

      // Re-running a design replaces its own features instead of stacking them.
      const rerun = primerAnnotation.withPrimerBindFeatures(
        { ...record, features: result.features },
        [{ name: 'ins_F', role: 'gibson-forward', sequence: forwardBinding, bindingSequence: forwardBinding }]
      );
      assert.equal(rerun.features.filter((feature) => feature.name === 'ins_F').length, 1);
      // Callers hand over the whole primer set, so the previous run's ins_R goes with it.
      assert.equal(rerun.features.filter((feature) => feature.type === 'primer_bind').length, 1);

      // Replacement keys off the feature source, not the generated id, so renaming a
      // primer between designs cannot leave the old annotation behind.
      const renamed = primerAnnotation.withPrimerBindFeatures(
        { ...record, features: result.features },
        [{ name: 'ins_F_v2', role: 'gibson-forward', sequence: forwardBinding, bindingSequence: forwardBinding }]
      );
      assert.equal(
        renamed.features.filter((feature) => feature.type === 'primer_bind').map((feature) => feature.name).join('|'),
        'ins_F_v2'
      );
    });

    test('[EDGE] a repeated template is reported as a specificity failure, not a Tm failure', () => {
      const windows = loadEsmStyleModule(path.join(cloningAssemblyPath, 'overlap-windows.js'));
      const thresholds = { primerTm: { min: 55, max: 70 }, primerLength: { min: 18, max: 30 }, overlapTm: { min: 45, max: 70 } };
      const unit = 'ATGCGATCGATCGGCTAGCTAGCTAGCATCGATCGGCTAGCGCGATCGATCGTAGCTAGCTAGC'
        + 'GGTTACCAGTTTACAGGATCCATTCGGAAACCTTAGCATCGGATCCAATTCGGATTCAGGCATT';
      const tandem = unit.repeat(2);
      const unique = unit + [...unit].reverse().join('');
      const config = { specificityCircular: true };

      // Every window on a tandem-duplicated template binds twice, and no
      // threshold level can fix that, so the message must say so.
      assert.equal(windows.selectBindingWindow(tandem, 'forward', thresholds, 0, { ...config, specificitySequence: tandem }), null);
      assert.match(
        windows.describeBindingWindowFailure(tandem, 'forward', thresholds, 0, { ...config, specificitySequence: tandem }),
        /binds more than one site/
      );

      // A template that does design a primer explains nothing.
      assert.notEqual(windows.selectBindingWindow(unique, 'forward', thresholds, 0, { ...config, specificitySequence: unique }), null);
      assert.equal(windows.describeBindingWindowFailure(unique, 'forward', thresholds, 0, { ...config, specificitySequence: unique }), '');

      // A window that is nowhere on the template is a different failure: the
      // template is wrong, not repetitive, and saying "repeated" sends the user
      // to fix the wrong thing.
      const foreign = [...unit].reverse().join('');
      assert.match(
        windows.describeBindingWindowFailure(foreign, 'forward', thresholds, 0, { ...config, specificitySequence: tandem }),
        /No candidate window occurs anywhere on the PCR template/
      );

      // Nor does a plain Tm/length miss, which the threshold ladder can still fix.
      // Non-repeating, so the only reason nothing matches is the Tm window.
      const shortTemplate = 'GCTAAAGACAATTACATAACATACACGTCAGCA';
      assert.equal(
        windows.describeBindingWindowFailure(shortTemplate, 'forward', { ...thresholds, primerTm: { min: 90, max: 95 } }, 0, {
          specificitySequence: shortTemplate
        }),
        ''
      );
    });

    test('[EDGE] mutagenesis routes name the repeat when a flank is not unique', () => {
      const q5 = loadEsmStyleModule(path.join(cloningAssemblyPath, 'q5-kld-mutagenesis.js'));
      const mutagenesis = loadEsmStyleModule(path.join(cloningAssemblyPath, 'mutagenesis-simple.js'));
      const editMap = loadEsmStyleModule(path.join(cloningAssemblyPath, 'edit-map.js'));

      // A plasmid built from one repeated unit: every flank of the edit occurs twice.
      const unit = 'ACAGTCATGACTTGACATGTCAGTACGTTTGACCATGGTACCATTGACCATGGTACCATTGACCA';
      const original = unit.repeat(2);
      const editIndex = 20;
      const edited = `${original.slice(0, editIndex)}A${original.slice(editIndex + 1)}`;
      const editRequest = {
        type: 'point-mutation', start: editIndex + 1, end: editIndex + 1,
        originalSequence: original[editIndex], editedSequence: 'A'
      };

      const q5Plan = q5.buildQ5KldPlan({
        originalSequence: original, editedSequence: edited, editRequest, recordName: 'pRepeat', topology: 'circular'
      });
      assert.equal(q5Plan.feasible, false);
      assert.equal(q5Plan.warnings.some((warning) => /binds more than one site/.test(warning)), true);

      // The overlapping-SDM route checks its own 3' ends, so it has its own wording.
      const normalized = editMap.normalizeEditRequest(editRequest, original);
      const simple = mutagenesis.designSimpleMutagenesisPrimers(
        original,
        normalized,
        { primerTm: { min: 55, max: 72 }, primerLength: { min: 18, max: 45 } },
        { topology: 'circular' }
      );
      assert.equal(simple.feasible, false);
      assert.equal(simple.warnings.some((warning) => /repeats elsewhere on the plasmid/.test(warning)), true);

      // A unique plasmid designs the pair and says nothing about repeats.
      const uniqueOriginal = unit + [...unit].reverse().join('');
      const uniqueEdited = `${uniqueOriginal.slice(0, editIndex)}A${uniqueOriginal.slice(editIndex + 1)}`;
      const uniquePlan = q5.buildQ5KldPlan({
        originalSequence: uniqueOriginal,
        editedSequence: uniqueEdited,
        editRequest: { ...editRequest, originalSequence: uniqueOriginal[editIndex] },
        recordName: 'pUnique',
        topology: 'circular'
      });
      assert.equal(uniquePlan.feasible, true);
      assert.equal(uniquePlan.warnings.some((warning) => /binds more than one site/.test(warning)), false);
    });

    test('[EDGE] a repeated backbone says why the Gibson junction failed', () => {
      const notebook = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder-cloning-notebook.js')
      );
      const unit = 'ATGCGATCGATCGGCTAGCTAGCTAGCATCGATCGGCTAGCGCGATCGATCGTAGCTAGCTAGC'
        + 'GGTTACCAGTTTACAGGATCCATTCGGAAACCTTAGCATCGGATCCAATTCGGATTCAGGCATT';
      const insert = 'ATGGGCAGCAGCCATCATCATCATCATCACAGCAGCGGCCTGGAAAACCTGTATTTTCAGGGCGCCATGGATCCGGAATTCG';
      const dnaConstruct = { ok: true, sequence: insert, parts: [{ label: 'POI', dnaSequence: insert }] };
      const planFor = (backboneSequence) => notebook.buildProteinBuilderCloningPlan({
        constructName: 'POI',
        backbone: { backboneSequence, backboneName: 'pBB', topology: 'circular', insertionOffset: 40 },
        dnaConstruct,
        assembledRecord: { name: 'POI (pBB)', sequence: `${backboneSequence.slice(0, 40)}${insert}${backboneSequence.slice(40)}` }
      });

      const repeated = planFor(unit.repeat(2));
      assert.equal(repeated.recommendedAssemblyStrategy, null);
      assert.equal(repeated.warnings.some((warning) => /binds more than one site/.test(warning)), true);

      // The same design on a non-repeating backbone still runs the Gibson route.
      const clean = planFor(unit + [...unit].reverse().join(''));
      assert.equal(clean.recommendedAssemblyStrategy, 'gibson');
      assert.equal(clean.warnings.some((warning) => /binds more than one site/.test(warning)), false);
    });

    test('[EDGE] a flagged Q5/KLD primer reaches the route warnings', () => {
      const q5 = loadEsmStyleModule(path.join(cloningAssemblyPath, 'q5-kld-mutagenesis.js'));
      // High bits only: a power-of-two LCG's low bits cycle with period 4 and
      // would make every "random" flank a repeat.
      const rand = (n, seed) => {
        let s2 = seed >>> 0;
        let out = '';
        for (let i = 0; i < n; i += 1) {
          s2 = (Math.imul(s2, 1103515245) + 12345) >>> 0;
          out += 'ACGT'[(s2 >>> 16) & 3];
        }
        return out;
      };
      // The G-run sits where the forward primer must start, so the designed
      // oligo carries a homopolymer the quality check flags.
      const original = `${rand(1000, 3)}GGGGGGG${rand(1000, 9)}`;
      const plan = q5.buildQ5KldPlan({
        originalSequence: original,
        editedSequence: `${original.slice(0, 1000)}A${original.slice(1000)}`,
        editRequest: { type: 'insertion', start: 1001, editedSequence: 'A' },
        recordName: 'pTest',
        topology: 'circular'
      });

      assert.equal(plan.feasible, true);
      assert.equal(plan.primers.some((primer) => primer.qualityWarnings.some((w) => /homopolymer/.test(w))), true);
      // All three buckets the cloning-design view reads from.
      assert.equal(plan.warnings.some((w) => /homopolymer/.test(w)), true);
      assert.equal(plan.plans[0].plan.warnings.some((w) => /homopolymer/.test(w)), true);
      assert.equal(plan.plans[0].plan.primerOligoPlan.warnings.some((w) => /homopolymer/.test(w)), true);
    });

    test('[EDGE] backbone primers are checked against the intact pre-edit vector', () => {
      const planBuilding = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-design', 'plan-building.js')
      );
      const rand = (n, seed) => {
        let s2 = seed >>> 0;
        let out = '';
        for (let i = 0; i < n; i += 1) {
          s2 = (Math.imul(s2, 1103515245) + 12345) >>> 0;
          out += 'ACGT'[(s2 >>> 16) & 3];
        }
        return out;
      };
      // The stretch abutting the insert is duplicated by the *old* insert, so
      // every backbone window has a second site on the DNA actually in the tube
      // -- and none on the linearized backbone the edited record alone shows.
      const repeat = rand(120, 41);
      const upstream = rand(900, 17);
      const downstream = rand(900, 23);
      const newInsert = rand(300, 77);
      const vector = `${upstream}${repeat}${repeat}${downstream}`;
      const edited = `${upstream}${repeat}${newInsert}${downstream}`;
      const plan = planBuilding.buildDisplayPlan({
        strategy: 'gibson',
        record: { name: 'pV', sequence: edited, topology: 'circular' },
        source: {
          recordName: 'pV',
          originalSequence: vector,
          editedSequence: edited,
          editRequest: { type: 'replacement', start: 1021, end: 1140, originalSequence: repeat, editedSequence: newInsert }
        },
        range: { start: 1020, end: 1320 },
        donor: null
      });

      assert.equal(plan.feasible, false);
      assert.equal(plan.warnings.some((w) => /binds more than one site/.test(w)), true);
    });

    test('[EDGE] a gene amplified from a donor plasmid is templated off the donor', () => {
      const primerRecords2 = loadEsmStyleModule(path.join(cloningAssemblyPath, 'primer-records.js'));
      // Take the high bits: the low bits of a power-of-two LCG cycle with period
      // 4, which would emit ACGTACGT... and make every "random" donor a repeat.
      const rand = (n, seed) => {
        let s2 = seed;
        let out = '';
        for (let i = 0; i < n; i += 1) {
          s2 = (s2 * 1103515245 + 12345) % 2147483648;
          out += 'ACGT'[Math.floor(s2 / 65536) % 4];
        }
        return out;
      };
      const gene = rand(600, 7);
      const donor = `${rand(800, 11)}${gene}${rand(700, 13)}`;
      const tag = 'CATCATCATCATCATCAC';

      // The insert as it will appear in the construct carries a tag the donor
      // does not have, so the tag has to come off the primer, not the template.
      const resolved = primerRecords2.resolveFragmentPrimerTemplate({
        sequence: `${tag}${gene}`,
        metadata: { templateSequence: donor, templateName: 'pDonor' }
      });
      assert.equal(resolved.templateSequence, gene);
      assert.equal(resolved.forwardAddedSequence, tag);
      assert.equal(resolved.reverseAddedSequence, '');
      assert.equal(resolved.warnings.length, 0);

      // Picking a plasmid that does not carry the gene has to say so by name.
      const wrong = primerRecords2.resolveFragmentPrimerTemplate({
        sequence: `${tag}${gene}`,
        metadata: { templateSequence: rand(900, 29), templateName: 'pWrongDonor' }
      });
      assert.match(wrong.warnings[0], /pWrongDonor does not contain this insert/);
      assert.equal(wrong.templateSequence, `${tag}${gene}`);
    });

    test('[EDGE] donor primers are checked for specificity across the whole donor', () => {
      const assemblyPrimers = loadEsmStyleModule(path.join(cloningAssemblyPath, 'assembly-primers.js'));
      const thresholds = { primerTm: { min: 45, max: 75 }, primerLength: { min: 18, max: 30 }, overlapTm: { min: 45, max: 75 } };
      const gene = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG'
        + 'TTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACA';
      // The donor carries the gene twice, so no primer against it is unique.
      const duplicatedDonor = `${gene}${gene}`;
      const fragment = (specificitySequence) => ({
        id: 'insert',
        name: 'gene',
        sequence: gene,
        metadata: { templateSequence: gene, specificitySequence, specificityCircular: true }
      });

      const clean = assemblyPrimers.designAssemblyPrimersForRoute([fragment('')], [], thresholds, {});
      assert.equal(clean.primers.length, 2);

      const repeated = assemblyPrimers.designAssemblyPrimersForRoute([fragment(duplicatedDonor)], [], thresholds, {});
      assert.equal(repeated.primers.length, 0);
      assert.match(repeated.warnings.join(' '), /binds more than one site/);
    });

    test('[EDGE] primer order block formats for IDT bulk input and vendor CSV', () => {
      const order = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'primer-order.js')
      );
      const primers = [
        { name: 'MPM2 A34J F', sequence: 'ATGGCACCGACCAGCGGTAAAGAAGCG' },
        // The full oligo is what gets ordered, not the part that matches the record.
        { name: 'GST APA2 R', sequence: 'IGNORED', primerSequence: 'GGTTAAGGCCTTACGTACGTAACCGGT' }
      ];

      // IDT Bulk Input parses tab-separated rows with no header row.
      assert.equal(
        order.buildIdtBulkInput(primers),
        'MPM2 A34J F\tATGGCACCGACCAGCGGTAAAGAAGCG\t25nm\tSTD\n'
        + 'GST APA2 R\tGGTTAAGGCCTTACGTACGTAACCGGT\t25nm\tSTD'
      );
      assert.match(order.buildIdtBulkInput(primers, { scale: '100nm', purification: 'PAGE' }), /\t100nm\tPAGE$/);

      // The CSV goes into a vendor's own template, so it keeps its header.
      const csv = order.buildPrimerOrderCsv(primers).split('\n');
      assert.equal(csv[0], 'Name,Sequence,Scale,Purification');
      assert.equal(csv[1], 'MPM2 A34J F,ATGGCACCGACCAGCGGTAAAGAAGCG,25nm,STD');

      // Primers with no sequence are dropped rather than ordered as blanks.
      assert.equal(order.buildIdtBulkInput([{ name: 'empty' }]), '');
    });

    test('[EDGE] primer order flags oligos the standard synthesis scale cannot make', () => {
      const order = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'primer-order.js')
      );
      const seq = (length) => 'ACGT'.repeat(Math.ceil(length / 4)).slice(0, length);

      assert.equal(order.buildPrimerOrderWarnings([{ name: 'short F', sequence: seq(24) }]).length, 0);
      // 61-100 bases: orderable, but Ultramer territory.
      assert.match(
        order.buildPrimerOrderWarnings([{ name: 'gibson F', sequence: seq(72) }])[0],
        /over 60 bases/
      );
      // Past 100 it is not a standard oligo at all.
      assert.match(
        order.buildPrimerOrderWarnings([{ name: 'huge F', sequence: seq(140) }])[0],
        /cannot be ordered as standard oligos/
      );
      // Eurofins truncates at 25 characters, and duplicates would arrive unlabelled.
      const named = order.buildPrimerOrderWarnings([
        { name: 'a very long primer name that will be truncated', sequence: seq(24) },
        { name: 'dup F', sequence: seq(24) },
        { name: 'dup F', sequence: seq(26) }
      ]);
      assert.equal(named.some((warning) => /25 characters/.test(warning)), true);
      assert.equal(named.some((warning) => /Duplicate primer name/.test(warning)), true);
    });

    test('[EDGE] hovering a primer feature offers the oligo and a copy button', () => {
      const hover = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'primer-hover.js')
      );
      const sequence = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG';

      // A designed primer carries the oligo as ordered, tail included, which is
      // longer than the footprint the feature spans.
      const designed = {
        name: 'APA2 F', type: 'primer_bind', strand: 1,
        primerSequence: `CACCAGGGGGG${sequence.slice(10, 34)}`,
        segments: [{ start: 10, end: 34 }]
      };
      assert.equal(hover.primerFeatureSequence(designed, sequence), `CACCAGGGGGG${sequence.slice(10, 34)}`);

      // An imported primer_bind has no stored oligo, so it is read off the record
      // — reverse complemented when it sits on the minus strand.
      const imported = { name: 'M13 rev', type: 'primer_bind', strand: -1, segments: [{ start: 10, end: 34 }] };
      const slice = sequence.slice(10, 34);
      const revcomp = [...slice].reverse().map((base) => ({ A: 'T', T: 'A', G: 'C', C: 'G' }[base] || 'N')).join('');
      assert.equal(hover.primerFeatureSequence(imported, sequence), revcomp);

      const html = hover.renderPrimerHoverSection(designed, sequence);
      assert.match(html, /CACCAGGGGGG/);
      assert.match(html, /data-sequence-primer-copy="CACCAGGGGGG/);
      assert.match(html, /35 nt/);

      // Everything else keeps the plain readout it had before.
      assert.equal(hover.renderPrimerHoverSection({ name: 'His6', type: 'CDS', segments: [{ start: 0, end: 18 }] }, sequence), '');
      // A primer with nothing to show is not given an empty copy button.
      assert.equal(hover.renderPrimerHoverSection({ name: 'ghost', type: 'primer_bind', segments: [] }, ''), '');
    });

    test('[EDGE] primer names read as bench labels: what is added, the target, then F/R', () => {
      const naming = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'primer-naming.js')
      );
      const named = (primers, context) => naming.renamePrimers(primers, context).map((primer) => primer.name);

      // Site-directed mutagenesis names the gene and the residue change.
      assert.deepEqual(
        named(
          [{ name: 'q5_F', role: 'mutagenesis-forward' }, { name: 'q5_R', role: 'mutagenesis-reverse' }],
          { gene: 'MPM2', mutation: 'A34J' }
        ),
        ['MPM2 A34J F', 'MPM2 A34J R']
      );

      // An expression construct names the terminal tag the primer adds, then the
      // insert; the backbone half is just the vector.
      assert.deepEqual(
        named(
          [{ name: 'APA2_F', role: 'assembly-forward' }, { name: 'APA2_R', role: 'assembly-reverse' },
            { name: 'pGEX_R', role: 'assembly-reverse' }],
          { targetLabel: 'APA2', tags: { start: 'GST', end: '' }, backboneNames: ['pGEX'] }
        ),
        ['GST APA2 F', 'APA2 R', 'vector R']
      );

      // A primer carrying a restriction site leads with the enzyme.
      assert.deepEqual(
        named(
          [{ name: 'EcoRI_F', role: 'restriction-forward' }, { name: 'gg_backbone_R', role: 'golden-gate-backbone-reverse' }],
          { targetLabel: '', tags: { start: '6xHis' }, enzyme: 'BsaI' }
        ),
        ['EcoRI 6xHis F', 'BsaI vector R']
      );

      // Two primers that reduce to the same label stay distinguishable.
      assert.deepEqual(
        named([{ name: 'a_F', role: 'assembly-forward' }, { name: 'b_F', role: 'assembly-forward' }], { targetLabel: 'APA2' }),
        ['APA2 F', 'APA2 F 2']
      );
    });

    test('[EDGE] mutation labels come from the codon the edit lands in', () => {
      const naming = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'primer-naming.js')
      );
      const flank = 'ACAGTCATGACTTGACATGTCAGTACGT';
      const cds = 'ATGGCACCGACCAGCGGTAAAGAAGCGCTGATTGCGCAGTATGGCACCAGCCTGGAAGCGATTAAA';
      const original = `${flank}${cds}${flank}`;
      // Codon 4 is ACC (Thr); changing its first base to G makes GCC (Ala).
      const editIndex = flank.length + 9;
      const edited = `${original.slice(0, editIndex)}G${original.slice(editIndex + 1)}`;
      const record = {
        name: 'pMPM2',
        sequence: edited,
        features: [{ name: 'MPM2', type: 'CDS', strand: 1, segments: [{ start: flank.length, end: flank.length + cds.length }] }]
      };
      const editRequest = {
        type: 'point-mutation', start: editIndex + 1, end: editIndex + 1,
        originalSequence: original[editIndex], editedSequence: 'G'
      };

      assert.deepEqual(
        JSON.parse(JSON.stringify(naming.describeEditTarget({ record, originalSequence: original, editRequest }))),
        { gene: 'MPM2', mutation: 'T4A' }
      );

      // Outside a CDS there is no residue to name, so the base change is used.
      const bare = { name: 'pMPM2', sequence: edited, features: [] };
      assert.equal(
        naming.describeEditTarget({ record: bare, originalSequence: original, editRequest }).mutation,
        `${original[editIndex]}${editIndex + 1}G`
      );

      // Length changes get the shorthand the bench uses.
      assert.equal(
        naming.describeEditTarget({
          record: bare,
          originalSequence: original,
          editRequest: { type: 'deletion', start: editIndex + 1, end: editIndex + 9, originalSequence: original.slice(editIndex, editIndex + 9), editedSequence: '' }
        }).mutation,
        'del9'
      );
    });

    test('[EDGE] generated sequence names describe cumulative variants and construct hierarchy', () => {
      const naming = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'sequence-naming.js')
      );
      const codons = Array.from({ length: 50 }, () => 'GCT');
      codons[44] = 'GAA'; // E45
      codons[46] = 'CGT'; // R47
      const original = codons.join('');
      const e45gIndex = (44 * 3) + 1;
      const r47aIndex = 46 * 3;
      let edited = `${original.slice(0, e45gIndex)}G${original.slice(e45gIndex + 1)}`;
      edited = `${edited.slice(0, r47aIndex)}GC${edited.slice(r47aIndex + 2)}`;
      const record = {
        name: 'pET28a',
        sequence: original,
        features: [{ name: 'MDM2', type: 'CDS', strand: 1, segments: [{ start: 0, end: original.length }] }]
      };

      assert.equal(
        naming.buildEditedSequenceName({ record, baseName: 'MDM2', originalSequence: original, editedSequence: edited }),
        'MDM2 E45G/R47A'
      );
      assert.equal(
        naming.buildEditedSequenceName({ record, baseName: 'pET28a', originalSequence: original, editedSequence: edited }),
        'pET28a · MDM2 E45G/R47A'
      );
      const reverseComplement = (sequence) => [...sequence].reverse()
        .map((base) => ({ A: 'T', T: 'A', G: 'C', C: 'G' }[base] || 'N'))
        .join('');
      const reverseOriginal = reverseComplement(original);
      const reverseEdited = reverseComplement(edited);
      const reverseRecord = {
        name: 'MDM2',
        sequence: reverseOriginal,
        features: [{ name: 'MDM2', type: 'CDS', strand: -1, segments: [{ start: 0, end: reverseOriginal.length }] }]
      };
      assert.equal(
        naming.buildEditedSequenceName({ record: reverseRecord, originalSequence: reverseOriginal, editedSequence: reverseEdited }),
        'MDM2 E45G/R47A'
      );

      const synonymous = `${original.slice(0, (44 * 3) + 2)}G${original.slice((44 * 3) + 3)}`;
      assert.equal(
        naming.buildEditedSequenceName({ record, baseName: 'MDM2', originalSequence: original, editedSequence: synonymous }),
        'MDM2 E45='
      );
      assert.equal(
        naming.buildProteinTargetLabel({ recordName: 'pET28a-MDM2 E45G/R47A', targetName: 'MDM2' }),
        'MDM2 E45G/R47A'
      );
      assert.equal(
        naming.buildProteinArchitectureName({ parts: [{ label: '6xHis' }, { label: 'TEV' }, { label: 'MDM2 E45G/R47A' }] }),
        '6xHis–TEV–MDM2(E45G/R47A)'
      );
      assert.equal(
        naming.buildVectorSequenceName({ backboneName: 'pET28a', payloadName: '6xHis–TEV–MDM2(E45G)' }),
        'pET28a · 6xHis–TEV–MDM2(E45G)'
      );

      const assemblyPayload = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder', 'assembly-payload.js')
      );
      const assembled = assemblyPayload.buildAssembledPlasmidPayload(
        { hostVectorName: 'pET28a', backboneSequence: 'A'.repeat(60), insertionOffset: 30, topology: 'circular' },
        { sequence: 'ATGGGCTAA', parts: [{ label: 'MDM2 E45G', dnaSequence: 'ATGGGCTAA' }] },
        { constructName: '6xHis–TEV–MDM2(E45G)' }
      );
      assert.equal(assembled.name, 'pET28a · 6xHis–TEV–MDM2(E45G)');
    });

    test('[EDGE] editing a saved sequence creates a named local derivative instead of overwriting its entry', async () => {
      const workflow = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'runtime', 'sequence-edit-workflow.js')
      );
      const codons = Array.from({ length: 50 }, () => 'GCT');
      codons[44] = 'GAA';
      const original = codons.join('');
      const record = {
        name: 'MDM2',
        sequence: original,
        features: [{ name: 'MDM2', type: 'CDS', strand: 1, segments: [{ start: 0, end: original.length }] }]
      };
      const state = {
        records: [record],
        selectedRecordIndex: 0,
        selectedFeatureIndex: -1,
        activeEntryId: 'saved_mdm2',
        activeEntryStatus: 'saved',
        sequenceEditDesignSource: null,
        cloningDesign: {},
        warnings: []
      };
      const persistenceCalls = [];
      const actions = {
        getSelectedRecord: () => state.records[0],
        persistFeatureMutation: async (nextRecord) => {
          persistenceCalls.push({ name: nextRecord.name, activeEntryId: state.activeEntryId });
        },
        resetAlignmentState() {}
      };
      const noOp = () => {};
      const controllers = {
        detail: {
          clearSequenceSelection: noOp,
          hideFeatureContextMenu: noOp,
          hideFeatureEditor: noOp,
          hidePrimerDesignOverlay: noOp,
          updateRecordSelect: noOp,
          renderActiveRecord: noOp
        },
        cloningDesign: { render: noOp },
        vectorBuilder: { render: noOp },
        alignment: { handleReferenceRecordChanged: noOp }
      };
      const editActions = workflow.createSequenceEditActions({ state, actions, controllers });
      const editIndex = (44 * 3) + 1;

      await editActions.applySequenceEdit({
        mode: 'replace',
        range: { start: editIndex, end: editIndex + 1 },
        sequence: 'G'
      });

      assert.equal(state.records[0].name, 'MDM2 E45G');
      assert.equal(state.activeEntryId, '');
      assert.equal(state.activeEntryStatus, '');
      assert.deepEqual(persistenceCalls, [{ name: 'MDM2 E45G', activeEntryId: '' }]);
      assert.equal(state.sequenceEditDesignSource.parentEntryId, 'saved_mdm2');
      assert.equal(state.sequenceEditDesignSource.sourceKind, 'sequence_edit');

      await editActions.applySequenceEdit({
        mode: 'replace',
        range: { start: editIndex + 1, end: editIndex + 2 },
        sequence: 'C'
      });

      assert.equal(state.sequenceEditDesignSource.parentEntryId, 'saved_mdm2');
      assert.equal(persistenceCalls.length, 2);
      assert.equal(persistenceCalls[1].activeEntryId, '');
    });

    test('[EDGE] Vector Builder names a Protein Builder insertion as backbone then payload', async () => {
      const vectorBuilder = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'vector-builder', 'controller.js')
      );
      const state = {
        records: [{
          name: 'pET28a old construct',
          sequence: 'A'.repeat(90),
          topology: 'circular',
          features: [{
            name: 'Backbone (pET28a)',
            type: 'backbone',
            strand: 1,
            segments: [{ start: 0, end: 90 }]
          }]
        }],
        selectedRecordIndex: 0,
        selectedFeatureIndex: -1,
        vectorBuilder: {
          selectedFeatureIndex: -1,
          selectionAnchor: null,
          selectionFocus: null,
          cursorBase: 30,
          isSelecting: false,
          showCutters: false,
          insertTarget: { mode: 'insert', start: 30, end: 30 },
          sequenceLayout: null,
          zoom: 1
        },
        sequenceEditDesignSource: { recordName: 'pET28a old construct', sourceKind: 'sequence_edit' }
      };
      const persisted = [];
      const controller = vectorBuilder.createSequenceViewerVectorBuilderController({
        state,
        elements: {},
        getSelectedRecord: () => state.records[0],
        onApplySequenceEdit: async ({ range, sequence }) => {
          const current = state.records[0];
          state.records[0] = {
            ...current,
            sequence: `${current.sequence.slice(0, range.start)}${sequence}${current.sequence.slice(range.end)}`
          };
        },
        persistFeatureMutation: async (record) => persisted.push(record.name)
      });

      const applied = await controller.applyProteinConstruct({
        constructName: '6xHis–MDM2(E45G)',
        dnaConstruct: {
          sequence: 'ATGGGCTAA',
          parts: [{ label: 'MDM2 E45G', dnaSequence: 'ATGGGCTAA' }]
        }
      });

      assert.equal(applied, true);
      assert.equal(state.records[0].name, 'pET28a · 6xHis–MDM2(E45G)');
      assert.deepEqual(persisted, ['pET28a · 6xHis–MDM2(E45G)']);
      assert.equal(state.sequenceEditDesignSource.sourceKind, 'vector_builder');
      assert.equal(state.sequenceEditDesignSource.backboneName, 'pET28a');
    });

    test('[EDGE] annotatePrimersOnSelectedRecord writes and persists onto the selected record', async () => {
      const primerAnnotation = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'primer-annotation.js')
      );
      const sequence = 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGTTGGCCCAGTGTGAATCGCTTAAGGG'
        + 'TTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACA';
      const binding = sequence.slice(12, 34);
      const state = {
        records: [{ name: 'other', sequence, features: [] }, { name: 'target', sequence, features: [] }],
        selectedRecordIndex: 1,
        selectedFeatureIndex: 3
      };
      const saved = [];

      const placed = await primerAnnotation.annotatePrimersOnSelectedRecord({
        state,
        primers: [{ name: 'sel_F', role: 'pcr-forward', sequence: binding, bindingSequence: binding }],
        persistFeatureMutation: async (record, label) => saved.push([record.name, label])
      });

      assert.equal(placed, 1);
      assert.equal(state.records[1].features.length, 1);
      assert.equal(state.records[0].features.length, 0); // untouched
      assert.equal(state.selectedFeatureIndex, -1);
      assert.equal(saved.length, 1);
      assert.equal(saved[0][0], 'target');

      // Nothing to place means no write and no save.
      const none = await primerAnnotation.annotatePrimersOnSelectedRecord({
        state,
        primers: [{ name: 'ghost', sequence: 'GGGGGGGGGGGGGGGGGGGG' }],
        persistFeatureMutation: async () => saved.push(['ghost'])
      });
      assert.equal(none, 0);
      assert.equal(saved.length, 1);
    });
  }
};
