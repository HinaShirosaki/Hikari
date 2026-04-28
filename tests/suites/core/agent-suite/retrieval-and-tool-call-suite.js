module.exports = function registerAgentRetrievalAndToolCallSuite(context = {}) {
  const scope = context.scope || {};
  const toolLoading = scope.agentToolLoading && Object.keys(scope.agentToolLoading).length
    ? scope.agentToolLoading
    : (scope.agentToolCall || {});
  const toolExecution = scope.agentToolExecution && Object.keys(scope.agentToolExecution).length
    ? scope.agentToolExecution
    : (scope.agentToolCall || {});
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('inventory lookup runtime is reusable with fallback snapshot search', async () => {
      const runtime = agentInventoryLookup.createAgentInventoryLookupRuntime();
      const result = await runtime.executeInventoryLookup({
        message: 'Where is the Atlas construct sample?',
        parserPayload: {
          entities: {
            inventory_item: 'Atlas construct',
            compound_name: null,
            requested_output: 'location'
          },
          inventory_search: {
            normalized_query: 'Atlas construct',
            candidate_terms: ['Atlas construct', 'atlas'],
            aliases: ['construct'],
            search_mode: 'exact_then_alias_then_fuzzy'
          }
        },
        snapshot: {
          labInventory: {
            chemicals: []
          },
          inventory: {
            'Room Temp': [
              {
                id: 'box-1',
                name: 'Atlas Box',
                type: 'box81',
                location: 'Shelf 3'
              }
            ]
          },
          samples: [
            {
              id: 'sample-1',
              code: 'ATLAS-001',
              name: 'Atlas construct',
              type: 'plasmid',
              concentration: '100 ng/uL',
              notes: 'Ready for transfection',
              inventoryLink: {
                section: 'Room Temp',
                containerId: 'box-1',
                wellIndex: 7
              },
              location: {
                storageType: 'room-temp',
                shelf: 'Shelf 3',
                box: 'A7'
              }
            }
          ]
        }
      });
      assert.equal(result.status, 'matched');
      assert.equal(result.source, 'fallback_json');
      assert.equal(result.items.some((item) => item.kind === 'personal_sample'), true);
      assert.equal(result.items.some((item) => item.name === 'Atlas construct'), true);
      assert.equal(result.items.find((item) => item.name === 'Atlas construct')?.location, 'Shelf 3 / A7');
      assert.equal(result.terms_used.includes('Atlas construct'), true);
    });

    test('record lookup runtime is reusable with fallback snapshot search', async () => {
      const runtime = agentRecordLookup.createAgentRecordLookupRuntime();
      const result = await runtime.executeRecordLookup({
        message: 'Find protein purification records for Atlas.',
        parserPayload: {
          entities: {
            project_name: 'Atlas',
            protocol_name: 'Protein Purification',
            workflow_step: null,
            requested_output: 'yield',
            activity_type: 'purification'
          }
        },
        snapshot: {
          notebookEntries: [
            {
              id: 'note-1',
              protocolId: 'prot-1',
              protocolName: 'Protein Purification',
              projectId: 'proj-1',
              projectName: 'Atlas',
              result: 'Yield improved by 20%.',
              updatedAt: '2026-03-20T10:00:00.000Z'
            }
          ],
          protocols: [
            {
              id: 'prot-1',
              name: 'Protein Purification',
              purpose: 'Affinity purification flow.',
              steps: ['Bind sample', 'Wash', 'Elute']
            }
          ],
          workflows: [
            {
              id: 'wf-1',
              name: 'Atlas purification workflow',
              description: 'Chromatography handoff',
              projectId: 'proj-1',
              projectName: 'Atlas',
              blocks: [
                { text: 'Bind lysate to resin' }
              ]
            }
          ]
        }
      });
      assert.equal(result.status, 'matched');
      assert.equal(result.source, 'fallback_json');
      assert.equal(result.items.some((item) => item.record_type === 'protocol'), true);
      assert.equal(result.items.some((item) => item.record_type === 'notebook'), true);
      assert.equal(result.items.some((item) => item.linked_protocol_name === 'Protein Purification'), true);
    });

    test('agent sub-app API exposes protocol, notebook, assay, gel, and paper records for agent use', () => {
      const { AGENT_SUB_APP_API_CATALOG, createAgentSubAppApi } = require(path.join(
        __dirname,
        'src',
        'main',
        'helpers',
        'agent',
        'runtime',
        'agent-sub-app-api.js'
      ));

      const api = createAgentSubAppApi();
      assert.deepEqual(Object.keys(AGENT_SUB_APP_API_CATALOG), ['assay', 'gel', 'papers', 'protocol', 'notebook']);

      const protocolRows = api.protocol.listAgentRecords({
        snapshot: {
          protocols: [
            {
              id: 'prot-1',
              name: 'Cell Prep',
              projectId: 'proj-1',
              projectName: 'Atlas',
              purpose: 'Prepare cells for the next assay.',
              steps: [{ id: 'step-1', text: 'Seed cells.' }]
            }
          ]
        }
      });
      const notebookRows = api.notebook.listAgentRecords({
        snapshot: {
          notebookEntries: [
            {
              id: 'note-1',
              protocolId: 'prot-1',
              protocolName: 'Cell Prep',
              projectId: 'proj-1',
              projectName: 'Atlas',
              result: 'Cells looked healthy.'
            }
          ]
        }
      });
      const assayRows = api.assay.listAgentRecords({
        snapshot: {
          assays: [
            {
              id: 'assay-1',
              name: 'Viability Readout',
              projectId: 'proj-1',
              projectName: 'Atlas'
            }
          ]
        }
      });
      const gelRows = api.gel.listAgentRecords({
        snapshot: {
          gelAnalyses: [
            {
              id: 'gel-1',
              name: 'Atlas SDS-PAGE',
              projectId: 'proj-1',
              projectName: 'Atlas'
            }
          ]
        }
      });
      const paperRows = api.papers.listAgentRecords({
        snapshot: {
          papers: [
            {
              id: 'paper-1',
              title: 'Atlas SUMO1 pilot',
              summary: 'Discusses weak conjugation.',
              linkedType: 'project',
              linkedId: 'proj-1',
              linkedName: 'Atlas'
            }
          ]
        }
      });

      assert.equal(protocolRows[0].record_type, 'protocol');
      assert.equal(notebookRows[0].record_type, 'notebook');
      assert.equal(assayRows[0].record_type, 'assay');
      assert.equal(gelRows[0].record_type, 'gel');
      assert.equal(paperRows[0].record_type, 'paper');
      assert.equal(typeof api.protocol.matchForNotebook, 'function');
      assert.equal(typeof api.notebook.generateFromProtocol, 'function');
    });

    test('record lookup runtime can source paper fallback results through the agent sub-app API layer', async () => {
      const runtime = agentRecordLookup.createAgentRecordLookupRuntime({
        agentAppApi: {
          papers: {
            listAgentRecords() {
              return [
                {
                  record_type: 'paper',
                  record_id: 'paper-1',
                  title: 'Atlas SUMO1 pilot',
                  project_id: 'proj-1',
                  project_name: 'Atlas',
                  summary: 'Weak conjugation paper.',
                  linked_protocol_id: '',
                  linked_protocol_name: '',
                  updated_at: '2026-03-22T10:00:00.000Z',
                  search_text: 'atlas sumo1 pilot weak conjugation paper'
                }
              ];
            }
          }
        }
      });

      const result = await runtime.executeRecordLookup({
        message: 'Find the Atlas weak conjugation paper.',
        parserPayload: {
          entities: {
            project_name: 'Atlas',
            requested_output: 'paper'
          }
        },
        snapshot: {}
      });

      assert.equal(result.status, 'matched');
      assert.equal(result.source, 'fallback_json');
      assert.equal(result.items.some((item) => item.record_type === 'paper'), true);
      assert.equal(result.items.find((item) => item.record_type === 'paper')?.title, 'Atlas SUMO1 pilot');
    });

    test('lookup query derivation prefers the searched entity over requested output hints', () => {
      const inventoryRuntime = agentInventoryLookup.createAgentInventoryLookupRuntime();
      const recordRuntime = agentRecordLookup.createAgentRecordLookupRuntime();

      assert.equal(
        inventoryRuntime.deriveInventoryLookupQuery({
          message: 'Do we have acetic acid?',
          parserPayload: {
            entities: {
              requested_output: 'location'
            },
            inventory_search: {}
          }
        }),
        'Do we have acetic acid?'
      );

      assert.equal(
        recordRuntime.deriveRecordLookupQuery({
          message: 'Find protein purification records for Atlas.',
          parserPayload: {
            entities: {
              protocol_name: 'Protein Purification',
              project_name: 'Atlas',
              requested_output: 'yield'
            }
          }
        }),
        'Protein Purification'
      );
    });

    test('agent tool-call catalog stays in sync and prompt builders render tool metadata', () => {
      const toolNames = toolLoading.AGENT_TOOL_CATALOG.map((entry) => entry.name);
      const schemaNames = Object.keys(toolLoading.AGENT_TOOL_CALL_CATALOG).filter((name) => name !== '$defs');
      assert.deepEqual(toolNames, ['inventory-lookup', 'record-lookup', 'protocol-matching', 'notebook-generation', 'notebook-draft', 'python-sandbox', 'command-line', 'web-search', 'sub-agent', 'memory', 'literature-search', 'purchase-recommendation', 'paper-download', 'paper-analysis', 'protocol-generation']);
      assert.deepEqual(schemaNames, toolNames);
      const inventoryEntry = toolLoading.AGENT_TOOL_CATALOG.find((entry) => entry.name === 'inventory-lookup');
      const protocolEntry = toolLoading.AGENT_TOOL_CATALOG.find((entry) => entry.name === 'protocol-matching');
      const inventorySchema = toolLoading.AGENT_TOOL_CALL_CATALOG['inventory-lookup'];
      const pythonSchema = toolLoading.AGENT_TOOL_CALL_CATALOG['python-sandbox'];

      const selectionPrompt = toolLoading.buildToolSelectionPrompt({
        message: 'Find the right protocol and draft the notebook.',
        conversation: [
          { role: 'user', text: 'I ran the HEK293 transfection.' }
        ],
        parserPayload: {
          primary_intent: 'protocol_to_notebook',
          protocol_candidates: ['HEK293 Transfection']
        },
        projectName: 'Atlas'
      });
      assert.equal(selectionPrompt.includes(`- ${inventoryEntry.name}: ${inventoryEntry.description}`), true);
      assert.equal(selectionPrompt.includes(`- ${protocolEntry.name}: ${protocolEntry.description}`), true);
      assert.equal(selectionPrompt.includes(`Usage: ${inventorySchema.description}`), false);
      assert.equal(selectionPrompt.includes('Active project context: Atlas'), true);
      assert.equal(selectionPrompt.includes('Recent conversation:\n1. user: I ran the HEK293 transfection.'), true);
      assert.equal(selectionPrompt.includes('User message: Find the right protocol and draft the notebook.'), true);
      assert.equal(selectionPrompt.includes('"primary_intent": "protocol_to_notebook"'), true);
      assert.equal(selectionPrompt.includes('"protocol_candidates": [\n    "HEK293 Transfection"\n  ]'), true);

      const argumentsPrompt = toolLoading.buildToolArgumentsPrompt({
        message: 'Use inventory lookup first, then run python if needed.',
        conversation: [
          { role: 'assistant', text: 'Protocol was likely HEK293 Transfection.' }
        ],
        parserPayload: {
          primary_intent: 'protocol_to_notebook',
          protocol_candidates: ['HEK293 Transfection']
        },
        selectedToolNames: ['inventory-lookup', 'python-sandbox']
      });
      assert.equal(argumentsPrompt.includes('Selected tools in order: inventory-lookup, python-sandbox'), true);
      assert.equal(argumentsPrompt.includes('Tool: inventory-lookup'), true);
      assert.equal(argumentsPrompt.includes('Tool: python-sandbox'), true);
      assert.equal(argumentsPrompt.includes(`Detailed usage: ${inventorySchema.description}`), true);
      assert.equal(argumentsPrompt.includes(`Detailed usage: ${pythonSchema.description}`), true);
      assert.equal(argumentsPrompt.includes('Input schema JSON:'), true);
      assert.equal(argumentsPrompt.includes('"readback_paths"'), true);
      assert.equal(argumentsPrompt.includes('"sub_agent_id"'), true);
      assert.equal(argumentsPrompt.includes('Recent conversation:\n1. assistant: Protocol was likely HEK293 Transfection.'), true);
      assert.equal(argumentsPrompt.includes('"primary_intent": "protocol_to_notebook"'), true);
      assert.equal(argumentsPrompt.includes('Tool: protocol-matching'), false);
      assert.equal(Array.isArray(pythonSchema.input_schema.anyOf), true);
      assert.equal(pythonSchema.input_schema.anyOf.some((entry) => Array.isArray(entry.required) && entry.required.includes('sub_agent_id')), true);
      assert.equal(Object.prototype.hasOwnProperty.call(pythonSchema.input_schema.properties, 'feedback'), true);
      assert.equal(Object.prototype.hasOwnProperty.call(pythonSchema.input_schema.properties, 'max_repair_attempts'), true);
    });

    test('agent tool provider resolves reasoning entry tools from the catalog schemas', () => {
      const toolProvider = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-tool-provide.js'));
      const runtime = toolProvider.createAgentToolProviderRuntime();

      const scienceTools = runtime.provideTools({
        entryPoint: 'science_reasoning_entry',
        intent: 'general_science_question'
      });
      assert.equal(scienceTools.tool_names.includes('literature-search'), true);
      assert.equal(scienceTools.tool_names.includes('web-search'), true);
      assert.equal(scienceTools.tool_names.includes('python-sandbox'), true);
      assert.equal(scienceTools.tool_names.includes('record-lookup'), false);
      assert.equal(scienceTools.tool_names.includes('memory'), false);
      assert.equal(scienceTools.tool_names.includes('command-line'), false);
      assert.equal(scienceTools.tool_names.includes('notebook-generation'), false);
      assert.equal(scienceTools.tool_definitions.some((tool) => tool.name === 'literature-search'), true);
      assert.equal(scienceTools.tool_definitions.some((tool) => tool.name === 'web-search'), true);
      assert.equal(
        scienceTools.tool_definitions.find((tool) => tool.name === 'literature-search').parameters.properties.source.$ref,
        '#/$defs/literature_source'
      );

      const deepResearchTools = runtime.provideTools({
        entryPoint: 'deep_research_entry',
        intent: 'result_analysis'
      });
      assert.equal(deepResearchTools.tool_names.includes('python-sandbox'), true);
      assert.equal(deepResearchTools.tool_names.includes('record-lookup'), true);
      assert.equal(deepResearchTools.tool_names.includes('literature-search'), true);
      assert.equal(deepResearchTools.tool_names.includes('sub-agent'), true);
      assert.deepEqual(deepResearchTools.tool_definitions.map((tool) => tool.name), deepResearchTools.tool_names);

      const catalogTools = runtime.provideTools();
      assert.equal(catalogTools.tool_names.includes('inventory-lookup'), true);
      assert.equal(catalogTools.tool_names.includes('literature-search'), true);
      assert.equal(catalogTools.tool_names.includes('web-search'), true);
      assert.equal(catalogTools.tool_names.includes('command-line'), true);
      assert.equal(catalogTools.tool_names.includes('purchase-recommendation'), true);
      assert.equal(catalogTools.tool_names.includes('protocol-generation'), true);
    });

    test('command-line runtime executes focused commands and blocks mutating commands when write tools are disabled', async () => {
      const { createAgentCommandLineRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-command-line.js'));
      const runtime = createAgentCommandLineRuntime({
        defaultCwd: __dirname
      });
      const completed = await runtime.execute({
        command: `node -e "process.stdout.write('hello-world')"`
      }, {
        allowWriteTools: false
      });
      const blockedTarget = path.join(__dirname, 'tmp', 'command-line-blocked.txt');
      fs.rmSync(blockedTarget, { force: true });
      const blocked = await runtime.execute({
        command: `touch ${JSON.stringify(blockedTarget)}`
      }, {
        allowWriteTools: false
      });

      assert.equal(completed.status, 'completed');
      assert.equal(completed.stdout, 'hello-world');
      assert.equal(blocked.status, 'blocked');
      assert.equal(fs.existsSync(blockedTarget), false);
    });

    test('skill runtime loads OpenClaw-style SKILL.md files with workspace precedence and direct tool dispatch metadata', async () => {
      const { createAgentSkillRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'skills', 'agent-skill-runtime.js'));
      const tempRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'agent-skills-'));
      const homeDir = path.join(tempRoot, 'home');
      const workspaceDir = path.join(tempRoot, 'workspace');
      const personalSkillDir = path.join(homeDir, '.agents', 'skills', 'command-line');
      const workspaceSkillDir = path.join(workspaceDir, 'skills', 'command-line');
      await fsPromises.mkdir(personalSkillDir, { recursive: true });
      await fsPromises.mkdir(workspaceSkillDir, { recursive: true });
      await fsPromises.writeFile(path.join(personalSkillDir, 'SKILL.md'), `---
name: command-line
description: Personal copy
user-invocable: true
command-dispatch: tool
command-tool: command-line
---

Personal body
`, 'utf8');
      await fsPromises.writeFile(path.join(workspaceSkillDir, 'SKILL.md'), `---
name: command-line
description: Workspace copy
user-invocable: true
command-dispatch: tool
command-tool: command-line
---

Workspace body
`, 'utf8');

      try {
        const runtime = createAgentSkillRuntime({
          homeDir
        });
        const skills = runtime.listSkills({ workspaceDir });
        const promptPayload = runtime.buildSkillsPromptPayload({
          workspaceDir,
          activeSkillNames: ['command-line']
        });
        const invocation = runtime.parseSkillInvocation('/skill command-line pwd', { workspaceDir });

        assert.equal(skills.length, 1);
        assert.equal(skills[0].description, 'Workspace copy');
        assert.equal(promptPayload.skills_catalog_prompt.includes('command-line'), true);
        assert.equal(promptPayload.active_skills_prompt.includes('Workspace body'), true);
        assert.equal(invocation.type, 'direct_tool');
        assert.equal(invocation.tool_name, 'command-line');
        assert.equal(invocation.active_skill_names.includes('command-line'), true);
        assert.equal(invocation.raw_args, 'pwd');
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    test('purchase recommendation runtime extracts JSON-LD products and ranks cheaper matches first', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
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
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
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

    test('purchase recommendation runtime uses the simple bridge web-search api for codex fast search mode', async () => {
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
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
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
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
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
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
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
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
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
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
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
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
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
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
      const { createPurchaseRecommendationRuntime } = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-purchase-recommendation.js'));
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

    test('agent tool-call normalizes selection and arguments payloads and rejects invalid input', () => {
      const selection = toolLoading.normalizeToolSelectionPayload({
        tool_calls: [
          { tool_name: 'Inventory-Lookup', rationale: 'Need to find stock.' },
          { tool_name: 'protocol-matching', rationale: 'Need protocol choice.' }
        ],
        reasoning_summary: 'Two-step flow.'
      });
      assert.equal(selection.ok, true);
      assert.deepEqual(
        selection.payload.tool_calls.map((entry) => entry.tool_name),
        ['inventory-lookup', 'protocol-matching']
      );

      const invalidSelection = toolLoading.normalizeToolSelectionPayload({
        tool_calls: [
          { tool_name: 'inventory-lookup' },
          { tool_name: 'inventory-lookup' }
        ]
      });
      assert.equal(invalidSelection.ok, false);
      assert.match(String(invalidSelection.error || ''), /duplicate tool/i);

      const argsPayload = toolLoading.normalizeToolArgumentsPayload({
        tool_calls: [
          {
            tool_name: 'inventory-lookup',
            arguments: {
              query: 'PEI',
              limit: 5,
              inventory_search: {
                normalized_query: 'PEI',
                candidate_terms: ['PEI'],
                aliases: [],
                search_mode: 'exact_then_alias_then_fuzzy'
              }
            }
          }
        ]
      }, {
        selectedToolNames: ['inventory-lookup']
      });
      assert.equal(argsPayload.ok, true);
      assert.equal(argsPayload.payload.tool_calls[0].arguments.limit, 5);
      assert.deepEqual(
        toolLoading.normalizeToolInvocationArgs({
          input_json: JSON.stringify({ query: 'PEI', limit: 5 })
        }),
        { query: 'PEI', limit: 5 }
      );

      const invalidArgs = toolLoading.normalizeToolArgumentsPayload({
        tool_calls: [
          {
            tool_name: 'inventory-lookup',
            arguments: {
              query: 'PEI',
              limit: 'five'
            }
          }
        ]
      }, {
        selectedToolNames: ['inventory-lookup']
      });
      assert.equal(invalidArgs.ok, false);
      assert.match(String(invalidArgs.error || ''), /must be of type integer/i);
    });

    test('agent tool-call runtime supports generic executor registration without changing core dispatch logic', async () => {
      const runtime = toolExecution.createAgentToolCallRuntime({
        toolExecutors: {
          'inventory-lookup': async ({ toolName, args }) => ({
            status: 'custom',
            summary: `${toolName} handled ${args.query}.`,
            items: [
              { id: 'custom-1', name: 'custom result' }
            ]
          })
        }
      });
      assert.equal(typeof runtime.registerToolExecutor, 'function');
      assert.equal(typeof runtime.getToolExecutor, 'function');

      const result = await runtime.executeToolCall({
        tool_name: 'inventory-lookup',
        arguments: {
          query: 'override me'
        }
      }, {
        message: 'fallback',
        snapshot: {},
        parserPayload: {}
      });
      assert.equal(result.ok, true);
      assert.equal(result.result.status, 'custom');
      assert.match(String(result.summary || ''), /inventory-lookup handled override me/i);
    });

    test('agent tool-call runtime reports missing executors for schema-valid tools', async () => {
      const runtime = toolExecution.createAgentToolCallRuntime();
      const result = await runtime.executeToolCall({
        tool_name: 'inventory-lookup',
        arguments: {
          query: 'Atlas construct'
        }
      }, {
        message: 'Where is Atlas construct?',
        snapshot: {},
        parserPayload: {}
      });
      assert.equal(result.ok, false);
      assert.equal(result.tool_name, 'inventory-lookup');
      assert.match(String(result.error || ''), /No tool executor is registered/i);
    });

    test('agent tool-call runtime passes normalized context and helper services into injected executors', async () => {
      const runtime = toolExecution.createAgentToolCallRuntime({
        toolExecutors: {
          'record-lookup': async ({ toolName, args, context, services }) => ({
            status: 'handled',
            summary: `${toolName} received ${args.query}.`,
            items: [
              {
                message: context.message,
                projectName: context.project.name,
                deduped: services.uniqueStrings(['Atlas', 'atlas', 'ATLAS'], 5)
              }
            ]
          })
        }
      });
      const result = await runtime.executeToolCall({
        tool_name: 'record-lookup',
        arguments: {
          query: 'Protein Purification'
        }
      }, {
        message: 'Find protein purification records for Atlas.',
        snapshot: {},
        parserPayload: {},
        project: {
          id: 'proj-1',
          name: 'Atlas'
        }
      });
      assert.equal(result.ok, true);
      assert.equal(result.tool_name, 'record-lookup');
      assert.equal(result.result.status, 'handled');
      assert.equal(result.result.items[0].message, 'Find protein purification records for Atlas.');
      assert.equal(result.result.items[0].projectName, 'Atlas');
      assert.deepEqual(result.result.items[0].deduped, ['Atlas']);
    });

    test('agent tool-call runtime supports sequential batches through injected state hooks', async () => {
      const runtime = toolExecution.createAgentToolCallRuntime({
        toolExecutors: {
          'protocol-matching': async () => ({
            status: 'selected',
            selected_protocol: {
              id: 'prot-1',
              name: 'HEK293 Transfection'
            }
          }),
          'notebook-generation': async ({ state }) => ({
            status: state.lastSelectedProtocol ? 'completed' : 'needs_more_info',
            notebook: {
              protocol: state.lastSelectedProtocol || null
            }
          })
        },
        applyToolResultState(state, envelope) {
          if (envelope.result?.selected_protocol) {
            state.lastSelectedProtocol = envelope.result.selected_protocol;
          }
          return state;
        },
        initialState: {
          lastSelectedProtocol: null
        }
      });
      const results = await runtime.executeToolCalls([
        {
          tool_name: 'protocol-matching',
          arguments: {
            protocol_candidates: ['HEK293 Transfection']
          }
        },
        {
          tool_name: 'notebook-generation',
          arguments: {
            project: {
              id: 'proj-1',
              name: 'Atlas',
              resolution_source: 'payload_project_name'
            }
          }
        }
      ], {});
      assert.equal(results.length, 2);
      assert.equal(results[0].result.selected_protocol.name, 'HEK293 Transfection');
      assert.equal(results[1].ok, true);
      assert.equal(results[1].tool_name, 'notebook-generation');
      assert.equal(results[1].result.status, 'completed');
      assert.equal(results[1].result.notebook.protocol.name, 'HEK293 Transfection');
    });

    test('agent tool-call runtime surfaces executor failures without built-in fallback behavior', async () => {
      const runtime = toolExecution.createAgentToolCallRuntime();
      const result = await runtime.executeToolCall({
        tool_name: 'python-sandbox',
        arguments: {
          code: 'print("hello")'
        }
      });
      assert.equal(result.ok, false);
      assert.equal(result.tool_name, 'python-sandbox');
      assert.match(String(result.error || ''), /No tool executor is registered/i);
    });

  }
};
