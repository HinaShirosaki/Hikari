module.exports = function registerStorageAndImportContractsPart01(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    const readLocalSource = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
    const readMainProcessSource = () => [
      readLocalSource('src', 'main', 'main.js'),
      readLocalSource('src', 'main', 'app', 'start-main-app.js'),
      readLocalSource('src', 'main', 'core', 'main-services.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-mcp-service.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-codex-service.js'),
      readLocalSource('src', 'main', 'helpers', 'main', 'create-main-agent-services.js'),
      readLocalSource('src', 'main', 'app', 'agent-log-runtime.js')
    ].join('\n');
    const readPreloadStorageSource = () => [
      readLocalSource('src', 'main', 'preload.js'),
      readLocalSource('src', 'main', 'preload', 'create-preload-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'storage-api.js')
    ].join('\n');
    const readRendererStorageSource = () => [
      readLocalSource('src', 'renderer', 'app', 'start-renderer-app.js'),
      readLocalSource('src', 'renderer', 'core', 'start-hikari-core.js'),
      readLocalSource('src', 'renderer', 'app', 'storage-import.js')
    ].join('\n');
    test('data-helpers default bundle hydrator preserves parsed snapshot settings', async () => {
      const { createMainDataHelpers } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'data', 'data-helpers.js'));
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
    test('data-helpers auto-load repairs project codex skill sidecars after hydration', async () => {
      const { createMainDataHelpers } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'data', 'data-helpers.js'));
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'data-helpers-load-skills-'));
      const storageRoot = path.join(tempDir, 'Workspace');
      const dataFilePath = path.join(tempDir, 'hikari-data.json');
      try {
        await fsPromises.writeFile(dataFilePath, JSON.stringify({
          projects: [{ id: 'project-1', name: 'Atlas' }],
          settings: { storagePath: storageRoot }
        }, null, 2), 'utf8');
        const projectProtocolSkillPath = path.join(storageRoot, 'Project', 'Atlas', '.agents', 'skills', 'hikari-protocol-generation', 'SKILL.md');
        const projectNotebookSkillPath = path.join(storageRoot, 'Project', 'Atlas', '.agents', 'skills', 'hikari-notebook-draft', 'SKILL.md');
        const projectPaperRetrievalSkillPath = path.join(storageRoot, 'Project', 'Atlas', '.agents', 'skills', 'hikari-paper-retrieval', 'SKILL.md');
        const projectContainerSkillPath = path.join(storageRoot, 'Project', 'Atlas', '.agents', 'skills', 'hikari-container', 'SKILL.md');
        const projectAssayPlotlySkillPath = path.join(storageRoot, 'Project', 'Atlas', '.agents', 'skills', 'hikari-assay-plotly', 'SKILL.md');
        await assert.rejects(fsPromises.access(projectProtocolSkillPath));

        const helpers = createMainDataHelpers({
          fs: fsPromises,
          path,
          hasSupportedDataExtension: mainUtils.hasSupportedDataExtension,
          normalizeDataFilePath: mainUtils.normalizeDataFilePath,
          hydrateSnapshotFromBundle: bundleHelpers.hydrateSnapshotFromBundle,
          syncBundleFromSnapshot: bundleHelpers.syncBundleFromSnapshot,
          writeSnapshot: async () => {},
          getDefaultDataFilePath: () => dataFilePath
        });
        const result = await helpers.autoLoadDataFile(dataFilePath);
        assert.equal(result.ok, true);
        assert.equal(result.bundlePaths.storageRootPath, storageRoot);
        assert.match(await fsPromises.readFile(projectProtocolSkillPath, 'utf8'), /name: "hikari-protocol-generation"/);
        assert.match(await fsPromises.readFile(projectNotebookSkillPath, 'utf8'), /name: "hikari-notebook-draft"/);
        assert.match(await fsPromises.readFile(projectPaperRetrievalSkillPath, 'utf8'), /name: "hikari-paper-retrieval"/);
        assert.match(await fsPromises.readFile(projectContainerSkillPath, 'utf8'), /name: "hikari-container"/);
        assert.match(await fsPromises.readFile(projectAssayPlotlySkillPath, 'utf8'), /name: "hikari-assay-plotly"/);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('data-helpers auto-load still returns hydrated data when sidecar repair fails', async () => {
      const { createMainDataHelpers } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'data', 'data-helpers.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'data-helpers-load-sync-failure-'));
      const dataFilePath = path.join(tempDir, 'state.json');
      try {
        await fsPromises.writeFile(dataFilePath, JSON.stringify({
          settings: { appearance: { uiStyle: 'classic' } }
        }, null, 2), 'utf8');
        const helpers = createMainDataHelpers({
          fs: fsPromises,
          path,
          hasSupportedDataExtension: mainUtils.hasSupportedDataExtension,
          normalizeDataFilePath: mainUtils.normalizeDataFilePath,
          hydrateSnapshotFromBundle: async ({ snapshot }) => ({
            snapshot: {
              ...snapshot,
              hydrated: true
            },
            bundlePaths: { storageRootPath: tempDir },
            sidecarPaths: {}
          }),
          syncBundleFromSnapshot: async () => {
            throw new Error('simulated sidecar repair failure');
          },
          writeSnapshot: async () => {},
          getDefaultDataFilePath: () => dataFilePath
        });
        const result = await helpers.autoLoadDataFile(dataFilePath);
        assert.equal(result.ok, true);
        assert.equal(result.data.hydrated, true);
        assert.equal(result.bundlePaths.storageRootPath, tempDir);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage-root autosave syncs folders without writing the default data file', async () => {
      const { createMainDataHelpers } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'data', 'data-helpers.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-root-autosave-'));
      const staleDataPath = path.join(tempDir, 'hikari-data.json');
      try {
        await fsPromises.writeFile(staleDataPath, '{"legacy":true}\n', 'utf8');
        let syncedDataFilePath = null;
        const helpers = createMainDataHelpers({
          fs: fsPromises,
          path,
          hasSupportedDataExtension: mainUtils.hasSupportedDataExtension,
          normalizeDataFilePath: mainUtils.normalizeDataFilePath,
          writeSnapshot: async () => {
            throw new Error('root storage autosave should not write a data file');
          },
          syncBundleFromSnapshot: async ({ dataFilePath, snapshot }) => {
            syncedDataFilePath = dataFilePath;
            assert.equal(snapshot.settings.storagePath, tempDir);
            return {
              bundlePaths: {
                storageRootPath: tempDir,
                sqlitePath: path.join(tempDir, 'Protocol', 'protocol.index.sqlite')
              },
              sidecarPaths: {}
            };
          },
          getDefaultDataFilePath: () => path.join(tempDir, 'hikari-data.json')
        });

        const result = await helpers.autoSaveDataFile({
          data: { settings: { storagePath: tempDir }, samples: [{ id: 'sample-1' }] },
          filePath: ''
        });

        assert.equal(result.ok, true);
        assert.equal(result.filePath, '');
        assert.equal(syncedDataFilePath, '');
        await assert.rejects(fsPromises.access(staleDataPath));
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage move-stored-file IPC moves a file inside the storage root', async () => {
      const { registerDataIpc } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'));
      const { STORAGE } = require(path.join(__dirname, 'src', 'shared', 'ipc', 'channels.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-move-paper-file-'));
      const handlers = new Map();
      const ipcMain = {
        handle(channel, handler) {
          handlers.set(channel, handler);
        }
      };
      try {
        const sourceFolder = path.join(tempDir, 'Project', 'Atlas', 'Papers');
        const targetFolder = path.join(tempDir, 'Papers', 'Reading_Club');
        const sourcePath = path.join(sourceFolder, 'atlas.pdf');
        await fsPromises.mkdir(sourceFolder, { recursive: true });
        await fsPromises.writeFile(sourcePath, Buffer.from('%PDF-1.4\n'));

        registerDataIpc({
          ipcMain,
          fs: fsPromises,
          dialog: {},
          shell: {},
          mainDataHelpers: {},
          importStorageRoot: async () => ({}),
          discoverPapersFromStorageRoot: async () => ({}),
          syncSqliteBundleFromSnapshot: async () => ({}),
          listSequenceEntries: async () => ({}),
          getSequenceEntry: async () => ({}),
          upsertSequenceEntry: async () => ({}),
          promoteSequenceEntry: async () => ({}),
          deleteSequenceEntry: async () => ({}),
          annotateSequenceRecord: async () => ({}),
          searchSequenceFeatures: async () => ({}),
          listRecognizedBackbones: async () => ({}),
          upsertRecognizedBackbone: async () => ({}),
          recognizeSequenceBackbone: async () => ({})
        });

        const result = await handlers.get(STORAGE.MOVE_STORED_FILE)(null, {
          storagePath: tempDir,
          sourceRelativePath: 'Project/Atlas/Papers/atlas.pdf',
          targetFolder,
          fileName: 'atlas.pdf'
        });

        assert.equal(result.ok, true);
        assert.equal(result.moved, true);
        assert.equal(result.relativePath, 'Papers/Reading_Club/atlas.pdf');
        await assert.rejects(fsPromises.access(sourcePath));
        assert.equal(await fsPromises.readFile(path.join(targetFolder, 'atlas.pdf'), 'utf8'), '%PDF-1.4\n');
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage bundle writes project memory and codex skill folders for project records', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-project-skills-'));
      const dataFilePath = path.join(tempDir, 'example.ena.json');
      try {
        await bundleHelpers.syncBundleFromSnapshot({
          dataFilePath,
          snapshot: {
            projects: [{ id: 'project-1', name: 'Atlas', description: 'Project-specific Codex context.' }],
            settings: { storagePath: tempDir }
          }
        });

        const memoryPath = path.join(tempDir, 'Project', 'Atlas', 'MEMORY.md');
        const memoryText = await fsPromises.readFile(memoryPath, 'utf8');
        const rootProtocolSkillPath = path.join(tempDir, '.agents', 'skills', 'hikari-protocol-generation', 'SKILL.md');
        const rootNotebookSkillPath = path.join(tempDir, '.agents', 'skills', 'hikari-notebook-draft', 'SKILL.md');
        const rootPaperRetrievalSkillPath = path.join(tempDir, '.agents', 'skills', 'hikari-paper-retrieval', 'SKILL.md');
        const rootContainerSkillPath = path.join(tempDir, '.agents', 'skills', 'hikari-container', 'SKILL.md');
        const rootAssayPlotlySkillPath = path.join(tempDir, '.agents', 'skills', 'hikari-assay-plotly', 'SKILL.md');
        const projectProtocolSkillPath = path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-protocol-generation', 'SKILL.md');
        const projectNotebookSkillPath = path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-notebook-draft', 'SKILL.md');
        const projectPaperRetrievalSkillPath = path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-paper-retrieval', 'SKILL.md');
        const projectContainerSkillPath = path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-container', 'SKILL.md');
        const projectAssayPlotlySkillPath = path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-assay-plotly', 'SKILL.md');
        assert.match(memoryText, /Name: Atlas/);
        assert.match(memoryText, /ID: project-1/);
        assert.match(await fsPromises.readFile(rootProtocolSkillPath, 'utf8'), /Call the direct Hikari MCP tool `mcp__hikari__protocol_generation`/);
        assert.match(await fsPromises.readFile(rootProtocolSkillPath, 'utf8'), /expects complete protocol JSON/);
        assert.match(await fsPromises.readFile(rootProtocolSkillPath, 'utf8'), /Protocol JSON checklist:/);
        assert.match(await fsPromises.readFile(rootNotebookSkillPath, 'utf8'), /Call the direct Hikari MCP tool `mcp__hikari__notebook_draft`/);
        assert.match(await fsPromises.readFile(rootNotebookSkillPath, 'utf8'), /Draft context checklist:/);
        assert.match(await fsPromises.readFile(rootPaperRetrievalSkillPath, 'utf8'), /Hikari Paper Retrieval MCP/);
        assert.match(await fsPromises.readFile(rootPaperRetrievalSkillPath, 'utf8'), /mcp__hikari__paper_intake_search_summaries/);
        assert.match(await fsPromises.readFile(rootPaperRetrievalSkillPath, 'utf8'), /source_paths\.paper_md/);
        assert.match(await fsPromises.readFile(rootContainerSkillPath, 'utf8'), /Call the direct Hikari MCP tool `mcp__hikari__container`/);
        assert.match(await fsPromises.readFile(rootContainerSkillPath, 'utf8'), /Direct literals are feasible/);
        assert.match(await fsPromises.readFile(rootContainerSkillPath, 'utf8'), /replace_range/);
        assert.match(await fsPromises.readFile(rootAssayPlotlySkillPath, 'utf8'), /mcp__hikari__assay_table/);
        assert.match(await fsPromises.readFile(rootAssayPlotlySkillPath, 'utf8'), /mcp__hikari__plotly_graph/);
        assert.match(await fsPromises.readFile(rootAssayPlotlySkillPath, 'utf8'), /Common Plotly settings:/);
        assert.match(await fsPromises.readFile(projectProtocolSkillPath, 'utf8'), /name: "hikari-protocol-generation"/);
        assert.match(await fsPromises.readFile(projectNotebookSkillPath, 'utf8'), /name: "hikari-notebook-draft"/);
        assert.match(await fsPromises.readFile(projectPaperRetrievalSkillPath, 'utf8'), /name: "hikari-paper-retrieval"/);
        assert.match(await fsPromises.readFile(projectContainerSkillPath, 'utf8'), /name: "hikari-container"/);
        assert.match(await fsPromises.readFile(projectAssayPlotlySkillPath, 'utf8'), /name: "hikari-assay-plotly"/);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage hydration keeps lookups alive when project root scan is permission denied', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-project-permission-'));
      const dataFilePath = path.join(tempDir, 'hikari-data.json');
      const projectRootPath = path.join(tempDir, 'Project');
      const originalReaddir = fsPromises.readdir;
      try {
        await fsPromises.mkdir(projectRootPath, { recursive: true });
        await fsPromises.writeFile(dataFilePath, JSON.stringify({
          settings: { storagePath: tempDir },
          inventory: { Freezer: [{ id: 'item-1', name: 'Electrocompetent cells' }] }
        }, null, 2), 'utf8');
        fsPromises.readdir = async (targetPath, ...args) => {
          if (path.resolve(String(targetPath || '')) === path.resolve(projectRootPath)) {
            const error = new Error(`EPERM: operation not permitted, scandir '${projectRootPath}'`);
            error.code = 'EPERM';
            throw error;
          }
          return originalReaddir.call(fsPromises, targetPath, ...args);
        };

        const hydrated = await bundleHelpers.hydrateSnapshotFromBundle({
          dataFilePath,
          snapshot: {
            settings: { storagePath: tempDir },
            inventory: {}
          }
        });

        assert.equal(hydrated.snapshot.settings.storagePath, tempDir);
        assert.equal(hydrated.migration.warnings.some((warning) => /Permission denied reading project root/.test(warning)), true);
      } finally {
        fsPromises.readdir = originalReaddir;
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage hydration keeps lookups alive when workflow index read is permission denied', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-workflow-permission-'));
      const dataFilePath = path.join(tempDir, 'hikari-data.json');
      const workflowIndexPath = path.join(tempDir, 'Workflow', 'workflow-status.sqlite');
      const originalReadFile = fsPromises.readFile;
      try {
        await fsPromises.mkdir(path.dirname(workflowIndexPath), { recursive: true });
        await fsPromises.writeFile(dataFilePath, JSON.stringify({
          settings: { storagePath: tempDir },
          inventory: { Freezer: [{ id: 'item-1', name: 'Electrocompetent cells' }] }
        }, null, 2), 'utf8');
        fsPromises.readFile = async (targetPath, ...args) => {
          if (path.resolve(String(targetPath || '')) === path.resolve(workflowIndexPath)) {
            const error = new Error(`EPERM: operation not permitted, open '${workflowIndexPath}'`);
            error.code = 'EPERM';
            throw error;
          }
          return originalReadFile.call(fsPromises, targetPath, ...args);
        };

        const hydrated = await bundleHelpers.hydrateSnapshotFromBundle({
          dataFilePath,
          snapshot: {
            settings: { storagePath: tempDir },
            inventory: {}
          }
        });

        assert.equal(hydrated.snapshot.settings.storagePath, tempDir);
        assert.equal(hydrated.migration.warnings.some((warning) => /Permission denied reading workflow status index/.test(warning)), true);
      } finally {
        fsPromises.readFile = originalReadFile;
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage hydration keeps notebook fallback data when the shared SQLite index is permission denied', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-sqlite-permission-'));
      const dataFilePath = path.join(tempDir, 'hikari-data.json');
      const sqlitePath = path.join(tempDir, 'Protocol', 'protocol.index.sqlite');
      const originalReadFile = fsPromises.readFile;
      try {
        await fsPromises.mkdir(path.dirname(sqlitePath), { recursive: true });
        const snapshot = {
          settings: { storagePath: tempDir },
          notebookEntries: [{
            id: 'note-1',
            projectId: 'proj-1',
            projectName: 'Atlas',
            protocolName: 'Protein Purification',
            result: 'Readable fallback notebook content.'
          }]
        };
        fsPromises.readFile = async (targetPath, ...args) => {
          if (path.resolve(String(targetPath || '')) === path.resolve(sqlitePath)) {
            const error = new Error(`EPERM: operation not permitted, open '${sqlitePath}'`);
            error.code = 'EPERM';
            throw error;
          }
          return originalReadFile.call(fsPromises, targetPath, ...args);
        };

        const hydrated = await bundleHelpers.hydrateSnapshotFromBundle({
          dataFilePath,
          snapshot
        });

        assert.equal(hydrated.snapshot.notebookEntries[0].id, 'note-1');
        assert.equal(hydrated.migration.warnings.some((warning) => /Permission denied reading SQLite bundle index/.test(warning)), true);
      } finally {
        fsPromises.readFile = originalReadFile;
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage bundle helper sync + hydrate roundtrip restores protocols notebook inventory and samples from folders/sqlite', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'index.js'));
      const agentDir = path.join(__dirname, 'src', 'main', 'helpers', 'agent');
      const agentPath = (...parts) => path.join(agentDir, ...parts);
      const { createAgentLookupSupport } = require(agentPath('tools', 'agent-lookup-support.js'));
      const { createAgentInventoryLookupRuntime } = require(agentPath('tools', 'agent-inventory-lookup.js'));
      const { createAgentNotebookLookupRuntime } = require(agentPath('tools', 'agent-notebook-lookup.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-bundle-roundtrip-'));
      const dataFilePath = path.join(tempDir, 'example.ena.json');
      try {
        const sourceSnapshot = {
          protocols: [{ id: 'protocol-1', name: 'Protein Purification', purpose: 'Affinity purification flow.', steps: ['Bind sample', 'Wash', 'Elute'], materials: ['Buffer A'] }],
          notebookEntries: [{
            id: 'note-1',
            protocolId: 'protocol-1',
            protocolName: 'Protein Purification',
            projectId: 'proj-1',
            projectName: 'Atlas',
            result: 'Yield improved by 20%.',
            toolCalculations: [{
              id: 'calc-1',
              type: 'molarity',
              mode: 'mass',
              title: 'Molarity - Mass',
              result: 'Mass needed: 584.4 mg.',
              formula: 'mass = 10 mM x 1 L x 58.44 g/mol',
              summary: 'Mass needed: 584.4 mg.',
              inputs: { concentrationValue: 10, concentrationUnit: 'mM' },
              createdAt: '2026-03-20T10:05:00.000Z'
            }],
            updatedAt: '2026-03-20T10:00:00.000Z'
          }],
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
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills'));
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-protocol-generation', 'SKILL.md'));
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-notebook-draft', 'SKILL.md'));
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-paper-retrieval', 'SKILL.md'));
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-container', 'SKILL.md'));
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-assay-plotly', 'SKILL.md'));
        await fsPromises.access(path.join(tempDir, 'KnowledgeBase', 'papers.md'));
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
        assert.equal(hydrated.snapshot.notebookEntries[0].toolCalculations[0].result, 'Mass needed: 584.4 mg.');
        assert.equal(Array.isArray(hydrated.snapshot?.labInventory?.chemicals), true);
        assert.equal(hydrated.snapshot.labInventory.chemicals.length, 1);
        assert.equal(Array.isArray(hydrated.snapshot?.inventory?.['Room Temp']), true);
        assert.equal(hydrated.snapshot.inventory['Room Temp'].length, 1);
        assert.equal(Array.isArray(hydrated.snapshot?.samples), true);
        assert.equal(hydrated.snapshot.samples.length, 1);
        assert.equal(hydrated.snapshot.samples[0].id, 'sample-1');
        assert.equal(hydrated.migration.applied.includes('samples_folder'), true);
        assert.equal(hydrated.snapshot?.settings?.appearance?.uiStyle, 'classic');

        const lookupSupport = createAgentLookupSupport({
          getBundlePaths: bundleHelpers.getBundlePaths,
          hydrateSnapshotFromBundle: bundleHelpers.hydrateSnapshotFromBundle,
          syncBundleFromSnapshot: bundleHelpers.syncBundleFromSnapshot
        });
        const inventoryRuntime = createAgentInventoryLookupRuntime(lookupSupport);
        const notebookRuntime = createAgentNotebookLookupRuntime(lookupSupport);
        const inventorySearch = await inventoryRuntime.searchInventoryIndex({ dataFilePath, snapshot: compactSnapshot, query: 'Atlas construct', searchTerms: ['atlas', 'construct'], limit: 6 });
        assert.equal(inventorySearch.usedSqlite, true);
        assert.equal(inventorySearch.items.some((item) => item.kind === 'personal_sample'), true);

        const calculationSearch = await notebookRuntime.searchNotebookEntries({ dataFilePath, snapshot: compactSnapshot, query: '584.4 mg', limit: 6 });
        assert.equal(calculationSearch.items.some((item) => item.record_type === 'notebook'), true);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage-root-only sync and import does not require hikari-data.json', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-root-only-sync-'));
      try {
        const sourceSnapshot = {
          projects: [{ id: 'project-1', name: 'Atlas' }],
          protocols: [{ id: 'protocol-1', name: 'Protein Purification', steps: ['Bind sample'] }],
          notebookEntries: [{ id: 'note-1', projectId: 'project-1', projectName: 'Atlas', protocolId: 'protocol-1', protocolName: 'Protein Purification', result: 'Good yield.' }],
          inventory: { Freezer: [{ id: 'box-1', name: 'Protein box', type: 'box81' }] },
          samples: [{ id: 'sample-1', name: 'Atlas construct', inventoryLink: { section: 'Freezer', containerId: 'box-1' } }],
          assays: [{ id: 'assay-1', name: 'Binding assay', projectId: 'project-1', updatedAt: '2026-05-09T10:00:00.000Z' }],
          gelAnalyses: [{ id: 'gel-1', name: 'SDS-PAGE', projectId: 'project-1', updatedAt: '2026-05-09T10:00:00.000Z' }],
          settings: { storagePath: tempDir }
        };

        await bundleHelpers.syncBundleFromSnapshot({ snapshot: sourceSnapshot });
        await fsPromises.access(path.join(tempDir, 'Protocol', 'protocol.index.sqlite'));
        await fsPromises.access(path.join(tempDir, 'Samples', 'samples.json'));
        await fsPromises.access(path.join(tempDir, 'KnowledgeBase', 'papers.md'));
        await assert.rejects(fsPromises.access(path.join(tempDir, 'hikari-data.json')));

        const imported = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        assert.equal(imported.statePatch.protocols.some((protocol) => protocol.id === 'protocol-1'), true);
        assert.equal(imported.statePatch.notebookEntries.some((entry) => entry.id === 'note-1'), true);
        assert.equal(imported.statePatch.samples.some((sample) => sample.id === 'sample-1'), true);
        assert.equal(imported.statePatch.inventory.Freezer.some((item) => item.id === 'box-1'), true);
        assert.equal(imported.statePatch.assays.some((assay) => assay.id === 'assay-1'), true);
        assert.equal(imported.statePatch.gelAnalyses.some((gel) => gel.id === 'gel-1'), true);
        assert.equal(imported.summary.assays, 1);
        assert.equal(imported.summary.gelAnalyses, 1);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage hydration restores project notebook pages from page folders when the notebook sidecar is missing', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'index.js'));
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
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'index.js'));
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
          schema_name: 'hikari_notebook_pages',
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
          schema_name: 'hikari_samples',
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
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'index.js'));
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
    test('storage root importer reads supported Testdata-like bundles and writes manifest with non-zero summary counts', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'index.js'));
      const fixtureRoot = path.join(__dirname, 'Testdata');
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-import-fixture-'));
      try {
        await fsPromises.cp(fixtureRoot, tempDir, { recursive: true });
        const result = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        assert.equal(result.summary.protocols > 0, true);
        assert.equal(result.summary.notebookEntries > 0, true);
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
        assert.equal(
          manifest.discovered_files.some((entry) => (
            entry.relative_path === 'KnowledgeBase/papers.md'
            && entry.role === 'paper_markdown_root'
          )),
          true
        );
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage manifest classifies KnowledgeBase paper markdown folders', () => {
      const { detectManifestRole } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'storage-bundle', 'storage-manifest.js'));
      assert.equal(detectManifestRole('KnowledgeBase'), 'knowledge_base_root');
      assert.equal(detectManifestRole('KnowledgeBase/papers.md'), 'paper_markdown_root');
      assert.equal(detectManifestRole('KnowledgeBase/papers.md/10.1000_mapk/paper.md'), 'paper_knowledge_markdown');
      assert.equal(detectManifestRole('KnowledgeBase/papers.md/10.1000_mapk/extracted.txt'), 'paper_knowledge_extracted_text');
      assert.equal(detectManifestRole('KnowledgeBase/papers.md/10.1000_mapk/meta.json'), 'paper_knowledge_metadata');
      assert.equal(detectManifestRole('KnowledgeBase/knowledge.index.sqlite'), 'paper_knowledge_index');
    });
    test('chemical inventory sync uses sqlite-only bundle writes instead of a chemical json file', () => {
      const preloadSource = readPreloadStorageSource();
      const dataRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'), 'utf8');
      const chemicalSqliteSyncSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'lab-common-inventory', 'sqlite-sync.js'), 'utf8');
      assert.match(preloadSource, /syncSqliteBundle:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(STORAGE\.SYNC_SQLITE_BUNDLE, payload\)/);
      assert.match(dataRegistrarSource, /ipcMain\.handle\(STORAGE\.SYNC_SQLITE_BUNDLE/);
      assert.match(chemicalSqliteSyncSource, /window\.hikariApi\?\.syncSqliteBundle/);
      assert.match(chemicalSqliteSyncSource, /const targetPath = `\$\{normalizedRoot\}\/hikari-chemicals\.index\.sqlite`;/);
      assert.equal(chemicalSqliteSyncSource.includes('hikari-chemicals.ena.json'), false);
    });
  }
};
