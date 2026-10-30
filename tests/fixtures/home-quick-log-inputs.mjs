// Production Home controllers with fictional data and controlled assistant replies.
import { defaultState, loadState, persistState, STORAGE_KEY } from '../../src/renderer/modules/app-state/index.js';
import { homeDashboardManifest } from '../../src/renderer/module-manifests/home-dashboard.js';
import { escapeHtml } from '../../src/renderer/lib/html.js';

const state = structuredClone(defaultState);
state.settings.storagePath = '';
state.settings.dashboard.quickLogDraft = '';
state.settings.dashboard.quickLogEntries = [];
state.projects = [{ id: 'qa-project', name: 'Buffer pilot · QA' }];
state.protocols = [{ id: 'qa-protocol', name: 'Buffer comparison', steps: [] }];
state.notebookEntries = [{ id: 'qa-page', projectId: 'qa-project', protocolId: 'qa-protocol',
  projectName: 'Buffer pilot · QA', protocolName: 'Buffer comparison', experimentName: 'Pilot run 2',
  result: 'Existing observation.', updatedAt: '2026-10-28T12:00:00Z' }];
state.agentChat.messages = [{ id: 'unrelated', role: 'user', text: 'Unrelated main conversation.' }];
if (localStorage.getItem(STORAGE_KEY)) Object.assign(state, loadState());

const qa = {
  state, requests: [], pending: null, failSave: false, assertions: 0, scenarios: [],
  saved: () => JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'),
  byId: id => document.getElementById(id),
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  check(value, message) { this.assertions++; if (!value) throw Error(message); },
  input(value) {
    const input = this.byId('dashboard-quick-log-input');
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  },
  close() { this.byId('home-agent-close-btn').click(); },
  async waitFor(predicate, label) {
    for (let index = 0; index < 100; index++) {
      if (predicate()) return;
      await this.wait(10);
    }
    throw Error('Timed out: ' + label);
  },
  async prepare(value) {
    const expected = this.input(value).trim();
    const previousRequests = this.requests.length;
    this.byId('dashboard-quick-log-agent-btn').click();
    await this.waitFor(() => this.pending && this.requests.length === previousRequests + 1, 'assistant request');
    const request = this.requests.at(-1);
    this.check(request.message === expected, 'Assistant receives the complete original note');
    this.check(request.agent.sessionPrompt.includes('Never invent performed steps'), 'Home supplies the observation fidelity instruction');
    this.check(request.conversation.every(message => !message.text?.includes('Unrelated main conversation')), 'Home conversation stays isolated');
    return expected;
  },
  async complete(response, success = true) {
    const finish = this.pending; this.pending = null; finish(response);
    await this.waitFor(() => !this.byId('dashboard-quick-log-input').disabled, 'handoff completion');
    this.check(this.byId('dashboard-quick-log-status').classList.contains('is-error') !== success, 'Handoff status matches result');
  }
};
window.hikariApi = {
  listPaperFindingTasks: async () => ({ ok: true, tasks: [] }),
  agentChat: request => {
    qa.requests.push(request);
    return new Promise(resolve => { qa.pending = resolve; });
  }
};
const controller = homeDashboardManifest.init(homeDashboardManifest.createOptions({
  state,
  persist: () => {
    if (qa.failSave) throw Error('QA: simulated full local storage');
    persistState(state);
  },
  createId: () => crypto.randomUUID(), safeText: escapeHtml,
  showView: () => {}, views: {}, modules: {}, apiBridge: window.hikariApi,
  rootDocument: document, windowObject: window,
  rendererServices: { notebook: { handleAgentNotebookEntriesChanged() {} }, protocol: { handleProtocolsChanged() {} } }
}));
controller.render();
qa.controller = controller;
window.quickLogQa = qa;
