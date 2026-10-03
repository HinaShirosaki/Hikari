module.exports = function registerAppLabAndProjectSuiteNotebookPageEditing(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const {
    assert,
    fs,
    path,
    loadEsmStyleModule,
    createMockDocument,
    trigger,
    flushAsync,
    test,
    shared
  } = scope;
test('biology-notebook derives legacy Protein Builder protocols from the stored thermocycle program', () => {
  const entryHelpers = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'entry', 'entry-helpers.js')
  );
  const protocol = entryHelpers.resolveEntryProtocol({
    protocolId: 'protein-builder-cloning-assembly-protocol',
    protocolSnapshot: {
      id: 'protein-builder-cloning-assembly-protocol',
      name: 'Protein Builder Cloning Assembly',
      steps: [{ id: 'legacy-step', text: 'Assemble reaction.', placeholders: [] }]
    },
    proteinBuilderCloningDesign: {
      source: 'protein_builder_cloning_assembly',
      pcrProgram: {
        steps: [
          { label: 'Initial denaturation', temperature: '98 C', time: '30 s', cycles: '1' },
          { label: 'Denaturation', temperature: '98 C', time: '10 s', cycles: '30' },
          { label: 'Annealing', temperature: '57 C', time: '20 s', cycles: '30' },
          { label: 'Extension', temperature: '72 C', time: '1 min 45 s', cycles: '30' },
          { label: 'Final extension', temperature: '72 C', time: '2 min', cycles: '1' },
          { label: 'Hold', temperature: '4 C', time: 'hold', cycles: '1' }
        ]
      }
    }
  }, []);

  assert.equal(protocol.name, 'PCR Thermocycle Program');
  assert.match(protocol.steps[0].text, /Initial denaturation.*98 C.*30 s/i);
  assert.match(protocol.steps[1].text, /Repeat for 30 cycles.*Annealing - 57 C - 20 s.*Extension - 72 C - 1 min 45 s/i);
  assert.doesNotMatch(protocol.steps.map((step) => step.text).join('\n'), /Assemble reaction/i);
});

