'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createAgentMcpGateway } = require('../src/main/agent/mcp-contract/gateway');
const { createAgentMcpStdioServer } = require('../src/main/agent/mcp-contract/stdio-server');
const { HTML_OUTPUT_MCP_TOOL } = require('../src/main/agent/mcp-contract/direct-tools/html-output');
const { extractHtmlArtifactFromToolOutput } = require('../src/main/agent/runtime/tool-artifacts/html-output');
const { extractCodexJsonEventProgress } = require('../src/main/lib/codex-cli-provider/event-progress');
const { createCodexStreamProgressHandler } = require('../src/main/agent/codex-agent/stream-events');
const { createAgentLifecycleService } = require('../src/main/ipc/register-agent-ipc/agent-lifecycle-service');
const { registerAgentChatHandler } = require('../src/main/ipc/register-agent-ipc/agent-chat-handler');
const { createAgentChatLogRuntime } = require('../src/main/agent/context/agent-chat-log');
const { installHtmlPreviewService, guardHtmlPreviewNavigation, HTML_PREVIEW_CSP } = require('../src/main/agent/html-output/preview-service');
const { releaseOfficialMcpSkillsForWorkspace, getDisabledOfficialMcpSkillToolNames } = require('../src/main/agent/codex-agent/official-mcp-skills');
const observability = require('../src/main/agent/shared/agent-observability');
const { loadEsmStyleModule } = require('./support/runtime');
const { AGENT } = require('../src/shared/ipc/channels');
const root = path.resolve(__dirname, '..');
const skillRoot = path.join(root, 'src/main/agent/codex-agent/official-skills/hikari-html-output');
const esm = name => loadEsmStyleModule(path.join(root, 'src/renderer/modules/agent-chat', name));
const cleanText = (value, max = Infinity) => String(value || '').slice(0, max);
const safeText = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
async function main() {
  const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-html-contract-'));
  const gateway = createAgentMcpGateway({ storagePath, env: {} });
  const html = await fs.readFile(path.join(skillRoot, 'assets/threshold-explorer.html'), 'utf8');
  const args = { title: '<script>Explorer</script>', html, caption: '<b>Illustrative data</b>', height: 28 };
  const client = new Client({ name: 'html-test', version: '1.0' });
  const server = createAgentMcpStdioServer({ gateway, env: {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    assert.deepEqual((await client.listTools()).tools.find(t => t.name === 'html_output'), HTML_OUTPUT_MCP_TOOL);
    const wire = await client.callTool({ name: 'html_output', arguments: args });
    assert.equal(wire.isError, false);
    assert.equal(wire.content[1].type, 'resource');
    assert.equal(wire.content[1].resource.text, html);
    assert.equal(wire.structuredContent.html_artifact.html, undefined);
    assert.ok(wire.content[0].text.length < 1500);
    const artifact = extractHtmlArtifactFromToolOutput('mcp__hikari__html_output', wire);
    assert.equal(artifact.html, html);
    assert.equal(extractHtmlArtifactFromToolOutput('other', wire), null);
    assert.equal(extractHtmlArtifactFromToolOutput('html_output', { ...wire, isError: true }), null);
    const repeat = await gateway.callGatewayTool('html_output', args);
    assert.equal(repeat.html_artifact.id, artifact.id);
    for (const invalid of [{ html }, { ...args, title: '' }, { ...args, html: ' ' }, { ...args, html: '\0' }, { ...args, path: 'file.html' }, { ...args, height: 100 }, { ...args, height: 17.5 }, { ...args, html: '界'.repeat(200000) }]) {
      assert.equal((await client.callTool({ name: 'html_output', arguments: invalid })).isError, true);
    }
    const disabled = { snapshot: { settings: { agent: { disabledMcpToolNames: ['html_output'] } } } };
    assert.equal((await gateway.callGatewayTool('html_output', args, disabled)).status, 'disabled');
    assert.deepEqual(getDisabledOfficialMcpSkillToolNames('html-output', disabled), ['html_output']);
    assert.equal((await gateway.callGatewayTool('html_output', args, { projectId: 'p', snapshot: { scheduled_task: { id: 't', task_type: 'notebook_suggestion', deny_paper_download: true } } })).status, 'rejected');
    const toolEvent = extractCodexJsonEventProgress({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'hikari', tool: 'html_output', result: wire } }).find(e => e.type === 'codex_tool_call');
    assert.equal(toolEvent.html_artifact.html, html);
    const handlers = new Map(); const events = []; let failed = false;
    registerAgentChatHandler({
      ipcMain: { handle: (key, handler) => handlers.set(key, handler) }, cleanText,
      controllerUtils: { buildAgentLogRequestId: () => failed ? 'failed' : 'html-request', extractConversation: () => [], summarizeLlmForAgentLog: () => ({}), formatAgentChatLogEntry: JSON.stringify, summarizeAgentResultForLog: () => ({ ok: true }) },
      observability, agentChatLogRuntime: createAgentChatLogRuntime(), getAgentChatLogPath: () => path.join(storagePath, 'agent.log'), getAgentChatSessionStoragePath: () => storagePath,
      appendAgentChatLogEntry: async () => {}, lifecycleService: { ...createAgentLifecycleService({ cleanText }), flushLifecycleRecorderEvents: async () => {} },
      runAgentController: async (_payload, runtime) => {
        const stream = createCodexStreamProgressHandler({ cleanText, emitAgentProgress: runtime.emitAgentProgress, lifecycleRecorder: runtime.lifecycleRecorder, recordLifecycleEvent: observability.recordLifecycleEvent });
        stream.emitStreamProgress(toolEvent); stream.emitStreamProgress(toolEvent);
        if (failed) throw new Error('Later analysis failed');
        return { ok: true, codex_agent: { answer: 'Use the threshold slider.', status: 'completed' } };
      }
    });
    const result = await handlers.get(AGENT.CHAT)({ sender: { send: (_ch, event) => events.push(event) } }, { message: 'Explore', clientRequestId: 'req' });
    assert.equal(result.ok, true); assert.equal(result.html_artifacts.length, 1);
    const live = esm('live-progress-state.js');
    let message = live.buildLiveAssistantPlaceholder('req', 'Explore', () => 'id');
    for (const event of events) message = live.applyLiveProgressEvent(message, event);
    assert.equal(message.meta.html_artifacts.length, 1);
    const final = esm('assistant-message-meta.js').buildAssistantResponseMessage({ createId: () => 'a', response: esm('response.js').normalizeAgentResponse(result), traceRows: { htmlArtifacts: message.meta.html_artifacts }, messageText: 'Explore' });
    assert.equal(final.meta.html_artifacts.length, 1);
    const saved = await createAgentChatLogRuntime().getSession({ storagePath, sessionId: result.chat_session.id });
    assert.equal(saved.messages.at(-1).meta.html_artifacts[0].html, html);
    const markup = esm('html-artifacts.js').renderAgentHtml(final.meta, safeText);
    assert.match(markup, /&lt;script&gt;Explorer/); assert.doesNotMatch(markup, /<script>|<svg|srcdoc=/);
    failed = true;
    const error = await handlers.get(AGENT.CHAT)({}, { message: 'Explore again' });
    const errorSession = await createAgentChatLogRuntime().getSession({ storagePath, sessionId: error.chat_session.id });
    assert.equal(errorSession.messages.at(-1).meta.html_artifacts.length, 1);

    const owner = new EventEmitter(); owner.mainFrame = {}; const previewHandlers = new Map(); let respond;
    installHtmlPreviewService({ protocol: { handle: (_scheme, handler) => { respond = handler; } }, ipcMain: { handle: (key, handler) => previewHandlers.set(key, handler) }, getMainWindow: () => ({ webContents: owner }) });
    const prepare = previewHandlers.get(AGENT.HTML_PREVIEW);
    assert.equal(prepare({ sender: owner, senderFrame: {} }, artifact).ok, false);
    const preview = prepare({ sender: owner, senderFrame: owner.mainFrame }, artifact);
    const document = respond({ url: preview.url, method: 'GET' });
    assert.equal(await document.text(), html); assert.equal(document.headers.get('content-security-policy'), HTML_PREVIEW_CSP);
    assert.equal(respond({ url: 'hikari-html://preview/../../secret', method: 'GET' }).status, 404);
    assert.equal(respond({ url: preview.url, method: 'POST' }).status, 404);
    guardHtmlPreviewNavigation(owner); let prevented = false;
    owner.emit('will-frame-navigate', { frame: { url: preview.url }, preventDefault() { prevented = true; } }); assert.equal(prevented, true);
    owner.emit('destroyed'); assert.equal(respond({ url: preview.url, method: 'GET' }).status, 404);

    for (const workspace of [path.join(storagePath, 'root'), path.join(storagePath, 'root/project')]) {
      await releaseOfficialMcpSkillsForWorkspace(workspace);
      const released = path.join(workspace, '.agents/skills/hikari-html-output');
      for (const file of ['SKILL.md', 'references/contract.md', 'assets/threshold-explorer.html']) assert.equal(await fs.readFile(path.join(released, file), 'utf8'), await fs.readFile(path.join(skillRoot, file), 'utf8'));
      await releaseOfficialMcpSkillsForWorkspace(workspace, disabled);
      await assert.rejects(fs.access(path.join(released, 'SKILL.md')));
      await fs.writeFile(path.join(released, 'SKILL.md'), 'User-owned replacement');
      await releaseOfficialMcpSkillsForWorkspace(workspace);
      assert.equal(await fs.readFile(path.join(released, 'SKILL.md'), 'utf8'), 'User-owned replacement');
    }
    const contract = JSON.parse(await fs.readFile(path.join(root, 'docs/agent/mcp-contract/mcp-contract.json'), 'utf8'));
    assert.deepEqual(contract.mcp.tools.find(t => t.name === 'html_output'), HTML_OUTPUT_MCP_TOOL);
    console.log('HTML output selfcheck passed: MCP resource, validation, stream, saved history/error recovery, preview boundary, and root/project skill release.');
  } finally { await client.close(); await server.close(); await fs.rm(storagePath, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
