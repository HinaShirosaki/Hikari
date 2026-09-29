'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { createWorkspaceFileService } = require('../src/main/agent/file-access/service');
const { createAgentMcpGateway } = require('../src/main/agent/mcp-contract/gateway');
const { registerAgentFileIpc } = require('../src/main/ipc/register-agent-file-ipc');
const { FILE_ACCESS } = require('../src/shared/ipc/channels');
const { createMainCodexService } = require('../src/main/core/services/create-codex-service');
const { buildCodexCliExecArgs, buildCodexCliExecResumeArgs } = require('../src/main/lib/codex-cli-provider/args');
const { getRequestContextFromEnv } = require('../src/main/agent/mcp-contract/stdio-server');

async function main() {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-file-access-'));
  const rootA = path.join(fixture, 'workspace');
  const rootB = path.join(fixture, 'other');
  const privateDirectory = path.join(fixture, 'appdata');
  await Promise.all([rootA, rootB, privateDirectory].map(folder => fs.mkdir(folder)));
  let root = rootA;
  let revision = 0;
  const options = { getStorageRoot: () => root, getStorageRootRevision: () => revision, privateDirectory };
  const service = createWorkspaceFileService(options);
  let token;
  const run = args => service.execute({ request_id: randomUUID(), ...args }, token);
  const session = async (write = true) => {
    const result = await service.beginSession({ id: 'test-chat', write });
    assert.equal(result.ok, true, JSON.stringify(result));
    token = result.token;
  };
  const mode = async value => {
    const status = await service.status();
    const result = await service.settings({ action: 'mode', root_id: status.root_id, mode: value });
    assert.equal(result.ok, true, JSON.stringify(result));
    await session();
  };
  const approve = async (proposal, decision = 'once') => service.review({ id: proposal.proposal_id,
    root_id: (await service.status()).root_id, decision });
  try {
    assert.equal((await service.status()).mode, 'read-only');
    const staleContext = JSON.stringify({ fileAccessToken: 'stale-other-turn' });
    assert.equal(getRequestContextFromEnv({ HIKARI_AGENT_MCP_REQUEST_CONTEXT: staleContext }).fileAccessToken, '');
    assert.equal(getRequestContextFromEnv({ HIKARI_AGENT_MCP_REQUEST_CONTEXT: staleContext, HIKARI_FILE_ACCESS_TOKEN: 'this-turn' }).fileAccessToken, 'this-turn');
    assert.equal((await service.execute({ action: 'create', path: 'bad.txt', content: 'x', allowWriteTools: true }, 'forged')).status, 'session_expired');
    await session();
    let result = await run({ action: 'create', path: 'note.txt', content: 'first\n' });
    assert.equal(result.status, 'awaiting_approval');
    const persisted = JSON.parse(await fs.readFile(path.join(privateDirectory, 'AgentFileAccess/state.json'), 'utf8'));
    assert.equal(persisted.pending.length, 0, 'pending proposal content must stay in memory only');
    await assert.rejects(fs.stat(path.join(root, 'note.txt')), { code: 'ENOENT' });
    assert.equal((await approve(result)).status, 'completed');
    assert.equal((await approve(result)).status, 'expired_proposal');
    assert.equal(await fs.readFile(path.join(root, 'note.txt'), 'utf8'), 'first\n');
    if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(root, 'note.txt'))).mode & 0o777, 0o644, 'created files must be readable like any user document');

    await mode('workspace-write');
    await fs.chmod(path.join(root, 'note.txt'), 0o666);
    const read = await run({ action: 'read', path: 'note.txt' });
    assert.equal(read.content, 'first\n');
    const write = { action: 'write', path: 'note.txt', content: 'second\n', expected_hash: read.hash, request_id: 'write-1' };
    result = await run(write);
    assert.equal(result.status, 'completed', JSON.stringify(result));
    if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(root, 'note.txt'))).mode & 0o777, 0o666, 'atomic edits must preserve mode bits despite the process umask');
    assert.deepEqual(await run(write), result, 'retries must not repeat a mutation');
    assert.equal((await run({ ...write, content: 'different' })).status, 'conflict');
    assert.equal((await run({ ...write, request_id: 'stale' })).status, 'conflict');
    assert.equal((await service.undo({ root_id: (await service.status()).root_id, id: result.id })).status, 'restored');
    assert.equal(await fs.readFile(path.join(root, 'note.txt'), 'utf8'), 'first\n');

    assert.equal((await run({ action: 'mkdir', path: 'outputs' })).status, 'completed');
    assert.equal((await run({ action: 'move', path: 'note.txt', destination: 'outputs/note.txt' })).status, 'completed');
    await fs.writeFile(path.join(root, 'outputs/.DS_Store'), 'finder');
    result = await run({ action: 'trash', path: 'outputs' });
    assert.equal(result.status, 'awaiting_approval');
    await fs.writeFile(path.join(root, 'outputs/note.txt'), 'newer');
    assert.equal((await approve(result)).status, 'conflict', 'approval must bind to the reviewed content');
    assert.equal((await approve(result, 'deny')).status, 'denied');
    result = await run({ action: 'trash', path: 'outputs' });
    const trashed = await approve(result);
    assert.equal(trashed.status, 'completed');
    await assert.rejects(fs.stat(path.join(root, 'outputs')), { code: 'ENOENT' });
    const restored = await service.undo({ root_id: (await service.status()).root_id, id: trashed.id });
    assert.equal(restored.status, 'restored', JSON.stringify(restored));
    assert.equal(await fs.readFile(path.join(root, 'outputs/note.txt'), 'utf8'), 'newer');
    assert.equal(await fs.readFile(path.join(root, 'outputs/.DS_Store'), 'utf8'), 'finder', 'Finder metadata must not block folder trash');

    for (const unsafe of ['../escape.txt', '/outside', 'C:\\outside', 'a/../../out', 'a//b', 'NUL.txt', 'bad.']) {
      assert.equal((await run({ action: 'create', path: unsafe, content: 'x' })).status, 'invalid_path', unsafe);
    }
    for (const managed of ['MEMORY.md', 'Project', 'Project/Atlas', 'Protocol/x', 'Project/Atlas/Notebook/page.json', 'test.sqlite',
      'skills/x/SKILL.md', 'Plugins/gel/x.json', 'chat_log/x.log']) {
      assert.equal((await run({ action: 'create', path: managed, content: 'x' })).status, 'managed_record', managed);
    }
    for (const protectedPath of ['Config/auth.json', '.agents/skills/x', 'outputs/.env']) {
      assert.equal((await run({ action: 'read', path: protectedPath })).status, 'protected_path');
    }
    await fs.symlink(rootB, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await run({ action: 'create', path: 'linked/escaped.txt', content: 'x' })).status, 'unsafe_link');
    await fs.writeFile(path.join(rootB, 'external.txt'), 'outside');
    await fs.link(path.join(rootB, 'external.txt'), path.join(root, 'hard.txt'));
    assert.equal((await run({ action: 'read', path: 'hard.txt' })).status, 'unsafe_link');
    const found = await run({ action: 'search', query: 'newer' });
    assert.equal(found.items[0].path, 'outputs/note.txt');
    assert.equal(found.complete, false, 'skipped links must be disclosed');

    await session(false);
    assert.equal((await run({ action: 'read', path: 'outputs/note.txt' })).ok, true);
    assert.equal((await run({ action: 'create', path: 'background.txt', content: 'x' })).status, 'read_only_run');
    await session();
    result = await run({ action: 'trash', path: 'outputs/note.txt' });
    const rootAId = (await service.status()).root_id;
    root = rootB; revision += 1;
    assert.equal((await service.review({ id: result.proposal_id, root_id: rootAId, decision: 'once' })).status, 'root_changed');
    assert.equal((await run({ action: 'read', path: 'external.txt' })).status, 'session_expired');
    root = rootA; revision += 1;
    assert.equal((await service.status()).pending.length, 0);
    await session();

    result = await service.settings({ action: 'add-location', root_id: rootAId, path: rootB });
    assert.equal(result.ok, true);
    const locationId = result.locations[0].id;
    await fs.unlink(path.join(root, 'hard.txt'));
    await session();
    assert.equal((await run({ action: 'read', location_id: locationId, path: 'external.txt' })).content, 'outside');
    assert.equal((await run({ action: 'read', location_id: 'forged', path: 'external.txt' })).status, 'outside_workspace');
    await mode('read-only');
    assert.equal((await service.status()).locations.length, 0);
    result = await run({ action: 'create', path: 'outputs/one.txt', content: 'one' });
    assert.equal((await approve(result, 'folder')).ok, true);
    assert.equal((await run({ action: 'create', path: 'outputs/two.txt', content: 'two' })).status, 'completed');
    assert.equal((await run({ action: 'trash', path: 'outputs/two.txt' })).status, 'awaiting_approval', 'folder grant is operation-specific');

    result = await run({ action: 'move', path: 'outputs/one.txt', destination: 'outputs/renamed.txt' });
    assert.equal((await approve(result, 'folder')).ok, true);
    assert.equal((await run({ action: 'move', path: 'outputs/two.txt', destination: 'outside-grant.txt' })).status, 'awaiting_approval', 'remembered move cannot expand its destination scope');
    assert.equal((await run({ action: 'move', path: 'outputs/renamed.txt', destination: 'outputs/one.txt' })).status, 'completed');

    const restarted = createWorkspaceFileService(options);
    const restartedStatus = await restarted.status();
    assert.equal(restartedStatus.pending.length, 0);
    assert.equal(restartedStatus.folders.length, 2);
    assert.ok(restartedStatus.history.length >= 6);

    // Simulate a process exit after mutation but before the final journal save.
    const statePath = path.join(privateDirectory, 'AgentFileAccess/state.json');
    const journal = JSON.parse(await fs.readFile(statePath, 'utf8'));
    const last = journal.history.at(-1);
    last.status = 'prepared';
    await fs.writeFile(statePath, JSON.stringify(journal));
    const recovered = createWorkspaceFileService(options);
    assert.equal((await recovered.status()).history[0].status, 'completed');
    assert.equal((await recovered.undo({ root_id: rootAId, id: last.id })).status, 'restored');
    // Simulate exit after undo changed the file but before recording restoration.
    const undoneJournal = JSON.parse(await fs.readFile(statePath, 'utf8'));
    undoneJournal.history.at(-1).status = 'undoing';
    undoneJournal.history.at(-1).undone = false;
    await fs.writeFile(statePath, JSON.stringify(undoneJournal));
    assert.equal((await createWorkspaceFileService(options).status()).history[0].undone, true);
    // Put the moved file back for subsequent routing tests.
    await fs.rename(path.join(root, 'outputs/renamed.txt'), path.join(root, 'outputs/one.txt'));

    // A failed policy save cannot silently grant broader permissions in memory.
    const failedPolicy = createWorkspaceFileService(options);
    await failedPolicy.status();
    await fs.rename(statePath, `${statePath}.test-backup`);
    await fs.mkdir(statePath);
    assert.equal((await failedPolicy.settings({ root_id: rootAId, action: 'mode', mode: 'workspace-write' })).ok, false);
    assert.equal((await failedPolicy.status()).mode, 'read-only');
    await fs.rmdir(statePath);
    await fs.rename(`${statePath}.test-backup`, statePath);

    let capturedToken;
    let expectedWrite = true;
    let expectedEnabled = true;
    let initializerFails = false;
    const codex = createMainCodexService({
      cleanText: value => String(value || '').trim(), fileAccess: service,
      getCodexCliHomePath: () => privateDirectory, getCodexCliWorkingDirectory: () => root,
      processObject: { env: {} },
      agentFoundation: { controllerUtils: {}, observability: {}, agentToolRuntime: {} },
      createWorkspaceInitializer: () => ({ initialize: async ({ envOverrides }) => {
        capturedToken = envOverrides.HIKARI_FILE_ACCESS_TOKEN;
        assert.equal(JSON.parse(envOverrides.HIKARI_AGENT_MCP_REQUEST_CONTEXT).fileAccessToken, undefined);
        if (initializerFails) throw new Error('Initialization fixture failure');
      } }),
      requestCodexCliText: async ({ envOverrides }) => {
        const context = JSON.parse(envOverrides.HIKARI_CODEX_REQUEST_CONTEXT);
        assert.equal(context.fileAccessToken, undefined);
        assert.equal(envOverrides.HIKARI_FILE_ACCESS_TOKEN, capturedToken);
        for (const build of [buildCodexCliExecArgs, buildCodexCliExecResumeArgs]) {
          assert.ok(build({ fileAccessToken: capturedToken }).includes(`mcp_servers.hikari.env.HIKARI_FILE_ACCESS_TOKEN="${capturedToken}"`));
          assert.ok(build().includes('mcp_servers.hikari.env.HIKARI_FILE_ACCESS_TOKEN=""'));
        }
        const status = await service.execute({ action: 'status' }, capturedToken);
        if (expectedEnabled) assert.equal(status.can_write, expectedWrite);
        else assert.equal(status.status, 'disabled');
        return { text: 'runtime fixture' };
      }
    });
    for (const context of [
      { chatSessionId: 'chat-new' }, { chatSessionId: 'chat-resumed', codexSessionId: 'resume' },
      { traceRequestId: 'background' }, { chatSessionId: 'scheduled', snapshot: { scheduled_task: {} } },
      { chatSessionId: 'disabled', snapshot: { settings: { agent: { disabled_mcp_tool_names: ['workspace_files'] } } } }
    ]) {
      expectedWrite = Boolean(context.chatSessionId) && !context.snapshot?.scheduled_task;
      expectedEnabled = context.chatSessionId !== 'disabled';
      await codex.requestCodexAgentText({ envOverrides: { HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify(context) } });
      assert.equal((await service.execute({ action: 'status' }, capturedToken)).status, 'session_expired');
    }
    initializerFails = true;
    await assert.rejects(codex.requestCodexAgentText({ envOverrides: {
      HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify({ chatSessionId: 'failed' })
    } }), /Initialization fixture failure/);
    assert.equal((await service.execute({ action: 'status' }, capturedToken)).status, 'session_expired');

    const gateway = createAgentMcpGateway({ runTool: (id, args, _snapshot, context) => {
      assert.equal(id, 'workspace-files');
      return service.execute(args, context.fileAccessToken);
    } });
    const response = await gateway.callGatewayTool('workspace_files', { action: 'read', path: 'outputs/one.txt' }, { fileAccessToken: token });
    assert.equal(response.content, 'one');
    assert.equal((await gateway.callGatewayTool('workspace_files', { action: 'status' }, {
      fileAccessToken: token, snapshot: { settings: { agent: { disabledMcpToolNames: ['workspace_files'] } } }
    })).status, 'disabled');

    const handlers = new Map();
    const contents = { mainFrame: {} };
    registerAgentFileIpc({ ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
      fileAccess: service, getMainWindow: () => ({ webContents: contents }), dialog: {} });
    assert.equal((await handlers.get(FILE_ACCESS.SETTINGS)({ sender: {}, senderFrame: {} }, {})).status, 'unauthorized');
    assert.equal((await handlers.get(FILE_ACCESS.SETTINGS)({ sender: contents, senderFrame: {} }, {})).status, 'unauthorized');
    const revoke = await handlers.get(FILE_ACCESS.SETTINGS)({ sender: contents, senderFrame: contents.mainFrame }, { action: 'revoke', root_id: rootAId });
    assert.equal(revoke.ok, true);
    assert.equal(revoke.folders.length, 0);
    assert.equal((await run({ action: 'status' })).status, 'session_expired');
    console.log('Workspace file access passed: CRUD, approvals, recovery, retries, conflicts, links, root changes, persistence, additional folders, background limits, MCP and IPC authority.');
  } finally { await fs.rm(fixture, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