test('biology-notebook prefers stored protocol snapshots over live protocol records for saved pages', () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-page-starter',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-experiment-name',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-edit-protocol-btn',
    'biology-notebook-apply-protocol-edit-btn',
    'biology-notebook-cancel-protocol-edit-btn',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-protocol-editor',
    'biology-notebook-page-protocol-name',
    'biology-notebook-page-protocol-steps',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);

  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' }
    ],
    protocols: [
      {
        id: 'protocol-1',
        name: 'Live Protocol Name',
        steps: [
          {
            text: 'Live library step.',
            placeholders: []
          }
        ]
      }
    ],
    notebookEntries: [
      {
        id: 'saved-page-1',
        notebookType: 'biology',
        projectId: 'p1',
        projectName: 'Atlas',
        protocolId: 'protocol-1',
        protocolName: 'Stored Snapshot Name',
        protocolSnapshot: {
          id: 'protocol-1',
          name: 'Stored Snapshot Name',
          steps: [
            {
              text: 'Stored notebook step with {{ph:volume}}.',
              placeholders: [
                { id: 'volume', name: 'Volume' }
              ]
            }
          ]
        },
        values: {
          'volume': '15 mL'
        },
        result: 'Snapshot-backed page',
        resultFiles: [],
        resultFileRecords: [],
        updatedAt: '2026-04-21T00:00:00.000Z',
        notebookState: 'executed',
        executedAt: '2026-04-21T00:00:00.000Z'
      }
    ],
    assays: [],
    gelAnalyses: [],
    settings: {
      storagePath: ''
    }
  };

  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'), {
    document,
    window: {
      hikariApi: {}
    }
  });
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {},
    createId: () => 'new-entry',
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions();
  notebook.openEntry('saved-page-1');

  assert.equal(document.getElementById('biology-notebook-protocol-title').textContent, 'Stored Snapshot Name');
  assert.equal(document.getElementById('biology-notebook-experiment-name').hidden, true);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /Stored notebook step with/);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /data-nb-key-ref="volume"/);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, />15 mL</);
  assert.doesNotMatch(document.getElementById('biology-notebook-steps').innerHTML, /Live library step/);
  assert.equal(document.getElementById('biology-notebook-page-starter').hidden, true);

  const notebookWorkspace = document.getElementById('biology-notebook-viewer-column');
  const droppedImage = { name: 'workspace-drop.png', type: 'image/png', size: 128, lastModified: 1 };
  const dataTransfer = { types: ['Files'], files: [droppedImage], dropEffect: '' };
  assert.equal(notebookWorkspace.classList.contains('app-file-drop-target'), true);
  trigger(notebookWorkspace, 'dragenter', { dataTransfer });
  assert.equal(notebookWorkspace.classList.contains('is-file-drop-active'), true);
  trigger(notebookWorkspace, 'drop', { dataTransfer });
  assert.equal(notebookWorkspace.classList.contains('is-file-drop-active'), false);
  assert.match(document.getElementById('biology-notebook-result-attachments').innerHTML, /workspace-drop\.png/);

  trigger(document.getElementById('biology-notebook-protocol-title'), 'dblclick');
  assert.equal(document.getElementById('biology-notebook-protocol-title').hidden, true);
  assert.equal(document.getElementById('biology-notebook-experiment-name').hidden, false);
  document.getElementById('biology-notebook-experiment-name').value = 'Renamed transformation page';
  trigger(document.getElementById('biology-notebook-experiment-name'), 'keydown', { key: 'Enter' });
  assert.equal(document.getElementById('biology-notebook-experiment-name').hidden, true);
  assert.equal(document.getElementById('biology-notebook-protocol-title').hidden, false);
  assert.equal(document.getElementById('biology-notebook-protocol-title').textContent, 'Renamed transformation page');

  const notebookShellCss = fs.readFileSync(path.join(
    __dirname,
    'ui',
    'css',
    'views',
    'biology-notebook-view',
    'rail-and-projects.css'
  ), 'utf8');
  assert.match(notebookShellCss, /\.biology-notebook-title-display,\s*\.biology-notebook-title-editor\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*0;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*font-size:\s*1\.17em;/s);
  assert.match(notebookShellCss, /\.biology-notebook-title-editor\s*\{[^}]*overflow:\s*hidden;[^}]*resize:\s*none;[^}]*field-sizing:\s*content;/s);
});
test('biology-notebook page naming uses the chosen Codex model once and skips generated or user-renamed names', async () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-page-starter',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-experiment-name',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-edit-protocol-btn',
    'biology-notebook-apply-protocol-edit-btn',
    'biology-notebook-cancel-protocol-edit-btn',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-protocol-editor',
    'biology-notebook-page-protocol-name',
    'biology-notebook-page-protocol-steps',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);
  // Page names are generated only while Codex is connected.
  document.body.dataset = { agentAvailability: 'connected' };
  const protocolSnapshot = {
    id: 'protocol-1',
    name: 'Transformation',
    steps: [
      {
        text: 'Transform cells with {{ph:dna}} and recover in {{ph:medium}}.',
        placeholders: [
          { id: 'dna', name: 'DNA' },
          { id: 'medium', name: 'Recovery medium' }
        ]
      }
    ]
  };
  const state = {
    projects: [{ id: 'p1', name: 'Atlas' }],
    protocols: [protocolSnapshot],
    notebookEntries: [
      {
        id: 'generated-page',
        notebookType: 'biology',
        projectId: 'p1',
        projectName: 'Atlas',
        protocolId: 'protocol-1',
        protocolName: 'Transformation',
        experimentName: 'Transformation',
        protocolSnapshot,
        values: {
          'dna': 'pET28a-GFP',
          'medium': 'SOC'
        },
        result: '',
        resultFiles: [],
        resultFileRecords: []
      },
      {
        id: 'renamed-page',
        notebookType: 'biology',
        projectId: 'p1',
        projectName: 'Atlas',
        protocolId: 'protocol-1',
        protocolName: 'Transformation',
        experimentName: 'GFP pilot transformation',
        protocolSnapshot,
        values: {
          'dna': 'pET28a-GFP',
          'medium': 'SOC'
        },
        result: '',
        resultFiles: [],
        resultFileRecords: []
      }
    ],
    assays: [],
    gelAnalyses: [],
    settings: {
      storagePath: '',
      llm: {
        provider: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'high'
      }
    }
  };
  const directCalls = [];
  let runDirectResponse = async () => ({ ok: true, text: 'pET28a GFP SOC Transformation' });
  let persistCalls = 0;
  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'), {
    document,
    window: {
      hikariApi: {
        runDirectLlmPrompt: async (payload) => {
          directCalls.push(payload);
          return runDirectResponse(payload);
        }
      }
    }
  });
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => { persistCalls += 1; },
    createId: () => 'new-entry',
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions();
  notebook.openEntry('generated-page');
  await flushAsync();

  assert.equal(directCalls.length, 1);
  assert.equal(directCalls[0].moduleId, 'notebook');
  assert.equal(directCalls[0].task, 'page-name');
  assert.equal(directCalls[0].llm.model, 'gpt-5.4');
  assert.equal(directCalls[0].llm.reasoningEffort, 'low');
  assert.equal(directCalls[0].maxOutputTokens, 40);
  assert.equal(state.notebookEntries[0].experimentName, 'pET28a GFP SOC Transformation');
  assert.equal(state.notebookEntries[0].experimentNameSource, 'generated');
  assert.ok(state.notebookEntries[0].experimentNameGeneratedAt);
  assert.equal(state.notebookEntries[0].experimentNameGeneratedModel, 'gpt-5.4');
  assert.ok(persistCalls >= 1);

  notebook.openEntry('generated-page');
  notebook.openEntry('renamed-page');
  await flushAsync();
  assert.equal(directCalls.length, 1);
  assert.equal(state.notebookEntries[1].experimentName, 'GFP pilot transformation');
  assert.equal(state.notebookEntries[1].experimentNameSource, undefined);

  state.notebookEntries.push({
    id: 'rename-during-generation',
    notebookType: 'biology',
    projectId: 'p1',
    projectName: 'Atlas',
    protocolId: 'protocol-1',
    protocolName: 'Transformation',
    experimentName: 'Transformation',
    protocolSnapshot,
    values: {
      'dna': 'pET28a-GFP',
      'medium': 'SOC'
    },
    result: '',
    resultFiles: [],
    resultFileRecords: []
  });
  let finishPendingName;
  runDirectResponse = () => new Promise((resolve) => { finishPendingName = resolve; });
  notebook.openEntry('rename-during-generation');
  await flushAsync();
  assert.equal(directCalls.length, 2);

  trigger(document.getElementById('biology-notebook-protocol-title'), 'dblclick');
  document.getElementById('biology-notebook-experiment-name').value = 'User named GFP transformation';
  trigger(document.getElementById('biology-notebook-experiment-name'), 'keydown', { key: 'Enter' });
  finishPendingName({ ok: true, text: 'Late Generated Name' });
  await flushAsync();
  assert.equal(document.getElementById('biology-notebook-protocol-title').textContent, 'User named GFP transformation');
  assert.equal(state.notebookEntries[2].experimentName, 'Transformation');

  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();
  assert.equal(state.notebookEntries[2].experimentName, 'User named GFP transformation');
  assert.equal(state.notebookEntries[2].experimentNameSource, 'user');
  notebook.openEntry('rename-during-generation');
  await flushAsync();
  assert.equal(directCalls.length, 2);
});
test('biology-notebook page naming recognizes completion and legacy rename state', () => {
  const namingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'entry', 'page-name-generator.js'), {});
  const protocol = {
    name: 'Expression',
    steps: [
      {
        placeholders: [
          { id: 'temperature', name: 'Temperature' },
          { id: 'duration', name: 'Duration' }
        ]
      }
    ]
  };

  assert.equal(namingModule.areAllNotebookPlaceholdersFilled(protocol, {
    'temperature': '18 C',
    'duration': '16 h'
  }), true);
  assert.equal(namingModule.areAllNotebookPlaceholdersFilled(protocol, {
    'temperature': '18 C',
    'duration': '   '
  }), false);
  assert.equal(namingModule.areAllNotebookPlaceholdersFilled({ name: 'No placeholders', steps: [] }, {}), false);
  assert.equal(namingModule.resolveNotebookExperimentNameSource({
    protocolName: 'Expression',
    experimentName: 'Expression'
  }, protocol), 'protocol');
  assert.equal(namingModule.resolveNotebookExperimentNameSource({
    protocolName: 'Expression',
    experimentName: 'Overnight GFP expression'
  }, protocol), 'user');
  assert.equal(namingModule.resolveNotebookExperimentNameSource({
    protocolName: 'Expression',
    experimentName: 'Generated expression name',
    experimentNameSource: 'generated'
  }, protocol), 'generated');
});
test('biology-notebook attachment images resolve from portable records for rendering and PDF export', async () => {
  class AttachmentFileReader {
    readAsDataURL() {
      this.result = 'data:application/octet-stream;base64,aW1hZ2U=';
      this.onload?.();
    }
  }
  const attachmentModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'biology-notebook',
    'results',
    'result-file-attachments.js'
  ), { FileReader: AttachmentFileReader });
  assert.equal(attachmentModule.inferAttachmentImageMimeType({ name: 'gel.PNG' }), 'image/png');
  assert.equal(attachmentModule.inferAttachmentImageMimeType({ name: 'capture.bin', mimeType: 'image/webp' }), 'image/webp');
  assert.equal(attachmentModule.isImageAttachment({ name: 'measurements.csv' }), false);
  assert.equal(
    attachmentModule.resolveResultFileRecordPath(
      { relativePath: 'Project/Atlas/Notebook/page/ResultFiles/gel.png' },
      '/data/hikari'
    ),
    '/data/hikari/Project/Atlas/Notebook/page/ResultFiles/gel.png'
  );

  const readPaths = [];
  const loader = attachmentModule.createResultFileAttachmentLoader({
    getStoragePath: () => '/data/hikari',
    readFileBase64: async (filePath) => {
      readPaths.push(filePath);
      return { ok: true, dataBase64: 'aW1hZ2U=' };
    }
  });
  const entry = {
    resultFiles: ['gel.png', 'measurements.csv'],
    resultFileRecords: [
      {
        name: 'gel.png',
        relativePath: 'Project/Atlas/Notebook/page/ResultFiles/gel.png',
        mimeType: 'image/png'
      }
    ]
  };
  const displayItems = attachmentModule.buildAttachmentDisplayItems(entry, [
    { name: 'microscope.jpg', type: 'image/jpeg', size: 10, lastModified: 1 }
  ]);
  assert.equal(displayItems.length, 3);
  assert.equal(displayItems.filter((item) => item.imageMimeType).length, 2);

  const images = await loader.resolveEntryImages(entry);
  assert.equal(images.length, 1);
  assert.equal(images[0].name, 'gel.png');
  assert.equal(images[0].dataUrl, 'data:image/png;base64,aW1hZ2U=');
  assert.deepEqual(readPaths, ['/data/hikari/Project/Atlas/Notebook/page/ResultFiles/gel.png']);

  await loader.resolveEntryImages(entry);
  assert.equal(readPaths.length, 1, 'saved image reads are cached across page render and PDF export');

  const pendingImage = await loader.resolvePendingImage({ name: 'fallback.png', type: '' });
  assert.equal(pendingImage.dataUrl, 'data:image/png;base64,aW1hZ2U=');

  const notebookCss = fs.readFileSync(path.join(
    __dirname,
    'ui',
    'css',
    'views',
    'biology-notebook-view',
    'notebook-and-tables.css'
  ), 'utf8');
  assert.match(notebookCss, /\.biology-notebook-attachment-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(180px,\s*320px\)\)/s);
  assert.match(notebookCss, /\.biology-notebook-attachment-image\s*\{[^}]*width:\s*fit-content[^}]*border:\s*0/s);
  assert.match(notebookCss, /\.biology-notebook-attachment-image img\s*\{[^}]*width:\s*auto[^}]*height:\s*auto[^}]*max-height:\s*260px[^}]*border:\s*0/s);
  assert.doesNotMatch(notebookCss, /\.biology-notebook-attachment-image img\s*\{[^}]*height:\s*clamp\(/s);
});
test('biology-notebook page metadata shows only times', () => {
  const viewerModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'biology-notebook',
    'entry',
    'viewer-renderer.js'
  ));
  const entry = {
    id: 'entry-1',
    projectId: 'project-1',
    protocolName: 'Binding assay',
    notebookState: 'executed',
    executedAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-25T12:00:00.000Z',
    resultFiles: ['VennR4.png'],
    toolCalculations: [{ id: 'calculation-1', type: 'molarity', title: 'Molarity', result: 'Mass needed: 5 mg' }],
    sampleLinks: [{ sampleId: 'sample-1' }]
  };
  assert.match(viewerModule.buildViewerMeta({ entry }), /^Executed [^·]+ · Updated [^·]+$/);
  assert.match(viewerModule.buildViewerMeta({ entry: { ...entry, updatedAt: entry.executedAt } }), /^Executed [^·]+$/);
  assert.match(viewerModule.buildViewerMeta({ entry: { ...entry, notebookState: 'planned' } }), /^Updated [^·]+$/);
  assert.equal(viewerModule.buildViewerMeta({ entry: null }), '');
});
test('biology-notebook places Clarify and Save inside the notes composer', () => {
  const html = fs.readFileSync(path.join(
    __dirname,
    'ui',
    'html',
    'views',
    'biology-notebook-view.html'
  ), 'utf8');
  const css = fs.readFileSync(path.join(
    __dirname,
    'ui',
    'css',
    'views',
    'biology-notebook-view',
    'notebook-and-tables.css'
  ), 'utf8');
  assert.match(html, /class="biology-notebook-notes-field"[\s\S]*?for="biology-notebook-result"[\s\S]*?class="biology-notebook-notes-composer"[\s\S]*?id="biology-notebook-result"[\s\S]*?id="clarify-save-biology-notebook-btn"/);
  assert.match(html, /<label for="biology-notebook-result">Notes<\/label>/);
  assert.doesNotMatch(html, /class="form-actions"[\s\S]*?id="clarify-save-biology-notebook-btn"/);
  assert.doesNotMatch(html, /class="biology-notebook-linked-toolbar"/);
  assert.match(html, /id="biology-notebook-table-context-menu"[^>]*role="menu"[\s\S]*?id="biology-notebook-add-table-row-btn"[^>]*role="menuitem"[\s\S]*?id="biology-notebook-add-table-column-btn"[^>]*role="menuitem"[\s\S]*?id="biology-notebook-remove-table-btn"[^>]*role="menuitem"/);
  assert.match(css, /\.biology-notebook-linked-results:empty,[\s\S]*?\.biology-notebook-tool-calculations:empty\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /\.biology-notebook-notes-composer\s*\{[^}]*position:\s*relative;/s);
  assert.match(css, /\.biology-notebook-notes-composer textarea\s*\{[^}]*padding:\s*var\(--space-10\)\s+var\(--space-12\)\s+50px;/s);
  assert.match(css, /\.biology-notebook-notes-clarify-btn\s*\{[^}]*position:\s*absolute;[^}]*right:\s*8px;[^}]*bottom:\s*8px;/s);
});
test('biology-notebook quick sample submit is a compact accessible icon', () => {
  const html = fs.readFileSync(path.join(
    __dirname,
    'ui',
    'html',
    'views',
    'biology-notebook-view.html'
  ), 'utf8');
  const css = fs.readFileSync(path.join(
    __dirname,
    'ui',
    'css',
    'views',
    'biology-notebook-view',
    'quick-sample.css'
  ), 'utf8');
  const controllerSource = fs.readFileSync(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'biology-notebook',
    'samples',
    'quick-sample-controller.js'
  ), 'utf8');
  const submitStart = html.indexOf('<button id="biology-notebook-quick-sample-submit-btn"');
  const submitButton = html.slice(submitStart, html.indexOf('</button>', submitStart) + 9);

  assert.match(submitButton, /class="primary-btn biology-notebook-quick-sample-submit-btn"[^>]*type="submit"[^>]*aria-label="Add Sample"[^>]*title="Add Sample"/);
  assert.match(submitButton, /<svg[^>]*aria-hidden="true"[\s\S]*?<span class="sr-only">Add Sample<\/span>/);
  assert.doesNotMatch(submitButton, />\s*Add Sample\s*<\/button>/);
  assert.match(css, /\.biology-notebook-quick-sample-submit-btn\s*\{[^}]*width:\s*34px;[^}]*min-width:\s*34px;[^}]*height:\s*34px;[^}]*padding:\s*0;/s);
  assert.match(controllerSource, /function setBusy\(isBusy\)[\s\S]*?setAttribute\?\.\('aria-label', label\)[\s\S]*?querySelector\?\.\('\.sr-only'\)/);
  assert.doesNotMatch(controllerSource, /submitBtn\.textContent\s*=/);
});
test('biology-notebook buffer preparer floats one autocomplete menu and appends ingredients beyond its starter rows', () => {
  const toolsDir = path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'tools');
  const html = fs.readFileSync(path.join(
    __dirname,
    'ui',
    'html',
    'views',
    'biology-notebook-view.html'
  ), 'utf8');
  const css = fs.readFileSync(path.join(
    __dirname,
    'ui',
    'css',
    'views',
    'biology-notebook-view',
    'rail-and-projects.css'
  ), 'utf8');
  assert.match(html, /<tbody id="biology-notebook-tool-buffer-rows">/);
  assert.match(html, /id="biology-notebook-tool-buffer-add-row-anchor"[\s\S]*?id="biology-notebook-tool-buffer-add-row"[^>]*><svg class="btn-icon"[^>]*><path d="M12 5v14M5 12h14"\/><\/svg><\/button>/);
  assert.match(html, /id="biology-notebook-tool-buffer-adjustment-row"/);
  const molarityButtonStart = html.indexOf('<button id="biology-notebook-add-molarity-btn"');
  const molarityButton = html.slice(molarityButtonStart, html.indexOf('</button>', molarityButtonStart) + 9);
  assert.match(molarityButton, /aria-label="Add molarity table"[\s\S]*?<svg[^>]*aria-hidden="true"[^>]*focusable="false"[\s\S]*?<span class="sr-only">Add molarity table<\/span>/);
  assert.doesNotMatch(molarityButton, /biology-notebook-molarity-icon/);
  assert.match(css, /\.biology-notebook-buffer-suggestions--floating\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*120;/s);

  // Drive the real sidebar controller over a small DOM stand-in.
  const { createNotebookToolSidebarController } = loadEsmStyleModule(path.join(toolsDir, 'tool-sidebar.js'));
  const elements = new Map();
  const doc = {
    documentElement: { clientWidth: 1000, clientHeight: 800 },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, new FakeElement(id));
      }
      return elements.get(id);
    },
    querySelector: (selector) => (selector === '[data-notebook-tool-sidebar]' ? doc.getElementById('biology-notebook-tool-sidebar') : null),
    addEventListener() {},
    register(element) {
      if (element.id) {
        elements.set(element.id, element);
      }
      element.children.forEach((child) => doc.register(child));
    }
  };
  class FakeElement {
    constructor(id = '', className = '') {
      this.id = id;
      this.value = '';
      this.textContent = '';
      this.innerHTML = '';
      this.hidden = false;
      this.children = [];
      this.parentElement = null;
      this.attributes = {};
      this.dataset = {};
      this.style = {};
      this.listeners = {};
      this.classes = new Set(className.split(/\s+/).filter(Boolean));
      this.classList = {
        add: (name) => this.classes.add(name),
        remove: (name) => this.classes.delete(name),
        toggle: (name, force = !this.classes.has(name)) => (force ? this.classes.add(name) : this.classes.delete(name)),
        contains: (name) => this.classes.has(name)
      };
    }
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); }
    fire(type) { (this.listeners[type] || []).forEach((handler) => handler({ preventDefault() {}, target: this })); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getBoundingClientRect() { return this.rect || { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
    descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
    querySelectorAll(selector) {
      if (selector === '[id]') return this.descendants().filter((element) => element.id);
      if (selector.startsWith('.')) return this.descendants().filter((element) => element.classes.has(selector.slice(1)));
      return [];
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    insertBefore(child, reference) {
      if (child.parentElement) child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
      const index = this.children.indexOf(reference);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
      child.parentElement = this;
      doc.register(child);
      return child;
    }
    appendChild(child) { return this.insertBefore(child, null); }
    cloneNode() {
      const copy = new FakeElement(this.id, [...this.classes].join(' '));
      Object.assign(copy.attributes, this.attributes);
      Object.assign(copy.dataset, this.dataset);
      copy.hidden = this.hidden;
      copy.children = this.children.map((child) => Object.assign(child.cloneNode(), { parentElement: copy }));
      return copy;
    }
  }
  doc.body = new FakeElement('body');
  const bufferRows = doc.getElementById('biology-notebook-tool-buffer-rows');
  for (let index = 1; index <= 6; index += 1) {
    const row = new FakeElement(`biology-notebook-tool-buffer-row-${index}`);
    ['name', 'mw', 'stock', 'final', 'amount', 'note'].forEach((field) => {
      row.appendChild(new FakeElement(`biology-notebook-tool-buffer-${field}-${index}`));
    });
    row.appendChild(new FakeElement(`biology-notebook-tool-buffer-suggestions-${index}`, 'biology-notebook-buffer-suggestions'));
    bufferRows.appendChild(row);
  }
  const addRowAnchor = bufferRows.appendChild(new FakeElement('biology-notebook-tool-buffer-add-row-anchor'));
  createNotebookToolSidebarController({
    doc,
    win: { addEventListener() {}, innerWidth: 1000, innerHeight: 800 },
    safeText: (value) => String(value ?? ''),
    createId: () => 'tool-record',
    getStoredCompounds: () => []
  });
  const nameInput = (index) => doc.getElementById(`biology-notebook-tool-buffer-name-${index}`);
  const menu = (index) => doc.getElementById(`biology-notebook-tool-buffer-suggestions-${index}`);

  // Focusing a compound field opens its menu outside the toolbox, which would
  // clip it. With no room below the field it opens upward instead.
  nameInput(1).rect = { top: 700, bottom: 730, left: 100, right: 300, width: 200, height: 30 };
  menu(1).scrollHeight = 150;
  nameInput(1).fire('focus');
  assert.equal(menu(1).hidden, false);
  assert.match(menu(1).innerHTML, /data-buffer-candidate=/);
  assert.equal(nameInput(1).getAttribute('aria-expanded'), 'true');
  assert.equal(menu(1).parentElement, doc.body);
  assert.equal(menu(1).classList.contains('biology-notebook-buffer-suggestions--floating'), true);
  assert.deepEqual(
    { ...menu(1).style },
    { left: '99px', right: 'auto', width: '202px', top: 'auto', bottom: '101px', maxHeight: '230px' }
  );

  // Only one menu is open at a time.
  nameInput(2).rect = { top: 100, bottom: 130, left: 100, right: 300, width: 200, height: 30 };
  nameInput(2).fire('focus');
  assert.equal(menu(2).hidden, false);
  assert.equal(menu(2).style.top, '129px', 'with room below the field the menu opens downward');
  assert.equal(menu(1).hidden, true);
  assert.equal(menu(1).innerHTML, '');
  assert.equal(nameInput(1).getAttribute('aria-expanded'), 'false');

  // All six starter rows are showing, so + appends a seventh above the add-row
  // anchor, wired like the others.
  doc.getElementById('biology-notebook-tool-buffer-add-row').fire('click');
  const row7 = doc.getElementById('biology-notebook-tool-buffer-row-7');
  assert.equal(row7.hidden, false);
  assert.deepEqual(bufferRows.children.slice(-2), [row7, addRowAnchor]);
  nameInput(7).rect = { top: 300, bottom: 330, left: 100, right: 300, width: 200, height: 30 };
  nameInput(7).fire('focus');
  assert.equal(menu(7).hidden, false);
  assert.equal(menu(2).hidden, true);
});
test('biology-notebook buffer preparer starts blank, records without a button, and exposes compound pKa data', () => {
  const html = fs.readFileSync(path.join(__dirname, 'ui', 'html', 'views', 'biology-notebook-view.html'), 'utf8');
  const sheetCss = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'views', 'biology-notebook-view', 'rail-and-projects.css'), 'utf8');
  const toolSource = [
    fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'tools', 'tool-sidebar.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'tools', 'buffer-suggestions.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'tools', 'toolbox-drag.js'), 'utf8')
  ].join('\n');
  const compounds = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'lib', 'chemistry', 'buffer-compounds.js'), 'utf8');
  const bufferSection = html.slice(
    html.indexOf('id="biology-notebook-tool-panel-buffer"'),
    html.indexOf('id="biology-notebook-tool-panel-reaction"')
  );
  assert.doesNotMatch(bufferSection, /value="100"|placeholder="(?:Tris Base|NaCl|Tween 20|Ingredient|MW|empty or 1 M|2000x|50 mM|150 mM|10% v\/v|0\.1% v\/v|stock|final|7\.4)"/);
  // Opening a tool records its table on the page, so there is nothing to press.
  assert.doesNotMatch(html, /biology-notebook-tool-insert-notes-btn|biology-notebook-tool-use-placeholder-btn|biology-notebook-tool-record-btn/);
  assert.doesNotMatch(toolSource, /stepsHost|useForActivePlaceholder|recordBtn|usePlaceholderBtn/);
  assert.match(compounds, /name: 'Bis-Tris',[^\n]*pKa: 6\.5/);
  assert.match(compounds, /name: 'CAPS',[^\n]*pKa: 10\.4/);
  assert.match(compounds, /name: 'Tris Base',[^\n]*startForm: 'base'/);
  assert.match(compounds, /name: 'Tris-HCl',[^\n]*startForm: 'acid'/);

  // Both sheets carry a note column, the amount is typed over rather than read
  // off, and the volume cell holds one input instead of stacking a result row.
  const reactionSection = html.slice(html.indexOf('id="biology-notebook-tool-panel-reaction"'));
  assert.match(bufferSection, /id="biology-notebook-tool-buffer-amount-1"[^>]*type="text"/);
  assert.match(bufferSection, /id="biology-notebook-tool-buffer-note-1"/);
  assert.match(reactionSection, /id="biology-notebook-tool-reaction-note-1"/);
  assert.doesNotMatch(html, /biology-notebook-tool-buffer-output-\d|biology-notebook-tool-reaction-output-\d/);
  // The MW cell is too narrow to give up room to a spinner.
  assert.match(sheetCss, /\.biology-notebook-buffer-sheet input\[type="number"\]::-webkit-inner-spin-button\s*\{[^}]*appearance:\s*none;/s);
  // The sheets are the whole readout: no summary, formula or status line beside them.
  assert.doesNotMatch(html, /biology-notebook-tool-output|biology-notebook-tool-formula|biology-notebook-tool-status/);
});
test('biology-notebook edits only the saved page protocol copy and keeps the original protocol unchanged', () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-edit-protocol-btn',
    'biology-notebook-apply-protocol-edit-btn',
    'biology-notebook-cancel-protocol-edit-btn',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-protocol-editor',
    'biology-notebook-page-protocol-name',
    'biology-notebook-page-protocol-steps',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);

  let persistCalls = 0;
  let notebookChangedCalls = 0;
  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' }
    ],
    protocols: [
      {
        id: 'protocol-1',
        name: 'Source Protocol',
        steps: [
          {
            text: 'Add {{ph:volume}} buffer.',
            placeholders: [
              { id: 'volume', name: 'Volume' }
            ]
          }
        ]
      }
    ],
    notebookEntries: [
      {
        id: 'saved-page-1',
        notebookType: 'biology',
        projectId: 'p1',
        projectName: 'Atlas',
        protocolId: 'protocol-1',
        protocolName: 'Source Protocol',
        experimentName: 'Source Protocol',
        protocolSnapshot: {
          id: 'protocol-1',
          name: 'Source Protocol',
          steps: [
            {
              text: 'Add {{ph:volume}} buffer.',
              placeholders: [
                { id: 'volume', name: 'Volume' }
              ]
            }
          ]
        },
        values: {
          'volume': '15 mL'
        },
        result: 'Snapshot-backed page',
        resultFiles: [],
        resultFileRecords: [],
        updatedAt: '2026-04-21T00:00:00.000Z',
        notebookState: 'executed',
        executedAt: '2026-04-21T00:00:00.000Z'
      }
    ],
    assays: [],
    gelAnalyses: [],
    settings: {
      storagePath: ''
    }
  };

  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'), {
    document,
    window: {
      hikariApi: {}
    }
  });
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let index = 0;
      return () => `generated-${index += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {
      notebookChangedCalls += 1;
    }
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions();
  notebook.openEntry('saved-page-1');

  trigger(document.getElementById('biology-notebook-edit-protocol-btn'), 'click');
  assert.equal(document.getElementById('biology-notebook-protocol-editor').hidden, false);
  assert.equal(document.getElementById('biology-notebook-page-protocol-name').value, 'Source Protocol');
  assert.match(document.getElementById('biology-notebook-page-protocol-steps').value, /Add \[Volume\] buffer\./);

  document.getElementById('biology-notebook-page-protocol-name').value = 'Edited Page Copy';
  document.getElementById('biology-notebook-page-protocol-steps').value = '• Add [Sample volume] buffer.\n• Mix thoroughly.';
  trigger(document.getElementById('biology-notebook-apply-protocol-edit-btn'), 'click');

  assert.equal(state.protocols[0].name, 'Source Protocol');
  assert.equal(state.protocols[0].steps.length, 1);
  assert.equal(state.protocols[0].steps[0].text, 'Add {{ph:volume}} buffer.');

  assert.equal(state.notebookEntries[0].protocolName, 'Edited Page Copy');
  assert.equal(state.notebookEntries[0].experimentName, 'Edited Page Copy');
  assert.equal(state.notebookEntries[0].protocolSnapshot.name, 'Edited Page Copy');
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps.length, 2);
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps[0].placeholders[0].id, 'volume');
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps[0].placeholders[0].name, 'Sample volume');
  assert.equal(state.notebookEntries[0].values['volume'], '15 mL');
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /Sample volume/);
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /Mix thoroughly\./);
  assert.ok(persistCalls >= 1);
  assert.ok(notebookChangedCalls >= 1);
});
test('biology-notebook saves and reopens multiple result tables with Tabulator', async () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'biology-notebook-add-table-btn',
    'biology-notebook-table-size-overlay',
    'biology-notebook-table-size-form',
    'biology-notebook-table-size-columns',
    'biology-notebook-table-size-rows',
    'biology-notebook-table-size-close-btn',
    'biology-notebook-table-size-cancel-btn',
    'biology-notebook-add-table-row-btn',
    'biology-notebook-add-table-column-btn',
    'biology-notebook-remove-table-btn',
    'biology-notebook-result-table-wrap',
    'biology-notebook-result-table',
    'biology-notebook-result-table-status',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);

  class MockTabulator {
    static instances = [];

    constructor(host, options = {}) {
      this.host = host;
      this.options = { ...options };
      this.data = Array.isArray(options.data) ? options.data.map((row) => ({ ...row })) : [];
      this.columns = Array.isArray(options.columns) ? options.columns.map((column) => ({ ...column })) : [];
      this.events = {};
      MockTabulator.instances.push(this);
    }

    destroy() {
      this.destroyed = true;
    }

    // Rows and columns are added to the live grid rather than by rebuilding the
    // editor, so the mock has to grow the same way a real Tabulator would.
    addRow(row) {
      this.data.push({ ...row });
    }

    addColumn(column) {
      this.columns.push({ ...column });
    }

    setHeight() {}

    getData() {
      return this.data.map((row) => ({ ...row }));
    }

    getColumns() {
      return this.columns.map((column) => ({
        getField: () => column.field,
        getDefinition: () => ({ ...column })
      }));
    }

    on(eventName, handler) {
      this.events[eventName] = handler;
    }
  }

  let persistCalls = 0;
  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' }
    ],
    protocols: [
      {
        id: 'pr1',
        name: 'Expression Readout',
        steps: [
          { text: 'Capture result table.', placeholders: [] }
        ]
      }
    ],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    settings: {
      storagePath: ''
    }
  };

  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'), {
    document,
    window: {
      hikariApi: {},
      Tabulator: MockTabulator
    }
  });
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let index = 0;
      return () => `generated-${index += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions('pr1');

  // Add Table asks for a size before it builds anything.
  trigger(document.getElementById('biology-notebook-add-table-btn'), 'click');
  assert.equal(document.getElementById('biology-notebook-table-size-overlay').hidden, false);
  document.getElementById('biology-notebook-table-size-columns').value = '3';
  document.getElementById('biology-notebook-table-size-rows').value = '3';
  trigger(document.getElementById('biology-notebook-table-size-form'), 'submit');
  assert.equal(document.getElementById('biology-notebook-table-size-overlay').hidden, true);
  assert.equal(document.getElementById('biology-notebook-result-table-wrap').hidden, false);
  assert.equal(document.getElementById('biology-notebook-add-table-btn').hidden, false);

  let tableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  // The header always shows: it carries the A/B/C letters that formulas reference.
  assert.equal(tableInstance.options.headerVisible, true);
  // Column 0 is the row-number gutter. It has no field, so it never reaches the
  // stored table -- the data columns start at index 1.
  assert.equal(tableInstance.columns[0].field, undefined);
  assert.equal(document.getElementById('biology-notebook-result-table-status').textContent, '');
  assert.equal(document.getElementById('biology-notebook-result-table-status').hidden, true);
  const firstField = tableInstance.columns[1].field;
  tableInstance.columns[1].title = 'Sample';
  tableInstance.data[0][firstField] = 'A1';

  trigger(document.getElementById('biology-notebook-add-table-column-btn'), 'click');
  tableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  const lastField = tableInstance.columns[tableInstance.columns.length - 1].field;
  tableInstance.columns[tableInstance.columns.length - 1].title = 'OD600';
  tableInstance.data[0][lastField] = '0.82';

  trigger(document.getElementById('biology-notebook-add-table-row-btn'), 'click');
  tableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  tableInstance.data[tableInstance.data.length - 1][firstField] = 'Control';

  trigger(document.getElementById('biology-notebook-add-table-btn'), 'click');
  trigger(document.getElementById('biology-notebook-table-size-form'), 'submit');
  const secondTableInstance = MockTabulator.instances[MockTabulator.instances.length - 1];
  const secondField = secondTableInstance.columns[1].field;
  secondTableInstance.columns[1].title = 'Condition';
  secondTableInstance.data[0][secondField] = 'Induced';

  document.getElementById('biology-notebook-result').value = 'Measured expression panel.';
  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();

  assert.equal(state.notebookEntries.length, 1);
  assert.equal(state.notebookEntries[0].resultTables.length, 2);
  assert.equal(state.notebookEntries[0].resultTable.columns.length, 4);
  assert.equal(state.notebookEntries[0].resultTable.rows.length, 4);
  assert.equal(state.notebookEntries[0].resultTable.columns[0].title, 'Sample');
  assert.equal(state.notebookEntries[0].resultTable.columns[3].title, 'OD600');
  assert.equal(state.notebookEntries[0].resultTable.rows[0][state.notebookEntries[0].resultTable.columns[0].field], 'A1');
  assert.equal(state.notebookEntries[0].resultTable.rows[0][state.notebookEntries[0].resultTable.columns[3].field], '0.82');
  assert.equal(state.notebookEntries[0].resultTable.rows[3][state.notebookEntries[0].resultTable.columns[0].field], 'Control');
  assert.equal(state.notebookEntries[0].resultTables[1].columns[0].title, 'Condition');
  assert.equal(state.notebookEntries[0].resultTables[1].rows[0][state.notebookEntries[0].resultTables[1].columns[0].field], 'Induced');

  notebook.openEntry(state.notebookEntries[0].id);
  const reopenedTables = MockTabulator.instances.slice(-2);
  assert.equal(reopenedTables.length, 2);
  // Four data columns plus the row-number gutter Tabulator is handed at index 0.
  assert.equal(reopenedTables[0].columns.length, 5);
  assert.equal(reopenedTables[0].columns[0].field, undefined);
  assert.equal(reopenedTables[0].columns[1].title, 'Sample');
  assert.equal(reopenedTables[0].columns[4].title, 'OD600');
  assert.equal(reopenedTables[0].data[0][reopenedTables[0].columns[1].field], 'A1');
  assert.equal(reopenedTables[0].data[0][reopenedTables[0].columns[4].field], '0.82');
  assert.equal(reopenedTables[1].columns[1].title, 'Condition');
  assert.equal(reopenedTables[1].data[0][reopenedTables[1].columns[1].field], 'Induced');
  assert.equal(document.getElementById('biology-notebook-result-table-status').textContent, '');
  assert.equal(document.getElementById('biology-notebook-result-table-status').hidden, true);
  assert.ok(persistCalls >= 1);
});

