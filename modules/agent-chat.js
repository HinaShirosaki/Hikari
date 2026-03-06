import { mapExperimentDataToLlmJson } from './experiment-llm-mapper.js';

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

function getStepText(step) {
  if (typeof step === 'string') {
    return trimText(step, 200);
  }
  return trimText(step?.text || step?.instruction, 200);
}

function mapProtocol(protocol) {
  const steps = asArray(protocol?.steps)
    .slice(0, 30)
    .map((step) => getStepText(step))
    .filter(Boolean);

  return {
    id: String(protocol?.id || ''),
    name: trimText(protocol?.name, 180),
    category: trimText(protocol?.category, 80),
    steps
  };
}

function mapNotebookEntry(entry) {
  return {
    id: String(entry?.id || ''),
    projectId: String(entry?.projectId || ''),
    protocolId: String(entry?.protocolId || ''),
    protocolName: trimText(entry?.protocolName, 180),
    result: trimText(entry?.result || entry?.body, 900),
    updatedAt: String(entry?.updatedAt || entry?.createdAt || '')
  };
}

// Re-export to preserve existing imports from agent-chat.js.
export { mapExperimentDataToLlmJson };

function mapPaper(paper) {
  return {
    id: String(paper?.id || ''),
    title: trimText(paper?.title, 220),
    linkedType: String(paper?.linkedType || ''),
    linkedId: String(paper?.linkedId || ''),
    summary: trimText(paper?.summary, 1200),
    methods: asArray(paper?.methodsExtract)
      .slice(0, 6)
      .map((method) => ({
        title: trimText(method?.title, 180),
        steps: asArray(method?.steps).slice(0, 10).map((step) => trimText(step, 180)).filter(Boolean),
        citations: asArray(method?.citations).slice(0, 8).map((item) => trimText(item, 120)).filter(Boolean)
      }))
  };
}

