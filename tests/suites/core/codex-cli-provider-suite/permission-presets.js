'use strict';

const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');

module.exports = function registerPermissionPresets({ scope: { assert, path, test }, __dirname: root }) {
  const provider = path.join(root, 'src/main/lib/codex-cli-provider');
  const { getCodexPermissionPreset } = require(path.join(provider, 'permissions.js'));
  const { runCodexAppServerTurn } = require(path.join(provider, 'app-server-turn.js'));
  const cwd = process.cwd();

  function fixture({ threadPolicy, requestedApprovals = false }) {
    const calls = [];
    const approvals = [];
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const emit = message => child.stdout.write(`${JSON.stringify(message)}\n`);
    const notify = (method, params) => emit({ method, params: { threadId: 'test-thread', ...params } });
    const endTurn = () => {
      notify('item/agentMessage/delta', { delta: 'Done' });
      notify('item/completed', { item: { type: 'agentMessage', phase: 'final_answer', id: 'final', text: 'Done.' } });
      notify('turn/completed', { turn: { id: 'current-turn', status: 'completed' } });
    };
    child.kill = () => {};
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      const call = JSON.parse(chunk);
      calls.push(call);
      if (call.method === 'initialize') emit({ id: call.id, result: {} });
      if (['thread/start', 'thread/resume'].includes(call.method)) {
        emit({ id: call.id, result: { thread: { id: 'test-thread' }, cwd, ...threadPolicy } });
      }
      if (call.method === 'turn/start') {
        const turn = { id: 'current-turn' };
        emit({ id: call.id, result: { turn } });
        notify('turn/started', { turn });
        if (requestedApprovals) {
          for (const [id, turnId] of [[10, 'stale-turn'], [11, turn.id]]) {
            emit({ id, method: 'item/commandExecution/requestApproval', params: {
              threadId: 'test-thread', turnId, command: 'touch output.txt', cwd
            } });
          }
        } else endTurn();
      }
      if (call.result?.decision) {
        approvals.push(call);
        if (approvals.length === 2) endTurn();
      }
      callback();
    } });
    return { spawnProcess: () => child, calls, approvals };
  }

  const cases = [
    ['read-only', 'readOnly', 'on-request', 'user'],
    ['default', 'workspaceWrite', 'on-request', 'user'],
    ['approve-for-me', 'workspaceWrite', 'on-request', 'auto_review'],
    ['full-access', 'dangerFullAccess', 'never', 'user']
  ];

  test('foreground Codex presets apply before starting or resuming a turn', async () => {
    for (const [preset, sandbox, approvalPolicy, approvalsReviewer] of cases) {
      const policy = getCodexPermissionPreset(preset);
      const threadPolicy = { sandbox: { type: sandbox, networkAccess: false }, approvalPolicy, approvalsReviewer };
      const server = fixture({ threadPolicy, requestedApprovals: preset === 'read-only' });
      const events = [];
      const prompts = [];
      const result = await runCodexAppServerTurn({
        cwd, invocation: { command: 'unused', argsPrefix: [] }, policy, prompt: 'Test turn',
        resumeSessionId: preset === 'default' ? 'test-thread' : '',
        spawnProcess: server.spawnProcess, onEvent: event => events.push(event),
        approve: prompt => { prompts.push(prompt); return true; }, timeoutMs: 3000
      });
      const thread = server.calls[2];
      assert.equal(thread.method, preset === 'default' ? 'thread/resume' : 'thread/start');
      assert.equal(thread.params.approvalPolicy, approvalPolicy);
      assert.equal(thread.params.approvalsReviewer, approvalsReviewer);
      assert.equal(result.finalText, 'Done.');
      assert.ok(events.some(event => event.type === 'thread.started' && event.thread_id === 'test-thread'));
      if (preset === 'read-only') {
        assert.equal(prompts.length, 1);
        assert.match(prompts[0].detail, /touch output\.txt/);
        assert.deepEqual(server.approvals.map(response => response.result.decision), ['decline', 'accept']);
      }
    }
  });

  test('an unexpected sandbox prevents the Codex turn from starting', async () => {
    const server = fixture({ threadPolicy: { sandbox: { type: 'dangerFullAccess' }, approvalPolicy: 'never', approvalsReviewer: 'user' } });
    await assert.rejects(runCodexAppServerTurn({
      cwd, invocation: { command: 'unused', argsPrefix: [] }, policy: getCodexPermissionPreset('read-only'),
      prompt: 'Test turn', spawnProcess: server.spawnProcess, timeoutMs: 3000
    }), /could not apply the selected permission preset/);
    assert.equal(server.calls.some(call => call.method === 'turn/start'), false);
  });
};
