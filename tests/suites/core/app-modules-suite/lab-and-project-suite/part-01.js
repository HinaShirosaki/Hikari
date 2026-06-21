module.exports = function registerAppLabAndProjectSuitePart01(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('createUid uses type:id convention', () => {
  assert.equal(objectGraph.createUid('project', 'p1'), 'project:p1');
});
test('lab-management supports member create, edit, and delete lifecycle', () => {
  const document = createMockDocument([
    'member-form',
    'member-id',
    'member-name',
    'member-institution-email',
    'member-position',
    'member-hikari-email',
    'member-cancel-btn',
    'member-cards'
  ]);
  const memberForm = document.getElementById('member-form');
  const memberId = document.getElementById('member-id');
  const memberName = document.getElementById('member-name');
  const memberInstitutionEmail = document.getElementById('member-institution-email');
  const memberPosition = document.getElementById('member-position');
  const memberHikariEmail = document.getElementById('member-hikari-email');
  const memberCards = document.getElementById('member-cards');
  wireFormReset(memberForm, [memberName, memberInstitutionEmail, memberPosition, memberHikariEmail]);

  let persistCalls = 0;
  const state = { members: [] };
  const labManagementModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'lab-management.js'), {
    document
  });
  const labManagement = labManagementModule.initLabManagement({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: () => 'member-1',
    safeText: shared.safeText
  });

  memberName.value = '  Alice <Admin>  ';
  memberInstitutionEmail.value = 'alice@example.edu';
  memberPosition.value = 'PI';
  memberHikariEmail.value = 'alice@hikari.test';
  trigger(memberForm, 'submit');

  assert.equal(state.members.length, 1);
  assert.equal(state.members[0].id, 'member-1');
  assert.equal(state.members[0].name, 'Alice <Admin>');
  assert.equal(persistCalls, 1);
  assert.equal(memberId.value, '');
  assert.match(memberCards.innerHTML, /Alice &lt;Admin&gt;/);

  const editBtn = memberCards.querySelectorAll('[data-member-edit]')[0];
  trigger(editBtn, 'click');
  assert.equal(memberId.value, 'member-1');
  assert.equal(memberPosition.value, 'PI');

  memberPosition.value = 'Lab Director';
  trigger(memberForm, 'submit');
  assert.equal(state.members.length, 1);
  assert.equal(state.members[0].position, 'Lab Director');

  labManagement.render();
  const deleteBtn = memberCards.querySelectorAll('[data-member-delete]')[0];
  trigger(deleteBtn, 'click');
  assert.equal(state.members.length, 0);
  assert.match(memberCards.innerHTML, /No members yet/);
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
  assert.match(inventorySections.innerHTML, /data-well-sample-save="sample-1"/);
  assert.match(inventorySections.innerHTML, /value="chemical">Chemical/);
  assert.doesNotMatch(inventorySections.innerHTML, />Compound</);

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
test('personal-inventory fills a well by dragging a saved sample', () => {
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
        id: 'sample-drag',
        code: 'S-DRAG',
        name: 'Saved Drag Sample',
        type: 'plasmid',
        location: null,
        inventoryLink: null,
        chemicalLinks: [],
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    inventory: {
      'Room Temp': [],
      '4 Degree': [],
      '-20 Degree': [
        {
          id: 'box-drag',
          name: 'Box Drag',
          type: 'box81',
          wells: [
            { name: 'A1', content: '' },
            { name: 'A2', content: '' }
          ]
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
    createId: () => 'container-drag',
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
  assert.match(inventorySections.innerHTML, /well-saved-sample-fill-global/);
  assert.match(inventorySections.innerHTML, /data-saved-sample-drag="sample-drag"/);
  assert.match(inventorySections.innerHTML, /Select one cell to edit well and sample information/);
  const firstWellBtn = inventorySections.querySelectorAll('[data-well-index]')[0];
  firstWellBtn.dataset.section = '-20 Degree';
  firstWellBtn.dataset.containerId = 'box-drag';
  trigger(firstWellBtn, 'click');

  assert.match(inventorySections.innerHTML, /well-saved-sample-fill-global/);

  const transferStore = new Map();
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    setData(type, value) {
      transferStore.set(type, String(value));
    },
    getData(type) {
      return transferStore.get(type) || '';
    }
  };
  const sampleChip = inventorySections.querySelector('[data-saved-sample-drag]');
  const secondWellBtn = inventorySections.querySelectorAll('[data-well-index]')[1];
  secondWellBtn.dataset.section = '-20 Degree';
  secondWellBtn.dataset.containerId = 'box-drag';
  trigger(sampleChip, 'dragstart', { dataTransfer });
  trigger(secondWellBtn, 'dragover', { dataTransfer });
  assert.equal(secondWellBtn.classList.contains('well-drag-over'), true);
  trigger(secondWellBtn, 'drop', { dataTransfer });

  assert.equal(state.samples[0].inventoryLink.section, '-20 Degree');
  assert.equal(state.samples[0].inventoryLink.containerId, 'box-drag');
  assert.equal(state.samples[0].inventoryLink.wellIndex, 1);
  assert.equal(state.samples[0].location.storageType, 'freezer');
  assert.equal(state.samples[0].location.freezer, '-20 Degree');
  assert.equal(state.samples[0].location.rack, '');
  assert.equal(state.samples[0].location.box, 'Box Drag');
  assert.equal(state.samples[0].location.position, 'A2');
  assert.equal(persistCalls, 1);
  assert.equal(sampleChangedCalls, 1);
  assert.match(inventorySections.innerHTML, /Filled A2 with S-DRAG/);
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
  const clipboardModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'chemical-structure-clipboard.js'));
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
