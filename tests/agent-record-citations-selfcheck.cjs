'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createAgentMcpGateway } = require('../src/main/agent/mcp-contract/gateway.js');
const { buildMcpToolResponseContent } = require('../src/main/agent/mcp-contract/result-shaping/paper-results.js');
const { extractPaperEvidenceFromToolOutput } = require('../src/main/agent/runtime/tool-artifacts/paper-evidence.js');
const { createAgentNotebookLookupRuntime } = require('../src/main/agent/tools/agent-notebook-lookup.js');
const { createProtocolMatchingRuntime } = require('../src/main/agent/tools/agent-protocol-matching.js');
const { registerLabToolExecutors } = require('../src/main/agent/tools/tool-executors/lab-executors.js');
const { loadEsmStyleModule } = require('./support/runtime.js');

async function main() {
  const protocol = { id: 'protocol/1 (cold)', name: 'Cold wash', purpose: 'Remove residual dye.', steps: [{ text: 'Wash twice.' }] };
  const entry = { id: 'run-1', notebookType: 'biology', experimentName: 'Cold wash run', result: 'The blank had no signal.' };
  const snapshot = { protocols: [protocol], notebookEntries: [entry] };
  const executors = new Map();
  registerLabToolExecutors({
    registerToolExecutor: (id, execute) => executors.set(id, execute)
  }, {
    cleanText: (value, max) => String(value || '').trim().slice(0, max),
    notebookLookupRuntime: createAgentNotebookLookupRuntime(),
    protocolMatchingRuntime: createProtocolMatchingRuntime()
  });
  const evidence = [];
  const gateway = createAgentMcpGateway({
    runTool: async (id, args, snapshot, context) => {
      const result = await executors.get(id)({ args, context: { ...context, snapshot } });
      evidence.push(...extractPaperEvidenceFromToolOutput(id, result));
      return result;
    }
  });
  const lookupProtocol = await gateway.callGatewayTool('protocol_lookup', { query: protocol.name }, { snapshot });
  const lookupNotebook = await gateway.callGatewayTool('notebook_lookup', { query: entry.id, detail: 'full' }, { snapshot });
  const protocolTarget = 'hikari://protocol/protocol%2F1%20%28cold%29';
  const notebookTarget = 'hikari://notebook/run-1';
  assert.equal(lookupProtocol.selected_protocol.citation_target, protocolTarget);
  assert.equal(lookupProtocol.citations[0].target, protocolTarget);
  assert.equal(lookupNotebook.items[0].citation_target, notebookTarget);
  const largeProtocol = { ...lookupProtocol.items[0], steps: [{ text: 'Long step. '.repeat(7000) }] };
  const truncated = JSON.parse(buildMcpToolResponseContent('protocol_lookup', { ...lookupProtocol, items: [largeProtocol] }));
  assert.ok(truncated.result_preview.includes(protocolTarget), 'Truncated results still provide the citation target');
  assert.deepEqual(evidence.map(source => source.target), [protocolTarget, notebookTarget]);
  assert.deepEqual(evidence.map(source => source.excerpt), [protocol.purpose, entry.result]);
  for (const [tool, response, target] of [
    ['protocol_lookup', lookupProtocol, protocolTarget],
    ['notebook_lookup', lookupNotebook, notebookTarget]
  ]) {
    const wire = { content: [{ type: 'text', text: buildMcpToolResponseContent(tool, response) }] };
    assert.equal(extractPaperEvidenceFromToolOutput(`mcp__hikari__${tool}`, wire)[0].target, target);
    assert.deepEqual(extractPaperEvidenceFromToolOutput(tool, { ...response, ok: false }), []);
  }
  assert.deepEqual(extractPaperEvidenceFromToolOutput('notebook_lookup', {
    items: [{ id: 'different', citation_target: notebookTarget }]
  }), []);

  const graph = new Map();
  const renderer = name => loadEsmStyleModule(path.resolve(__dirname, '../src/renderer', name), { URL }, [], graph);
  const { createPaperSourceLinkRenderer } = renderer('modules/agent-chat/paper-source-links.js');
  const { renderMarkdown } = renderer('modules/agent-chat/markdown.js');
  const { createHistoryActionController } = renderer('modules/agent-chat/history-actions.js');
  const { createOpenRecordCitation } = renderer('module-manifests/agent-record-citations.js');
  const paperPath = 'KnowledgeBase/papers.md/Controls/paper.md';
  const saved = JSON.parse(JSON.stringify({
    id: 'saved', role: 'assistant', meta: { paper_evidence: [
      { source_path: paperPath, source_lines: [{ line_number: 12, content: 'A blank controls for background.' }] },
      ...evidence
    ] }
  }));
  const followup = { id: 'followup', role: 'assistant' };
  const state = { ...snapshot, agentChat: { messages: [saved, followup] }, settings: { storagePath: '/workspace' } };
  const safeText = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const cited = new Set();
  const render = (message, text) => renderMarkdown(text, safeText, {
    renderLocalLink: createPaperSourceLinkRenderer(message, state, safeText,
      state.agentChat.messages, source => cited.add(source.target))
  });
  const markdown = `Wash twice. [Protocol](${protocolTarget}) The blank was clean. [Run](${notebookTarget}) [Paper](<${paperPath}#L12>) [Protocol](${protocolTarget})`;
  const html = render(followup, markdown);
  assert.deepEqual([...html.matchAll(/<span>(\d+)<\/span>/g)].map(match => match[1]), ['1', '2', '3', '1']);
  assert.match(html, /aria-label="Open protocol: Cold wash"/);
  assert.match(html, /aria-label="Open notebook page: Cold wash run"/);
  assert.deepEqual([...cited], [protocolTarget, notebookTarget]);
  for (const target of ['hikari://notebook/unknown', 'hikari://notebook/run-1#fake', 'file:///tmp/forged']) {
    assert.equal(render(followup, `[Forged](${target})`), '<p>Forged</p>');
  }
  state.agentChat.messages.reverse();
  assert.equal(render(followup, `[Future source](${notebookTarget})`), '<p>Future source</p>');
  state.agentChat.messages.reverse();

  const views = [];
  const actions = createHistoryActionController({
    state,
    setStatus() {},
    onOpenRecordCitation: createOpenRecordCitation({
      state,
      modules: {
        protocol: { viewProtocol: id => id === protocol.id },
        biologyNotebook: { openEntry: id => id === entry.id }
      },
      showView: view => views.push(view),
      views: { PROTOCOL_MANAGEMENT: 'protocol', BIOLOGY_NOTEBOOK: 'notebook' }
    })
  });
  async function click(target) {
    const button = { dataset: { agentRecordSource: target, agentSourceMessage: followup.id } };
    await actions.onHistoryClick({
      preventDefault() {},
      target: { closest: selector => selector === '[data-agent-record-source]' ? button : null }
    });
  }
  await click(protocolTarget);
  await click(notebookTarget);
  await click('hikari://notebook/unknown');
  state.agentChat.messages = [followup];
  await click(notebookTarget);
  assert.deepEqual(views, ['protocol', 'notebook']);
  console.log('Record citations passed through lookup, tool output, mixed chat links, and internal navigation.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