test('biology-notebook creates a result table from a placeholder variable', () => {
  const document = createMockDocument([
    'biology-notebook-result-table-wrap',
    'biology-notebook-result-table',
    'biology-notebook-result-table-status',
    'biology-notebook-add-table-btn',
    'biology-notebook-table-size-overlay',
    'biology-notebook-table-size-form',
    'biology-notebook-table-size-columns',
    'biology-notebook-table-size-rows',
    'biology-notebook-table-size-close-btn',
    'biology-notebook-table-size-cancel-btn',
    'biology-notebook-add-table-row-btn',
    'biology-notebook-add-table-column-btn',
    'biology-notebook-remove-table-btn'
  ]);

  class MockTabulator {
    static instances = [];

    constructor(host, options = {}) {
      this.host = host;
      this.data = Array.isArray(options.data) ? options.data.map((row) => ({ ...row })) : [];
      this.columns = Array.isArray(options.columns) ? options.columns.map((column) => ({ ...column })) : [];
      MockTabulator.instances.push(this);
    }

    destroy() {}

    addRow(row) {
      this.data.push({ ...row });
    }

    addColumn(column) {
      this.columns.push({ ...column });
    }

    setHeight() {}

    getData() {
      return this.data.map((row) => ({ ...row }));
    }

    getColumns() {
      return this.columns.map((column) => ({
        getField: () => column.field,
        getDefinition: () => ({ ...column })
      }));
    }
  }

  const resultTableModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'spreadsheet-tables', 'index.js'), {});
  const resultTableController = resultTableModule.createSpreadsheetTables({
    host: document.getElementById('biology-notebook-result-table'),
    statusEl: document.getElementById('biology-notebook-result-table-status'),
    wrapEl: document.getElementById('biology-notebook-result-table-wrap'),
    addBtn: document.getElementById('biology-notebook-add-table-btn'),
    addRowBtn: document.getElementById('biology-notebook-add-table-row-btn'),
    addColBtn: document.getElementById('biology-notebook-add-table-column-btn'),
    removeBtn: document.getElementById('biology-notebook-remove-table-btn'),
    createId: (() => {
      let index = 0;
      return () => `placeholder-${index += 1}`;
    })(),
    TabulatorLib: MockTabulator
  });

  resultTableController.onAddFromPlaceholder({
    name: 'Incubation temperature',
    value: '37 °C'
  });

  const table = resultTableController.getCurrentTables()[0];
  assert.equal(table.columns.map((column) => column.title).join('|'), 'Variable|Value');
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0][table.columns[0].field], 'Incubation temperature');
  assert.equal(table.rows[0][table.columns[1].field], '37 °C');
  assert.equal(MockTabulator.instances.length, 1);
});

