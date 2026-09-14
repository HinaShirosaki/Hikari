import assert from 'node:assert/strict';
import { createPapersWorkspaceControls } from '../src/renderer/modules/papers/workspace-controls.js';

class Control extends EventTarget {
  constructor() {
    super();
    this.attributes = new Map();
    const classes = new Set();
    this.classList = {
      contains: (name) => classes.has(name),
      toggle(name, active) {
        if (active) classes.add(name);
        else classes.delete(name);
      }
    };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  click() { this.dispatchEvent(new Event('click')); }
}

const doc = new EventTarget();
doc.defaultView = { CustomEvent };
doc.body = new Control();
const elements = Object.fromEntries([
  'papersLayout', 'papersLibraryRail', 'paperCommentToggleBtn', 'paperBriefToggleBtn', 'paperDetailsToggleBtn'
].map((name) => [name, new Control()]));
const uiState = { commentsCollapsed: true };
const win = new EventTarget();
win.innerWidth = 1440;
const context = {
  document: doc, window: win, elements, uiState,
  setCommentsCollapsed(value) {
    uiState.commentsCollapsed = value;
    context.syncWorkspaceControls?.();
  },
  toggleCommentsCollapsed() { context.setCommentsCollapsed(!uiState.commentsCollapsed); }
};
let currentView = 'papers-view';
function setChat(expanded) {
  doc.body.classList.toggle('has-agent-chat-rail-expanded', expanded);
  doc.dispatchEvent(new CustomEvent('hikari:agent-chat-rail-state', {
    detail: { expanded, viewId: currentView }
  }));
}
doc.addEventListener('hikari:open-agent-chat-rail', () => setChat(true));
doc.addEventListener('hikari:close-agent-chat-rail', () => setChat(false));
createPapersWorkspaceControls(context);
const outline = () => elements.paperCommentToggleBtn.click();
const isChatOpen = () => doc.body.classList.contains('has-agent-chat-rail-expanded');

outline();
assert.equal(uiState.commentsCollapsed, false);
setChat(true);
assert.equal(uiState.commentsCollapsed, true, 'opening Hikari closes the outline');
outline();
assert.equal(isChatOpen(), false, 'opening the outline closes Hikari');
assert.equal(uiState.commentsCollapsed, false);
outline();
assert.equal(uiState.commentsCollapsed, true, 'the active outline button closes its panel');

elements.papersLayout.classList.toggle('is-left-rail-folded', true);
outline();
setChat(true);
assert.equal(uiState.commentsCollapsed, true);
assert.equal(elements.papersLayout.classList.contains('is-left-rail-folded'), true);
assert.equal(elements.papersLibraryRail.inert, true, 'panel switching preserves the previous library fold');

outline();
currentView = 'biology-notebook-view';
setChat(true);
assert.equal(uiState.commentsCollapsed, false, 'chat in another module does not change Papers');
currentView = 'papers-view';
setChat(false);
elements.papersLayout.classList.toggle('is-left-rail-folded', false);
win.innerWidth = 1024;
win.dispatchEvent(new Event('resize'));
assert.equal(elements.papersLibraryRail.inert, true, 'a narrow context layout removes hidden library controls from keyboard navigation');
outline();
assert.equal(elements.papersLibraryRail.inert, false, 'closing the context restores the library');
outline();
win.innerWidth = 1440;
win.dispatchEvent(new Event('resize'));
assert.equal(elements.papersLibraryRail.inert, false, 'wide layouts keep the library accessible beside a context panel');
console.log('Papers workspace controls passed: panel exclusivity, library state, responsive access, and view isolation.');

const brief = () => elements.paperBriefToggleBtn.click();
brief();
assert.equal(uiState.commentsCollapsed, false);
assert.equal(uiState.contextPanel, 'brief', 'brief replaces the open outline in the same column');
setChat(true);
assert.equal(uiState.commentsCollapsed, true, 'chat closes the brief');
brief();
assert.equal(isChatOpen(), false, 'brief closes chat');
assert.equal(uiState.contextPanel, 'brief');
brief();
assert.equal(uiState.commentsCollapsed, true, 'the active brief button closes its panel');
brief();
outline();
assert.equal(uiState.contextPanel, 'outline');
assert.equal(uiState.commentsCollapsed, false, 'outline replaces the brief without closing the shared column');
console.log('Research brief panel switching passed.');

const details = () => elements.paperDetailsToggleBtn.click();
details();
assert.equal(uiState.contextPanel, 'details');
assert.equal(uiState.commentsCollapsed, false, 'details replaces outline');
brief();
assert.equal(uiState.contextPanel, 'brief');
details();
assert.equal(uiState.contextPanel, 'details', 'details replaces brief');
setChat(true);
assert.equal(uiState.commentsCollapsed, true, 'Hikari closes details');
details();
assert.equal(isChatOpen(), false, 'details closes Hikari');
details();
assert.equal(uiState.commentsCollapsed, true, 'details toggles closed');
console.log('Paper details panel switching passed.');
