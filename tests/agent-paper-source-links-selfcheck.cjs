'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');
const { buildMcpToolResponseContent } = require('../src/main/agent/mcp-contract/result-shaping/paper-results.js');
const base = path.resolve(__dirname, '../src/renderer/modules/agent-chat');
const graph = new Map();
const { resolvePaperSourceLink, createPaperSourceLinkRenderer } = loadEsmStyleModule(path.join(base, 'paper-source-links.js'), { URL }, [], graph);
const { renderMarkdown } = loadEsmStyleModule(path.join(base, 'markdown.js'), { URL }, [], graph);
const { createHistoryActionController } = loadEsmStyleModule(path.join(base, 'history-actions.js'), { URL }, [], graph);
const relative = 'KnowledgeBase/papers.md/Cas9 (2014)/nature13011.md';
const root = '/work/Lab papers';
const old = `/Users/user/Library/Application Support/Hikari/${relative}:32`;
const block = { paper_id: 'cas9', paper_title: 'DNA interrogation', source_path: relative,
  source_absolute_path: `${root}/${relative}`, line_ranges: [{ start_line: 32, end_line: 32 }],
  source_lines: [{ line_number: 32, content: 'The source evidence.' }] };
const safeText = text => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

async function main() {
  for (const tool of ['paper_analysis', 'literature_search']) {
    const payload = JSON.parse(buildMcpToolResponseContent(tool, { ok: true, status: 'completed', loaded_context_blocks: [block] }));
    assert.equal(payload.loaded_context_blocks[0].source_absolute_path, block.source_absolute_path, `${tool} retains the reader's real path`);
  }
  const legacy = { ...block, source_absolute_path: '' };
  assert.deepEqual(JSON.parse(JSON.stringify(resolvePaperSourceLink(old, [legacy], root))), { path: `${root}/${relative}`, line: 32, endLine: 32, paperId: 'cas9', paperTitle: 'DNA interrogation', sectionLabel: '', excerpt: 'The source evidence.' });
  assert.equal(resolvePaperSourceLink(`${root}/${relative}#L32`, [block]).path, `${root}/${relative}`);
  assert.equal(resolvePaperSourceLink(`${root}/${relative}:32:4`, [block]).line, 32);
  assert.equal(resolvePaperSourceLink('KnowledgeBase/papers.md/Cas9 (2014)/nature13011.md', [block], '/moved/storage').path,
    `/moved/storage/${relative}`, 'A reopened chat follows the current workspace storage');
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', '/etc/passwd',
    `file%3A///tmp/${relative}`, `https%3A//example.com/${relative}`,
    '/tmp/KnowledgeBase/papers.md/other/paper.md', `/tmp/../${relative}`, `/tmp/%2e%2e/${relative}`,
    `/tmp/KnowledgeBase/papers.md/../../${relative}`, `/tmp/${relative}\u0000`]) {
    assert.equal(resolvePaperSourceLink(value, [block], root), null, value);
  }
  const ranged = { ...block, source_lines: [...block.source_lines, {line_number:33,content:'The next supporting sentence.'}] };
  const selected = resolvePaperSourceLink(`${root}/${relative}#L32-L33`, [ranged], root);
  assert.equal(selected.endLine, 33);
  assert.equal(selected.excerpt, 'The source evidence.\nThe next supporting sentence.');
  for (const suffix of ['#L32-L31', '#L32-L40', ':999']) {
    assert.equal(resolvePaperSourceLink(`${root}/${relative}${suffix}`, [ranged], root), null, suffix);
  }
  assert.equal(resolvePaperSourceLink(`${root}/${relative}#L32-L33`, [block, ranged], root)?.endLine, 33,
    'A narrower overlapping block does not hide the block that has the whole range');
  const message ={ id: 'answer', role: 'assistant', meta: { paper_evidence: [legacy] } };
  const state = { settings: { storagePath: root }, agentChat: { messages: [message] } };
  const renderLocalLink = createPaperSourceLinkRenderer(message, state, safeText);
  const html = renderMarkdown(`[**Paper source**](<${old}>) and [web](<https://example.com/a(b)>).`, safeText, { renderLocalLink });
  assert.match(html, /data-agent-paper-source=/);
  assert.match(html, /<span>1<\/span>/);
  assert.match(html, /aria-label="Open in Papers: DNA interrogation"/, 'No dangling separator without a section');
  assert.doesNotMatch(html, /<strong>Paper source<\/strong>/);
  assert.match(html, /href="https:\/\/example.com\/a\(b\)"/);
  assert.doesNotMatch(html, /\]\(&lt;/);
  const inert = renderMarkdown('[Unknown](</tmp/missing paper.md:2>) [Unsafe](file:///etc/passwd) [Script](javascript:alert(1))', safeText, { renderLocalLink });
  assert.doesNotMatch(inert, /data-agent-paper-source|href=|\]\(/);
  const malicious = renderMarkdown(`[<img src=x onerror=alert(1)>](<${old}>)`, safeText, { renderLocalLink });
  assert.doesNotMatch(malicious, /<img/);
  assert.doesNotMatch(malicious, /onerror|alert/);
  const calls = [], notices = [];
  const actions = createHistoryActionController({ state,
    api: { openFilePath: () => { throw new Error('Citations must stay in Papers'); } },
    onOpenPaperCitation: async source => { calls.push(source); return { ok: true }; },
    setStatus: value => notices.push(value), persist() {}, renderHistoryView() {}, renderContextSummary() {} });
  const button = { dataset: { agentPaperSource: old, agentSourceMessage: message.id } };
  const event = { preventDefault() {}, target: { closest: selector => selector === '[data-agent-paper-source]' ? button : null } };
  await actions.onHistoryClick(event);
  assert.equal(calls[0].path, `${root}/${relative}`);
  assert.equal(calls[0].excerpt, 'The source evidence.', 'Click passes exact reader text to Papers');
  const followup = { id: 'followup', role: 'assistant', meta: {} };
  state.agentChat.messages.push({ id: 'question', role: 'user' }, followup);
  const followupHtml = renderMarkdown(`[Passage](<${old}>)`, safeText, {
    renderLocalLink: createPaperSourceLinkRenderer(followup, state, safeText)
  });
  assert.match(followupHtml, /data-agent-source-message="followup"/,
    'A follow-up retains clickable sources from earlier reader evidence');
  button.dataset.agentSourceMessage = followup.id;
  await actions.onHistoryClick(event);
  assert.equal(calls.length, 2, 'Follow-up clicks use the same trusted earlier evidence');
  state.agentChat.messages = [followup, message];
  const futureOnly = createPaperSourceLinkRenderer(followup, state, safeText)(old, 'Passage');
  assert.equal(futureOnly, '', 'A later paper read cannot authorize an earlier citation');
  state.agentChat.messages = [{ ...message, role: 'user' }, followup];
  assert.equal(createPaperSourceLinkRenderer(followup, state, safeText)(old, 'Passage'), '',
    'User-authored evidence metadata does not authorize a file');
  state.agentChat.messages = [];
  await actions.onHistoryClick(event);
  assert.equal(calls.length, 2, 'A stale citation from another chat cannot open a file');
  assert.equal(notices.length, 1);
  console.log('Paper source links passed: MCP paths, saved chats, spaces, formatting, click routing, and untrusted targets.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