function mapInventory(state) {
  const personalInventory = Object.entries(state?.inventory || {}).map(([zone, items]) => ({
    zone,
    items: asArray(items).slice(0, 40).map((item) => ({
      id: String(item?.id || ''),
      name: trimText(item?.name || item?.itemName, 120),
      quantity: trimText(item?.quantity || item?.amount, 60),
      location: trimText(item?.location || item?.position, 80)
    }))
  }));

  const chemicalInventory = asArray(state?.labInventory?.chemicals).slice(0, 80).map((item) => ({
    id: String(item?.id || ''),
    name: trimText(item?.name, 120),
    cas: trimText(item?.cas, 80),
    amount: trimText(item?.amount, 60),
    location: trimText(item?.locationLabel || item?.location, 100),
    supplier: trimText(item?.supplier, 120)
  }));

  return {
    personal: personalInventory,
    chemicals: chemicalInventory
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

export function initAgentChat({ state, persist, createId, safeText }) {
  const projectSelect = document.getElementById('agent-project-select');
  const contextSummary = document.getElementById('agent-context-summary');
  const historyNode = document.getElementById('agent-chat-history');
  const input = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');
  const clearBtn = document.getElementById('agent-clear-btn');
  const status = document.getElementById('agent-status');
  let inFlight = false;

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

  clearBtn.addEventListener('click', () => {
    ensureAgentState();
    state.agentChat.messages = [];
    persist();
    render();
    setStatus('Chat history cleared.');
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
      state.agentChat = { projectId: '', messages: [] };
      return;
    }
    state.agentChat.projectId = String(state.agentChat.projectId || '');
    state.agentChat.messages = asArray(state.agentChat.messages);
  }

  function setStatus(text) {
    status.textContent = text;
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

  function buildStateSnapshot(projectId) {
    const filteredProjects = projectId
      ? asArray(state.projects).filter((project) => project.id === projectId)
      : asArray(state.projects);
    const projectIds = new Set(filteredProjects.map((project) => project.id));

    const filteredNotebookEntries = asArray(state.notebookEntries)
      .filter((entry) => !projectIds.size || projectIds.has(entry.projectId))
      .slice(-120);
    const notebookEntries = filteredNotebookEntries.map(mapNotebookEntry);

    const protocolIds = new Set(notebookEntries.map((entry) => entry.protocolId).filter(Boolean));
    const protocols = asArray(state.protocols)
      .filter((protocol) => !projectIds.size || protocolIds.has(protocol.id))
      .slice(0, 80)
      .map(mapProtocol);

    const papers = asArray(state.papers)
      .filter((paper) => !projectIds.size || (paper.linkedType === 'project' && projectIds.has(paper.linkedId)))
      .slice(0, 60)
      .map(mapPaper);

    const projects = filteredProjects.slice(0, 30).map(mapProject);
    const experimentData = mapExperimentDataToLlmJson(state, projectId);
    const assays = asArray(experimentData.assay_runs).slice(0, 80);
    const gelAnalyses = asArray(experimentData.gel_runs).slice(0, 80);

    return {
      projects,
      protocols,
      notebookEntries,
      assays,
      gelAnalyses,
      experimentData,
      papers,
      inventory: mapInventory(state),
      timestamp: new Date().toISOString()
    };
  }

  function renderContextSummary() {
    const projectId = state.agentChat?.projectId || '';
    const snapshot = buildStateSnapshot(projectId);
    const summary = [
      `${snapshot.projects.length} projects`,
      `${snapshot.protocols.length} protocols`,
      `${snapshot.notebookEntries.length} notebook entries`,
      `${snapshot.assays.length} assays`,
      `${snapshot.gelAnalyses.length} gel analyses`,
      `${snapshot.papers.length} papers`,
      `${snapshot.inventory.chemicals.length} chemicals`
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

  function renderAssistantMeta(meta) {
    if (!meta || typeof meta !== 'object') {
      return '';
    }
    const decisionRecord = meta.decisionRecord && typeof meta.decisionRecord === 'object'
      ? meta.decisionRecord
      : {};
    const citations = asArray(meta.citations).map((citation) => {
      const source = trimText(citation?.source, 120) || 'source';
      const pointer = trimText(citation?.pointer, 120) || '-';
      const reason = trimText(citation?.reason, 200) || '';
      return `${source} (${pointer})${reason ? `: ${reason}` : ''}`;
    });
    const assumptions = asArray(decisionRecord.assumptions).map((value) => trimText(value, 220)).filter(Boolean);
    const openQuestions = asArray(decisionRecord.open_questions).map((value) => trimText(value, 220)).filter(Boolean);
    const verificationNotes = asArray(decisionRecord.verification_notes).map((value) => trimText(value, 220)).filter(Boolean);
    const writeActions = asArray(meta.proposedWriteActions).map((action) => {
      const name = trimText(action?.tool_name, 120) || 'write action';
      const reason = trimText(action?.reason, 240) || '';
      return reason ? `${name}: ${reason}` : name;
    });
    const stageRows = asArray(meta.intermediateStates).map((stage) => {
      const stageName = trimText(stage?.stage, 50) || 'stage';
      const goal = trimText(stage?.goal, 200);
      return goal ? `${stageName}: ${goal}` : stageName;
    });
    const toolRows = asArray(meta.toolTrace).map((item) => {
      const tool = trimText(item?.tool, 80) || 'tool';
      const note = trimText(item?.summary, 220) || '';
      return note ? `${tool}: ${note}` : tool;
    });

    const confidence = Number(meta.confidence);
    const confidenceText = Number.isFinite(confidence) ? `Confidence: ${confidence.toFixed(2)}` : 'Confidence: n/a';
    const approvalText = meta.requiresApproval ? 'Requires approval: yes' : 'Requires approval: no';

    return `
      <div class="agent-meta-grid">
        <p class="small-note">${safeText(confidenceText)} | ${safeText(approvalText)}</p>
        ${renderMetaList('Citations', citations)}
        ${renderMetaList('Assumptions', assumptions)}
        ${renderMetaList('Open Questions', openQuestions)}
        ${renderMetaList('Verification Notes', verificationNotes)}
        ${renderMetaList('Proposed Write Actions', writeActions)}
        ${renderMetaList('Reasoning Stages', stageRows)}
        ${renderMetaList('Tool Trace', toolRows)}
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
      const headerLabel = role === 'assistant' ? 'Assistant' : 'You';
      const cardClass = role === 'assistant' ? 'agent-chat-item-assistant' : 'agent-chat-item-user';
      return `
        <article class="agent-chat-item ${cardClass}">
          <header class="agent-chat-header">
            <strong>${headerLabel}</strong>
            <span>${safeText(formatTime(message.createdAt))}</span>
          </header>
          <p class="agent-chat-body">${safeText(message.text || '')}</p>
          ${role === 'assistant' ? renderAssistantMeta(message.meta) : ''}
        </article>
      `;
    }).join('');

    historyNode.scrollTop = historyNode.scrollHeight;
  }

  function updateInFlightState(nextInFlight) {
    inFlight = nextInFlight;
    sendBtn.disabled = inFlight;
    clearBtn.disabled = inFlight;
    projectSelect.disabled = inFlight;
    input.disabled = inFlight;
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
      const result = await window.enanaApi.agentChat({
        message: messageText,
        projectId,
        projectName,
        conversation: toConversation(state.agentChat.messages),
        stateSnapshot: buildStateSnapshot(projectId),
        llm: {
          model: String(state.settings?.llm?.model || '').trim(),
          apiEndpoint: String(state.settings?.llm?.apiEndpoint || '').trim(),
          apiKey: String(state.settings?.llm?.apiKey || '').trim()
        }
      });

      if (!result?.ok) {
        throw new Error(result?.error || 'Agent request failed.');
      }

      state.agentChat.messages.push({
        id: createId(),
        role: 'assistant',
        text: trimText(result.answer, 12000) || 'No answer generated.',
        createdAt: new Date().toISOString(),
        meta: {
          confidence: result.confidence,
          requiresApproval: result.requiresApproval === true,
          citations: asArray(result.citations),
          decisionRecord: result.decisionRecord || {},
          proposedWriteActions: asArray(result.proposedWriteActions),
          intermediateStates: asArray(result.intermediateStates),
          toolTrace: asArray(result.toolTrace)
        }
      });

      state.agentChat.messages = state.agentChat.messages.slice(-40);
      persist();
      renderHistory();
      setStatus('Complete.');
    } catch (error) {
      state.agentChat.messages.push({
        id: createId(),
        role: 'assistant',
        text: `Agent failed: ${String(error?.message || error)}`,
        createdAt: new Date().toISOString(),
        meta: {
          confidence: 0,
          requiresApproval: false,
          citations: [],
          decisionRecord: {},
          proposedWriteActions: [],
          intermediateStates: [],
          toolTrace: []
        }
      });
      state.agentChat.messages = state.agentChat.messages.slice(-40);
      persist();
      renderHistory();
      setStatus('Error.');
    } finally {
      updateInFlightState(false);
    }
  }

  function render() {
    ensureAgentState();
    renderProjectOptions();
    renderContextSummary();
    renderHistory();
    if (!inFlight) {
      setStatus('Ready.');
    }
  }

  return {
    render
  };
}
