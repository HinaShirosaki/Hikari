module.exports = function registerAppCollaborationAndProtocolSuitePart01(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('collaboration-management sends messages and imports protocol share links', () => {
  const document = createMockDocument([
    'message-form',
    'message-from',
    'message-to',
    'message-subject',
    'message-body',
    'inbox-email',
    'inbox-list',
    'protocol-link-input',
    'import-protocol-link-btn',
    'protocol-link-status'
  ]);
  const messageForm = document.getElementById('message-form');
  const messageFrom = document.getElementById('message-from');
  const messageTo = document.getElementById('message-to');
  const messageSubject = document.getElementById('message-subject');
  const messageBody = document.getElementById('message-body');
  const inboxEmail = document.getElementById('inbox-email');
  const inboxList = document.getElementById('inbox-list');
  const protocolLinkInput = document.getElementById('protocol-link-input');
  const importProtocolLinkBtn = document.getElementById('import-protocol-link-btn');
  const protocolLinkStatus = document.getElementById('protocol-link-status');
  wireFormReset(messageForm, [messageSubject, messageBody]);

  let persistCalls = 0;
  let importedCalls = 0;
  const tracked = [];
  const state = {
    members: [
      { id: 'm1', hikariEmail: 'alice@hikari.test' },
      { id: 'm2', hikariEmail: 'bob@hikari.test' }
    ],
    messages: [],
    protocols: []
  };

  const collaborationModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'collaboration-management', 'index.js'), {
    document,
    atob: atobPolyfill,
    TextDecoder,
    Uint8Array
  });
  const collaboration = collaborationModule.initCollaborationManagement({
    state,
    persist: () => {
      persistCalls += 1;
    },
    createId: (() => {
      let idx = 0;
      return () => `id-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onProtocolsImported: () => {
      importedCalls += 1;
    },
    trackGrowthEvent: (_state, name, props) => {
      tracked.push({ name, props });
    }
  });

  collaboration.renderEmailSelectors();

  messageFrom.value = 'alice@hikari.test';
  messageTo.value = 'bob@hikari.test';
  messageSubject.value = 'Status Update';
  messageBody.value = 'Workflow complete.';
  trigger(messageForm, 'submit');

  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].subject, 'Status Update');
  assert.equal(messageFrom.value, 'alice@hikari.test');
  assert.equal(messageTo.value, 'bob@hikari.test');

  inboxEmail.value = 'bob@hikari.test';
  trigger(inboxEmail, 'change');
  assert.match(inboxList.innerHTML, /Status Update/);

  const payload = {
    version: 1,
    type: 'protocol_share_link',
    from: 'alice@hikari.test',
    protocol: {
      id: 'proto-source',
      name: 'PCR Protocol',
      purpose: 'Amplify DNA',
      materials: ['Buffer', 'Primer'],
      steps: [{ id: 'step-1', text: 'Mix reagents', placeholders: [] }],
      troubleshooting: ''
    }
  };
  const token = encodeBase64Url(JSON.stringify(payload));
  protocolLinkInput.value = `enana://protocol-share/${token}`;
  trigger(importProtocolLinkBtn, 'click');

  assert.equal(state.protocols.length, 1);
  assert.equal(state.protocols[0].name, 'PCR Protocol');
  assert.equal(protocolLinkInput.value, '');
  assert.match(protocolLinkStatus.textContent, /Imported "PCR Protocol"/);
  assert.equal(importedCalls, 1);
  assert.equal(tracked[0].name, 'protocol_share_link_imported');

  protocolLinkInput.value = `enana://protocol-share/${token}`;
  trigger(importProtocolLinkBtn, 'click');
  assert.equal(state.protocols.length, 2);
  assert.match(state.protocols[1].name, /^PCR Protocol \(Shared Copy\)/);
  assert.equal(importedCalls, 2);

  protocolLinkInput.value = JSON.stringify([
    {
      title: 'JSON Protocol',
      purpose: 'Validate JSON import',
      materials: ['Water', 'Salt'],
      steps: [
        { step_number: 2, action: 'Incubate for [time]' },
        { step_number: 1, action: 'Add [] mL buffer' }
      ],
      troubleshooting: [
        {
          problem: 'Cloudy solution',
          possible_cause: 'Contamination',
          solution: 'Prepare a fresh buffer'
        }
      ]
    }
  ]);
  trigger(importProtocolLinkBtn, 'click');
  assert.equal(state.protocols.length, 3);
  assert.equal(state.protocols[2].name, 'JSON Protocol');
  assert.equal(state.protocols[2].purpose, 'Validate JSON import');
  assert.deepEqual(state.protocols[2].materials, ['Water', 'Salt']);
  assert.equal(state.protocols[2].steps.length, 2);
  assert.match(state.protocols[2].steps[0].text, /Add \{\{ph:/);
  assert.equal(state.protocols[2].steps[0].placeholders[0].name, 'value');
  assert.match(state.protocols[2].steps[1].text, /Incubate for \{\{ph:/);
  assert.equal(state.protocols[2].steps[1].placeholders[0].name, 'time');
  assert.match(state.protocols[2].troubleshooting, /Problem: Cloudy solution/);
  assert.match(protocolLinkStatus.textContent, /Imported "JSON Protocol"/);
  assert.equal(importedCalls, 3);

  protocolLinkInput.value = 'invalid-link';
  trigger(importProtocolLinkBtn, 'click');
  assert.match(protocolLinkStatus.textContent, /Invalid protocol link/);
  assert.ok(persistCalls >= 4);
});
test('protocol-management supports draft creation, sharing, link copy, and delete cascades', async () => {
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
    'protocol-share-status',
    'protocol-share-link-panel',
    'protocol-share-link-output',
    'protocol-list',
    'protocol-sort-field-btn',
    'protocol-sort-order-btn'
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
  let copiedText = '';
  const tracked = [];
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

  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol-management.js'), {
    document,
    TextEncoder,
    btoa: btoaPolyfill,
    navigator: {
      clipboard: {
        writeText: async (value) => {
          copiedText = String(value || '');
        }
      }
    }
  });
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
    },
    trackGrowthEvent: (_state, name, props) => {
      tracked.push({ name, props });
    }
  });

  protocol.renderShareTargets();
  assert.match(document.getElementById('protocol-share-status').textContent, /Click Share/);

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
  const shareBtn = protocolList.querySelectorAll('[data-protocol-share]')[0];
  trigger(shareBtn, 'click');

  const shareSelect = protocolList.querySelectorAll('[data-protocol-share-select]')[0];
  shareSelect.value = 'teammate@hikari.test';
  trigger(shareSelect, 'change');

  const confirmShareBtn = protocolList.querySelectorAll('[data-protocol-share-confirm]')[0];
  trigger(confirmShareBtn, 'click');
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].type, 'protocol_share');
  assert.match(state.messages[0].payload.shareLink, /^hikari:\/\/protocol-share\//);
  assert.equal(tracked[0].name, 'protocol_share_sent');

  protocol.renderList();
  const reopenedShareBtn = protocolList.querySelectorAll('[data-protocol-share]')[0];
  trigger(reopenedShareBtn, 'click');

  const copyLinkBtn = protocolList.querySelectorAll('[data-protocol-copy-link]')[0];
  trigger(copyLinkBtn, 'click');
  await flushAsync();

  assert.equal(copiedText, state.messages[0].payload.shareLink);
  assert.equal(tracked[1].name, 'protocol_share_link_copied');
  assert.equal(document.getElementById('protocol-share-link-panel').hidden, false);
  assert.equal(document.getElementById('protocol-share-link-output').value, copiedText);
  assert.match(document.getElementById('protocol-share-status').textContent, /Copied a share link/);

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
  assert.ok(persistCalls >= 3);
  assert.ok(importedCalls >= 2);
});
test('protocol-management shows JSON import on create and hides it on edit', async () => {
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
    'protocol-share-status',
    'protocol-share-link-panel',
    'protocol-share-link-output',
    'protocol-list',
    'protocol-sort-field-btn',
    'protocol-sort-order-btn'
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
  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol-management.js'), {
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
  assert.equal(document.getElementById('protocol-generate-btn').hidden, false);

  document.getElementById('protocol-json-import-input').value = '{"name":"Imported From Create","steps":["Add buffer"]}';
  trigger(document.getElementById('import-protocol-json-btn'), 'click');
  await flushAsync();

  assert.equal(state.protocols.length, 1);
  assert.equal(state.protocols[0].name, 'Imported From Create');
  assert.match(document.getElementById('protocol-json-import-status').textContent, /Imported "Imported From Create"/);

  protocol.renderList();
  const editBtn = document.getElementById('protocol-list').querySelectorAll('[data-protocol-edit]')[0];
  trigger(editBtn, 'click');

  assert.equal(document.getElementById('protocol-json-import-panel').hidden, true);
  assert.equal(document.getElementById('protocol-generate-btn').hidden, true);
});
  }
};