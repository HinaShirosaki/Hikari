module.exports = function registerStorageAndImportContractsStorageBundleHydration(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  const {
    assert,
    fs,
    fsPromises,
    path,
    test,
    paperMarkdownImport,
    sequenceLibrary,
    mainUtils
  } = scope;
    const { OFFICIAL_MCP_SKILLS, releaseOfficialMcpSkillsForWorkspace } = require(path.join(
      __dirname,
      'src',
      'main',
      'agent',
      'codex-agent',
      'official-mcp-skills.js'
    ));
    const assertAssaySkillFiles = async (entrypoint) => {
      const skill = OFFICIAL_MCP_SKILLS.find(item => item.id === 'assay-plotly');
      for (const [file, content] of Object.entries({ 'SKILL.md': skill.content, ...skill.files })) {
        assert.equal(await fsPromises.readFile(path.join(path.dirname(entrypoint), file), 'utf8'), content);
      }
    };
    const syncBundleWithOfficialSkills = (bundleHelpers, input = {}) => (
      bundleHelpers.syncBundleFromSnapshot({
        ...input,
        releaseOfficialMcpSkillsForWorkspace
      })
    );
    const readLocalSource = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
    const readPreloadStorageSource = () => [
      readLocalSource('src', 'main', 'preload.js'),
      readLocalSource('src', 'main', 'preload', 'create-preload-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'storage-api.js')
    ].join('\n');
    test('data-helpers default bundle hydrator preserves parsed snapshot settings', async () => {
      const { createMainDataHelpers } = require(path.join(__dirname, 'src', 'main', 'data', 'data-helpers.js'));
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
      const { createMainDataHelpers } = require(path.join(__dirname, 'src', 'main', 'data', 'data-helpers.js'));
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
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
          syncBundleFromSnapshot: (input) => syncBundleWithOfficialSkills(bundleHelpers, input),
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
        await assertAssaySkillFiles(projectAssayPlotlySkillPath);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('data-helpers auto-load still returns hydrated data when sidecar repair fails', async () => {
      const { createMainDataHelpers } = require(path.join(__dirname, 'src', 'main', 'data', 'data-helpers.js'));
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
      const { createMainDataHelpers } = require(path.join(__dirname, 'src', 'main', 'data', 'data-helpers.js'));
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
                storageRootPath: tempDir
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
        await fsPromises.writeFile(`${sourcePath}.json`, '{"paper":{"id":"paper-1"}}');

        registerDataIpc({
          ipcMain,
          fs: fsPromises,
          dialog: {},
          shell: {},
          mainDataHelpers: {},
          // These handlers write into the configured workspace, so the test must
          // stand one up the way an auto-save would.
          getStorageRoot: () => tempDir,
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
        // The paper record beside the PDF moves with it.
        await assert.rejects(fsPromises.access(`${sourcePath}.json`));
        assert.equal(await fsPromises.readFile(path.join(targetFolder, 'atlas.pdf.json'), 'utf8'), '{"paper":{"id":"paper-1"}}');
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage PDF import uses the composed paper knowledge runtime for intake', async () => {
      const { registerDataIpc } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'));
      const { STORAGE } = require(path.join(__dirname, 'src', 'shared', 'ipc', 'channels.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-paper-intake-runtime-'));
      const handlers = new Map();
      const intakeCalls = [];
      const ipcMain = {
        handle(channel, handler) {
          handlers.set(channel, handler);
        }
      };
      try {
        registerDataIpc({
          ipcMain,
          fs: fsPromises,
          dialog: {},
          shell: {},
          mainDataHelpers: {},
          // These handlers write into the configured workspace, so the test must
          // stand one up the way an auto-save would.
          getStorageRoot: () => tempDir,
          paperKnowledgeDatabaseRuntime: {
            async ingestPaperPdf(input = {}) {
              intakeCalls.push(input);
              return {
                ok: true,
                status: 'ready',
                markdown_relative_path: 'KnowledgeBase/papers.md/paper-one/paper.md',
                extracted_text_relative_path: 'KnowledgeBase/papers.md/paper-one/extracted.txt',
                meta_relative_path: 'KnowledgeBase/papers.md/paper-one/meta.json',
                paper_intake_status: 'ready'
              };
            }
          },
          importStorageRoot: async () => ({}),
          discoverPapersFromStorageRoot: async () => ({}),
          syncSqliteBundleFromSnapshot: async () => ({})
        });

        const stored = await handlers.get(STORAGE.STORE_IMPORTED_FILE)(null, {
          storagePath: tempDir,
          targetFolder: path.join(tempDir, 'Project', 'Atlas', 'Papers'),
          fileName: 'paper-one.pdf',
          dataBase64: Buffer.from('%PDF-1.4\n').toString('base64')
        });

        // Storing the PDF must not wait on intake: the library row appears
        // first, and the caller runs the pipeline afterwards.
        assert.equal(stored.ok, true);
        assert.equal(intakeCalls.length, 0);

        const result = await handlers.get(STORAGE.TRANSFORM_PAPER_PDF)(null, {
          storagePath: tempDir,
          filePath: stored.filePath,
          relativePath: stored.relativePath,
          paperTitle: 'Paper One',
          linkedType: 'project',
          linkedName: 'Atlas'
        });

        assert.equal(result.ok, true);
        assert.equal(intakeCalls.length, 1);
        assert.equal(intakeCalls[0].source, 'manual-import');
        assert.equal(result.knowledgeDatabase?.paper_intake_status, 'ready');
        assert.equal(result.paperIntakeStatus, 'ready');
        assert.equal(result.paperIntakeError, '');
        assert.equal(
          result.knowledgeMarkdownRelativePath,
          'KnowledgeBase/papers.md/paper-one/paper.md'
        );

        const mainServicesSource = readLocalSource('src', 'main', 'core', 'main-services.js');
        const agentServicesSource = readLocalSource(
          'src',
          'main',
          'core',
          'services',
          'create-agent-services.js'
        );
        assert.match(
          mainServicesSource,
          /paperKnowledgeDatabaseRuntime:\s*agents\.paperKnowledgeDatabaseRuntime/
        );
        assert.match(
          mainServicesSource,
          /transformPaperRecordsToMarkdown:\s*transformPaperRecordsWithAgentRuntime/
        );
        assert.match(
          agentServicesSource,
          /paperIntakeProvider\s*=\s*DEFAULT_LLM_PROVIDER\s*\|\|\s*LLM_PROVIDERS\.CODEX/
        );
        assert.match(
          agentServicesSource,
          /provider:\s*cleanText\(options\.provider,\s*80\)\s*\|\|\s*paperIntakeProvider/
        );
        assert.match(
          agentServicesSource,
          /createPaperKnowledgeDatabaseRuntime\(\{[\s\S]*requestStructuredJsonPayload:\s*requestPaperIntakeStructuredJson/
        );
        assert.match(agentServicesSource, /paperKnowledgeDatabaseRuntime,[\s\S]*directLlmRegistry/);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage bundle writes project memory and codex skill folders for project records', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-project-skills-'));
      const dataFilePath = path.join(tempDir, 'example.json');
      try {
        await syncBundleWithOfficialSkills(bundleHelpers, {
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
        assert.doesNotMatch(memoryText, /^ID:/m);
        assert.match(await fsPromises.readFile(rootProtocolSkillPath, 'utf8'), /Call the direct Hikari MCP tool `protocol_generation`/);
        assert.match(await fsPromises.readFile(rootProtocolSkillPath, 'utf8'), /expects complete protocol JSON/);
        assert.match(await fsPromises.readFile(rootProtocolSkillPath, 'utf8'), /Protocol JSON checklist:/);
        assert.match(await fsPromises.readFile(rootProtocolSkillPath, 'utf8'), /Aim for 0-3 unresolved placeholders and do not exceed 5/);
        assert.match(await fsPromises.readFile(rootNotebookSkillPath, 'utf8'), /Call the direct Hikari MCP tool `notebook_draft`/);
        assert.match(await fsPromises.readFile(rootNotebookSkillPath, 'utf8'), /Draft context checklist:/);
        assert.match(await fsPromises.readFile(rootNotebookSkillPath, 'utf8'), /These are the only supported tool arguments/);
        assert.match(await fsPromises.readFile(rootNotebookSkillPath, 'utf8'), /Every key must exactly match a `placeholder_key`/);
        assert.match(await fsPromises.readFile(rootPaperRetrievalSkillPath, 'utf8'), /Hikari Paper Retrieval MCP/);
        assert.match(await fsPromises.readFile(rootPaperRetrievalSkillPath, 'utf8'), /`paper_intake_search_summaries`/);
        assert.match(await fsPromises.readFile(rootPaperRetrievalSkillPath, 'utf8'), /source_paths\.paper_md/);
        assert.match(await fsPromises.readFile(rootContainerSkillPath, 'utf8'), /Call the direct Hikari MCP tool `container`/);
        assert.match(await fsPromises.readFile(rootContainerSkillPath, 'utf8'), /Direct literals are feasible/);
        assert.match(await fsPromises.readFile(rootContainerSkillPath, 'utf8'), /replace_range/);
        assert.match(await fsPromises.readFile(rootAssayPlotlySkillPath, 'utf8'), /`assay_table`/);
        assert.match(await fsPromises.readFile(rootAssayPlotlySkillPath, 'utf8'), /`plotly_graph`/);
        await assertAssaySkillFiles(rootAssayPlotlySkillPath);
        await assertAssaySkillFiles(projectAssayPlotlySkillPath);
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
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
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
    test('storage hydration keeps lookups alive when the workflow folder is permission denied', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-workflow-permission-'));
      const dataFilePath = path.join(tempDir, 'hikari-data.json');
      const workflowRootPath = path.join(tempDir, 'Workflow');
      const originalReaddir = fsPromises.readdir;
      try {
        await fsPromises.mkdir(workflowRootPath, { recursive: true });
        await fsPromises.writeFile(dataFilePath, JSON.stringify({
          settings: { storagePath: tempDir },
          inventory: { Freezer: [{ id: 'item-1', name: 'Electrocompetent cells' }] }
        }, null, 2), 'utf8');
        fsPromises.readdir = async (targetPath, ...args) => {
          if (path.resolve(String(targetPath || '')) === path.resolve(workflowRootPath)) {
            const error = new Error(`EPERM: operation not permitted, scandir '${workflowRootPath}'`);
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
        assert.equal(hydrated.migration.warnings.some((warning) => /Permission denied reading workflow folder/.test(warning)), true);
      } finally {
        fsPromises.readdir = originalReaddir;
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage hydration keeps notebook data when a module SQLite index is permission denied', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-sqlite-permission-'));
      const dataFilePath = path.join(tempDir, 'hikari-data.json');
      const sqlitePath = path.join(tempDir, 'hikari-chemicals.index.sqlite');
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
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const agentDir = path.join(__dirname, 'src', 'main', 'agent');
      const agentPath = (...parts) => path.join(agentDir, ...parts);
      const { createAgentLookupSupport } = require(agentPath('tools', 'agent-lookup-support.js'));
      const { createAgentInventoryLookupRuntime } = require(agentPath('tools', 'agent-inventory-lookup.js'));
      const { createAgentNotebookLookupRuntime } = require(agentPath('tools', 'agent-notebook-lookup.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-bundle-roundtrip-'));
      const dataFilePath = path.join(tempDir, 'example.json');
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
          inventory: { 'Room Temp': [{ id: 'box-1', name: 'Plasmid Box', type: 'box81', folderId: 'folder-1', wells: Array.from({ length: 81 }, () => '') }] },
          inventoryFolders: { 'Room Temp': [{ id: 'folder-1', name: 'Shelf A', parentFolderId: '' }] },
          samples: [{
            id: 'sample-1',
            code: 'S-001',
            name: 'Atlas construct',
            type: 'plasmid',
            lot: 'L1',
            concentration: '1 mg/mL',
            notes: 'seed stock',
            location: { storageType: 'room', box: 'Plasmid Box', position: 'A1' },
            details: { backbone: 'pET28a', resistance: 'Kan' },
            inventoryLink: { section: 'Room Temp', containerId: 'box-1', wellIndex: 0 },
            chemicalLinks: ['chem-1'],
            updatedAt: '2026-03-20T11:00:00.000Z'
          }],
          settings: { appearance: { uiStyle: 'classic', themeColor: '#336699' } }
        };
        await syncBundleWithOfficialSkills(bundleHelpers, { dataFilePath, snapshot: sourceSnapshot });
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', 'MEMORY.md'));
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills'));
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-protocol-generation', 'SKILL.md'));
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-notebook-draft', 'SKILL.md'));
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-paper-retrieval', 'SKILL.md'));
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-container', 'SKILL.md'));
        await fsPromises.access(path.join(tempDir, 'Project', 'Atlas', '.agents', 'skills', 'hikari-assay-plotly', 'SKILL.md'));
        await fsPromises.access(path.join(tempDir, 'KnowledgeBase', 'papers.md'));
        // One file per container, holding only the wells that hold a sample.
        const containerFile = JSON.parse(await fsPromises.readFile(path.join(tempDir, 'Samples', 'Room_Temp', 'Plasmid_Box__box-1.json'), 'utf8'));
        assert.equal(containerFile.container.id, 'box-1');
        assert.equal(containerFile.container.wells, undefined);
        assert.equal(containerFile.wellCount, 81);
        assert.deepEqual(containerFile.wells.map((well) => [well.index, well.samples.map((sample) => sample.id)]), [[0, ['sample-1']]]);
        const foldersFile = JSON.parse(await fsPromises.readFile(path.join(tempDir, 'Samples', 'Room_Temp', 'folders.json'), 'utf8'));
        assert.equal(foldersFile.folders[0].id, 'folder-1');
        await assert.rejects(fsPromises.access(path.join(tempDir, 'Samples', 'samples.json')));
        await assert.rejects(fsPromises.access(path.join(tempDir, 'Samples', 'samples.index.sqlite')));
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
        assert.equal(hydrated.snapshot.inventory['Room Temp'][0].wells.length, 81, 'the full wells array is rebuilt');
        assert.equal(Array.isArray(hydrated.snapshot?.samples), true);
        assert.equal(hydrated.snapshot.samples.length, 1);
        assert.equal(hydrated.snapshot.samples[0].id, 'sample-1');
        assert.equal(hydrated.migration.applied.includes('samples_folder'), true);
        assert.equal(hydrated.snapshot.inventoryFolders['Room Temp'][0].name, 'Shelf A');
        assert.equal(hydrated.snapshot?.settings?.appearance?.uiStyle, 'classic');

        const lookupSupport = createAgentLookupSupport({
          getBundlePaths: bundleHelpers.getBundlePaths,
          hydrateSnapshotFromBundle: bundleHelpers.hydrateSnapshotFromBundle,
          syncBundleFromSnapshot: (input) => syncBundleWithOfficialSkills(bundleHelpers, input)
        });
        const inventoryRuntime = createAgentInventoryLookupRuntime(lookupSupport);
        const notebookRuntime = createAgentNotebookLookupRuntime(lookupSupport);
        const inventorySearch = await inventoryRuntime.searchInventoryIndex({ dataFilePath, snapshot: compactSnapshot, query: 'Atlas construct', searchTerms: ['atlas', 'construct'], limit: 6 });
        assert.equal(inventorySearch.usedSqlite, true);
        assert.equal(inventorySearch.items.some((item) => item.kind === 'personal_sample'), true);
        // Type-specific fields are searchable and come back with the sample.
        const byBackbone = await inventoryRuntime.searchInventoryIndex({ dataFilePath, snapshot: compactSnapshot, query: 'pET28a', searchTerms: ['pet28a'], limit: 6 });
        const plasmid = byBackbone.items.find((item) => item.kind === 'personal_sample');
        assert.deepEqual(plasmid?.details, { backbone: 'pET28a', resistance: 'Kan' });
        const chemical = await inventoryRuntime.searchInventoryIndex({ dataFilePath, snapshot: compactSnapshot, query: 'Imidazole', searchTerms: ['imidazole'], limit: 6 });
        assert.equal(chemical.items[0]?.kind, 'chemical', 'chemicals still come from the chemicals index');

        const calculationSearch = await notebookRuntime.searchNotebookEntries({ dataFilePath, snapshot: compactSnapshot, query: '584.4 mg', limit: 6 });
        assert.equal(calculationSearch.items.some((item) => item.record_type === 'notebook'), true);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('a record file that no longer parses survives the save after the load that skipped it', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-unreadable-record-'));
      const dataFilePath = path.join(tempDir, 'example.json');
      try {
        await bundleHelpers.syncBundleFromSnapshot({
          dataFilePath,
          snapshot: {
            protocols: [
              { id: 'p1', name: 'Miniprep', steps: ['Spin'] },
              { id: 'p2', name: 'Western blot', steps: ['Transfer'] },
              { id: 'p3', name: 'Retired', steps: ['Nothing'] }
            ],
            assays: [{ id: 'a1', name: 'Plate one' }, { id: 'a2', name: 'Plate two' }],
            inventory: { Freezer: [{ id: 'box-1', name: 'Box one', type: 'single' }, { id: 'box-2', name: 'Box two', type: 'single' }] }
          }
        });
        const paths = bundleHelpers.getBundlePaths({ dataFilePath });
        const damaged = [
          path.join(paths.protocolsPath, 'Western_blot__p2', 'protocol.md'),
          path.join(paths.assaysRootPath, 'Plate_two__a2', 'assay.json'),
          path.join(paths.samplesRootPath, 'Freezer', 'Box_two__box-2.json')
        ];
        for (const file of damaged) {
          await fsPromises.writeFile(file, '{"cut short');
        }
        const userFile = path.join(paths.protocolsPath, 'Western_blot__p2', 'blot.png');
        await fsPromises.writeFile(userFile, 'user file');

        const { snapshot } = await bundleHelpers.hydrateSnapshotFromBundle({ dataFilePath, snapshot: {} });
        assert.deepEqual(snapshot.protocols.map((protocol) => protocol.id).sort(), ['p1', 'p3']);
        // The user deletes p3; the damaged records were only skipped on load.
        snapshot.protocols = snapshot.protocols.filter((protocol) => protocol.id !== 'p3');
        await bundleHelpers.syncBundleFromSnapshot({ dataFilePath, snapshot });

        for (const file of damaged) {
          assert.equal(await fsPromises.readFile(file, 'utf8'), '{"cut short');
        }
        await fsPromises.access(userFile);
        await assert.rejects(fsPromises.access(path.join(paths.protocolsPath, 'Retired__p3')));
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage-root-only sync and import does not require hikari-data.json', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
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

        await syncBundleWithOfficialSkills(bundleHelpers, { snapshot: sourceSnapshot });
        await assert.rejects(fsPromises.access(path.join(tempDir, 'Papers', 'papers.index.sqlite')));
        for (const moduleFile of ['Samples/Freezer/Protein_box__box-1.json', 'Plates/Binding_assay__assay-1/assay.json', 'Gels/SDS-PAGE__gel-1/gel.json']) {
          await fsPromises.access(path.join(tempDir, moduleFile));
        }
        await assert.rejects(fsPromises.access(path.join(tempDir, 'Protocol', 'protocol.index.sqlite')));
        await fsPromises.access(path.join(tempDir, 'KnowledgeBase', 'papers.md'));
        await assert.rejects(fsPromises.access(path.join(tempDir, 'hikari-data.json')));

        const imported = await bundleHelpers.importStorageRoot({
          storagePath: tempDir,
          transformPaperRecordsToMarkdown: paperMarkdownImport.transformPaperRecordsToMarkdown
        });
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
    test('an unreadable chemicals index is moved aside, or left untouched when it cannot be, and never overwritten', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const { readSqliteBundleIndex } = require(path.join(__dirname, 'src', 'main', 'storage', 'storage-sql-read.js'));
      const chemicals = [{ id: 'c1', name: 'Tris base' }, { id: 'c2', name: 'Imidazole' }];
      const saveDamagedRoot = async (label) => {
        const root = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', `storage-chemicals-${label}-`));
        const file = path.join(root, 'hikari-chemicals.index.sqlite');
        await syncBundleWithOfficialSkills(bundleHelpers, { snapshot: { settings: { storagePath: root }, labInventory: { chemicals } } });
        const damaged = (await fsPromises.readFile(file)).subarray(0, 1024);
        await fsPromises.writeFile(file, damaged);
        return { root, file, damaged };
      };
      const roots = [];
      const originalRename = fsPromises.rename;
      try {
        // Movable: the damaged file is kept aside and the save starts a new one.
        const moved = await saveDamagedRoot('moved');
        roots.push(moved.root);
        let imported = await bundleHelpers.importStorageRoot({ storagePath: moved.root });
        assert.equal(imported.statePatch.labInventory.chemicals.length, 0);
        assert.match(imported.alerts[0], /moved to hikari-chemicals\.index\.sqlite\.corrupt-/);
        await syncBundleWithOfficialSkills(bundleHelpers, { snapshot: { ...imported.statePatch, settings: { storagePath: moved.root } } });
        const backupName = (await fsPromises.readdir(moved.root)).find((name) => name.startsWith('hikari-chemicals.index.sqlite.corrupt-'));
        assert.deepEqual(await fsPromises.readFile(path.join(moved.root, backupName)), moved.damaged, 'the damaged bytes survive the next save');
        assert.deepEqual((await bundleHelpers.importStorageRoot({ storagePath: moved.root })).alerts, [], 'the alert is shown once');

        // Not movable: nothing may write over it, but the rest of the save goes through.
        const stuck = await saveDamagedRoot('stuck');
        roots.push(stuck.root);
        fsPromises.rename = async (from, ...args) => {
          if (path.resolve(String(from)) === path.resolve(stuck.file)) {
            const error = new Error(`EACCES: permission denied, rename '${from}'`);
            error.code = 'EACCES';
            throw error;
          }
          return originalRename.call(fsPromises, from, ...args);
        };
        imported = await bundleHelpers.importStorageRoot({ storagePath: stuck.root });
        assert.match(imported.alerts[0], /will not be saved until it can be read again/);
        const nextSnapshot = { ...imported.statePatch, settings: { storagePath: stuck.root }, protocols: [{ id: 'protocol-1', name: 'Still saved' }] };
        await syncBundleWithOfficialSkills(bundleHelpers, { snapshot: nextSnapshot });
        assert.deepEqual(await fsPromises.readFile(stuck.file), stuck.damaged, 'a full save leaves the unreadable file alone');
        await fsPromises.access(path.join(stuck.root, 'Protocol', 'Still_saved__protocol-1', 'protocol.md'));
        await assert.rejects(
          bundleHelpers.syncSqliteBundleFromSnapshot({ sqlitePath: stuck.file, snapshot: nextSnapshot }),
          (error) => error.code === 'CHEMICAL_INDEX_UNREADABLE'
        );

        // Once the file reads again (the user restored it), saving resumes.
        fsPromises.rename = originalRename;
        const healthyRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-chemicals-healthy-'));
        roots.push(healthyRoot);
        await syncBundleWithOfficialSkills(bundleHelpers, { snapshot: { settings: { storagePath: healthyRoot }, labInventory: { chemicals } } });
        await fsPromises.copyFile(path.join(healthyRoot, 'hikari-chemicals.index.sqlite'), stuck.file);
        imported = await bundleHelpers.importStorageRoot({ storagePath: stuck.root });
        assert.equal(imported.statePatch.labInventory.chemicals.length, 2);
        await syncBundleWithOfficialSkills(bundleHelpers, {
          snapshot: { ...imported.statePatch, settings: { storagePath: stuck.root }, labInventory: { chemicals: [...chemicals, { id: 'c3', name: 'HEPES' }] } }
        });
        assert.equal((await readSqliteBundleIndex(stuck.file)).inventoryChemicals.length, 3);
      } finally {
        fsPromises.rename = originalRename;
        await Promise.all(roots.map((root) => fsPromises.rm(root, { recursive: true, force: true })));
      }
    });
    test('personal inventory is saved one file per container with only the filled wells', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-sample-containers-'));
      try {
        const plateWells = Array.from({ length: 96 }, (_, index) => ({ name: `W${index + 1}`, content: '' }));
        plateWells[5] = { name: 'A6', content: 'legacy note' };
        const snapshot = {
          settings: { storagePath: tempDir },
          inventory: {
            '-20 Degree': [
              { id: 'plate-1', name: 'Primer plate', type: 'plate96', wells: plateWells },
              { id: 'box-1', name: 'Box 1', type: 'box81', wells: Array.from({ length: 81 }, () => '') }
            ],
            'Room Temp': [{ id: 'tube-1', name: 'Buffer tube', type: 'single', wells: [], singleContent: '' }]
          },
          inventoryFolders: { '-20 Degree': [], 'Room Temp': [] },
          samples: [
            { id: 's-a1', name: 'Primer F', type: 'primer', details: { sequence: 'ATGGTG', direction: 'Forward' }, inventoryLink: { section: '-20 Degree', containerId: 'plate-1', wellIndex: 0 } },
            { id: 's-a1b', name: 'Primer R', type: 'primer', inventoryLink: { section: '-20 Degree', containerId: 'plate-1', wellIndex: 0 } },
            { id: 's-tube', name: 'Tris buffer', type: 'other', inventoryLink: { section: 'Room Temp', containerId: 'tube-1', wellIndex: null } },
            { id: 's-loose', name: 'Unfiled plasmid', type: 'plasmid' }
          ]
        };
        await syncBundleWithOfficialSkills(bundleHelpers, { snapshot });

        const plateFile = JSON.parse(await fsPromises.readFile(path.join(tempDir, 'Samples', '-20_Degree', 'Primer_plate__plate-1.json'), 'utf8'));
        assert.equal(plateFile.wellCount, 96);
        assert.deepEqual(plateFile.wells.map((well) => well.index), [0, 5], 'only the filled well and the legacy-text well are recorded');
        assert.deepEqual(plateFile.wells[0].samples.map((sample) => sample.id), ['s-a1', 's-a1b']);
        const tubeFile = JSON.parse(await fsPromises.readFile(path.join(tempDir, 'Samples', 'Room_Temp', 'Buffer_tube__tube-1.json'), 'utf8'));
        assert.deepEqual([tubeFile.wells, tubeFile.samples.map((sample) => sample.id)], [[], ['s-tube']]);
        const unplaced = JSON.parse(await fsPromises.readFile(path.join(tempDir, 'Samples', 'unplaced.json'), 'utf8'));
        assert.deepEqual(unplaced.samples.map((sample) => sample.id), ['s-loose']);

        let imported = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        const plate = imported.statePatch.inventory['-20 Degree'][0];
        assert.deepEqual(imported.statePatch.inventory['-20 Degree'].map((container) => container.id), ['plate-1', 'box-1'], 'container order survives');
        assert.equal(plate.wells.length, 96);
        assert.deepEqual(plate.wells[5], { name: 'A6', content: 'legacy note' });
        assert.deepEqual(imported.statePatch.samples.map((sample) => sample.id).sort(), ['s-a1', 's-a1b', 's-loose', 's-tube']);

        // Deleting a container deletes its file; a zone with nothing left goes too.
        await syncBundleWithOfficialSkills(bundleHelpers, {
          snapshot: { ...snapshot, inventory: { '-20 Degree': [snapshot.inventory['-20 Degree'][0]] }, samples: snapshot.samples.slice(0, 2) }
        });
        await assert.rejects(fsPromises.access(path.join(tempDir, 'Samples', '-20_Degree', 'Box_1__box-1.json')));
        await assert.rejects(fsPromises.access(path.join(tempDir, 'Samples', 'Room_Temp')));
        await assert.rejects(fsPromises.access(path.join(tempDir, 'Samples', 'unplaced.json')));
        imported = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        assert.deepEqual(Object.keys(imported.statePatch.inventory), ['-20 Degree']);
        assert.equal(imported.statePatch.samples.length, 2);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('paper records are saved beside their PDFs and found again by folder scan', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-paper-records-'));
      try {
        const pdfPath = path.join(tempDir, 'Project', 'Atlas', 'Papers', 'atlas.pdf');
        await fsPromises.mkdir(path.dirname(pdfPath), { recursive: true });
        await fsPromises.writeFile(pdfPath, '%PDF-1.4\n');
        const snapshot = {
          settings: { storagePath: tempDir },
          papers: [{
            id: 'paper-1',
            title: 'Atlas binders',
            storedRelativePath: 'Project/Atlas/Papers/atlas.pdf',
            storedFilePath: pdfPath,
            pdfDataUrl: 'data:application/pdf;base64,JVBERi0=',
            linkedType: 'project',
            linkedId: 'project-1',
            highlights: [{ id: 'h1', text: 'Key result' }],
            comments: [{ id: 'c1', text: 'Check the controls' }]
          }, {
            id: 'paper-2',
            title: 'PDF never stored',
            storedRelativePath: 'Project/Atlas/Papers/missing.pdf'
          }]
        };
        await syncBundleWithOfficialSkills(bundleHelpers, { snapshot });

        const saved = JSON.parse(await fsPromises.readFile(`${pdfPath}.json`, 'utf8')).paper;
        assert.deepEqual([saved.pdfDataUrl, saved.storedFilePath], ['', ''], 'no PDF bytes or absolute path in the record');
        await assert.rejects(fsPromises.access(path.join(tempDir, 'Project', 'Atlas', 'Papers', 'missing.pdf.json')));
        await assert.rejects(fsPromises.access(path.join(tempDir, 'Papers', 'papers.index.sqlite')));

        let imported = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        assert.deepEqual(imported.statePatch.papers.map((paper) => paper.id), ['paper-1']);
        assert.equal(imported.statePatch.papers[0].highlights[0].text, 'Key result');
        assert.equal(imported.statePatch.papers[0].comments[0].text, 'Check the controls');

        // Moving the PDF and its record by hand: the record follows the PDF.
        const movedPath = path.join(tempDir, 'Papers', 'Reading_Club', 'atlas.pdf');
        await fsPromises.mkdir(path.dirname(movedPath), { recursive: true });
        await fsPromises.rename(pdfPath, movedPath);
        await fsPromises.rename(`${pdfPath}.json`, `${movedPath}.json`);
        imported = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        assert.equal(imported.statePatch.papers[0].storedRelativePath, 'Papers/Reading_Club/atlas.pdf');
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('assay and gel records are found by folder scan, and removing one deletes only its record file', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-record-folders-'));
      try {
        const artifactFolder = path.join(tempDir, 'Gels', 'Old-Gel__gel-1');
        await fsPromises.mkdir(artifactFolder, { recursive: true });
        await fsPromises.writeFile(path.join(artifactFolder, 'source.png'), 'image bytes');
        const snapshot = {
          settings: { storagePath: tempDir },
          assays: [{ id: 'assay-1', name: 'Binding assay' }, { id: 'assay-2', name: 'Kinetics' }],
          gelAnalyses: [{ id: 'gel-1', name: 'Old Gel', storageFolder: artifactFolder }]
        };
        await syncBundleWithOfficialSkills(bundleHelpers, { snapshot });
        // A record keeps the folder its artifacts are in.
        await fsPromises.access(path.join(artifactFolder, 'gel.json'));
        // An older copy of assay-1 in a later-sorting folder must not win.
        const staleAssayFile = path.join(tempDir, 'Plates', 'zzz_Old__assay-1', 'assay.json');
        await fsPromises.mkdir(path.dirname(staleAssayFile), { recursive: true });
        await fsPromises.writeFile(staleAssayFile, JSON.stringify({ assay: { id: 'assay-1', name: 'Stale' } }));
        await fsPromises.utimes(staleAssayFile, new Date('2020-01-01'), new Date('2020-01-01'));
        let imported = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        assert.deepEqual(imported.statePatch.assays.map((assay) => assay.id).sort(), ['assay-1', 'assay-2']);
        assert.equal(imported.statePatch.assays.find((assay) => assay.id === 'assay-1').name, 'Binding assay');
        assert.deepEqual(imported.statePatch.gelAnalyses.map((gel) => gel.id), ['gel-1']);

        await syncBundleWithOfficialSkills(bundleHelpers, { snapshot: { ...snapshot, assays: [snapshot.assays[0]], gelAnalyses: [] } });
        await assert.rejects(fsPromises.access(path.join(tempDir, 'Plates', 'Kinetics__assay-2')), 'an emptied record folder is removed');
        await assert.rejects(fsPromises.access(path.join(artifactFolder, 'gel.json')));
        assert.equal(await fsPromises.readFile(path.join(artifactFolder, 'source.png'), 'utf8'), 'image bytes', 'artifacts survive');
        imported = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        assert.deepEqual(imported.statePatch.assays.map((assay) => assay.id), ['assay-1']);
        assert.deepEqual(imported.statePatch.gelAnalyses, []);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage hydration restores project notebook pages from page folders when the notebook sidecar is missing', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'project-notebook-folder-hydration-'));
      const dataFilePath = path.join(tempDir, 'example.json');
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

        await syncBundleWithOfficialSkills(bundleHelpers, { dataFilePath, snapshot: sourceSnapshot });
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
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
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
        await fsPromises.writeFile(path.join(tempDir, 'Samples', 'unplaced.json'), JSON.stringify({
          schema_name: 'hikari_unplaced_samples',
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
        await fsPromises.mkdir(path.join(tempDir, 'Dashboard'), { recursive: true });
        await fsPromises.writeFile(path.join(tempDir, 'Dashboard', 'experiment-log.json'), JSON.stringify({
          schema_name: 'hikari_experiment_log',
          schema_version: '1.0.0',
          updated_at: '2026-04-20T10:30:00.000Z',
          draft: 'Review transformation plate tomorrow.',
          entries: [{
            id: 'quick-log-folder-only',
            text: 'Transformation plate has colonies.',
            createdAt: '2026-04-20T10:30:00.000Z',
            updatedAt: '2026-04-20T10:30:00.000Z'
          }]
        }, null, 2), 'utf8');

        const imported = await bundleHelpers.importStorageRoot({
          storagePath: tempDir,
          transformPaperRecordsToMarkdown: paperMarkdownImport.transformPaperRecordsToMarkdown
        });
        assert.equal(imported.statePatch.projects.length, 1);
        assert.equal(imported.statePatch.projects[0].id, 'project-1');
        assert.equal(imported.statePatch.projects[0].name, 'Atlas');
        assert.equal(imported.statePatch.notebookEntries.length, 1);
        assert.equal(imported.statePatch.notebookEntries[0].notebookType, 'biology');
        assert.equal(imported.statePatch.notebookEntries[0].storageFolder.includes(`${path.sep}Project${path.sep}Atlas${path.sep}Notebook${path.sep}`), true);
        assert.equal(imported.statePatch.samples.length, 1);
        assert.equal(imported.statePatch.samples[0].id, 'sample-1');
        assert.equal(imported.statePatch.settings.dashboard.quickLogDraft, 'Review transformation plate tomorrow.');
        assert.equal(imported.statePatch.settings.dashboard.quickLogEntries[0].id, 'quick-log-folder-only');
        assert.equal(imported.summary.notebookEntries, 1);
        assert.equal(imported.summary.quickLogEntries, 1);
        assert.equal(imported.summary.samples, 1);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('workflow root storage sync writes template/run folders and hydrates workflows notebook pages plus related papers', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const workflowStorage = require(path.join(__dirname, 'src', 'main', 'storage', 'workflow-storage.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'workflow-root-storage-'));
      const dataFilePath = path.join(tempDir, 'workflow-example.json');
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
          settings: {
            storagePath: tempDir,
            dashboard: {
              quickLogDraft: 'Draft observation',
              quickLogEntries: [{
                id: 'quick-log-1',
                text: 'PCR yielded one clean band.',
                createdAt: '2026-04-10T10:07:00.000Z',
                updatedAt: '2026-04-10T10:07:00.000Z'
              }]
            }
          }
        };

        await syncBundleWithOfficialSkills(bundleHelpers, { dataFilePath, snapshot });

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
        await fsPromises.access(path.join(notebookFolder, 'page.md'));
        await assert.rejects(fsPromises.access(path.join(folderLayout.workflowRootPath, 'workflow-status.sqlite')), 'workflows are found by folder scan, not an index');
        await fsPromises.access(path.join(tempDir, 'Dashboard', 'experiment-log.json'));

        const hydrated = await bundleHelpers.hydrateSnapshotFromBundle({
          dataFilePath,
          snapshot: { settings: { storagePath: tempDir }, workflowTemplates: [], workflows: [], notebookEntries: [], papers: [], paperExperimentLinks: [] }
        });
        assert.equal(hydrated.snapshot.workflowTemplates.length, 1);
        assert.equal(hydrated.snapshot.workflows.length, 1);
        assert.equal(hydrated.snapshot.notebookEntries.length, 1);
        assert.equal(hydrated.snapshot.papers.length, 1);
        assert.equal(hydrated.snapshot.paperExperimentLinks.length, 1);
        assert.equal(hydrated.snapshot.settings.dashboard.quickLogDraft, 'Draft observation');
        assert.equal(hydrated.snapshot.settings.dashboard.quickLogEntries.length, 1);
        assert.equal(hydrated.snapshot.settings.dashboard.quickLogEntries[0].text, 'PCR yielded one clean band.');
        assert.equal(hydrated.snapshot.workflows[0].entries[0].stepStates['block-a'].resultFileRecords[0].path, '');
        assert.equal(hydrated.snapshot.papers[0].pdfDataUrl, '');
        assert.equal(hydrated.snapshot.notebookEntries[0].storageFolder.includes(`${path.sep}Workflow${path.sep}`), true);

        const imported = await bundleHelpers.importStorageRoot({
          storagePath: tempDir,
          transformPaperRecordsToMarkdown: paperMarkdownImport.transformPaperRecordsToMarkdown
        });
        assert.equal(imported.summary.workflowTemplates, 1);
        assert.equal(imported.summary.workflows, 1);
        assert.equal(imported.summary.papers, 1);
        assert.equal(imported.summary.quickLogEntries, 1);
        assert.equal(imported.statePatch.workflowTemplates.length, 1);
        assert.equal(imported.statePatch.workflows.length, 1);
        assert.equal(imported.statePatch.notebookEntries.length, 1);
        assert.equal(imported.statePatch.papers.length, 1);
        assert.equal(imported.statePatch.settings.dashboard.quickLogDraft, 'Draft observation');
        assert.equal(imported.statePatch.settings.dashboard.quickLogEntries[0].id, 'quick-log-1');

        // A stale copy of the run in a folder that sorts later (as a rename leaves
        // behind) loses to the file the last save wrote.
        const staleRunFile = path.join(folderLayout.templateFolderPath, `zzz_Old_name__${snapshot.workflows[0].id}`, 'workflow.json');
        await fsPromises.mkdir(path.dirname(staleRunFile), { recursive: true });
        await fsPromises.writeFile(staleRunFile, JSON.stringify({ workflow: { ...snapshot.workflows[0], name: 'Stale name' } }));
        await fsPromises.utimes(staleRunFile, new Date('2020-01-01'), new Date('2020-01-01'));
        const withStale = await bundleHelpers.hydrateSnapshotFromBundle({
          dataFilePath,
          snapshot: { settings: { storagePath: tempDir }, workflowTemplates: [], workflows: [], notebookEntries: [] }
        });
        assert.equal(withStale.snapshot.workflows.length, 1);
        assert.equal(withStale.snapshot.workflows[0].name, snapshot.workflows[0].name);

        // Deleting the run and its template removes only their record files.
        const resultFile = path.join(folderLayout.resultsFolderPath, 'gel.png');
        await fsPromises.writeFile(resultFile, 'result bytes');
        await syncBundleWithOfficialSkills(bundleHelpers, { dataFilePath, snapshot: { ...snapshot, workflows: [], workflowTemplates: [] } });
        await assert.rejects(fsPromises.access(path.join(folderLayout.workflowFolderPath, 'workflow.json')));
        await assert.rejects(fsPromises.access(path.join(folderLayout.templateFolderPath, 'template.json')));
        assert.equal(await fsPromises.readFile(resultFile, 'utf8'), 'result bytes', 'run results survive');
        const afterDelete = await bundleHelpers.hydrateSnapshotFromBundle({
          dataFilePath,
          snapshot: { settings: { storagePath: tempDir }, workflowTemplates: [], workflows: [], notebookEntries: [] }
        });
        assert.deepEqual([afterDelete.snapshot.workflowTemplates.length, afterDelete.snapshot.workflows.length], [0, 0]);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage root importer reads supported Testdata-like bundles and writes manifest with non-zero summary counts', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-import-fixture-'));
      try {
        await syncBundleWithOfficialSkills(bundleHelpers, {
          snapshot: {
            projects: [{ id: 'project-fixture', name: 'Fixture Project' }],
            protocols: [{ id: 'protocol-fixture', name: 'Fixture Protocol', steps: ['Run fixture'] }],
            notebookEntries: [{
              id: 'notebook-fixture',
              projectId: 'project-fixture',
              projectName: 'Fixture Project',
              protocolId: 'protocol-fixture',
              protocolName: 'Fixture Protocol',
              result: 'Fixture complete.'
            }],
            inventory: {
              Freezer: [{ id: 'container-fixture', name: 'Fixture Box', type: 'box81' }]
            },
            settings: { storagePath: tempDir }
          }
        });
        await sequenceLibrary.upsertSequenceEntry({
          storagePath: tempDir,
          name: 'Fixture Vector',
          status: 'saved',
          sourceFormat: 'genbank',
          topology: 'circular',
          sequenceLength: 12,
          featureCount: 0,
          gbkText: 'LOCUS       Fixture_Vector     12 bp    DNA     circular SYN 01-JAN-2026\nORIGIN\n        1 acgtacgtacgt\n//\n'
        });
        const result = await bundleHelpers.importStorageRoot({
          storagePath: tempDir,
          transformPaperRecordsToMarkdown: paperMarkdownImport.transformPaperRecordsToMarkdown
        });
        assert.equal(result.summary.protocols > 0, true);
        assert.equal(result.summary.notebookEntries > 0, true);
        assert.equal(result.summary.sequenceEntries > 0, true);
        assert.equal(result.summary.personalInventoryContainers > 0, true);
        assert.equal(Array.isArray(result.statePatch?.protocols), true);
        assert.equal(result.statePatch.protocols.length > 0, true);
        // A populated folder is recognised as Hikari's own; nothing else is written to mark it.
        assert.equal(result.recognized, true);
        assert.equal((await fsPromises.readdir(tempDir)).includes('hikari-storage-manifest.json'), false);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage import recognises a Hikari folder by its layout, not a marker file', async () => {
      const bundleHelpers = require(path.join(__dirname, 'src', 'main', 'storage', 'index.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'hikari-recognise-'));
      try {
        // Empty folder: new. (Import creates KnowledgeBase/, which must not count next time.)
        const fresh = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        assert.equal(fresh.recognized, false);
        assert.equal(fresh.lastSavedAt, '');
        assert.equal((await fsPromises.readdir(tempDir)).includes('hikari-storage-manifest.json'), false);

        // Any Hikari folder or snapshot makes it recognised.
        await fsPromises.mkdir(path.join(tempDir, 'Protocol'));
        assert.equal((await bundleHelpers.importStorageRoot({ storagePath: tempDir })).recognized, true);
        await fsPromises.rm(path.join(tempDir, 'Protocol'), { recursive: true });
        await fsPromises.writeFile(path.join(tempDir, 'hikari-data.json'), JSON.stringify({ protocols: [], settings: {} }), 'utf8');
        const withSnapshot = await bundleHelpers.importStorageRoot({ storagePath: tempDir });
        assert.equal(withSnapshot.recognized, true);
        assert.match(withSnapshot.lastSavedAt, /^\d{4}-\d{2}-\d{2}T/);

        // A leftover manifest from an older build is ignored, not mistaken for a snapshot.
        const legacyDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'hikari-legacy-manifest-'));
        try {
          await fsPromises.writeFile(path.join(legacyDir, 'hikari-storage-manifest.json'), '{"schema_name":"hikari_storage_manifest"}\n}', 'utf8');
          const legacy = await bundleHelpers.importStorageRoot({ storagePath: legacyDir });
          assert.equal(legacy.recognized, false);
          assert.deepEqual(legacy.warnings, []);
        } finally {
          await fsPromises.rm(legacyDir, { recursive: true, force: true });
        }

        // Overlapping imports serialise rather than interleave.
        const both = await Promise.all([
          bundleHelpers.importStorageRoot({ storagePath: tempDir }),
          bundleHelpers.importStorageRoot({ storagePath: tempDir })
        ]);
        assert.equal(both.length, 2);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('chemical inventory sync uses sqlite-only bundle writes instead of a chemical json file', () => {
      const preloadSource = readPreloadStorageSource();
      const dataRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'), 'utf8');
      const chemicalSqliteSyncSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'lab-common-inventory', 'sqlite-sync.js'), 'utf8');
      assert.match(preloadSource, /syncSqliteBundle:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(STORAGE\.SYNC_SQLITE_BUNDLE, payload\)/);
      assert.match(dataRegistrarSource, /ipcMain\.handle\(STORAGE\.SYNC_SQLITE_BUNDLE/);
      assert.match(chemicalSqliteSyncSource, /window\.hikariApi\?\.syncSqliteBundle/);
      // The destination belongs to main. The renderer names the bundle, not the file.
      assert.equal(chemicalSqliteSyncSource.includes('hikari-chemicals.index.sqlite'), false);
      assert.equal(chemicalSqliteSyncSource.includes('sqlitePath'), false);
      assert.equal(chemicalSqliteSyncSource.includes('hikari-chemicals.json'), false);
    });
    test('sqlite bundle sync ignores a caller-supplied path and writes inside the recorded storage root', async () => {
      const { registerDataIpc } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'));
      const { STORAGE } = require(path.join(__dirname, 'src', 'shared', 'ipc', 'channels.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-sqlite-sync-path-'));
      const handlers = new Map();
      const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
      try {
        const storageRoot = path.join(tempDir, 'Lab');
        const pointerPath = path.join(tempDir, 'pointer.json');
        await fsPromises.mkdir(storageRoot, { recursive: true });
        await fsPromises.writeFile(pointerPath, JSON.stringify({ storagePath: storageRoot }), 'utf8');

        const writtenPaths = [];
        registerDataIpc({
          ipcMain,
          fs: fsPromises,
          dialog: {},
          shell: {},
          mainDataHelpers: {},
          getStorageRootPointerPath: () => pointerPath,
          getDefaultDataFilePath: () => path.join(tempDir, 'missing-data.json'),
          importStorageRoot: async () => ({}),
          discoverPapersFromStorageRoot: async () => ({}),
          syncSqliteBundleFromSnapshot: async ({ sqlitePath }) => {
            writtenPaths.push(sqlitePath);
            return { sqlitePath };
          },
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

        const escapePath = path.join(tempDir, '..', 'escaped.sqlite');
        const result = await handlers.get(STORAGE.SYNC_SQLITE_BUNDLE)(null, {
          mode: 'chemical',
          snapshot: { labInventory: { chemicals: [] } },
          sqlitePath: escapePath,
          filePath: escapePath
        });

        assert.equal(result.ok, true);
        assert.equal(writtenPaths.length, 1);
        assert.equal(writtenPaths[0], path.join(storageRoot, 'hikari-chemicals.index.sqlite'));
        assert.equal(writtenPaths[0].includes('escaped.sqlite'), false);

        // With no storage root on record there is nothing to write into.
        const orphanHandlers = new Map();
        registerDataIpc({
          ipcMain: { handle(channel, handler) { orphanHandlers.set(channel, handler); } },
          fs: fsPromises,
          dialog: {},
          shell: {},
          mainDataHelpers: {},
          getStorageRootPointerPath: () => path.join(tempDir, 'absent-pointer.json'),
          getDefaultDataFilePath: () => path.join(tempDir, 'missing-data.json'),
          importStorageRoot: async () => ({}),
          discoverPapersFromStorageRoot: async () => ({}),
          syncSqliteBundleFromSnapshot: async ({ sqlitePath }) => {
            writtenPaths.push(sqlitePath);
            return { sqlitePath };
          },
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
        const refused = await orphanHandlers.get(STORAGE.SYNC_SQLITE_BUNDLE)(null, {
          mode: 'chemical',
          snapshot: { labInventory: { chemicals: [] } },
          sqlitePath: escapePath
        });
        assert.equal(refused.ok, false);
        assert.equal(writtenPaths.length, 1, 'nothing may be written without a recorded storage root');
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('storage file handlers refuse a workspace root the caller made up', async () => {
      const { registerDataIpc } = require(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'));
      const { STORAGE } = require(path.join(__dirname, 'src', 'shared', 'ipc', 'channels.js'));
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'storage-foreign-root-'));
      const handlers = new Map();
      try {
        const storageRoot = path.join(tempDir, 'Lab');
        const outsideRoot = path.join(tempDir, 'Elsewhere');
        await fsPromises.mkdir(storageRoot, { recursive: true });
        await fsPromises.mkdir(outsideRoot, { recursive: true });

        registerDataIpc({
          ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
          fs: fsPromises,
          dialog: {},
          shell: {},
          mainDataHelpers: {},
          getStorageRoot: () => storageRoot,
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

        // Declaring a different folder as "the workspace" used to satisfy the
        // containment check trivially, because the check used that same folder.
        const escaped = await handlers.get(STORAGE.STORE_IMPORTED_FILE)(null, {
          storagePath: outsideRoot,
          targetFolder: outsideRoot,
          fileName: 'planted.pdf',
          dataBase64: Buffer.from('%PDF-1.4\n').toString('base64')
        });
        assert.equal(escaped.ok, false);
        assert.match(String(escaped.error || ''), /storage path/i);
        assert.deepEqual(await fsPromises.readdir(outsideRoot), []);

        // The real workspace still works, and relative paths stay confined.
        const stored = await handlers.get(STORAGE.STORE_IMPORTED_FILE)(null, {
          storagePath: storageRoot,
          targetFolder: path.join(storageRoot, 'Papers'),
          fileName: 'kept.pdf',
          dataBase64: Buffer.from('%PDF-1.4\n').toString('base64')
        });
        assert.equal(stored.ok, true);
        assert.equal(stored.relativePath, 'Papers/kept.pdf');

        const traversal = await handlers.get(STORAGE.WRITE_JSON_FILE)(null, {
          storagePath: storageRoot,
          targetFolder: path.join(storageRoot, '..', 'Elsewhere'),
          fileName: 'planted.json',
          data: {}
        });
        assert.equal(traversal.ok, false);
        assert.deepEqual(await fsPromises.readdir(outsideRoot), []);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
};
