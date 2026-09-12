module.exports = function registerAppPapersSuitePdfViewerHighlightsAndSearch(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const readPapersCss = () => [
    'layout-and-library.css',
    'viewer-and-annotations.css',
    'comments-and-responsive.css'
  ].map((fileName) => scope.fs.readFileSync(scope.path.join(
    __dirname,
    'ui',
    'css',
    'views',
    'papers-view',
    fileName
  ), 'utf8')).join('\n');
  with (scope) {
test('paper storage treats literature-search collections like journal-club folders', () => {
  const storageModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'papers',
    'storage.js'
  ));
  assert.equal(
    storageModule.buildPaperStorageFolder({
      rootPath: '/tmp/hikari-storage',
      linkedType: 'literature_search',
      linkedName: 'MAPK resistance mechanisms'
    }),
    '/tmp/hikari-storage/Papers/MAPK_resistance_mechanisms'
  );
  assert.equal(
    storageModule.buildPaperStorageFolder({
      rootPath: '/tmp/hikari-storage',
      linkedType: 'project',
      linkedName: 'Atlas'
    }),
    '/tmp/hikari-storage/Project/Atlas/Papers'
  );
});
function buildFakePapersViewerFactory() {
  const controller = {
    activePaperId: '',
    currentPageNumber: 1,
    comments: [],
    highlights: [],
    selectedCommentId: '',
    placementMode: false,
    metadataOnOpen: null,
    callbacks: {}
  };

  return {
    controller,
    create(elements = {}) {
      controller.callbacks = {
        onPageChange: elements.onPageChange,
        onPlacement: elements.onPlacement,
        onPinSelect: elements.onPinSelect,
        onHighlightSelection: elements.onHighlightSelection,
        onSelectionSearch: elements.onSelectionSearch,
        onMetadataResolved: elements.onMetadataResolved,
        onClose: elements.onClose
      };
      return {
        async openPaper({ paper }) {
          controller.activePaperId = paper.id;
          controller.currentPageNumber = 1;
          await Promise.resolve(controller.callbacks.onMetadataResolved?.({
            paperId: paper.id,
            metadata: controller.metadataOnOpen
          }));
          controller.callbacks.onPageChange?.(1);
          return true;
        },
        async resetViewer() {
          controller.activePaperId = '';
          controller.currentPageNumber = 1;
          controller.callbacks.onClose?.();
          return true;
        },
        getActivePaperId() {
          return controller.activePaperId;
        },
        getCurrentPageNumber() {
          return controller.currentPageNumber;
        },
        hasActiveDocument() {
          return Boolean(controller.activePaperId);
        },
        setComments(comments) {
          controller.comments = Array.isArray(comments) ? comments.slice() : [];
        },
        setHighlights(highlights) {
          controller.highlights = Array.isArray(highlights) ? highlights.slice() : [];
        },
        setSelectedCommentId(commentId) {
          controller.selectedCommentId = String(commentId || '');
        },
        setPlacementMode(enabled) {
          controller.placementMode = Boolean(enabled) && Boolean(controller.activePaperId);
        }
      };
    },
    emitPlacement(payload) {
      controller.callbacks.onPlacement?.(payload);
    },
    emitPageChange(pageNumber) {
      controller.currentPageNumber = pageNumber;
      controller.callbacks.onPageChange?.(pageNumber);
    },
    emitMetadata(payload) {
      controller.callbacks.onMetadataResolved?.(payload);
    },
    selectPin(comment) {
      controller.callbacks.onPinSelect?.(comment);
    }
  };
}

