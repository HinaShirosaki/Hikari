import { mapExperimentDataToLlmJson } from './experiment-llm-mapper.js';
import { collectAgentActivityRows, normalizeAgentResponse } from './agent-chat-response.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function trimText(value, maxLength = 5000) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function getMethodStepText(step) {
  if (typeof step === 'string') {
    return trimText(step, 180);
  }
  return trimText(step?.action || step?.text || step?.instruction || step?.description, 180);
}

function mapWorkflow(workflow, protocolsById = new Map(), projectNameById = new Map()) {
  const blocks = asArray(workflow?.blocks);
  const stepsPreview = blocks.map((block) => {
    if (String(block?.type || '').trim().toLowerCase() === 'text') {
      return trimText(block?.text, 180);
    }
    const protocolId = String(block?.protocolId || '').trim();
    const protocolName = protocolId ? protocolsById.get(protocolId) : '';
    return trimText(protocolName || protocolId || block?.text, 180);
  }).filter(Boolean).slice(0, 8);

  const projectId = String(workflow?.projectId || '').trim();
  return {
    id: String(workflow?.id || ''),
    name: trimText(workflow?.name, 180),
    description: trimText(workflow?.description, 400),
    projectId,
    project_name: trimText(projectNameById.get(projectId), 180),
    block_count: blocks.length,
    link_count: asArray(workflow?.links).length,
    steps_preview: stepsPreview,
    updated_at: String(workflow?.updatedAt || workflow?.createdAt || '')
  };
}

// Re-export to preserve existing imports from agent-chat.js.
export { mapExperimentDataToLlmJson };

function mapPaper(paper) {
  const summaryStructured = paper?.summaryStructured && typeof paper.summaryStructured === 'object'
    ? paper.summaryStructured
    : {};
  const keyFigures = asArray(paper?.keyFigures).length
    ? asArray(paper.keyFigures)
    : asArray(summaryStructured?.important_figures_or_tables).map((item) => (
      typeof item === 'string'
        ? trimText(item, 220)
        : trimText(`${item?.item || item?.label || item?.figure || 'figure'}: ${item?.summary || item?.description || ''}`, 220)
    ));
  const hasUploadedPdf = Boolean(trimText(paper?.pdfDataUrl, 40))
    || Boolean(trimText(paper?.storedFilePath, 80))
    || Boolean(trimText(paper?.storedRelativePath, 80));

  return {
    id: String(paper?.id || ''),
    title: trimText(paper?.title, 220),
    linkedType: String(paper?.linkedType || ''),
    linkedId: String(paper?.linkedId || ''),
    linked_project_name: trimText(paper?.linkedName || paper?.projectName, 220),
    summary: trimText(paper?.summary, 1200),
    methods: asArray(paper?.methodsExtract)
      .slice(0, 6)
      .map((method) => ({
        title: trimText(method?.title, 180),
        steps: asArray(method?.steps).slice(0, 10).map((step) => getMethodStepText(step)).filter(Boolean),
        citations: asArray(method?.citations).slice(0, 8).map((item) => trimText(item, 120)).filter(Boolean)
      })),
    reagents: asArray(paper?.keyReagents)
      .slice(0, 12)
      .map((item) => ({
        name: trimText(item?.name, 160),
        type: trimText(item?.type, 80),
        identifier: trimText(item?.identifier, 120),
        notes: trimText(item?.notes, 220)
      }))
      .filter((item) => item.name),
    key_figures: keyFigures.map((item) => trimText(item, 220)).filter(Boolean).slice(0, 10),
    has_uploaded_pdf: hasUploadedPdf,
    deep_read_ready: paper?.deepReadReady === true || paper?.deep_read_ready === true,
    availability_status: trimText(paper?.availabilityStatus || paper?.availability_status, 80),
    ingestion_status: trimText(paper?.ingestionStatus || paper?.ingestion_status, 80),
    ingestion_updated_at: trimText(paper?.ingestionUpdatedAt || paper?.ingestion_updated_at || paper?.updatedAt, 80),
    ingestion_errors: asArray(paper?.ingestionErrors || paper?.ingestion_errors).map((item) => trimText(item, 220)).filter(Boolean).slice(0, 5),
    updated_at: trimText(paper?.updatedAt || paper?.createdAt, 80)
  };
}

function mapProject(project) {
  return {
    id: String(project?.id || ''),
    name: trimText(project?.name, 160),
    summary: trimText(project?.description || project?.objective, 240)
  };
}

function toConversation(messages) {
  return asArray(messages)
    .slice(-12)
    .map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      text: trimText(message?.text, 4000)
    }))
    .filter((item) => item.text);
}

const TOOL_ACTIVITY_LABELS = {
  search_projects: 'Checking project records',
  search_protocols: 'Checking stored protocols',
  search_notebook_entries: 'Checking lab notebook pages',
  search_workflows: 'Checking workflow records',
  search_assays: 'Checking assay records',
  search_gel_analyses: 'Checking gel analysis records',
  search_inventory: 'Checking inventory records',
  search_papers: 'Checking stored PDF papers',
  search_web: 'Searching web sources',
  toolbox_molarity_calculator: 'Running molarity calculator',
  toolbox_peptide_properties: 'Computing peptide properties',
  toolbox_buffer_preparer: 'Computing buffer preparation',
  toolbox_dna_to_protein: 'Translating DNA/RNA to protein',
  toolbox_protein_to_dna: 'Reverse-translating protein to DNA',
  toolbox_oligo_properties: 'Computing oligo properties',
  toolbox_extinction_coefficient: 'Computing extinction coefficient',
  toolbox_qpcr_efficiency: 'Computing qPCR efficiency',
  toolbox_plannotate: 'Running pLannotate annotation',
  toolbox_crispr_sgrna_designer: 'Designing CRISPR sgRNAs',
  run_python_sandbox: 'Running Python sandbox',
  hybrid_web_fallback: 'Merging web and literature evidence',
  download_paper_pdf: 'Downloading papers'
};

const DEVELOPER_TOOL_TEST_OPTIONS = [
  {
    name: 'inventory-lookup',
    label: 'Inventory Lookup',
    description: 'Pass a sample or reagent name to inspect inventory lookup output.',
    example: 'Atlas construct sample'
  },
  {
    name: 'record-lookup',
    label: 'Record Lookup',
    description: 'Pass a protocol, workflow, or record title to inspect record retrieval output.',
    example: 'Cell Prep'
  },
  {
    name: 'protocol-matching',
    label: 'Protocol Matching',
    description: 'Pass a protocol-like name or activity so you can inspect the selected protocol payload.',
    example: 'Cell Prep'
  },
  {
    name: 'notebook-generation',
    label: 'Notebook Generation',
    description: 'Pass a notebook-style completion message to inspect the drafted notebook payload.',
    example: 'I completed Cell Prep on HEK293 sample TUBE42.'
  },
  {
    name: 'python-sandbox',
    label: 'Python Sandbox',
    description: 'Pass a short instruction and inspect the sandbox readback payload.',
    example: 'Write a JSON file with an ok flag and a test value.'
  },
  {
    name: 'sub-agent',
    label: 'Sub-Agent',
    description: 'Pass the seed message used to create and message the helper sub-agent.',
    example: 'Ping'
  },
  {
    name: 'memory',
    label: 'Memory',
    description: 'Pass the memory text to remember and recall during the manual test.',
    example: 'User prefers concise summaries.'
  },
  {
    name: 'literature-search',
    label: 'Literature Search',
    description: 'Pass a literature query and inspect the ranked stubbed source results.',
    example: 'PD-1 binder methods'
  },
  {
    name: 'paper-download',
    label: 'Paper Download',
    description: 'Pass the paper title used during the download smoke test.',
    example: 'Smoke Test Paper'
  },
  {
    name: 'paper-analysis',
    label: 'Paper Analysis',
    description: 'Pass the extraction request used during paper analysis.',
    example: 'Extract a protocol from this paper.'
  },
  {
    name: 'protocol-generation',
    label: 'Protocol Generation',
    description: 'Pass a concise free-text method summary and inspect the generated protocol payload.',
    example: 'Generate a concise purification protocol from this summary.'
  }
];

