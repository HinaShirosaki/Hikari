'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  if (!process.versions.electron) {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], { encoding: 'utf8', timeout: 60000 });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, String(result.error || result.signal));
    return;
  }
  const { app, BrowserWindow } = require('electron');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-notebook-batch-'));
  app.setPath('userData', path.join(scratch, 'profile'));
  app.disableHardwareAcceleration();
  await app.whenReady();
  const root = path.resolve(__dirname, '..');
  const url = (file) => pathToFileURL(path.join(root, file)).href;
  const fixture = path.join(scratch, 'index.html');
  fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${url('styles.css')}"></head><body class="theme-day">${fs.readFileSync(path.join(root, 'ui/html/views/agent-view.html'), 'utf8').replace('class="view"', 'class="view is-active"')}</body></html>`);
  const window = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await window.loadFile(fixture);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const base = ${JSON.stringify(url('src/renderer/modules/'))};
      const { renderDraftCards } = await import(base + 'agent-chat/rendering-drafts.js');
      const { createHistoryActionController } = await import(base + 'agent-chat/history-actions.js');
      const { createAgentReviewOverlayController } = await import(base + 'agent-chat/review-overlay.js');
      const { collectAgentChatDom } = await import(base + 'agent-chat/dom-bindings.js');
      const { createNotebookDraftAgentAdapter } = await import(base + 'biology-notebook/agent/notebook-drafts.js');
      const check = (value, message) => { if (!value) throw new Error(message); };
      const safeText = (value) => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
      const drafts = Array.from({ length: 20 }, (_, i) => ({
        proposal: { proposal_id: 'draft-' + i, title: 'Experiment ' + (i + 1), purpose: 'Review this independent page.' },
        protocol: { id: 'protocol', name: 'Protocol' }, project: { id: 'project', name: 'Project' },
        rendered_steps: ['Prepare sample ' + i, 'Record the outcome.'],
        save: { mode: 'confirm_before_save', status: 'awaiting_user_confirmation', applied: false },
        entry_template: { projectId: 'project', protocolId: 'protocol', result: 'Planning notes ' + i,
          notebookState: 'planned', agentDraftMeta: { proposalId: 'draft-' + i } }
      }));
      const state = { notebookEntries: [], agentChat: { messages: [{ id: 'batch', role: 'assistant',
        meta: { notebookDraft: drafts[0], notebookDrafts: drafts } }] } };
      let sequence = 0;
      const adapter = createNotebookDraftAgentAdapter({ state, createId: () => 'entry-' + (++sequence) });
      const dom = collectAgentChatDom(document, { idPrefix: 'agent' });
      const message = state.agentChat.messages[0];
      const redraw = () => { dom.historyNode.innerHTML = renderDraftCards(message.meta, message.id, { safeText, notebookDraftAdapter: adapter }); };
      const actions = createHistoryActionController({ state, input: dom.input, persist() {}, setStatus() {},
        renderContextSummary() {}, renderHistoryView: redraw, notebookDraftAdapter: adapter, onOpenNotebookEntry() {} });
      dom.historyNode.addEventListener('click', actions.onHistoryClick);
      const review = createAgentReviewOverlayController({ dom, state, safeText, persist() {}, setStatus() {},
        renderContextSummary() {}, renderHistoryView: redraw, notebookActions: actions.notebookActions, notebookDraftAdapter: adapter });
      redraw();
      check(document.querySelectorAll('[data-agent-create-planned-page]').length === 20, 'All 20 inline pages must exist');
      review.openForMessage(message);
      check(dom.reviewTrack.querySelectorAll('[data-agent-review-approve]').length === 20, 'All 20 overlay pages must exist');
      dom.reviewNextBtn.click();
      dom.reviewNextBtn.click();
      dom.reviewTrack.querySelector('[data-agent-review-approve="notebook:batch:draft-2"]').click();
      check(state.notebookEntries.length === 1 && state.notebookEntries[0].agentDraftMeta.proposalId === 'draft-2', 'Approves only selected page');
      dom.reviewTrack.querySelector('[data-agent-review-reject="notebook:batch:draft-0"]').click();
      check(review.collectReviewItemsForMessage(message).length === 18, 'Reject removes only one pending page');
      review.close();
      const inline = dom.historyNode.querySelector('[data-agent-create-planned-page][data-agent-draft-id="draft-19"]');
      inline.click(); inline.click();
      check(state.notebookEntries.length === 2, 'Repeated approval must not duplicate a page');
      check(state.notebookEntries[1].agentDraftMeta.proposalId === 'draft-19', 'Last inline button targets last draft');
      const restored = JSON.parse(JSON.stringify(message));
      check(review.collectReviewItemsForMessage(restored).length === 17, 'Persisted review state survives reopening');
      review.openForMessage(restored);
      check(dom.reviewTrack.querySelectorAll('[data-agent-review-approve]').length === 17, 'Reopened overlay must not resurrect approved pages');
      return { cards: 20, saved: state.notebookEntries.length, pending: 17 };
    })()`);
    assert.deepEqual(result, { cards: 20, saved: 2, pending: 17 });
    console.log('Notebook batch native UI passed: 20 cards, navigation, per-page approval/rejection, double-click safety, and restored review state.');
  } finally {
    window.destroy();
    app.quit();
  }
}

main().catch((error) => { console.error(error); if (process.versions.electron) require('electron').app.exit(1); else process.exitCode = 1; });
