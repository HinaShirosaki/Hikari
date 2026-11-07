// Mounts the real agent chat rail beside the notebook tutorial fixture and
// renders one fictional conversation with the real history renderer.
import { createAgentChatRail } from '../../../src/renderer/app/navigation-shell/agent-rail.js';
import { renderHistory } from '../../../src/renderer/modules/agent-chat/rendering.js';
import { hydrateAgentChatIcons } from '../../../src/renderer/modules/agent-chat/icons.js';
import { createNotebookDraftAgentAdapter } from '../../../src/renderer/modules/biology-notebook/agent/index.js';
import { createProtocolAgentAdapter } from '../../../src/renderer/modules/protocol/agent/index.js';
import { APP_REGISTRY } from '../../../src/renderer/modules/app-registry.generated.js';

const paperPath = 'KnowledgeBase/papers.md/buffer-choice-and-the-clarity-of-a-model-protein.md';
const evidence = [{
  block_id: 'demo-evidence-1',
  paper_id: 'demo-buffer-paper',
  paper_title: 'Buffer choice and the clarity of a model protein: a teaching example',
  section_label: 'Results',
  source_path: paperPath,
  source_absolute_path: `/Tutorial workspace/${paperPath}`,
  line_ranges: [{ start_line: 42, end_line: 43 }, { start_line: 57, end_line: 57 }],
  source_lines: [
    { line_number: 42, content: 'Buffer A kept the protein solution clear for at least 30 minutes after dilution.' },
    { line_number: 43, content: 'Buffer B produced a slight haze within the same window.' },
    { line_number: 57, content: 'A longer incubation in buffer B increased the haze, measured as a higher apparent absorbance at 340 nm.' }
  ],
  relevance_reason: 'Reports the clarity difference between the two buffers and how it changes with incubation time.',
  related_comments: [{ author: 'You', text: 'Matches what we saw in the Buffer B pilot.' }]
}];

const messages = [
  {
    id: 'demo-user-1',
    role: 'user',
    text: 'The Buffer B pilot came out hazy and Buffer A did not. Is that the buffer, or the longer incubation?',
    createdAt: '2026-10-20T16:12:00-05:00'
  },
  {
    id: 'demo-assistant-1',
    role: 'assistant',
    createdAt: '2026-10-20T16:12:40-05:00',
    text: [
      'Both of your executed pages share the same protocol, so the difference is the buffer rather than the handling.',
      '',
      'The teaching paper you saved reports the same pattern: buffer A stayed clear for at least 30 minutes while buffer B became slightly hazy in that window [source](<' + paperPath + ':42>), and a longer incubation in buffer B increased the haze [source](<' + paperPath + ':57>).',
      '',
      '| Page | Buffer | Incubation | Appearance |',
      '| --- | --- | --- | --- |',
      '| Buffer A pilot | Buffer A | 30 min | clear |',
      '| Buffer B pilot | Buffer B | 30 min | slight haze |',
      '',
      'To separate buffer from time, run **Buffer B repeat** at both 30 and 90 minutes and record the appearance at each point. I have left that page planned in this project; open it from the left rail and fill in the concentrations before you start.'
    ].join('\n'),
    meta: { paper_evidence: evidence }
  }
];

const state = window.tutorial.state;
state.settings = { ...state.settings, storagePath: '/Tutorial workspace' };
state.agentChat = { currentSessionId: 'demo-session', messages };

const rail = createAgentChatRail({
  VIEWS: { PAPERS: 'papers-view' },
  documentObject: document,
  getActiveViewId: () => 'biology-notebook-view',
  getAppForView: id => APP_REGISTRY.find(app => app.viewId === id),
  resolveNavigationViewId: id => id,
  moduleRuntime: {},
  sharedLeftRailRuntime: { syncWidth() {} }
});
rail.init();
rail.syncState('biology-notebook-view');
rail.setExpanded(true);

const safeText = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

renderHistory({
  historyNode: document.getElementById('agent-rail-chat-history'),
  messages,
  state,
  safeText,
  notebookDraftAdapter: createNotebookDraftAgentAdapter({ state }),
  protocolReviewAdapter: createProtocolAgentAdapter({ state }),
  api: {}
});
document.querySelector('.universal-agent-chat-rail__conversation')?.classList.remove('is-empty-chat');
// The chat module normally fills the composer icons when it mounts.
hydrateAgentChatIcons(document);
// The gallery takes one shot without the rail and one with it.
window.readmeRail = rail;
window.readmeAgentReady = true;
