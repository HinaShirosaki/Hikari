module.exports = function registerStorageAndImportContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    const readLocalSource = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
    const readMainProcessSource = () => [
      readLocalSource('src', 'main', 'main.js'),
      readLocalSource('src', 'main', 'app', 'start-main-app.js'),
      readLocalSource('src', 'main', 'app', 'main-runtime.js'),
      readLocalSource('src', 'main', 'app', 'agent-log-runtime.js')
    ].join('\n');
    const readPreloadStorageSource = () => [
      readLocalSource('src', 'main', 'preload.js'),
      readLocalSource('src', 'main', 'preload', 'create-preload-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'storage-api.js')
    ].join('\n');
    const readRendererStorageSource = () => [
      readLocalSource('src', 'renderer', 'app', 'start-renderer-app.js'),
      readLocalSource('src', 'renderer', 'app', 'storage-import.js')
    ].join('\n');

    test('data-helpers default bundle hydrator preserves parsed snapshot settings', async () => {
      const { createMainDataHelpers } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'data-helpers.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'data-helpers-default-hydrate-'));
      const dataFilePath = path.join(tempDir, 'state.json');
      try {
        const snapshot = { settings: { appearance: { uiStyle: 'classic', themeColor: '#123456' } } };
        await fsPromises.writeFile(dataFilePath, JSON.stringify(snapshot, null, 2), 'utf8');
        const helpers = createMainDataHelpers({
          fs: fsPromises,
          path,
          hasSupportedDataExtension: mainUtils.hasSupportedDataExtension,
          normalizeDataFilePath: mainUtils.normalizeDataFilePath,
          writeSnapshot: async () => {},
          getDefaultDataFilePath: () => dataFilePath
        });
        const result = await helpers.autoLoadDataFile(dataFilePath);
        assert.equal(result.ok, true);
        assert.equal(result.data?.settings?.appearance?.uiStyle, 'classic');
        assert.equal(result.data?.settings?.appearance?.themeColor, '#123456');
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('storage bundle helper sync + hydrate roundtrip restores protocols notebook inventory and samples from folders/sqlite', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle.js'));
      const agentDir = path.join(__dirname, 'src', 'main', 'helpers', 'agent');
      const agentPath = (...parts) => path.join(agentDir, ...parts);
      const { createAgentLookupRuntime } = require(agentPath('runtime', 'agent-lookup-runtime.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-bundle-roundtrip-'));
      const dataFilePath = path.join(tempDir, 'example.ena.json');
      try {
        const sourceSnapshot = {
          protocols: [{ id: 'protocol-1', name: 'Protein Purification', purpose: 'Affinity purification flow.', steps: ['Bind sample', 'Wash', 'Elute'], materials: ['Buffer A'] }],
          notebookEntries: [{ id: 'note-1', protocolId: 'protocol-1', protocolName: 'Protein Purification', projectId: 'proj-1', projectName: 'Atlas', result: 'Yield improved by 20%.', updatedAt: '2026-03-20T10:00:00.000Z' }],
          labInventory: {
            chemicals: [{ id: 'chem-1', name: 'Imidazole', casNumber: '288-32-4', amountInStock: '500 g', location: 'Shelf 4', vendor: 'TCI' }],
            blocks: [{ index: 1, timestamp: '2026-03-20T10:00:00.000Z', action: 'UPSERT_CHEMICAL', hash: 'hash-1' }],
            lastLocationNumber: 7,
            locationCodeMap: { shelf4: 'D' },
            locationCodeNextByLocation: { shelf4: 8 }
          },
          inventory: { 'Room Temp': [{ id: 'box-1', name: 'Plasmid Box', type: 'box81' }] },
          samples: [{
            id: 'sample-1',
            code: 'S-001',
            name: 'Atlas construct',
            type: 'plasmid',
            lot: 'L1',
            concentration: '1 mg/mL',
            notes: 'seed stock',
            location: { storageType: 'room', box: 'Plasmid Box', position: 'A1' },
            inventoryLink: { section: 'Room Temp', containerId: 'box-1', wellIndex: 0 },
            chemicalLinks: ['chem-1'],
            updatedAt: '2026-03-20T11:00:00.000Z'
          }],
          settings: { appearance: { uiStyle: 'classic', themeColor: '#336699' } }
        };
        await bundleHelpers.syncBundleFromSnapshot({ dataFilePath, snapshot: sourceSnapshot });
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', 'MEMORY.md'));
        const samplesPath = path.join(tempDir, 'Samples', 'samples.json');
        const samplesPayload = JSON.parse(await fsPromises.readFile(samplesPath, 'utf8'));
        assert.equal(samplesPayload.samples.length, 1);
        assert.equal(samplesPayload.samples[0].id, 'sample-1');
        await assert.rejects(
          fsPromises.access(path.join(tempDir, 'example.ena.notebook-pages.json'))
        );

        const compactSnapshot = {
          settings: { appearance: { uiStyle: 'classic', themeColor: '#336699' } },
          protocols: [],
          notebookEntries: [],
          samples: [],
          labInventory: { chemicals: [], blocks: [], lastLocationNumber: 0, locationCodeMap: {}, locationCodeNextByLocation: {} },
          inventory: {}
        };
        const hydrated = await bundleHelpers.hydrateSnapshotFromBundle({ dataFilePath, snapshot: compactSnapshot });
        assert.equal(Array.isArray(hydrated.snapshot?.protocols), true);
        assert.equal(hydrated.snapshot.protocols.length, 1);
        assert.equal(Array.isArray(hydrated.snapshot?.notebookEntries), true);
        assert.equal(hydrated.snapshot.notebookEntries.length, 1);
        assert.equal(Array.isArray(hydrated.snapshot?.labInventory?.chemicals), true);
        assert.equal(hydrated.snapshot.labInventory.chemicals.length, 1);
        assert.equal(Array.isArray(hydrated.snapshot?.inventory?.['Room Temp']), true);
        assert.equal(hydrated.snapshot.inventory['Room Temp'].length, 1);
        assert.equal(Array.isArray(hydrated.snapshot?.samples), true);
        assert.equal(hydrated.snapshot.samples.length, 1);
        assert.equal(hydrated.snapshot.samples[0].id, 'sample-1');
        assert.equal(hydrated.migration.applied.includes('samples_folder'), true);
        assert.equal(hydrated.snapshot?.settings?.appearance?.uiStyle, 'classic');

        const lookupRuntime = createAgentLookupRuntime({
          getBundlePaths: bundleHelpers.getBundlePaths,
          hydrateSnapshotFromBundle: bundleHelpers.hydrateSnapshotFromBundle,
          syncBundleFromSnapshot: bundleHelpers.syncBundleFromSnapshot
        });
        const inventorySearch = await lookupRuntime.searchInventoryIndex({ dataFilePath, snapshot: compactSnapshot, query: 'Atlas construct', searchTerms: ['atlas', 'construct'], limit: 6 });
        assert.equal(inventorySearch.usedSqlite, true);
        assert.equal(inventorySearch.items.some((item) => item.kind === 'personal_sample'), true);

        const recordSearch = await lookupRuntime.searchRecordIndex({ dataFilePath, snapshot: compactSnapshot, query: 'Protein Purification', searchTerms: ['protein', 'purification'], limit: 6 });
        assert.equal(recordSearch.usedSqlite, true);
        assert.equal(recordSearch.items.length > 0, true);
        assert.equal(recordSearch.items.some((item) => item.record_type === 'protocol'), true);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('storage hydration restores project notebook pages from page folders when the notebook sidecar is missing', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'project-notebook-folder-hydration-'));
      const dataFilePath = path.join(tempDir, 'example.ena.json');
      try {
        const sourceSnapshot = {
          projects: [{ id: 'project-1', name: 'Atlas' }],
          protocols: [{
            id: 'protocol-1',
            name: 'Protein Purification',
            purpose: 'Affinity purification flow.',
            steps: [{ id: 'step-1', text: 'Add {{ph:volume}} of buffer.' }]
          }],
          notebookEntries: [{
            id: 'note-1',
            notebookType: 'biology',
            protocolId: 'protocol-1',
            protocolName: 'Protein Purification',
            projectId: 'project-1',
            projectName: 'Atlas',
            experimentName: 'Purification Run 7',
            protocolSnapshot: {
              id: 'protocol-1',
              name: 'Protein Purification',
              steps: [{ id: 'step-1', text: 'Add {{ph:volume}} of buffer.', placeholders: [{ id: 'volume', name: 'Volume' }] }]
            },
            values: { 'step-1:volume': '15 mL' },
            result: 'Yield improved by 20%.',
            resultFiles: ['gel.png'],
            resultFileRecords: [{ name: 'gel.png', relativePath: 'Project/Atlas/Notebook/Protein_Purification__note-1/ResultFiles/gel.png' }],
            notebookState: 'executed',
            updatedAt: '2026-04-20T10:30:00.000Z',
            createdAt: '2026-04-20T09:00:00.000Z'
          }],
          settings: { storagePath: tempDir }
        };

        await bundleHelpers.syncBundleFromSnapshot({ dataFilePath, snapshot: sourceSnapshot });
        const bundlePaths = bundleHelpers.getBundlePaths({ dataFilePath, storagePath: tempDir });
        await fsPromises.rm(bundlePaths.notebookPagesPath, { force: true });

        const hydrated = await bundleHelpers.hydrateSnapshotFromBundle({
          dataFilePath,
          snapshot: {
            settings: { storagePath: tempDir },
            projects: [],
            protocols: [],
            notebookEntries: []
          }
        });

        assert.equal(hydrated.snapshot.notebookEntries.length, 1);
        assert.equal(hydrated.snapshot.notebookEntries[0].notebookType, 'biology');
        assert.equal(hydrated.snapshot.notebookEntries[0].experimentName, 'Purification Run 7');
        assert.equal(hydrated.snapshot.notebookEntries[0].values['step-1:volume'], '15 mL');
        assert.equal(hydrated.snapshot.notebookEntries[0].storageFolder.includes(`${path.sep}Project${path.sep}Atlas${path.sep}Notebook${path.sep}`), true);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('storage root importer restores projects and notebook pages from project folders without bundle files', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'project-folder-only-import-'));
      try {
        const projectRoot = path.join(tempDir, 'Project', 'Atlas');
        const notebookFolder = path.join(projectRoot, 'Notebook', 'Protein_Purification__note-1');
        await fsPromises.mkdir(notebookFolder, { recursive: true });
        await fsPromises.writeFile(path.join(projectRoot, 'MEMORY.md'), [
          '# Project Memory',
          '',
          'Name: Atlas',
          'Folder: Atlas',
          'ID: project-1',
          'Description: Folder-only project restore test.',
          'Created: 2026-04-20T09:00:00.000Z',
          'Updated: 2026-04-20T10:30:00.000Z'
        ].join('\n'), 'utf8');
        await fsPromises.writeFile(path.join(notebookFolder, 'page.json'), JSON.stringify({
          schema_name: 'enana_notebook_pages',
          schema_version: '1.0.0',
          updated_at: '2026-04-20T10:30:00.000Z',
          notebookEntry: {
            id: 'note-1',
            notebookType: 'biology',
            protocolId: 'protocol-1',
            protocolName: 'Protein Purification',
            projectId: 'project-1',
            projectName: 'Atlas',
            experimentName: 'Purification Run 7',
            values: { 'step-1:volume': '15 mL' },
            result: 'Yield improved by 20%.',
            updatedAt: '2026-04-20T10:30:00.000Z',
            createdAt: '2026-04-20T09:00:00.000Z'
          }
        }, null, 2), 'utf8');
        await fsPromises.mkdir(path.join(tempDir, 'Samples'), { recursive: true });
        await fsPromises.writeFile(path.join(tempDir, 'Samples', 'samples.json'), JSON.stringify({
          schema_name: 'enana_samples',
          schema_version: '1.0.0',
          updated_at: '2026-04-20T10:30:00.000Z',
          samples: [{
            id: 'sample-1',
            code: 'S-001',
            name: 'Atlas construct',
            type: 'plasmid',
            updatedAt: '2026-04-20T10:30:00.000Z'
          }]
        }, null, 2), 'utf8');

        const imported = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        assert.equal(imported.statePatch.projects.length, 1);
        assert.equal(imported.statePatch.projects[0].id, 'project-1');
        assert.equal(imported.statePatch.projects[0].name, 'Atlas');
        assert.equal(imported.statePatch.notebookEntries.length, 1);
        assert.equal(imported.statePatch.notebookEntries[0].notebookType, 'biology');
        assert.equal(imported.statePatch.notebookEntries[0].storageFolder.includes(`${path.sep}Project${path.sep}Atlas${path.sep}Notebook${path.sep}`), true);
        assert.equal(imported.statePatch.samples.length, 1);
        assert.equal(imported.statePatch.samples[0].id, 'sample-1');
        assert.equal(imported.summary.notebookEntries, 1);
        assert.equal(imported.summary.samples, 1);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('workflow root storage sync writes template/run folders and hydrates workflows notebook pages plus related papers', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle.js'));
      const workflowStorage = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'workflow-storage.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'workflow-root-storage-'));
      const dataFilePath = path.join(tempDir, 'workflow-example.ena.json');
      try {
        const snapshot = {
          projects: [{ id: 'project-1', name: 'Atlas' }],
          workflowTemplates: [{ id: 'template-1', name: 'Protein Expression', description: 'Root workflow template', blocks: [{ id: 'block-a', protocolId: 'protocol-1' }], links: [], createdAt: '2026-04-10T10:00:00.000Z', updatedAt: '2026-04-10T10:00:00.000Z' }],
          workflows: [{
            id: 'workflow-1',
            templateId: 'template-1',
            name: 'Histagged protein preparation',
            description: 'Run 1',
            projectId: 'project-1',
            notebookEntryIds: ['note-1'],
            blocks: [{ id: 'block-a', protocolId: 'protocol-1' }],
            links: [],
            entries: [{
              id: 'entry-1',
              name: 'Clone 12',
              stepStates: {
                'block-a': {
                  status: 'completed',
                  notebookEntryId: 'note-1',
                  resultFiles: ['gel.png'],
                  resultFileRecords: [{ name: 'gel.png', path: '/tmp/original/gel.png', relativePath: 'Workflow/Protein_Expression__template-1/Histagged_protein_preparation__workflow-1/Results/Clone_12__entry-1/Transform__block-a/ResultFiles/gel.png', size: 1234, importedAt: '2026-04-10T10:05:00.000Z' }],
                  completedAt: '2026-04-10T10:06:00.000Z',
                  updatedAt: '2026-04-10T10:06:00.000Z'
                }
              },
              createdAt: '2026-04-10T10:00:00.000Z',
              updatedAt: '2026-04-10T10:06:00.000Z'
            }],
            createdAt: '2026-04-10T10:00:00.000Z',
            updatedAt: '2026-04-10T10:06:00.000Z'
          }],
          notebookEntries: [{
            id: 'note-1',
            projectId: 'project-1',
            projectName: 'Atlas',
            protocolId: 'protocol-1',
            protocolName: 'Transformation',
            result: 'Expression confirmed.',
            resultFiles: ['gel.png'],
            resultFileRecords: [{ name: 'gel.png', path: '/tmp/original/gel.png', relativePath: 'Workflow/Protein_Expression__template-1/Histagged_protein_preparation__workflow-1/Notebook/Clone_12__entry-1/Transformation__block-a/ResultFiles/gel.png', size: 1234, importedAt: '2026-04-10T10:05:00.000Z' }],
            workflowContext: { workflowId: 'workflow-1', workflowName: 'Histagged protein preparation', workflowEntryId: 'entry-1', workflowEntryName: 'Clone 12', workflowBlockId: 'block-a', workflowBlockTitle: 'Transformation' },
            createdAt: '2026-04-10T10:00:00.000Z',
            updatedAt: '2026-04-10T10:06:00.000Z'
          }],
          papers: [{ id: 'paper-1', title: 'Relevant Expression Paper', linkedType: 'project', linkedId: 'project-1', linkedName: 'Atlas', storedFilePath: '/tmp/original/paper.pdf', storedRelativePath: 'Project/Atlas/Papers/paper.pdf', pdfDataUrl: 'data:application/pdf;base64,QQ==', createdAt: '2026-04-10T10:00:00.000Z', updatedAt: '2026-04-10T10:06:00.000Z' }],
          paperExperimentLinks: [{ paperId: 'paper-1', entryId: 'note-1', projectId: 'project-1', note: 'Supports workflow step' }],
          settings: { storagePath: tempDir }
        };

        await bundleHelpers.syncBundleFromSnapshot({ dataFilePath, snapshot });

        const folderLayout = workflowStorage.buildWorkflowFolderLayout({ storagePath: tempDir, template: snapshot.workflowTemplates[0], workflow: snapshot.workflows[0] });
        const notebookFolder = path.join(
          folderLayout.notebookFolderPath,
          workflowStorage.buildEntryFolderName('Clone 12', 'entry-1'),
          workflowStorage.buildNotebookPageFolderName('note-1')
        );
        await fsPromises.access(path.join(folderLayout.templateFolderPath, 'template.json'));
        await fsPromises.access(path.join(folderLayout.workflowFolderPath, 'MEMORY.md'));
        await fsPromises.access(path.join(folderLayout.workflowFolderPath, 'workflow.json'));
        await fsPromises.access(path.join(folderLayout.relatedPapersFolderPath, 'related-papers.json'));
        await fsPromises.access(path.join(notebookFolder, 'page.json'));
        await fsPromises.access(path.join(folderLayout.workflowRootPath, 'workflow-status.sqlite'));

        const hydrated = await bundleHelpers.hydrateSnapshotFromBundle({
          dataFilePath,
          snapshot: { settings: { storagePath: tempDir }, workflowTemplates: [], workflows: [], notebookEntries: [], papers: [], paperExperimentLinks: [] }
        });
        assert.equal(hydrated.snapshot.workflowTemplates.length, 1);
        assert.equal(hydrated.snapshot.workflows.length, 1);
        assert.equal(hydrated.snapshot.notebookEntries.length, 1);
        assert.equal(hydrated.snapshot.papers.length, 1);
        assert.equal(hydrated.snapshot.paperExperimentLinks.length, 1);
        assert.equal(hydrated.snapshot.workflows[0].entries[0].stepStates['block-a'].resultFileRecords[0].path, '');
        assert.equal(hydrated.snapshot.papers[0].pdfDataUrl, '');
        assert.equal(hydrated.snapshot.notebookEntries[0].storageFolder.includes(`${path.sep}Workflow${path.sep}`), true);

        const imported = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        assert.equal(imported.summary.workflowTemplates, 1);
        assert.equal(imported.summary.workflows, 1);
        assert.equal(imported.summary.papers, 1);
        assert.equal(imported.statePatch.workflowTemplates.length, 1);
        assert.equal(imported.statePatch.workflows.length, 1);
        assert.equal(imported.statePatch.notebookEntries.length, 1);
        assert.equal(imported.statePatch.papers.length, 1);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('storage root importer reads Testdata-like bundles and writes manifest with non-zero summary counts', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle.js'));
      const fixtureRoot = path.join(__dirname, 'Testdata');
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-import-fixture-'));
      try {
        await fsPromises.cp(fixtureRoot, tempDir, { recursive: true });
        const result = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        assert.equal(result.summary.protocols > 0, true);
        assert.equal(result.summary.notebookEntries > 0, true);
        assert.equal(result.summary.chemicals > 0, true);
        assert.equal(result.summary.sequenceEntries > 0, true);
        assert.equal(result.summary.personalInventoryContainers > 0, true);
        assert.equal(Array.isArray(result.statePatch?.protocols), true);
        assert.equal(result.statePatch.protocols.length > 0, true);
        const manifestPath = path.join(tempDir, 'hikari-storage-manifest.json');
        const manifestRaw = await fsPromises.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestRaw);
        assert.equal(manifest.summary.sequenceEntries > 0, true);
        assert.equal(Array.isArray(manifest.discovered_files), true);
        assert.equal(manifest.discovered_files.length > 0, true);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });

    test('chemical inventory sync uses sqlite-only bundle writes instead of a chemical json file', () => {
      const preloadSource = readPreloadStorageSource();
      const dataRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-data-ipc.js'), 'utf8');
      const chemicalInventorySource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'lab-common-inventory.js'), 'utf8');
      assert.match(preloadSource, /syncSqliteBundle:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(STORAGE\.SYNC_SQLITE_BUNDLE, payload\)/);
      assert.match(dataRegistrarSource, /ipcMain\.handle\(STORAGE\.SYNC_SQLITE_BUNDLE/);
      assert.match(chemicalInventorySource, /window\.enanaApi\?\.syncSqliteBundle/);
      assert.match(chemicalInventorySource, /const targetPath = `\$\{normalizedRoot\}\/hikari-chemicals\.index\.sqlite`;/);
      assert.equal(chemicalInventorySource.includes('hikari-chemicals.ena.json'), false);
    });

    test('chemical bundle hydration/import no longer depends on legacy chemical json fallback', () => {
      const hydrationSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'storage-hydration.js'), 'utf8');
      const importSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'storage-import.js'), 'utf8');
      const mainSource = readMainProcessSource();
      assert.equal(hydrationSource.includes('legacyChemicalsPath'), false);
      assert.equal(hydrationSource.includes('hydrateFromLegacyChemicals'), false);
      assert.equal(mainSource.includes('CHEMICALS_DATA_FILE_PATH'), false);
      assert.match(importSource, /isSqliteBundleCandidateName/);
      assert.match(importSource, /getBundlePathsFromSqlitePath/);
      assert.match(importSource, /kind:\s*'sqlite_only_bundle'/);
    });

    test('renderer storage import wiring runs on save callback and startup hydration path', () => {
      const rendererSource = readRendererStorageSource();
      assert.match(rendererSource, /onStoragePathSaved:\s*async\s*\(storagePath\)\s*=>\s*\{\s*const result = await storageImportController\.runStorageRootImport\(storagePath, \{ persistMergedState: true \}\);/);
      assert.match(rendererSource, /async function hydrateStateFromStorageRoot\(\)/);
      assert.equal(rendererSource.includes('hydrateStateFromDataFile'), false);
      assert.match(rendererSource, /async function initApp\(\)\s*\{\s*await storageImportController\.hydrateStateFromStorageRoot\(\);/);
      assert.match(rendererSource, /state\.projects = mergeRecordsById\(state\.projects, patch\.projects, 'project'\);/);
      assert.match(rendererSource, /mergeStorageImportPatch\(result\.statePatch\);/);
      assert.equal(/state\.settings\s*=\s*result\.statePatch\.settings/.test(rendererSource), false);
    });

    test('telegram bot writes events to data/telegram-events.log by default', () => {
      const telegramBotSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'lib', 'telegramBot.js'), 'utf8');
      assert.match(telegramBotSource, /data', 'telegram-events\.log'/);
      assert.equal(telegramBotSource.includes('telegram-messages.log'), false);
    });

    test('main agent chat logging records request/result/error with redacted API key metadata', () => {
      const agentDir = path.join(__dirname, 'src', 'main', 'helpers', 'agent');
      const agentPath = (...parts) => path.join(agentDir, ...parts);
      const agentRegistrarPath = (...parts) => path.join(__dirname, 'src', 'main', 'helpers', 'main', 'register-agent-ipc', ...parts);
      const mainSource = readMainProcessSource();
      const appPathsSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'app-paths.js'), 'utf8');
      const agentChatHandlerSource = fs.readFileSync(agentRegistrarPath('agent-chat-handler.js'), 'utf8');
      const controllerUtilsSource = fs.readFileSync(agentPath('shared', 'agent-controller-utils.js'), 'utf8');
      assert.match(mainSource, /const AGENT_CHAT_LOG_FILE_NAME = 'agent-chat\.log';/);
      assert.match(mainSource, /runtime\.agentLogRuntime\.ensureAgentChatLogFile\(runtime\.appPaths\.getAgentChatLogPath\(\)\)/);
      assert.match(mainSource, /createMainAppPaths/);
      assert.match(appPathsSource, /ENANA_AGENT_CHAT_LOG_PATH/);
      assert.match(controllerUtilsSource, /apiKeyProvided: Boolean\(cleanText\(source\.apiKey, 12\)\)/);
      assert.equal(controllerUtilsSource.includes('apiKey: cleanText(source.apiKey'), false);
      assert.match(agentChatHandlerSource, /type: 'agent-chat-request'/);
      assert.match(agentChatHandlerSource, /type: 'agent-chat-result'/);
      assert.match(agentChatHandlerSource, /type: 'agent-chat-error'/);
    });
  }
};
