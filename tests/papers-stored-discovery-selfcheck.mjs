import assert from 'node:assert/strict';
import { createStoredPaperDiscovery } from '../src/renderer/modules/papers/management/discover-stored.js';

let calls = 0;
let release = null;
const merged = [];
const discovery = createStoredPaperDiscovery({
  state: { settings: { storagePath: '/root' }, papers: [], projects: [], journalClubs: [] },
  elements: { papersView: { classList: { contains: (name) => name === 'is-active' } } },
  windowRef: {
    hikariApi: {
      discoverStoredPapers: () => {
        calls += 1;
        return new Promise((resolve) => { release = resolve; });
      }
    }
  },
  library: { renderLinkTargets() {}, renderLibrarySidebar() {} },
  comments: { renderCommentSidebar() {} },
  mergeDiscoveredJournalClubs: () => true,
  mergeDiscoveredPapers: (papers) => {
    merged.push(...papers);
    return papers.length > 0;
  },
  persist() {}
});

// Showing Papers starts a scan; "Open" from Home must wait on that same scan.
const fromRender = discovery.maybeDiscoverStoredPapers();
const fromOpen = discovery.maybeDiscoverStoredPapers({ force: true });
assert.equal(fromOpen, fromRender);
assert.equal(calls, 1);
release({ ok: true, journalClubs: [{ id: 'club-1' }], papers: [{ id: 'paper-1' }] });
await fromOpen;
assert.deepEqual(merged, [{ id: 'paper-1' }], 'new papers merge even when a journal club was new too');

await discovery.maybeDiscoverStoredPapers();
assert.equal(calls, 1, 'a render within 15s reuses the last scan');
const forced = discovery.maybeDiscoverStoredPapers({ force: true });
assert.equal(calls, 2, 'force rescans for a file saved since the last scan');
release({ ok: true, journalClubs: [], papers: [] });
await forced;

// Main reports a saved PDF: the next render scans despite the throttle.
discovery.markStale();
const afterSave = discovery.maybeDiscoverStoredPapers();
assert.equal(calls, 3, 'a reported save skips the throttle');
// A save reported while that scan runs gets one follow-up scan.
discovery.markStale();
release({ ok: true, journalClubs: [], papers: [] });
await afterSave;
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls, 4, 'a save during a scan triggers one more scan');
release({ ok: true, journalClubs: [], papers: [] });

console.log('papers stored discovery selfcheck OK');