function buildPapersManagementHarness({ comments = [], promptResponses = [], confirmResult = true } = {}) {
  const ids = [
    'papers-layout',
    'papers-right-column',
    'paper-form',
    'paper-title',
    'paper-pdf',
    'paper-link-type',
    'paper-link-target',
    'paper-upload-trigger',
    'paper-list',
    'papers-library-rail',
    'papers-library-context-menu',
    'papers-context-new-folder',
    'papers-context-rename-folder',
    'papers-context-delete-folder',
    'paper-folder-selection',
    'paper-upload-target-label',
    'paper-viewer-shell',
    'paper-viewer-empty',
    'paper-viewer-workspace',
    'paper-viewer-stage',
    'paper-viewer-page-layer',
    'paper-viewer-canvas',
    'paper-viewer-overlay',
    'paper-viewer-title',
    'paper-viewer-meta',
    'paper-viewer-status',
    'paper-viewer-toolbar',
    'paper-viewer-prev-btn',
    'paper-viewer-next-btn',
    'paper-viewer-page-input',
    'paper-viewer-page-count',
    'paper-viewer-zoom-out-btn',
    'paper-viewer-zoom-in-btn',
    'paper-viewer-zoom-reset-btn',
    'paper-viewer-fit-width-btn',
    'paper-viewer-highlight-btn',
    'paper-viewer-summarize-btn',
    'paper-viewer-zoom-label',
    'paper-selection-menu',
    'paper-selection-comment-btn',
    'paper-selection-highlight-btn',
    'paper-selection-underline-btn',
    'paper-selection-search-btn',
    'paper-selection-ask-btn',
    'paper-selection-copy-btn',
    'paper-selection-search-popover',
    'paper-selection-search-pdf-btn',
    'paper-selection-search-library-btn',
    'paper-selection-search-nav',
    'paper-selection-search-prev-btn',
    'paper-selection-search-next-btn',
    'paper-selection-search-count',
    'paper-selection-search-results',
    'paper-selection-comment-popover',
    'paper-selection-comment-text',
    'paper-selection-comment-save-btn',
    'paper-selection-comment-cancel-btn',
    'paper-highlight-comment-popover',
    'paper-comment-panel',
    'paper-comment-toggle-btn',
    'paper-comment-sidebar',
    'paper-details-sidebar',
    'paper-details-toggle-btn',
    'paper-summary-section',
    'paper-summary-toggle-btn',
    'paper-summary-content',
    'paper-summary-list',
    'paper-comment-page',
    'paper-comment-count',
    'paper-comment-add-btn',
    'paper-comment-save-btn',
    'paper-comment-cancel-btn',
    'paper-comment-delete-btn',
    'paper-comment-text',
    'paper-comment-status',
    'paper-comment-list',
    'journal-club-list'
  ];
  const document = createMockDocument(ids);
  const paperForm = document.getElementById('paper-form');
  const paperTitle = document.getElementById('paper-title');
  const paperPdf = document.getElementById('paper-pdf');
  const paperLinkType = document.getElementById('paper-link-type');
  wireFormReset(paperForm, [paperTitle, paperPdf]);
  paperLinkType.value = 'project';

  const viewerFactory = buildFakePapersViewerFactory();
  let persistCalls = 0;
  let idCounter = 0;
  const promptQueue = promptResponses.slice();
  const state = {
    journalClubs: [],
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    papers: [
      {
        id: 'paper-1',
        title: 'Atlas Uploaded Paper',
        fileName: 'atlas.pdf',
        linkedType: 'project',
        linkedId: 'p1',
        linkedName: 'Cancer Study',
        summary: 'Paper summary text.',
        summaryStatus: 'idle',
        methodsExtract: [],
        methodsStatus: 'idle',
        keyReagents: [],
        reagentsStatus: 'idle',
        keyFigures: [],
        comments: comments.slice(),
        highlights: [],
        deepReadReady: false,
        availabilityStatus: 'uploaded_pdf',
        ingestionStatus: 'ready',
        ingestionUpdatedAt: '2026-02-01T00:00:00.000Z',
        ingestionErrors: [],
        updatedAt: '2026-02-01T00:00:00.000Z',
        pdfDataUrl: 'data:application/pdf;base64,AAAA'
      }
    ],
    notebookEntries: [],
    protocols: [],
    paperExperimentLinks: [],
    knowledgeChats: {},
    settings: {
      personalInfo: {
        name: 'Alice Scientist',
        hikariEmail: 'alice@hikari.test'
      },
      llm: {}
    }
  };
  const window = {
    alert() {},
    hikariApi: {},
    prompt() {
      return promptQueue.length ? promptQueue.shift() : '';
    },
    confirm() {
      return confirmResult;
    }
  };
  const papersModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'index.js'), {
    document,
    window
  });
  const papers = papersModule.initPapersManagement({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: () => `comment-${idCounter += 1}`,
    safeText: shared.safeText,
    onCreateProtocolDraft: () => {},
    createPdfViewer: (elements) => viewerFactory.create(elements)
  });
  papers.render();

  return {
    document,
    state,
    papers,
    viewerFactory,
    get persistCalls() {
      return persistCalls;
    }
  };
}

