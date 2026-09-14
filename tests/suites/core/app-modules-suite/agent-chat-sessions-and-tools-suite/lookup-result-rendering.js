module.exports = function registerAppAgentChatSessionsAndToolsSuiteLookupResultRendering(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('agent-chat prioritizes inventory lookup summary text and renders lookup metadata panels', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const history = document.getElementById('agent-chat-history');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');

  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        provider: 'openai',
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {}
    },
    agentChat: { projectId: '', messages: [] }
  };

  const window = {
    hikariApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/hikari-data.json'
      }),
      agentChat: async () => ({
        ok: true,
        parser: {
          primary_intent: 'inventory_lookup',
          needs_clarification: false,
          clarification_reason: null,
          entities: {
            inventory_item: 'pET28a-SUMO1'
          },
          inventory_search: {
            normalized_query: 'pet28a-sumo1',
            candidate_terms: ['pet28a-sumo1'],
            aliases: [],
            search_mode: 'mixed'
          },
          protocol_candidates: [],
          reasoning_summary: 'Fallback parser reasoning.'
        },
        inventory_lookup: {
          status: 'matched',
          query: 'pet28a-sumo1',
          terms_used: ['pet28a-sumo1'],
          source: 'sqlite',
          backfilled_sql: false,
          items: [
            {
              kind: 'personal_sample',
              zone: '-20 Degree',
              id: 'sample-1',
              name: 'pET28a-SUMO1',
              location: 'Box A1'
            },
            {
              kind: 'chemical',
              zone: 'Lab Inventory',
              id: 'chem-2',
              name: 'IPTG',
              location: 'Shelf 4'
            }
          ]
        },
        notebook_lookup: {
          status: 'matched',
          query: 'transformation',
          source: 'sqlite',
          backfilled_sql: false,
          items: [
            {
              record_type: 'notebook',
              id: 'note-1',
              title: 'Transformation Run'
            }
          ]
        }
      })
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  messageInput.value = 'Where is pET28a-SUMO1?';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].meta.inventory_lookup.status, 'matched');
  assert.equal(state.agentChat.messages[1].meta.notebook_lookup.status, 'matched');
  assert.match(state.agentChat.messages[1].text, /Found 2 inventory matches/);
  assert.match(state.agentChat.messages[1].text, /location Box A1/i);
  assert.match(state.agentChat.messages[1].text, /location Shelf 4/i);
  assert.equal(/notebook match/i.test(state.agentChat.messages[1].text), false);
  assert.doesNotMatch(history.innerHTML, /Inventory Lookup/);
  assert.doesNotMatch(history.innerHTML, /Inventory Items/);
  assert.doesNotMatch(history.innerHTML, /Notebook Lookup/);
});
test('agent-chat uses notebook lookup summary when inventory lookup payload is absent', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const history = document.getElementById('agent-chat-history');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');

  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        provider: 'openai',
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {}
    },
    agentChat: { projectId: '', messages: [] }
  };

  const window = {
    hikariApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/hikari-data.json'
      }),
      agentChat: async () => ({
        ok: true,
        parser: {
          primary_intent: 'notebook_lookup',
          needs_clarification: false,
          clarification_reason: null,
          entities: {
            requested_output: 'transformation record'
          },
          inventory_search: {
            normalized_query: null,
            candidate_terms: [],
            aliases: [],
            search_mode: null
          },
          protocol_candidates: [],
          reasoning_summary: 'Fallback parser reasoning.'
        },
        notebook_lookup: {
          status: 'no_match',
          query: 'transformation record',
          source: 'sqlite',
          backfilled_sql: false,
          items: []
        }
      })
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  messageInput.value = 'Find my transformation record.';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].meta.notebook_lookup.status, 'no_match');
  assert.match(state.agentChat.messages[1].text, /No notebook matches found/);
  assert.doesNotMatch(history.innerHTML, /Notebook Lookup/);
  assert.equal(/Inventory Lookup/.test(history.innerHTML), false);
});
test('agent-chat prioritizes purchase recommendation summary, renders shopping tiles, and opens vendor pages', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const history = document.getElementById('agent-chat-history');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');
  const status = document.getElementById('agent-status');

  const openedUrls = [];
  const state = {
    projects: [{ id: 'p1', name: 'Cancer Study' }],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      llm: {
        provider: 'openai',
        model: 'gpt-5',
        apiEndpoint: 'https://api.openai.com/v1/responses',
        apiKey: 'sk-local-key'
      },
      agent: {}
    },
    agentChat: { projectId: '', messages: [] }
  };

  const window = {
    hikariApi: {
      autoSaveDataFile: async () => ({
        ok: true,
        filePath: '/tmp/hikari-data.json'
      }),
      openExternalUrl: async (url) => {
        openedUrls.push(url);
        return { ok: true, url };
      },
      agentChat: async () => ({
        ok: true,
        parser: {
          primary_intent: 'purchase_recommendation',
          needs_clarification: false,
          clarification_reason: null,
          entities: {
            product_query: 'pipette tips',
            required_attributes: 'endotoxin-free, metal-free',
            excluded_attributes: 'latex',
            budget_preference: 'cheap'
          },
          inventory_search: {
            normalized_query: null,
            candidate_terms: [],
            aliases: [],
            search_mode: null
          },
          protocol_candidates: [],
          reasoning_summary: 'Find products the user can buy that meet explicit constraints.'
        },
        purchase_recommendation: {
          status: 'matched',
          query: 'cheap endotoxin-free metal-free pipette tips',
          source: 'web',
          filters: {
            required_terms: ['endotoxin-free', 'metal-free'],
            excluded_terms: ['latex'],
            budget_preference: 'cheap'
          },
          items: [
            {
              id: 'item-1',
              title: 'Endotoxin-Free Metal-Free Pipette Tips',
              vendor: 'Lab Vendor',
              price_text: '$14.99',
              price_value: 14.99,
              currency: 'USD',
              image_url: 'https://vendor.example/item-1.png',
              product_url: 'https://vendor.example/item-1',
              source_domain: 'vendor.example',
              matched_requirements: ['endotoxin-free', 'metal-free']
            },
            {
              id: 'item-2',
              title: 'Metal-Free Filter Tips',
              vendor: 'Science Supply',
              price_text: '$19.49',
              price_value: 19.49,
              currency: 'USD',
              image_url: 'https://vendor.example/item-2.png',
              product_url: 'https://vendor.example/item-2',
              source_domain: 'vendor.example',
              matched_requirements: ['metal-free']
            }
          ],
          follow_up_questions: [],
          summary: 'Found 2 purchase recommendations for cheap endotoxin-free metal-free pipette tips.'
        },
        inventory_lookup: {
          status: 'matched',
          query: 'pipette tips',
          source: 'sqlite',
          backfilled_sql: false,
          items: [
            {
              kind: 'personal_sample',
              id: 'sample-1',
              name: 'Legacy tips',
              location: 'Drawer 4'
            }
          ]
        }
      })
    }
  };

  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `agent-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText,
    onNotebookEntriesChanged: () => {}
  });

  agent.render();
  messageInput.value = 'Find cheap endotoxin-free metal-free pipette tips.';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(state.agentChat.messages.length, 2);
  assert.equal(state.agentChat.messages[1].meta.purchase_recommendation.status, 'matched');
  assert.equal(state.agentChat.messages[1].meta.inventory_lookup.status, 'matched');
  assert.match(state.agentChat.messages[1].text, /Found 2 purchase recommendations/);
  assert.equal(/Found 1 inventory match/i.test(state.agentChat.messages[1].text), false);
  assert.match(history.innerHTML, /agent-purchase-grid/);
  assert.match(history.innerHTML, /agent-purchase-image-wrap/);
  assert.match(history.innerHTML, /agent-purchase-title">Endotoxin-Free Metal-Free Pipette Tips/);
  assert.match(history.innerHTML, /agent-purchase-price">\$14\.99/);
  assert.match(history.innerHTML, /agent-purchase-vendor">Lab Vendor/);
  assert.doesNotMatch(history.innerHTML, /Purchase Recommendation/);
  assert.doesNotMatch(history.innerHTML, /Purchase Filters/);

  const productButtons = history.querySelectorAll('[data-agent-open-external-url]');
  assert.equal(productButtons.length, 2);
  trigger(history, 'click', { target: productButtons[0] });
  await flushAsync();

  assert.deepEqual(openedUrls, ['https://vendor.example/item-1']);
  assert.equal(status.textContent, 'Opened product page.');
});
  }
};
