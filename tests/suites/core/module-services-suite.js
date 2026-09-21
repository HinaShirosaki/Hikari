module.exports = function registerModuleServicesSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const { assert, path, loadEsmStyleModule, MockElement, test } = scope;
    function loadServicesModule() {
      return loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'services', 'index.js'));
    }

    function createSpy(label = 'spy') {
      const calls = [];
      const fn = (...args) => {
        calls.push(args);
      };
      fn.calls = calls;
      fn.label = label;
      return fn;
    }

    function createRegistryWithUi(servicesModule, overrides = {}) {
      return servicesModule.createModuleRegistry({
        showView: overrides.showView || createSpy('showView'),
        setSearchInputValue: overrides.setSearchInputValue || createSpy('setSearchInputValue'),
        VIEWS: overrides.VIEWS || {
          PROTOCOL_MANAGEMENT: 'protocol-management-view',
          SAMPLE_REGISTRY: 'sample-registry-view'
        }
      });
    }

    test('module registry keeps missing module lookups safe for service fan-out', () => {
      const servicesModule = loadServicesModule();
      const registry = createRegistryWithUi(servicesModule);
      const services = servicesModule.createRendererServices(registry);

      assert.doesNotThrow(() => {
        services.protocol.handleProtocolsChanged();
        services.protocol.handleProtocolsImported();
        services.notebook.handleNotebookEntriesChanged();
        services.notebook.handleAgentNotebookEntriesChanged();
        services.project.handleProjectsChanged();
        services.inventory.handleSamplesChanged();
        services.analysis.handleAssaysChanged();
        services.sequence.openFromToolBox({ sequence: 'ATGC' });
      });
    });

    test('protocol service refreshes notebook workflow and assay dependents', () => {
      const servicesModule = loadServicesModule();
      const registry = createRegistryWithUi(servicesModule);
      const services = servicesModule.createRendererServices(registry);

      const biologyProtocolOptions = createSpy('biologyProtocolOptions');
      const biologyEntries = createSpy('biologyEntries');
      const workflowRender = createSpy('workflowRender');
      const assayNotebookOptions = createSpy('assayNotebookOptions');
      const assayList = createSpy('assayList');
      const protocolList = createSpy('protocolList');

      registry.register('biologyNotebook', {
        renderProtocolOptions: biologyProtocolOptions,
        renderEntries: biologyEntries
      });
      registry.register('workflowManagement', { render: workflowRender });
      registry.register('assay', {
        renderNotebookOptions: assayNotebookOptions,
        renderList: assayList
      });
      registry.register('protocol', { renderList: protocolList });

      services.protocol.handleProtocolsChanged();
      assert.equal(biologyProtocolOptions.calls.length, 1);
      assert.equal(biologyEntries.calls.length, 1);
      assert.equal(workflowRender.calls.length, 1);
      assert.equal(assayNotebookOptions.calls.length, 1);
      assert.equal(assayList.calls.length, 1);
      assert.equal(protocolList.calls.length, 0);

      services.protocol.handleProtocolsImported();
      assert.equal(protocolList.calls.length, 1);
      assert.equal(biologyProtocolOptions.calls.length, 2);
      assert.equal(biologyEntries.calls.length, 2);
      assert.equal(workflowRender.calls.length, 2);
      assert.equal(assayNotebookOptions.calls.length, 2);
      assert.equal(assayList.calls.length, 2);
    });

    test('protocol service delegates protocol JSON import and keeps fallback when protocol is not ready', () => {
      const servicesModule = loadServicesModule();
      const registry = createRegistryWithUi(servicesModule);
      const services = servicesModule.createRendererServices(registry);

      const fallback = services.protocol.importProtocolsFromJson('{"name":"A"}');
      assert.equal(fallback.ok, false);
      assert.equal(fallback.error, 'Protocol import is not ready.');

      const importCalls = [];
      registry.register('protocol', {
        importProtocolsFromJson(rawInput, options) {
          importCalls.push([rawInput, options]);
          return { ok: true, importedProtocols: [{ id: 'protocol-1' }] };
        }
      });

      const result = services.protocol.importProtocolsFromJson('{"name":"B"}', { source: 'test' });
      assert.equal(result.ok, true);
      assert.deepEqual(importCalls, [['{"name":"B"}', { source: 'test' }]]);
    });

    test('protocol service owns external protocol record normalization and merge', () => {
      const servicesModule = loadServicesModule();
      const registry = createRegistryWithUi(servicesModule);
      const state = {
        protocols: [{
          id: 'protocol-existing',
          name: 'Old Protocol',
          steps: [{ id: 'step-1', text: 'Old step', placeholders: [] }]
        }]
      };
      const persist = createSpy('persist');
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const services = servicesModule.createRendererServices(registry, {
        protocol: {
          state,
          persist,
          createId: () => 'protocol-generated'
        }
      });
      const protocolList = createSpy('protocolList');
      const biologyProtocolOptions = createSpy('biologyProtocolOptions');
      registry.register('protocol', { renderList: protocolList });
      registry.register('biologyNotebook', { renderProtocolOptions: biologyProtocolOptions });

      const updated = services.protocol.handleExternalProtocolRecordSaved({
        protocol: {
          id: 'protocol-existing',
          title: 'Updated Protocol',
          description: 'Imported from agent save.',
          materials: '- Buffer\n2. Enzyme',
          steps: ['Mix gently'],
          aliases: [' quick save ', ''],
          project_id: 'project-1',
          project_name: 'Project One'
        }
      });

      assert.equal(updated, true);
      assert.equal(state.protocols.length, 1);
      assert.equal(state.protocols[0].name, 'Updated Protocol');
      assert.deepEqual(Array.from(state.protocols[0].materials), ['Buffer', 'Enzyme']);
      assert.deepEqual(clone(state.protocols[0].steps), [{ id: 'step-1', text: 'Mix gently', placeholders: [] }]);
      assert.deepEqual(Array.from(state.protocols[0].aliases), ['quick save']);
      assert.equal(state.protocols[0].projectId, 'project-1');
      assert.equal(state.protocols[0].projectName, 'Project One');
      assert.equal(persist.calls.length, 1);
      assert.equal(protocolList.calls.length, 1);
      assert.equal(biologyProtocolOptions.calls.length, 1);

      const inserted = services.protocol.handleExternalProtocolRecordSaved({
        protocol: {
          name: 'Generated Protocol',
          steps: [{
            instruction: 'Incubate',
            placeholders: [{ name: 'temperature' }, { name: '' }]
          }]
        }
      });

      assert.equal(inserted, true);
      assert.equal(state.protocols.length, 2);
      assert.equal(state.protocols[1].id, 'protocol-generated');
      assert.deepEqual(clone(state.protocols[1].steps[0].placeholders), [{ id: 'ph-1-1', name: 'temperature' }]);
      assert.equal(persist.calls.length, 2);

      const ignored = services.protocol.handleExternalProtocolRecordSaved({
        protocol: {
          name: 'Missing Steps',
          steps: []
        }
      });
      assert.equal(ignored, false);
      assert.equal(state.protocols.length, 2);
      assert.equal(persist.calls.length, 2);
    });

    test('protocol service opens protocol view only when paper draft creation succeeds', () => {
      const servicesModule = loadServicesModule();
      const showView = createSpy('showView');
      const registry = createRegistryWithUi(servicesModule, { showView });
      const services = servicesModule.createRendererServices(registry);

      const addDraft = createSpy('addDraft');
      registry.register('protocol', {
        addDraftFromExtractedMethod(method, paper) {
          addDraft(method, paper);
          return true;
        }
      });

      const paperPayload = { method: { title: 'Steps' }, paper: { id: 'paper-1' } };
      const ok = services.protocol.createDraftFromPaper(paperPayload);
      assert.equal(ok, true);
      assert.equal(addDraft.calls.length, 1);
      assert.deepEqual(addDraft.calls[0], [paperPayload.method, paperPayload.paper]);
      assert.deepEqual(showView.calls, [['protocol-management-view']]);

      showView.calls.length = 0;
      registry.register('protocol', {
        addDraftFromExtractedMethod() {
          return false;
        }
      });
      const notOk = services.protocol.createDraftFromPaper(paperPayload);
      assert.equal(notOk, false);
      assert.equal(showView.calls.length, 0);
    });

    test('protocol service opens protocol records for shell search routing', () => {
      const servicesModule = loadServicesModule();
      const showView = createSpy('showView');
      const registry = createRegistryWithUi(servicesModule, { showView });
      const services = servicesModule.createRendererServices(registry);
      const editProtocol = createSpy('editProtocol');
      registry.register('protocol', { editProtocol });

      assert.equal(services.protocol.openProtocol('protocol-1'), true);
      assert.deepEqual(showView.calls, [['protocol-management-view']]);
      assert.deepEqual(editProtocol.calls, [['protocol-1']]);

      assert.equal(services.protocol.openProtocol(''), false);
      assert.equal(showView.calls.length, 1);
      assert.equal(editProtocol.calls.length, 1);
    });

    test('notebook services refresh dependents for notebook and agent chat updates', () => {
      const servicesModule = loadServicesModule();
      const registry = createRegistryWithUi(servicesModule);
      const services = servicesModule.createRendererServices(registry);

      const workflowRender = createSpy('workflowRender');
      const assayNotebookOptions = createSpy('assayNotebookOptions');
      const assayList = createSpy('assayList');
      const biologyEntries = createSpy('biologyEntries');

      registry.register('workflowManagement', { render: workflowRender });
      registry.register('assay', {
        renderNotebookOptions: assayNotebookOptions,
        renderList: assayList
      });
      registry.register('biologyNotebook', { renderEntries: biologyEntries });

      services.notebook.handleNotebookEntriesChanged();
      assert.equal(workflowRender.calls.length, 1);
      assert.equal(assayNotebookOptions.calls.length, 1);
      assert.equal(assayList.calls.length, 1);
      assert.equal(biologyEntries.calls.length, 0);

      services.notebook.handleAgentNotebookEntriesChanged();
      assert.equal(workflowRender.calls.length, 2);
      assert.equal(assayNotebookOptions.calls.length, 2);
      assert.equal(assayList.calls.length, 2);
      assert.equal(biologyEntries.calls.length, 1);
    });

    test('project service refreshes notebooks workflow assay papers and agent chat', () => {
      const servicesModule = loadServicesModule();
      const registry = createRegistryWithUi(servicesModule);
      const services = servicesModule.createRendererServices(registry);

      const biologyProjectOptions = createSpy('biologyProjectOptions');
      const biologyProtocolOptions = createSpy('biologyProtocolOptions');
      const biologyEntries = createSpy('biologyEntries');
      const workflowRender = createSpy('workflowRender');
      const assayProjectOptions = createSpy('assayProjectOptions');
      const assayNotebookOptions = createSpy('assayNotebookOptions');
      const assayList = createSpy('assayList');
      const papersRender = createSpy('papersRender');
      const agentRender = createSpy('agentRender');

      registry.register('biologyNotebook', {
        renderProjectOptions: biologyProjectOptions,
        renderProtocolOptions: biologyProtocolOptions,
        renderEntries: biologyEntries
      });
      registry.register('workflowManagement', { render: workflowRender });
      registry.register('assay', {
        renderProjectOptions: assayProjectOptions,
        renderNotebookOptions: assayNotebookOptions,
        renderList: assayList
      });
      registry.register('papers', { render: papersRender });
      registry.register('agentChat', { render: agentRender });

      services.project.handleProjectsChanged();
      assert.equal(biologyProjectOptions.calls.length, 1);
      assert.equal(biologyProtocolOptions.calls.length, 1);
      assert.equal(biologyEntries.calls.length, 1);
      assert.equal(workflowRender.calls.length, 1);
      assert.equal(assayProjectOptions.calls.length, 1);
      assert.equal(assayNotebookOptions.calls.length, 1);
      assert.equal(assayList.calls.length, 1);
      assert.equal(papersRender.calls.length, 1);
      assert.equal(agentRender.calls.length, 1);
    });

    test('inventory service refreshes sample registry and opens the container-first sample workspace', () => {
      const servicesModule = loadServicesModule();
      const showView = createSpy('showView');
      const setSearchInputValue = createSpy('setSearchInputValue');
      const registry = createRegistryWithUi(servicesModule, {
        showView,
        setSearchInputValue
      });
      const services = servicesModule.createRendererServices(registry);

      const sampleRegistryRender = createSpy('sampleRegistryRender');
      registry.register('sampleRegistry', { render: sampleRegistryRender });

      services.inventory.handleSamplesChanged();
      assert.equal(sampleRegistryRender.calls.length, 1);

      services.inventory.openSampleSearch('HEK293');
      assert.deepEqual(showView.calls, [['sample-registry-view']]);
      assert.deepEqual(setSearchInputValue.calls, []);
    });

    test('analysis service refreshes biology notebook previews for assay changes', () => {
      const servicesModule = loadServicesModule();
      const registry = createRegistryWithUi(servicesModule);
      const services = servicesModule.createRendererServices(registry);

      const renderLinkedPreviews = createSpy('renderLinkedPreviews');
      registry.register('biologyNotebook', { renderLinkedPreviews });

      services.analysis.handleAssaysChanged();

      assert.equal(renderLinkedPreviews.calls.length, 1);
    });

    test('sequence service loads payload into sequence viewer and opens detail view', () => {
      const servicesModule = loadServicesModule();
      const showView = createSpy('showView');
      const registry = createRegistryWithUi(servicesModule, { showView });
      const services = servicesModule.createRendererServices(registry);

      const loadFromExternal = createSpy('loadFromExternal');
      const openDetailView = createSpy('openDetailView');
      const payload = { sequence: 'ATGC', name: 'Example' };
      registry.register('sequenceViewer', { loadFromExternal, openDetailView });

      services.sequence.openFromToolBox(payload);

      assert.deepEqual(loadFromExternal.calls, [[payload]]);
      assert.deepEqual(openDetailView.calls, [[]]);
      assert.deepEqual(showView.calls, []);
    });

    test('unsaved changes service immediately approves close when editors are clean', () => {
      const servicesModule = loadServicesModule();
      const responses = [];
      const service = servicesModule.createUnsavedChangesService({
        moduleRegistry: {
          get: () => ({ hasUnsavedChanges: () => false })
        },
        api: {
          onAppCloseRequested: () => () => {},
          respondToAppClose: (action) => responses.push(action)
        },
        documentObject: null,
        windowObject: null
      });

      service.handleCloseRequested();

      assert.deepEqual(responses, ['quit']);
      assert.equal(service.getUnsavedSources().length, 0);
    });

    test('unsaved changes service saves the dirty editors that stay checked', async () => {
      const servicesModule = loadServicesModule();
      const elements = new Map();
      const makeElement = (id = '') => {
        const element = new MockElement(id);
        element.children = [];
        element.replaceChildren = (...children) => {
          element.children = children;
        };
        return element;
      };
      [
        'unsaved-changes-overlay',
        'unsaved-changes-list',
        'unsaved-changes-status',
        'unsaved-changes-close-btn',
        'unsaved-changes-cancel-btn',
        'unsaved-changes-discard-btn',
        'unsaved-changes-save-btn'
      ].forEach((id) => elements.set(id, makeElement(id)));
      elements.get('unsaved-changes-overlay').hidden = true;

      const created = [];
      const documentObject = {
        getElementById: (id) => elements.get(id) || null,
        createElement: (tag) => {
          const element = makeElement();
          element.tagName = String(tag || '').toUpperCase();
          created.push(element);
          return element;
        },
        addEventListener() {}
      };
      const renderedLabels = () => created
        .filter((element) => element.tagName === 'SPAN')
        .map((element) => element.textContent);
      const renderedBoxes = () => created.filter((element) => element.type === 'checkbox');
      const windowObject = {
        addEventListener() {}
      };
      const savedKeys = [];
      const dirty = new Map([
        ['sampleRegistry', true],
        ['protocol', true]
      ]);
      const moduleRegistry = {
        get(key) {
          return {
            hasUnsavedChanges: () => dirty.get(key) === true,
            async saveUnsavedChanges() {
              savedKeys.push(key);
              dirty.set(key, false);
              return true;
            }
          };
        }
      };
      const responses = [];
      const service = servicesModule.createUnsavedChangesService({
        moduleRegistry,
        api: {
          onAppCloseRequested: () => () => {},
          respondToAppClose: (action) => responses.push(action)
        },
        documentObject,
        windowObject
      });

      service.handleCloseRequested();
      assert.equal(elements.get('unsaved-changes-overlay').hidden, false);
      assert.equal(elements.get('unsaved-changes-list').children.length, 2);
      assert.deepEqual(renderedLabels(), ['Sample', 'Protocol']);
      assert.equal(elements.get('unsaved-changes-save-btn').textContent, 'Save 2 & Quit');

      elements.get('unsaved-changes-close-btn').click();
      assert.equal(elements.get('unsaved-changes-overlay').hidden, true);
      assert.deepEqual(responses, ['pending', 'cancel']);

      service.handleCloseRequested();
      assert.equal(elements.get('unsaved-changes-overlay').hidden, false);

      await service.saveAndQuit();

      assert.deepEqual(savedKeys, ['sampleRegistry', 'protocol']);
      assert.deepEqual(responses, ['pending', 'cancel', 'pending', 'quit']);
      assert.equal(elements.get('unsaved-changes-overlay').hidden, true);

      // Unchecked editors stay dirty: the app quits and drops their work.
      dirty.set('sampleRegistry', true);
      dirty.set('protocol', true);
      savedKeys.length = 0;
      created.length = 0;

      service.handleCloseRequested();
      const protocolBox = renderedBoxes()[1];
      protocolBox.checked = false;
      protocolBox.change();
      assert.equal(elements.get('unsaved-changes-save-btn').textContent, 'Save & Quit');

      await service.saveAndQuit();

      assert.deepEqual(savedKeys, ['sampleRegistry']);
      assert.equal(dirty.get('protocol'), true);
      assert.deepEqual(responses, ['pending', 'cancel', 'pending', 'quit', 'pending', 'quit']);

      // Nothing checked leaves the primary action unavailable.
      dirty.set('sampleRegistry', true);
      created.length = 0;
      service.handleCloseRequested();
      renderedBoxes().forEach((box) => {
        box.checked = false;
        box.change();
      });
      assert.equal(elements.get('unsaved-changes-save-btn').disabled, true);
    });
};
