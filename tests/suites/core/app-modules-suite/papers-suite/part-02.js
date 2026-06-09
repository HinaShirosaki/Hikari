module.exports = function registerAppPapersSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
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
    'paper-viewer-open-btn',
    'paper-selection-menu',
    'paper-selection-comment-btn',
    'paper-selection-highlight-btn',
    'paper-selection-underline-btn',
    'paper-selection-search-btn',
    'paper-selection-ask-btn',
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
  const papersModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'papers-management.js'), {
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer-normalizers.js')
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
test('papers PDF selection search helper finds matching pages and next target', () => {
  const viewerModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer.js')
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer.js')
  );
  const terms = viewerModule.getPdfSelectionSearchTerms('the β-strand of P53 macrocycles');

  assert.deepEqual(Array.from(terms), ['β-strand', 'strand', 'p53', 'macrocycles']);
});
test('papers PDF selection search match summary supports individual matched-word navigation', () => {
  const viewerModule = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer.js')
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, 'ui', 'css', 'views', 'papers-view.css'),
    'utf8'
  );

  assert.equal(viewerSource.includes('papers-selection-search-result-list'), false);
  assert.equal(css.includes('papers-selection-search-result-list'), false);
  assert.match(css, /\.papers-selection-search-nav\s*\{[\s\S]*display:\s*inline-flex;/);
});
test('papers selection search popover dismisses on outside document pointer down', () => {
  const searchUiSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer-search-ui-controller.js'),
    'utf8'
  );
  const eventsSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer-events-controller.js'),
    'utf8'
  );

  assert.match(searchUiSource, /function handleDocumentPointerDown\(event\)/);
  assert.match(searchUiSource, /selectionSearchPopover\?\.hidden === false/);
  assert.match(searchUiSource, /!isSelectionSearchPopoverEvent\(event\)/);
  assert.match(searchUiSource, /hideSelectionSearchPopover\(\)/);
  assert.match(eventsSource, /doc\.addEventListener\('pointerdown', ctx\.handleDocumentPointerDown\)/);
});
test('papers PDF loading prefers stored bytes and compacts embedded PDF state', () => {
  const actionsSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'actions.js'),
    'utf8'
  );
  const storageApiSource = fs.readFileSync(
    path.join(__dirname, 'src', 'main', 'preload', 'api', 'storage-api.js'),
    'utf8'
  );
  const dataRegistrarSource = fs.readFileSync(
    path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'),
    'utf8'
  );
  const appState = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'app-state.js')
  );
  const resolveBytesBlock = actionsSource.slice(actionsSource.indexOf('async function resolvePaperPdfBytes'));

  assert.match(storageApiSource, /readFileBytes:\s*\(path\) => ipcRenderer\.invoke\(STORAGE\.READ_FILE_BYTES/);
  assert.match(dataRegistrarSource, /ipcMain\.handle\(STORAGE\.READ_FILE_BYTES/);
  assert.match(dataRegistrarSource, /bytes\.buffer\.slice\(bytes\.byteOffset,\s*bytes\.byteOffset \+ bytes\.byteLength\)/);
  assert.match(dataRegistrarSource, /normalizeImportedDataBytes/);
  assert.match(dataRegistrarSource, /dataBytes\?\.byteLength \? dataBytes : Buffer\.from\(dataBase64, 'base64'\)/);
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer-render-controller.js'),
    'utf8'
  );
  const pageRecordsSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer-page-records.js'),
    'utf8'
  );
  const searchSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer-search-execution-controller.js'),
    'utf8'
  );
  const renderingSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer-rendering.js'),
    'utf8'
  );
  const navigationSource = fs.readFileSync(
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer-pdf-navigation-controller.js'),
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
    path.join(__dirname, 'src', 'renderer', 'modules', 'papers', 'pdf-viewer-rendering.js'),
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
test('papers module renders embedded PDF metadata in the right-rail summary section', async () => {
  const harness = buildPapersManagementHarness();
  harness.state.papers[0].pdfMetadata = {
    title: 'The hidden biology of cells',
    author: 'Ada Lovelace, Grace Hopper',
    year: '2024',
    journal: 'Nature',
    doi: '10.1000/example-doi',
    url: 'https://doi.org/10.1000/example-doi'
  };
  const summaryList = harness.document.getElementById('paper-summary-list');

  await openPaperInHarness(harness);

  assert.match(summaryList.innerHTML, /The hidden biology of cells/);
  assert.match(summaryList.innerHTML, /Ada Lovelace, Grace Hopper/);
  assert.match(summaryList.innerHTML, /Nature/);
  assert.match(summaryList.innerHTML, /10\.1000\/example-doi/);
  assert.match(summaryList.innerHTML, /https:\/\/doi\.org\/10\.1000\/example-doi/);
});
test('papers module folds and unfolds the summary section above comments', async () => {
  const harness = buildPapersManagementHarness();
  const toggleBtn = harness.document.getElementById('paper-summary-toggle-btn');
  const summaryContent = harness.document.getElementById('paper-summary-content');

  await openPaperInHarness(harness);

  assert.equal(summaryContent.hidden, false);
  assert.equal(toggleBtn.classList.contains('is-collapsed'), false);

  trigger(toggleBtn, 'click');

  assert.equal(summaryContent.hidden, true);
  assert.equal(toggleBtn.classList.contains('is-collapsed'), true);

  trigger(toggleBtn, 'click');

  assert.equal(summaryContent.hidden, false);
  assert.equal(toggleBtn.classList.contains('is-collapsed'), false);
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
});
test('papers module folds and unfolds the comment sidebar from the right rail', () => {
  const harness = buildPapersManagementHarness();
  const layout = harness.document.getElementById('papers-layout');
  const toggleBtn = harness.document.getElementById('paper-comment-toggle-btn');
  const sidebar = harness.document.getElementById('paper-comment-sidebar');

  assert.equal(layout.classList.contains('is-comments-collapsed'), false);
  assert.equal(sidebar.hidden, false);

  trigger(toggleBtn, 'click');

  assert.equal(layout.classList.contains('is-comments-collapsed'), true);
  assert.equal(toggleBtn.classList.contains('is-collapsed'), true);
  assert.equal(sidebar.hidden, true);

  trigger(toggleBtn, 'click');

  assert.equal(layout.classList.contains('is-comments-collapsed'), false);
  assert.equal(toggleBtn.classList.contains('is-collapsed'), false);
  assert.equal(sidebar.hidden, false);
});
  }
};