async function openPaperInHarness(harness) {
  const journalClubList = harness.document.getElementById('journal-club-list');
  trigger(journalClubList, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-paper-view]') {
          return {
            dataset: {
              paperView: 'paper-1'
            }
          };
        }
        return null;
      }
    }
  });
  await flushAsync();
  await flushAsync();
}
test('papers module syncs stored highlights into the PDF viewer when a paper opens', async () => {
  const harness = buildPapersManagementHarness();
  harness.state.papers[0].highlights = [
    {
      id: 'highlight-1',
      pageNumber: 1,
      text: 'Important selected sentence',
      boxes: [
        { x: 0.1, y: 0.2, width: 0.3, height: 0.04 }
      ],
      createdAt: '2026-03-22T18:00:00.000Z',
      updatedAt: '2026-03-22T18:00:00.000Z'
    }
  ];

  await openPaperInHarness(harness);

  assert.equal(harness.viewerFactory.controller.highlights.length, 1);
  assert.equal(harness.viewerFactory.controller.highlights[0].id, 'highlight-1');
});
test('papers module stores highlight selections with PDF-style quad points', async () => {
  const harness = buildPapersManagementHarness();

  await openPaperInHarness(harness);
  const didCreateHighlight = harness.viewerFactory.controller.callbacks.onHighlightSelection({
    pageNumber: 1,
    text: 'Important selected sentence',
    boxes: [
      { x: 0.1, y: 0.2, width: 0.3, height: 0.04 }
    ],
    pageWidth: 600,
    pageHeight: 800
  });

  assert.equal(didCreateHighlight, true);
  assert.equal(harness.state.papers[0].highlights.length, 1);
  const highlight = harness.state.papers[0].highlights[0];
  assert.equal(highlight.pageWidth, 600);
  assert.equal(highlight.pageHeight, 800);
  assert.deepEqual(Array.from(highlight.quadPoints), [60, 640, 240, 640, 60, 608, 240, 608]);
  assert.deepEqual(
    Array.from(harness.viewerFactory.controller.highlights[0].quadPoints),
    Array.from(highlight.quadPoints)
  );
});
test('papers highlight normalizer derives boxes from stored quad points', () => {
  const normalizersModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-normalizers.js')
  );
  const highlights = normalizersModule.normalizeHighlightList([
    {
      id: 'highlight-quad',
      pageNumber: 1,
      text: 'Stored as PDF geometry',
      pageWidth: 600,
      pageHeight: 800,
      quadPoints: [60, 640, 240, 640, 60, 608, 240, 608]
    }
  ]);

  assert.equal(highlights.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(highlights[0].boxes)), [
    { x: 0.1, y: 0.2, width: 0.3, height: 0.04 }
  ]);
});
test('papers highlighted text copy helper merges PDF line wraps and preserves paragraphs', async () => {
  const viewerModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'index.js')
  );
  const source = 'The highlighted\\ntext is organ-\\nized across PDF lines.\\n\\nSecond paragraph.';
  const expected = 'The highlighted text is organized across PDF lines.\n\nSecond paragraph.';
  const writes = [];

  assert.equal(viewerModule.normalizePdfHighlightText(source), expected);
  assert.equal(await viewerModule.copyPdfHighlightText(source, {
    clipboard: {
      async writeText(value) {
        writes.push(value);
      }
    }
  }), true);
  assert.deepEqual(writes, [expected]);
});
test('papers highlighted text hover markup is a compact ask and copy toolbar', () => {
  const viewerModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'index.js')
  );
  const markup = viewerModule.buildHighlightPopoverMarkup({
    text: 'First PDF line\\nsecond PDF line'
  });

  assert.match(markup, /data-paper-highlight-copy/);
  assert.match(markup, /data-paper-highlight-ask/);
  assert.match(markup, /aria-label="Copy highlighted text"/);
  assert.match(markup, /aria-label="Ask Hikari about highlighted text"/);
  assert.doesNotMatch(markup, /First PDF line second PDF line/);
});
test('papers selection hover menu shows styled captions without native tooltips', () => {
  const viewHtml = fs.readFileSync(
    path.join(__dirname, 'ui', 'html', 'views', 'papers-view.html'),
    'utf8'
  );
  const menuMarkup = viewHtml.match(
    /<div id="paper-selection-menu"[\s\S]*?<div id="paper-selection-search-popover"/
  )?.[0] || '';
  const css = readPapersCss();
  const captions = [
    ['paper-selection-comment-btn', 'Add comment', 'Add comment'],
    ['paper-selection-highlight-btn', 'Highlight', 'Highlight'],
    ['paper-selection-underline-btn', 'Underline', 'Underline'],
    ['paper-selection-search-btn', 'Search selected text', 'Search'],
    ['paper-selection-ask-btn', 'Ask Hikari about selected text', 'Ask Hikari'],
    ['paper-selection-copy-btn', 'Copy selected text', 'Copy']
  ];

  assert.ok(menuMarkup);
  captions.forEach(([id, accessibleName, caption]) => {
    assert.match(
      menuMarkup,
      new RegExp(`id="${id}"[^>]*aria-label="${accessibleName}"[^>]*data-hover-caption="${caption}"`)
    );
  });
  assert.doesNotMatch(menuMarkup, /\btitle=/);
  assert.match(css, /\.papers-selection-menu \.papers-selection-action-btn\[data-hover-caption\]::after\s*\{[^}]*content:\s*attr\(data-hover-caption\);/s);
  assert.match(css, /\.papers-selection-menu \.papers-selection-action-btn\[data-hover-caption\]:hover::after,[\s\S]*:focus-visible::after\s*\{[^}]*visibility:\s*visible;/s);
});
test('papers PDF selection search helper finds matching pages and next target', () => {
  const viewerModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'index.js')
  );
  const result = viewerModule.buildCurrentPdfSelectionSearchResult([
    { pageNumber: 1, text: 'Selected kinase appears here. Selected kinase appears again.' },
    { pageNumber: 2, text: 'A different pathway appears here.' },
    { pageNumber: 3, text: 'The selected kinase returns in the discussion.' }
  ], 'selected kinase', 1);

  assert.equal(result.totalMatches, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(result.pages)), [
    { pageNumber: 1, count: 2 },
    { pageNumber: 3, count: 1 }
  ]);
  assert.equal(result.targetPageNumber, 3);
});
test('papers PDF selection search terms omit short filler words and split hyphenated terms', () => {
  const viewerModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'index.js')
  );
  const terms = viewerModule.getPdfSelectionSearchTerms('the β-strand of P53 macrocycles');

  assert.deepEqual(Array.from(terms), ['β-strand', 'strand', 'p53', 'macrocycles']);
});
test('papers PDF selection search match summary supports individual matched-word navigation', () => {
  const viewerModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'index.js')
  );
  const result = viewerModule.buildPdfSelectionSearchResultFromMatches([
    { id: 'm3', pageNumber: 3, boxes: [{ x: 0.3, y: 0.2, width: 0.1, height: 0.02 }] },
    { id: 'm1', pageNumber: 1, boxes: [{ x: 0.1, y: 0.4, width: 0.1, height: 0.02 }] },
    { id: 'm2', pageNumber: 1, boxes: [{ x: 0.1, y: 0.2, width: 0.1, height: 0.02 }] }
  ], 1);

  assert.deepEqual(JSON.parse(JSON.stringify(result.pages)), [
    { pageNumber: 1, count: 2 },
    { pageNumber: 3, count: 1 }
  ]);
  assert.deepEqual(result.matches.map((match) => match.id), ['m2', 'm1', 'm3']);
  assert.equal(result.targetMatchIndex, 2);
});
test('papers selection search popover omits result lists and keeps match arrows horizontal', () => {
  const viewerSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'index.js'),
    'utf8'
  );
  const css = readPapersCss();

  assert.equal(viewerSource.includes('papers-selection-search-result-list'), false);
  assert.equal(css.includes('papers-selection-search-result-list'), false);
  assert.match(css, /\.papers-selection-search-nav\s*\{[\s\S]*display:\s*inline-flex;/);
});
test('papers PDF pages keep square edges between stacked pages', () => {
  const viewerCss = readPapersCss();
  const shellCss = fs.readFileSync(
    path.join(__dirname, 'ui', 'css', 'views', 'papers-shell-overrides.css'),
    'utf8'
  );

  assert.match(viewerCss, /\.papers-viewer-page\s*\{[^}]*border-radius:\s*0;/s);
  assert.match(shellCss, /#papers-view \.papers-viewer-canvas\s*\{[^}]*border-radius:\s*0;/s);
});
test('papers outline panel scrolls independently and gives back its collapsed space', () => {
  const css = readPapersCss();

  assert.doesNotMatch(css, /\.papers-section-toggle-icon/);
  assert.match(css, /\.papers-layout\.is-comments-collapsed \.papers-stage\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(css, /\.papers-layout\.is-comments-collapsed \.papers-right-column\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /\.papers-comment-sidebar\s*\{[^}]*overflow-y:\s*auto;[^}]*scrollbar-gutter:\s*stable;/s);
});
test('papers selection search popover dismisses on outside document pointer down', () => {
  const searchUiSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-search-ui-controller.js'),
    'utf8'
  );
  const eventsSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-events-controller.js'),
    'utf8'
  );

  assert.match(searchUiSource, /function handleDocumentPointerDown\(event\)/);
  assert.match(searchUiSource, /selectionSearchPopover\?\.hidden === false/);
  assert.match(searchUiSource, /!isSelectionSearchPopoverEvent\(event\)/);
  assert.match(searchUiSource, /hideSelectionSearchPopover\(\)/);
  assert.match(eventsSource, /doc\.addEventListener\('pointerdown', ctx\.handleDocumentPointerDown\)/);
});
test('papers PDF loading prefers stored bytes and compacts embedded PDF state', () => {
  const actionsSource = [
    fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'actions.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'actions-upload.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'actions-analysis.js'), 'utf8')
  ].join('\n');
  const storageApiSource = fs.readFileSync(
    path.join(__dirname, 'src', 'main', 'preload', 'api', 'storage-api.js'),
    'utf8'
  );
  const dataRegistrarSource = fs.readFileSync(
    path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'),
    'utf8'
  );
  const storageFileHelpersSource = fs.readFileSync(
    path.join(__dirname, 'src', 'main', 'ipc', 'data-ipc', 'storage-files.js'),
    'utf8'
  );
  const appState = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'app-state.js')
  );
  const resolveBytesBlock = actionsSource.slice(actionsSource.indexOf('async function resolvePaperPdfBytes'));

  assert.match(storageApiSource, /readFileBytes:\s*\(path\) => ipcRenderer\.invoke\(STORAGE\.READ_FILE_BYTES/);
  assert.match(storageApiSource, /moveStoredFile:\s*\(payload\) => ipcRenderer\.invoke\(STORAGE\.MOVE_STORED_FILE, payload\)/);
  assert.match(dataRegistrarSource, /ipcMain\.handle\(STORAGE\.READ_FILE_BYTES/);
  assert.match(dataRegistrarSource, /ipcMain\.handle\(STORAGE\.MOVE_STORED_FILE/);
  assert.match(dataRegistrarSource, /bytes\.buffer\.slice\(bytes\.byteOffset,\s*bytes\.byteOffset \+ bytes\.byteLength\)/);
  assert.match(storageFileHelpersSource, /normalizeImportedDataBytes/);
  assert.match(storageFileHelpersSource, /dataBytes\?\.byteLength \? dataBytes : Buffer\.from\(dataBase64, 'base64'\)/);
  assert.match(actionsSource, /async function movePaperToFolder\(paperId, folderKey\)/);
  assert.match(actionsSource, /const pdfBytes = await fileToBytes\(file\)/);
  assert.match(actionsSource, /dataBytes:\s*pdfBytes\.buffer\.slice/);
  assert.match(actionsSource, /pdfDataUrl:\s*''/);
  assert.equal(actionsSource.includes('fileToDataUrl'), false);
  assert.ok(resolveBytesBlock.indexOf('readFileBytes') >= 0);
  assert.ok(resolveBytesBlock.indexOf('readFileBytes') < resolveBytesBlock.indexOf('parsePdfDataUrl(paper?.pdfDataUrl)'));

  const normalized = appState.normalizePaperRecord({
    id: 'paper-1',
    storedRelativePath: 'Project/Atlas/Papers/paper.pdf',
    pdfDataUrl: 'data:application/pdf;base64,AAAA'
  });
  assert.equal(normalized.pdfDataUrl, '');
});
test('papers PDF viewer virtualizes page rendering and prunes offscreen canvases', () => {
  const renderSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-render-controller.js'),
    'utf8'
  );
  const pageRecordsSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-page-records.js'),
    'utf8'
  );
  const searchSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-search-execution-controller.js'),
    'utf8'
  );
  const renderingSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-rendering.js'),
    'utf8'
  );
  const navigationSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-pdf-navigation-controller.js'),
    'utf8'
  );

  assert.match(renderSource, /const ACTIVE_PAGE_RENDER_BUFFER = 4/);
  assert.match(renderSource, /const RETAINED_PAGE_RENDER_BUFFER = 8/);
  assert.match(renderSource, /clearPageRecordsOutsideRange/);
  assert.match(renderSource, /pendingNavigationPageNumber/);
  assert.match(renderSource, /getActiveRenderRanges/);
  assert.match(renderSource, /getPageRecordsInRanges\(renderRanges\)/);
  assert.match(renderSource, /scheduleVisiblePageRender/);
  assert.equal(renderSource.includes('for (const record of state.pageRecords)'), false);
  assert.match(pageRecordsSource, /record\.canvas\.width = 0/);
  assert.match(pageRecordsSource, /record\.canvas\.height = 0/);
  assert.match(searchSource, /async function ensurePdfSearchTextLayers\(\)/);
  assert.match(searchSource, /renderPageTextLayerRecord/);
  assert.match(searchSource, /ctx\.pruneRenderedPageRecords\?\.\(\)/);
  assert.equal(renderingSource.includes('isStale() || isLinkActivationEnabled() === false'), false);
  assert.match(renderingSource, /if \(isLinkActivationEnabled\(\) === false\)/);
  assert.match(navigationSource, /state\.pendingNavigationPageNumber = pageNumber/);
});
test('papers PDF link buttons remain active after later virtualized render passes', async () => {
  const renderingModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-rendering.js'),
    { URL }
  );
  const createdButtons = [];
  const doc = {
    createDocumentFragment() {
      return {
        children: [],
        appendChild(child) {
          this.children.push(child);
        }
      };
    },
    createElement(tagName) {
      const element = {
        tagName,
        style: {},
        attributes: {},
        listeners: {},
        type: '',
        className: '',
        title: '',
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        },
        addEventListener(name, listener) {
          this.listeners[name] = listener;
        }
      };
      createdButtons.push(element);
      return element;
    }
  };
  const linkLayer = {
    ownerDocument: doc,
    innerHTML: '',
    style: {},
    replaceChildren(fragment) {
      this.children = fragment.children;
    }
  };
  const page = {
    async getAnnotations() {
      return [{ rect: [0, 0, 40, 12], url: 'https://example.com/article' }];
    }
  };
  const viewport = {
    width: 200,
    height: 300,
    convertToViewportRectangle(rect) {
      return rect;
    }
  };
  let stale = false;
  let openedUrl = '';

  await renderingModule.renderPageLinkLayer({
    page,
    viewport,
    record: { linkLayer },
    onExternalLink(url) {
      openedUrl = url;
    },
    isLinkActivationEnabled: () => true,
    isStale: () => stale
  });
  stale = true;
  createdButtons[0].listeners.click({
    preventDefault() {},
    stopPropagation() {}
  });

  assert.equal(openedUrl, 'https://example.com/article');
});
test('papers database search matches selected text against stored paper records', () => {
  const papersModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'index.js')
  );
  const matches = papersModule.searchPaperDatabaseForSelectedText([
    {
      id: 'paper-1',
      title: 'Unrelated MAPK Paper',
      linkedName: 'Cancer Study',
      summary: 'A control paper about a different pathway.'
    },
    {
      id: 'paper-2',
      title: 'Macrocycle Scaffolds',
      linkedName: 'Journal Club',
      methodsExtract: [
        { title: 'Synthesis', summary: 'A beta strand macrocycle scaffold was optimized by NMR.' }
      ],
      pdfBookmarks: [
        { title: 'Conformational ensembles', pageNumber: 4 }
      ]
    }
  ], 'beta strand macrocycle scaffold');

  assert.equal(matches.length, 1);
  assert.equal(matches[0].paperId, 'paper-2');
  assert.equal(matches[0].title, 'Macrocycle Scaffolds');
  assert.equal(matches[0].folderLabel, 'Journal Club');
});
test('papers module exposes selected text paper search to the PDF viewer', async () => {
  const harness = buildPapersManagementHarness();
  harness.state.papers.push({
    id: 'paper-2',
    title: 'Macrocycle Scaffolds',
    fileName: 'macrocycle.pdf',
    linkedType: 'project',
    linkedId: 'p1',
    linkedName: 'Cancer Study',
    summary: 'A beta strand macrocycle scaffold was optimized by NMR.',
    summaryStatus: 'idle',
    methodsExtract: [],
    keyReagents: [],
    keyFigures: [],
    comments: [],
    highlights: [],
    pdfDataUrl: 'data:application/pdf;base64,BBBB',
    updatedAt: '2026-02-02T00:00:00.000Z'
  });

  await openPaperInHarness(harness);
  const result = await harness.viewerFactory.controller.callbacks.onSelectionSearch({
    scope: 'library',
    text: 'beta strand macrocycle scaffold'
  });

  assert.equal(result.ok, true);
  assert.equal(result.matches[0].paperId, 'paper-2');

  await harness.viewerFactory.controller.callbacks.onSelectionSearch({
    scope: 'open-paper',
    paperId: 'paper-2'
  });

  assert.equal(harness.viewerFactory.controller.activePaperId, 'paper-2');
});
test('papers module displays all saved bibliographic fields in Paper details', async () => {
  const harness = buildPapersManagementHarness();
  const metadata = {
    title: 'The hidden biology of cells',
    author: 'Ada Lovelace, Grace Hopper',
    year: '2024',
    journal: 'Nature',
    doi: '10.1000/example-doi',
    url: 'https://doi.org/10.1000/example-doi'
  };
  harness.state.papers[0].pdfMetadata = { ...metadata };

  await openPaperInHarness(harness);

  for (const [key, value] of Object.entries(metadata)) {
    assert.equal(harness.state.papers[0].pdfMetadata[key], value);
    assert.ok(harness.document.getElementById('paper-summary-list').innerHTML.includes(value));
  }
  const button = harness.document.getElementById('paper-details-toggle-btn');
  const sidebar = harness.document.getElementById('paper-details-sidebar');
  assert.equal(sidebar.hidden, true);
  trigger(button, 'click');
  assert.equal(sidebar.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(harness.document.getElementById('paper-comment-sidebar').hidden, true);
  trigger(button, 'click');
  assert.equal(sidebar.hidden, true);
});
test('papers module promotes embedded PDF titles into the left rail after opening a paper', async () => {
  const harness = buildPapersManagementHarness();
  const journalClubList = harness.document.getElementById('journal-club-list');
  harness.viewerFactory.controller.metadataOnOpen = {
    title: 'Embedded Metadata Title',
    author: 'Alice Scientist',
    year: '2025',
    journal: 'Science',
    doi: '10.1000/embedded-title',
    url: 'https://example.test/papers/embedded-title'
  };

  await openPaperInHarness(harness);

  assert.equal(harness.state.papers[0].title, 'Embedded Metadata Title');
  assert.match(journalClubList.innerHTML, /Embedded Metadata Title/);
  const details = harness.document.getElementById('paper-summary-list').innerHTML;
  for (const value of Object.values(harness.viewerFactory.controller.metadataOnOpen)) {
    assert.ok(details.includes(value), `extracted field is displayed: ${value}`);
  }
});
test('papers details use library metadata as fallback and clear fields when the paper closes', async () => {
  const harness = buildPapersManagementHarness();
  Object.assign(harness.state.papers[0], {
    title: 'Saved title', authors: ['First Author', 'Second Author'], doi: '10.1000/saved', journal: 'Saved journal', year: '2023'
  });
  await openPaperInHarness(harness);
  const list = harness.document.getElementById('paper-summary-list');
  assert.match(list.innerHTML, /Saved title/);
  assert.match(list.innerHTML, /First Author, Second Author/);
  assert.match(list.innerHTML, /10.1000\/saved/);
  harness.viewerFactory.controller.callbacks.onMetadataResolved({
    paperId: 'paper-1', metadata: { title: '<b>Embedded title</b>', author: 'PDF Author' }
  });
  assert.match(list.innerHTML, /&lt;b&gt;Embedded title&lt;\/b&gt;/);
  assert.match(list.innerHTML, /PDF Author/);
  assert.match(list.innerHTML, /10.1000\/saved/);
  harness.viewerFactory.controller.activePaperId = '';
  harness.viewerFactory.controller.callbacks.onClose();
  assert.match(list.innerHTML, /Open a PDF/);
  assert.doesNotMatch(list.innerHTML, /PDF Author|10.1000/);
});
test('papers module opens and closes the initially collapsed outline from the right rail', () => {
  const harness = buildPapersManagementHarness();
  const layout = harness.document.getElementById('papers-layout');
  const toggleBtn = harness.document.getElementById('paper-comment-toggle-btn');
  const sidebar = harness.document.getElementById('paper-comment-sidebar');

  assert.equal(layout.classList.contains('is-comments-collapsed'), true);
  assert.equal(sidebar.hidden, true);

  trigger(toggleBtn, 'click');

  assert.equal(layout.classList.contains('is-comments-collapsed'), false);
  assert.equal(toggleBtn.classList.contains('is-collapsed'), false);
  assert.equal(sidebar.hidden, false);

  trigger(toggleBtn, 'click');

  assert.equal(layout.classList.contains('is-comments-collapsed'), true);
  assert.equal(toggleBtn.classList.contains('is-collapsed'), true);
  assert.equal(sidebar.hidden, true);
});
  }
};
