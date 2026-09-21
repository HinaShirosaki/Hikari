module.exports = function registerAppPapersSuitePaperLibraryFolders(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const {
    assert,
    path,
    loadEsmStyleModule,
    createMockDocument,
    wireFormReset,
    trigger,
    flushAsync,
    test,
    shared
  } = scope;
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
    window,
    papers,
    viewerFactory,
    get persistCalls() {
      return persistCalls;
    }
  };
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
        if (selector === '[data-folder-tree-toggle]') {
          return {
            dataset: {
              folderTreeToggle: 'project:p1'
            }
          };
        }
        return null;
      }
    }
  });

  assert.match(journalClubList.innerHTML, /data-folder-tree-toggle="project:p1"[^>]*aria-expanded="false"/);
  assert.match(journalClubList.innerHTML, /papers-folder-children[^>]*hidden/);
  assert.match(journalClubList.innerHTML, /Atlas Uploaded Paper/);

  trigger(journalClubList, 'click', {
    target: {
      closest(selector) {
        if (selector === '[data-folder-tree-toggle]') {
          return {
            dataset: {
              folderTreeToggle: 'project:p1'
            }
          };
        }
        return null;
      }
    }
  });

  assert.match(journalClubList.innerHTML, /data-folder-tree-toggle="project:p1"[^>]*aria-expanded="true"/);
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

  const renameInput = journalClubList.querySelector('[data-folder-tree-rename-input]');
  assert.equal(renameInput.value, 'New Folder');
  renameInput.value = 'Weekly Biochem JC';
  trigger(renameInput, 'keydown', { key: 'Enter' });

  assert.equal(harness.state.journalClubs[0].name, 'Weekly Biochem JC');
  assert.match(journalClubList.innerHTML, /Weekly Biochem JC/);
  assert.equal(journalClubList.querySelector('[data-folder-tree-rename-input]'), null);
});
test('papers viewer imports and opens a PDF dropped on the viewer workspace', async () => {
  const harness = buildPapersManagementHarness();
  const viewerShell = harness.document.getElementById('paper-viewer-shell');
  const storeCalls = [];
  const pdfBytes = new Uint8Array([37, 80, 68, 70]);
  const droppedFile = {
    name: 'viewer-drop.pdf',
    type: 'application/pdf',
    arrayBuffer: async () => pdfBytes.buffer
  };
  const dropEvent = {
    dataTransfer: {
      files: [droppedFile],
      types: ['Files'],
      dropEffect: ''
    }
  };

  harness.state.settings.storagePath = '/tmp/hikari-storage';
  harness.window.hikariApi.storeImportedFile = async (payload) => {
    storeCalls.push(payload);
    return {
      ok: true,
      fileName: payload.fileName,
      filePath: '/tmp/hikari-storage/Project/Cancer_Study/Papers/viewer-drop.pdf',
      relativePath: 'Project/Cancer_Study/Papers/viewer-drop.pdf',
      knowledgeMarkdownRelativePath: 'Project/Cancer_Study/Papers/viewer-drop/paper.md',
      knowledgeExtractedTextRelativePath: 'Project/Cancer_Study/Papers/viewer-drop/extracted.txt',
      knowledgeMetaRelativePath: 'Project/Cancer_Study/Papers/viewer-drop/meta.json',
      knowledgeStatus: 'ready'
    };
  };

  trigger(viewerShell, 'dragenter', dropEvent);
  assert.equal(viewerShell.classList.contains('is-file-drop-active'), true);

  trigger(viewerShell, 'drop', dropEvent);
  await flushAsync();
  await flushAsync();

  const importedPaper = harness.state.papers.find((paper) => paper.fileName === 'viewer-drop.pdf');
  assert.equal(storeCalls.length, 1);
  assert.equal(storeCalls[0].fileName, 'viewer-drop.pdf');
  assert.equal(storeCalls[0].targetFolder, '/tmp/hikari-storage/Project/Cancer_Study/Papers');
  assert.equal(storeCalls[0].dataBytes.byteLength, 4);
  assert.equal(importedPaper.title, 'viewer-drop');
  assert.equal(importedPaper.storedRelativePath, 'Project/Cancer_Study/Papers/viewer-drop.pdf');
  assert.equal(harness.viewerFactory.controller.activePaperId, importedPaper.id);
  assert.equal(viewerShell.classList.contains('is-file-drop-active'), false);
});
test('papers viewer preserves and surfaces automatic intake failures after storing a PDF', async () => {
  const harness = buildPapersManagementHarness();
  const viewerShell = harness.document.getElementById('paper-viewer-shell');
  const pdfBytes = new Uint8Array([37, 80, 68, 70]);
  harness.state.settings.storagePath = '/tmp/hikari-storage';
  harness.window.hikariApi.storeImportedFile = async (payload) => ({
    ok: true,
    fileName: payload.fileName,
    filePath: '/tmp/hikari-storage/Project/Cancer_Study/Papers/intake-failed.pdf',
    relativePath: 'Project/Cancer_Study/Papers/intake-failed.pdf',
    knowledgeStatus: 'ready',
    paperIntakeStatus: 'failed',
    paperIntakeError: 'Structured intake response failed validation.'
  });

  trigger(viewerShell, 'drop', {
    dataTransfer: {
      files: [{
        name: 'intake-failed.pdf',
        type: 'application/pdf',
        arrayBuffer: async () => pdfBytes.buffer
      }],
      types: ['Files'],
      dropEffect: ''
    }
  });
  await flushAsync();
  await flushAsync();

  const paper = harness.state.papers.find((item) => item.fileName === 'intake-failed.pdf');
  assert.equal(paper.ingestionStatus, 'error');
  assert.deepEqual(
    Array.from(paper.ingestionErrors),
    ['Structured intake response failed validation.']
  );
  const notice = harness.document.querySelector('[data-hikari-transient-toast]');
  assert.match(notice.textContent, /automatic paper intake failed/i);
  assert.equal(notice.hidden, false);
});
test('papers viewer reports batched intake failures in one notice', async () => {
  const harness = buildPapersManagementHarness();
  const journalClubList = harness.document.getElementById('journal-club-list');
  const papersLibraryRail = harness.document.getElementById('papers-library-rail');
  const pdfBytes = new Uint8Array([37, 80, 68, 70]);
  const droppedNames = ['one.pdf', 'two.pdf', 'three.pdf'];
  harness.state.settings.storagePath = '/tmp/hikari-storage';

  // The library rail is the multi-file drop target; the viewer shell takes files[0] only.
  trigger(journalClubList, 'click', {
    target: {
      closest(selector) {
        return selector === '[data-folder-select]'
          ? { dataset: { folderSelect: 'project:p1' } }
          : null;
      }
    }
  });
  harness.window.hikariApi.storeImportedFile = async (payload) => ({
    ok: true,
    fileName: payload.fileName,
    filePath: `/tmp/hikari-storage/Project/Cancer_Study/Papers/${payload.fileName}`,
    relativePath: `Project/Cancer_Study/Papers/${payload.fileName}`,
    knowledgeStatus: 'ready',
    paperIntakeStatus: 'failed',
    paperIntakeError: 'Structured intake response failed validation.'
  });

  trigger(papersLibraryRail, 'drop', {
    dataTransfer: {
      files: droppedNames.map((name) => ({
        name,
        type: 'application/pdf',
        arrayBuffer: async () => pdfBytes.buffer
      })),
      types: ['Files'],
      dropEffect: ''
    }
  });
  await flushAsync();
  await flushAsync();
  await flushAsync();

  // One notice for the whole batch, not one per dropped PDF — a per-file notice
  // would leave only the last file's message in the shared notice element.
  const notice = harness.document.querySelector('[data-hikari-transient-toast]');
  for (const name of droppedNames) {
    assert.equal(harness.state.papers.find((item) => item.fileName === name)?.ingestionStatus, 'error');
    assert.ok(notice.textContent.includes(name), `${name} is named in the summary`);
  }
  assert.match(notice.textContent, /^3 PDFs were stored, but automatic paper intake failed:/);
});
test('papers module drags a paper between folders and moves the stored PDF', async () => {
  const harness = buildPapersManagementHarness();
  const paper = harness.state.papers.find((item) => item.id === 'paper-1');
  const moveCalls = [];
  const transferData = {};
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    setData(type, value) {
      transferData[type] = String(value || '');
    },
    getData(type) {
      return transferData[type] || '';
    }
  };
  const dragClassList = {
    add() {},
    remove() {}
  };
  const dropClassList = {
    active: false,
    add(token) {
      if (token === 'is-paper-drop-target') {
        this.active = true;
      }
    },
    remove(token) {
      if (token === 'is-paper-drop-target') {
        this.active = false;
      }
    }
  };

  harness.state.settings.storagePath = '/tmp/hikari-storage';
  harness.state.journalClubs.push({
    id: 'club-1',
    name: 'Reading Club',
    description: ''
  });
  paper.pdfDataUrl = '';
  paper.storedFilePath = '/tmp/hikari-storage/Project/Cancer_Study/Papers/atlas.pdf';
  paper.storedRelativePath = 'Project/Cancer_Study/Papers/atlas.pdf';
  harness.window.hikariApi.moveStoredFile = async (payload) => {
    moveCalls.push(payload);
    return {
      ok: true,
      fileName: 'atlas.pdf',
      filePath: '/tmp/hikari-storage/Papers/Reading_Club/atlas.pdf',
      relativePath: 'Papers/Reading_Club/atlas.pdf',
      previousRelativePath: 'Project/Cancer_Study/Papers/atlas.pdf',
      moved: true
    };
  };
  harness.papers.render();

  assert.match(harness.document.getElementById('journal-club-list').innerHTML, /data-paper-drag="paper-1"/);
  assert.match(harness.document.getElementById('journal-club-list').innerHTML, /data-folder-drop="journal-club:club-1"/);

  const journalClubList = harness.document.getElementById('journal-club-list');
  trigger(journalClubList, 'dragstart', {
    dataTransfer,
    target: {
      closest(selector) {
        if (selector === '[data-paper-drag]') {
          return {
            dataset: { paperDrag: 'paper-1' },
            classList: dragClassList
          };
        }
        return null;
      }
    }
  });
  trigger(journalClubList, 'dragover', {
    dataTransfer,
    target: {
      closest(selector) {
        if (selector === '[data-folder-drop]') {
          return {
            dataset: { folderDrop: 'journal-club:club-1' },
            classList: dropClassList
          };
        }
        return null;
      }
    }
  });
  assert.equal(dataTransfer.dropEffect, 'move');
  assert.equal(dropClassList.active, true);

  trigger(journalClubList, 'drop', {
    dataTransfer,
    target: {
      closest(selector) {
        if (selector === '[data-folder-drop]') {
          return {
            dataset: { folderDrop: 'journal-club:club-1' },
            classList: dropClassList
          };
        }
        return null;
      }
    }
  });
  await flushAsync();
  await flushAsync();

  assert.equal(moveCalls.length, 1);
  assert.equal(moveCalls[0].sourcePath, '/tmp/hikari-storage/Project/Cancer_Study/Papers/atlas.pdf');
  assert.equal(moveCalls[0].targetFolder, '/tmp/hikari-storage/Papers/Reading_Club');
  assert.equal(moveCalls[0].fileName, 'atlas.pdf');
  assert.equal(paper.linkedType, 'journal-club');
  assert.equal(paper.linkedId, 'club-1');
  assert.equal(paper.linkedName, 'Reading Club');
  assert.equal(paper.storedFilePath, '/tmp/hikari-storage/Papers/Reading_Club/atlas.pdf');
  assert.equal(paper.storedRelativePath, 'Papers/Reading_Club/atlas.pdf');
  assert.match(harness.document.getElementById('journal-club-list').innerHTML, /Reading Club/);
});
};
