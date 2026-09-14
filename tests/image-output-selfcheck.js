'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createAgentMcpGateway } = require('../src/main/agent/mcp-contract/gateway');
const { createAgentMcpStdioServer } = require('../src/main/agent/mcp-contract/stdio-server');
const { IMAGE_OUTPUT_MCP_TOOL, MAX_IMAGE_BYTES } = require('../src/main/agent/mcp-contract/direct-tools/image-output');
const { extractImageArtifactFromToolOutput } = require('../src/main/agent/runtime/tool-artifacts/image-output');
const { extractCodexJsonEventProgress } = require('../src/main/lib/codex-cli-provider/event-progress');
const { createCodexStreamProgressHandler } = require('../src/main/agent/codex-agent/stream-events');
const { createAgentLifecycleService } = require('../src/main/ipc/register-agent-ipc/agent-lifecycle-service');
const { registerAgentChatHandler } = require('../src/main/ipc/register-agent-ipc/agent-chat-handler');
const { createAgentChatLogRuntime } = require('../src/main/agent/context/agent-chat-log');
const observability = require('../src/main/agent/shared/agent-observability');
const { loadEsmStyleModule } = require('./support/runtime');
const { AGENT } = require('../src/shared/ipc/channels');
const root = path.resolve(__dirname, '..');
const esm = name => loadEsmStyleModule(path.join(root, 'src/renderer/modules/agent-chat', name));
const cleanText = (value, max = Infinity) => String(value || '').slice(0, max);
const safeText = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-image-contract-'));
  const storagePath = path.join(temp, 'storage');
  await fs.mkdir(storagePath);
  const png = await fs.readFile(path.join(root, 'assets/icon.png'));
  await fs.writeFile(path.join(storagePath, 'analysis.png'), png);
  const gateway = createAgentMcpGateway({ storagePath, env: {} });
  const args = { path: 'analysis.png', alt: 'Analysis result', title: '<script>test</script>', caption: 'Mean response ± SD' };
  const client = new Client({ name: 'image-test', version: '1.0' });
  const server = createAgentMcpStdioServer({ gateway, env: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    assert.deepEqual((await client.listTools()).tools.find(t => t.name === 'image_output'), IMAGE_OUTPUT_MCP_TOOL);
    const wire = await client.callTool({ name: 'image_output', arguments: args });
    assert.equal(wire.isError, false);
    assert.equal(wire.content[1].type, 'image');
    assert.deepEqual(Buffer.from(wire.content[1].data, 'base64'), png);
    assert.equal(wire.structuredContent.image_artifact.data_url, undefined);
    assert.ok(wire.content[0].text.length < 1500, 'binary is not pasted in JSON text');
    const artifact = extractImageArtifactFromToolOutput('mcp__hikari__image_output', wire);
    assert.ok(artifact?.data_url);
    assert.equal(extractImageArtifactFromToolOutput('unrelated', wire), null);
    assert.equal(extractImageArtifactFromToolOutput('image_output', { ...wire, isError: true }), null);
    const repeat = await gateway.callGatewayTool('image_output', args);
    assert.equal(repeat.image_artifact.id, artifact.id);
    const distinct = await gateway.callGatewayTool('image_output', { ...args, title: 'Second result' });
    assert.notEqual(distinct.image_artifact.id, artifact.id);
    for (const badArgs of [{ path: 'missing.png', alt: 'Missing' }, { path: 'analysis.png' }, { ...args, alt: ' ' }, { ...args, extra: true }]) {
      assert.equal((await client.callTool({ name: 'image_output', arguments: badArgs })).isError, true);
    }
    await fs.writeFile(path.join(temp, 'outside.png'), png);
    await fs.symlink(path.join(temp, 'outside.png'), path.join(storagePath, 'escape.png'));
    for (const badPath of ['../outside.png', path.join(temp, 'outside.png'), 'escape.png', '.']) {
      assert.equal((await gateway.callGatewayTool('image_output', { ...args, path: badPath })).ok, false);
    }
    await fs.writeFile(path.join(storagePath, 'fake.png'), '<svg onload="alert(1)"></svg>');
    assert.equal((await gateway.callGatewayTool('image_output', { ...args, path: 'fake.png' })).status, 'invalid_image');
    await fs.writeFile(path.join(storagePath, 'large.png'), Buffer.alloc(MAX_IMAGE_BYTES + 1));
    assert.equal((await gateway.callGatewayTool('image_output', { ...args, path: 'large.png' })).status, 'invalid_image');
    assert.equal((await gateway.callGatewayTool('image_output', args, { snapshot: { settings: { agent: { disabledMcpToolNames: ['image_output'] } } } })).status, 'disabled');
    assert.equal((await gateway.callGatewayTool('image_output', args, { projectId: 'p', snapshot: { scheduled_task: { id: 't', task_type: 'notebook_suggestion', deny_paper_download: true } } })).status, 'rejected');

    const progress = extractCodexJsonEventProgress({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'hikari', tool: 'image_output', result: wire } });
    const toolEvent = progress.find(e => e.type === 'codex_tool_call');
    assert.equal(toolEvent?.image_artifact?.id, artifact.id);
    const lifecycleService = createAgentLifecycleService({ cleanText });
    const handlers = new Map();
    const liveEvents = [];
    let failed = false;
    registerAgentChatHandler({
      ipcMain: { handle: (key, handler) => handlers.set(key, handler) }, cleanText,
      controllerUtils: {
        buildAgentLogRequestId: () => failed ? 'failed-request' : 'image-request',
        extractConversation: () => [], summarizeLlmForAgentLog: () => ({}),
        formatAgentChatLogEntry: JSON.stringify, summarizeAgentResultForLog: () => ({ ok: true })
      }, observability, agentChatLogRuntime: createAgentChatLogRuntime(),
      getAgentChatLogPath: () => path.join(temp, 'agent.log'), getAgentChatSessionStoragePath: () => storagePath,
      appendAgentChatLogEntry: async () => {}, lifecycleService: { ...lifecycleService, flushLifecycleRecorderEvents: async () => {} },
      runAgentController: async (_payload, runtime) => {
        const stream = createCodexStreamProgressHandler({ cleanText, emitAgentProgress: runtime.emitAgentProgress, lifecycleRecorder: runtime.lifecycleRecorder, recordLifecycleEvent: observability.recordLifecycleEvent });
        stream.emitStreamProgress(toolEvent);
        stream.emitStreamProgress(toolEvent); // retry/double emission must not duplicate the image
        if (failed) throw new Error('Later analysis failed');
        return { ok: true, codex_agent: { answer: 'Analysis complete.', status: 'completed' } };
      }
    });
    const result = await handlers.get(AGENT.CHAT)({ sender: { send: (_channel, event) => liveEvents.push(event) } }, { message: 'Analyze', clientRequestId: 'req' });
    assert.equal(result.ok, true);
    assert.equal(result.image_artifacts.length, 1);
    const live = esm('live-progress-state.js');
    let message = live.buildLiveAssistantPlaceholder('req', 'Analyze', () => 'id');
    for (const event of liveEvents) message = live.applyLiveProgressEvent(message, event);
    assert.equal(message.meta.image_artifacts.length, 1);
    const builder = esm('assistant-message-meta.js');
    const final = builder.buildAssistantResponseMessage({ createId: () => 'a', response: esm('response.js').normalizeAgentResponse(result), traceRows: { imageArtifacts: message.meta.image_artifacts }, messageText: 'Analyze' });
    assert.equal(final.meta.image_artifacts.length, 1);
    await fs.unlink(path.join(storagePath, 'analysis.png'));
    const loaded = await createAgentChatLogRuntime().getSession({ storagePath, sessionId: result.chat_session.id });
    assert.equal(loaded.messages.at(-1).meta.image_artifacts[0].data_url, artifact.data_url);
    const historyNode = { innerHTML: '', querySelectorAll: () => [] };
    esm('rendering.js').renderHistory({ historyNode, messages: loaded.messages, state: {}, safeText });
    assert.match(historyNode.innerHTML, /class="agent-output-image"/);
    assert.match(historyNode.innerHTML, /alt="Analysis result"/);
    assert.match(historyNode.innerHTML, /&lt;script&gt;test&lt;\/script&gt;/);
    assert.doesNotMatch(historyNode.innerHTML, /<script>/);
    const imageRenderer = esm('image-artifacts.js');
    assert.equal(imageRenderer.renderAgentImages({ image_artifacts: [{ ...artifact, data_url: 'https://example.com/private.png' }] }, safeText), '');
    assert.equal(imageRenderer.renderAgentImages({ image_artifacts: [{ ...artifact, data_url: 'data:image/svg+xml;base64,PHN2Zz4=' }] }, safeText), '');
    assert.equal(imageRenderer.mergeAgentImageArtifacts([artifact], [artifact, distinct.image_artifact]).length, 2);
    failed = true;
    const failedResult = await handlers.get(AGENT.CHAT)({}, { message: 'Analyze again' });
    assert.equal(failedResult.ok, false);
    const failedSession = await createAgentChatLogRuntime().getSession({ storagePath, sessionId: failedResult.chat_session.id });
    assert.equal(failedSession.messages.at(-1).meta.image_artifacts.length, 1, 'saved even with no progress sender and a later error');
    const contract = JSON.parse(await fs.readFile(path.join(root, 'docs/agent/mcp-contract/mcp-contract.json'), 'utf8'));
    assert.deepEqual(contract.mcp.tools.find(t => t.name === 'image_output'), IMAGE_OUTPUT_MCP_TOOL);
    console.log('Image output selfcheck passed: MCP content, validation, event transport, live/final rendering, deduplication, persisted reload, and failure recovery.');
  } finally {
    await client.close();
    await server.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
