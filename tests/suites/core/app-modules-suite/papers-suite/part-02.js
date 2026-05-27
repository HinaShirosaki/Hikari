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
        enanaEmail: 'alice@enana.test'
      },
      llm: {}
    }
  };
  const window = {
    alert() {},
    enanaApi: {},
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
test('papers module deletes the selected pinned page comment', async () => {
  const existingComment = {
    id: 'comment-1',
    pageNumber: 1,
    anchorX: 0.15,
    anchorY: 0.45,
    text: 'Delete me.',
    author: 'Alice Scientist',
    createdAt: '2026-03-22T17:00:00.000Z',
    updatedAt: '2026-03-22T17:00:00.000Z'
  };
  const harness = buildPapersManagementHarness({
    comments: [existingComment]
  });
  const deleteBtn = harness.document.getElementById('paper-comment-delete-btn');

  await openPaperInHarness(harness);
  harness.viewerFactory.selectPin(existingComment);
  trigger(deleteBtn, 'click');

  assert.equal(harness.state.papers[0].comments.length, 0);
  assert.equal(harness.viewerFactory.controller.comments.length, 0);
  assert.match(harness.document.getElementById('paper-comment-list').innerHTML, /No comments on page 1 yet/);
});
test('papers module scopes sidebar comments to the active PDF page', async () => {
  const harness = buildPapersManagementHarness({
    comments: [
      {
        id: 'comment-1',
        pageNumber: 1,
        anchorX: 0.15,
        anchorY: 0.45,
        text: 'Page one note.',
        author: 'Alice Scientist',
        createdAt: '2026-03-22T17:00:00.000Z',
        updatedAt: '2026-03-22T17:00:00.000Z'
      },
      {
        id: 'comment-2',
        pageNumber: 2,
        anchorX: 0.55,
        anchorY: 0.65,
        text: 'Page two note.',
        author: 'Alice Scientist',
        createdAt: '2026-03-22T18:00:00.000Z',
        updatedAt: '2026-03-22T18:00:00.000Z'
      }
    ]
  });
  const commentPage = harness.document.getElementById('paper-comment-page');
  const commentCount = harness.document.getElementById('paper-comment-count');
  const commentList = harness.document.getElementById('paper-comment-list');

  await openPaperInHarness(harness);
  assert.equal(commentPage.textContent, 'Page 1');
  assert.equal(commentCount.textContent, '1 comment on this page');
  assert.match(commentList.innerHTML, /Page one note/);
  assert.equal(/Page two note/.test(commentList.innerHTML), false);

  harness.viewerFactory.emitPageChange(2);

  assert.equal(commentPage.textContent, 'Page 2');
  assert.equal(commentCount.textContent, '1 comment on this page');
  assert.match(commentList.innerHTML, /Page two note/);
  assert.equal(/Page one note/.test(commentList.innerHTML), false);
});
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