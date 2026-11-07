'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { onAgentRequestAbort, throwIfAgentRequestAborted } = require('../llm/request-context.js');
const { appendCodexProjectMemoryConfigArgs, appendFileAccessToken } = require('./args.js');
const { answerCodexApproval } = require('./app-server-approval.js');
const { DEFAULT_TIMEOUT_MS } = require('./constants.js');
const { safeParseJson } = require('./utils.js');

const SANDBOX_TYPES = { 'read-only': 'readOnly', 'workspace-write': 'workspaceWrite', 'danger-full-access': 'dangerFullAccess' };

function inside(cwd, target) {
  const relative = path.relative(cwd, target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function verifyThreadPolicy(thread, policy, cwd) {
  const sandbox = thread?.sandbox;
  if (!thread?.thread?.id || sandbox?.type !== SANDBOX_TYPES[policy.sandbox]
      || typeof thread.cwd !== 'string' || path.relative(cwd, thread.cwd) !== ''
      || thread.approvalPolicy !== policy.approvalPolicy
      || thread.approvalsReviewer !== policy.approvalsReviewer
      || (policy.sandbox !== 'danger-full-access' && sandbox.networkAccess !== false)
      || (sandbox.writableRoots || []).some(root => !inside(cwd, root))) {
    throw new Error('Codex could not apply the selected permission preset. Check your managed Codex settings.');
  }
}

function itemEvent(method, item) {
  const type = item.type.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`);
  const normalized = { ...item, type, call_id: item.id };
  if (type === 'mcp_tool_call') normalized.result = item.result?.structuredContent || item.result;
  if (type === 'command_execution') {
    normalized.name = 'shell';
    normalized.arguments = { command: item.command, cwd: item.cwd };
    normalized.output = item.aggregatedOutput;
  }
  return { type: method.replace('/', '.'), item: normalized };
}

function runCodexAppServerTurn({
  cwd, env, invocation, policy, approve, model, effort, prompt, outputSchema, resumeSessionId,
  enableWebSearch, enableImageGeneration, fileAccessToken, onEvent, timeoutMs, spawnProcess = spawn
}) {
  throwIfAgentRequestAborted();
  const args = ['app-server', '-c', 'sandbox_workspace_write.writable_roots=[]', '-c', 'sandbox_workspace_write.network_access=false'];
  if (enableWebSearch) args.push('-c', 'web_search="live"');
  if (enableImageGeneration) args.push('-c', 'features.image_generation=true');
  appendCodexProjectMemoryConfigArgs(args);
  appendFileAccessToken(args, fileAccessToken);

  return new Promise((resolve, reject) => {
    const child = spawnProcess(invocation.command, [...invocation.argsPrefix, ...args], { cwd, env, windowsHide: true, stdio: 'pipe' });
    const lines = createInterface({ input: child.stdout });
    const requests = new Map();
    const items = new Map();
    let nextId = 0;
    let done = false;
    let threadId = '';
    let turnId = '';
    let finalText = '';
    let lastText = '';
    let stderr = '';
    let unsubscribe = () => {};
    const approvalLifetime = new AbortController();
    const timeout = timeoutMs === null ? null : setTimeout(() => finish(new Error('Codex Agent turn timed out.')), timeoutMs || DEFAULT_TIMEOUT_MS);

    function finish(error) {
      if (done) return;
      done = true;
      approvalLifetime.abort();
      clearTimeout(timeout);
      unsubscribe();
      lines.close();
      for (const request of requests.values()) request.reject(error || new Error('Codex turn ended.'));
      requests.clear();
      child.stdin.end();
      if (error) child.kill('SIGTERM');
      if (child.exitCode === null && child.signalCode === null) {
        const cleanup = setTimeout(() => child.kill('SIGKILL'), 1200);
        cleanup.unref();
        child.once('close', () => clearTimeout(cleanup));
      }
      if (error) reject(error);
      else resolve({ finalText: finalText || lastText, stdout: '', stderr, command: resumeSessionId ? 'app-server resume' : 'app-server' });
    }

    function send(message) {
      if (!done) child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    function request(method, params) {
      if (done) return Promise.reject(new Error('Codex turn ended.'));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        requests.set(id, { resolve, reject });
        send({ id, method, params });
      });
    }

    async function onMessage(message) {
      if (!message || done) return;
      const { id, method, params = {} } = message;
      if (id !== undefined && method) {
        const sameTurn = turnId && params.turnId === turnId && params.threadId === threadId;
        const confirm = sameTurn && policy.approvalPolicy === 'on-request' && approve
          ? prompt => approve({ ...prompt, signal: approvalLifetime.signal }) : null;
        const answer = await answerCodexApproval(method, params, items, confirm);
        send(answer ? { id, result: answer } : { id, error: { code: -32601, message: 'This request is not available in Hikari Agent.' } });
        return;
      }
      if (id !== undefined) {
        const pending = requests.get(id);
        requests.delete(id);
        if (message.error) pending?.reject(new Error(message.error.message || 'Codex app-server request failed.'));
        else pending?.resolve(message.result);
        return;
      }
      if (!threadId || params.threadId !== threadId) return;
      if (method === 'turn/started') turnId = params.turn.id;
      if (method === 'item/agentMessage/delta') onEvent?.({ type: 'agent_message_delta', delta: params.delta });
      if (method === 'item/started' || method === 'item/completed') {
        const item = params.item;
        if (method === 'item/started') items.set(item.id, item);
        else {
          items.delete(item.id);
          if (item.type === 'agentMessage') {
            lastText = item.text;
            if (item.phase !== 'commentary') finalText = item.text;
          }
        }
        onEvent?.(itemEvent(method, item));
      }
      if (method === 'turn/completed') {
        if (params.turn?.status !== 'completed') finish(new Error(params.turn?.error?.message || 'Codex did not complete the turn.'));
        else finish();
      }
    }

    async function start() {
      await request('initialize', { clientInfo: { name: 'hikari', title: 'Hikari', version: '1' } });
      send({ method: 'initialized' });
      const config = { cwd, model, ...policy };
      const thread = resumeSessionId
        ? await request('thread/resume', { ...config, threadId: resumeSessionId, excludeTurns: true })
        : await request('thread/start', config);
      verifyThreadPolicy(thread, policy, cwd);
      threadId = thread.thread.id;
      onEvent?.({ type: 'thread.started', thread_id: threadId });
      const turn = await request('turn/start', {
        threadId, input: [{ type: 'text', text: prompt, text_elements: [] }],
        ...(effort ? { effort } : {}), ...(outputSchema ? { outputSchema } : {})
      });
      turnId ||= turn.turn.id;
    }

    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
    child.stdin.on('error', finish);
    child.on('error', finish);
    child.on('close', code => finish(new Error(`Codex app-server exited before the turn completed (${code ?? 'signal'}).`)));
    lines.on('line', line => { void onMessage(safeParseJson(line)).catch(finish); });
    unsubscribe = onAgentRequestAbort(finish);
    void start().catch(finish);
  });
}

module.exports = { runCodexAppServerTurn };
