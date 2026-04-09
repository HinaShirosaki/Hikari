module.exports = function registerAppPapersSuite(context = {}) {
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
        onClose: elements.onClose
      };
      return {
        async openPaper({ paper }) {
          controller.activePaperId = paper.id;
          controller.currentPageNumber = 1;
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

test('papers module renders folder rows with nested paper titles in the library list', () => {
  const harness = buildPapersManagementHarness({
    comments: [
      {
        id: 'comment-1',
        pageNumber: 1,
        anchorX: 0.25,
        anchorY: 0.75,
        text: 'Figure 2 drives the conclusion.',
        author: 'Alice Scientist',
        createdAt: '2026-03-22T17:00:00.000Z',
        updatedAt: '2026-03-22T17:00:00.000Z'
      }
    ]
  });
  const journalClubList = harness.document.getElementById('journal-club-list');

  assert.match(journalClubList.innerHTML, /Cancer Study/);
  assert.match(journalClubList.innerHTML, /Atlas Uploaded Paper/);
});

test('papers module creates a journal club folder from the library context menu', () => {
  const harness = buildPapersManagementHarness({
    promptResponses: ['Weekly Biochem JC']
  });
  const journalClubList = harness.document.getElementById('journal-club-list');
  const papersLibraryRail = harness.document.getElementById('papers-library-rail');
  const contextMenu = harness.document.getElementById('papers-library-context-menu');
  const newFolderBtn = harness.document.getElementById('papers-context-new-folder');

  trigger(papersLibraryRail, 'contextmenu', {
    clientX: 24,
    clientY: 40,
    target: {
      closest() {
        return null;
      }
    }
  });
  assert.equal(contextMenu.hidden, false);

  trigger(newFolderBtn, 'click');

  assert.equal(harness.state.journalClubs.length, 1);
  assert.equal(harness.state.journalClubs[0].name, 'Weekly Biochem JC');
  assert.equal(harness.state.journalClubs[0].description, '');
  assert.match(journalClubList.innerHTML, /Weekly Biochem JC/);
});

test('papers module creates a pinned page comment after placement and save', async () => {
  const harness = buildPapersManagementHarness();
  const addBtn = harness.document.getElementById('paper-comment-add-btn');
  const saveBtn = harness.document.getElementById('paper-comment-save-btn');
  const commentInput = harness.document.getElementById('paper-comment-text');
  const commentStatus = harness.document.getElementById('paper-comment-status');

  await openPaperInHarness(harness);

  trigger(addBtn, 'click');
  assert.equal(harness.viewerFactory.controller.placementMode, true);
  assert.match(commentStatus.textContent, /place a comment pin/i);

  harness.viewerFactory.emitPlacement({
    pageNumber: 1,
    anchorX: 0.25,
    anchorY: 0.75
  });
  commentInput.value = 'Important result near panel C.';
  trigger(commentInput, 'input');
  trigger(saveBtn, 'click');

  assert.equal(harness.state.papers[0].comments.length, 1);
  assert.equal(harness.state.papers[0].comments[0].pageNumber, 1);
  assert.equal(harness.state.papers[0].comments[0].anchorX, 0.25);
  assert.equal(harness.state.papers[0].comments[0].anchorY, 0.75);
  assert.equal(harness.state.papers[0].comments[0].text, 'Important result near panel C.');
  assert.equal(harness.state.papers[0].comments[0].author, 'Alice Scientist');
  assert.equal(harness.viewerFactory.controller.comments.length, 1);
  assert.equal(harness.persistCalls >= 1, true);
});

test('papers module edits an existing pinned page comment from pin selection', async () => {
  const existingComment = {
    id: 'comment-1',
    pageNumber: 1,
    anchorX: 0.15,
    anchorY: 0.45,
    text: 'Original note.',
    author: 'Alice Scientist',
    createdAt: '2026-03-22T17:00:00.000Z',
    updatedAt: '2026-03-22T17:00:00.000Z'
  };
  const harness = buildPapersManagementHarness({
    comments: [existingComment]
  });
  const commentInput = harness.document.getElementById('paper-comment-text');
  const saveBtn = harness.document.getElementById('paper-comment-save-btn');

  await openPaperInHarness(harness);
  harness.viewerFactory.selectPin(existingComment);

  assert.equal(commentInput.value, 'Original note.');
  commentInput.value = 'Updated note from reviewer.';
  trigger(commentInput, 'input');
  trigger(saveBtn, 'click');

  assert.equal(harness.state.papers[0].comments.length, 1);
  assert.equal(harness.state.papers[0].comments[0].text, 'Updated note from reviewer.');
  assert.equal(harness.viewerFactory.controller.selectedCommentId, 'comment-1');
});

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
