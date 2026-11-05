'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { loadEsmStyleModule } = require('./support/runtime.js');
const { discoverPapersFromStorageRoot } = require('../src/main/storage/paper-discovery.js');
const { registerDataIpc } = require('../src/main/ipc/register-data-ipc.js');
const { STORAGE } = require('../src/shared/ipc/channels.js');
const { createStoredPaperDiscovery } = loadEsmStyleModule(path.resolve(__dirname,
  '../src/renderer/modules/papers/management/discover-stored.js'));
const { createDiscoveryMerge } = loadEsmStyleModule(path.resolve(__dirname,
  '../src/renderer/modules/papers/management/discovery-merge.js'));

async function checkAnnotationRace(storagePath, initialPapers, editAnnotations, label) {
  let finishIntake, startIntake;
  const intakeGate = new Promise(resolve => { finishIntake = resolve; });
  const intakeStarted = new Promise(resolve => { startIntake = resolve; });
  const state = { settings: { storagePath }, papers: structuredClone(initialPapers), journalClubs: [] };
  let savedPapers;
  const persist = () => { savedPapers = structuredClone(state.papers); };
  const discovery = createStoredPaperDiscovery({ state,
    elements: { papersView: { classList: { contains: () => true } } },
    windowRef: { hikariApi: { discoverStoredPapers: async payload => ({ ok: true,
      ...await discoverPapersFromStorageRoot({
        // IPC takes a snapshot before asynchronous extraction begins.
        ...structuredClone(payload),
        transformPaperRecordsToMarkdown: async () => {
          startIntake(); await intakeGate; return { warnings: [] };
        }
      }) }) } },
    library: { renderLinkTargets() {}, renderLibrarySidebar() {} }, comments: { renderCommentSidebar() {} },
    persist, ...createDiscoveryMerge({ state }) });
  const intake = discovery.maybeDiscoverStoredPapers();
  await intakeStarted;
  await discovery.maybeDiscoverStoredPapers({ force: true, metadataOnly: true });
  assert.equal(state.papers.length, 1, 'The metadata scan opens the paper before intake completes');
  editAnnotations(state.papers[0]);
  persist();
  const expected = structuredClone(state.papers[0]);
  finishIntake(); await intake;
  for (const field of ['highlights', 'comments']) {
    assert.deepEqual(state.papers[0][field], expected[field], `${label}: live ${field} survive intake`);
    assert.deepEqual(savedPapers[0][field], expected[field], `${label}: saved ${field} survive intake`);
  }
}

async function main() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-citation-discovery-'));
  try {
    fs.mkdirSync(path.join(scratch, 'Papers/Downloaded'), { recursive: true });
    fs.writeFileSync(path.join(scratch, 'Papers/Downloaded/paper.pdf'), '%PDF-1.7\nfixture');
    let extractions = 0;
    const transformPaperRecordsToMarkdown = async () => { extractions++; return { warnings: [] }; };
    const result = await discoverPapersFromStorageRoot({ storagePath: scratch, metadataOnly: true, transformPaperRecordsToMarkdown });
    assert.equal(result.papers.length, 1);
    assert.equal(extractions, 0, 'Navigation discovers the downloaded PDF without Markdown extraction or model intake');
    await discoverPapersFromStorageRoot({ storagePath: scratch, transformPaperRecordsToMarkdown });
    assert.equal(extractions, 1, 'Ordinary library discovery retains extraction');
    const handlers = new Map(); let received;
    registerDataIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, fs: require('node:fs/promises'),
      discoverPapersFromStorageRoot: async payload => { received = payload; return { papers: [] }; } });
    await handlers.get(STORAGE.DISCOVER_PAPERS)({}, { storagePath: scratch, metadataOnly: true });
    assert.equal(received.metadataOnly, true, 'The real IPC handler forwards the metadata-only flag');

    await checkAnnotationRace(scratch, [], paper => {
      paper.highlights.push({ id: 'highlight', text: 'Important result' });
      paper.comments.push({ id: 'comment', highlightId: 'highlight', text: 'My note' });
    }, 'Newly discovered paper');
    const annotated = structuredClone(result.papers);
    annotated[0].highlights = [{ id: 'highlight', text: 'Original highlight' }];
    annotated[0].comments = [{ id: 'comment', text: 'Original note' }];
    await checkAnnotationRace(scratch, annotated, paper => {
      paper.highlights[0].text = 'Edited highlight';
      paper.comments[0].text = 'Edited note';
    }, 'Edited annotations');
    await checkAnnotationRace(scratch, annotated, paper => {
      paper.highlights = [];
      paper.comments = [];
    }, 'Deleted annotations');
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }

  let completeBackground;
  const background = new Promise(resolve => { completeBackground = resolve; });
  const state = { settings: { storagePath: '/work/Lab' }, papers: [] };
  const calls = [];
  const discovery = createStoredPaperDiscovery({ state, elements: { papersView: { classList: { contains: () => true } } },
    windowRef: { hikariApi: { discoverStoredPapers: async payload => { calls.push(payload); return payload.metadataOnly
      ? { ok: true, papers: [{ id: 'just-downloaded' }] } : background; } } },
    library: { renderLinkTargets() {}, renderLibrarySidebar() {} }, comments: { renderCommentSidebar() {} }, persist() {},
    mergeDiscoveredJournalClubs: () => false, mergeDiscoveredPapers: papers => { state.papers.push(...papers); return papers.length > 0; } });
  const intake = discovery.maybeDiscoverStoredPapers();
  await discovery.maybeDiscoverStoredPapers({ force: true, metadataOnly: true });
  assert.equal(state.papers[0].id, 'just-downloaded', 'Navigation finishes while background intake is still pending');
  assert.equal(calls.length, 2);
  completeBackground({ ok: true, papers: [] }); await intake;
  console.log('Citation discovery passed: real IPC flag, pending intake bypassed, and added, edited or deleted annotations preserved in memory and persistence.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
