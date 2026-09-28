'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAgentMemoryRuntime } = require('../src/main/agent/context/agent-memory.js');
const { registerSystemToolExecutors } = require('../src/main/agent/tools/tool-executors/system-executors.js');
const { createDirectMcpToolRouter } = require('../src/main/agent/mcp-contract/direct-tools/index.js');
const { validateNotebookConclusionResult } = require('../src/main/project-memory/conclusion-request.js');
const { shouldGenerateConclusion } = require('../src/main/project-memory/conclusion-cache.js');
const { buildProjectMemoryGeneratedBlock } = require('../src/main/project-memory/memory-markdown.js');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hikari-memory-safety-'));
  try {
    const memoryFilePath = path.join(directory, 'memory.json');
    await fs.writeFile(memoryFilePath, JSON.stringify({ items: [{ id: 'old', key: 'old', summary: 'saved' }] }));
    const started = deferred();
    const release = deferred();
    let reads = 0;
    const runtime = createAgentMemoryRuntime({ memoryFilePath, fs: {
      ...fs,
      readFile: async (...args) => {
        reads += 1;
        const content = await fs.readFile(...args);
        started.resolve();
        await release.promise;
        return content;
      }
    } });
    const loading = runtime.recall();
    await started.promise;
    const saving = runtime.remember({ key: 'new', summary: 'newly saved' });
    release.resolve();
    await Promise.all([loading, saving]);
    assert.equal(reads, 1);
    assert.deepEqual(new Set((await runtime.list()).items.map((x) => x.key)), new Set(['old', 'new']));
    assert.equal(JSON.parse(await fs.readFile(memoryFilePath)).items.length, 2);

    // Failed reads never mark a file loaded or permit replacement of unread data.
    let failingRead = true;
    const retry = createAgentMemoryRuntime({ memoryFilePath, fs: {
      ...fs, readFile: (...args) => failingRead ? Promise.reject(new Error('EACCES')) : fs.readFile(...args)
    } });
    await assert.rejects(retry.recall(), /EACCES/);
    await assert.rejects(retry.remember({ key: 'lost', summary: 'no' }), /EACCES/);
    failingRead = false;
    assert.equal((await retry.list()).items.length, 2);

    // Atomic commit failure leaves the old file and visible state intact.
    const failCommit = createAgentMemoryRuntime({ memoryFilePath, fs: {
      ...fs, rename: async () => { throw new Error('disk failure'); }
    } });
    await assert.rejects(failCommit.remember({ key: 'ghost', summary: 'no' }), /disk failure/);
    await assert.rejects(failCommit.forget({ key: 'old' }), /disk failure/);
    assert.equal((await failCommit.list()).items.length, 2);
    assert.equal(JSON.parse(await fs.readFile(memoryFilePath)).items.length, 2);
    assert.deepEqual(await fs.readdir(directory), ['memory.json']);
    assert.equal((await runtime.forget({})).ok, false);
    assert.equal((await runtime.forget({ category: 'preference' })).ok, false);

    // The root is captured at invocation, including while another operation is loading.
    let root = path.join(directory, 'a.json');
    const gate = deferred();
    const entered = deferred();
    const moving = createAgentMemoryRuntime({ memoryFilePath: () => root, fs: {
      ...fs, readFile: async (...args) => {
        if (args[0].endsWith('a.json')) { entered.resolve(); await gate.promise; }
        return fs.readFile(...args);
      }
    } });
    const saveA = moving.remember({ key: 'a', summary: 'root a' });
    await entered.promise;
    root = path.join(directory, 'b.json');
    const saveB = moving.remember({ key: 'b', summary: 'root b' });
    gate.resolve();
    await Promise.all([saveA, saveB]);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'a.json'))).items.map((x) => x.key), ['a']);
    assert.deepEqual(JSON.parse(await fs.readFile(root)).items.map((x) => x.key), ['b']);

    const corruptPath = path.join(directory, 'corrupt.json');
    await fs.writeFile(corruptPath, '{broken');
    const corrupt = createAgentMemoryRuntime({ memoryFilePath: corruptPath });
    await assert.rejects(corrupt.recall());
    await assert.rejects(corrupt.remember({ key: 'no', summary: 'no' }));
    assert.equal(await fs.readFile(corruptPath, 'utf8'), '{broken');
    await fs.writeFile(corruptPath, JSON.stringify({ items: [] }));
    await Promise.all(Array.from({ length: 12 }, (_, index) => corrupt.remember({ key: `parallel-${index}`, summary: 'saved' })));
    assert.equal(JSON.parse(await fs.readFile(corruptPath, 'utf8')).items.length, 12);

    const legacy = createAgentMemoryRuntime({ store: new Map([['legacy', {
      id: 'legacy', key: 'target', project_name: 'Atlas', summary: 'legacy record'
    }]]) });
    const migrated = await legacy.remember({ key: 'target', project_id: 'p1', project_name: 'Atlas', summary: 'updated' });
    assert.equal(migrated.item.id, 'legacy');
    assert.equal(migrated.item.project_id, 'p1');
    await legacy.remember({ key: 'target', project_name: 'Atlas', summary: 'name-only update' });
    assert.equal((await legacy.recall({ project_id: 'p1' })).items[0].project_id, 'p1');
    await legacy.remember({ key: 'target', project_id: 'p1', project_name: 'Renamed', summary: 'renamed' });
    assert.equal((await legacy.list()).items.length, 1);

    const scoped = createAgentMemoryRuntime();
    let executeMemory;
    registerSystemToolExecutors({ registerToolExecutor(name, execute) { if (name === 'memory') executeMemory = execute; } }, {
      cleanText: (value, max = 2000) => String(value || '').trim().slice(0, max), memoryRuntime: scoped
    });
    const context = { project: { id: 'p1', name: 'Atlas' } };
    const call = (args, ctx = context) => executeMemory({ args, context: ctx });
    await call({ action: 'remember', key: 'format', summary: 'brief' });
    const firstProject = await call({ action: 'remember', scope: 'project', key: 'target', summary: 'binder target' });
    assert.equal(firstProject.item.project_id, 'p1');
    await call({ action: 'remember', scope: 'project', key: 'target', summary: 'renamed target' }, { project: { id: 'p1', name: 'Renamed' } });
    await call({ action: 'remember', scope: 'project', project_id: 'p2', key: 'target', summary: 'other' });
    assert.equal((await call({ action: 'recall' })).items.length, 2);
    assert.equal((await call({ action: 'recall', include_global: false })).items.length, 1);
    assert.equal((await call({ action: 'recall', scope: 'global' })).items.length, 1);
    assert.equal((await call({ action: 'forget', scope: 'project', key: 'format' })).removed_count, 0);
    assert.equal((await call({ action: 'remember', id: firstProject.item.id, key: 'collision', summary: 'no' })).ok, false);

    // Word order no longer hides a match; exact phrases outrank scattered matches.
    await scoped.remember({ key: 'phrase', summary: 'binder optimization' });
    await scoped.remember({ key: 'scattered', summary: 'optimization of a binder' });
    const ranked = await scoped.recall({ query: 'binder optimization', scope: 'global' });
    assert.deepEqual(ranked.items.map((x) => x.key), ['phrase', 'scattered']);
    assert.equal((await scoped.recall({ query: 'optimization binder', scope: 'global' })).items.length, 2);

    const router = createDirectMcpToolRouter({ runTool: (name, args, snapshot, ctx) => {
      assert.equal(name, 'memory');
      return call(args, ctx);
    } });
    assert.equal(router.hasTool('memory'), true);
    assert.equal(router.getToolDefinitions().find((x) => x.name === 'memory').annotations.destructiveHint, true);
    const routed = await router.callTool('memory', { action: 'recall', scope: 'global' }, context);
    assert.equal(routed.ok, true);
    assert.equal(routed.output.items.some((x) => x.key === 'format'), true);
    assert.equal((await router.callTool('memory', { action: 'forget' }, context)).ok, false);
    const { createAgentToolCallRuntime } = require('../src/main/agent/tools/agent-tool-execution.js');
    const appRuntime = createAgentToolCallRuntime();
    appRuntime.registerToolExecutor('memory', ({ args, context: ctx }) => call(args, ctx));
    const wrappedRouter = createDirectMcpToolRouter({
      runTool: (name, args, snapshot, ctx) => appRuntime.executeToolCall({ tool_name: name, arguments: args }, ctx)
    });
    assert.equal((await wrappedRouter.callTool('memory', { action: 'forget' }, context)).ok, false);
    assert.equal((await wrappedRouter.callTool('memory', { action: 'recall' }, context)).ok, true);

    assert.equal((await router.callTool('memory', { action: 'recall' }, { settings: { agent: { disabledMcpToolNames: ['memory'] } } })).status, 'disabled');

    // Quote membership proves the excerpt, never the interpretation: this
    // summary inverts its own evidence and still passes the gate. MEMORY.md
    // publishes the sentence, so the quote has to travel with it.
    const evidence = validateNotebookConclusionResult({ conclusion: 'Treatment improved growth.', quotes: ['no improvement'] }, { corpus: 'Treatment showed no improvement.' });
    assert.equal(evidence.conclusion, 'Treatment improved growth.');
    assert.deepEqual(evidence.quotes, ['no improvement']);
    assert.equal(
      buildProjectMemoryGeneratedBlock({ displayName: 'P' }, { notebookEntries: [{ title: 'Run', ...evidence }] })
        .includes('- Run; Treatment improved growth. ("no improvement")'),
      true,
      'an inverted summary is published beside the evidence that contradicts it'
    );
    assert.equal(validateNotebookConclusionResult({ conclusion: 'made up', quotes: ['not recorded'] }, { corpus: 'recorded' }), null);
    assert.equal(shouldGenerateConclusion({ hash: 'h', status: 'fallback', attempts: 1, retryAfter: new Date(1000).toISOString() }, { hash: 'h' }, 999), false);
    assert.equal(shouldGenerateConclusion({ hash: 'h', status: 'fallback', attempts: 1, retryAfter: new Date(1000).toISOString() }, { hash: 'h' }, 1000), true);
    assert.equal(shouldGenerateConclusion({ hash: 'h', status: 'fallback', attempts: 3 }, { hash: 'h' }), false);
    assert.equal(shouldGenerateConclusion({ hash: 'h', status: 'evidence' }, { hash: 'changed' }), true);
    console.log('agent memory safety selfcheck OK');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
