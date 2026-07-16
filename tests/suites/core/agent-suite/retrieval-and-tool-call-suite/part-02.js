module.exports = function registerAgentRetrievalAndToolCallSuitePart02(context = {}) {
  const scope = context.scope || {};
  const toolLoading = scope.agentToolLoading || {};
  const toolExecution = scope.agentToolExecution || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('purchase recommendation runtime extracts JSON-LD products and ranks cheaper matches first', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const pages = {
        'https://vendor-a.test/filter': `
          <html>
            <head>
              <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "Product",
                  "name": "Vendor A Syringe Filter",
                  "image": "https://vendor-a.test/filter.png",
                  "brand": { "@type": "Brand", "name": "Vendor A" },
                  "offers": {
                    "@type": "Offer",
                    "priceCurrency": "USD",
                    "price": "12.50",
                    "url": "https://vendor-a.test/filter"
                  }
                }
              </script>
            </head>
            <body>metal-free endotoxin-free disposable syringe filter</body>
          </html>
        `,
        'https://vendor-b.test/filter': `
          <html>
            <head>
              <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "Product",
                  "name": "Vendor B Syringe Filter",
                  "image": "https://vendor-b.test/filter.png",
                  "brand": { "@type": "Brand", "name": "Vendor B" },
                  "offers": {
                    "@type": "Offer",
                    "priceCurrency": "USD",
                    "price": "19.99",
                    "url": "https://vendor-b.test/filter"
                  }
                }
              </script>
            </head>
            <body>metal-free endotoxin-free sterile syringe filter</body>
          </html>
        `
      };
      const runtime = createPurchaseRecommendationRuntime({
        searchWebResults: async () => ([
          { title: 'Vendor B result', url: 'https://vendor-b.test/filter' },
          { title: 'Vendor A result', url: 'https://vendor-a.test/filter' }
        ]),
        fetch: async (url) => ({
          ok: true,
          text: async () => pages[url] || ''
        })
      });

      const result = await runtime.execute({
        query: 'syringe filter',
        required_terms: ['metal-free', 'endotoxin-free'],
        budget_preference: 'cheap'
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.items.length, 2);
      assert.equal(result.items[0].title, 'Vendor A Syringe Filter');
      assert.equal(result.items[0].price_text, '$12.50');
      assert.equal(result.items[0].vendor, 'Vendor A');
      assert.equal(result.items[0].matched_requirements.includes('metal-free'), true);
      assert.equal(result.items[0].matched_requirements.includes('endotoxin-free'), true);
    });
    test('purchase recommendation runtime uses provider-layer web search when available', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const searchedQueries = [];
      const runtime = createPurchaseRecommendationRuntime({
        requestWebSearch: async ({ query, maxResults }) => {
          searchedQueries.push([query, maxResults]);
          return {
            ok: true,
            results: [
              {
                title: 'Vendor A Syringe Filter',
                url: 'https://vendor-a.test/filter',
                summary: 'Direct product detail page.',
                source_domain: 'vendor-a.test'
              }
            ],
            reasoning: 'Provider-layer search'
          };
        },
        fetch: async (url) => ({
          ok: true,
          text: async () => `
            <html>
              <head>
                <script type="application/ld+json">
                  {
                    "@context": "https://schema.org",
                    "@type": "Product",
                    "name": "Vendor A Syringe Filter",
                    "image": "https://vendor-a.test/filter.png",
                    "brand": { "@type": "Brand", "name": "Vendor A" },
                    "offers": {
                      "@type": "Offer",
                      "priceCurrency": "USD",
                      "price": "12.50",
                      "url": "https://vendor-a.test/filter"
                    }
                  }
                </script>
              </head>
              <body>endotoxin-free syringe filter</body>
            </html>
          `
        })
      });

      const result = await runtime.execute({
        provider: 'openai',
        query: 'syringe filter'
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.items.length, 1);
      assert.equal(searchedQueries.length > 0, true);
      assert.equal(result.items[0].title, 'Vendor A Syringe Filter');
    });
    test('purchase recommendation runtime uses the Codex agent web-search surface for fast search mode', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const webSearchCalls = [];
      let structuredCalls = 0;
      const runtime = createPurchaseRecommendationRuntime({
        requestStructuredJsonPayload: async () => {
          structuredCalls += 1;
          throw new Error('Structured Codex purchase helper should be skipped in fast search mode.');
        },
        requestWebSearch: async (input = {}) => {
          webSearchCalls.push(input);
          return {
            ok: true,
            results: [
              {
                title: 'Recombinant TEV Protease',
                url: 'https://vendor-tev.test/products/tev-protease',
                summary: 'Direct product detail page for recombinant TEV protease.',
                source_domain: 'vendor-tev.test'
              }
            ],
            reasoning: 'Used bridge web search.'
          };
        },
        fetch: async () => ({
          ok: true,
          text: async () => `
            <html>
              <head>
                <title>Recombinant TEV Protease</title>
                <meta name="application-name" content="Vendor TEV" />
                <link rel="canonical" href="https://vendor-tev.test/products/tev-protease" />
              </head>
              <body>
                <h1>Recombinant TEV Protease</h1>
                <img src="https://vendor-tev.test/images/tev-protease.png" />
                <div>Price $89.00</div>
                <button>Add to cart</button>
              </body>
            </html>
          `
        })
      });

      const result = await runtime.execute({
        provider: 'codex',
        model: 'gpt-5.4-mini',
        query: 'TEV protease'
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].title, 'Recombinant TEV Protease');
      assert.equal(result.items[0].vendor, 'Vendor TEV');
      assert.equal(result.items[0].price_text, '$89.00');
      assert.equal(webSearchCalls.length, 1);
      assert.match(String(webSearchCalls[0].query || ''), /TEV protease/i);
      assert.equal(structuredCalls, 0);
      assert.equal(result.diagnostics.reasoning_rounds[0].planner, 'fast_codex_heuristic');
    });
    test('purchase recommendation runtime does not fall back to direct bing search when provider-layer search is unavailable', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const runtime = createPurchaseRecommendationRuntime({
        requestWebSearch: async () => ({
          ok: false,
          error: 'Provider web search is unavailable.'
        }),
        fetch: async () => {
          throw new Error('fetch should not be used for search fallback');
        }
      });

      const result = await runtime.execute({
        provider: 'openai',
        query: 'syringe filter'
      });

      assert.equal(result.status, 'no_match');
      assert.match(String(result.summary || ''), /provider web search is unavailable/i);
      assert.equal(result.diagnostics.search_result_count, 0);
    });
    test('purchase recommendation runtime falls back to Open Graph metadata and rejects incomplete results', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const pages = {
        'https://vendor-a.test/filter': `
          <html>
            <head>
              <meta property="og:title" content="Fallback Syringe Filter" />
              <meta property="og:image" content="https://vendor-a.test/filter.png" />
              <meta property="og:site_name" content="Vendor A" />
              <meta property="product:price:amount" content="14.25" />
              <meta property="product:price:currency" content="USD" />
              <link rel="canonical" href="https://vendor-a.test/filter" />
            </head>
            <body>metal-free endotoxin-free ready to buy</body>
          </html>
        `,
        'https://vendor-b.test/filter': `
          <html>
            <head>
              <meta property="og:title" content="Incomplete Filter" />
              <meta property="og:image" content="https://vendor-b.test/filter.png" />
            </head>
            <body>metal-free endotoxin-free</body>
          </html>
        `
      };
      const runtime = createPurchaseRecommendationRuntime({
        searchWebResults: async () => ([
          { title: 'Vendor A result', url: 'https://vendor-a.test/filter' },
          { title: 'Vendor B result', url: 'https://vendor-b.test/filter' }
        ]),
        fetch: async (url) => ({
          ok: true,
          text: async () => pages[url] || ''
        })
      });

      const result = await runtime.execute({
        message: 'Find a cheap metal-free endotoxin-free syringe filter I can buy.'
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].title, 'Fallback Syringe Filter');
      assert.equal(result.items[0].vendor, 'Vendor A');
      assert.equal(result.items[0].price_text, '$14.25');
      assert.equal(result.items[0].product_url, 'https://vendor-a.test/filter');
    });
    test('purchase recommendation runtime rejects article pages with non-price meta fields and keeps real products', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const pages = {
        'https://microbenotes.test/plasmids': `
          <html>
            <head>
              <meta property="og:title" content="Plasmids: Definition, Structure, Types, and Applications" />
              <meta property="og:image" content="https://microbenotes.test/plasmids.png" />
              <meta property="og:site_name" content="Microbe Notes" />
              <meta name="twitter:data1" content="Nidhi Abhay Kulkarni" />
              <link rel="canonical" href="https://microbenotes.test/plasmids" />
            </head>
            <body>Learn about plasmid structure, replication, and applications in microbiology.</body>
          </html>
        `,
        'https://vendor-a.test/products/plasmid-miniprep-kit': `
          <html>
            <head>
              <title>Vendor A Plasmid Miniprep Kit</title>
              <meta name="application-name" content="Vendor A" />
              <link rel="canonical" href="https://vendor-a.test/products/plasmid-miniprep-kit" />
            </head>
            <body>
              <h1>Vendor A Plasmid Miniprep Kit</h1>
              <img src="https://vendor-a.test/images/plasmid-kit.png" />
              <div>Price $79.00</div>
              <button>Add to cart</button>
            </body>
          </html>
        `
      };
      const runtime = createPurchaseRecommendationRuntime({
        searchWebResults: async () => ([
          { title: 'Plasmids article', url: 'https://microbenotes.test/plasmids' },
          { title: 'Vendor A product', url: 'https://vendor-a.test/products/plasmid-miniprep-kit' }
        ]),
        fetch: async (url) => ({
          ok: true,
          text: async () => pages[url] || ''
        })
      });

      const result = await runtime.execute({
        query: 'plasmid miniprep kit'
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].title, 'Vendor A Plasmid Miniprep Kit');
      assert.equal(result.items[0].vendor, 'Vendor A');
      assert.equal(result.items[0].price_text, '$79.00');
      assert.equal(result.items[0].product_url, 'https://vendor-a.test/products/plasmid-miniprep-kit');
      assert.equal(result.items[0].candidate_reasoning?.product_gate?.is_product, true);
    });
    test('purchase recommendation runtime extracts deeper product details from shallow vendor pages', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const runtime = createPurchaseRecommendationRuntime({
        searchWebResults: async () => ([
          { title: 'Serological Pipettes', url: 'https://vendor-b.test/catalog/serological-pipettes' }
        ]),
        fetch: async () => ({
          ok: true,
          text: async () => `
            <html>
              <head>
                <title>Serological Pipettes | Vendor B</title>
                <meta name="application-name" content="Vendor B" />
                <link rel="canonical" href="https://vendor-b.test/catalog/serological-pipettes" />
              </head>
              <body>
                <h1>Serological Pipettes</h1>
                <img src="https://vendor-b.test/images/serological-pipettes.jpg" />
                <div>From $42.50</div>
                <button>Add to cart</button>
              </body>
            </html>
          `
        })
      });

      const result = await runtime.execute({
        query: 'serological pipette'
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].vendor, 'Vendor B');
      assert.equal(result.items[0].price_text, '$42.50');
      assert.equal(result.items[0].image_url, 'https://vendor-b.test/images/serological-pipettes.jpg');
      assert.equal(result.items[0].product_url, 'https://vendor-b.test/catalog/serological-pipettes');
      assert.equal(result.items[0].candidate_reasoning?.product_gate?.signals.includes('commerce_page_cues'), true);
    });
    test('purchase recommendation runtime ignores product-category echoes in required terms while keeping explicit attributes', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const runtime = createPurchaseRecommendationRuntime({
        searchWebResults: async () => ([
          { title: 'Vendor result', url: 'https://vendor-a.test/plasmid-kit' }
        ]),
        fetch: async () => ({
          ok: true,
          text: async () => `
            <html>
              <head>
                <script type="application/ld+json">
                  {
                    "@context": "https://schema.org",
                    "@type": "Product",
                    "name": "Endotoxin-Free Plasmid Maxi Kit",
                    "image": "https://vendor-a.test/plasmid-kit.png",
                    "brand": { "@type": "Brand", "name": "Vendor A" },
                    "offers": {
                      "@type": "Offer",
                      "priceCurrency": "USD",
                      "price": "149.00",
                      "url": "https://vendor-a.test/plasmid-kit"
                    }
                  }
                </script>
              </head>
              <body>endotoxin-free plasmid maxiprep purification kit for transfection</body>
            </html>
          `
        })
      });

      const result = await runtime.execute({
        query: 'endotoxin-free plasmid preparation kit',
        required_terms: ['endotoxin-free', 'plasmid preparation']
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.items.length, 1);
      assert.deepEqual(result.filters.required_terms, ['endotoxin-free']);
      assert.equal(result.items[0].title, 'Endotoxin-Free Plasmid Maxi Kit');
    });
    test('purchase recommendation runtime returns closest complete matches when strict attributes cannot all be verified', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const runtime = createPurchaseRecommendationRuntime({
        searchWebResults: async () => ([
          { title: 'Vendor result', url: 'https://vendor-a.test/plasmid-kit' }
        ]),
        fetch: async () => ({
          ok: true,
          text: async () => `
            <html>
              <head>
                <script type="application/ld+json">
                  {
                    "@context": "https://schema.org",
                    "@type": "Product",
                    "name": "Plasmid Maxi Kit",
                    "description": "High-yield plasmid purification kit for large-scale preparation.",
                    "image": "https://vendor-a.test/plasmid-kit.png",
                    "brand": { "@type": "Brand", "name": "Vendor A" },
                    "offers": {
                      "@type": "Offer",
                      "priceCurrency": "USD",
                      "price": "129.00",
                      "url": "https://vendor-a.test/plasmid-kit"
                    }
                  }
                </script>
              </head>
              <body>large-scale plasmid purification kit</body>
            </html>
          `
        })
      });

      const result = await runtime.execute({
        query: 'endotoxin-free plasmid preparation kit',
        required_terms: ['endotoxin-free']
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.match_mode, 'partial');
      assert.equal(result.items.length, 1);
      assert.match(String(result.summary || ''), /could not verify every requested attribute/i);
      assert.deepEqual(result.items[0].matched_requirements, []);
      assert.deepEqual(result.items[0].unverified_requirements, ['endotoxin-free']);
    });
    test('purchase recommendation runtime surfaces fetch failures instead of masking them as plain no-match results', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'agent-purchase-recommendation.js'));
      const runtime = createPurchaseRecommendationRuntime({
        searchWebResults: async () => ([
          { title: 'Vendor result', url: 'https://vendor-a.test/plasmid-kit' }
        ]),
        fetch: async () => {
          throw new Error('Network unavailable');
        }
      });

      const result = await runtime.execute({
        query: 'endotoxin-free plasmid preparation kit',
        required_terms: ['endotoxin-free']
      });

      assert.equal(result.status, 'no_match');
      assert.match(String(result.summary || ''), /could not retrieve vendor product pages/i);
      assert.equal(result.diagnostics.fetch_failure_count, 1);
    });
  }
};
