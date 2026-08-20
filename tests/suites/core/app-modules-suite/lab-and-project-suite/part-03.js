module.exports = function registerAppLabAndProjectSuitePart03(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
            id: 'step-live',
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
              id: 'step-saved',
              text: 'Stored notebook step with {{ph:volume}}.',
              placeholders: [
                { id: 'volume', name: 'Volume' }
              ]
            }
          ]
        },
        values: {
          'step-saved:volume': '15 mL'
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
  assert.match(document.getElementById('biology-notebook-steps').innerHTML, /data-nb-key-ref="step-saved:volume"/);
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
});
test('biology-notebook page naming uses a small model once and skips generated or user-renamed names', async () => {
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
  const protocolSnapshot = {
    id: 'protocol-1',
    name: 'Transformation',
    steps: [
      {
        id: 'step-1',
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
          'step-1:dna': 'pET28a-GFP',
          'step-1:medium': 'SOC'
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
          'step-1:dna': 'pET28a-GFP',
          'step-1:medium': 'SOC'
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
  assert.equal(directCalls[0].llm.model, 'gpt-5.4-mini');
  assert.equal(directCalls[0].llm.reasoningEffort, 'low');
  assert.equal(directCalls[0].maxOutputTokens, 40);
  assert.equal(state.notebookEntries[0].experimentName, 'pET28a GFP SOC Transformation');
  assert.equal(state.notebookEntries[0].experimentNameSource, 'generated');
  assert.ok(state.notebookEntries[0].experimentNameGeneratedAt);
  assert.equal(state.notebookEntries[0].experimentNameGeneratedModel, 'gpt-5.4-mini');
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
      'step-1:dna': 'pET28a-GFP',
      'step-1:medium': 'SOC'
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
        id: 'step-1',
        placeholders: [
          { id: 'temperature', name: 'Temperature' },
          { id: 'duration', name: 'Duration' }
        ]
      }
    ]
  };

  assert.equal(namingModule.areAllNotebookPlaceholdersFilled(protocol, {
    'step-1:temperature': '18 C',
    'step-1:duration': '16 h'
  }), true);
  assert.equal(namingModule.areAllNotebookPlaceholdersFilled(protocol, {
    'step-1:temperature': '18 C',
    'step-1:duration': '   '
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
    'biology-notebook-view.css'
  ), 'utf8');
  assert.match(notebookCss, /\.biology-notebook-attachment-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(180px,\s*320px\)\)/s);
  assert.match(notebookCss, /\.biology-notebook-attachment-image\s*\{[^}]*width:\s*fit-content[^}]*border:\s*0/s);
  assert.match(notebookCss, /\.biology-notebook-attachment-image img\s*\{[^}]*width:\s*auto[^}]*height:\s*auto[^}]*max-height:\s*260px[^}]*border:\s*0/s);
  assert.doesNotMatch(notebookCss, /\.biology-notebook-attachment-image img\s*\{[^}]*height:\s*clamp\(/s);
});
test('biology-notebook page metadata omits redundant result file and table summaries', () => {
  const viewerModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'biology-notebook',
    'entry',
    'viewer-renderer.js'
  ));
  const meta = viewerModule.buildViewerMeta({
    projects: [{ id: 'project-1', name: 'Atlas' }],
    entry: {
      id: 'entry-1',
      projectId: 'project-1',
      projectName: 'Atlas',
      protocolName: 'Binding assay',
      experimentName: 'Binding assay',
      notebookState: 'executed',
      updatedAt: '2026-07-24T12:00:00.000Z',
      resultFiles: ['VennR4.png'],
      resultTables: [{
        columns: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
        rows: [{}, {}, {}]
      }],
      toolCalculations: [{
        id: 'calculation-1',
        type: 'molarity',
        title: 'Molarity',
        result: 'Mass needed: 5 mg'
      }],
      sampleLinks: [{ sampleId: 'sample-1' }]
    },
    isSavedEntry: true
  });
  assert.doesNotMatch(meta, /Result files:/);
  assert.doesNotMatch(meta, /Result table:/);
  assert.match(meta, /Tool calculations: 1 calculation \(Molarity\)\./);
  assert.match(meta, /Linked samples: 1\./);
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
    'biology-notebook-view.css'
  ), 'utf8');
  assert.match(html, /class="biology-notebook-notes-field"[\s\S]*?for="biology-notebook-result"[\s\S]*?class="biology-notebook-notes-composer"[\s\S]*?id="biology-notebook-result"[\s\S]*?id="clarify-save-biology-notebook-btn"/);
  assert.match(html, /<label for="biology-notebook-result">Notes<\/label>/);
  assert.doesNotMatch(html, /class="form-actions"[\s\S]*?id="clarify-save-biology-notebook-btn"/);
  assert.match(css, /\.biology-notebook-linked-toolbar:not\(:has\(> button:not\(\[hidden\]\)\)\),[\s\S]*?\.biology-notebook-linked-results:empty,[\s\S]*?\.biology-notebook-tool-calculations:empty\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /\.biology-notebook-notes-composer\s*\{[^}]*position:\s*relative;/s);
  assert.match(css, /\.biology-notebook-notes-composer textarea\s*\{[^}]*padding:\s*10px\s+12px\s+50px;/s);
  assert.match(css, /\.biology-notebook-notes-clarify-btn\s*\{[^}]*position:\s*absolute;[^}]*right:\s*8px;[^}]*bottom:\s*8px;/s);
});
test('biology-notebook buffer preparer floats one autocomplete menu and appends ingredients beyond its starter rows', () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'biology-notebook',
    'tools',
    'tool-sidebar.js'
  ), 'utf8');
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
    'biology-notebook-view.css'
  ), 'utf8');
  assert.match(source, /const INITIAL_BUFFER_ROW_COUNT = 6;/);
  assert.match(source, /function closeOtherBufferSuggestions\(activeIndex\)/);
  assert.match(source, /function renderBufferSuggestions\(index\)[\s\S]*?closeOtherBufferSuggestions\(index\)[\s\S]*?positionBufferSuggestions\(index\);/);
  assert.match(source, /function appendBufferRow\(\)[\s\S]*?bufferRowTotal = index;[\s\S]*?bindBufferRow\(index\);/);
  assert.match(source, /function insertBufferRowBeforeAddRow\(row\)[\s\S]*?biology-notebook-tool-buffer-add-row-anchor/);
  assert.doesNotMatch(source, /revealNextRow\('biology-notebook-tool-buffer-row'/);
  assert.match(source, /addListener\(doc, 'scroll', repositionOpenBufferSuggestions, true\);/);
  assert.match(html, /<tbody id="biology-notebook-tool-buffer-rows">/);
  assert.match(html, /id="biology-notebook-tool-buffer-add-row-anchor"[\s\S]*?id="biology-notebook-tool-buffer-add-row"[\s\S]*?>\+<\/button>/);
  assert.match(html, /id="biology-notebook-tool-buffer-adjustment-row"/);
  assert.match(css, /\.biology-notebook-buffer-suggestions--floating\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*120;/s);
});
test('biology-notebook buffer preparer starts blank, has one insert-and-record action, and exposes compound pKa data', () => {
  const html = fs.readFileSync(path.join(__dirname, 'ui', 'html', 'views', 'biology-notebook-view.html'), 'utf8');
  const toolSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'tools', 'tool-sidebar.js'), 'utf8');
  const compounds = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'lib', 'chemistry', 'buffer-compounds.js'), 'utf8');
  const calculations = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'lib', 'bench-calculations.js'), 'utf8');
  const bufferSection = html.slice(
    html.indexOf('id="biology-notebook-tool-panel-buffer"'),
    html.indexOf('id="biology-notebook-tool-panel-reaction"')
  );
  assert.doesNotMatch(bufferSection, /value="100"|placeholder="(?:Tris Base|NaCl|Tween 20|Ingredient|MW|empty or 1 M|2000x|50 mM|150 mM|10% v\/v|0\.1% v\/v|stock|final|7\.4)"/);
  assert.match(html, /id="biology-notebook-tool-insert-notes-btn"[^>]*>Insert &amp; Record<\/button>/);
  assert.doesNotMatch(html, /biology-notebook-tool-use-placeholder-btn|biology-notebook-tool-record-btn/);
  assert.doesNotMatch(toolSource, /stepsHost|useForActivePlaceholder|recordBtn|usePlaceholderBtn/);
  assert.match(compounds, /name: 'Bis-Tris',[^\n]*pKa: 6\.5/);
  assert.match(compounds, /name: 'CAPS',[^\n]*pKa: 10\.4/);
  assert.match(calculations, /const compound = resolveBufferCompound\(source\);[\s\S]*?return \{ pKa, label: compound\.name \};/);
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
            id: 'step-saved',
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
              id: 'step-saved',
              text: 'Add {{ph:volume}} buffer.',
              placeholders: [
                { id: 'volume', name: 'Volume' }
              ]
            }
          ]
        },
        values: {
          'step-saved:volume': '15 mL'
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
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps[0].id, 'step-saved');
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps[0].placeholders[0].id, 'volume');
  assert.equal(state.notebookEntries[0].protocolSnapshot.steps[0].placeholders[0].name, 'Sample volume');
  assert.equal(state.notebookEntries[0].values['step-saved:volume'], '15 mL');
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
          { id: 's1', text: 'Capture result table.', placeholders: [] }
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

  trigger(document.getElementById('biology-notebook-add-table-btn'), 'click');
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

  const resultTableModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'results', 'result-table-controller.js'), {});
  const resultTableController = resultTableModule.createResultTableController({
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

  const resultTableModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'biology-notebook', 'results', 'result-table-controller.js'), { document });
  const controller = resultTableModule.createResultTableController({
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
  const token = { dataset: { nbKeyRef: 'step-1:temperature' } };

  controller.open({ wrap, token, x: 100, y: 100 });
  assert.match(menu.innerHTML, /role="menuitem"[^>]*data-placeholder-add-table[^>]*>[\s\S]*?Add Table[\s\S]*?<\/button>/);
  assert.doesNotMatch(menu.innerHTML, /Placeholder variable|Search samples|data-sample-link-results|ghost-btn|Add table from this variable/i);
  menu.listeners.click({
    target: action,
    preventDefault() {}
  });

  assert.equal(receivedState.key, 'step-1:temperature');
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
    dataset: { nbKey: 'step-1:volume' }
  };
  const token = {
    hidden: false,
    dataset: { nbKeyRef: 'step-1:volume' },
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
          { id: 's1', text: 'Prepare reaction.', placeholders: [] }
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

  document.getElementById('biology-notebook-tool-mass-concentration').value = '10';
  document.getElementById('biology-notebook-tool-mass-concentration-unit').value = 'mM';
  document.getElementById('biology-notebook-tool-mass-mw').value = '58.44';
  document.getElementById('biology-notebook-tool-mass-volume').value = '1';
  document.getElementById('biology-notebook-tool-mass-volume-unit').value = 'L';
  trigger(document.getElementById('biology-notebook-tool-mass-volume'), 'input');
  trigger(document.getElementById('biology-notebook-tool-insert-notes-btn'), 'click');

  trigger(document.getElementById('biology-notebook-tool-fold-toggle'), 'click');
  assert.equal(document.getElementById('biology-notebook-tool-fold-toggle').getAttribute('aria-expanded'), 'true');
  trigger(document.getElementById('biology-notebook-tool-tab-buffer'), 'click');
  assert.equal(document.getElementById('biology-notebook-tool-tab-buffer').getAttribute('aria-selected'), 'true');
  assert.equal(document.getElementById('biology-notebook-tool-workspace').hidden, false);
  document.getElementById('biology-notebook-tool-buffer-volume').value = '1000';
  document.getElementById('biology-notebook-tool-buffer-name-1').value = 'NaCl';
  document.getElementById('biology-notebook-tool-buffer-mw-1').value = '58.44';
  document.getElementById('biology-notebook-tool-buffer-stock-1').value = '';
  document.getElementById('biology-notebook-tool-buffer-final-1').value = '150 mM';
  trigger(document.getElementById('biology-notebook-tool-buffer-final-1'), 'input');
  assert.match(document.getElementById('biology-notebook-tool-buffer-output-1').textContent, /8766 mg/i);
  trigger(document.getElementById('biology-notebook-tool-insert-notes-btn'), 'click');

  trigger(document.getElementById('biology-notebook-tool-tab-reaction'), 'click');
  document.getElementById('biology-notebook-tool-reaction-total-volume').value = '100 uL';
  document.getElementById('biology-notebook-tool-reaction-fill-name').value = 'Water';
  document.getElementById('biology-notebook-tool-reaction-name-1').value = 'ATP';
  document.getElementById('biology-notebook-tool-reaction-stock-1').value = '10 mM';
  document.getElementById('biology-notebook-tool-reaction-final-1').value = '1 mM';
  trigger(document.getElementById('biology-notebook-tool-reaction-final-1'), 'input');
  assert.match(document.getElementById('biology-notebook-tool-reaction-output-1').textContent, /10 uL/i);
  assert.match(document.getElementById('biology-notebook-tool-reaction-solvent-output').textContent, /90 uL/i);
  trigger(document.getElementById('biology-notebook-tool-insert-notes-btn'), 'click');

  trigger(document.getElementById('save-biology-notebook-btn'), 'click');
  await flushAsync();

  assert.equal(state.notebookEntries.length, 1);
  assert.equal(state.notebookEntries[0].toolCalculations.length, 3);
  assert.match(state.notebookEntries[0].result, /Molarity - Mass: Mass needed: 584\.4 mg/i);
  assert.match(state.notebookEntries[0].toolCalculations[1].result, /NaCl: 8766 mg/i);
  assert.match(state.notebookEntries[0].toolCalculations[2].result, /Water: 90 uL/i);
  assert.deepEqual(Array.from(state.notebookEntries[0].toolCalculations[1].table.headers), ['Chemical', 'MW', 'Stock Conc.', 'Final Conc.', 'Mass/Volume']);
  assert.equal(state.notebookEntries[0].toolCalculations[1].table.rows[0][0], 'NaCl');
  assert.match(state.notebookEntries[0].toolCalculations[1].table.rows[0][4], /8766 mg/i);
  assert.deepEqual(Array.from(state.notebookEntries[0].toolCalculations[2].table.headers), ['Item', 'Stock Conc.', 'Final Conc.', 'Volume']);
  assert.equal(state.notebookEntries[0].toolCalculations[2].table.rows[0][0], 'ATP');
  assert.equal(state.notebookEntries[0].toolCalculations[2].table.footerRows[0][0], 'Water');
  assert.match(state.notebookEntries[0].toolCalculations[2].table.footerRows[0][3], /90 uL/i);

  notebook.openEntry(state.notebookEntries[0].id);
  const renderedCalculations = document.getElementById('biology-notebook-tool-calculations').innerHTML;
  assert.match(renderedCalculations, /Molarity - Mass/);
  assert.match(renderedCalculations, /Buffer Preparer/);
  assert.match(renderedCalculations, /Fixed Volume Reaction/);
  assert.match(renderedCalculations, /biology-notebook-tool-calculation-table/);
  assert.doesNotMatch(renderedCalculations, /NaCl: 8766 mg/i);
  assert.doesNotMatch(renderedCalculations, /Water: 90 uL/i);
  assert.match(document.getElementById('biology-notebook-protocol-meta').textContent, /Tool calculations: 3 calculations/i);
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
    'biology-notebook-tool-tab-molarity',
    'biology-notebook-tool-tab-buffer',
    'biology-notebook-tool-tab-reaction',
    'biology-notebook-tool-panel-molarity',
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
  const molarityTab = document.getElementById('biology-notebook-tool-tab-molarity');
  const bufferTab = document.getElementById('biology-notebook-tool-tab-buffer');
  const reactionTab = document.getElementById('biology-notebook-tool-tab-reaction');

  assert.equal(molarityTab.classList.contains('is-active'), false);
  assert.equal(bufferTab.classList.contains('is-active'), false);
  assert.equal(reactionTab.classList.contains('is-active'), false);

  trigger(bufferTab, 'click');
  assert.equal(molarityTab.classList.contains('is-active'), false);
  assert.equal(bufferTab.classList.contains('is-active'), true);
  assert.equal(bufferTab.getAttribute('aria-selected'), 'true');

  controller.clearSelection();
  assert.equal(molarityTab.classList.contains('is-active'), false);
  assert.equal(bufferTab.classList.contains('is-active'), false);
  assert.equal(reactionTab.classList.contains('is-active'), false);
  assert.equal(bufferTab.getAttribute('aria-selected'), 'false');
  assert.equal(workspace.hidden, true);
});
  }
};
