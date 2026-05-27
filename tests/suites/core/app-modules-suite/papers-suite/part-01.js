module.exports = function registerAppPapersSuitePart01(context = {}) {
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
  const harness = buildPapersManagementHarness();
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
  assert.equal(harness.state.journalClubs[0].name, 'New Folder');
  assert.equal(harness.state.journalClubs[0].description, '');
  assert.match(journalClubList.innerHTML, /New Folder/);
});
test('papers module folds and unfolds folder children from the library tree', () => {
  const harness = buildPapersManagementHarness();
  const journalClubList = harness.document.getElementById('journal-club-list');

  assert.match(journalClubList.innerHTML, /Atlas Uploaded Paper/);

  trigger(journalClubList, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-folder-select]') {
          return {
            dataset: {
              folderSelect: 'project:p1'
            }
          };
        }
        return null;
      }
    }
  });

  assert.equal(/Atlas Uploaded Paper/.test(journalClubList.innerHTML), false);

  trigger(journalClubList, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-folder-select]') {
          return {
            dataset: {
              folderSelect: 'project:p1'
            }
          };
        }
        return null;
      }
    }
  });

  assert.match(journalClubList.innerHTML, /Atlas Uploaded Paper/);
});
test('papers module renames a journal club folder from the library context menu', () => {
  const harness = buildPapersManagementHarness();
  const papersLibraryRail = harness.document.getElementById('papers-library-rail');
  const renameFolderBtn = harness.document.getElementById('papers-context-rename-folder');
  const journalClubList = harness.document.getElementById('journal-club-list');

  trigger(harness.document.getElementById('papers-context-new-folder'), 'click');
  assert.match(journalClubList.innerHTML, /New Folder/);

  const newFolderId = harness.state.journalClubs[0].id;
  const newFolderKey = `journal-club:${newFolderId}`;

  trigger(papersLibraryRail, 'contextmenu', {
    clientX: 32,
    clientY: 48,
    target: {
      closest(selector) {
        if (selector === '[data-folder-context]') {
          return {
            dataset: {
              folderContext: newFolderKey
            }
          };
        }
        return null;
      }
    }
  });

  assert.equal(renameFolderBtn.hidden, false);
  trigger(renameFolderBtn, 'click');
  assert.match(journalClubList.innerHTML, /data-folder-rename-input/);

  trigger(journalClubList, 'input', {
    target: {
      value: 'Weekly Biochem JC',
      closest(selector) {
        if (selector === '[data-folder-rename-input]') {
          return {
            dataset: {
              folderRenameInput: newFolderKey
            }
          };
        }
        return null;
      }
    }
  });

  trigger(journalClubList, 'keydown', {
    key: 'Enter',
    target: {
      value: 'Weekly Biochem JC',
      closest(selector) {
        if (selector === '[data-folder-rename-input]') {
          return {
            dataset: {
              folderRenameInput: newFolderKey
            }
          };
        }
        return null;
      }
    }
  });

  assert.equal(harness.state.journalClubs[0].name, 'Weekly Biochem JC');
  assert.match(journalClubList.innerHTML, /Weekly Biochem JC/);
  assert.equal(/data-folder-rename-input/.test(journalClubList.innerHTML), false);
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
  }
};