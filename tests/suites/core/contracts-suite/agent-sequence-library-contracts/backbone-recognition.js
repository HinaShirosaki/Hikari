module.exports = function registerAgentSequenceLibraryContractsBackboneRecognition(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('sequence library helper upserts recognized backbones into the SequenceViewer JSON store', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-backbone-store-'));
      try {
        const backbonePayload = {
          schema_name: 'hikari_recognized_backbone',
          schema_version: '1.0.0',
          updated_at: '2026-04-25T12:00:00.000Z',
          source_record: {
            name: 'HostVector',
            entry_id: 'entry_host',
            entry_status: 'saved',
            sequence_signature: 'seq_host',
            topology: 'circular'
          },
          recognition: {
            host_vector_id: 'entry_host',
            host_vector_name: 'HostVector',
            candidate_id: 'candidate_1',
            promoter_name: 'T7 promoter',
            variant_mode: 'gibson'
          },
          backbone: {
            name: 'Backbone (HostVector)',
            type: 'backbone',
            sequence: 'ATGCGTACGCTAGTTACCGGATCA',
            sequence_length: 24,
            segments: [{ start: 0, end: 16 }, { start: 22, end: 30 }]
          },
          insert: {
            name: 'Insert (HostVector)',
            type: 'insert',
            sequence: 'GGAACC',
            sequence_length: 6,
            segments: [{ start: 16, end: 22 }]
          }
        };

        const upserted = await sequenceLibrary.upsertRecognizedBackbone({
          storagePath: storageRoot,
          backbone: backbonePayload
        });
        assert.equal(upserted.relativePath, 'SequenceViewer/protein-builder-backbones.json');
        assert.equal(upserted.entry.backboneName, 'Backbone (HostVector)');

        const storePath = path.join(storageRoot, 'SequenceViewer', 'protein-builder-backbones.json');
        const store = JSON.parse(await fsPromises.readFile(storePath, 'utf8'));
        assert.equal(store.schema_name, 'hikari_recognized_backbone_store');
        assert.equal(store.backbones.length, 1);

        await sequenceLibrary.upsertRecognizedBackbone({
          storagePath: storageRoot,
          backbone: {
            ...backbonePayload,
            recognition: {
              ...backbonePayload.recognition,
              promoter_name: 'T7 promoter updated'
            }
          }
        });
        const updatedStore = JSON.parse(await fsPromises.readFile(storePath, 'utf8'));
        assert.equal(updatedStore.backbones.length, 1);
        assert.equal(updatedStore.backbones[0].recognition.promoter_name, 'T7 promoter updated');

        const listed = await sequenceLibrary.listRecognizedBackbones({ storagePath: storageRoot });
        assert.equal(listed.results.length, 1);
        assert.equal(listed.results[0].relativePath, 'SequenceViewer/protein-builder-backbones.json');
        assert.equal(listed.results[0].insertionOffset, 16);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('sequence library helper exposes Gibson and restriction variants for promoter-anchored expression inserts', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-expression-backbone-'));
      try {
        const promoter = 'TAATACGACTCACTATAGG';
        const upstreamSite = 'CATATG';
        const downstreamSite = 'CTCGAG';
        const suffix = 'GCGTACCGGATCCGTTAAACCGGATCA';
        const hostSequence = `${promoter}${upstreamSite}${downstreamSite}${suffix}`;
        const querySequence = `${promoter}${upstreamSite}AAACCCGGGTAA${downstreamSite}${suffix}`;
        const gibsonInsert = 'ATGAAACCCGGGTAA';
        const restrictionInsert = `${upstreamSite}AAACCCGGGTAA${downstreamSite}`;
        const promoterLength = promoter.length;

        await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'T7ExpressionHost',
          status: 'saved',
          sourceFormat: 'genbank',
          topology: 'circular',
          sequence: hostSequence,
          sequenceLength: hostSequence.length,
          featureCount: 1,
          features: [],
          gbkText: `LOCUS       T7ExpressionHost ${String(hostSequence.length).padStart(8, ' ')} bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     promoter        1..${promoterLength}
                     /label="T7 promoter"
                     /note="promoter for recombinant protein expression"
ORIGIN
        1 ${hostSequence.toLowerCase()}
//
`
        });

        const result = await sequenceLibrary.recognizeSequenceBackbone({ storagePath: storageRoot, sequence: querySequence });
        assert.equal(result.match?.hostVectorName, 'T7ExpressionHost');
        assert.equal(result.match?.insertLength, 12);
        assert.equal(result.match?.promoter?.name, 'T7 promoter');
        assert.equal(result.match?.variants?.gibson?.source, 'promoter_orf');
        assert.equal(result.match?.variants?.gibson?.insertSequence, gibsonInsert);
        assert.equal(result.match?.variants?.gibson?.backboneSequence, `${promoter}CAT${downstreamSite}${suffix}`);
        assert.equal(JSON.stringify(result.match?.variants?.gibson?.insertSegments), JSON.stringify([{ start: promoterLength + 3, end: promoterLength + 18 }]));
        assert.equal(result.match?.variants?.restriction?.insertSequence, restrictionInsert);
        assert.equal(result.match?.variants?.restriction?.backboneSequence, hostSequence);
        assert.equal(result.match?.variants?.restriction?.upstreamSite?.name, 'NdeI');
        assert.equal(result.match?.variants?.restriction?.downstreamSite?.name, 'XhoI');
        assert.equal(JSON.stringify(result.match?.variants?.restriction?.insertSegments), JSON.stringify([{ start: promoterLength, end: promoterLength + restrictionInsert.length }]));
        assert.equal(Array.isArray(result.match?.candidateSelections), true);
        assert.equal(result.match?.candidateSelections?.[0]?.promoter?.name, 'T7 promoter');
        assert.equal(result.match?.candidateSelections?.[0]?.variants?.gibson?.insertSequence, gibsonInsert);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('sequence library helper can recognize promoter-aligned backbone candidates without a stored vector match', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-promoter-only-backbone-'));
      try {
        const promoter = 'TAATACGACTCACTATAGG';
        const upstreamSite = 'CATATG';
        const downstreamSite = 'CTCGAG';
        const suffix = 'GCGTACCGGATCCGTTAAACCGGATCA';
        const querySequence = `${promoter}${upstreamSite}AAACCCGGGTAA${downstreamSite}${suffix}`;

        const result = await sequenceLibrary.recognizeSequenceBackbone({ storagePath: storageRoot, sequence: querySequence });
        assert.equal(result.match?.recognitionSource, 'promoter_alignment');
        assert.equal(result.match?.hostVectorName, 'Promoter-aligned backbone');
        assert.equal(result.match?.promoter?.name, 'T7 promoter');
        assert.equal(result.match?.variants?.gibson?.insertSequence, 'ATGAAACCCGGGTAA');
        assert.equal(result.match?.variants?.restriction?.upstreamSite?.name, 'NdeI');
        assert.equal(result.match?.variants?.restriction?.downstreamSite?.name, 'XhoI');
        assert.equal(Array.isArray(result.match?.candidateSelections), true);
        assert.equal(result.match?.candidateSelections?.length > 0, true);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
  }
};