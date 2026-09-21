import assert from 'node:assert/strict';
import { initPaperFindingWidget } from '../src/renderer/modules/home-dashboard/paper-finding.js';

class Element {
  constructor() {
    this.textContent = '';
    this.innerHTML = '';
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  click() {
    this.listeners.get('click')?.();
  }
}

const summary = new Element();
const list = new Element();
const openBtn = new Element();
let opened = 0;
const widget = initPaperFindingWidget({
  api: {
    listPaperFindingTasks: async () => ({
      ok: true,
      tasks: [{
        enabled: true,
        next_run_at: '2026-08-01T12:00:00.000Z',
        project: { name: 'Delivery & Discovery' },
        metadata: {
          paper_finding: {
            frequency_value: 2,
            frequency_unit: 'week'
          }
        }
      }]
    })
  },
  safeText: (value) => String(value || '').replace(/&/g, '&amp;'),
  onOpenNotebook: () => { opened += 1; },
  elements: { summary, list, openBtn }
});

widget.render();
assert.equal(summary.textContent, 'Loading schedules…');
await Promise.resolve();
await Promise.resolve();
assert.equal(summary.textContent, '1 active schedule');
assert.match(list.innerHTML, /Delivery &amp; Discovery/);
assert.match(list.innerHTML, /Every 2 weeks/);

openBtn.click();
assert.equal(opened, 1);

const resultSummary = new Element();
const resultList = new Element();
const resultWidget = initPaperFindingWidget({
  api: {
    listPaperFindingTasks: async () => ({
      ok: true,
      tasks: [{
        enabled: true,
        next_run_at: '2026-08-01T12:00:00.000Z',
        project: { name: 'Atlas <Project>' },
        metadata: { paper_finding: {} },
        last_run: {
          status: 'succeeded',
          result: {
            papers: [
              {
                title: 'A useful paper',
                authors: ['Ada Lovelace', 'Katherine Johnson'],
                journal: 'Nature Methods',
                published_at: '2026',
                source: 'Crossref',
                doi: '10.1000/useful',
                url: 'https://example.org/useful',
                summary: 'A concise result summary.',
                relevance_reason: 'It directly supports the project.'
              },
              {
                title: '<script>alert(1)</script>',
                url: 'javascript:alert(1)'
              }
            ]
          }
        }
      }]
    })
  },
  safeText: (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]),
  elements: { summary: resultSummary, list: resultList }
});

resultWidget.render();
await Promise.resolve();
await Promise.resolve();
assert.equal(resultSummary.textContent, '2 papers found · 1 active schedule');
assert.equal((resultList.innerHTML.match(/data-paper-finding-result/g) || []).length, 2);
assert.match(resultList.innerHTML, /Atlas &lt;Project&gt;/);
assert.match(resultList.innerHTML, /A useful paper/);
assert.match(resultList.innerHTML, /Ada Lovelace, Katherine Johnson/);
assert.match(resultList.innerHTML, /Nature Methods · 2026 · Crossref · DOI 10\.1000\/useful/);
assert.match(resultList.innerHTML, /A concise result summary\./);
assert.match(resultList.innerHTML, /Why it matters:<\/strong> It directly supports the project\./);
assert.match(resultList.innerHTML, /href="https:\/\/example\.org\/useful"/);
assert.match(resultList.innerHTML, /Metadata only/);
assert.match(resultList.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(resultList.innerHTML, /<script>|javascript:alert/);

const pollingSummary = new Element();
const pollingList = new Element();
let pollCallback = null;
let pollingCalls = 0;
pollingSummary.ownerDocument = {
  defaultView: {
    setInterval(callback, delay) {
      assert.equal(delay, 20_000);
      pollCallback = callback;
      return 1;
    }
  }
};
pollingSummary.closest = () => ({ classList: { contains: (name) => name === 'is-active' } });
const pollingTask = {
  id: 'polling-task',
  enabled: true,
  project: { name: 'Polling project' },
  metadata: { paper_finding: {} }
};
const pollingWidget = initPaperFindingWidget({
  api: {
    listPaperFindingTasks: async () => {
      pollingCalls += 1;
      return {
        ok: true,
        tasks: [{
          ...pollingTask,
          ...(pollingCalls > 1
            ? { last_run: { result: { papers: [{ title: 'Newly found paper' }] } } }
            : {})
        }]
      };
    }
  },
  elements: { summary: pollingSummary, list: pollingList }
});

pollingWidget.render();
await Promise.resolve();
await Promise.resolve();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pollingSummary.textContent, '1 active schedule');
assert.equal(typeof pollCallback, 'function');
pollCallback();
await Promise.resolve();
await Promise.resolve();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pollingSummary.textContent, '1 paper found · 1 active schedule');
assert.match(pollingList.innerHTML, /Newly found paper/);

const runSummary = new Element();
const runList = new Element();
const runBtn = new Element();
const ranIds = [];
let runListCalls = 0;
initPaperFindingWidget({
  api: {
    listPaperFindingTasks: async () => {
      runListCalls += 1;
      return {
        ok: true,
        tasks: [
          { id: 'task-a', enabled: true, project: { name: 'A' }, metadata: { paper_finding: {} } },
          { id: 'task-paused', enabled: false, project: { name: 'B' }, metadata: { paper_finding: {} } },
          ...(ranIds.length
            ? [{ id: 'task-c', enabled: true, project: { name: 'C' }, metadata: { paper_finding: {} }, last_run: { result: { papers: [{ title: 'Fresh paper' }] } } }]
            : [])
        ]
      };
    },
    runPaperFindingTask: async (id) => {
      ranIds.push(id);
      assert.equal(runSummary.textContent, 'Finding papers…');
      assert.equal(runBtn.disabled, true);
      return { ok: true };
    }
  },
  elements: { summary: runSummary, list: runList, runBtn }
}).render();
assert.equal(runBtn.hidden, true);
await Promise.resolve();
await Promise.resolve();
assert.equal(runBtn.hidden, false);
assert.equal(runBtn.disabled, false);
runBtn.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(ranIds, ['task-a']);
assert.equal(runListCalls, 2);
assert.equal(runBtn.disabled, false);
assert.equal(runSummary.textContent, '1 paper found · 2 active schedules');
assert.match(runList.innerHTML, /Fresh paper/);

console.log('home paper-finding selfcheck OK');
