module.exports = function registerAppLabAndProjectSuitePart01(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('home dashboard passage reminders persist outside the sample registry', () => {
  const normalized = shared.normalizeState({
    settings: {
      dashboard: {
        passageReminders: [
          {
            id: 'passage-1',
            name: 'HEK293',
            cellPassage: {
              lastPassageDate: '2026-06-22',
              intervalDays: 3,
              passageNumber: 12
            },
            updatedAt: '2026-06-22T12:00:00.000Z'
          }
        ],
        legacyPassageSamplesMigrated: true
      }
    },
    samples: []
  });

  assert.equal(normalized.samples.length, 0);
  assert.equal(normalized.settings.dashboard.passageReminders.length, 1);
  assert.equal(normalized.settings.dashboard.passageReminders[0].name, 'HEK293');
  assert.equal(normalized.settings.dashboard.passageReminders[0].cellPassage.passageNumber, 12);
});
test('home dashboard migrates its legacy passage-only samples out of inventory once', () => {
  const dashboardUtils = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'home-dashboard',
    'utils.js'
  ));
  const state = {
    settings: { dashboard: {} },
    notebookEntries: [],
    samples: [
      {
        id: 'legacy-passage',
        code: 'HEK293',
        name: 'HEK293',
        type: 'cell_line',
        lot: '',
        concentration: '',
        notes: '',
        cellPassage: {
          lastPassageDate: '2026-06-22',
          intervalDays: 3,
          passageNumber: 12
        },
        location: null,
        inventoryLink: null,
        chemicalLinks: [],
        compoundStructure: null,
        updatedAt: '2026-06-22T12:00:00.000Z'
      },
      {
        id: 'stored-cell-line',
        code: 'CL-001',
        name: 'Stored line',
        type: 'cell_line',
        lot: 'bank-1',
        concentration: '',
        notes: '',
        cellPassage: {
          lastPassageDate: '2026-06-22',
          intervalDays: 3,
          passageNumber: 4
        },
        location: null,
        inventoryLink: null,
        chemicalLinks: [],
        compoundStructure: null,
        updatedAt: '2026-06-22T12:00:00.000Z'
      }
    ]
  };

  assert.equal(dashboardUtils.migrateLegacyPassageSamples(state), true);
  assert.equal(state.samples.map((sample) => sample.id).join(','), 'stored-cell-line');
  assert.equal(state.settings.dashboard.passageReminders.length, 1);
  assert.equal(state.settings.dashboard.passageReminders[0].id, 'legacy-passage');
  assert.equal(state.settings.dashboard.legacyPassageSamplesMigrated, true);
  assert.equal(dashboardUtils.migrateLegacyPassageSamples(state), false);
});
test('adding a dashboard passage reminder does not create an inventory sample', () => {
  const passageModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'home-dashboard',
    'passage.js'
  ));
  const summary = new MockElement('passage-summary');
  const list = new MockElement('passage-list');
  const addBtn = new MockElement('passage-add');
  const dialogOverlay = new MockElement('passage-overlay');
  const dialogForm = new MockElement('passage-form');
  const strainInput = new MockElement('passage-strain');
  const intervalInput = new MockElement('passage-interval');
  const numberInput = new MockElement('passage-number');
  dialogForm.reportValidity = () => true;
  wireFormReset(dialogForm, [strainInput, intervalInput, numberInput]);
  const state = {
    samples: [],
    settings: { dashboard: {} }
  };
  let persistCalls = 0;
  let renderCalls = 0;
  const widget = passageModule.initPassageWidget({
    state,
    persist: () => {
      persistCalls += 1;
    },
    safeText: shared.safeText,
    createId: () => 'passage-reminder-1',
    render: () => {
      renderCalls += 1;
    },
    elements: {
      summary,
      list,
      addBtn,
      dialogOverlay,
      dialogForm,
      strainInput,
      intervalInput,
      numberInput
    }
  });

  strainInput.value = 'HEK293';
  intervalInput.value = '3';
  numberInput.value = '12';
  trigger(dialogForm, 'submit');

  assert.equal(state.samples.length, 0);
  assert.equal(state.settings.dashboard.passageReminders.length, 1);
  assert.equal(state.settings.dashboard.passageReminders[0].name, 'HEK293');
  assert.equal(persistCalls, 1);
  assert.equal(renderCalls, 1);

  widget.render();
  assert.match(list.innerHTML, /HEK293 \(P12\)/);
});
test('personal-inventory shows right-side sample editor and saves linked sample fields', () => {
  const document = createMockDocument([
    'inventory-sections',
    'container-detail',
    'inventory-add-container-btn',
    'inventory-add-container-form',
    'inventory-add-container-name',
    'inventory-add-container-location',
    'inventory-add-container-type',
    'inventory-add-container-cancel'
  ]);
  const inventorySections = document.getElementById('inventory-sections');
  const inventoryModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'personal-inventory', 'index.js'), {
    document
  });

  let persistCalls = 0;
  let sampleChangedCalls = 0;
  const state = {
    samples: [
      {
        id: 'sample-1',
        code: 'S-001',
        name: 'Seed Sample',
        type: 'plasmid',
        lot: 'L-1',
        concentration: '1 mg/mL',
        notes: 'initial',
        location: {
          storageType: 'freezer',
          freezer: '-20 Degree',
          rack: '',
          box: 'Box A',
          position: '1'
        },
        inventoryLink: {
          section: '-20 Degree',
          containerId: 'box-1',
          wellIndex: 0
        },
        chemicalLinks: [],
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    inventory: {
      'Room Temp': [],
      '4 Degree': [],
      '-20 Degree': [
        {
          id: 'box-1',
          name: 'Box A',
          type: 'box81',
          wells: [{ name: 'A1', content: 'Seed slot' }]
        }
      ],
      '-80 Degree': [],
      'Liquid Nitrogen': []
    }
  };

  const personalInventory = inventoryModule.initPersonalInventory({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: () => 'container-x',
    safeText: shared.safeText,
    cssEscape: shared.cssEscape,
    onSamplesChanged: () => {
      sampleChangedCalls += 1;
    }
  });

  personalInventory.renderSections();
  const openBtn = inventorySections.querySelectorAll('[data-container-open]')[0];
  openBtn.dataset.section = '-20 Degree';
  trigger(openBtn, 'click');
  const wellBtn = inventorySections.querySelectorAll('[data-well-index]')[0];
  wellBtn.dataset.section = '-20 Degree';
  wellBtn.dataset.containerId = 'box-1';
  trigger(wellBtn, 'click');

  assert.match(inventorySections.innerHTML, /well-editor-shell/);
  assert.match(inventorySections.innerHTML, /container-detail-sticky/);
  assert.match(inventorySections.innerHTML, /data-container-import-csv="box-1"/);
  assert.match(inventorySections.innerHTML, /data-container-export-csv="box-1"/);
  assert.match(inventorySections.innerHTML, /data-container-import-csv="box-1"[^>]*aria-label="Import CSV"/);
  assert.match(inventorySections.innerHTML, /data-container-export-csv="box-1"[^>]*aria-label="Export CSV"/);
  assert.match(inventorySections.innerHTML, /data-well-sample-clone="sample-1"/);
  assert.match(inventorySections.innerHTML, /Fill Wells/);
  assert.doesNotMatch(inventorySections.innerHTML, /Clone to Well/);
  assert.match(inventorySections.innerHTML, /data-well-sample-save="sample-1"/);
  assert.match(inventorySections.innerHTML, /value="chemical">Chemical/);
  assert.doesNotMatch(inventorySections.innerHTML, />Compound</);

  trigger(inventorySections.querySelector('[data-well-sample-clone]'), 'click');
  assert.match(inventorySections.innerHTML, /Filling Wells/);
  assert.match(inventorySections.innerHTML, /Drag across wells to fill with S-001/);

  const existingStructurePasteBtn = inventorySections.querySelector('[data-inventory-sample-structure-paste]');
  assert.equal(Boolean(existingStructurePasteBtn.hidden), true);
  const existingTypeInput = inventorySections.querySelector('[data-well-sample-type]');
  existingTypeInput.value = 'chemical';
  trigger(existingTypeInput, 'change');
  assert.equal(Boolean(existingStructurePasteBtn.hidden), false);
  assert.equal(existingStructurePasteBtn.textContent, 'Paste Structure');

  inventorySections.querySelector('[data-well-sample-code]').value = 'S-UPDATED-1';
  inventorySections.querySelector('[data-well-sample-name]').value = 'Updated Sample';
  existingTypeInput.value = 'protein';
  inventorySections.querySelector('[data-well-sample-lot]').value = 'LOT-99';
  inventorySections.querySelector('[data-well-sample-concentration]').value = '2 mg/mL';
  inventorySections.querySelector('[data-well-sample-notes]').value = 'edited in side panel';
  trigger(inventorySections.querySelectorAll('[data-well-sample-save]')[0], 'click');

  assert.equal(state.samples.length, 1);
  assert.equal(state.samples[0].code, 'S-UPDATED-1');
  assert.equal(state.samples[0].name, 'Updated Sample');
  assert.equal(state.samples[0].type, 'protein');
  assert.equal(state.samples[0].lot, 'LOT-99');
  assert.equal(state.samples[0].concentration, '2 mg/mL');
  assert.equal(state.samples[0].notes, 'edited in side panel');
  assert.equal(state.samples[0].inventoryLink.section, '-20 Degree');
  assert.equal(state.samples[0].inventoryLink.containerId, 'box-1');
  assert.equal(state.samples[0].inventoryLink.wellIndex, 0);
  assert.ok(persistCalls >= 1);
  assert.equal(sampleChangedCalls, 1);
});
test('personal-inventory creates a linked sample from the side editor for an empty cell', () => {
  const document = createMockDocument([
    'inventory-sections',
    'container-detail',
    'inventory-add-container-btn',
    'inventory-add-container-form',
    'inventory-add-container-name',
    'inventory-add-container-location',
    'inventory-add-container-type',
    'inventory-add-container-cancel'
  ]);
  const inventorySections = document.getElementById('inventory-sections');
  const inventoryModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'personal-inventory', 'index.js'), {
    document
  });

  let persistCalls = 0;
  let sampleChangedCalls = 0;
  const state = {
    samples: [],
    inventory: {
      'Room Temp': [],
      '4 Degree': [],
      '-20 Degree': [
        {
          id: 'box-2',
          name: 'Box B',
          type: 'box81',
          wells: [{ name: 'A1', content: '' }]
        }
      ],
      '-80 Degree': [],
      'Liquid Nitrogen': []
    }
  };

  const personalInventory = inventoryModule.initPersonalInventory({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: () => 'container-y',
    safeText: shared.safeText,
    cssEscape: shared.cssEscape,
    onSamplesChanged: () => {
      sampleChangedCalls += 1;
    }
  });

  personalInventory.renderSections();
  const openBtn = inventorySections.querySelectorAll('[data-container-open]')[0];
  openBtn.dataset.section = '-20 Degree';
  trigger(openBtn, 'click');
  const wellBtn = inventorySections.querySelectorAll('[data-well-index]')[0];
  wellBtn.dataset.section = '-20 Degree';
  wellBtn.dataset.containerId = 'box-2';
  trigger(wellBtn, 'click');

  assert.match(inventorySections.innerHTML, /data-well-sample-create="0"/);
  assert.match(inventorySections.innerHTML, /value="chemical">Chemical/);
  assert.doesNotMatch(inventorySections.innerHTML, />Compound</);
  const newStructurePasteBtn = inventorySections.querySelector('[data-inventory-sample-structure-paste]');
  assert.equal(Boolean(newStructurePasteBtn.hidden), true);
  const newTypeInput = inventorySections.querySelector('[data-well-sample-new-type]');
  newTypeInput.value = 'chemical';
  trigger(newTypeInput, 'change');
  assert.equal(Boolean(newStructurePasteBtn.hidden), false);
  assert.equal(newStructurePasteBtn.textContent, 'Paste Structure');

  inventorySections.querySelector('[data-well-sample-new-code]').value = 'S-NEW-1';
  inventorySections.querySelector('[data-well-sample-new-name]').value = 'Created Sample';
  newTypeInput.value = 'antibody';
  inventorySections.querySelector('[data-well-sample-new-lot]').value = 'BATCH-7';
  inventorySections.querySelector('[data-well-sample-new-concentration]').value = '5 mg/mL';
  inventorySections.querySelector('[data-well-sample-new-notes]').value = 'created from inventory panel';
  trigger(inventorySections.querySelectorAll('[data-well-sample-create]')[0], 'click');

  assert.equal(state.samples.length, 1);
  assert.equal(state.samples[0].code, 'S-NEW-1');
  assert.equal(state.samples[0].name, 'Created Sample');
  assert.equal(state.samples[0].type, 'antibody');
  assert.equal(state.samples[0].lot, 'BATCH-7');
  assert.equal(state.samples[0].concentration, '5 mg/mL');
  assert.equal(state.samples[0].notes, 'created from inventory panel');
  assert.equal(state.samples[0].inventoryLink.section, '-20 Degree');
  assert.equal(state.samples[0].inventoryLink.containerId, 'box-2');
  assert.equal(state.samples[0].inventoryLink.wellIndex, 0);
  assert.ok(persistCalls >= 1);
  assert.equal(sampleChangedCalls, 1);
});
test('personal-inventory keeps folders nestable while physical containers remain distinct leaves', () => {
  const document = createMockDocument([
    'inventory-sections',
    'inventory-location-nav',
    'inventory-container-context-menu',
    'container-detail',
    'inventory-add-container-btn',
    'inventory-add-folder-btn',
    'inventory-add-container-overlay',
    'inventory-add-container-form',
    'inventory-add-container-title',
    'inventory-add-container-note',
    'inventory-add-item-name-label',
    'inventory-add-container-name',
    'inventory-add-container-location',
    'inventory-add-container-type-field',
    'inventory-add-container-type',
    'inventory-add-container-grid-fields',
    'inventory-add-container-rows',
    'inventory-add-container-cols',
    'inventory-add-container-submit',
    'inventory-add-container-close',
    'inventory-add-container-cancel'
  ]);
  const inventorySections = document.getElementById('inventory-sections');
  const inventoryLocationNav = document.getElementById('inventory-location-nav');
  const containerContextMenu = document.getElementById('inventory-container-context-menu');
  const addContainerOverlay = document.getElementById('inventory-add-container-overlay');
  const addContainerTitle = document.getElementById('inventory-add-container-title');
  const addFolderBtn = document.getElementById('inventory-add-folder-btn');
  const addContainerNameInput = document.getElementById('inventory-add-container-name');
  const addContainerLocationSelect = document.getElementById('inventory-add-container-location');
  const addContainerForm = document.getElementById('inventory-add-container-form');
  const inventoryModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'personal-inventory', 'index.js'), {
    document
  });

  let persistCalls = 0;
  let inventoryChangedCalls = 0;
  const state = {
    samples: [
      {
        id: 'sample-linked',
        code: 'S-LINKED',
        name: 'Linked Sample',
        type: 'plasmid',
        location: null,
        inventoryLink: {
          section: '-20 Degree',
          containerId: 'box-context',
          wellIndex: 0
        },
        chemicalLinks: [],
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    inventory: {
      'Room Temp': [],
      '4 Degree': [],
      '-20 Degree': [
        {
          id: 'box-context',
          name: 'Context Box',
          type: 'box81',
          folderId: 'folder-child',
          wells: [{ name: 'A1', content: '' }]
        }
      ],
      '-80 Degree': [],
      'Liquid Nitrogen': []
    },
    inventoryFolders: {
      '-20 Degree': [
        { id: 'folder-root', name: 'Projects' },
        { id: 'folder-child', name: 'Expression', parentFolderId: 'folder-root' }
      ]
    }
  };
  const createdIds = ['folder-created', 'container-created'];
  const personalInventory = inventoryModule.initPersonalInventory({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: () => createdIds.shift(),
    safeText: shared.safeText,
    cssEscape: shared.cssEscape,
    onInventoryChanged: () => {
      inventoryChangedCalls += 1;
    }
  });

  personalInventory.renderSections();
  assert.doesNotMatch(inventorySections.innerHTML, /Saved Samples/);
  assert.doesNotMatch(inventorySections.innerHTML, /data-saved-sample-drag/);
  assert.doesNotMatch(inventorySections.innerHTML, /data-container-delete/);
  assert.match(inventoryLocationNav.innerHTML, /data-inventory-folder-node="folder-root"/);
  assert.match(inventoryLocationNav.innerHTML, /data-inventory-folder-node="folder-child"/);
  assert.match(inventoryLocationNav.innerHTML, /folder-tree-template__children/);
  assert.match(inventoryLocationNav.innerHTML, /inventory-container-glyph-box81/);
  assert.match(inventoryLocationNav.innerHTML, /81-well cube box/);
  assert.equal((inventoryLocationNav.innerHTML.match(/left-rail-folder-glyph/g) || []).length, 2);
  const contextContainerMarkup = inventoryLocationNav.innerHTML.match(/<button\s+type="button"\s+class="inventory-container-btn[^"]*"[\s\S]*?data-container-open="box-context"[\s\S]*?<\/button>/)?.[0] || '';
  assert.ok(contextContainerMarkup);
  assert.doesNotMatch(contextContainerMarkup, /left-rail-folder-glyph/);
  assert.doesNotMatch(inventoryLocationNav.innerHTML, /data-container-add-child/);
  assert.match(inventorySections.innerHTML, /Select one cell to edit well and sample information/);

  const containerBtn = inventoryLocationNav.querySelectorAll('[data-container-open]')[0];
  containerBtn.dataset.section = '-20 Degree';
  trigger(containerBtn, 'contextmenu', { clientX: 80, clientY: 120 });
  assert.equal(containerContextMenu.hidden, false);
  assert.equal(containerContextMenu.style.left, '80px');
  assert.equal(containerContextMenu.style.top, '120px');

  assert.equal(containerContextMenu.querySelector('[data-container-context-add-child]'), null);
  assert.ok(containerContextMenu.querySelector('[data-container-context-rename]'));
  assert.ok(containerContextMenu.querySelector('[data-container-context-delete]'));

  trigger(addFolderBtn, 'click');
  assert.equal(addContainerOverlay.hidden, false);
  assert.equal(addContainerTitle.textContent, 'New Folder');
  addContainerLocationSelect.value = '-20 Degree';
  addContainerNameInput.value = 'Archive';
  trigger(addContainerForm, 'submit');
  const createdFolder = state.inventoryFolders['-20 Degree'].find((folder) => folder.id === 'folder-created');
  assert.equal(createdFolder.name, 'Archive');
  assert.equal(createdFolder.parentFolderId, undefined);

  const addToFolderBtn = inventoryLocationNav.querySelectorAll('[data-folder-add-container]')
    .find((button) => button.dataset.folderAddContainer === 'folder-root');
  addToFolderBtn.dataset.section = '-20 Degree';
  trigger(addToFolderBtn, 'click');
  assert.equal(addContainerTitle.textContent, 'Add Container to Folder');
  assert.equal(addContainerLocationSelect.value, '-20 Degree');
  assert.equal(addContainerLocationSelect.disabled, true);

  addContainerNameInput.value = 'Project Box';
  trigger(addContainerForm, 'submit');

  const createdContainer = state.inventory['-20 Degree'].find((container) => container.id === 'container-created');
  assert.equal(createdContainer.name, 'Project Box');
  assert.equal(createdContainer.folderId, 'folder-root');
  assert.equal(createdContainer.parentContainerId, undefined);
  assert.match(inventoryLocationNav.innerHTML, /Project Box/);

  let folderToggle = inventoryLocationNav.querySelectorAll('[data-inventory-folder-toggle]')
    .find((button) => button.dataset.inventoryFolderToggle === 'folder-root');
  folderToggle.dataset.section = '-20 Degree';
  assert.match(inventoryLocationNav.innerHTML, /data-inventory-folder-toggle="folder-root"[\s\S]*?aria-expanded="true"/);
  trigger(folderToggle, 'click');
  folderToggle = inventoryLocationNav.querySelectorAll('[data-inventory-folder-toggle]')
    .find((button) => button.dataset.inventoryFolderToggle === 'folder-root');
  folderToggle.dataset.section = '-20 Degree';
  assert.match(inventoryLocationNav.innerHTML, /data-inventory-folder-toggle="folder-root"[\s\S]*?aria-expanded="false"/);
  assert.match(inventoryLocationNav.innerHTML, /class="inventory-folder-children folder-tree-template__children" hidden/);
  trigger(folderToggle, 'click');

  const parentBtn = inventoryLocationNav.querySelectorAll('[data-container-open]')
    .find((button) => button.dataset.containerOpen === 'box-context');
  parentBtn.dataset.section = '-20 Degree';
  trigger(parentBtn, 'contextmenu', { clientX: 80, clientY: 120 });

  const deleteBtn = containerContextMenu.querySelector('[data-container-context-delete]');
  trigger(deleteBtn, 'click');

  assert.equal(state.inventory['-20 Degree'].length, 1);
  assert.equal(state.inventory['-20 Degree'][0].id, 'container-created');
  assert.equal(state.samples[0].inventoryLink, null);
  assert.equal(persistCalls, 3);
  assert.equal(inventoryChangedCalls, 3);
  assert.equal(containerContextMenu.hidden, true);
});
test('personal-inventory previews a copied structure image before saving a chemical sample', async () => {
  const document = createMockDocument([
    'inventory-sections',
    'container-detail',
    'inventory-add-container-btn',
    'inventory-add-container-form',
    'inventory-add-container-name',
    'inventory-add-container-location',
    'inventory-add-container-type',
    'inventory-add-container-cancel'
  ]);
  const inventorySections = document.getElementById('inventory-sections');
  const inventoryModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'personal-inventory', 'index.js'), {
    document,
    window: {
      hikariApi: {
        readChemicalClipboard: async () => ({
          formats: ['public.tiff'],
          candidates: [
            { format: 'image/native', imageDataUrl: 'data:image/png;base64,NOTEPNG' }
          ]
        })
      }
    }
  });

  let persistCalls = 0;
  let sampleChangedCalls = 0;
  const state = {
    samples: [],
    inventory: {
      'Room Temp': [],
      '4 Degree': [],
      '-20 Degree': [
        {
          id: 'box-3',
          name: 'Box C',
          type: 'box81',
          wells: [{ name: 'A1', content: '' }]
        }
      ],
      '-80 Degree': [],
      'Liquid Nitrogen': []
    }
  };

  const personalInventory = inventoryModule.initPersonalInventory({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: () => 'container-z',
    safeText: shared.safeText,
    cssEscape: shared.cssEscape,
    onSamplesChanged: () => {
      sampleChangedCalls += 1;
    }
  });

  personalInventory.renderSections();
  const openBtn = inventorySections.querySelectorAll('[data-container-open]')[0];
  openBtn.dataset.section = '-20 Degree';
  trigger(openBtn, 'click');
  const wellBtn = inventorySections.querySelectorAll('[data-well-index]')[0];
  wellBtn.dataset.section = '-20 Degree';
  wellBtn.dataset.containerId = 'box-3';
  trigger(wellBtn, 'click');

  const typeInput = inventorySections.querySelector('[data-well-sample-new-type]');
  const pasteBtn = inventorySections.querySelector('[data-inventory-sample-structure-paste]');
  const preview = inventorySections.querySelector('[data-inventory-sample-structure-preview]');
  assert.equal(Boolean(preview.hidden), true);
  typeInput.value = 'chemical';
  trigger(typeInput, 'change');
  assert.equal(Boolean(pasteBtn.hidden), false);
  assert.equal(Boolean(preview.hidden), true);

  trigger(pasteBtn, 'click');
  await flushAsync();
  await flushAsync();

  const status = inventorySections.querySelector('[data-inventory-sample-structure-status]');
  assert.equal(status.textContent, 'Structure ready. Click Add Sample to save it.');
  assert.equal(Boolean(preview.hidden), false);

  inventorySections.querySelector('[data-well-sample-new-code]').value = 'CHEM-IMG-1';
  inventorySections.querySelector('[data-well-sample-new-name]').value = 'Pasted structure';
  trigger(inventorySections.querySelectorAll('[data-well-sample-create]')[0], 'click');

  assert.equal(state.samples.length, 1);
  assert.equal(state.samples[0].type, 'chemical');
  assert.equal(state.samples[0].compoundStructure.imageDataUrl, 'data:image/png;base64,NOTEPNG');
  assert.match(inventorySections.innerHTML, /data-inventory-sample-structure-preview-image/);
  assert.match(inventorySections.innerHTML, /data:image\/png;base64,NOTEPNG/);
  assert.ok(persistCalls >= 1);
  assert.equal(sampleChangedCalls, 1);
});
test('sample-registry applies pasted SMILES, MOL/SDF, and copied images without editor hooks', async () => {
  const compoundActions = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'sample-registry', 'compound-actions.js'));
  const molfile = [
    'ethanol',
    '  Hikari',
    '',
    '  3  2  0  0  0  0            999 V2000',
    '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    1.2000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    2.4000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
    '  1  2  1  0  0  0  0',
    '  2  3  1  0  0  0  0',
    'M  END'
  ].join('\n');
  const createCtx = () => ({
    compoundStructureDraft: { smiles: '', molfile: '', imageDataUrl: '' },
    dom: {
      sampleCompoundFields: new MockElement('sample-compound-fields'),
      sampleCompoundPreview: new MockElement('sample-compound-preview'),
      sampleCompoundPreviewImage: new MockElement('sample-compound-preview-image'),
      sampleCompoundSmilesInput: new MockElement('sample-compound-smiles'),
      sampleCompoundStatus: new MockElement('sample-compound-status'),
      sampleTypeInput: { value: 'chemical' }
    }
  });

  const smilesCtx = createCtx();
  assert.equal(await compoundActions.applyCompoundStructurePasteCandidates(smilesCtx, [
    { source: 'SMILES: CCO', sourceFormat: 'text', clipboardFormat: 'text/plain' }
  ], ['text/plain']), true);
  assert.equal(smilesCtx.compoundStructureDraft.smiles, 'CCO');
  assert.equal(smilesCtx.dom.sampleCompoundSmilesInput.value, 'CCO');
  assert.match(smilesCtx.dom.sampleCompoundStatus.textContent, /SMILES pasted/);

  const molCtx = createCtx();
  assert.equal(await compoundActions.applyCompoundStructurePasteCandidates(molCtx, [
    { source: molfile, sourceFormat: 'molfile', clipboardFormat: 'chemical/x-mdl-molfile' }
  ], ['chemical/x-mdl-molfile']), true);
  assert.equal(molCtx.compoundStructureDraft.molfile.includes('M  END'), true);
  assert.equal(molCtx.dom.sampleCompoundSmilesInput.value, 'Molfile only');
  assert.match(molCtx.dom.sampleCompoundStatus.textContent, /MOL\/SDF structure pasted/);

  const imageCtx = createCtx();
  assert.equal(await compoundActions.applyCompoundStructurePasteCandidates(imageCtx, [
    { source: 'data:image/png;base64,PASTEPNG', sourceFormat: 'image', imageDataUrl: 'data:image/png;base64,PASTEPNG', clipboardFormat: 'image/png' }
  ], ['image/png']), true);
  assert.equal(imageCtx.compoundStructureDraft.imageDataUrl, 'data:image/png;base64,PASTEPNG');
  assert.equal(imageCtx.dom.sampleCompoundPreview.hidden, false);
  assert.equal(imageCtx.dom.sampleCompoundPreviewImage.src, 'data:image/png;base64,PASTEPNG');
  assert.match(imageCtx.dom.sampleCompoundStatus.textContent, /Structure image pasted/);
});
test('chemical structure clipboard helper extracts CDXML, MOL/SDF, SMILES, and images', async () => {
  const clipboardModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'services', 'chemical-structure-clipboard.js'));
  const molfile = [
    'ethanol',
    '  Hikari',
    '',
    '  3  2  0  0  0  0            999 V2000',
    '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    1.2000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    2.4000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
    '  1  2  1  0  0  0  0',
    '  2  3  1  0  0  0  0',
    'M  END'
  ].join('\n');
  const candidates = clipboardModule.extractChemicalStructureCandidates([
    { format: 'text/html', text: '<pre>&lt;CDXML&gt;&lt;page id="1"/&gt;&lt;/CDXML&gt;</pre>' },
    { format: 'chemical/x-mdl-molfile', text: molfile },
    { format: 'text/plain', text: 'SMILES: CCO' },
    { format: 'public.tiff', imageDataUrl: 'data:image/png;base64,SHARPCHEMDRAW' },
    { format: 'image/native', imageDataUrl: 'data:image/png;base64,MOCKCHEMDRAW' }
  ]);
  const imageCandidates = candidates.filter((candidate) => candidate.sourceFormat === 'image');

  assert.equal(candidates.some((candidate) => candidate.sourceFormat === 'cdxml' && candidate.source.includes('<CDXML>')), true);
  assert.equal(candidates.some((candidate) => candidate.sourceFormat === 'molfile' && candidate.source.includes('M  END')), true);
  assert.equal(candidates.some((candidate) => candidate.sourceFormat === 'smiles' && candidate.source === 'CCO'), true);
  assert.equal(candidates.some((candidate) => candidate.sourceFormat === 'image' && candidate.imageDataUrl.includes('MOCKCHEMDRAW')), true);
  assert.equal(imageCandidates[0].imageDataUrl.includes('SHARPCHEMDRAW'), true);
  const smilesDraft = clipboardModule.toChemicalStructureDraftFromCandidate(candidates.find((candidate) => candidate.sourceFormat === 'smiles'));
  assert.equal(smilesDraft.smiles, 'CCO');
  assert.equal(smilesDraft.molfile, '');
  assert.equal(smilesDraft.imageDataUrl, '');
  assert.equal(
    clipboardModule.toChemicalStructureDraftFromCandidate(candidates.find((candidate) => candidate.sourceFormat === 'molfile')).molfile.includes('M  END'),
    true
  );
  assert.equal(
    clipboardModule.toChemicalStructureDraftFromCandidate(candidates.find((candidate) => candidate.sourceFormat === 'image')).imageDataUrl.includes('SHARPCHEMDRAW'),
    true
  );

  const bridgeClipboard = await clipboardModule.readChemicalStructureClipboard({
    hikariApi: {
      readChemicalClipboard: async () => ({
        formats: ['com.cambridgesoft.chemdraw', 'public.tiff'],
        candidates: [
          { format: 'chemical/x-cdxml', text: '<CDXML><page id="2"/></CDXML>' },
          { format: 'image/native', imageDataUrl: 'data:image/png;base64,BRIDGEPNG' }
        ]
      })
    },
    navigatorRef: {}
  });
  const bridgeCandidates = bridgeClipboard.candidates;
  assert.equal(bridgeCandidates[0].sourceFormat, 'cdxml');
  assert.equal(bridgeCandidates.some((candidate) => candidate.sourceFormat === 'image'), true);
  assert.equal(bridgeClipboard.formats.includes('com.cambridgesoft.chemdraw'), true);

  const systemApi = require(path.join(__dirname, 'src', 'main', 'preload', 'api', 'system-api.js'));
  const nativeClipboard = systemApi.readChemicalClipboard({
    availableFormats: () => ['com.cambridgesoft.chemdraw', 'public.tiff'],
    readText: () => '',
    readHTML: () => '',
    readImage: () => ({
      isEmpty: () => false,
      toDataURL: () => 'data:image/png;base64,NATIVEPNG'
    }),
    readBuffer: (format) => Buffer.from(format.includes('cambridgesoft') ? '<CDXML><page id="3"/></CDXML>' : 'MOCKTIFF')
  }, {
    createFromBuffer: (buffer) => ({
      isEmpty: () => !buffer?.length,
      toDataURL: () => 'data:image/png;base64,CONVERTEDTIFF'
    })
  });
  assert.equal(nativeClipboard.candidates.some((candidate) => candidate.format === 'image/native' && candidate.imageDataUrl.includes('NATIVEPNG')), true);
  assert.equal(nativeClipboard.candidates.some((candidate) => candidate.format === 'com.cambridgesoft.chemdraw'), true);
  assert.equal(nativeClipboard.candidates.some((candidate) => candidate.format === 'public.tiff' && candidate.imageDataUrl.includes('CONVERTEDTIFF')), true);
});
  }
};