test('biology-notebook result table repaints edited cells and recomputes formulas', () => {
  const document = createMockDocument([
    'biology-notebook-result-table',
    'biology-notebook-result-table-wrap',
    'biology-notebook-result-table-status',
    'biology-notebook-add-table-btn',
    'biology-notebook-table-size-overlay',
    'biology-notebook-table-size-form',
    'biology-notebook-table-size-columns',
    'biology-notebook-table-size-rows',
    'biology-notebook-table-size-close-btn',
    'biology-notebook-table-size-cancel-btn',
    'biology-notebook-add-table-row-btn',
    'biology-notebook-add-table-column-btn',
    'biology-notebook-remove-table-btn'
  ]);

  // Tabulator 6 only fires callbacks registered with on(); a `cellEdited` passed in the
  // options object is accepted and silently ignored. When that regressed, the formatter
  // kept painting stale values over whatever had just been typed.
  class MockTabulator {
    static instances = [];

    constructor(host, options = {}) {
      this.options = { ...options };
      this.data = Array.isArray(options.data) ? options.data.map((row) => ({ ...row })) : [];
      this.columns = Array.isArray(options.columns) ? options.columns.map((column) => ({ ...column })) : [];
      this.events = {};
      this.reformatted = 0;
      MockTabulator.instances.push(this);
    }

    destroy() {}

    on(eventName, handler) {
      this.events[eventName] = handler;
    }

    getData() {
      return this.data.map((row) => ({ ...row }));
    }

    getColumns() {
      return this.columns.map((column) => ({
        getField: () => column.field,
        getDefinition: () => ({ ...column })
      }));
    }

    getRows() {
      return this.data.map(() => ({ reformat: () => { this.reformatted += 1; } }));
    }

    // Renders one cell exactly the way Tabulator would, so the assertions below see
    // what actually reaches the screen.
    renderCell(rowIndex, columnIndex) {
      const column = this.columns[columnIndex];
      const row = this.data[rowIndex];
      return column.formatter({
        getValue: () => row[column.field],
        getField: () => column.field,
        getRow: () => ({ getData: () => ({ ...row }) })
      }).textContent;
    }
  }

  const resultTableModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'spreadsheet-tables', 'index.js'), { document });
  const controller = resultTableModule.createSpreadsheetTables({
    host: document.getElementById('biology-notebook-result-table'),
    statusEl: document.getElementById('biology-notebook-result-table-status'),
    wrapEl: document.getElementById('biology-notebook-result-table-wrap'),
    addBtn: document.getElementById('biology-notebook-add-table-btn'),
    addRowBtn: document.getElementById('biology-notebook-add-table-row-btn'),
    addColBtn: document.getElementById('biology-notebook-add-table-column-btn'),
    removeBtn: document.getElementById('biology-notebook-remove-table-btn'),
    createId: (() => {
      let index = 0;
      return () => `edit-${index += 1}`;
    })(),
    TabulatorLib: MockTabulator
  });

  controller.onAdd();
  const grid = MockTabulator.instances[MockTabulator.instances.length - 1];
  assert.equal(typeof grid.events.cellEdited, 'function', 'cellEdited must be registered through on()');

  // Column 0 is the row-number gutter, so the first data column is at index 1.
  const firstField = grid.columns[1].field;
  const secondField = grid.columns[2].field;

  grid.data[0][firstField] = '7';
  grid.events.cellEdited();
  assert.equal(grid.renderCell(0, 1), '7', 'a typed value survives the repaint after an edit');

  grid.data[1][firstField] = '5';
  grid.data[0][secondField] = '=A1+A2';
  grid.events.cellEdited();
  assert.equal(grid.renderCell(0, 2), '12', 'a formula computes from the edited cells');

  grid.data[1][firstField] = '13';
  grid.events.cellEdited();
  assert.equal(grid.renderCell(0, 2), '20', 'editing a referenced cell updates the formula that reads it');

  grid.data[0][secondField] = '=A1+';
  grid.events.cellEdited();
  assert.equal(grid.renderCell(0, 2), '#ERROR', 'a broken formula reports instead of guessing');
  assert.equal(document.getElementById('biology-notebook-result-table-status').hidden, false);
});