const DEVELOPER_TOOL_TEST_OPTION_BY_NAME = new Map(
  DEVELOPER_TOOL_TEST_OPTIONS.map((item) => [item.name, item])
);

function inferRequestedActivities(requestText) {
  const text = String(requestText || '').toLowerCase();
  if (!text) {
    return [];
  }

  const rows = [];
  if (/\b(inventory|stock|reagent|chemical)\b/.test(text)) {
    rows.push('Checking inventory records');
  }
  if (/\b(workflow|pipeline|next step|previous step)\b/.test(text)) {
    rows.push('Checking workflow records');
  }
  if (/\b(paper|papers|pdf|literature|journal)\b/.test(text)) {
    rows.push('Checking stored PDF papers');
  }
  if (/\b(web|internet|latest|recent|citation|reference)\b/.test(text)) {
    rows.push('Searching web sources');
  }
  if (/\b(download|fetch|get)\b/.test(text) && /\b(paper|papers|pdf)\b/.test(text)) {
    rows.push('Downloading papers (pending approval)');
  }
  if (/\b(protocol|sop|method)\b/.test(text) && /\b(generate|draft|create|write|build)\b/.test(text)) {
    rows.push('Generating protocol draft (pending approval)');
  }
  if (/\b(lab notebook|notebook page|notebook)\b/.test(text) && /\b(generate|draft|create|write|build)\b/.test(text)) {
    rows.push('Generating lab notebook page (pending approval)');
  }
  if (/\b(python|script|compute|calculate|transform)\b/.test(text)) {
    rows.push('Running Python sandbox');
  }
  return rows;
}

function formatStageActivity(stage, goal) {
  const normalizedStage = trimText(stage, 60).toLowerCase();
  if (normalizedStage === 'intake') {
    return 'Reading user request';
  }
  if (normalizedStage === 'context') {
    return 'Loading local project, protocol, notebook, inventory, and paper context';
  }
  if (normalizedStage === 'execute') {
    return trimText(goal, 240) || 'Executing read tools';
  }
  if (normalizedStage === 'python_execute') {
    return trimText(goal, 240) || 'Running deterministic Python orchestration';
  }
  if (normalizedStage === 'web_fallback') {
    return trimText(goal, 240) || 'Running hybrid web fallback retrieval';
  }
  if (normalizedStage === 'verify') {
    return 'Verifying evidence before final answer';
  }
  if (normalizedStage === 'synthesize') {
    return 'Generating final response and decision record';
  }
  if (normalizedStage === 'handoff') {
    return 'Preparing response for chat display';
  }
  return trimText(goal, 240) || `Running ${normalizedStage || 'agent'} stage`;
}

function formatWriteActivity(action) {
  const toolName = trimText(action?.tool_name, 120);
  const reason = trimText(action?.reason, 240);
  const combined = `${toolName} ${reason}`.toLowerCase();
  if (combined.includes('protocol')) {
    return 'Generating protocol draft (pending approval)';
  }
  if (combined.includes('notebook')) {
    return 'Generating lab notebook page (pending approval)';
  }
  if (combined.includes('paper') || combined.includes('pdf') || combined.includes('download')) {
    return 'Downloading papers (pending approval)';
  }
  if (reason) {
    return `Write action pending approval: ${reason}`;
  }
  return `Write action pending approval: ${toolName || 'unspecified action'}`;
}

