const test = require('node:test');
const assert = require('node:assert/strict');
const { createCodexAgentRuntime } = require('../src/main/agent/codex-agent/runtime.js');

const review = { layout: 'Both canvases fit; no clipping.', labels: 'Labels are legible and separate.',
  artwork: 'Artwork contains no text.', science: 'Arrow direction matches the requested process.' };

async function tracker() { return (await import('../plugins/scientific-illustration/inspection.mjs')).createInspectionTracker(); }

test('inspection requires both rendered canvases and the exact revision receipt', async () => {
  const gate = await tracker();
  const inspect = (token, revision = 'r1', run = 'run1') => gate.inspect('figure1', revision, run,
    { expected_revision: revision, inspection_id: token, review });
  assert.equal(inspect('invented').ok, false);
  const main = gate.rendered('figure1', 'r1', 'run1', ['main']);
  assert.equal(main.inspection_id, undefined);
  assert.equal(inspect('invented').ok, false);
  const both = gate.rendered('figure1', 'r1', 'run1', ['scratch']);
  assert.ok(both.inspection_id);
  assert.equal(both.complete, false, 'Rendering alone cannot pass');
  assert.equal(gate.status('figure1', 'r1', 'run1').inspection_id, undefined, 'Only a render discloses the receipt');
  assert.equal(inspect(both.inspection_id, 'r2').ok, false, 'An intervening edit invalidates the receipt');
  assert.equal(inspect(both.inspection_id, 'r1', 'another-run').ok, false);
  assert.equal(gate.inspect('figure2', 'r1', 'run1', { expected_revision: 'r1', inspection_id: both.inspection_id, review }).ok, false);
  assert.equal(inspect(both.inspection_id).inspection.complete, true);
  assert.equal(gate.status('figure1', 'r2', 'run1').complete, false);
  assert.equal((await tracker()).status('figure1', 'r1', 'run1').complete, false, 'Reload has no old inspection receipts');
});

test('inspect requires all four nonempty review observations', async () => {
  const { validateRequest } = await import('../plugins/scientific-illustration/model.mjs');
  const request = { action: 'inspect', inspection_id: 'receipt', expected_revision: 'revision', review };
  assert.doesNotThrow(() => validateRequest(request));
  for (const key of Object.keys(review)) {
    const incomplete = { ...review }; delete incomplete[key];
    assert.throws(() => validateRequest({ ...request, review: incomplete }));
    assert.throws(() => validateRequest({ ...request, review: { ...review, [key]: ' ' } }));
  }
  assert.throws(() => validateRequest({ action: 'read', inspection_id: 'receipt' }));
});

function runtimeFixture({ attempt, required = true, changeSelection = false, finalText = 'Reviewed figure.' } = {}) {
  const calls = [], progress = [], lifecycle = [];
  let completedRun = '', activeRun = '';
  const runtime = createCodexAgentRuntime({
    requestPluginCanvas: async args => {
      activeRun = args.inspectionRunId;
      return { ok: !changeSelection || args.request.action === 'read', illustration_id: 'figure1', revision: 'r1',
        inspection: { required, complete: completedRun === activeRun, revision: 'r1' } };
    },
    requestCodexAgentText: async args => {
      calls.push(args);
      assert.equal(args.enableImageGeneration, true, 'Native generation is enabled on initial and inspection continuation turns');
      assert.equal(JSON.parse(args.envOverrides.HIKARI_AGENT_MCP_REQUEST_CONTEXT).pluginInspectionRunId, required ? activeRun : undefined);
      args.onStream({ type: 'codex_stream', event_type: 'item.completed:final_answer', accumulated_text: finalText });
      args.onStream({ type: 'codex_cli_display', display_kind: 'assistant', event_type: 'item.completed:final_answer', text: finalText });
      if (attempt?.(calls.length)) completedRun = activeRun;
      return { text: 'Reviewed figure.', metadata: { session_id: 'codex-session' } };
    },
    recordLifecycleEvent: (_recorder, event) => lifecycle.push(event)
  });
  return { calls, progress, lifecycle, run: () => runtime.run({ message: 'Draw a cell',
    agent: { pluginCanvasId: 'scientific-illustration' }, emitAgentProgress: event => progress.push(event) }) };
}

test('missing inspection blocks success after exactly one continuation and hides premature final text', async () => {
  const fixture = runtimeFixture({ finalText: 'Premature done' });
  const result = await fixture.run();
  assert.equal(result.ok, false); assert.equal(result.status, 'inspection_required');
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.calls[1].resumeSessionId, 'codex-session');
  assert.match(fixture.calls[1].prompt, /Render BOTH canvases/);
  assert.equal(fixture.lifecycle.some(event => event.stage === 'codex_agent_completed'), false);
  assert.equal(JSON.stringify(fixture.progress).includes('Premature done'), false);
  assert.equal(JSON.stringify(fixture.lifecycle).includes('Premature done'), false);
});

test('an inspection performed on the bounded continuation permits success', async () => {
  const fixture = runtimeFixture({ attempt: count => count === 2 });
  const result = await fixture.run();
  assert.equal(result.ok, true); assert.equal(fixture.calls.length, 2);
  assert.equal(result.codex_agent.answer, 'Reviewed figure.');
});

test('successful inspection releases the full streamed answer before parsing the result', async () => {
  const finalText = `${'Inspected the figure. '.repeat(1000)}Review complete.`;
  const fixture = runtimeFixture({ attempt: () => true, finalText });
  const result = await fixture.run();
  assert.equal(result.codex_agent.answer, finalText.trim());
  assert.ok(fixture.progress.some(event => event.stage === 'codex_agent_stream'));
});

test('a first-pass inspection avoids continuation and cannot be reused by another run', async () => {
  const fixture = runtimeFixture({ attempt: count => count === 1 });
  assert.equal((await fixture.run()).ok, true); assert.equal(fixture.calls.length, 1);
  assert.equal((await fixture.run()).ok, false); assert.equal(fixture.calls.length, 3);
});

test('a changed illustration fails closed', async () => {
  const fixture = runtimeFixture({ attempt: () => true, changeSelection: true });
  assert.equal((await fixture.run()).ok, false);
});

test('plugins without an inspection contract retain their existing completion flow', async () => {
  const fixture = runtimeFixture({ required: false });
  assert.equal((await fixture.run()).ok, true); assert.equal(fixture.calls.length, 1);
});

test('disabled canvas tools block the model call', async () => {
  let called = false;
  const runtime = createCodexAgentRuntime({ requestCodexAgentText: async () => { called = true; } });
  const result = await runtime.run({ agent: { pluginCanvasId: 'scientific-illustration' },
    snapshot: { settings: { agent: { disabledMcpToolNames: ['plugin_canvas'] } } } });
  assert.equal(result.ok, false); assert.equal(called, false);
});

test('inspection starts with the illustration pinned by the originating chat', async () => {
  let called = false, canvasRequest;
  const runtime = createCodexAgentRuntime({ requestCodexAgentText: async () => { called = true; },
    requestPluginCanvas: async args => {
      canvasRequest = args.request;
      return { ok: false, status: 'illustration_changed', error: 'Another illustration is open.' };
    } });
  await assert.rejects(runtime.run({ agent: { pluginCanvasId: 'scientific-illustration', pluginCanvasIllustrationId: 'figure-a' } }),
    /Another illustration is open/);
  assert.deepEqual(canvasRequest, { action: 'read', illustration_id: 'figure-a' });
  assert.equal(called, false);
});
