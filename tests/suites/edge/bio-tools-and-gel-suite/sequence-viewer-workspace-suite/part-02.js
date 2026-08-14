module.exports = function registerEdgeSequenceViewerWorkspaceSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('[EDGE] sequence-viewer library rows render only sequence names in the left rail', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host'
  ];
  const entry = {
    id: 'entry_1',
    name: 'pcDNA3.1-GFP_1-10_',
    status: 'saved',
    sourceFormat: 'GENBANK',
    topology: 'circular',
    sequenceLength: 6076,
    featureCount: 20,
    updatedAt: '2026-04-17T14:20:00.000Z'
  };
  const document = createMockDocument(ids);
  const window = {
    hikariApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [entry] })
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'hikari_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();
  await flushAsync();

  const libraryList = document.getElementById('sequence-viewer-library-list');
  assert.match(libraryList.innerHTML, /sequence-viewer-library-item-name/);
  assert.match(libraryList.innerHTML, /pcDNA3\.1-GFP_1-10_/);
  assert.doesNotMatch(libraryList.innerHTML, /sequence-viewer-library-item-meta/);
  assert.doesNotMatch(libraryList.innerHTML, /sequence-viewer-library-folder-glyph/);
  assert.doesNotMatch(libraryList.innerHTML, /6076|6,076|bp|features|updated/i);
});
test('[EDGE] sequence-viewer creates real folders and moves sequences into them', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-library-context-menu',
    'sequence-viewer-preview-host'
  ];
  const folders = [];
  const entries = [{ id: 'entry_folder_move', name: 'Alpha Vector', status: 'saved', folderId: '' }];
  const moveCalls = [];
  const document = createMockDocument(ids);
  document.defaultView = {
    prompt(label, value) {
      assert.equal(label, 'New sequence folder');
      assert.equal(value, 'New Folder');
      return 'Cloning';
    }
  };
  const window = {
    hikariApi: {
      sequenceLibraryList: async () => ({ ok: true, folders: [...folders], entries: entries.map((entry) => ({ ...entry })) }),
      sequenceLibraryUpsertFolder: async (payload) => {
        const folder = { id: 'folder_cloning', name: payload.name };
        folders.push(folder);
        return { ok: true, folder };
      },
      sequenceLibraryMoveEntry: async (payload) => {
        moveCalls.push(payload);
        entries[0].folderId = payload.folderId;
        return { ok: true, entry: { ...entries[0] } };
      }
    }
  };
  const localStorage = {
    getItem() {
      return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();
  await flushAsync();

  const libraryList = document.getElementById('sequence-viewer-library-list');
  const contextMenu = document.getElementById('sequence-viewer-library-context-menu');
  trigger(libraryList, 'contextmenu', { target: libraryList, clientX: 44, clientY: 72 });
  assert.equal(contextMenu.hidden, false);
  const newFolderTarget = {
    closest(selector) {
      return selector === '[data-sequence-library-action]'
        ? { dataset: { sequenceLibraryAction: 'new-folder' } }
        : null;
    }
  };
  trigger(contextMenu, 'click', { target: newFolderTarget });
  await flushAsync();
  await flushAsync();

  assert.match(libraryList.innerHTML, /sequence-viewer-library-folder-row/);
  assert.match(libraryList.innerHTML, /Cloning/);
  assert.match(libraryList.innerHTML, /Alpha Vector/);

  const entryTarget = {
    dataset: { sequenceEntryId: 'entry_folder_move' },
    classList: { add() {}, remove() {} },
    closest(selector) {
      return selector === '[data-sequence-entry-id]' ? this : null;
    }
  };
  const folderTarget = {
    dataset: { sequenceFolderDrop: 'folder_cloning' },
    classList: { add() {}, remove() {} },
    closest(selector) {
      return selector === '[data-sequence-folder-drop]' ? this : null;
    }
  };
  trigger(libraryList, 'dragstart', { target: entryTarget });
  trigger(libraryList, 'dragover', { target: folderTarget });
  trigger(libraryList, 'drop', { target: folderTarget });
  await flushAsync();
  await flushAsync();

  assert.equal(moveCalls.length, 1);
  assert.equal(moveCalls[0].id, 'entry_folder_move');
  assert.equal(moveCalls[0].folderId, 'folder_cloning');
  assert.match(libraryList.innerHTML, /sequence-viewer-library-folder-children[\s\S]*Alpha Vector/);
});
test('[EDGE] sequence-viewer renames a library entry from the right-click menu', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-library-context-menu',
    'sequence-viewer-preview-host'
  ];
  const originalEntry = {
    id: 'entry_rename',
    name: 'Original Name',
    status: 'saved',
    sourceFormat: 'genbank',
    topology: 'circular',
    sequenceLength: 12,
    featureCount: 0
  };
  let currentEntry = { ...originalEntry };
  let upsertPayload = null;
  const document = createMockDocument(ids);
  document.defaultView = {
    prompt(label, value) {
      assert.equal(label, 'Rename sequence');
      assert.equal(value, 'Original Name');
      return 'Renamed Vector';
    }
  };
  const window = {
    hikariApi: {
      sequenceLibraryList: async () => ({ ok: true, entries: [currentEntry] }),
      sequenceLibraryGet: async () => ({
        ok: true,
        entry: currentEntry,
        gbkText: `LOCUS       ORIGINAL        12 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
ORIGIN
        1 acgtacgtacgt
//
`,
        alignments: []
      }),
      sequenceLibraryUpsert: async (payload) => {
        upsertPayload = payload;
        currentEntry = { ...currentEntry, name: payload.name };
        return { ok: true, entry: currentEntry, alignments: [] };
      }
    }
  };
  const localStorage = {
    getItem() {
      return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();
  await flushAsync();

  const rowTarget = {
    dataset: { sequenceEntryId: originalEntry.id },
    closest(selector) {
      return selector === '[data-sequence-entry-id]' ? this : null;
    }
  };
  const libraryList = document.getElementById('sequence-viewer-library-list');
  const contextMenu = document.getElementById('sequence-viewer-library-context-menu');
  trigger(libraryList, 'contextmenu', {
    target: rowTarget,
    clientX: 44,
    clientY: 72
  });
  assert.equal(contextMenu.hidden, false);
  assert.equal(contextMenu.style.left, '44px');
  assert.equal(contextMenu.style.top, '72px');

  const renameTarget = {
    closest(selector) {
      return selector === '[data-sequence-library-action]'
        ? { dataset: { sequenceLibraryAction: 'rename' } }
        : null;
    }
  };
  trigger(contextMenu, 'click', { target: renameTarget });
  await flushAsync();
  await flushAsync();

  assert.equal(upsertPayload.id, originalEntry.id);
  assert.equal(upsertPayload.name, 'Renamed Vector');
  assert.equal(upsertPayload.status, 'saved');
  assert.match(upsertPayload.gbkText, /LOCUS\s+Renamed_Vector/);
  assert.match(libraryList.innerHTML, /Renamed Vector/);
  assert.equal(contextMenu.hidden, true);
});
test('[EDGE] sequence-viewer hides input composer after successful load', () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-preview-meta',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-form',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const document = createMockDocument(ids);
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document }
  );
  moduleWithDom.initSequenceViewer();

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  const textarea = document.getElementById('sequence-viewer-textarea');
  textarea.value = '>seq1\nACGTACGT\n';
  trigger(document.getElementById('sequence-viewer-form'), 'submit');

  const modePasteBtn = document.getElementById('sequence-viewer-mode-paste');
  const modeFileBtn = document.getElementById('sequence-viewer-mode-file');
  const loadBtn = document.getElementById('sequence-viewer-load-btn');

  assert.equal(Boolean(modePasteBtn.hidden), true);
  assert.equal(Boolean(modeFileBtn.hidden), true);
  assert.equal(Boolean(loadBtn.hidden), true);
});
test('[EDGE] sequence-viewer importing GenBank with features stores a temporary library entry for feature indexing', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-form',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const upsertCalls = [];
  const listCalls = [];
  const document = createMockDocument(ids);
  const window = {
    hikariApi: {
      sequenceLibraryList: async ({ status }) => {
        listCalls.push(status);
        return {
          ok: true,
          entries: status === 'temporary'
            ? [{
              id: 'entry_imported',
              name: 'Imported',
              status: 'temporary',
              topology: 'circular',
              sequenceLength: 12,
              featureCount: 1,
              updatedAt: '2026-01-01T00:00:00'
            }]
            : []
        };
      },
      sequenceLibraryUpsert: async (payload) => {
        upsertCalls.push(payload);
        return {
          ok: true,
          entry: {
            id: 'entry_imported',
            name: payload.name || 'Imported',
            status: 'temporary'
          }
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'hikari_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  const textarea = document.getElementById('sequence-viewer-textarea');
  textarea.value = `
LOCUS       IMPORTED        12 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     promoter        1..6
                     /label="shared_prom"
ORIGIN
        1 atgcgatttaaa
//
`;
  trigger(document.getElementById('sequence-viewer-form'), 'submit');
  await flushAsync();
  await flushAsync();

  assert.equal(upsertCalls.length, 1);
  assert.equal(Array.isArray(upsertCalls[0].features), true);
  assert.equal(upsertCalls[0].features.length, 1);
  assert.equal(upsertCalls[0].features[0].name, 'shared_prom');
  assert.equal(upsertCalls[0].sequence, 'ATGCGATTTAAA');
  assert.equal(upsertCalls[0].status, 'temporary');
  assert.equal(listCalls.includes('temporary'), true);
  assert.match(document.getElementById('sequence-viewer-library-list').innerHTML, /Imported/);
});
test('[EDGE] sequence-viewer importing a single GenBank record keeps it visible from the temporary library on return home', async () => {
  const ids = [
    'sequence-viewer-home-workspace',
    'sequence-viewer-detail-workspace',
    'sequence-viewer-home-status',
    'sequence-viewer-library-filter-saved',
    'sequence-viewer-library-filter-temporary',
    'sequence-viewer-library-list',
    'sequence-viewer-preview-host',
    'sequence-viewer-home-paste-btn',
    'sequence-viewer-home-open-btn',
    'sequence-viewer-home-open-input',
    'sequence-viewer-save-btn',
    'sequence-viewer-save-name',
    'sequence-viewer-form',
    'sequence-viewer-mode-paste',
    'sequence-viewer-mode-file',
    'sequence-viewer-paste-panel',
    'sequence-viewer-file-panel',
    'sequence-viewer-textarea',
    'sequence-viewer-file-input',
    'sequence-viewer-file-choose',
    'sequence-viewer-file-name',
    'sequence-viewer-load-btn',
    'sequence-viewer-annotate-btn',
    'sequence-viewer-clear-btn',
    'sequence-viewer-status',
    'sequence-viewer-messages',
    'sequence-viewer-record-select',
    'sequence-viewer-stat-format',
    'sequence-viewer-stat-length',
    'sequence-viewer-stat-topology',
    'sequence-viewer-stat-gc',
    'sequence-viewer-stat-ambiguous',
    'sequence-viewer-stat-quality',
    'sequence-viewer-stat-features',
    'sequence-viewer-stat-restriction-sites',
    'sequence-viewer-feature-rail-host',
    'sequence-viewer-feature-detail',
    'sequence-viewer-sequence-host'
  ];
  const listCalls = [];
  const upsertCalls = [];
  const document = createMockDocument(ids);
  const window = {
    hikariApi: {
      sequenceLibraryList: async ({ status }) => {
        listCalls.push(status);
        return {
          ok: true,
          entries: status === 'temporary'
            ? [{
              id: 'entry_plain_gbk',
              name: 'plain_gbk',
              status: 'temporary',
              topology: 'linear',
              sequenceLength: 12,
              featureCount: 0,
              updatedAt: '2026-01-01T00:00:00'
            }]
            : []
        };
      },
      sequenceLibraryUpsert: async (payload) => {
        upsertCalls.push(payload);
        return {
          ok: true,
          entry: {
            id: 'entry_plain_gbk',
            name: payload.name || 'plain_gbk',
            status: 'temporary'
          }
        };
      }
    }
  };
  const localStorage = {
    getItem(key) {
      if (key === 'hikari_state_v1') {
        return JSON.stringify({ settings: { storagePath: '/tmp/sequence-viewer-tests' } });
      }
      return null;
    }
  };
  const moduleWithDom = loadEsmStyleModule(
    path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'public-api.js'),
    { document, window, localStorage }
  );
  moduleWithDom.initSequenceViewer();

  trigger(document.getElementById('sequence-viewer-home-paste-btn'), 'click');
  const textarea = document.getElementById('sequence-viewer-textarea');
  textarea.value = `
LOCUS       PLAIN_GBK       12 bp    DNA     linear  SYN 01-JAN-2026
DEFINITION  plain_gbk.
ORIGIN
        1 atgcgatttaaa
//
`;
  trigger(document.getElementById('sequence-viewer-form'), 'submit');
  await flushAsync();
  await flushAsync();

  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].sequence, 'ATGCGATTTAAA');
  assert.equal(upsertCalls[0].status, 'temporary');
  assert.equal(listCalls.includes('temporary'), true);
  assert.match(document.getElementById('sequence-viewer-library-list').innerHTML, /plain_gbk/i);
});
  }
};
