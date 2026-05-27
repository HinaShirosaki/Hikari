module.exports = function registerAppAgentChatCoreSuitePart02(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('agent-chat renders python sandbox text and image outputs inline from result analysis metadata', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'rendering.js'));
  const document = createMockDocument(['agent-chat-history']);
  const history = document.getElementById('agent-chat-history');

  renderingModule.renderHistory({
    historyNode: history,
    messages: [
      {
        id: 'assistant-python-1',
        role: 'assistant',
        text: 'I plotted the assay trend and summarized the result.',
        createdAt: '2026-03-22T17:00:05.000Z',
        meta: {
          parser: {
            primary_intent: 'result_analysis',
            needs_clarification: false,
            reasoning_summary: 'This request needed a computation step.'
          },
          result_analysis: {
            status: 'completed',
            confidence: 0.88,
            confidence_label: 'high',
            rounds_executed: 1,
            citations: [],
            follow_up_questions: [],
            tool_trace: [
              {
                round: 1,
                tool_name: 'python-sandbox',
                status: 'ok',
                run_id: 'py-123',
                render_outputs: [
                  {
                    type: 'text',
                    title: 'Summary',
                    format: 'text/plain',
                    content: 'Best-fit trend increased 2.3x over baseline.'
                  },
                  {
                    type: 'image',
                    title: 'Trend Plot',
                    mime_type: 'image/png',
                    data_base64: Buffer.from('fake-image').toString('base64')
                  }
                ]
              }
            ]
          }
        }
      }
    ],
    state: {
      settings: {
        agent: {
          developerMode: false
        }
      }
    },
    safeText: shared.safeText
  });

  assert.match(history.innerHTML, /Python Sandbox Output/);
  assert.match(history.innerHTML, /Best-fit trend increased 2\.3x over baseline\./);
  assert.match(history.innerHTML, /Trend Plot/);
  assert.match(history.innerHTML, /data:image\/png;base64,ZmFrZS1pbWFnZQ==/);
});
test('agent-chat renders purchase recommendation tiles with unified image stage and ordered product metadata', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'rendering.js'));
  const document = createMockDocument(['agent-chat-history']);
  const history = document.getElementById('agent-chat-history');

  renderingModule.renderHistory({
    historyNode: history,
    messages: [
      {
        id: 'assistant-purchase-1',
        role: 'assistant',
        text: 'Found 1 purchase recommendation for your request.',
        createdAt: '2026-03-22T17:00:05.000Z',
        meta: {
          parser: {
            primary_intent: 'purchase_recommendation',
            needs_clarification: false,
            reasoning_summary: 'Find a purchasable product with explicit lab constraints.'
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
                product_url: 'https://vendor.example/item-1'
              }
            ],
            follow_up_questions: []
          }
        }
      }
    ],
    state: {
      settings: {
        agent: {
          developerMode: false
        }
      }
    },
    safeText: shared.safeText
  });

  assert.match(history.innerHTML, /agent-purchase-grid/);
  assert.match(history.innerHTML, /agent-purchase-image-wrap/);
  assert.match(history.innerHTML, /agent-purchase-image/);
  assert.match(history.innerHTML, /data-agent-open-external-url="https:\/\/vendor\.example\/item-1"/);
  assert.match(history.innerHTML, /agent-purchase-title">Endotoxin-Free Metal-Free Pipette Tips/);
  assert.match(history.innerHTML, /agent-purchase-price">\$14\.99/);
  assert.match(history.innerHTML, /agent-purchase-vendor">Lab Vendor/);
  assert.doesNotMatch(history.innerHTML, /Purchase Recommendation/);
  assert.doesNotMatch(history.innerHTML, /Purchase Filters/);
  const titleIndex = history.innerHTML.indexOf('agent-purchase-title');
  const priceIndex = history.innerHTML.indexOf('agent-purchase-price');
  const vendorIndex = history.innerHTML.indexOf('agent-purchase-vendor');
  assert.equal(titleIndex >= 0, true);
  assert.equal(titleIndex < priceIndex, true);
  assert.equal(priceIndex < vendorIndex, true);
});
  }
};