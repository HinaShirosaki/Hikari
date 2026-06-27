module.exports = function registerAgentRetrievalAndToolCallSuitePart01(context = {}) {
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
      assert.deepEqual(toolNames, ['inventory-lookup', 'record-lookup', 'protocol-matching', 'notebook-generation', 'notebook-draft', 'python-sandbox', 'command-line', 'web-search', 'sub-agent', 'memory', 'container', 'assay-table', 'plotly-graph', 'literature-search', 'purchase-recommendation', 'paper-download', 'paper-analysis', 'paper-search', 'protocol-generation']);
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
      assert.equal(scienceTools.tool_names.includes('container'), false);
      assert.equal(scienceTools.tool_names.includes('assay-table'), false);
      assert.equal(scienceTools.tool_names.includes('plotly-graph'), false);
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
      assert.equal(catalogTools.tool_names.includes('container'), true);
      assert.equal(catalogTools.tool_names.includes('assay-table'), true);
      assert.equal(catalogTools.tool_names.includes('plotly-graph'), true);
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

        const globallyDisabledSkills = runtime.listSkills({
          workspaceDir,
          externalSkillsEnabled: false
        });
        const visibleDisabledSkills = runtime.listSkills({
          workspaceDir,
          externalSkillsEnabled: false,
          includeDisabled: true
        });
        const individuallyDisabledPrompt = runtime.buildSkillsPromptPayload({
          workspaceDir,
          disabledExternalSkillNames: ['command-line'],
          activeSkillNames: ['command-line']
        });
        const disabledInvocation = runtime.parseSkillInvocation('/skill command-line pwd', {
          workspaceDir,
          disabledExternalSkillNames: ['command-line']
        });

        assert.equal(globallyDisabledSkills.length, 0);
        assert.equal(visibleDisabledSkills.length, 1);
        assert.equal(visibleDisabledSkills[0].settings_enabled, false);
        assert.equal(individuallyDisabledPrompt.skills_catalog_prompt, '');
        assert.equal(individuallyDisabledPrompt.active_skills_prompt, '');
        assert.equal(disabledInvocation.type, 'unknown_skill');
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });
  }
};
