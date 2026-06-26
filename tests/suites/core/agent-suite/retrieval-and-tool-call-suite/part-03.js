module.exports = function registerAgentRetrievalAndToolCallSuitePart03(context = {}) {
  const scope = context.scope || {};
  const toolLoading = scope.agentToolLoading && Object.keys(scope.agentToolLoading).length
    ? scope.agentToolLoading
    : (scope.agentToolCall || {});
  const toolExecution = scope.agentToolExecution && Object.keys(scope.agentToolExecution).length
    ? scope.agentToolExecution
    : (scope.agentToolCall || {});
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('purchase recommendation runtime retries shopping-oriented search variants when the first query is weak', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const searchQueries = [];
      const pages = {
        'https://info.test/ss320-overview': `
          <html>
            <head>
              <title>SS320 Competent Cells Overview</title>
              <meta property="og:image" content="https://info.test/ss320-overview.png" />
              <meta property="og:site_name" content="Info Notes" />
              <link rel="canonical" href="https://info.test/ss320-overview" />
            </head>
            <body>Overview and handling guide for SS320 competent cells.</body>
          </html>
        `,
        'https://vendor-c.test/products/ss320-competent-cells': `
          <html>
            <head>
              <title>SS320 E. coli Competent Cells</title>
              <meta name="application-name" content="Vendor C" />
              <link rel="canonical" href="https://vendor-c.test/products/ss320-competent-cells" />
            </head>
            <body>
              <h1>SS320 E. coli Competent Cells</h1>
              <img src="https://vendor-c.test/images/ss320.png" />
              <script>
                window.__NEXT_DATA__ = {"props":{"pageProps":{"product":{"price":"89.00","priceCurrency":"USD"}}}};
              </script>
              <button>Add to cart</button>
            </body>
          </html>
        `
      };
      const runtime = createPurchaseRecommendationRuntime({
        searchWebResults: async ({ query }) => {
          searchQueries.push(query);
          if (/product price|vendor catalog/i.test(query)) {
            return [
              { title: 'Vendor C SS320 product', url: 'https://vendor-c.test/products/ss320-competent-cells' }
            ];
          }
          return [
            { title: 'SS320 overview', url: 'https://info.test/ss320-overview' }
          ];
        },
        fetch: async (url) => ({
          ok: true,
          text: async () => pages[url] || ''
        })
      });

      const result = await runtime.execute({
        query: 'SS320 E. coli competent cells'
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].title, 'SS320 E. coli Competent Cells');
      assert.equal(result.items[0].vendor, 'Vendor C');
      assert.equal(result.items[0].price_text, '$89.00');
      assert.equal(searchQueries.some((query) => /product price|vendor catalog/i.test(query)), true);
      assert.equal(result.items[0].candidate_reasoning?.product_gate?.is_product, true);
    });
    test('purchase recommendation runtime can use llm search planning and llm product judgments for non-Codex providers', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const llmStages = [];
      const runtime = createPurchaseRecommendationRuntime({
        requestStructuredJsonPayload: async ({ stage, userPrompt }) => {
          llmStages.push(stage);
          if (stage === 'purchase_recommendation_search_plan_round_1') {
            return {
              ok: true,
              payload: {
                search_queries: ['SS320 competent cells vendor catalog'],
                reasoning: 'Search the vendor catalog first to avoid overview pages.'
              }
            };
          }
          if (stage === 'purchase_recommendation_candidate_judge' && /catalog overview/i.test(userPrompt)) {
            return {
              ok: true,
              payload: {
                is_purchasable_item: false,
                meets_requirements: false,
                matched_requirements: [],
                missing_requirements: [],
                excluded_hits: [],
                product_reason: 'This looks like a catalog overview page, not a direct product detail page.',
                requirement_reason: 'Need to inspect the linked product detail page instead.',
                likely_product_links: ['https://vendor-c.test/products/ss320-competent-cells']
              }
            };
          }
          return {
            ok: true,
            payload: {
              is_purchasable_item: true,
              meets_requirements: true,
              title: 'SS320 E. coli Competent Cells',
              vendor: 'Vendor C',
              price_text: '$89.00',
              image_url: 'https://vendor-c.test/images/ss320.png',
              product_url: 'https://vendor-c.test/products/ss320-competent-cells',
              matched_requirements: [],
              missing_requirements: [],
              excluded_hits: [],
              product_reason: 'This is a purchasable product detail page.',
              requirement_reason: 'The page matches the requested competent-cell product.',
              likely_product_links: []
            }
          };
        },
        searchWebResults: async () => ([
          { title: 'SS320 catalog overview', url: 'https://vendor-c.test/catalog/overview' }
        ]),
        fetch: async (url) => ({
          ok: true,
          text: async () => {
            if (url === 'https://vendor-c.test/catalog/overview') {
              return `
                <html>
                  <head>
                    <title>Catalog Overview</title>
                    <meta name="application-name" content="Vendor C" />
                  </head>
                  <body>
                    <h1>Catalog Overview</h1>
                    <a href="/products/ss320-competent-cells">SS320 Competent Cells</a>
                  </body>
                </html>
              `;
            }
            return `
              <html>
                <head>
                  <title>SS320 E. coli Competent Cells</title>
                  <meta name="application-name" content="Vendor C" />
                </head>
                <body>
                  <h1>SS320 E. coli Competent Cells</h1>
                  <img src="https://vendor-c.test/images/ss320.png" />
                  <div>Price $89.00</div>
                  <button>Add to cart</button>
                </body>
              </html>
            `;
          }
        })
      });

      const result = await runtime.execute({
        provider: 'openai',
        query: 'SS320 E. coli competent cells'
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].title, 'SS320 E. coli Competent Cells');
      assert.equal(result.items[0].vendor, 'Vendor C');
      assert.equal(result.items[0].price_text, '$89.00');
      assert.equal(result.items[0].candidate_reasoning?.reasoning_source, 'llm');
      assert.equal(result.diagnostics.reasoning_rounds[0].planner, 'llm');
      assert.equal(result.diagnostics.reasoning_rounds[0].followed_product_link_count > 0, true);
      assert.equal(llmStages.includes('purchase_recommendation_search_plan_round_1'), true);
      assert.equal(llmStages.includes('purchase_recommendation_candidate_judge'), true);
    });
    test('agent tool-call catalog validators reject malformed catalog data', () => {
      const missingDescriptionCatalog = toolLoading.AGENT_TOOL_CATALOG.filter((entry) => [
        'inventory-lookup',
        'record-lookup',
        'protocol-matching',
        'notebook-generation',
        'notebook-draft',
        'python-sandbox',
        'web-search',
        'sub-agent',
        'memory',
        'container',
        'literature-search',
        'paper-download',
        'paper-analysis',
        'protocol-generation'
      ].includes(entry?.name));

      assert.throws(
        () => toolLoading.validateAgentToolCatalog([
          { name: 'inventory-lookup', description: 'first' },
          { name: 'inventory-lookup', description: 'second' }
        ]),
        /duplicate tool name/i
      );

      assert.throws(
        () => toolLoading.validateAgentToolCatalog([
          { name: 'inventory-lookup' }
        ]),
        /missing description/i
      );

      assert.throws(
        () => toolLoading.validateAgentToolCallCatalog({
          $defs: {},
          'inventory-lookup': {
            description: 'inventory usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          }
        }, toolLoading.AGENT_TOOL_CATALOG),
        /missing schema for "record-lookup"/i
      );

      assert.throws(
        () => toolLoading.validateAgentToolCallCatalog({
          $defs: {},
          'inventory-lookup': {
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'record-lookup': {
            description: 'record usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'protocol-matching': {
            description: 'matching usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'notebook-generation': {
            description: 'notebook usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'notebook-draft': {
            description: 'notebook draft usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'python-sandbox': {
            description: 'python usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'web-search': {
            description: 'web search usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'sub-agent': {
            description: 'sub-agent usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          memory: {
            description: 'memory usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          container: {
            description: 'container usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'literature-search': {
            description: 'literature search usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'paper-download': {
            description: 'paper download usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'paper-analysis': {
            description: 'paper usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'protocol-generation': {
            description: 'protocol generation usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          }
        }, missingDescriptionCatalog),
        /missing description/i
      );

      assert.throws(
        () => toolLoading.validateAgentToolCallCatalog({
          $defs: {},
          'inventory-lookup': {
            description: 'inventory usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'record-lookup': {
            description: 'record usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'protocol-matching': {
            description: 'matching usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'notebook-generation': {
            description: 'notebook usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'notebook-draft': {
            description: 'notebook draft usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'python-sandbox': {
            description: 'python usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'web-search': {
            description: 'web search usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'sub-agent': {
            description: 'sub-agent usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          memory: {
            description: 'memory usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          container: {
            description: 'container usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'literature-search': {
            description: 'literature search usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'paper-download': {
            description: 'paper download usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'paper-analysis': {
            description: 'paper usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'protocol-generation': {
            description: 'protocol generation usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          },
          'made-up-tool': {
            description: 'made-up usage',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {}
            }
          }
        }, missingDescriptionCatalog),
        /unknown tool "made-up-tool"/i
      );
    });
  }
};
