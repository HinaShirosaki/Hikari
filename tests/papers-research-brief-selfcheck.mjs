import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolveResearchBriefPath, loadResearchBrief } from '../src/renderer/modules/papers/research-brief.js';
const require = createRequire(import.meta.url);
const { normalizeIntakeRecord } = require('../src/main/papers/store/intake/intake-store.js');
const paper = { id: 'renderer-id', knowledgeMetaRelativePath: 'KnowledgeBase/papers.md/storage-slug/meta.json' };
const path = '/workspace/KnowledgeBase/papers.md/storage-slug/intake.json';
assert.equal(resolveResearchBriefPath(paper, '/workspace/'), path);
assert.equal(resolveResearchBriefPath({ id: paper.id }, '/workspace'), '', 'renderer IDs cannot identify knowledge folders');
for (const invalid of ['../../secret/meta.json', 'KnowledgeBase/papers.md/../meta.json', '/KnowledgeBase/papers.md/slug/meta.json', 'KnowledgeBase/papers.md/slug/extra/meta.json']) {
  assert.equal(resolveResearchBriefPath({ knowledgeMetaRelativePath: invalid }, '/workspace'), '');
}
assert.equal(resolveResearchBriefPath({ knowledge_markdown_relative_path: 'KnowledgeBase/papers.md/storage-slug/Paper.md' }, '/workspace'), path);
const record = normalizeIntakeRecord({ paper_id: 'storage-slug', doc_type: 'research_paper', one_sentence_summary: 'A saved conclusion.', experiments: [{ title: 'Binding', technique: 'ELISA', variables: 'Concentration', outcome: 'Dose-dependent binding.', figure_ref: 'Fig. 2', evidence: 'The signal increased.' }] });
let reads = 0;
const api = { async readFileBytes(target) { reads++; assert.equal(target, path); return { ok: true, bytes: new TextEncoder().encode(JSON.stringify(record)).buffer }; } };
assert.deepEqual(await loadResearchBrief(paper, '/workspace', api), { status: 'ready', record });
assert.equal(reads, 1);
assert.equal((await loadResearchBrief(null, '/workspace', api)).status, 'empty');
assert.equal(reads, 1, 'no paper never reads a file');
assert.equal((await loadResearchBrief(paper, '/workspace', {})).status, 'unavailable');
for (const [error, status] of [['ENOENT: missing file', 'empty'], ['EACCES: permission denied', 'error']]) {
  assert.equal((await loadResearchBrief(paper, '/workspace', { readFileBytes: async () => ({ ok: false, error }) })).status, status);
}
assert.equal((await loadResearchBrief(paper, '/workspace', { readFileBytes: async () => ({ ok: true, bytes: new TextEncoder().encode('broken') }) })).status, 'error');
console.log('Research brief passed: canonical record, knowledge-folder identity, path validation, missing files, and read errors.');

// A small DOM stand-in exercises the controller without browser permissions.
const { createPaperResearchBrief } = await import('../src/renderer/modules/papers/research-brief.js');
class Element extends EventTarget {
  childNodes = [];
  textContent = '';
  append(...children) {
    for (const child of children) this.childNodes.push(...(child.isFragment ? child.childNodes : [child]));
  }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
}
const content = new Element();
const doc = {
  createElement: () => new Element(),
  createDocumentFragment: () => Object.assign(new Element(), { isFragment: true })
};
const allText = el => [el.textContent, ...el.childNodes.map(allText)].join(' ');
let activePaper = paper;
const pending = [];
const context = {
  document: doc,
  elements: { paperBriefContent: content },
  state: { settings: { storagePath: '/workspace' } },
  uiState: { commentsCollapsed: false, contextPanel: 'brief' },
  window: { hikariApi: { readFileBytes: target => new Promise(resolve => pending.push({ target, resolve })) } },
  getActivePaper: () => activePaper
};
const controller = createPaperResearchBrief(context);
const finish = (index, value) => pending[index].resolve({ ok: true, bytes: new TextEncoder().encode(JSON.stringify(value)).buffer });
const first = controller.render();
assert.match(allText(content), /Loading/);
await controller.render();
assert.equal(pending.length, 1, 'page changes do not repeatedly fetch or reset expanded experiments');
activePaper = { id: 'second-paper', knowledgeMetaRelativePath: 'KnowledgeBase/papers.md/second/meta.json' };
const second = controller.render();
finish(1, { one_sentence_summary: 'Second paper', experiments: [{ title: '<img onerror=alert(1)>', evidence: '<script>unsafe()</script>' }] });
await second;
finish(0, record);
await first;
assert.match(allText(content), /Second paper/);
assert.doesNotMatch(allText(content), /A saved conclusion/);
assert.match(allText(content), /<img onerror=alert\(1\)>/, 'record text is assigned as literal text, never HTML');
assert.match(allText(content), /<script>unsafe\(\)<\/script>/);
context.uiState.commentsCollapsed = true;
await controller.render();
context.uiState.commentsCollapsed = false;
const reopened = controller.render();
assert.equal(pending.length, 3, 'reopening reloads updated saved analysis');
activePaper = null;
await controller.render();
finish(2, record);
await reopened;
assert.match(allText(content), /Open a paper/, 'late reads do not replace the no-document state');
activePaper = paper;
const retryLoad = controller.render();
pending[3].resolve({ ok: false, error: 'EACCES' });
await retryLoad;
assert.match(allText(content), /Could not read.*Try again/);
content.childNodes[1].dispatchEvent(new Event('click'));
assert.equal(pending.length, 5, 'retry starts a new read');
finish(4, { doc_type: 'book', structure_outline: [{ section: 'Introduction', summary: 'Section summary' }], notable_claims: [{ section: 'Discussion', claim: 'A saved claim' }] });
await new Promise(resolve => setImmediate(resolve));
assert.match(allText(content), /Sections.*Introduction.*Section summary.*Notable claims.*A saved claim/);
console.log('Research brief controller passed: stale-response protection, reload, retry, literal text, and non-research records.');
