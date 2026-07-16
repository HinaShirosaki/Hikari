module.exports = function registerAppCollaborationAndProtocolSuitePart01(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('protocol-management supports draft creation and delete cascades without dead share actions', () => {
  const document = createMockDocument([
    'protocol-list-panel',
    'protocol-editor-panel',
    'protocol-view-panel',
    'create-protocol-btn',
    'protocol-editor-back-btn',
    'protocol-cancel-btn',
    'protocol-view-back-btn',
    'protocol-editor-heading',
    'protocol-view-title',
    'protocol-view-content',
    'protocol-form',
    'protocol-name',
    'protocol-purpose',
    'protocol-materials',
    'protocol-steps',
    'protocol-troubleshooting',
    'add-placeholder-btn',
    'placeholder-name',
    'protocol-list',
    'protocol-sort-menu-btn',
    'protocol-sort-menu'
  ]);
  const protocolForm = document.getElementById('protocol-form');
  const protocolName = document.getElementById('protocol-name');
  const protocolPurpose = document.getElementById('protocol-purpose');
  const protocolMaterials = document.getElementById('protocol-materials');
  const protocolSteps = document.getElementById('protocol-steps');
  const protocolTroubleshooting = document.getElementById('protocol-troubleshooting');
  wireFormReset(protocolForm, [
    protocolName,
    protocolPurpose,
    protocolMaterials,
    protocolSteps,
    protocolTroubleshooting
  ]);

  let persistCalls = 0;
  let importedCalls = 0;
  const state = {
    protocols: [],
    notebookEntries: [],
    workflows: [],
    workflowTemplates: [],
    assays: [],
    gelAnalyses: [],
    messages: [],
    members: [
      { id: 'm1', hikariEmail: 'owner@hikari.test' },
      { id: 'm2', hikariEmail: 'teammate@hikari.test' }
    ],
    settings: {
      personalInfo: {
        hikariEmail: 'owner@hikari.test'
      }
    }
  };

  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol', 'index.js'), { document });
  const protocol = protocolModule.initProtocolManagement({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let idx = 0;
      return () => `protocol-id-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onProtocolsChanged: () => {
      importedCalls += 1;
    }
  });

  assert.equal(
    protocol.addDraftFromExtractedMethod({ title: 'Empty Method', steps: [] }, { title: 'Paper' }),
    false
  );

  const created = protocol.addDraftFromExtractedMethod(
    {
      title: 'Cell Prep',
      steps: ['Resuspend pellet', 'Add [volume] media'],
      citations: ['DOI:10.1000/example']
    },
    { title: 'Paper X' }
  );
  assert.equal(created, true);
  assert.match(protocolName.value, /Paper X - Cell Prep/);
  assert.match(protocolSteps.value, /Resuspend pellet/);

  const createdFromProtocolJson = protocol.addDraftFromExtractedMethod(
    {
      title: 'JSON Schema Protocol',
      purpose: 'Validate protocol-shape method ingestion',
      materials: ['Tube', 'PBS'],
      steps: [
        { step_number: 2, action: 'Incubate for [time]' },
        { step_number: 1, action: 'Add [] mL PBS' }
      ],
      troubleshooting: [
        {
          problem: 'No pellet',
          possible_cause: 'Low cell density',
          solution: 'Increase starting cells'
        }
      ]
    },
    { title: 'Paper X' }
  );
  assert.equal(createdFromProtocolJson, true);
  assert.match(protocolName.value, /Paper X - JSON Schema Protocol/);
  assert.equal(protocolPurpose.value, 'Validate protocol-shape method ingestion');
  assert.match(protocolMaterials.value, /Tube/);
  assert.match(protocolTroubleshooting.value, /Problem: No pellet/);
  assert.match(protocolSteps.value, /Add \[value\] mL PBS/);
  assert.match(protocolSteps.value, /Incubate for \[time\]/);

  trigger(protocolForm, 'submit');
  assert.equal(state.protocols.length, 1);
  assert.ok(Number.isFinite(Date.parse(state.protocols[0].createdAt)));
  assert.ok(Number.isFinite(Date.parse(state.protocols[0].updatedAt)));

  protocol.renderList();
  const protocolList = document.getElementById('protocol-list');
  assert.doesNotMatch(protocolList.innerHTML, /data-protocol-(?:share|copy-link)|data-protocol-action="share"/);

  const protocolId = state.protocols[0].id;
  state.notebookEntries = [{ id: 'entry-1', protocolId, projectId: 'project-1' }];
  state.assays = [{ id: 'assay-1', notebookEntryId: 'entry-1', projectId: 'project-1' }];
  state.gelAnalyses = [{ id: 'gel-1', notebookEntryId: 'entry-1', projectId: 'project-1' }];
  state.workflows = [{
    id: 'workflow-1',
    projectId: 'project-1',
    blocks: [
      { id: 'block-1', protocolId },
      { id: 'block-2', protocolId: 'other-protocol' }
    ],
    links: [
      { fromBlockId: 'block-1', toBlockId: 'block-2' },
      { fromBlockId: 'block-2', toBlockId: 'block-1' }
    ]
  }];
  state.workflowTemplates = [{
    id: 'template-1',
    blocks: [
      { id: 'tblock-1', protocolId },
      { id: 'tblock-2', protocolId: 'other-protocol' }
    ],
    links: [
      { fromBlockId: 'tblock-1', toBlockId: 'tblock-2' },
      { fromBlockId: 'tblock-2', toBlockId: 'tblock-1' }
    ]
  }];

  protocol.renderList();
  const deleteBtn = protocolList.querySelectorAll('[data-protocol-delete]')[0];
  trigger(deleteBtn, 'click');

  assert.equal(state.protocols.length, 0);
  assert.equal(state.notebookEntries.length, 0);
  assert.equal(state.assays[0].notebookEntryId, '');
  assert.equal(state.gelAnalyses[0].notebookEntryId, '');
  assert.deepEqual(state.workflows[0].blocks.map((item) => item.id), ['block-2']);
  assert.equal(state.workflows[0].links.length, 0);
  assert.deepEqual(state.workflowTemplates[0].blocks.map((item) => item.id), ['tblock-2']);
  assert.equal(state.workflowTemplates[0].links.length, 0);
  assert.ok(persistCalls >= 2);
  assert.ok(importedCalls >= 2);
});
test('protocol-management opens JSON import in an overlay on create and hides the launcher on edit', async () => {
  const document = createMockDocument([
    'protocol-list-panel',
    'protocol-editor-panel',
    'protocol-view-panel',
    'create-protocol-btn',
    'protocol-editor-back-btn',
    'protocol-cancel-btn',
    'protocol-view-back-btn',
    'protocol-editor-heading',
    'protocol-view-title',
    'protocol-view-content',
    'protocol-form',
    'protocol-json-import-panel',
    'open-protocol-json-import-btn',
    'protocol-json-import-overlay',
    'protocol-json-import-close-btn',
    'protocol-json-import-file',
    'protocol-json-import-input',
    'import-protocol-json-btn',
    'protocol-json-import-status',
    'protocol-name',
    'protocol-purpose',
    'protocol-materials',
    'protocol-steps',
    'protocol-troubleshooting',
    'protocol-generate-btn',
    'add-placeholder-btn',
    'placeholder-name',
    'protocol-list',
    'protocol-sort-menu-btn',
    'protocol-sort-menu'
  ]);

  const protocolForm = document.getElementById('protocol-form');
  wireFormReset(protocolForm, [
    document.getElementById('protocol-name'),
    document.getElementById('protocol-purpose'),
    document.getElementById('protocol-materials'),
    document.getElementById('protocol-steps'),
    document.getElementById('protocol-troubleshooting')
  ]);

  const state = {
    protocols: [],
    notebookEntries: [],
    workflows: [],
    workflowTemplates: [],
    assays: [],
    gelAnalyses: [],
    messages: [],
    members: [],
    settings: { personalInfo: { hikariEmail: '' } }
  };

  let nextId = 0;
  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol', 'index.js'), {
    document,
    TextEncoder,
    btoa: btoaPolyfill,
    navigator: {
      clipboard: {
        writeText: async () => {}
      }
    }
  });

  const protocol = protocolModule.initProtocolManagement({
    state,
    persist: () => {},
    createId: () => `generated-id-${nextId += 1}`,
    safeText: shared.safeText,
    onProtocolsChanged: () => {},
    trackGrowthEvent: () => {}
  });

  trigger(document.getElementById('create-protocol-btn'), 'click');
  assert.equal(document.getElementById('protocol-json-import-panel').hidden, false);
  assert.equal(document.getElementById('protocol-json-import-overlay').hidden, true);
  assert.equal(document.getElementById('protocol-generate-btn').hidden, false);

  trigger(document.getElementById('open-protocol-json-import-btn'), 'click');
  assert.equal(document.getElementById('protocol-json-import-overlay').hidden, false);

  document.getElementById('protocol-json-import-input').value = '{"name":"Imported From Create","steps":["Add buffer"]}';
  trigger(document.getElementById('import-protocol-json-btn'), 'click');
  await flushAsync();

  assert.equal(state.protocols.length, 1);
  assert.equal(state.protocols[0].name, 'Imported From Create');
  assert.match(document.getElementById('protocol-json-import-status').textContent, /Imported "Imported From Create"/);
  assert.equal(document.getElementById('protocol-json-import-overlay').hidden, true);

  trigger(document.getElementById('open-protocol-json-import-btn'), 'click');
  assert.equal(document.getElementById('protocol-json-import-overlay').hidden, false);
  trigger(document.getElementById('protocol-json-import-close-btn'), 'click');
  assert.equal(document.getElementById('protocol-json-import-overlay').hidden, true);

  protocol.renderList();
  const editBtn = document.getElementById('protocol-list').querySelectorAll('[data-protocol-edit]')[0];
  trigger(editBtn, 'click');

  assert.equal(document.getElementById('protocol-json-import-panel').hidden, true);
  assert.equal(document.getElementById('protocol-json-import-overlay').hidden, true);
  assert.equal(document.getElementById('protocol-generate-btn').hidden, true);
});
  }
};
