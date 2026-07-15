module.exports = function registerAgentSequenceLibraryContractsPart01(context = {}) {
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
    test('sequence library helper hydrates alignment source files from entry folders when metadata is incomplete', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-alignment-hydration-'));
      try {
        const saved = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'AlignmentHost',
          status: 'saved',
          sourceFormat: 'genbank',
          topology: 'linear',
          sequenceLength: 12,
          featureCount: 0,
          gbkText: 'LOCUS       AlignmentHost    12 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 acgtacgtacgt\n//\n',
          htmlText: '<html><body>alignment host</body></html>'
        });

        const alignmentsDir = path.join(storageRoot, 'SequenceViewer', 'entries', saved.entry.id, 'alignments');
        const manifestSessionDir = path.join(alignmentsDir, 'legacy_manifest_session');
        const folderOnlySessionDir = path.join(alignmentsDir, 'folder_only_session');
        await fsPromises.mkdir(manifestSessionDir, { recursive: true });
        await fsPromises.mkdir(folderOnlySessionDir, { recursive: true });
        await fsPromises.writeFile(
          path.join(manifestSessionDir, 'legacy_read.fasta'),
          '>legacy_read\nACGTACGTAA\n',
          'utf8'
        );
        await fsPromises.writeFile(
          path.join(folderOnlySessionDir, 'folder_only_read.fasta'),
          '>folder_only_read\nTTGGCCAATT\n',
          'utf8'
        );
        await fsPromises.writeFile(path.join(alignmentsDir, 'alignment-sessions.json'), JSON.stringify({
          sessions: [{
            id: 'legacy_manifest_session',
            name: 'Legacy manifest read',
            referenceRecordName: 'AlignmentHost',
            sourceKind: 'file',
            sourceFormat: 'fasta',
            originalFileName: 'legacy_read.fasta',
            storedSourceRelPath: `entries/${saved.entry.id}/alignments/legacy_manifest_session/legacy_read.fasta`
          }]
        }, null, 2), 'utf8');

        const fetched = await sequenceLibrary.getSequenceEntry({
          storagePath: storageRoot,
          id: saved.entry.id,
          includeAlignments: true
        });
        const alignmentsById = new Map(fetched.alignments.map((session) => [session.id, session]));
        assert.equal(fetched.alignments.length, 2);
        assert.equal(alignmentsById.get('legacy_manifest_session')?.queryRecord?.sequence, 'ACGTACGTAA');
        assert.equal(alignmentsById.get('legacy_manifest_session')?.storedSourcePath.endsWith('legacy_read.fasta'), true);
        assert.equal(alignmentsById.get('folder_only_session')?.queryRecord?.sequence, 'TTGGCCAATT');
        assert.equal(alignmentsById.get('folder_only_session')?.originalFileName, 'folder_only_read.fasta');
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
    test('sequence library helper stores CDS DNA and translated amino-acid sequences in a dedicated table and removes them when orphaned', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-feature-proteins-'));
      try {
        await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'ProteinVector',
          status: 'saved',
          sourceFormat: 'genbank',
          topology: 'linear',
          sequence: 'ATGAAATAAATGGGCCCTATGTAAATG',
          sequenceLength: 27,
          featureCount: 3,
          features: [
            {
              name: 'ImportedCds',
              type: 'cds',
              strand: 1,
              source: 'genbank',
              translation: 'MK*',
              segments: [{ start: 0, end: 9 }]
            },
            {
              name: 'DerivedCds',
              type: 'cds',
              strand: 1,
              source: 'manual',
              segments: [{ start: 9, end: 18 }]
            },
            {
              name: 'InternalStopCds',
              type: 'cds',
              strand: 1,
              source: 'manual',
              segments: [{ start: 18, end: 27 }]
            }
          ],
          gbkText: 'LOCUS       ProteinVector    27 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 atgaaataaatgggccctatgtaaatg\n//\n',
          htmlText: '<html><body>protein vector</body></html>'
        });

        const { loadSqlJs } = require(path.join(__dirname, 'src', 'main', 'storage', 'storage-utils.js'));
        const { readSqlRows } = require(path.join(__dirname, 'src', 'main', 'storage', 'storage-sql-read.js'));
        const sqlitePath = path.join(storageRoot, 'SequenceViewer', 'sequence-library.sqlite');
        const bytes = await fsPromises.readFile(sqlitePath);
        const SQL = await loadSqlJs();
        const db = new SQL.Database(new Uint8Array(bytes));
        try {
          const cdsRows = readSqlRows(
            db,
            `SELECT f.name, cds.dna_sequence, cds.amino_acid_sequence
             FROM sequence_feature_cds_sequences cds
             JOIN sequence_features f ON f.id = cds.feature_id
             ORDER BY f.name COLLATE NOCASE ASC`,
            []
          );
          assert.equal(
            JSON.stringify(cdsRows),
            JSON.stringify([
              { name: 'DerivedCds', dna_sequence: 'ATGGGCCCT', amino_acid_sequence: 'MGP' },
              { name: 'ImportedCds', dna_sequence: 'ATGAAATAA', amino_acid_sequence: 'MK' },
              { name: 'InternalStopCds', dna_sequence: 'ATGTAAATG', amino_acid_sequence: 'M' }
            ])
          );
        } finally {
          db.close();
        }

        const savedList = await sequenceLibrary.listSequenceEntries({ storagePath: storageRoot, status: 'saved' });
        await sequenceLibrary.deleteSequenceEntry({ storagePath: storageRoot, id: savedList.entries[0].id });

        const afterDeleteBytes = await fsPromises.readFile(sqlitePath);
        const SQLAfterDelete = await loadSqlJs();
        const afterDeleteDb = new SQLAfterDelete.Database(new Uint8Array(afterDeleteBytes));
        try {
          const remainingCdsRows = readSqlRows(afterDeleteDb, 'SELECT * FROM sequence_feature_cds_sequences', []);
          assert.equal(remainingCdsRows.length, 0);
        } finally {
          afterDeleteDb.close();
        }
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('sequence library helper annotates DNA features first and then CDS ORFs from stored SQL records', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-annotate-'));
      try {
        const hostSequence = 'TTGACATATAATATGAAAGGGTAA';
        await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'AnnotationHost',
          status: 'saved',
          sourceFormat: 'genbank',
          topology: 'linear',
          sequence: hostSequence,
          sequenceLength: hostSequence.length,
          featureCount: 4,
          features: [
            {
              name: 'StrongPromoter',
              type: 'promoter',
              strand: 1,
              source: 'genbank',
              segments: [{ start: 0, end: 12 }]
            },
            {
              name: 'misc_feature_1',
              type: 'misc_feature',
              strand: 1,
              source: 'genbank',
              segments: [{ start: 0, end: 12 }]
            },
            {
              name: 'ReporterCds',
              type: 'cds',
              strand: 1,
              source: 'genbank',
              translation: 'MKG*',
              segments: [{ start: 12, end: 24 }]
            },
            {
              name: 'misc_feature',
              type: 'cds',
              strand: 1,
              source: 'genbank',
              translation: 'MKG*',
              segments: [{ start: 12, end: 24 }]
            }
          ],
          gbkText: `LOCUS       AnnotationHost   ${String(hostSequence.length).padStart(8, ' ')} bp    DNA     linear   SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     promoter        1..12
                     /label="StrongPromoter"
     misc_feature    1..12
                     /label="misc_feature_1"
     CDS             13..24
                     /label="ReporterCds"
                     /translation="MKG"
     CDS             13..24
                     /label="misc_feature"
                     /translation="MKG"
ORIGIN
        1 ${hostSequence.toLowerCase()}
//
`,
          htmlText: '<html><body>annotation host</body></html>'
        });

        const annotated = await sequenceLibrary.annotateSequenceRecord({
          storagePath: storageRoot,
          sequence: 'GGGTTGACATATAATATGAAAGGGTAACCC',
          topology: 'linear'
        });

        assert.equal(annotated.dnaMatches.length, 1);
        assert.equal(annotated.dnaMatches[0].name, 'StrongPromoter');
        assert.equal(JSON.stringify(annotated.dnaMatches[0].segments), JSON.stringify([{ start: 3, end: 15 }]));
        assert.equal(annotated.proteinMatches.length, 1);
        assert.equal(annotated.proteinMatches[0].name, 'ReporterCds');
        assert.equal(annotated.proteinMatches[0].translation, 'MKG');
        assert.equal(annotated.proteinMatches[0].orfFrame, '+1');
        assert.equal(JSON.stringify(annotated.proteinMatches[0].segments), JSON.stringify([{ start: 15, end: 27 }]));
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
    test('sequence library helper lists recognized backbone artifacts with insertion metadata', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-listed-backbone-artifacts-'));
      try {
        const artifactDir = path.join(storageRoot, 'SequenceViewer', 'protein-builder', 'backbones');
        await fsPromises.mkdir(artifactDir, { recursive: true });
        await fsPromises.writeFile(path.join(artifactDir, 'host.recognized-backbone.json'), JSON.stringify({
          schema_name: 'hikari_recognized_backbone',
          schema_version: '1.0.0',
          updated_at: '2026-04-25T12:00:00.000Z',
          source_record: {
            name: 'HostVector',
            entry_id: 'entry_host',
            entry_status: 'saved',
            topology: 'circular'
          },
          recognition: {
            host_vector_name: 'HostVector',
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
        }, null, 2));

        const listed = await sequenceLibrary.listRecognizedBackbones({ storagePath: storageRoot });
        assert.equal(Array.isArray(listed.results), true);
        assert.equal(listed.results.length, 1);
        assert.equal(listed.results[0].sourceKind, 'recognized_backbone');
        assert.equal(JSON.stringify(listed.results[0].backboneSegments), JSON.stringify([{ start: 0, end: 16 }, { start: 22, end: 30 }]));
        assert.equal(JSON.stringify(listed.results[0].insertSegments), JSON.stringify([{ start: 16, end: 22 }]));
        assert.equal(listed.results[0].insertionOffset, 16);
        assert.equal(listed.results[0].topology, 'circular');
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
  }
};
