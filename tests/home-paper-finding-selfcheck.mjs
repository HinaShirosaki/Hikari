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

console.log('home paper-finding selfcheck OK');
