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
          gbkText: 'LOCUS       VectorA           10 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 acgtacgtac\n//\n'
        });

        const secondSaved = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'VectorA',
          status: 'saved',
          sourceFormat: 'fasta',
          topology: 'circular',
          sequenceLength: 1300,
          featureCount: 3,
          gbkText: 'LOCUS       VectorB           10 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 tttttttttt\n//\n'
        });

        const temporary = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'DraftVector',
          status: 'temporary',
          sourceFormat: 'genbank',
          topology: 'linear',
          sequenceLength: 900,
          featureCount: 1,
          gbkText: 'LOCUS       Draft             10 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 gggggggggg\n//\n'
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
    test('sequence library helper persists user folders and moves entries without coupling sequence data to folders', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-folders-'));
      try {
        const stored = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'FolderVector',
          status: 'saved',
          sourceFormat: 'genbank',
          topology: 'circular',
          sequenceLength: 10,
          featureCount: 0,
          gbkText: 'LOCUS       FolderVector      10 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 acgtacgtac\n//\n'
        });
        const created = await sequenceLibrary.upsertSequenceFolder({
          storagePath: storageRoot,
          name: 'Cloning'
        });

        const moved = await sequenceLibrary.moveSequenceEntryToFolder({
          storagePath: storageRoot,
          id: stored.entry.id,
          folderId: created.folder.id
        });
        assert.equal(moved.entry.folderId, created.folder.id);

        const grouped = await sequenceLibrary.listSequenceEntries({ storagePath: storageRoot, status: 'saved' });
        assert.equal(grouped.folders.length, 1);
        assert.equal(grouped.folders[0].name, 'Cloning');
        assert.equal(grouped.entries[0].folderId, created.folder.id);

        const renamed = await sequenceLibrary.upsertSequenceFolder({
          storagePath: storageRoot,
          id: created.folder.id,
          name: 'Expression Vectors'
        });
        assert.equal(renamed.folder.name, 'Expression Vectors');

        await sequenceLibrary.deleteSequenceFolder({
          storagePath: storageRoot,
          id: created.folder.id
        });
        const unfiled = await sequenceLibrary.listSequenceEntries({ storagePath: storageRoot, status: 'saved' });
        assert.equal(unfiled.folders.length, 0);
        assert.equal(unfiled.entries.length, 1);
        assert.equal(unfiled.entries[0].folderId, '');
        const fetched = await sequenceLibrary.getSequenceEntry({
          storagePath: storageRoot,
          id: stored.entry.id,
          includeGbk: true
        });
        assert.match(fetched.gbkText, /FolderVector/);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('sequence library helper stores only GBK and promotes temporary entries to saved names', async () => {
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
          gbkText: 'LOCUS       Reference         10 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 acgtacgtac\n//\n'
        });

        const temp = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'Reference',
          status: 'temporary',
          sourceFormat: 'genbank',
          topology: 'linear',
          sequenceLength: 800,
          featureCount: 0,
          gbkText: 'LOCUS       Draft             10 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 tttttttttt\n//\n'
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
          includeGbk: true
        });
        assert.match(String(fetched.gbkText || ''), /LOCUS\s+Reference/);

        // Previews render from the .gbk now, so no preview document is written.
        const entryFiles = await fsPromises.readdir(
          path.join(storageRoot, 'SequenceViewer', 'entries', saved.entry.id)
        );
        assert.equal(entryFiles.some((name) => name.endsWith('.gbk')), true);
        assert.equal(entryFiles.some((name) => name.endsWith('.html')), false);
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
          gbkText: 'LOCUS       AlignmentHost    12 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 acgtacgtacgt\n//\n'
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
          gbkText: 'LOCUS       VectorAlpha       12 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 atgcgatttaaa\n//\n'
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
          gbkText: 'LOCUS       VectorBeta        12 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 cccatgcgaggg\n//\n'
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
          gbkText: 'LOCUS       ProteinVector    27 bp    DNA     linear   SYN 01-JAN-2026\nORIGIN\n        1 atgaaataaatgggccctatgtaaatg\n//\n'
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
`
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
    test('sequence library annotation and feature search backfill legacy saved GenBank entries', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'sequence-library-annotate-backfill-'));
      try {
        const hostSequence = 'TTGACATATAAT';
        const saved = await sequenceLibrary.upsertSequenceEntry({
          storagePath: storageRoot,
          name: 'LegacyAnnotationHost',
          status: 'saved',
          sourceFormat: 'genbank',
          topology: 'linear',
          sequence: hostSequence,
          sequenceLength: hostSequence.length,
          featureCount: 1,
          features: [{
            name: 'LegacyPromoter',
            type: 'promoter',
            strand: 1,
            source: 'genbank',
            segments: [{ start: 0, end: hostSequence.length }]
          }],
          gbkText: `LOCUS       LegacyAnnotationHost       ${hostSequence.length} bp    DNA     linear   SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     promoter        1..12
                     /label="LegacyPromoter"
ORIGIN
        1 ttgacatataat
//
`
        });
        const sqlitePath = path.join(storageRoot, 'SequenceViewer', 'sequence-library.sqlite');
        const sequenceLibraryDatabase = require(path.join(
          __dirname,
          'src',
          'renderer',
          'modules',
          'sequence-viewer',
          'main-process',
          'sequence-library',
          'database.js'
        ));
        const db = await sequenceLibraryDatabase.openDatabase(sqlitePath);
        try {
          db.run('DELETE FROM sequence_feature_occurrences WHERE host_vector_id = ?', [saved.entry.id]);
          db.run('UPDATE sequence_entries SET feature_index_version = 0 WHERE id = ?', [saved.entry.id]);
          await sequenceLibraryDatabase.persistDatabase(sqlitePath, db);
        } finally {
          db.close();
        }

        const annotated = await sequenceLibrary.annotateSequenceRecord({
          storagePath: storageRoot,
          sequence: `GGG${hostSequence}CCC`,
          topology: 'linear'
        });

        assert.equal(annotated.dnaMatches.length, 1);
        assert.equal(annotated.dnaMatches[0].name, 'LegacyPromoter');
        assert.equal(JSON.stringify(annotated.dnaMatches[0].segments), JSON.stringify([{ start: 3, end: 15 }]));

        const resetDb = await sequenceLibraryDatabase.openDatabase(sqlitePath);
        try {
          resetDb.run('DELETE FROM sequence_feature_occurrences WHERE host_vector_id = ?', [saved.entry.id]);
          resetDb.run('UPDATE sequence_entries SET feature_index_version = 0 WHERE id = ?', [saved.entry.id]);
          await sequenceLibraryDatabase.persistDatabase(sqlitePath, resetDb);
        } finally {
          resetDb.close();
        }
        const searched = await sequenceLibrary.searchSequenceFeatures({
          storagePath: storageRoot,
          query: 'LegacyPromoter'
        });
        assert.equal(searched.results.length, 1);
        assert.equal(searched.results[0].name, 'LegacyPromoter');
        assert.equal(searched.results[0].hosts[0].hostVectorId, saved.entry.id);
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
          gbkText: 'LOCUS       HostVector       24 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 atgcgtacgctagttaccggatca\n//\n'
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
