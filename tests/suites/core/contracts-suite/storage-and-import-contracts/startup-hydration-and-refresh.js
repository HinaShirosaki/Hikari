module.exports = function registerStorageAndImportContractsStartupHydrationAndRefresh(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  const { assert, fs, path, loadEsmStyleModule, test, shared } = scope;
    const readLocalSource = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
    const readMainProcessSource = () => [
      readLocalSource('src', 'main', 'app', 'start-main-app.js'),
      readLocalSource('src', 'main', 'core', 'main-services.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-mcp-service.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-codex-service.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-agent-services.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-agent-log-service.js')
    ].join('\n');
    const readRendererStorageSource = () => [
      readLocalSource('src', 'renderer', 'renderer.js'),
      readLocalSource('src', 'renderer', 'core', 'start-hikari-core.js'),
      readLocalSource('src', 'renderer', 'app', 'storage-import.js')
    ].join('\n');
    test('chemical bundle hydration/import no longer depends on legacy chemical json fallback', () => {
      const hydrationSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'storage', 'storage-hydration.js'), 'utf8');
      const importSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'storage', 'storage-import.js'), 'utf8');
      const mainSource = readMainProcessSource();
      assert.equal(hydrationSource.includes('legacyChemicalsPath'), false);
      assert.equal(hydrationSource.includes('hydrateFromLegacyChemicals'), false);
      assert.equal(mainSource.includes('CHEMICALS_DATA_FILE_PATH'), false);
      // Chemicals load from their own index, not from a loose *.index.sqlite bundle scan.
      assert.match(hydrationSource, /readChemicalIndex\(bundlePaths\.chemicalsSqlitePath\)/);
      assert.equal(importSource.includes('sqlite_only_bundle'), false);
    });
    test('storage root import shows its alerts as error notices', async () => {
      const reported = [];
      const windowStub = {
        hikariApi: { reportError: (event) => reported.push(event) },
        setTimeout: () => 0,
        clearTimeout: () => {}
      };
      const documentStub = {
        createElement: () => ({ setAttribute: () => {}, style: {}, hidden: true }),
        querySelector: () => null,
        body: { appendChild: () => {} }
      };
      const { createStorageImportController } = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'app', 'storage-import.js'),
        { window: windowStub, document: documentStub }
      );
      const alert = 'The chemical inventory file could not be read, so it was moved aside.';
      const controller = createStorageImportController({
        state: structuredClone(shared.defaultState),
        persist: () => {},
        persistState: () => {},
        normalizeStateStoragePaths: () => {},
        windowObject: {
          hikariApi: {
            ensureStorageDirectory: async (storagePath) => ({ ok: true, path: storagePath }),
            importStorageRoot: async () => ({ ok: true, statePatch: {}, alerts: [alert] })
          }
        }
      });
      const result = await controller.runStorageRootImport('/root', {});
      assert.equal(result.ok, true);
      assert.deepEqual(JSON.parse(JSON.stringify(reported)), [{ source: 'renderer:notice', message: alert }]);
    });
    test('storage root refresh clears cached module data before importing a changed root', async () => {
      const { createStorageImportController } = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'app', 'storage-import.js'),
        { window: {} }
      );
      const state = structuredClone(shared.defaultState);
      state.projects = [{ id: 'old-project', name: 'Old Project' }];
      state.protocols = [{ id: 'old-protocol', name: 'Old Protocol' }];
      state.notebookEntries = [{ id: 'old-note', title: 'Old Note' }];
      state.papers = [{ id: 'old-paper', title: 'Old Paper' }];
      state.assays = [{ id: 'old-assay', name: 'Old Assay' }];
      state.gelAnalyses = [{ id: 'old-gel', name: 'Old Gel' }];
      state.samples = [{ id: 'old-sample', name: 'Old Sample' }];
      state.inventory = { Freezer: [{ id: 'old-box', name: 'Old Box' }] };
      state.agentChat = { currentSessionId: 'old-chat', sessions: [{ id: 'old-chat' }], messages: [{ id: 'old-message' }] };
      state.settings.storagePath = '/old/root';
      state.settings.llm.apiKey = 'keep-this-key';
      state.settings.dashboard.quickLogDraft = 'old quick log';
      state.settings.dashboard.quickLogEntries = [{
        id: 'old-quick-log',
        text: 'Old root observation',
        createdAt: '2026-04-01T10:00:00.000Z',
        updatedAt: '2026-04-01T10:00:00.000Z'
      }];

      let ensuredPath = '';
      let stateAtImport = null;
      let persistedSnapshot = null;
      const controller = createStorageImportController({
        state,
        persist: () => {
          persistedSnapshot = structuredClone(state);
        },
        persistState: () => {},
        normalizeStateStoragePaths: () => {},
        windowObject: {
          hikariApi: {
            ensureStorageDirectory: async (storagePath) => {
              ensuredPath = storagePath;
              return { ok: true, path: storagePath };
            },
            importStorageRoot: async () => {
              stateAtImport = structuredClone(state);
              return {
                ok: true,
                statePatch: {
                  projects: [{ id: 'new-project', name: 'New Project' }],
                  protocols: [{ id: 'new-protocol', name: 'New Protocol' }],
                  settings: {
                    dashboard: {
                      quickLogDraft: 'new root draft',
                      quickLogEntries: [{
                        id: 'new-quick-log',
                        text: 'New root observation',
                        createdAt: '2026-04-02T10:00:00.000Z',
                        updatedAt: '2026-04-02T10:00:00.000Z'
                      }]
                    }
                  }
                },
                summary: { protocols: 1, quickLogEntries: 1 },
                warnings: []
              };
            }
          }
        }
      });

      const result = await controller.runStorageRootImport('/new/root', {
        persistMergedState: true,
        resetWorkspace: true
      });

      assert.equal(result.ok, true);
      assert.equal(result.refreshed, true);
      assert.equal(ensuredPath, '/new/root');
      assert.deepEqual(stateAtImport.projects, []);
      assert.deepEqual(stateAtImport.protocols, []);
      assert.deepEqual(stateAtImport.notebookEntries, []);
      assert.deepEqual(stateAtImport.papers, []);
      assert.deepEqual(stateAtImport.assays, []);
      assert.deepEqual(stateAtImport.gelAnalyses, []);
      assert.deepEqual(stateAtImport.samples, []);
      assert.deepEqual(stateAtImport.agentChat.sessions, []);
      assert.equal(stateAtImport.settings.storagePath, '/new/root');
      assert.equal(stateAtImport.settings.llm.apiKey, 'keep-this-key');
      assert.equal(stateAtImport.settings.dashboard.quickLogDraft, '');
      assert.equal(stateAtImport.settings.dashboard.quickLogEntries.length, 0);
      assert.equal(state.projects.some((project) => project.id === 'old-project'), false);
      assert.equal(state.projects.some((project) => project.id === 'new-project'), true);
      assert.equal(state.protocols.some((protocol) => protocol.id === 'new-protocol'), true);
      assert.equal(state.settings.llm.apiKey, 'keep-this-key');
      assert.equal(state.settings.dashboard.quickLogDraft, 'new root draft');
      assert.equal(state.settings.dashboard.quickLogEntries[0].id, 'new-quick-log');
      assert.equal(state.settings.storageImport.summary.quickLogEntries, 1);
      assert.equal(persistedSnapshot.projects.some((project) => project.id === 'new-project'), true);
    });
    test('startup storage hydration syncs sidecars for imported project state', async () => {
      const { createStorageImportController } = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'app', 'storage-import.js'),
        { window: {} }
      );
      const state = structuredClone(shared.defaultState);
      state.settings.storagePath = '/existing/root';
      let autoSavedPayload = null;
      let persistedState = null;
      const controller = createStorageImportController({
        state,
        persist: () => {},
        persistState: () => {
          persistedState = structuredClone(state);
        },
        normalizeStateStoragePaths: () => {},
        windowObject: {
          hikariApi: {
            ensureStorageDirectory: async (storagePath) => ({ ok: true, path: storagePath }),
            importStorageRoot: async () => ({
              ok: true,
              statePatch: {
                projects: [{ id: 'project-1', name: 'Atlas' }]
              },
              summary: { bundles: 1 },
              warnings: []
            }),
            autoSaveDataFile: async (data, filePath) => {
              autoSavedPayload = {
                data: structuredClone(data),
                filePath
              };
              return { ok: true, filePath: '', sidecarPaths: {} };
            }
          }
        }
      });

      const result = await controller.hydrateStateFromStorageRoot();
      assert.equal(result.ok, true);
      assert.equal(result.sidecarSync.ok, true);
      assert.equal(autoSavedPayload.filePath, '');
      assert.equal(autoSavedPayload.data.settings.storagePath, '/existing/root');
      assert.equal(autoSavedPayload.data.projects.some((project) => project.name === 'Atlas'), true);
      assert.equal(persistedState.projects.some((project) => project.name === 'Atlas'), true);
    });
    test('startup hydration recovers the workspace root when localStorage lost it', async () => {
      const { createStorageImportController } = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'app', 'storage-import.js'),
        { window: {} }
      );
      const state = structuredClone(shared.defaultState);
      state.settings.storagePath = '';
      let importedPath = '';
      const controller = createStorageImportController({
        state,
        persist: () => {},
        persistState: () => {},
        normalizeStateStoragePaths: () => {},
        windowObject: {
          hikariApi: {
            getLastStorageRoot: async () => ({ ok: true, storagePath: '/recovered/root' }),
            ensureStorageDirectory: async (storagePath) => ({ ok: true, path: storagePath }),
            importStorageRoot: async (storagePath) => {
              importedPath = storagePath;
              return {
                ok: true,
                statePatch: { gelAnalyses: [{ id: 'gel-1', name: 'Saved Gel' }] },
                summary: {},
                warnings: []
              };
            },
            autoSaveDataFile: async () => ({ ok: true, filePath: '', sidecarPaths: {} })
          }
        }
      });

      const result = await controller.hydrateStateFromStorageRoot();
      assert.equal(result.ok, true);
      assert.equal(importedPath, '/recovered/root');
      assert.equal(state.settings.storagePath, '/recovered/root');
      assert.equal(state.gelAnalyses.some((gel) => gel.id === 'gel-1'), true);
    });
    test('startup hydration stays a no-op when no workspace root can be recovered', async () => {
      const { createStorageImportController } = loadEsmStyleModule(
        path.join(__dirname, 'src', 'renderer', 'app', 'storage-import.js'),
        { window: {} }
      );
      const state = structuredClone(shared.defaultState);
      state.settings.storagePath = '';
      let imported = false;
      const controller = createStorageImportController({
        state,
        persist: () => {},
        persistState: () => {},
        normalizeStateStoragePaths: () => {},
        windowObject: {
          hikariApi: {
            getLastStorageRoot: async () => ({ ok: false, storagePath: '' }),
            importStorageRoot: async () => {
              imported = true;
              return { ok: true, statePatch: {} };
            }
          }
        }
      });

      assert.equal(await controller.hydrateStateFromStorageRoot(), undefined);
      assert.equal(imported, false);
      assert.equal(state.settings.storagePath, '');
    });
    test('renderer storage import wiring runs on save callback and startup hydration path', () => {
      const rendererSource = readRendererStorageSource();
      const settingsSource = readLocalSource('src', 'renderer', 'modules', 'settings', 'index.js');
      assert.match(rendererSource, /onStoragePathSaved:\s*async\s*\(storagePath,\s*options = \{\}\)\s*=>/);
      assert.match(rendererSource, /resetWorkspace:\s*options\.resetWorkspace === true/);
      assert.match(rendererSource, /function refreshWorkspaceForStorageRoot\(storagePath\)/);
      assert.match(rendererSource, /refreshWorkspaceForStorageRoot,\s*runStorageRootImport/);
      assert.match(rendererSource, /async function hydrateStateFromStorageRoot\(\)/);
      assert.equal(rendererSource.includes('hydrateStateFromDataFile'), false);
      assert.match(rendererSource, /syncStateSidecarsFromStorageRoot/);
      assert.match(rendererSource, /autoSaveDataFile\(state,\s*''\)/);
      assert.match(rendererSource, /syncSidecars:\s*true/);
      assert.match(rendererSource, /async function initApp\(\)\s*\{[\s\S]*?await storageImportController\.hydrateStateFromStorageRoot\(\);/);
      assert.match(rendererSource, /state\.projects = mergeRecordsById\(state\.projects, patch\.projects, 'project'\);/);
      assert.match(rendererSource, /mergeStorageImportPatch\(result\.statePatch\);/);
      assert.equal(/state\.settings\s*=\s*result\.statePatch\.settings/.test(rendererSource), false);
      assert.match(settingsSource, /const rootChanged = nextPath !== previousPath;/);
      assert.match(settingsSource, /onStoragePathSaved\(nextPath,\s*\{\s*resetWorkspace:\s*rootChanged,/);
      assert.equal(settingsSource.includes('state.settings.storagePath = nextPath;\n    persist();\n    if (!nextPath)'), false);
    });
    test('settings split constructs extracted callbacks before startup binds them', () => {
      const settingsSource = readLocalSource('src', 'renderer', 'modules', 'settings', 'index.js');
      const codexControllerIndex = settingsSource.indexOf('} = createCodexAccountSettings({');
      const codexListenerIndex = settingsSource.indexOf('formPresentation.bind(llmForm, onSaveLlmSettings)');
      const journalControllerIndex = settingsSource.indexOf('} = createPreferredJournalSettings({');
      const journalListenerIndex = settingsSource.indexOf("preferredJournalForm?.addEventListener('submit', onSavePreferredJournal)");

      assert.ok(codexControllerIndex >= 0);
      assert.ok(codexListenerIndex > codexControllerIndex);
      assert.ok(journalControllerIndex >= 0);
      assert.ok(journalListenerIndex > journalControllerIndex);
    });
    test('main agent chat logging records request/result/error with redacted API key metadata', () => {
      const agentDir = path.join(__dirname, 'src', 'main', 'agent');
      const agentPath = (...parts) => path.join(agentDir, ...parts);
      const mainSource = readMainProcessSource();
      const appPathsSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'lib', 'app-paths.js'), 'utf8');
      const agentChatRequestSource = fs.readFileSync(agentPath('runtime', 'agent-chat-request.js'), 'utf8');
      const controllerUtilsSource = fs.readFileSync(agentPath('shared', 'controller-utils', 'tracing.js'), 'utf8');
      assert.match(mainSource, /AGENT_CHAT_LOG_FILE_NAME = 'agent-chat\.log'/);
      assert.match(mainSource, /agentLogService\.ensureAgentChatLogFile\([^)]*getAgentChatLogPath\(\)\)/);
      assert.match(mainSource, /createMainAppPaths/);
      assert.match(appPathsSource, /HIKARI_AGENT_CHAT_LOG_PATH/);
      assert.match(controllerUtilsSource, /apiKeyProvided: Boolean\(cleanText\(source\.apiKey, 12\)\)/);
      assert.equal(controllerUtilsSource.includes('apiKey: cleanText(source.apiKey'), false);
      assert.match(agentChatRequestSource, /type: 'agent-chat-request'/);
      assert.match(agentChatRequestSource, /type: 'agent-chat-result'/);
      assert.match(agentChatRequestSource, /type: 'agent-chat-error'/);
    });
};