test('biology-notebook table context menu targets the table that was right-clicked', () => {
  const document = createMockDocument([
    'biology-notebook-result-table',
    'biology-notebook-result-table-wrap',
    'biology-notebook-result-table-status',
    'biology-notebook-add-table-btn',
    'biology-notebook-add-table-row-btn',
    'biology-notebook-add-table-column-btn',
    'biology-notebook-remove-table-btn',
    'biology-notebook-table-context-menu'
  ]);
  const windowRef = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener() {},
    requestAnimationFrame(callback) {
      callback();
    }
  };

  class MockTabulator {
    constructor(host, options = {}) {
      this.data = options.data.map((row) => ({ ...row }));
      this.columns = options.columns.map((column) => ({ ...column }));
    }

    destroy() {}
    on() {}
    addRow(row) { this.data.push({ ...row }); }
    setHeight() {}
    getData() { return this.data.map((row) => ({ ...row })); }
    getColumns() {
      return this.columns.map((column) => ({
        getField: () => column.field,
        getDefinition: () => ({ ...column })
      }));
    }
  }

  const resultTableModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'spreadsheet-tables', 'index.js'),
    { document, window: windowRef }
  );
  const host = document.getElementById('biology-notebook-result-table');
  const menu = document.getElementById('biology-notebook-table-context-menu');
  const controller = resultTableModule.createSpreadsheetTables({
    host,
    statusEl: document.getElementById('biology-notebook-result-table-status'),
    wrapEl: document.getElementById('biology-notebook-result-table-wrap'),
    addBtn: document.getElementById('biology-notebook-add-table-btn'),
    addRowBtn: document.getElementById('biology-notebook-add-table-row-btn'),
    addColBtn: document.getElementById('biology-notebook-add-table-column-btn'),
    removeBtn: document.getElementById('biology-notebook-remove-table-btn'),
    contextMenuEl: menu,
    createId: (() => {
      let index = 0;
      return () => `menu-${index += 1}`;
    })(),
    TabulatorLib: MockTabulator
  });

  controller.onAdd();
  controller.onAdd();
  const before = controller.getCurrentTables().map((table) => table.rows.length);
  const firstTableTarget = {
    dataset: { resultTableEditor: '0' },
    closest(selector) {
      return selector === '[data-result-table-editor]' ? this : null;
    },
    getBoundingClientRect() {
      return { left: 20, top: 30 };
    },
    focus() {}
  };
  let prevented = false;

  trigger(host, 'contextmenu', {
    target: firstTableTarget,
    clientX: 144,
    clientY: 188,
    preventDefault() { prevented = true; }
  });

  assert.equal(prevented, true);
  assert.equal(menu.hidden, false);
  assert.equal(menu.style.left, '144px');
  assert.equal(menu.style.top, '188px');
  const tableEditors = host.querySelectorAll('[data-result-table-editor]');
  assert.equal(tableEditors[0].classList.contains('is-active'), true);
  assert.equal(tableEditors[1].classList.contains('is-active'), false);

  controller.onAddRow();
  const after = controller.getCurrentTables().map((table) => table.rows.length);
  assert.equal(after.join(','), `${before[0] + 1},${before[1]}`);

  trigger(menu, 'click');
  assert.equal(menu.hidden, true);
});

