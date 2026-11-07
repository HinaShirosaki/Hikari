'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { extractPaperEvidenceFromToolOutput } = require('../src/main/agent/runtime/tool-artifacts/paper-evidence.js');
const { extractCodexJsonEventToolCall } = require('../src/main/lib/codex-cli-provider/event-progress.js');
const { createCodexStreamProgressHandler } = require('../src/main/agent/codex-agent/stream-events.js');
const { createAgentChatRequestHandler } = require('../src/main/agent/runtime/agent-chat-request.js');
const { createAgentLifecycleService } = require('../src/main/ipc/register-agent-ipc/agent-lifecycle-service.js');
const { createAgentChatLogRuntime } = require('../src/main/agent/context/agent-chat-log.js');
const { buildMcpToolResponseContent } = require('../src/main/agent/mcp-contract/result-shaping/paper-results.js');
const observability = require('../src/main/agent/shared/agent-observability.js');
const { loadEsmStyleModule } = require('./support/runtime.js');
const { mergePaperEvidence, paperEvidenceText } = require('../src/shared/paper-evidence.mjs');
const { publishPaperEvidence } = require('../src/main/agent/runtime/tool-artifacts/paper-evidence-bridge.js');
const cleanText = (value, max = Infinity) => String(value || '').slice(0, max);
const renderer = name => loadEsmStyleModule(path.resolve(__dirname, '../src/renderer/modules/agent-chat', name));

