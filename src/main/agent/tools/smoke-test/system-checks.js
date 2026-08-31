'use strict';

const { createAgentCommandLineRuntime } = require('../agent-command-line.js');
const { createAgentSubAgentRuntime } = require('../agent-sub-agent.js');
const { createAgentContainerRuntime } = require('../agent-container.js');
const { createAgentMemoryRuntime } = require('../../context/agent-memory.js');
const { asArray } = require('../../../lib/normalize.js');
const {
  cleanText,
  uniqueStrings,
  resolveToolMessage,
  resolveFocusedToolText
} = require('./utils.js');

function createSystemSmokeChecks({ now, pythonSandboxFn, pythonSandboxRoot } = {}) {

  async function smokePythonSandbox(options = {}) {
    const requestMessage = resolveToolMessage(options.message, 'Write a JSON file with an ok flag and a test value.');
    const escapedMessage = JSON.stringify(requestMessage);
    const result = await pythonSandboxFn({
      code: `import json\nopen("out.json", "w", encoding="utf-8").write(json.dumps({"ok": True, "value": 42, "request_message": ${escapedMessage}}))`,
      readback_paths: ['out.json'],
      timeout_ms: 4000
    }, {
      sandboxRoot: pythonSandboxRoot
    });
    return {
      ...result,
      ok: result?.ok !== false,
      summary: result?.ok === false
        ? cleanText(result?.error) || 'Python sandbox smoke test failed.'
        : 'Python sandbox completed and wrote out.json.'
    };
  }

  async function smokeCommandLine(options = {}) {
    const runtime = createAgentCommandLineRuntime({
      defaultCwd: process.cwd()
    });
    const result = await runtime.execute({
      command: resolveToolMessage(options.message, `node -e "process.stdout.write('command-line-smoke')"`),
      timeout_ms: 8000
    }, {
      allowWriteTools: false
    });
    return {
      ...result,
      ok: result?.status === 'completed',
      summary: cleanText(result?.summary) || 'Command-line smoke test completed.'
    };
  }

  async function smokeSubAgent(options = {}) {
    const requestMessage = resolveToolMessage(options.message, 'Ping');
    const runtime = createAgentSubAgentRuntime({
      now,
      runSubAgentTurn: async ({ phase, message }) => ({
        assistant_message: `Handled ${phase}: ${cleanText(message)}`,
        summary: `sub-agent ${phase} ok`
      })
    });
    const created = await runtime.execute({
      action: 'create',
      name: 'Smoke Helper',
      system_prompt: 'You are a smoke-test helper agent.',
      message: requestMessage
    });
    if (!created?.ok || !created.agent?.id) {
      return {
        ok: false,
        status: 'error',
        error: cleanText(created?.error) || 'Sub-agent create failed.',
        summary: 'Sub-agent smoke test failed during creation.'
      };
    }
    const agentId = cleanText(created.agent.id);
    const updated = await runtime.execute({
      action: 'message',
      agent_id: agentId,
      message: `Follow-up: ${requestMessage}`
    });
    const listed = await runtime.execute({
      action: 'list'
    });
    const removed = await runtime.execute({
      action: 'delete',
      agent_id: agentId
    });
    const ok = created.ok === true && updated?.ok === true && listed?.ok === true && removed?.ok === true;
    return {
      ok,
      status: ok ? 'completed' : 'error',
      summary: ok
        ? `Sub-agent lifecycle smoke test completed for ${agentId}.`
        : 'Sub-agent lifecycle smoke test failed.',
      agent_id: agentId,
      listed_count: asArray(listed?.items).length,
      error: ok ? '' : uniqueStrings([
        created?.error,
        updated?.error,
        listed?.error,
        removed?.error
      ], 4).join(' | ')
    };
  }

  async function smokeMemory(options = {}) {
    const requestMessage = resolveToolMessage(options.message, 'User prefers concise summaries.');
    const runtime = createAgentMemoryRuntime({
      now: (() => {
        let index = 0;
        const values = [
          '2026-03-22T12:00:00.000Z',
          '2026-03-22T12:00:01.000Z'
        ];
        return () => values[Math.min(index++, values.length - 1)];
      })(),
      createId: () => 'memory-smoke-1'
    });
    const rememberResult = await runtime.execute({
      action: 'remember',
      category: 'preference',
      key: 'output_format',
      summary: requestMessage,
      value: requestMessage
    });
    const recallResult = await runtime.execute({
      action: 'recall',
      query: requestMessage,
      limit: 5
    });
    const itemCount = asArray(recallResult?.items).length;
    return {
      ...recallResult,
      ok: options.strict === true
        ? itemCount > 0
        : rememberResult?.ok !== false && recallResult?.ok !== false,
      summary: itemCount > 0
        ? `Recalled ${itemCount} memory record${itemCount === 1 ? '' : 's'}.`
        : 'No memory records matched the recall query.'
    };
  }

  async function smokeContainer(options = {}) {
    const requestMessage = resolveFocusedToolText(options.message, 'alpha beta', 6);
    const runtime = createAgentContainerRuntime({
      now: (() => {
        let index = 0;
        const values = [
          '2026-03-22T12:00:00.000Z',
          '2026-03-22T12:00:01.000Z'
        ];
        return () => values[Math.min(index++, values.length - 1)];
      })()
    });
    const created = await runtime.execute({
      action: 'create',
      name: 'smoke phrase',
      value: requestMessage,
      source: 'direct_literal:smoke'
    });
    const id = cleanText(created?.container?.id);
    const edited = await runtime.execute({
      action: 'replace_range',
      id,
      start: 0,
      end: Math.min(5, requestMessage.length),
      replacement: 'smoke'
    });
    const read = await runtime.execute({
      action: 'read',
      id
    });
    const ok = created?.ok !== false
      && edited?.ok !== false
      && read?.ok !== false
      && cleanText(read?.container?.id) === '1';
    return {
      ...read,
      ok,
      status: ok ? 'completed' : 'error',
      items: read?.container ? [read.container] : [],
      summary: ok
        ? `Container smoke test edited ${read.container.id}.`
        : 'Container smoke test failed.',
      error: ok ? '' : uniqueStrings([
        created?.error,
        edited?.error,
        read?.error
      ], 4).join(' | ')
    };
  }

  // The sequence tools round-trip into the renderer; here we stand in a fake
  // window that computes a canned reply, exercising the main-side invoke/reply

  return {
    smokePythonSandbox,
    smokeCommandLine,
    smokeSubAgent,
    smokeMemory,
    smokeContainer
  };
}

module.exports = { createSystemSmokeChecks };
