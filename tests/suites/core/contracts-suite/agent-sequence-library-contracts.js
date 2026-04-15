module.exports = function registerAgentSequenceLibraryContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    test('sequence library helper creates storage folder, sqlite db, and status-filtered entries', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-'));
      try {
        const firstSaved = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'VectorA',
          status: 'saved',
          sourceFormat: 'fasta',
          topology: 'circular',
          sequenceLength: 1200,
          featureCount: 2,
          gbkText: 'LOCUS       VectorA           10 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 acgtacgtac\n//\n',
          htmlText: '<html><body>preview A</body></html>'
        });

        const secondSaved = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'VectorA',
          status: 'saved',
          sourceFormat: 'fasta',
          topology: 'circular',
          sequenceLength: 1300,
          featureCount: 3,
          gbkText: 'LOCUS       VectorB           10 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 tttttttttt\n//\n',
          htmlText: '<html><body>preview B</body></html>'
        });

        const temporary = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'DraftVector',
          status: 'temporary',
          sourceFormat: 'genbank',
          topology: 'linear',
          sequenceLength: 900,
          featureCount: 1,
          gbkText: 'LOCUS       Draft             10 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 gggggggggg\n//\n',
          htmlText: '<html><body>preview draft</body></html>'
        });

        assert.equal(firstSaved.entry.name, 'VectorA');
        assert.equal(secondSaved.entry.name, 'VectorA_2');
        assert.equal(temporary.entry.status, 'temporary');

        const savedList = await sequenceLibrary.listSequenceEntries({ storagePath: storageRoot, status: 'saved' });
        assert.equal(savedList.entries.length, 2);

        const tempList = await sequenceLibrary.listSequenceEntries({ storagePath: storageRoot, status: 'temporary' });
        assert.equal(tempList.entries.length, 1);

        const sqlitePath = path.join(storageRoot, 'SequenceViewer', 'sequence-library.sqlite');
        const stat = await fsPromises.stat(sqlitePath);
        assert.equal(stat.isFile(), true);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });

    test('sequence library helper returns stored GBK/HTML and promotes temporary entries to saved names', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-promote-'));
      try {
        const saved = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'Reference',
          status: 'saved',
          sourceFormat: 'genbank',
          topology: 'circular',
          sequenceLength: 1000,
          featureCount: 0,
          gbkText: 'LOCUS       Reference         10 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 acgtacgtac\n//\n',
          htmlText: '<html><body>reference</body></html>'
        });

        const temp = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'Reference',
          status: 'temporary',
          sourceFormat: 'genbank',
          topology: 'linear',
          sequenceLength: 800,
          featureCount: 0,
          gbkText: 'LOCUS       Draft             10 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 tttttttttt\n//\n',
          htmlText: '<html><body>draft</body></html>'
        });

        const promoted = await sequenceLibrary.promoteSequenceEntry({
          storagePath: storageRoot,
          id: temp.entry.id,
          name: 'Reference'
        });
        assert.equal(promoted.entry.status, 'saved');
        assert.equal(promoted.entry.name, 'Reference_2');

        const fetched = await sequenceLibrary.getSequenceEntry({
          storagePath: storageRoot,
          id: saved.entry.id,
          includeGbk: true,
          includeHtml: true
        });
        assert.match(String(fetched.gbkText || ''), /LOCUS\s+Reference/);
        assert.match(String(fetched.htmlText || ''), /reference/);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });

    test('sequence library helper indexes feature sequences and traces them back to host vectors', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-feature-search-'));
      try {
        const first = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'VectorAlpha',
          status: 'saved',
          sourceFormat: 'genbank',
          topology: 'circular',
          sequence: 'ATGCGATTTAAA',
          sequenceLength: 12,
          featureCount: 1,
          features: [{ name: 'SharedProm', type: 'promoter', strand: 1, source: 'import', segments: [{ start: 0, end: 6 }] }],
          gbkText: 'LOCUS       VectorAlpha       12 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 atgcgatttaaa\n//\n',
          htmlText: '<html><body>alpha</body></html>'
        });

        const second = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'VectorBeta',
          status: 'temporary',
          sourceFormat: 'genbank',
          topology: 'linear',
          sequence: 'CCCATGCGAGGG',
          sequenceLength: 12,
          featureCount: 1,
          features: [{ name: 'SharedProm', type: 'promoter', strand: 1, source: 'annotation', segments: [{ start: 3, end: 9 }] }],
          gbkText: 'LOCUS       VectorBeta        12 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 cccatgcgaggg\n//\n',
          htmlText: '<html><body>beta</body></html>'
        });

        const byName = await sequenceLibrary.searchSequenceFeatures({ storagePath: storageRoot, query: 'SharedProm' });
        assert.equal(byName.results.length, 1);
        assert.equal(byName.results[0].sequence, 'ATGCGA');
        assert.equal(byName.results[0].hostCount, 2);
        assert.equal(byName.results[0].hosts.some((host) => host.hostVectorId === first.entry.id), true);
        assert.equal(byName.results[0].hosts.some((host) => host.hostVectorId === second.entry.id), true);

        const firstHost = byName.results[0].hosts.find((host) => host.hostVectorId === first.entry.id);
        assert.equal(firstHost.locations[0].startPos, 1);
        assert.equal(firstHost.locations[0].endPos, 6);

        const bySequence = await sequenceLibrary.searchSequenceFeatures({ storagePath: storageRoot, query: 'TGCGA' });
        assert.equal(bySequence.results.length, 1);
        assert.equal(bySequence.results[0].name, 'SharedProm');

        await sequenceLibrary.deleteSequenceEntry({ storagePath: storageRoot, id: second.entry.id });

        const afterDelete = await sequenceLibrary.searchSequenceFeatures({ storagePath: storageRoot, query: 'SharedProm' });
        assert.equal(afterDelete.results.length, 1);
        assert.equal(afterDelete.results[0].hostCount, 1);
        assert.equal(afterDelete.results[0].hosts[0].hostVectorId, first.entry.id);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });

    test('sequence library helper recognizes stored backbone and insert from a derived vector', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-backbone-recognition-'));
      try {
        const hostSequence = 'ATGCGTACGCTAGTTACCGGATCA';
        const querySequence = 'ATGCGTACGCTAGTTAGGAACCCCGGATCA';
        const saved = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'HostVector',
          status: 'saved',
          sourceFormat: 'genbank',
          topology: 'circular',
          sequence: hostSequence,
          sequenceLength: hostSequence.length,
          featureCount: 0,
          features: [],
          gbkText: 'LOCUS       HostVector       24 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 atgcgtacgctagttaccggatca\n//\n',
          htmlText: '<html><body>host</body></html>'
        });

        const result = await sequenceLibrary.recognizeSequenceBackbone({ storagePath: storageRoot, sequence: querySequence });
        assert.equal(result.match?.hostVectorId, saved.entry.id);
        assert.equal(result.match?.hostVectorName, 'HostVector');
        assert.equal(result.match?.backboneLength, hostSequence.length);
        assert.equal(result.match?.insertLength, 6);
        assert.equal(JSON.stringify(result.match?.backboneSegments), JSON.stringify([{ start: 0, end: 16 }, { start: 22, end: 30 }]));
        assert.equal(JSON.stringify(result.match?.insertSegments), JSON.stringify([{ start: 16, end: 22 }]));
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
`,
          htmlText: '<html><body>host</body></html>'
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
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
  }
};
