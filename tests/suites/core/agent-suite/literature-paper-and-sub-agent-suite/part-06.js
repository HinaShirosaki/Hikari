module.exports = function registerAgentLiteraturePaperAndSubAgentSuitePart06(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('paper analysis runtime summarizes a paper and extracts a protocol candidate', async () => {
      const runtime = agentPaperAnalysis.createPaperAnalysisRuntime({
        requestStructuredJsonPayload: async () => ({
          ok: true,
          payload: {
            brief_summary: 'This paper describes engineered PD-1 nanobodies and reports improved expression after purification optimization.',
            key_findings: [
              'Engineered nanobodies retained target binding.',
              'Purification changes improved recovered material.'
            ],
            method_overview: 'The authors expressed the nanobody in E. coli and purified it by Ni-NTA affinity chromatography.',
            protocol_candidate: {
              title: 'PD-1 Nanobody Purification',
              purpose: 'Purify engineered PD-1 nanobodies.',
              method_text: 'Clarify lysate, bind to Ni-NTA resin, wash, and elute with imidazole.',
              materials: ['Ni-NTA resin', 'imidazole buffer'],
              steps: ['Clarify lysate', 'Bind to resin', 'Elute with imidazole'],
              notes: 'Exact buffer composition was not fully specified.'
            },
            result_summary: 'Summarized the paper and extracted one purification procedure.'
          }
        })
      });

      const result = await runtime.analyzePaper({
        paper: {
          title: 'Engineered PD-1 Nanobodies',
          summary: 'Expression rescue and purification optimization for PD-1 nanobodies.',
          methods: [
            'Express nanobody in E. coli.',
            'Purify using Ni-NTA affinity chromatography.'
          ]
        },
        message: 'Summarize the paper and extract the protocol.',
        extract_protocol: true
      });

      assert.equal(result.ok, true);
      assert.equal(result.status, 'completed');
      assert.equal(result.paper_title, 'Engineered PD-1 Nanobodies');
      assert.match(String(result.brief_summary || ''), /engineered PD-1 nanobodies/i);
      assert.equal(Array.isArray(result.key_findings), true);
      assert.equal(result.protocol_extraction.title, 'PD-1 Nanobody Purification');
      assert.equal(result.generated_protocol, null);
      assert.match(String(result.summary || ''), /extracted one purification procedure/i);
    });
    test('paper analysis runtime can generate an import-ready protocol from extracted methods', async () => {
      let capturedProtocolInput = null;
      const runtime = agentPaperAnalysis.createPaperAnalysisRuntime({
        requestStructuredJsonPayload: async () => ({
          ok: true,
          payload: {
            brief_summary: 'The paper presents a practical purification workflow for a PD-1 nanobody construct.',
            key_findings: ['Affinity purification was central to the workflow.'],
            method_overview: 'Cells were lysed and the tagged nanobody was purified on Ni-NTA resin.',
            protocol_candidate: {
              title: 'PD-1 Nanobody Purification',
              purpose: 'Purify a tagged PD-1 nanobody.',
              method_text: 'Clarify lysate, bind to Ni-NTA resin for [time], wash, and elute.',
              materials: ['Ni-NTA resin', 'wash buffer', 'elution buffer'],
              steps: ['Clarify lysate', 'Bind to Ni-NTA resin for [time]', 'Elute bound protein'],
              notes: 'Binding duration was not explicitly stated.'
            },
            result_summary: 'Paper analysis completed and protocol candidate prepared.'
          }
        }),
        protocolGenerationRuntime: {
          generateProtocol: async (input) => {
            capturedProtocolInput = input;
            return {
              ok: true,
              status: 'generated',
              protocol: {
                id: 'protocol-generated-1',
                name: 'PD-1 Nanobody Purification',
                createdAt: '2026-03-22T12:05:00.000Z',
                updatedAt: '2026-03-22T12:05:00.000Z',
                purpose: 'Purify a tagged PD-1 nanobody.',
                materials: ['Ni-NTA resin', 'wash buffer', 'elution buffer'],
                steps: [
                  {
                    id: 'step-1',
                    text: 'Clarify lysate',
                    placeholders: []
                  }
                ],
                troubleshooting: 'Problem: Low binding; Possible cause: Short incubation; Solution: Increase contact time.'
              },
              summary: 'Generated protocol from paper analysis.'
            };
          }
        }
      });

      const result = await runtime.analyzePaper({
        paper: {
          title: 'Engineered PD-1 Nanobodies',
          summary: 'Purification-focused workflow for PD-1 nanobody constructs.',
          methods: ['Clarify lysate', 'Bind to Ni-NTA resin', 'Elute protein']
        },
        message: 'Extract the protocol and generate an importable protocol JSON.',
        extract_protocol: true,
        generate_protocol: true
      });

      assert.equal(result.ok, true);
      assert.equal(result.generated_protocol.name, 'PD-1 Nanobody Purification');
      assert.equal(result.generated_protocol.troubleshooting.includes('Low binding'), true);
      assert.equal(capturedProtocolInput.protocol.name, 'PD-1 Nanobody Purification');
      assert.match(String(capturedProtocolInput.protocol.steps.join(' ') || ''), /Ni-NTA resin/i);
      assert.equal(capturedProtocolInput.result_summary, 'The paper presents a practical purification workflow for a PD-1 nanobody construct.');
    });
    test('sub-agent runtime creates, messages, lists, and deletes managed sub-agents', async () => {
      const runtime = agentSubAgent.createAgentSubAgentRuntime({
        now: (() => {
          let index = 0;
          const values = [
            '2026-03-22T10:00:00.000Z',
            '2026-03-22T10:00:01.000Z',
            '2026-03-22T10:00:02.000Z',
            '2026-03-22T10:00:03.000Z'
          ];
          return () => values[Math.min(index++, values.length - 1)];
        })(),
        createId: () => 'subagent-fixed-1',
        runSubAgentTurn: async ({ phase, message }) => ({
          assistant_message: `${phase}: ${message}`,
          summary: `Handled ${phase}.`
        })
      });

      const created = await runtime.createSubAgent({
        name: 'paper-helper',
        system_prompt: 'You help summarize papers.',
        message: 'Read this abstract.',
        metadata: {
          task_type: 'paper-analysis'
        }
      });
      assert.equal(created.ok, true);
      assert.equal(created.status, 'created');
      assert.equal(created.agent.id, 'subagent-fixed-1');
      assert.equal(created.agent.messages.length, 2);
      assert.equal(created.agent.messages[1].role, 'assistant');

      const updated = await runtime.sendSubAgentMessage({
        agent_id: 'subagent-fixed-1',
        message: 'Now extract the main methods.'
      });
      assert.equal(updated.ok, true);
      assert.equal(updated.status, 'updated');
      assert.equal(updated.agent.messages.length, 4);
      assert.match(String(updated.agent.last_response?.assistant_message || ''), /message: Now extract/i);

      const listed = runtime.listSubAgents();
      assert.equal(listed.ok, true);
      assert.equal(listed.items.length, 1);
      assert.equal(listed.items[0].id, 'subagent-fixed-1');

      const deleted = runtime.deleteSubAgent({
        agent_id: 'subagent-fixed-1',
        reason: 'Task finished'
      });
      assert.equal(deleted.ok, true);
      assert.equal(deleted.status, 'deleted');

      const missing = runtime.getSubAgent({
        agent_id: 'subagent-fixed-1'
      });
      assert.equal(missing.ok, false);
      assert.equal(missing.status, 'missing');
    });
    test('sub-agent runtime preserves Codex session metadata for real session resumes', async () => {
      let messageTurnAgentMetadata = null;
      const runtime = agentSubAgent.createAgentSubAgentRuntime({
        now: () => '2026-03-22T10:00:00.000Z',
        createId: () => 'subagent-codex-1',
        runSubAgentTurn: async (turnInput = {}) => {
          if (turnInput.phase === 'create') {
            return {
              assistant_message: 'created in Codex',
              summary: 'created',
              metadata: {
                provider: 'codex-cli',
                real_codex_sub_agent: true,
                codex_session_id: 'codex-session-1',
                command: 'exec'
              }
            };
          }
          messageTurnAgentMetadata = turnInput.agent?.metadata || {};
          return {
            assistant_message: 'resumed in Codex',
            summary: 'resumed',
            metadata: {
              provider: 'codex-cli',
              real_codex_sub_agent: true,
              codex_session_id: 'codex-session-1',
              command: 'exec resume'
            }
          };
        }
      });

      const created = await runtime.createSubAgent({
        system_prompt: 'You are a delegated Codex helper.',
        message: 'Start the helper.'
      });
      assert.equal(created.ok, true);
      assert.equal(created.agent.metadata.codex_session_id, 'codex-session-1');
      assert.equal(created.agent.metadata.real_codex_sub_agent, true);

      const updated = await runtime.sendSubAgentMessage({
        agent_id: 'subagent-codex-1',
        message: 'Continue the helper.'
      });
      assert.equal(updated.ok, true);
      assert.equal(messageTurnAgentMetadata.codex_session_id, 'codex-session-1');
      assert.equal(updated.agent.metadata.command, 'exec resume');
    });
    test('sub-agent runtime builds a Codex prompt for delegated helper sessions', () => {
      const prompt = agentSubAgent.buildCodexSubAgentPrompt({
        phase: 'create',
        agent: {
          id: 'subagent-codex-2',
          name: 'methods-helper'
        },
        system_prompt: 'Find protocol risks.',
        message: 'Review the assay setup.',
        messages: [
          { role: 'user', text: 'Review the assay setup.' }
        ]
      });

      assert.match(prompt, /real delegated Codex sub-agent/);
      assert.match(prompt, /Sub-agent name: methods-helper/);
      assert.match(prompt, /Find protocol risks\./);
      assert.match(prompt, /Review the assay setup\./);
    });
    test('sub-agent runtime supplies the python sandbox prompt internally when task metadata requests it', async () => {
      const turns = [];
      const runtime = agentSubAgent.createAgentSubAgentRuntime({
        runSubAgentTurn: async (turnInput = {}) => {
          turns.push(turnInput);
          return {
            assistant_message: `handled ${turnInput.phase}`,
            summary: 'handled'
          };
        }
      });

      const created = await runtime.createSubAgent({
        name: 'python-sandbox-helper',
        message: 'Supervise the next run.',
        metadata: {
          task_type: 'python-sandbox'
        }
      });

      assert.equal(created.ok, true);
      assert.match(String(created.agent.system_prompt || ''), /Python sandbox supervisor sub-agent/);
      assert.match(String(turns[0]?.system_prompt || ''), /Python sandbox supervisor sub-agent/);
      assert.equal(turns[0]?.message, 'Supervise the next run.');
    });
    test('sub-agent runtime execute validates action-specific requirements', async () => {
      const runtime = agentSubAgent.createAgentSubAgentRuntime();

      const invalidCreate = await runtime.execute({
        action: 'create',
        system_prompt: '',
        message: 'hello'
      });
      assert.equal(invalidCreate.ok, false);
      assert.match(String(invalidCreate.error || ''), /system_prompt/i);

      const invalidAction = await runtime.execute({
        action: 'unknown'
      });
      assert.equal(invalidAction.ok, false);
      assert.match(String(invalidAction.error || ''), /must be one of create, message, delete, get, or list/i);
    });
    test('sub-agent runtime tracks liveness from process state instead of timeout-only age checks', async () => {
      let createIndex = 0;
      const runtime = agentSubAgent.createAgentSubAgentRuntime({
        now: () => '2026-03-22T10:10:00.000Z',
        createId: () => {
          createIndex += 1;
          return `subagent-live-${createIndex}`;
        },
        isProcessAlive: (processId) => Number(processId) === 4312,
        runSubAgentTurn: async ({ phase }) => ({
          assistant_message: `${phase} ok`,
          summary: `${phase} ok`
        })
      });

      await runtime.createSubAgent({
        system_prompt: 'Track one task.',
        message: 'Start tracking.'
      });
      runtime.startSubAgentTask({
        agent_id: 'subagent-live-1',
        task_type: 'python-sandbox',
        started_at: '2026-03-22T08:00:00.000Z',
        process_id: 4312,
        summary: 'Python still running.'
      });
      const processBacked = runtime.getSubAgent({
        agent_id: 'subagent-live-1'
      });
      assert.equal(processBacked.ok, true);
      assert.equal(processBacked.agent.liveness.live, true);
      assert.equal(processBacked.agent.liveness.state, 'running');
      assert.equal(processBacked.agent.liveness.reason, 'process_alive');

      await runtime.createSubAgent({
        system_prompt: 'Track one task.',
        message: 'Start tracking.'
      });
      runtime.startSubAgentTask({
        agent_id: 'subagent-live-2',
        task_type: 'python-sandbox',
        started_at: '2026-03-22T08:00:00.000Z',
        summary: 'Long run with no OS pid exposed yet.'
      });
      const noPid = runtime.getSubAgent({
        agent_id: 'subagent-live-2'
      });
      assert.equal(noPid.ok, true);
      assert.equal(noPid.agent.liveness.live, true);
      assert.equal(noPid.agent.liveness.state, 'running');
      assert.equal(noPid.agent.liveness.reason, 'heartbeat_observed');

      await runtime.createSubAgent({
        system_prompt: 'Track one task.',
        message: 'Start tracking.'
      });
      runtime.startSubAgentTask({
        agent_id: 'subagent-live-3',
        task_type: 'python-sandbox',
        started_at: '2026-03-22T08:00:00.000Z',
        process_id: 9999,
        summary: 'This worker exited unexpectedly.'
      });
      const dead = runtime.getSubAgent({
        agent_id: 'subagent-live-3'
      });
      assert.equal(dead.ok, true);
      assert.equal(dead.agent.liveness.live, false);
      assert.equal(dead.agent.liveness.state, 'dead');
      assert.equal(dead.agent.liveness.reason, 'process_exited');
    });
  }
};