async function main() {
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-paper-evidence-'));
  try {
    const blocks = Array.from({ length: 12 }, (_, index) => ({
      block_id: `paper::lines-${index + 1}`, paper_id: 'paper', paper_title: 'A paper about binding',
      section_label: `Result ${index + 1}`, source_path: 'KnowledgeBase/papers.md/paper/paper.md',
      line_ranges: [{ start_line: 42, end_line: 161 }],
      source_lines: Array.from({ length: 120 }, (_, line) => ({
        line_number: 42 + line, content: `  ${index}:${line} ${'exact source '.repeat(20)}  `
      })),
      relevance_reason: `Explains selection ${index + 1}. <script>not markup</script>`,
      related_comments: [{ id: 'note', text: 'Check the negative control.', author: 'Researcher' }]
    }));
    const output = { ok: true, status: 'completed', loaded_context_blocks: blocks };
    const wire = { content: [{ type: 'text', text: buildMcpToolResponseContent('paper_analysis', output) }] };
    const event = extractCodexJsonEventToolCall({ type: 'item.completed', item: {
      type: 'mcp_tool_call', server: 'hikari', tool: 'paper_analysis', result: wire
    } });
    assert.equal(event.paper_evidence.length, 12);
    assert.equal(event.paper_evidence[11].source_lines[119].content, blocks[11].source_lines[119].content);
    assert.ok(event.tool_output_text.length < JSON.stringify(wire).length, 'The normal display preview is shortened');
    assert.equal(mergePaperEvidence(event.paper_evidence, event.paper_evidence).length, 12);
    assert.equal(event.paper_evidence[0].excerpt, '', 'Source lines are stored once');
    assert.equal(paperEvidenceText(event.paper_evidence[0]).split('\n').length, 120);
    assert.equal(paperEvidenceText({ excerpt: 'Plain excerpt', source_lines: [] }), 'Plain excerpt');
    assert.equal(extractPaperEvidenceFromToolOutput('other_tool', output).length, 0);
    const longReason = { ...blocks[0], relevance_reason: 'r'.repeat(300) };
    const absoluteOnly = { ...blocks[0], source_path: '', source_absolute_path: '/storage/paper.md' };
    for (const block of [longReason, absoluteOnly]) {
      const full = { ok: true, status: 'completed', delegated_research: block === absoluteOnly, loaded_context_blocks: [block] };
      const both = { content: [{ type: 'text', text: buildMcpToolResponseContent('literature_search', full) }], structuredContent: full };
      assert.equal(extractPaperEvidenceFromToolOutput('mcp__hikari__literature_search', both).length, 1, 'Structured output replaces the shorter text copy');
    }
    assert.equal(extractPaperEvidenceFromToolOutput('paper_analysis', { ...output, ok: false }).length, 0);
    assert.equal(extractPaperEvidenceFromToolOutput('paper_analysis', { ...wire, isError: true }).length, 0);
    assert.equal(extractPaperEvidenceFromToolOutput('literature_search', { output: { result: output } }).length, 12);
    assert.equal(extractPaperEvidenceFromToolOutput('paper_analysis', { content: [{ type: 'text', text: '{broken' }] }).length, 0);
    const notebook = extractPaperEvidenceFromToolOutput('notebook-lookup', { items: [{
      id: 'run-1', citation_target: 'hikari://notebook/run-1', title: 'First run', result: 'No signal in the blank.'
    }] });
    assert.equal(notebook.length, 1);

    const events = [];
    let mode = 'stream';
    let requestNumber = 0;
    const log = createAgentChatLogRuntime();
    const lifecycleService = createAgentLifecycleService({ cleanText });
    const handle = createAgentChatRequestHandler({
      activeRequests: new Map(), cleanText, lifecycleService, observability, agentChatLogRuntime: log,
      getAgentChatSessionStoragePath: () => storagePath,
      controllerUtils: {
        buildAgentLogRequestId: () => `paper-request-${++requestNumber}`,
        extractConversation: () => [], summarizeLlmForAgentLog: () => ({}), summarizeAgentResultForLog: () => ({ ok: true })
      },
      runAgentController: async (_input, runtime) => {
        if (mode.startsWith('bridge')) {
          assert.equal(publishPaperEvidence('another-request', blocks), false);
          assert.equal(publishPaperEvidence(runtime.requestId, blocks), true,
            'App evidence arrives independently of truncated exec/wait text');
          assert.equal(publishPaperEvidence(runtime.requestId, notebook), true);
        } else if (mode === 'direct') {
          observability.recordLifecycleEvent(runtime.lifecycleRecorder, {
            stage: 'tool_call_completed', status: 'ok', tool_name: 'paper-analysis', tool_output: { output: { result: output } }
          });
        } else {
          const stream = createCodexStreamProgressHandler({ cleanText, emitAgentProgress: runtime.emitAgentProgress });
          stream.emitStreamProgress(event);
          stream.emitStreamProgress(event);
        }
        if (mode.endsWith('error')) throw new Error('A later step failed');
        if (mode.endsWith('canceled')) { const error = new Error('Stopped'); error.name = 'AbortError'; throw error; }
        return { ok: true, codex_agent: { answer: 'Evidence is ready.', status: 'completed' } };
      }
    });
    for (mode of ['stream', 'direct', 'error', 'canceled', 'bridge', 'bridge-error', 'bridge-canceled']) {
      events.length = 0;
      const result = await handle({ sender: { send: (_channel, payload) => events.push(payload) } }, {
        message: 'Find supporting paper evidence.', clientRequestId: 'client'
      });
      const expected = mode.startsWith('bridge') ? 13 : 12;
      assert.equal(result.paper_evidence.length, expected, mode);
      assert.equal(publishPaperEvidence(`paper-request-${requestNumber}`, blocks), false,
        'Completed, failed and cancelled requests unsubscribe from app evidence');
      const saved = await log.getSession({ storagePath, sessionId: result.chat_session.id });
      assert.equal(saved.messages.at(-1).meta.paper_evidence.length, expected, `Saved ${mode}`);
      assert.equal(saved.messages.at(-1).meta.paper_evidence[11].source_lines[119].content, blocks[11].source_lines[119].content);
      const live = renderer('live-progress-state.js');
      let message = live.buildLiveAssistantPlaceholder('client', 'Read', () => 'id');
      for (const progress of events) message = live.applyLiveProgressEvent(message, progress);
      assert.equal(message.meta.paper_evidence.length, expected, `Live ${mode}`);
      const final = renderer('assistant-message-meta.js').buildAssistantResponseMessage({
        createId: () => 'a', response: renderer('response.js').normalizeAgentResponse(result),
        traceRows: { paperEvidence: message.meta.paper_evidence }, messageText: 'Read'
      });
      assert.equal(final.meta.paper_evidence.length, expected);
      if (mode.startsWith('bridge')) {
        assert.deepEqual(saved.messages.at(-1).meta.paper_evidence.at(-1), notebook[0]);
        assert.equal(final.meta.paper_evidence.at(-1).target, 'hikari://notebook/run-1');
      }
      assert.equal(final.meta.paper_evidence[0].related_comments[0].text, 'Check the negative control.');
    }
    console.log('Paper evidence selfcheck passed: complete MCP output, live events, direct tools, deduplication, saved history, errors and stops.');
  } finally {
    await fs.rm(storagePath, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
