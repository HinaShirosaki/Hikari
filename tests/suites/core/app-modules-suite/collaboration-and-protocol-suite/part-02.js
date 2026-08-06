module.exports = function registerAppCollaborationAndProtocolSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('protocol-management keeps saved protocols unselected until the user opens one', () => {
  const document = createMockDocument([
    'protocol-detail-panel',
    'protocol-empty-panel',
    'protocol-editor-panel',
    'protocol-view-panel',
    'protocol-view-title',
    'protocol-view-content',
    'protocol-editor-heading',
    'protocol-view-edit-btn',
    'protocol-list',
    'protocol-sort-menu-btn',
    'protocol-sort-menu'
  ]);

  const state = {
    protocols: [
      {
        id: 'protocol-a',
        name: 'Alpha Protocol',
        purpose: '',
        materials: [],
        steps: [{ id: 'step-a', text: 'Add buffer', placeholders: [] }],
        troubleshooting: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'protocol-b',
        name: 'Beta Protocol',
        purpose: '',
        materials: [],
        steps: [{ id: 'step-b', text: 'Incubate', placeholders: [] }],
        troubleshooting: '',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z'
      }
    ],
    notebookEntries: [],
    workflows: [],
    workflowTemplates: [],
    assays: [],
    gelAnalyses: [],
    messages: [],
    members: [],
    settings: { personalInfo: { hikariEmail: '' } }
  };

  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol', 'index.js'), {
    document,
    TextEncoder,
    btoa: btoaPolyfill
  });
  const protocol = protocolModule.initProtocolManagement({
    state,
    persist: () => {},
    createId: () => 'generated-id',
    safeText: shared.safeText,
    onProtocolsChanged: () => {},
    trackGrowthEvent: () => {}
  });

  protocol.renderList();
  const protocolList = document.getElementById('protocol-list');
  assert.equal(protocolList.innerHTML.includes('protocol-list-row-selected'), false);
  assert.equal(document.getElementById('protocol-detail-panel').dataset.mode, 'empty');

  const firstRow = protocolList.querySelectorAll('[data-protocol-select]')[0];
  trigger(firstRow, 'click');

  assert.equal((protocolList.innerHTML.match(/protocol-list-row-selected/g) || []).length, 1);
  assert.match(protocolList.innerHTML, /protocol-list-row-selected list-row-selected"[\s\S]*data-protocol-select="protocol-a"/);
  assert.equal(document.getElementById('protocol-detail-panel').dataset.mode, 'view');

  trigger(document.getElementById('protocol-view-edit-btn'), 'click');
  assert.equal(document.getElementById('protocol-detail-panel').dataset.mode, 'edit');
  assert.equal(document.getElementById('protocol-editor-heading').textContent, 'Edit Protocol');
});
test('protocol-management generates a protocol from the create editor overlay', async () => {
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
    'protocol-generate-btn',
    'protocol-generate-input-overlay',
    'protocol-generate-prompt-input',
    'protocol-generate-attachment-input',
    'protocol-generate-attachment-list',
    'protocol-generate-input-status',
    'protocol-generate-attach-btn',
    'protocol-generate-send-btn',
    'protocol-generate-close-btn',
    'protocol-generate-result-overlay',
    'protocol-generate-result-close-btn',
    'protocol-generate-result-preview',
    'protocol-generate-status',
    'protocol-generate-apply-btn',
    'protocol-generate-back-btn',
    'protocol-polish-btn',
    'protocol-polish-overlay',
    'protocol-polish-close-btn',
    'protocol-polish-keep-editing-btn',
    'protocol-polish-apply-btn',
    'protocol-polish-original-preview',
    'protocol-polish-result-preview',
    'protocol-polish-status',
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

  const state = {
    protocols: [],
    notebookEntries: [],
    workflows: [],
    workflowTemplates: [],
    assays: [],
    gelAnalyses: [],
    messages: [],
    members: [],
    settings: {
      personalInfo: { hikariEmail: '' },
      llm: {
        provider: 'openai',
        model: 'gpt-4.1',
        reasoningEffort: '',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'test-key'
      }
    }
  };

  let directLlmPayload = null;
  let generatedPayload = null;
  let resolveGeneration = null;

  class MockFileReader {
    readAsDataURL(file) {
      this.result = String(file?.dataUrl || '');
      Promise.resolve().then(() => {
        this.onload?.();
      });
    }
  }

  const protocolModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'protocol', 'index.js'), {
    document,
    TextEncoder,
    FileReader: MockFileReader,
    btoa: btoaPolyfill,
    navigator: {
      clipboard: {
        writeText: async () => {}
      }
    },
    window: {
      hikariApi: {
        runDirectLlmPrompt: async (payload) => {
          directLlmPayload = payload;
          return {
            ok: true,
            payload: {
              protocol: {
                name: 'Generated Expression Protocol',
                purpose: 'Express a recombinant protein in bacteria.',
                materials: ['LB media', 'Antibiotic', 'Expression plasmid'],
                steps: [
                  'Transform the expression plasmid into competent cells.',
                  'Grow an overnight starter culture with the correct antibiotic.',
                  'Inoculate fresh media and induce expression at [temperature].'
                ],
                troubleshooting: 'Problem: low expression; Solution: reduce the induction temperature.'
              },
              result_summary: 'Generated protocol from the attached methods.'
            }
          };
        },
        agentGenerateProtocol: async (payload) => {
          generatedPayload = payload;
          return new Promise((resolve) => {
            resolveGeneration = resolve;
          });
        }
      }
    }
  });

  const protocol = protocolModule.initProtocolManagement({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `generated-id-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onProtocolsChanged: () => {},
    trackGrowthEvent: () => {}
  });

  trigger(document.getElementById('create-protocol-btn'), 'click');
  assert.equal(document.getElementById('protocol-generate-btn').hidden, false);

  trigger(document.getElementById('protocol-generate-btn'), 'click');
  assert.equal(document.getElementById('protocol-generate-input-overlay').hidden, false);

  document.getElementById('protocol-generate-prompt-input').value = 'Generate a bacterial expression protocol from the attached methods.';
  const attachmentInput = document.getElementById('protocol-generate-attachment-input');
  attachmentInput.files = [{
    name: 'methods.pdf',
    size: 2048,
    type: 'application/pdf',
    dataUrl: 'data:application/pdf;base64,AAAA'
  }];
  trigger(attachmentInput, 'change', { target: attachmentInput });
  await flushAsync();

  assert.equal(document.getElementById('protocol-generate-attachment-list').hidden, false);

  trigger(document.getElementById('protocol-generate-send-btn'), 'click');
  await flushAsync();

  assert.equal(document.getElementById('protocol-generate-input-overlay').hidden, true);
  assert.equal(document.getElementById('protocol-generate-result-overlay').hidden, false);
  assert.match(document.getElementById('protocol-generate-result-preview').innerHTML, /protocol-polish-loading-dots/);
  assert.equal(directLlmPayload.moduleId, 'protocol');
  assert.equal(directLlmPayload.task, 'protocol-generation');
  assert.match(directLlmPayload.prompt, /Generate a bacterial expression protocol from the attached methods\./);
  assert.equal(directLlmPayload.attachments.length, 1);
  assert.equal(directLlmPayload.attachments[0].name, 'methods.pdf');
  assert.match(generatedPayload.protocolJson, /Generated Expression Protocol/);
  assert.equal(generatedPayload.resultSummary, 'Generate a bacterial expression protocol from the attached methods.');

  resolveGeneration({
    ok: true,
    summary: 'Generated protocol from the attached methods.',
    protocol: {
      name: 'Generated Expression Protocol',
      purpose: 'Express a recombinant protein in bacteria.',
      materials: ['LB media', 'Antibiotic', 'Expression plasmid'],
      steps: [
        'Transform the expression plasmid into competent cells.',
        'Grow an overnight starter culture with the correct antibiotic.',
        'Inoculate fresh media and induce expression at [temperature].'
      ],
      troubleshooting: 'Problem: low expression; Solution: reduce the induction temperature.'
    }
  });
  await flushAsync();
  await flushAsync();

  assert.match(document.getElementById('protocol-generate-result-preview').innerHTML, /Generated Expression Protocol/);
  assert.equal(document.getElementById('protocol-generate-status').hidden, true);
  assert.equal(document.getElementById('protocol-generate-status').textContent, '');

  trigger(document.getElementById('protocol-generate-apply-btn'), 'click');

  assert.equal(document.getElementById('protocol-generate-result-overlay').hidden, true);
  assert.equal(protocolName.value, 'Generated Expression Protocol');
  assert.match(protocolSteps.value, /Transform the expression plasmid/);
  assert.match(protocolTroubleshooting.value, /Problem: low expression/);

  trigger(protocolForm, 'submit');

  assert.equal(state.protocols.length, 1);
  assert.equal(state.protocols[0].name, 'Generated Expression Protocol');
  protocol.renderList();
});
test('protocol-management import accepts external title/action schema without ids (including fenced LLM JSON)', () => {
  const document = createMockDocument([
    'protocol-list-panel',
    'protocol-editor-panel',
    'protocol-view-panel',
    'create-protocol-btn',
    'protocol-editor-back-btn',
    'protocol-cancel-btn',
    'protocol-view-back-btn',
    'protocol-export-pdf-btn',
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

  const llmPayload = `I extracted one protocol:\n\`\`\`json\n{\n  "title": "Protocol name",\n  "purpose": "What this protocol is used for",\n  "materials": [\n    "material 1",\n    "material 2"\n  ],\n  "steps": [\n    {\n      "step_number": 1,\n      "action": "Describe the step clearly and concisely."\n    },\n    {\n      "step_number": 2,\n      "action": "Add the next step. Use placeholders like [time] or [volume] where needed."\n    }\n  ],\n  "troubleshooting": [\n    {\n      "problem": "Potential issue",\n      "possible_cause": "Why it may happen",\n      "solution": "How to address it"\n    }\n  ]\n}\n\`\`\``;

  const result = protocol.importProtocolsFromJson(llmPayload, {
    notifyChanged: false,
    renderList: false
  });

  assert.equal(result.ok, true);
  assert.equal(result.importedProtocols.length, 1);
  assert.equal(state.protocols.length, 1);

  const imported = state.protocols[0];
  assert.match(imported.id, /^generated-id-/);
  assert.equal(imported.name, 'Protocol name');
  assert.equal(imported.purpose, 'What this protocol is used for');
  assert.deepEqual(imported.materials, ['material 1', 'material 2']);
  assert.equal(imported.steps.length, 2);
  assert.equal(imported.steps[0].placeholders.length, 0);
  assert.match(imported.steps[1].text, /Add the next step/);
  assert.equal(imported.steps[1].placeholders.length, 2);
  assert.equal(imported.steps[1].placeholders[0].name, 'time');
  assert.equal(imported.steps[1].placeholders[1].name, 'volume');
  assert.match(imported.troubleshooting, /Problem: Potential issue/);
});
  }
};
