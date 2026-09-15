import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

// Direct-LLM registry owns the two selection-insight tasks.
const { DEFAULT_DIRECT_LLM_MODULES } = require(path.join(root, 'src/main/lib/llm/direct-llm-module-registry.js'));
const registryModule = DEFAULT_DIRECT_LLM_MODULES.find((entry) => entry.id === 'selection-insights');
assert.ok(registryModule, 'selection-insights module registered');
const whereToBuyTask = registryModule.tasks.find((task) => task.id === 'where-to-buy');
assert.equal(whereToBuyTask.expectJson, true);
assert.equal(whereToBuyTask.enableWebSearch, true);
assert.ok(registryModule.tasks.some((task) => task.id === 'what-is-it'));

// Renderer requests go through hikariApi.runDirectLlmPrompt, not agentChat.
const calls = [];
globalThis.window = {
  hikariApi: {
    runDirectLlmPrompt: async (payload) => {
      calls.push(payload);
      return payload.task === 'where-to-buy'
        ? { ok: true, text: '{"summary":"Buy from Sigma.","items":[]}', payload: { summary: 'Buy from Sigma.', items: [{ title: 'DTT', vendor: 'Sigma', price_text: '$40', product_url: 'https://x', image_url: '' }] } }
        : { ok: true, text: 'A reducing agent.' };
    }
  }
};

const { requestInsightAnswer } = await import(path.join(root, 'src/renderer/modules/selection-insights/controller-context.js'));
const { buildCompletedAnswer } = await import(path.join(root, 'src/renderer/modules/selection-insights/insight-model.js'));

const ctx = { state: { settings: { llm: { provider: 'codex', model: 'gpt-5.4', reasoningEffort: 'low' } } } };
const context = { record: { name: 'Lysis', projectName: 'Atlas' } };
const selection = { selectedText: 'DTT', segmentText: 'Add 1 mM DTT.', segmentLabel: 'Step 2' };

const whatIsIt = buildCompletedAnswer('what_is_it', await requestInsightAnswer(ctx, context, selection, 'what_is_it'));
assert.equal(calls[0].moduleId, 'selection-insights');
assert.equal(calls[0].task, 'what-is-it');
assert.equal(calls[0].expectJson, false);
assert.match(calls[0].prompt, /Selected text: "DTT"/);
assert.match(calls[0].prompt, /Record: Lysis/);
assert.equal(calls[0].llm.provider, 'codex');
assert.equal(whatIsIt.text, 'A reducing agent.');
assert.equal(whatIsIt.payload, null);

const whereToBuy = buildCompletedAnswer('where_to_buy', await requestInsightAnswer(ctx, context, selection, 'where_to_buy'));
assert.equal(calls[1].task, 'where-to-buy');
assert.equal(calls[1].expectJson, true);
assert.equal(calls[1].schema.required.join(','), 'summary,items');
assert.equal(whereToBuy.summary, 'Buy from Sigma.');
assert.equal(whereToBuy.payload.items[0].vendor, 'Sigma');
assert.equal(whereToBuy.text, '');

// A completed answer is reused: runInsightAction must not call the model again.
const { runInsightAction } = await import(path.join(root, 'src/renderer/modules/selection-insights/controller-actions.js'));
const savedSelection = {
  segmentId: 'step-2',
  segmentLabel: 'Step 2',
  segmentText: 'Add 1 mM DTT.',
  selectedText: 'DTT',
  occurrenceIndex: 1
};
const savedRecord = {
  id: 'protocol-1',
  name: 'Lysis',
  selectionInsights: [{
    id: 'insight-1',
    ...savedSelection,
    contextText: savedSelection.segmentText,
    answers: { where_to_buy: whereToBuy }
  }]
};
const savedCtx = {
  ...ctx,
  hosts: new Map([['protocol-view', {
    key: 'protocol-view',
    host: null,
    getContext: () => ({ kind: 'protocol', record: savedRecord, insights: savedRecord.selectionInsights })
  }]])
};
const callsBefore = calls.length;
await runInsightAction(savedCtx, 'protocol-view', savedSelection, 'where_to_buy');
assert.equal(calls.length, callsBefore, 'saved where-to-buy answer is reused without a new request');
await runInsightAction(savedCtx, 'protocol-view', savedSelection, 'what_is_it');
assert.equal(calls.length, callsBefore + 1, 'a missing answer still runs');

console.log('selection-insights selfcheck passed');