export function initAgentChat({ state, persist, createId, safeText, onNotebookEntriesChanged }) {
  const projectSelect = document.getElementById('agent-project-select');
  const contextSummary = document.getElementById('agent-context-summary');
  const sessionStatus = document.getElementById('agent-session-status');
  const sessionList = document.getElementById('agent-session-list');
  const newChatBtn = document.getElementById('agent-new-chat-btn');
  const developerTools = document.getElementById('agent-developer-tools');
  const developerTestToolsBtn = document.getElementById('agent-dev-test-tools-btn');
  const developerToolSelect = document.getElementById('agent-dev-tool-select');
  const developerToolMessageInput = document.getElementById('agent-dev-tool-message');
  const developerRunToolBtn = document.getElementById('agent-dev-run-tool-btn');
  const developerToolHint = document.getElementById('agent-dev-tool-hint');
  const historyNode = document.getElementById('agent-chat-history');
  const input = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');
  const clearBtn = document.getElementById('agent-clear-btn');
  const status = document.getElementById('agent-status');
  let inFlight = false;
  let sessionStoragePath = '';
  let sessionsLoaded = false;
  let sessionListPromise = null;
  let sessionLoadPromise = null;

  if (!projectSelect || !historyNode || !input || !sendBtn || !clearBtn || !status) {
    return { render: () => {} };
  }

  projectSelect.addEventListener('change', () => {
    ensureAgentState();
    state.agentChat.projectId = projectSelect.value || '';
    persist();
    render();
  });

  sendBtn.addEventListener('click', () => {
    void sendMessage();
  });

  developerTestToolsBtn?.addEventListener('click', () => {
    void runDeveloperToolSmokeTest();
  });

  developerRunToolBtn?.addEventListener('click', () => {
    void runDeveloperSingleToolTest();
  });

  developerToolSelect?.addEventListener('change', () => {
    renderDeveloperToolHint();
  });

  newChatBtn?.addEventListener('click', () => {
    void startNewChatSession();
  });

  clearBtn.addEventListener('click', () => {
    void startNewChatSession();
  });

  sessionList?.addEventListener('click', (event) => {
    const sessionId = trimText(event?.target?.dataset?.sessionId, 120);
    if (!sessionId || inFlight) {
      return;
    }
    void loadChatSession(sessionId);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void sendMessage();
  });

  function ensureAgentState() {
    if (!state.agentChat || typeof state.agentChat !== 'object') {
      state.agentChat = { projectId: '', currentSessionId: '', sessions: [], messages: [] };
      return;
    }
    state.agentChat.projectId = String(state.agentChat.projectId || '');
    state.agentChat.currentSessionId = String(state.agentChat.currentSessionId || '');
    state.agentChat.sessions = asArray(state.agentChat.sessions);
    state.agentChat.messages = asArray(state.agentChat.messages);
  }

  function setStatus(text) {
    status.textContent = text;
  }

  function setSessionStatus(text) {
    if (!sessionStatus) {
      return;
    }
    sessionStatus.textContent = text;
  }

  function getStoragePath() {
    return trimText(state.settings?.storagePath, 1200);
  }

  function renderProjectOptions() {
    ensureAgentState();
    const selected = state.agentChat.projectId;
    const options = ['<option value="">All projects</option>'];
    asArray(state.projects).forEach((project) => {
      const isSelected = selected === project.id ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name || 'Untitled')}</option>`);
    });
    projectSelect.innerHTML = options.join('');
    if (selected && asArray(state.projects).some((project) => project.id === selected)) {
      projectSelect.value = selected;
    } else if (selected) {
      state.agentChat.projectId = '';
      persist();
    }
  }

  function renderDeveloperToolOptions() {
    if (!developerToolSelect) {
      return;
    }
    const selected = trimText(developerToolSelect.value, 120);
    developerToolSelect.innerHTML = DEVELOPER_TOOL_TEST_OPTIONS.map((item) => (
      `<option value="${safeText(item.name)}">${safeText(item.label)}</option>`
    )).join('');
    const fallbackName = DEVELOPER_TOOL_TEST_OPTIONS[0]?.name || '';
    developerToolSelect.value = DEVELOPER_TOOL_TEST_OPTION_BY_NAME.has(selected) ? selected : fallbackName;
    renderDeveloperToolHint();
  }

  function renderDeveloperToolHint() {
    const toolName = trimText(developerToolSelect?.value, 120);
    const option = DEVELOPER_TOOL_TEST_OPTION_BY_NAME.get(toolName) || null;
    if (developerToolHint) {
      developerToolHint.textContent = option
        ? `${option.description} Example: ${option.example}`
        : 'Select a tool and provide a manual test message.';
    }
    if (developerToolMessageInput && !trimText(developerToolMessageInput.value, 3000)) {
      developerToolMessageInput.placeholder = option
        ? `Example: ${option.example}`
        : 'Enter a tool-directed test message.';
    }
  }

  function upsertSessionSummary(summary) {
    const source = summary && typeof summary === 'object' ? summary : null;
    const sessionId = trimText(source?.id || source?.session_id, 120);
    if (!sessionId) {
      return;
    }
    const normalized = {
      id: sessionId,
      title: trimText(source?.title, 220) || 'New Chat',
      project_id: trimText(source?.project_id || source?.projectId, 120),
      project_name: trimText(source?.project_name || source?.projectName, 220),
      updated_at: trimText(source?.updated_at || source?.updatedAt, 80),
      created_at: trimText(source?.created_at || source?.createdAt, 80),
      message_count: Number(source?.message_count) || 0,
      last_message_preview: trimText(source?.last_message_preview, 320),
      response_type: trimText(source?.response_type, 80),
      last_error: trimText(source?.last_error, 320)
    };
    const nextSessions = asArray(state.agentChat.sessions)
      .filter((item) => trimText(item?.id, 120) !== sessionId);
    nextSessions.unshift(normalized);
    state.agentChat.sessions = nextSessions.sort((left, right) => {
      const leftTime = Date.parse(left?.updated_at || left?.created_at || '') || 0;
      const rightTime = Date.parse(right?.updated_at || right?.created_at || '') || 0;
      return rightTime - leftTime;
    });
  }

  function renderSessionList() {
    if (!sessionList) {
      return;
    }
    const storagePath = getStoragePath();
    const sessions = asArray(state.agentChat.sessions);
    if (!storagePath) {
      sessionList.innerHTML = '<p class="small-note">Set Storage Folder Path in Settings to save and reload chat sessions.</p>';
      return;
    }
    if (!window.enanaApi?.agentChatLogListSessions || !window.enanaApi?.agentChatLogGetSession) {
      sessionList.innerHTML = '<p class="small-note">Persistent chat sessions are unavailable in this build.</p>';
      return;
    }
    if (!sessions.length) {
      sessionList.innerHTML = '<p class="small-note">No saved chats yet. Start a new chat to create the first session.</p>';
      return;
    }

    const activeSessionId = trimText(state.agentChat.currentSessionId, 120);
    sessionList.innerHTML = sessions.map((session) => {
      const sessionId = trimText(session?.id, 120);
      const isActive = activeSessionId && sessionId === activeSessionId;
      const preview = trimText(session?.last_message_preview, 180) || 'No messages yet.';
      const meta = [
        trimText(session?.project_name, 120),
        Number.isFinite(Number(session?.message_count)) ? `${Number(session.message_count)} msgs` : '',
        trimText(session?.updated_at, 80)
      ].filter(Boolean).join(' | ');
      return `
        <button
          type="button"
          class="agent-session-card${isActive ? ' is-active' : ''}"
          data-session-id="${safeText(sessionId)}"
        >
          <strong>${safeText(trimText(session?.title, 160) || 'New Chat')}</strong>
          <span>${safeText(preview)}</span>
          <span class="agent-session-meta">${safeText(meta || 'Saved chat')}</span>
        </button>
      `;
    }).join('');
  }

  async function loadChatSession(sessionId, options = {}) {
    ensureAgentState();
    const targetSessionId = trimText(sessionId, 120);
    const storagePath = getStoragePath();
    if (!targetSessionId || !storagePath || !window.enanaApi?.agentChatLogGetSession) {
      return;
    }
    if (sessionLoadPromise) {
      return sessionLoadPromise;
    }
    if (options.silent !== true) {
      setStatus('Loading chat history...');
    }
    sessionLoadPromise = window.enanaApi.agentChatLogGetSession({
      storagePath,
      sessionId: targetSessionId
    }).then((result) => {
      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to load chat session.');
      }
      state.agentChat.currentSessionId = targetSessionId;
      state.agentChat.messages = asArray(result.messages);
      state.agentChat.projectId = trimText(result?.session?.project_id, 120);
      upsertSessionSummary(result.session);
      persist();
      renderProjectOptions();
      renderContextSummary();
      renderSessionList();
      renderHistory();
      setSessionStatus('Loaded chats from disk.');
      if (options.silent !== true) {
        setStatus('Ready.');
      }
    }).catch((error) => {
      setSessionStatus(`Chat load failed: ${String(error?.message || error)}`);
      if (options.silent !== true) {
        setStatus('Error.');
      }
    }).finally(() => {
      sessionLoadPromise = null;
    });
    return sessionLoadPromise;
  }

  async function refreshPersistentSessions(options = {}) {
    ensureAgentState();
    const force = options.force === true;
    const storagePath = getStoragePath();
    if (storagePath !== sessionStoragePath) {
      sessionStoragePath = storagePath;
      sessionsLoaded = false;
      state.agentChat.sessions = [];
      if (!storagePath) {
        state.agentChat.currentSessionId = '';
      }
    }
    if (!storagePath) {
      renderSessionList();
      setSessionStatus('Set Storage Folder Path in Settings to save and browse agent chats.');
      return [];
    }
    if (!window.enanaApi?.agentChatLogListSessions || !window.enanaApi?.agentChatLogGetSession) {
      renderSessionList();
      setSessionStatus('Persistent chat sessions are unavailable in this build.');
      return [];
    }
    if (!force && sessionsLoaded) {
      renderSessionList();
      return asArray(state.agentChat.sessions);
    }
    if (sessionListPromise) {
      return sessionListPromise;
    }
    setSessionStatus('Loading saved chats...');
    sessionListPromise = window.enanaApi.agentChatLogListSessions({
      storagePath,
      limit: 200
    }).then(async (result) => {
      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to load saved chats.');
      }
      state.agentChat.sessions = asArray(result.items);
      sessionsLoaded = true;
      renderSessionList();
      if (!state.agentChat.currentSessionId && state.agentChat.sessions.length) {
        await loadChatSession(state.agentChat.sessions[0].id, { silent: true });
      } else if (
        state.agentChat.currentSessionId
        && !state.agentChat.sessions.some((item) => trimText(item?.id, 120) === state.agentChat.currentSessionId)
      ) {
        state.agentChat.currentSessionId = '';
        state.agentChat.messages = [];
        persist();
        renderHistory();
      } else if (state.agentChat.currentSessionId && options.loadCurrent !== false) {
        await loadChatSession(state.agentChat.currentSessionId, { silent: true });
      } else {
        setSessionStatus(state.agentChat.sessions.length ? 'Saved chats ready.' : 'No saved chats yet.');
      }
      return state.agentChat.sessions;
    }).catch((error) => {
      state.agentChat.sessions = [];
      renderSessionList();
      setSessionStatus(`Chat list failed: ${String(error?.message || error)}`);
      return [];
    }).finally(() => {
      sessionListPromise = null;
    });
    return sessionListPromise;
  }

  async function ensureCurrentChatSession(messageText = '') {
    ensureAgentState();
    if (trimText(state.agentChat.currentSessionId, 120)) {
      return state.agentChat.currentSessionId;
    }
    const storagePath = getStoragePath();
    if (!storagePath || !window.enanaApi?.agentChatLogCreateSession) {
      return '';
    }
    const projectId = state.agentChat.projectId || '';
    const projectName = asArray(state.projects).find((item) => item.id === projectId)?.name || '';
    const result = await window.enanaApi.agentChatLogCreateSession({
      storagePath,
      projectId,
      projectName,
      title: messageText
    });
    if (!result?.ok || !result?.session?.id) {
      throw new Error(result?.error || 'Failed to create chat session.');
    }
    state.agentChat.currentSessionId = trimText(result.session.id, 120);
    upsertSessionSummary(result.session);
    persist();
    renderSessionList();
    setSessionStatus('New chat session created.');
    return state.agentChat.currentSessionId;
  }

  async function startNewChatSession() {
    ensureAgentState();
    state.agentChat.messages = [];
    const storagePath = getStoragePath();
    if (!storagePath || !window.enanaApi?.agentChatLogCreateSession) {
      state.agentChat.currentSessionId = '';
      persist();
      renderSessionList();
      renderHistory();
      setSessionStatus(storagePath
        ? 'Persistent chat sessions are unavailable in this build.'
        : 'Started a new local chat draft. Set Storage Folder Path to persist it.');
      setStatus('New chat ready.');
      return;
    }
    try {
      const projectId = state.agentChat.projectId || '';
      const projectName = asArray(state.projects).find((item) => item.id === projectId)?.name || '';
      const result = await window.enanaApi.agentChatLogCreateSession({
        storagePath,
        projectId,
        projectName,
        title: 'New Chat'
      });
      if (!result?.ok || !result?.session?.id) {
        throw new Error(result?.error || 'Failed to create chat session.');
      }
      state.agentChat.currentSessionId = trimText(result.session.id, 120);
      upsertSessionSummary(result.session);
      persist();
      renderSessionList();
      renderHistory();
      setSessionStatus('New chat session created.');
      setStatus('New chat ready.');
    } catch (error) {
      setSessionStatus(`New chat failed: ${String(error?.message || error)}`);
      setStatus('Error.');
    }
  }

  function buildStateSnapshot(projectId) {
    const filteredProjects = projectId
      ? asArray(state.projects).filter((project) => project.id === projectId)
      : asArray(state.projects);
    const projectIds = new Set(filteredProjects.map((project) => project.id));
    const projectNameById = new Map(asArray(state.projects).map((project) => [String(project.id || ''), trimText(project.name, 180)]));

    const filteredNotebookEntries = asArray(state.notebookEntries)
      .filter((entry) => !projectIds.size || projectIds.has(entry.projectId))
      .slice(-120);
    const protocolIds = new Set(filteredNotebookEntries.map((entry) => String(entry?.protocolId || '')).filter(Boolean));
    const protocolCount = projectIds.size
      ? asArray(state.protocols).filter((protocol) => protocolIds.has(String(protocol?.id || ''))).length
      : asArray(state.protocols).length;
    const protocolNameById = new Map(asArray(state.protocols).map((protocol) => [String(protocol.id || ''), trimText(protocol.name, 180)]));

    const workflows = asArray(state.workflows)
      .filter((workflow) => !projectIds.size || projectIds.has(String(workflow?.projectId || '')))
      .slice(0, 80)
      .map((workflow) => mapWorkflow(workflow, protocolNameById, projectNameById));

    const papers = asArray(state.papers)
      .filter((paper) => !projectIds.size || (paper.linkedType === 'project' && projectIds.has(paper.linkedId)))
      .slice(0, 60)
      .map(mapPaper);
    const protocols = asArray(state.protocols)
      .slice(0, 120)
      .map((protocol) => ({
        id: trimText(protocol?.id, 120),
        name: trimText(protocol?.name, 220),
        purpose: trimText(protocol?.purpose || protocol?.description, 700),
        projectId: trimText(protocol?.projectId, 120),
        projectName: trimText(protocol?.projectName, 220),
        aliases: asArray(protocol?.aliases).map((alias) => trimText(alias, 120)).filter(Boolean).slice(0, 8),
        steps: asArray(protocol?.steps).slice(0, 120).map((step, stepIndex) => ({
          id: trimText(step?.id, 120) || `step-${stepIndex + 1}`,
          text: trimText(step?.text || step?.instruction || step?.action, 1200),
          placeholders: asArray(step?.placeholders).slice(0, 40).map((placeholder, placeholderIndex) => ({
            id: trimText(placeholder?.id, 120) || `ph-${stepIndex + 1}-${placeholderIndex + 1}`,
            name: trimText(placeholder?.name, 120) || 'value'
          }))
        }))
      }))
      .filter((protocol) => protocol.id || protocol.name);

    const projects = filteredProjects.slice(0, 30).map(mapProject);
    const experimentData = mapExperimentDataToLlmJson(state, projectId);
    const assays = asArray(experimentData.assay_runs).slice(0, 80);
    const gelAnalyses = asArray(experimentData.gel_runs).slice(0, 80);
    const personalSections = Object.entries(state?.inventory || {});
    const personalItemCount = personalSections.reduce((count, [, items]) => count + asArray(items).length, 0);
    const chemicalCount = asArray(state?.labInventory?.chemicals).length;
    const dataFilePath = trimText(state?.settings?.enaFilePath, 1600);

    return {
      projects,
      workflows,
      protocols,
      notebookEntries: [],
      assays,
      gelAnalyses,
      experimentData,
      papers,
      inventory: {
        personal: [],
        chemicals: []
      },
      snapshot_mode: 'thin',
      context_counts: {
        projects: projects.length,
        protocols: protocolCount,
        workflows: workflows.length,
        notebookEntries: filteredNotebookEntries.length,
        assays: assays.length,
        gelAnalyses: gelAnalyses.length,
        papers: papers.length,
        inventory_chemicals: chemicalCount,
        inventory_personal_sections: personalSections.length,
        inventory_personal_items: personalItemCount
      },
      data_file_path: dataFilePath,
      settings: {
        storagePath: trimText(state.settings?.storagePath, 1200)
      },
      timestamp: new Date().toISOString()
    };
  }

  function normalizeNotebookDraft(rawDraft) {
    if (!rawDraft || typeof rawDraft !== 'object') {
      return null;
    }
    const placeholderValues = asArray(rawDraft.placeholder_values).map((item) => ({
      step_id: trimText(item?.step_id, 120),
      placeholder_id: trimText(item?.placeholder_id, 120),
      placeholder_key: trimText(item?.placeholder_key, 120),
      display: trimText(item?.display, 120),
      value: trimText(item?.value, 220),
      source: trimText(item?.source, 120),
      source_type: trimText(item?.source_type, 80)
    })).filter((item) => item.step_id && item.placeholder_id && item.value);

    const unresolvedPlaceholders = asArray(rawDraft.unresolved_placeholders).map((item) => ({
      step_id: trimText(item?.step_id, 120),
      placeholder_id: trimText(item?.placeholder_id, 120),
      placeholder_key: trimText(item?.placeholder_key, 120),
      display: trimText(item?.display, 120),
      reason: trimText(item?.reason, 120)
    })).filter((item) => item.step_id && item.placeholder_id);

    const entryTemplate = rawDraft.entry_template && typeof rawDraft.entry_template === 'object'
      ? rawDraft.entry_template
      : {};

    return {
      protocol: {
        id: trimText(rawDraft?.protocol?.id, 120),
        name: trimText(rawDraft?.protocol?.name, 220)
      },
      project: {
        id: trimText(rawDraft?.project?.id, 80),
        name: trimText(rawDraft?.project?.name, 180),
        resolution_source: trimText(rawDraft?.project?.resolution_source, 80)
      },
      notebook_type: trimText(rawDraft?.notebook_type, 40) || 'biology',
      rendered_steps: asArray(rawDraft.rendered_steps).map((step) => trimText(step, 300)).filter(Boolean),
      placeholder_values: placeholderValues,
      unresolved_placeholders: unresolvedPlaceholders,
      save: {
        mode: trimText(rawDraft?.save?.mode, 80) || 'auto_save_draft',
        applied: rawDraft?.save?.applied === true,
        status: trimText(rawDraft?.save?.status, 120),
        reason: trimText(rawDraft?.save?.reason, 220)
      },
      entry_template: {
        notebookType: trimText(entryTemplate.notebookType, 40) || 'biology',
        projectId: trimText(entryTemplate.projectId, 80),
        projectName: trimText(entryTemplate.projectName, 180),
        protocolId: trimText(entryTemplate.protocolId, 120),
        protocolName: trimText(entryTemplate.protocolName, 220),
        values: entryTemplate.values && typeof entryTemplate.values === 'object' ? entryTemplate.values : {},
        result: trimText(entryTemplate.result, 900),
        updatedAt: trimText(entryTemplate.updatedAt, 80),
        resultFiles: asArray(entryTemplate.resultFiles).map((value) => trimText(value, 220)).filter(Boolean),
        resultFileRecords: asArray(entryTemplate.resultFileRecords),
        agentDraftStatus: trimText(entryTemplate.agentDraftStatus, 80),
        agentDraftMeta: entryTemplate.agentDraftMeta && typeof entryTemplate.agentDraftMeta === 'object'
          ? entryTemplate.agentDraftMeta
          : {}
      }
    };
  }

  function applyNotebookDraftAutoSave(rawDraft, requestText) {
    const draft = normalizeNotebookDraft(rawDraft);
    if (!draft || draft.save.mode !== 'auto_save_draft') {
      return draft;
    }

    const template = draft.entry_template || {};
    const projectId = template.projectId || draft.project.id;
    const protocolId = template.protocolId || draft.protocol.id;
    if (!projectId || !protocolId) {
      return {
        ...draft,
        save: {
          ...draft.save,
          applied: false,
          status: 'autosave_skipped',
          reason: 'Missing project or protocol binding for draft auto-save.'
        }
      };
    }

    const unresolvedCount = asArray(draft.unresolved_placeholders).length;
    const nowIso = new Date().toISOString();
    const entry = {
      id: createId(),
      notebookType: 'biology',
      projectId,
      projectName: template.projectName || draft.project.name,
      protocolId,
      protocolName: template.protocolName || draft.protocol.name,
      values: template.values && typeof template.values === 'object' ? template.values : {},
      result: template.result || `Agent-generated notebook draft from request: ${trimText(requestText, 220)}`,
      resultFiles: asArray(template.resultFiles),
      resultFileRecords: asArray(template.resultFileRecords),
      updatedAt: template.updatedAt || nowIso,
      agentDraftStatus: unresolvedCount > 0 ? 'needs_review' : 'draft_ready',
      agentDraftMeta: {
        ...(template.agentDraftMeta && typeof template.agentDraftMeta === 'object' ? template.agentDraftMeta : {}),
        savedAt: nowIso,
        unresolvedCount,
        source: 'agent_phase5'
      }
    };

    state.notebookEntries = asArray(state.notebookEntries);
    state.notebookEntries.push(entry);

    try {
      onNotebookEntriesChanged?.();
    } catch {
      // Keep chat path resilient even if downstream render hooks fail.
    }

    return {
      ...draft,
      save: {
        ...draft.save,
        applied: true,
        status: 'saved_draft',
        reason: 'Draft auto-saved to notebook entries.'
      },
      entry_template: {
        ...draft.entry_template,
        ...entry
      }
    };
  }

  function renderContextSummary() {
    const projectId = state.agentChat?.projectId || '';
    const snapshot = buildStateSnapshot(projectId);
    const counts = snapshot.context_counts && typeof snapshot.context_counts === 'object'
      ? snapshot.context_counts
      : {};
    const summary = [
      `${Number(counts.projects) || snapshot.projects.length} projects`,
      `${Number(counts.protocols) || snapshot.protocols.length} protocols`,
      `${Number(counts.workflows) || snapshot.workflows.length} workflows`,
      `${Number(counts.notebookEntries) || snapshot.notebookEntries.length} notebook entries`,
      `${Number(counts.assays) || snapshot.assays.length} assays`,
      `${Number(counts.gelAnalyses) || snapshot.gelAnalyses.length} gel analyses`,
      `${Number(counts.papers) || snapshot.papers.length} papers`,
      `${Number(counts.inventory_chemicals) || snapshot.inventory.chemicals.length} chemicals`
    ].join(' | ');
    if (contextSummary) {
      contextSummary.value = summary;
    }
  }

  function formatTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleString();
  }

  function formatJsonForDisplay(value) {
    if (value === undefined) {
      return '';
    }
    try {
      return trimText(JSON.stringify(value, null, 2), 24000);
    } catch {
      return trimText(String(value || ''), 24000);
    }
  }

  function renderMetaList(title, rows) {
    if (!rows.length) {
      return '';
    }
    return `
      <details>
        <summary>${safeText(title)}</summary>
        <ul>
          ${rows.map((row) => `<li>${safeText(row)}</li>`).join('')}
        </ul>
      </details>
    `;
  }

  function renderMetaJson(title, value) {
    const formatted = formatJsonForDisplay(value);
    if (!formatted) {
      return '';
    }
    return `
      <details>
        <summary>${safeText(title)}</summary>
        <pre class="agent-meta-json">${safeText(formatted)}</pre>
      </details>
    `;
  }

  function renderAssistantMeta(meta) {
    if (!meta || typeof meta !== 'object') {
      return '';
    }
    const toolTest = meta.tool_test && typeof meta.tool_test === 'object'
      ? meta.tool_test
      : null;
    if (toolTest) {
      const toolItems = asArray(toolTest.items);
      const runMode = trimText(toolTest.run_mode, 40) || (toolItems.length === 1 ? 'single' : 'all');
      const primaryItem = runMode === 'single' ? (toolItems[0] && typeof toolItems[0] === 'object' ? toolItems[0] : null) : null;
      const toolRows = asArray(toolTest.items).map((item) => ({
        status: item?.ok === true ? 'done' : 'error',
        text: `${trimText(item?.tool_name, 120) || 'tool'}: ${trimText(item?.summary || item?.error, 220) || 'No summary returned.'}`
      }));
      const failureRows = asArray(toolTest.items)
        .filter((item) => item?.ok !== true)
        .map((item) => {
          const toolName = trimText(item?.tool_name, 120) || 'tool';
          const error = trimText(item?.error || item?.summary, 260);
          return error ? `${toolName}: ${error}` : toolName;
        })
        .filter(Boolean);
      const detailRows = asArray(toolTest.items).map((item) => {
        const toolName = trimText(item?.tool_name, 120) || 'tool';
        const parts = [
          trimText(item?.status, 80),
          trimText(item?.preview, 180),
          Number.isFinite(Number(item?.duration_ms)) ? `${Number(item.duration_ms)}ms` : ''
        ].filter(Boolean);
        return `${toolName}: ${parts.join(' | ') || 'completed'}`;
      });
      const summaryLine = primaryItem
        ? `Tool=${trimText(primaryItem.tool_name, 120) || 'tool'} | Status=${trimText(primaryItem.status, 80) || (primaryItem.ok === true ? 'ok' : 'error')} | OK=${primaryItem.ok === true}`
        : `Passed=${Number(toolTest.passed_count) || 0} | Failed=${Number(toolTest.failed_count) || 0} | Tools=${Number(toolTest.tool_count) || toolItems.length}`;
      return `
        <div class="agent-meta-grid">
          ${toolRows.length ? `
            <section class="agent-activity" aria-label="Tool smoke test activity">
              <h4>${primaryItem ? 'Manual Tool Test' : 'Tool Smoke Test'}</h4>
              <ul class="agent-activity-list">
                ${toolRows.map((row) => `
                  <li class="agent-activity-item">
                    <span class="agent-activity-badge agent-activity-badge-${safeText(row.status)}">${safeText(row.status)}</span>
                    <span>${safeText(row.text)}</span>
                  </li>
                `).join('')}
              </ul>
            </section>
          ` : ''}
          <p class="small-note">${safeText(summaryLine)}</p>
          ${primaryItem && trimText(toolTest.request_message || primaryItem.request_message, 6000)
            ? renderMetaList('Input Message', [trimText(toolTest.request_message || primaryItem.request_message, 6000)])
            : ''}
          ${primaryItem && trimText(primaryItem.result_message, 6000)
            ? renderMetaList('Result Message', [trimText(primaryItem.result_message, 6000)])
            : ''}
          ${renderMetaList('Tool Details', detailRows)}
          ${primaryItem ? renderMetaJson('Raw Result', primaryItem.raw_result) : ''}
          ${failureRows.length ? renderMetaList('Failures', failureRows) : ''}
        </div>
      `;
    }
    const parser = meta.parser && typeof meta.parser === 'object' ? meta.parser : {};
    const primaryIntent = trimText(parser.primary_intent, 80) || 'unclear';
    const parserRows = [
      `primary_intent: ${primaryIntent}`,
      `needs_clarification: ${parser.needs_clarification === true}`,
      trimText(parser.clarification_reason, 260)
        ? `clarification_reason: ${trimText(parser.clarification_reason, 260)}`
        : ''
    ].filter(Boolean);
    const protocolCandidateRows = asArray(parser.protocol_candidates).map((candidate, index) => {
      const clean = trimText(candidate, 220);
      return clean ? `candidate_${index + 1}: ${clean}` : '';
    }).filter(Boolean);
    const parserEntityRows = Object.entries(
      parser.entities && typeof parser.entities === 'object' ? parser.entities : {}
    ).map(([key, value]) => {
      const cleanValue = trimText(value, 220);
      return cleanValue ? `${key}: ${cleanValue}` : '';
    }).filter(Boolean);
    const inventorySearch = parser.inventory_search && typeof parser.inventory_search === 'object'
      ? parser.inventory_search
      : {};
    const inventorySearchRows = [
      trimText(inventorySearch.normalized_query, 220)
        ? `normalized_query: ${trimText(inventorySearch.normalized_query, 220)}`
        : '',
      trimText(inventorySearch.search_mode, 80)
        ? `search_mode: ${trimText(inventorySearch.search_mode, 80)}`
        : ''
    ].filter(Boolean);
    asArray(inventorySearch.candidate_terms).forEach((term, index) => {
      const clean = trimText(term, 180);
      if (clean) {
        inventorySearchRows.push(`candidate_${index + 1}: ${clean}`);
      }
    });
    asArray(inventorySearch.aliases).forEach((alias, index) => {
      const clean = trimText(alias, 180);
      if (clean) {
        inventorySearchRows.push(`alias_${index + 1}: ${clean}`);
      }
    });
    const protocolWorkflow = meta.protocol_to_notebook && typeof meta.protocol_to_notebook === 'object'
      ? meta.protocol_to_notebook
      : {};
    const protocolRows = [
      trimText(protocolWorkflow.status, 60)
        ? `status: ${trimText(protocolWorkflow.status, 60)}`
        : '',
      trimText(protocolWorkflow.project_name, 220)
        ? `project_name: ${trimText(protocolWorkflow.project_name, 220)}`
        : '',
      trimText(protocolWorkflow?.selected_protocol?.name, 220)
        ? `selected_protocol: ${trimText(protocolWorkflow.selected_protocol.name, 220)}`
        : '',
      trimText(protocolWorkflow?.selected_protocol?.selection_method, 80)
        ? `selection_method: ${trimText(protocolWorkflow.selected_protocol.selection_method, 80)}`
        : ''
    ].filter(Boolean);
    const protocolCandidateMatchRows = asArray(protocolWorkflow.candidate_matches).map((item, index) => {
      const name = trimText(item?.name, 220);
      if (!name) {
        return '';
      }
      const score = Number.isFinite(Number(item?.score)) ? Number(item.score).toFixed(1) : '-';
      return `match_${index + 1}: ${name} (score=${score})`;
    }).filter(Boolean);
    const protocolMissingRows = asArray(protocolWorkflow.missing_placeholders).map((item, index) => {
      const display = trimText(item?.display, 120) || trimText(item?.placeholder_key, 160);
      const reason = trimText(item?.reason, 220);
      if (!display) {
        return '';
      }
      return `missing_${index + 1}: ${display}${reason ? ` (${reason})` : ''}`;
    }).filter(Boolean);
    const protocolFollowUpRows = asArray(protocolWorkflow.follow_up_questions).map((question) => trimText(question, 260)).filter(Boolean);
    const hasInventoryLookup = meta.inventory_lookup && typeof meta.inventory_lookup === 'object';
    const inventoryLookup = hasInventoryLookup
      ? meta.inventory_lookup
      : {};
    const inventoryRows = [
      trimText(inventoryLookup.status, 40)
        ? `status: ${trimText(inventoryLookup.status, 40)}`
        : '',
      trimText(inventoryLookup.query, 240)
        ? `query: ${trimText(inventoryLookup.query, 240)}`
        : '',
      trimText(inventoryLookup.source, 80)
        ? `source: ${trimText(inventoryLookup.source, 80)}`
        : '',
      `backfilled_sql: ${inventoryLookup.backfilled_sql === true}`,
      `item_count: ${asArray(inventoryLookup.items).length}`
    ].filter(Boolean);
    const inventoryItemRows = asArray(inventoryLookup.items).slice(0, 10).map((item, index) => {
      const name = trimText(item?.name || item?.id, 220);
      const kind = trimText(item?.kind, 80);
      const zone = trimText(item?.zone, 120);
      const location = trimText(item?.location, 160);
      if (!name) {
        return '';
      }
      const parts = [kind, zone, location].filter(Boolean).join(' | ');
      return `item_${index + 1}: ${name}${parts ? ` (${parts})` : ''}`;
    }).filter(Boolean);
    const inventoryFollowUpRows = asArray(inventoryLookup.follow_up_questions).map((question) => trimText(question, 260)).filter(Boolean);
    const hasRecordLookup = meta.record_lookup && typeof meta.record_lookup === 'object';
    const recordLookup = hasRecordLookup
      ? meta.record_lookup
      : {};
    const recordRows = [
      trimText(recordLookup.status, 40)
        ? `status: ${trimText(recordLookup.status, 40)}`
        : '',
      trimText(recordLookup.query, 240)
        ? `query: ${trimText(recordLookup.query, 240)}`
        : '',
      trimText(recordLookup.source, 80)
        ? `source: ${trimText(recordLookup.source, 80)}`
        : '',
      `backfilled_sql: ${recordLookup.backfilled_sql === true}`,
      `item_count: ${asArray(recordLookup.items).length}`
    ].filter(Boolean);
    const recordItemRows = asArray(recordLookup.items).slice(0, 10).map((item, index) => {
      const title = trimText(item?.title || item?.id, 220);
      const type = trimText(item?.record_type, 80);
      const project = trimText(item?.project_name, 180);
      if (!title) {
        return '';
      }
      const parts = [type, project].filter(Boolean).join(' | ');
      return `item_${index + 1}: ${title}${parts ? ` (${parts})` : ''}`;
    }).filter(Boolean);
    const recordFollowUpRows = asArray(recordLookup.follow_up_questions).map((question) => trimText(question, 260)).filter(Boolean);
    const generalScience = meta.general_science_question && typeof meta.general_science_question === 'object'
      ? meta.general_science_question
      : {};
    const projectScience = meta.project_science_question && typeof meta.project_science_question === 'object'
      ? meta.project_science_question
      : {};
    const resultAnalysis = meta.result_analysis && typeof meta.result_analysis === 'object'
      ? meta.result_analysis
      : {};
    const buildScienceRows = (payload) => [
      trimText(payload.status, 40) ? `status: ${trimText(payload.status, 40)}` : '',
      trimText(payload.confidence_label, 40) ? `confidence_label: ${trimText(payload.confidence_label, 40)}` : '',
      Number.isFinite(Number(payload.confidence)) ? `confidence: ${Number(payload.confidence).toFixed(2)}` : '',
      `rounds_executed: ${Number(payload.rounds_executed) || 0}`,
      `citation_count: ${asArray(payload.citations).length}`
    ].filter(Boolean);
    const buildCitationRows = (payload) => asArray(payload.citations).slice(0, 10).map((item, index) => {
      const source = trimText(item?.source, 120);
      const pointer = trimText(item?.pointer, 220);
      const reason = trimText(item?.reason, 220);
      if (!source && !pointer) {
        return '';
      }
      return `citation_${index + 1}: ${[source, pointer, reason].filter(Boolean).join(' | ')}`;
    }).filter(Boolean);
    const generalScienceRows = buildScienceRows(generalScience);
    const projectScienceRows = buildScienceRows(projectScience);
    const resultAnalysisRows = buildScienceRows(resultAnalysis);
    const generalScienceCitationRows = buildCitationRows(generalScience);
    const projectScienceCitationRows = buildCitationRows(projectScience);
    const resultAnalysisCitationRows = buildCitationRows(resultAnalysis);
    const generalScienceFollowUps = asArray(generalScience.follow_up_questions).map((question) => trimText(question, 260)).filter(Boolean);
    const projectScienceFollowUps = asArray(projectScience.follow_up_questions).map((question) => trimText(question, 260)).filter(Boolean);
    const resultAnalysisFollowUps = asArray(resultAnalysis.follow_up_questions).map((question) => trimText(question, 260)).filter(Boolean);
    const reasoningSummaryRows = [trimText(parser.reasoning_summary, 600) || 'No parser reasoning summary returned.'];
    const activityRows = collectAgentActivityRows(meta);
    const developerTraceRows = asArray(meta.developer_trace).map((trace, index) => {
      const stage = trimText(trace?.stage, 120) || `trace_${index + 1}`;
      const provider = trimText(trace?.provider, 80);
      const summary = trimText(trace?.summary, 220);
      const timestamp = trimText(trace?.timestamp, 80);
      const details = [provider ? `provider=${provider}` : '', summary, timestamp].filter(Boolean).join(' | ');
      return details ? `${stage}: ${details}` : stage;
    }).filter(Boolean);
    const showDeveloperTrace = state.settings?.agent?.developerMode === true;
    const parserSummaryLine = `Intent=${primaryIntent} | needs_clarification=${parser.needs_clarification === true}`;

    return `
      <div class="agent-meta-grid">
        ${activityRows.length ? `
          <section class="agent-activity" aria-label="LLM activity">
            <h4>LLM Activity</h4>
            <ul class="agent-activity-list">
              ${activityRows.map((row) => `
                <li class="agent-activity-item">
                  <span class="agent-activity-badge agent-activity-badge-${safeText(row.status)}">${safeText(row.status)}</span>
                  <span>${safeText(row.text)}</span>
                </li>
              `).join('')}
            </ul>
          </section>
        ` : ''}
        <p class="small-note">${safeText(parserSummaryLine)}</p>
        ${renderMetaList('Intent Parser', parserRows)}
        ${renderMetaList('Protocol Candidates', protocolCandidateRows)}
        ${renderMetaList('Entities', parserEntityRows)}
        ${renderMetaList('Inventory Search', inventorySearchRows)}
        ${renderMetaList('Protocol Workflow', protocolRows)}
        ${renderMetaList('Protocol Matches', protocolCandidateMatchRows)}
        ${renderMetaList('Missing Placeholders', protocolMissingRows)}
        ${renderMetaList('Follow-up Questions', protocolFollowUpRows)}
        ${hasInventoryLookup ? renderMetaList('Inventory Lookup', inventoryRows) : ''}
        ${hasInventoryLookup ? renderMetaList('Inventory Items', inventoryItemRows) : ''}
        ${hasInventoryLookup ? renderMetaList('Inventory Follow-up', inventoryFollowUpRows) : ''}
        ${hasRecordLookup ? renderMetaList('Record Lookup', recordRows) : ''}
        ${hasRecordLookup ? renderMetaList('Record Items', recordItemRows) : ''}
        ${hasRecordLookup ? renderMetaList('Record Follow-up', recordFollowUpRows) : ''}
        ${generalScienceRows.length ? renderMetaList('General Science', generalScienceRows) : ''}
        ${generalScienceCitationRows.length ? renderMetaList('General Science Citations', generalScienceCitationRows) : ''}
        ${generalScienceFollowUps.length ? renderMetaList('General Science Follow-up', generalScienceFollowUps) : ''}
        ${projectScienceRows.length ? renderMetaList('Project Science', projectScienceRows) : ''}
        ${projectScienceCitationRows.length ? renderMetaList('Project Science Citations', projectScienceCitationRows) : ''}
        ${projectScienceFollowUps.length ? renderMetaList('Project Science Follow-up', projectScienceFollowUps) : ''}
        ${resultAnalysisRows.length ? renderMetaList('Result Analysis', resultAnalysisRows) : ''}
        ${resultAnalysisCitationRows.length ? renderMetaList('Result Analysis Citations', resultAnalysisCitationRows) : ''}
        ${resultAnalysisFollowUps.length ? renderMetaList('Result Analysis Follow-up', resultAnalysisFollowUps) : ''}
        ${renderMetaList('Reasoning Summary', reasoningSummaryRows)}
        ${showDeveloperTrace ? renderMetaList('Developer Trace', developerTraceRows) : ''}
      </div>
    `;
  }

  function renderHistory() {
    ensureAgentState();
    const messages = asArray(state.agentChat.messages);
    if (!messages.length) {
      historyNode.innerHTML = '<p class="small-note">Start by asking the agent a lab question.</p>';
      return;
    }

    historyNode.innerHTML = messages.map((message) => {
      const role = message.role === 'assistant' ? 'assistant' : 'user';
      const headerLabel = role === 'assistant' ? 'Assistant' : 'User';
      const cardClass = role === 'assistant' ? 'agent-chat-item-assistant' : 'agent-chat-item-user';
      const rowClass = role === 'assistant' ? 'agent-chat-row-assistant' : 'agent-chat-row-user';
      return `
        <div class="agent-chat-row ${rowClass}">
          <article class="agent-chat-item ${cardClass}">
            <header class="agent-chat-header">
              <strong>${headerLabel}</strong>
              <span>${safeText(formatTime(message.createdAt))}</span>
            </header>
            <p class="agent-chat-body">${safeText(message.text || '')}</p>
            ${role === 'assistant' ? renderAssistantMeta(message.meta) : ''}
          </article>
        </div>
      `;
    }).join('');

    historyNode.scrollTop = historyNode.scrollHeight;
  }

  function updateInFlightState(nextInFlight) {
    inFlight = nextInFlight;
    sendBtn.disabled = inFlight;
    if (developerTestToolsBtn) {
      developerTestToolsBtn.disabled = inFlight;
    }
    if (developerRunToolBtn) {
      developerRunToolBtn.disabled = inFlight;
    }
    if (developerToolSelect) {
      developerToolSelect.disabled = inFlight;
    }
    if (developerToolMessageInput) {
      developerToolMessageInput.disabled = inFlight;
    }
    clearBtn.disabled = inFlight;
    projectSelect.disabled = inFlight;
    input.disabled = inFlight;
  }

  async function buildSyncedStateSnapshot(projectId) {
    let syncResult = null;
    if (window.enanaApi?.autoSaveDataFile) {
      syncResult = await window.enanaApi.autoSaveDataFile(state, state.settings?.enaFilePath || '');
      if (!syncResult?.ok) {
        throw new Error(syncResult?.error || 'Failed to sync data before agent request.');
      }
      if (syncResult?.filePath && state.settings?.enaFilePath !== syncResult.filePath) {
        state.settings.enaFilePath = syncResult.filePath;
      }
    }
    const stateSnapshot = buildStateSnapshot(projectId);
    if (!stateSnapshot.data_file_path) {
      stateSnapshot.data_file_path = trimText(syncResult?.filePath || state.settings?.enaFilePath, 1600);
    }
    return stateSnapshot;
  }

  function appendToolTestAssistantMessage(result, fallbackText, requestMessage = '') {
    state.agentChat.messages.push({
      id: createId(),
      role: 'assistant',
      text: trimText(result?.summary, 12000) || fallbackText,
      createdAt: new Date().toISOString(),
      meta: {
        tool_test: {
          ok: result?.ok === true,
          run_mode: trimText(result?.run_mode, 40) || 'all',
          tool_name: trimText(result?.tool_name, 120),
          request_message: trimText(requestMessage || result?.request_message, 3000),
          status: trimText(result?.status, 80),
          tool_count: Number(result?.tool_count) || asArray(result?.items).length,
          passed_count: Number(result?.passed_count) || 0,
          failed_count: Number(result?.failed_count) || 0,
          summary: trimText(result?.summary, 320),
          items: asArray(result?.items)
        }
      }
    });
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    renderHistory();
  }

  async function sendMessage() {
    if (inFlight) {
      return;
    }

    const messageText = trimText(input.value, 3000);
    if (!messageText) {
      return;
    }

    if (!window.enanaApi?.agentChat) {
      setStatus('Agent IPC is unavailable.');
      return;
    }

    ensureAgentState();

    const projectId = state.agentChat.projectId || '';
    const projectName = asArray(state.projects).find((item) => item.id === projectId)?.name || '';
    const currentSessionId = await ensureCurrentChatSession(messageText);
    const userMessage = {
      id: createId(),
      role: 'user',
      text: messageText,
      createdAt: new Date().toISOString()
    };

    state.agentChat.messages.push(userMessage);
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    input.value = '';
    renderHistory();

    updateInFlightState(true);
    setStatus('Agent reasoning in progress...');

    try {
      const stateSnapshot = await buildSyncedStateSnapshot(projectId);

      const result = await window.enanaApi.agentChat({
        message: messageText,
        chatSessionId: currentSessionId,
        projectId,
        projectName,
        conversation: toConversation(state.agentChat.messages),
        stateSnapshot,
        llm: {
          provider: String(state.settings?.llm?.provider || '').trim(),
          model: String(state.settings?.llm?.model || '').trim(),
          apiEndpoint: String(state.settings?.llm?.apiEndpoint || '').trim(),
          apiKey: String(state.settings?.llm?.apiKey || '').trim()
        },
        agent: {
          developerMode: state.settings?.agent?.developerMode === true
        }
      });

      if (!result?.ok) {
        throw new Error(result?.error || 'Agent request failed.');
      }
      if (result.chat_session && typeof result.chat_session === 'object') {
        const sessionId = trimText(result.chat_session.id || result.chat_session.session_id, 120);
        if (sessionId) {
          state.agentChat.currentSessionId = sessionId;
          upsertSessionSummary(result.chat_session);
        }
      }
      const response = normalizeAgentResponse(result);
      const notebookDraft = applyNotebookDraftAutoSave(response.notebookPayload, messageText);

      state.agentChat.messages.push({
        id: createId(),
        role: 'assistant',
        text: response.assistantText,
        createdAt: new Date().toISOString(),
        meta: {
          parser: response.parser,
          protocol_to_notebook: response.protocolWorkflow,
          inventory_lookup: response.inventoryLookup,
          record_lookup: response.recordLookup,
          general_science_question: response.generalScienceQuestion,
          project_science_question: response.projectScienceQuestion,
          result_analysis: response.resultAnalysis,
          notebookDraft: notebookDraft || null,
          developer_trace: response.developerTrace,
          requestText: messageText
        }
      });

      state.agentChat.messages = state.agentChat.messages.slice(-40);
      persist();
      renderSessionList();
      renderHistory();
      if (state.agentChat.currentSessionId) {
        void refreshPersistentSessions({ force: true });
      }
      setStatus('Complete.');
    } catch (error) {
      state.agentChat.messages.push({
        id: createId(),
        role: 'assistant',
        text: `Agent failed: ${String(error?.message || error)}`,
        createdAt: new Date().toISOString(),
        meta: {
          parser: {
            primary_intent: 'unclear',
            needs_clarification: true,
            clarification_reason: 'agent_error',
            entities: {},
            inventory_search: {
              normalized_query: null,
              candidate_terms: [],
              aliases: [],
              search_mode: null
            },
            protocol_candidates: [],
            reasoning_summary: `Agent failed: ${String(error?.message || error)}`
          },
          protocol_to_notebook: null,
          inventory_lookup: null,
          record_lookup: null,
          general_science_question: null,
          project_science_question: null,
          result_analysis: null,
          notebookDraft: null,
          developer_trace: [],
          requestText: messageText
        }
      });
      state.agentChat.messages = state.agentChat.messages.slice(-40);
      persist();
      renderSessionList();
      renderHistory();
      setStatus('Error.');
    } finally {
      updateInFlightState(false);
    }
  }

  async function runDeveloperSingleToolTest() {
    if (inFlight) {
      return;
    }
    if (state.settings?.agent?.developerMode !== true) {
      setStatus('Enable Agent Developer Mode to run manual tool tests.');
      return;
    }
    if (!window.enanaApi?.agentDeveloperTestTools) {
      setStatus('Developer tool test IPC is unavailable.');
      return;
    }

    ensureAgentState();

    const toolName = trimText(developerToolSelect?.value, 120);
    const requestMessage = trimText(developerToolMessageInput?.value, 3000);
    if (!toolName) {
      setStatus('Select a tool to test.');
      return;
    }
    if (!requestMessage) {
      setStatus('Add a manual test message for the selected tool.');
      return;
    }

    const projectId = state.agentChat.projectId || '';
    const projectName = asArray(state.projects).find((item) => item.id === projectId)?.name || '';
    state.agentChat.messages.push({
      id: createId(),
      role: 'user',
      text: `Tool test (${toolName})\n${requestMessage}`,
      createdAt: new Date().toISOString()
    });
    state.agentChat.messages = state.agentChat.messages.slice(-40);
    persist();
    renderHistory();

    updateInFlightState(true);
    setStatus(`Running manual test for ${toolName}...`);

    try {
      const stateSnapshot = await buildSyncedStateSnapshot(projectId);
      const result = await window.enanaApi.agentDeveloperTestTools({
        toolName,
        message: requestMessage,
        projectId,
        projectName,
        stateSnapshot,
        agent: {
          developerMode: state.settings?.agent?.developerMode === true
        }
      });

      if (!result?.ok && !asArray(result?.items).length) {
        throw new Error(result?.error || `Manual tool test failed for ${toolName}.`);
      }

      appendToolTestAssistantMessage(result, `Manual tool test completed for ${toolName}.`, requestMessage);
      setStatus(result?.ok === true
        ? `Manual tool test complete for ${toolName}.`
        : `Manual tool test completed with failures for ${toolName}.`);
    } catch (error) {
      appendToolTestAssistantMessage({
        ok: false,
        run_mode: 'single',
        tool_name: toolName,
        request_message: requestMessage,
        status: 'error',
        tool_count: 1,
        passed_count: 0,
        failed_count: 1,
        summary: `Manual tool test failed for ${toolName}: ${String(error?.message || error)}`,
        items: [
          {
            tool_name: toolName,
            ok: false,
            status: 'error',
            request_message: requestMessage,
            result_message: `Manual tool test failed for ${toolName}: ${String(error?.message || error)}`,
            summary: `Manual tool test failed for ${toolName}: ${String(error?.message || error)}`,
            error: String(error?.message || error),
            preview: '',
            duration_ms: 0,
            raw_result: {}
          }
        ]
      }, `Manual tool test failed for ${toolName}: ${String(error?.message || error)}`, requestMessage);
      setStatus('Error.');
    } finally {
      updateInFlightState(false);
    }
  }

  async function runDeveloperToolSmokeTest() {
    if (inFlight) {
      return;
    }
    if (state.settings?.agent?.developerMode !== true) {
      setStatus('Enable Agent Developer Mode to run manual tool smoke tests.');
      return;
    }
    if (!window.enanaApi?.agentDeveloperTestTools) {
      setStatus('Developer tool test IPC is unavailable.');
      return;
    }

    ensureAgentState();

    const projectId = state.agentChat.projectId || '';
    const projectName = asArray(state.projects).find((item) => item.id === projectId)?.name || '';
    updateInFlightState(true);
    setStatus('Running manual tool smoke tests...');

    try {
      const stateSnapshot = await buildSyncedStateSnapshot(projectId);
      const result = await window.enanaApi.agentDeveloperTestTools({
        projectId,
        projectName,
        stateSnapshot,
        agent: {
          developerMode: state.settings?.agent?.developerMode === true
        }
      });

      if (!result?.ok && !asArray(result?.items).length) {
        throw new Error(result?.error || 'Manual tool smoke test failed.');
      }

      appendToolTestAssistantMessage(result, 'Manual tool smoke test completed.');
      setStatus(result?.ok === true ? 'Manual tool smoke test complete.' : 'Manual tool smoke test completed with failures.');
    } catch (error) {
      appendToolTestAssistantMessage({
        ok: false,
        run_mode: 'all',
        status: 'error',
        tool_count: 0,
        passed_count: 0,
        failed_count: 0,
        summary: `Manual tool smoke test failed: ${String(error?.message || error)}`,
        items: []
      }, `Manual tool smoke test failed: ${String(error?.message || error)}`);
      setStatus('Error.');
    } finally {
      updateInFlightState(false);
    }
  }

  function render() {
    ensureAgentState();
    renderProjectOptions();
    renderDeveloperToolOptions();
    renderContextSummary();
    renderSessionList();
    void refreshPersistentSessions();
    if (developerTools) {
      developerTools.hidden = !(state.settings?.agent?.developerMode === true && window.enanaApi?.agentDeveloperTestTools);
    }
    renderHistory();
    if (!inFlight) {
      setStatus('Ready.');
    }
  }

  return {
    render
  };
}