test('biology-notebook placeholder context menu exposes only a plain Add Table action', () => {
  const action = {
    closest(selector) {
      return selector === '[data-placeholder-add-table]' ? action : null;
    }
  };
  const menu = {
    hidden: true,
    style: {},
    listeners: {},
    setAttribute() {},
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    querySelector(selector) {
      return selector === '[data-placeholder-add-table]' ? action : null;
    }
  };
  const document = {
    documentElement: { clientWidth: 800, clientHeight: 600 },
    body: { append() {} },
    createElement() {
      return menu;
    }
  };
  const menuModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'samples', 'sample-link-menu.js'), {});
  let receivedState = null;
  const controller = menuModule.createSampleLinkMenuController({
    doc: document,
    win: { innerWidth: 800, innerHeight: 600 },
    safeText: shared.safeText,
    onAddTable: (state) => { receivedState = state; }
  });
  const wrap = {
    dataset: { placeholderName: 'Incubation temperature' },
    querySelector: () => ({ value: '37 °C' })
  };
  const token = { dataset: { nbKeyRef: 'temperature' } };

  controller.open({ wrap, token, x: 100, y: 100 });
  assert.match(menu.innerHTML, /role="menuitem"[^>]*data-placeholder-add-table[^>]*>[\s\S]*?Add Table[\s\S]*?<\/button>/);
  assert.doesNotMatch(menu.innerHTML, /Placeholder variable|Search samples|data-sample-link-results|ghost-btn|Add table from this variable/i);
  menu.listeners.click({
    target: action,
    preventDefault() {}
  });

  assert.equal(receivedState.key, 'temperature');
  assert.equal(receivedState.placeholderName, 'Incubation temperature');
  assert.equal(receivedState.value, '37 °C');
  assert.equal(menu.hidden, true);
});
test('biology-notebook placeholder editor keeps its chip width on click and grows for long input', () => {
  const listeners = {};
  const stepsHost = {
    addEventListener(type, handler) {
      listeners[type] = handler;
    }
  };
  const hiddenValue = {
    value: '',
    dataset: { nbKey: 'volume' }
  };
  const token = {
    hidden: false,
    dataset: { nbKeyRef: 'volume' },
    getBoundingClientRect: () => ({ width: 61 }),
    closest: (selector) => selector === '[data-inline-placeholder]' ? wrap : null
  };
  const editor = {
    value: '',
    hidden: true,
    dataset: {},
    style: {},
    scrollWidth: 178,
    focus() {},
    select() {},
    closest: (selector) => selector === '[data-inline-placeholder]' ? wrap : null
  };
  const wrap = {
    dataset: { placeholderName: 'volume' },
    querySelector(selector) {
      if (selector === '[data-nb-key]') return hiddenValue;
      if (selector === '[data-inline-token]') return token;
      if (selector === '[data-inline-input]') return editor;
      return null;
    }
  };
  const controllerModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'biology-notebook',
    'protocol',
    'inline-placeholder-controller.js'
  ));
  controllerModule.createInlinePlaceholderController({
    stepsHost,
    getSampleLink: () => null
  }).bindEvents();

  listeners.click({
    target: {
      closest: (selector) => selector === '[data-inline-token]' ? token : null
    }
  });
  assert.equal(editor.style.width, '61px');
  assert.equal(editor.hidden, false);

  editor.value = 'A much longer entered placeholder value';
  listeners.input({
    target: {
      closest: (selector) => selector === '[data-inline-input]' ? editor : null
    }
  });
  assert.equal(editor.style.width, '178px');
});
test('biology-notebook sidebar records bench calculations and inserts readable notes', async () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-page-starter',
    'biology-notebook-page-starter-project',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'biology-notebook-layout',
    'biology-notebook-tool-sidebar',
    'biology-notebook-tool-fold-toggle',
    'biology-notebook-tool-collapse-btn',
    'biology-notebook-tool-workspace',
    'biology-notebook-tool-calculations',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);
  document.querySelector = (selector) => (
    selector === '[data-notebook-tool-sidebar]'
      ? document.getElementById('biology-notebook-tool-sidebar')
      : null
  );

  const state = {
    projects: [
      { id: 'p1', name: 'Atlas' }
    ],
    protocols: [
      {
        id: 'pr1',
        name: 'Bench Prep',
        steps: [
          { text: 'Prepare reaction.', placeholders: [] }
        ]
      }
    ],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    settings: {
      storagePath: ''
    }
  };
  let idIndex = 0;
  const notebookModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'), {
    document,
    window: {
      hikariApi: {}
    }
  });
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {},
    createId: () => `generated-${idIndex += 1}`,
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  notebook.renderProjectOptions();
  notebook.renderProtocolOptions('pr1');

  trigger(document.getElementById('biology-notebook-tool-fold-toggle'), 'click');
  assert.equal(document.getElementById('biology-notebook-tool-fold-toggle').getAttribute('aria-expanded'), 'true');
  trigger(document.getElementById('biology-notebook-tool-tab-buffer'), 'click');
  assert.equal(document.getElementById('biology-notebook-tool-tab-buffer').getAttribute('aria-selected'), 'true');
  assert.equal(document.getElementById('biology-notebook-tool-workspace').hidden, false);
  document.getElementById('biology-notebook-tool-buffer-volume').value = '1';
  document.getElementById('biology-notebook-tool-buffer-volume-unit').value = 'L';
  document.getElementById('biology-notebook-tool-buffer-name-1').value = 'NaCl';
  document.getElementById('biology-notebook-tool-buffer-mw-1').value = '58.44';
  document.getElementById('biology-notebook-tool-buffer-stock-1').value = '';
  document.getElementById('biology-notebook-tool-buffer-final-1').value = '150 mM';
  trigger(document.getElementById('biology-notebook-tool-buffer-final-1'), 'input');
  assert.match(document.getElementById('biology-notebook-tool-buffer-amount-1').placeholder, /8\.766 g/i);
  document.getElementById('biology-notebook-tool-buffer-note-1').value = 'lot 22B, Sigma';
  trigger(document.getElementById('biology-notebook-tool-buffer-note-1'), 'input');

  trigger(document.getElementById('biology-notebook-tool-tab-reaction'), 'click');
  document.getElementById('biology-notebook-tool-reaction-total-volume').value = '100 uL';
  document.getElementById('biology-notebook-tool-reaction-fill-name').value = 'Water';
  document.getElementById('biology-notebook-tool-reaction-name-1').value = 'ATP';
  document.getElementById('biology-notebook-tool-reaction-stock-1').value = '10 mM';
  document.getElementById('biology-notebook-tool-reaction-final-1').value = '1 mM';
  trigger(document.getElementById('biology-notebook-tool-reaction-final-1'), 'input');
  assert.match(document.getElementById('biology-notebook-tool-reaction-volume-1').placeholder, /10 uL/i);
  assert.match(document.getElementById('biology-notebook-tool-reaction-solvent-output').textContent, /90 uL/i);

  // Each tool keeps rewriting the one table it opened, so typing again does not
  // stack a near-identical copy under it.
  document.getElementById('biology-notebook-tool-reaction-stock-1').value = '20 mM';
  trigger(document.getElementById('biology-notebook-tool-reaction-stock-1'), 'input');
  document.getElementById('biology-notebook-tool-reaction-stock-1').value = '10 mM';
  trigger(document.getElementById('biology-notebook-tool-reaction-stock-1'), 'input');

  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();

  assert.equal(state.notebookEntries.length, 1);
  assert.equal(state.notebookEntries[0].toolCalculations.length, 2);
  assert.match(state.notebookEntries[0].toolCalculations[0].result, /NaCl: 8\.766 g/i);
  assert.match(state.notebookEntries[0].toolCalculations[1].result, /Water: 90 uL/i);
  assert.equal(state.notebookEntries[0].toolCalculations[0].table.rows[0][0], 'NaCl');
  assert.match(state.notebookEntries[0].toolCalculations[0].table.rows[0][4], /8\.766 g/i);
  assert.equal(state.notebookEntries[0].toolCalculations[0].table.metaRows[0][1], '1 L');
  assert.deepEqual(Array.from(state.notebookEntries[0].toolCalculations[0].table.headers), ['Chemical', 'MW', 'Stock Conc.', 'Final Conc.', 'Mass/Volume', 'Note']);
  assert.equal(state.notebookEntries[0].toolCalculations[0].table.rows[0][5], 'lot 22B, Sigma');
  assert.deepEqual(Array.from(state.notebookEntries[0].toolCalculations[1].table.headers), ['Item', 'Stock Conc.', 'Final Conc.', 'Volume', 'Note']);
  assert.equal(state.notebookEntries[0].toolCalculations[1].table.rows[0][0], 'ATP');
  assert.equal(state.notebookEntries[0].toolCalculations[1].table.footerRows[0][0], 'Water');
  assert.match(state.notebookEntries[0].toolCalculations[1].table.footerRows[0][3], /90 uL/i);

  notebook.openEntry(state.notebookEntries[0].id);
  // The reaction sheet is still open on this page, so its table is standing
  // aside; closing the tool brings it back.
  const calculationsHost = document.getElementById('biology-notebook-tool-calculations');
  assert.doesNotMatch(calculationsHost.innerHTML, /Fixed Volume Reaction/);
  trigger(document.getElementById('biology-notebook-tool-tab-reaction'), 'click');
  assert.equal(document.getElementById('biology-notebook-tool-workspace').hidden, true);
  const renderedCalculations = calculationsHost.innerHTML;
  assert.match(renderedCalculations, /Buffer Preparer/);
  assert.match(renderedCalculations, /Fixed Volume Reaction/);
  assert.match(renderedCalculations, /biology-notebook-tool-calculation-table/);
  // A recorded calculation is its table and nothing else.
  assert.doesNotMatch(renderedCalculations, /NaCl: 8\.766 g/i);
  assert.doesNotMatch(renderedCalculations, /Water: 90 uL/i);
  assert.doesNotMatch(renderedCalculations, /<p[\s>]/);

  // A recorded reaction is a starting point: its cells are editable, and one
  // edit runs the engine again for every derived volume and the fill.
  assert.match(renderedCalculations, /data-tool-calculation-field="stockConcentration"/);
  assert.match(renderedCalculations, /data-tool-calculation-field="totalVolumeValue"/);
  assert.match(renderedCalculations, /data-tool-calculation-field="note"/);
  const editCell = (field, value) => trigger(calculationsHost, 'change', {
    target: {
      value,
      dataset: {
        toolCalculationId: state.notebookEntries[0].toolCalculations[1].id,
        toolCalculationRow: '0',
        toolCalculationField: field
      }
    }
  });

  editCell('stockConcentration', '20 mM');
  const editedCalculations = calculationsHost.innerHTML;
  assert.match(editedCalculations, /value="20 mM"/);
  assert.match(editedCalculations, /value="5 uL"/);
  assert.match(editedCalculations, /95 uL/);

  // The note column logs what actually went in the tube, and survives the
  // recompute a later edit triggers.
  editCell('note', '48 ng from tube A7');
  editCell('finalConcentration', '2 mM');

  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();
  const editedReaction = state.notebookEntries[0].toolCalculations[1];
  assert.equal(editedReaction.table.rows[0][1], '20 mM');
  assert.match(editedReaction.table.rows[0][3], /10 uL/);
  assert.equal(editedReaction.table.rows[0][4], '48 ng from tube A7');
  assert.match(editedReaction.table.footerRows[0][3], /90 uL/);

  // The trash button on a table takes it off the page.
  assert.match(calculationsHost.innerHTML, /data-tool-calculation-remove="/);
  trigger(calculationsHost, 'click', { target: { dataset: { toolCalculationRemove: editedReaction.id } } });
  assert.doesNotMatch(calculationsHost.innerHTML, /Fixed Volume Reaction/);
  assert.match(calculationsHost.innerHTML, /Buffer Preparer/);
  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();
  assert.equal(state.notebookEntries[0].toolCalculations.length, 1);
  assert.equal(state.notebookEntries[0].toolCalculations[0].table.caption, 'Buffer Preparer');
});
test('biology-notebook bench toolbox builds one table per tab click and reopens any of them', async () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-page-starter',
    'biology-notebook-page-starter-project',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'biology-notebook-layout',
    'biology-notebook-tool-sidebar',
    'biology-notebook-tool-fold-toggle',
    'biology-notebook-tool-collapse-btn',
    'biology-notebook-tool-workspace',
    'biology-notebook-tool-calculations',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);
  document.querySelector = (selector) => (
    selector === '[data-notebook-tool-sidebar]'
      ? document.getElementById('biology-notebook-tool-sidebar')
      : null
  );
  document.getElementById('biology-notebook-tool-reaction-total-volume').value = '100 uL';
  document.getElementById('biology-notebook-tool-reaction-fill-name').value = 'Solvent';

  const state = {
    projects: [{ id: 'p1', name: 'Atlas' }],
    protocols: [{ id: 'pr1', name: 'Bench Prep', steps: [{ text: 'Prepare reactions.', placeholders: [] }] }],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    settings: { storagePath: '' }
  };
  let idIndex = 0;
  const notebookModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'),
    { document, window: { hikariApi: {} } }
  );
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {},
    createId: () => `generated-${idIndex += 1}`,
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  notebook.renderProjectOptions();
  document.getElementById('biology-notebook-project-select').value = 'p1';
  notebook.renderProtocolOptions('pr1');
  document.getElementById('biology-notebook-protocol-select').value = 'pr1';
  notebook.onProtocolChange();

  const calculationsHost = document.getElementById('biology-notebook-tool-calculations');
  const reactionTab = () => trigger(document.getElementById('biology-notebook-tool-tab-reaction'), 'click');
  const fillRow = (row, name, stock, final) => {
    document.getElementById(`biology-notebook-tool-reaction-name-${row}`).value = name;
    document.getElementById(`biology-notebook-tool-reaction-stock-${row}`).value = stock;
    document.getElementById(`biology-notebook-tool-reaction-final-${row}`).value = final;
    trigger(document.getElementById(`biology-notebook-tool-reaction-final-${row}`), 'input');
  };
  // Rows come from the module's own realm, so copy before comparing.
  const reagentsOf = (calculation) => Array.from(calculation.table.rows || []).map((row) => row[0]);

  // Each tab click is a new tube on the bench, not a second view of the last one.
  reactionTab();
  fillRow(1, 'ATP', '10 mM', '1 mM');
  reactionTab();
  reactionTab();
  assert.equal(document.getElementById('biology-notebook-tool-reaction-name-1').value, '');
  fillRow(1, 'GTP', '10 mM', '2 mM');
  reactionTab();

  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();
  const [first, second] = state.notebookEntries[0].toolCalculations;
  assert.equal(state.notebookEntries[0].toolCalculations.length, 2);
  assert.deepEqual(reagentsOf(first), ['ATP']);
  assert.deepEqual(reagentsOf(second), ['GTP']);

  // The edit button puts an earlier table back in the sheet, where it can still
  // gain a row; the other table is left alone.
  trigger(calculationsHost, 'click', { target: { dataset: { toolCalculationEdit: first.id } } });
  assert.equal(document.getElementById('biology-notebook-tool-workspace').hidden, false);
  assert.equal(document.getElementById('biology-notebook-tool-reaction-name-1').value, 'ATP');
  trigger(document.getElementById('biology-notebook-tool-reaction-add-row'), 'click');
  fillRow(2, 'MgCl2', '1 M', '2 mM');
  reactionTab();

  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();
  const saved = state.notebookEntries[0].toolCalculations;
  assert.equal(saved.length, 2);
  assert.deepEqual(reagentsOf(saved.find((item) => item.id === first.id)), ['ATP', 'MgCl2']);
  assert.deepEqual(reagentsOf(saved.find((item) => item.id === second.id)), ['GTP']);
});
test('biology-notebook bench toolbox belongs to the open page, not to every page', async () => {
  const document = createMockDocument([
    'biology-notebook-project-select',
    'biology-notebook-protocol-search',
    'biology-notebook-protocol-select',
    'biology-notebook-page-starter',
    'biology-notebook-page-starter-project',
    'biology-notebook-empty-state',
    'biology-notebook-protocol-area',
    'biology-notebook-protocol-title',
    'biology-notebook-protocol-meta',
    'biology-notebook-export-btn',
    'biology-notebook-mark-executed-btn',
    'biology-notebook-steps',
    'biology-notebook-result',
    'biology-notebook-result-file',
    'biology-notebook-layout',
    'biology-notebook-tool-sidebar',
    'biology-notebook-tool-fold-toggle',
    'biology-notebook-tool-collapse-btn',
    'biology-notebook-tool-workspace',
    'biology-notebook-tool-calculations',
    'save-biology-notebook-btn',
    'cancel-biology-notebook-edit-btn',
    'biology-notebook-entry-list'
  ]);
  document.querySelector = (selector) => (
    selector === '[data-notebook-tool-sidebar]'
      ? document.getElementById('biology-notebook-tool-sidebar')
      : null
  );

  const state = {
    projects: [{ id: 'p1', name: 'Atlas' }],
    protocols: [
      { id: 'pr1', name: 'Bench Prep', steps: [{ text: 'Prepare reaction.', placeholders: [] }] },
      { id: 'pr2', name: 'Other Prep', steps: [{ text: 'Other bench work.', placeholders: [] }] }
    ],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    settings: { storagePath: '' }
  };
  // The markup ships these defaults, and a reset restores what the sheet
  // started as rather than blanking it.
  document.getElementById('biology-notebook-tool-reaction-total-volume').value = '100 uL';
  document.getElementById('biology-notebook-tool-reaction-fill-name').value = 'Solvent';

  let idIndex = 0;
  const notebookModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'index.js'),
    { document, window: { hikariApi: {} } }
  );
  const notebook = notebookModule.initLabNotebook({
    state,
    persist: () => {},
    createId: () => `generated-${idIndex += 1}`,
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  notebook.renderProjectOptions();
  document.getElementById('biology-notebook-project-select').value = 'p1';

  const startPage = (protocolId, notes) => {
    notebook.renderProtocolOptions(protocolId);
    document.getElementById('biology-notebook-protocol-select').value = protocolId;
    notebook.onProtocolChange();
    document.getElementById('biology-notebook-result').value = notes;
  };
  const save = async () => {
    trigger(document.getElementById('save-biology-notebook-btn'), 'click');
    await flushAsync();
  };

  startPage('pr1', 'Page A notes');
  await save();
  startPage('pr2', 'Page B notes');
  await save();
  const [pageA, pageB] = state.notebookEntries;

  notebook.openEntry(pageA.id);
  trigger(document.getElementById('biology-notebook-tool-tab-reaction'), 'click');
  document.getElementById('biology-notebook-tool-reaction-total-volume').value = '100 uL';
  document.getElementById('biology-notebook-tool-reaction-fill-name').value = 'Water';
  document.getElementById('biology-notebook-tool-reaction-name-1').value = 'ATP';
  document.getElementById('biology-notebook-tool-reaction-stock-1').value = '10 mM';
  document.getElementById('biology-notebook-tool-reaction-final-1').value = '1 mM';
  trigger(document.getElementById('biology-notebook-tool-reaction-final-1'), 'input');
  // Half-typed into the other tool, never recorded.
  document.getElementById('biology-notebook-tool-buffer-name-1').value = 'NaCl';
  await save();

  // Saving the page it was built on leaves the sheet alone: the same reaction is
  // still there to tweak and record again.
  assert.equal(document.getElementById('biology-notebook-tool-reaction-name-1').value, 'ATP');

  // Opening another page hands the toolbox over to that page: its sheet, its
  // open panel and its last result all reset, so the previous page's reaction
  // is no longer one "Insert" away from being recorded here.
  notebook.openEntry(pageB.id);
  assert.equal(document.getElementById('biology-notebook-tool-reaction-name-1').value, '');
  assert.equal(document.getElementById('biology-notebook-tool-reaction-fill-name').value, 'Solvent');
  assert.equal(document.getElementById('biology-notebook-tool-reaction-total-volume').value, '100 uL');
  assert.equal(document.getElementById('biology-notebook-tool-buffer-name-1').value, '');
  assert.equal(document.getElementById('biology-notebook-tool-workspace').hidden, true);
  assert.equal(document.getElementById('biology-notebook-tool-calculations').innerHTML, '');

  trigger(document.getElementById('biology-notebook-tool-tab-reaction'), 'click');
  document.getElementById('biology-notebook-tool-reaction-name-1').value = 'GTP';
  document.getElementById('biology-notebook-tool-reaction-stock-1').value = '10 mM';
  document.getElementById('biology-notebook-tool-reaction-final-1').value = '2 mM';
  trigger(document.getElementById('biology-notebook-tool-reaction-final-1'), 'input');
  await save();

  const savedA = state.notebookEntries.find((entry) => entry.id === pageA.id);
  const savedB = state.notebookEntries.find((entry) => entry.id === pageB.id);
  assert.equal(savedA.toolCalculations.length, 1);
  assert.equal(savedA.toolCalculations[0].table.rows[0][0], 'ATP');
  assert.equal(savedB.toolCalculations.length, 1);
  assert.equal(savedB.toolCalculations[0].table.rows[0][0], 'GTP');
  assert.doesNotMatch(savedB.result, /ATP/);
});
test('biology-notebook folded toolbox icon drags within the workspace without opening', () => {
  const document = createMockDocument([
    'biology-notebook-layout',
    'biology-notebook-tool-sidebar',
    'biology-notebook-tool-fold-toggle',
    'biology-notebook-tool-collapse-btn'
  ]);
  const layout = document.getElementById('biology-notebook-layout');
  const sidebar = document.getElementById('biology-notebook-tool-sidebar');
  const foldToggle = document.getElementById('biology-notebook-tool-fold-toggle');
  const windowListeners = new Map();
  const windowRef = {
    addEventListener(type, handler) {
      const handlers = windowListeners.get(type) || [];
      handlers.push(handler);
      windowListeners.set(type, handlers);
    },
    dispatch(type, event) {
      (windowListeners.get(type) || []).forEach((handler) => handler(event));
    }
  };

  layout.classList.add('is-tool-sidebar-collapsed');
  layout.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 });
  sidebar.getBoundingClientRect = () => {
    const left = Number.parseFloat(sidebar.style.left) || 850;
    const top = Number.parseFloat(sidebar.style.top) || 72;
    const size = layout.classList.contains('is-tool-sidebar-open') ? 132 : 42;
    return { left, top, right: left + size, bottom: top + size, width: size, height: size };
  };
  foldToggle.setPointerCapture = () => {};
  foldToggle.releasePointerCapture = () => {};
  document.querySelector = (selector) => (
    selector === '[data-notebook-tool-sidebar]' ? sidebar : null
  );

  const toolModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'biology-notebook',
    'tools',
    'tool-sidebar.js'
  ));
  toolModule.createNotebookToolSidebarController({
    doc: document,
    win: windowRef,
    safeText: (value) => String(value ?? ''),
    createId: () => 'tool-record'
  });

  trigger(foldToggle, 'pointerdown', { button: 0, pointerId: 7, clientX: 871, clientY: 93 });
  windowRef.dispatch('pointermove', { pointerId: 7, clientX: 621, clientY: 213, preventDefault() {} });
  windowRef.dispatch('pointerup', { pointerId: 7 });

  assert.equal(sidebar.style.left, '600px');
  assert.equal(sidebar.style.top, '192px');
  assert.equal(sidebar.dataset.notebookToolboxMoved, 'true');
  trigger(foldToggle, 'click');
  assert.equal(layout.classList.contains('is-tool-sidebar-collapsed'), true);

  trigger(foldToggle, 'pointerdown', { button: 0, pointerId: 8, clientX: 621, clientY: 213 });
  windowRef.dispatch('pointerup', { pointerId: 8 });
  trigger(foldToggle, 'click');
  assert.equal(layout.classList.contains('is-tool-sidebar-open'), true);
  assert.equal(sidebar.dataset.toolboxExpandX, 'right');
  assert.equal(sidebar.dataset.toolboxExpandY, 'down');

  trigger(document.getElementById('biology-notebook-tool-collapse-btn'), 'click');
  trigger(foldToggle, 'pointerdown', { button: 0, pointerId: 9, clientX: 621, clientY: 213 });
  windowRef.dispatch('pointermove', { pointerId: 9, clientX: 1200, clientY: 900, preventDefault() {} });
  windowRef.dispatch('pointerup', { pointerId: 9 });
  assert.equal(sidebar.style.left, '958px');
  assert.equal(sidebar.style.top, '658px');
  trigger(foldToggle, 'click');
  trigger(foldToggle, 'pointerdown', { button: 0, pointerId: 10, clientX: 979, clientY: 679 });
  windowRef.dispatch('pointerup', { pointerId: 10 });
  trigger(foldToggle, 'click');
  assert.equal(sidebar.dataset.toolboxExpandX, 'left');
  assert.equal(sidebar.dataset.toolboxExpandY, 'up');
  assert.equal(sidebar.style.left, '868px');
  assert.equal(sidebar.style.top, '568px');
});
test('biology-notebook toolbox starts without a sticky tool highlight and clears stale selection', () => {
  const document = createMockDocument([
    'biology-notebook-layout',
    'biology-notebook-tool-sidebar',
    'biology-notebook-tool-fold-toggle',
    'biology-notebook-tool-collapse-btn',
    'biology-notebook-tool-workspace',
    'biology-notebook-tool-tab-buffer',
    'biology-notebook-tool-tab-reaction',
    'biology-notebook-tool-panel-buffer',
    'biology-notebook-tool-panel-reaction'
  ]);
  const sidebar = document.getElementById('biology-notebook-tool-sidebar');
  const workspace = document.getElementById('biology-notebook-tool-workspace');
  document.querySelector = (selector) => (
    selector === '[data-notebook-tool-sidebar]' ? sidebar : null
  );
  sidebar.querySelector = () => null;

  const toolModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'biology-notebook',
    'tools',
    'tool-sidebar.js'
  ));
  const controller = toolModule.createNotebookToolSidebarController({
    doc: document,
    win: { addEventListener() {} },
    safeText: (value) => String(value ?? ''),
    createId: () => 'tool-record'
  });
  const bufferTab = document.getElementById('biology-notebook-tool-tab-buffer');
  const reactionTab = document.getElementById('biology-notebook-tool-tab-reaction');

  assert.equal(bufferTab.classList.contains('is-active'), false);
  assert.equal(reactionTab.classList.contains('is-active'), false);

  trigger(bufferTab, 'click');
  assert.equal(bufferTab.classList.contains('is-active'), true);
  assert.equal(bufferTab.getAttribute('aria-selected'), 'true');

  controller.clearSelection();
  assert.equal(bufferTab.classList.contains('is-active'), false);
  assert.equal(reactionTab.classList.contains('is-active'), false);
  assert.equal(bufferTab.getAttribute('aria-selected'), 'false');
  assert.equal(workspace.hidden, true);
});
};
