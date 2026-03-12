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
  return trimText(step?.text || step?.instruction || step?.action || step?.description, 200);
}

function getMethodStepText(step) {
  if (typeof step === 'string') {
    return trimText(step, 180);
  }
  return trimText(step?.action || step?.text || step?.instruction || step?.description, 180);
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
        steps: asArray(method?.steps).slice(0, 10).map((step) => getMethodStepText(step)).filter(Boolean),
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

const TOOL_ACTIVITY_LABELS = {
  search_projects: 'Checking project records',
  search_protocols: 'Checking stored protocols',
  search_notebook_entries: 'Checking lab notebook pages',
  search_assays: 'Checking assay records',
  search_gel_analyses: 'Checking gel analysis records',
  search_inventory: 'Checking inventory records',
  search_papers: 'Checking stored PDF papers',
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
  download_paper_pdf: 'Downloading papers'
};

function inferRequestedActivities(requestText) {
  const text = String(requestText || '').toLowerCase();
  if (!text) {
    return [];
  }

  const rows = [];
  if (/\b(inventory|stock|reagent|chemical)\b/.test(text)) {
    rows.push('Checking inventory records');
  }
  if (/\b(paper|papers|pdf|literature|journal)\b/.test(text)) {
    rows.push('Checking stored PDF papers');
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

function activityStatusRank(status) {
  if (status === 'done') {
    return 3;
  }
  if (status === 'pending') {
    return 2;
  }
  return 1;
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

function collectActivityRows(meta) {
  if (!meta || typeof meta !== 'object') {
    return [];
  }

  const rows = [];
  const rowIndexByKey = new Map();
  const upsertRow = (status, text) => {
    const clean = trimText(text, 260);
    if (!clean) {
      return;
    }
    const key = clean.toLowerCase();
    const existingIndex = rowIndexByKey.get(key);
    if (existingIndex === undefined) {
      rowIndexByKey.set(key, rows.length);
      rows.push({ status, text: clean });
      return;
    }
    if (activityStatusRank(status) > activityStatusRank(rows[existingIndex].status)) {
      rows[existingIndex].status = status;
    }
  };

  asArray(meta.intermediateStates).forEach((stage) => {
    upsertRow('done', formatStageActivity(stage?.stage, stage?.goal));
  });

  asArray(meta.toolTrace).forEach((item) => {
    const toolName = trimText(item?.tool, 120);
    const action = TOOL_ACTIVITY_LABELS[toolName] || `Running ${toolName || 'tool'}`;
    const summary = trimText(item?.summary, 200);
    upsertRow('done', summary ? `${action}: ${summary}` : action);
  });

  asArray(meta.proposedWriteActions).forEach((action) => {
    upsertRow('pending', formatWriteActivity(action));
  });

  inferRequestedActivities(meta.requestText).forEach((activity) => {
    const status = activity.includes('(pending approval)') ? 'pending' : 'planned';
    upsertRow(status, activity);
  });

  const routingIntent = trimText(meta.routing?.intent, 80);
  if (routingIntent) {
    upsertRow('done', `Routing intent: ${routingIntent}`);
  }
  if (meta.routing?.plan?.needs_clarification) {
    upsertRow('pending', 'Waiting on routing clarification');
  }

  return rows.slice(0, 20);
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
      settings: {
        storagePath: trimText(state.settings?.storagePath, 1200)
      },
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
    const routing = meta.routing && typeof meta.routing === 'object' ? meta.routing : {};
    const routingIntent = trimText(routing.intent, 80) || '-';
    const routingConfidence = Number(routing.confidence);
    const routingConfidenceText = Number.isFinite(routingConfidence) ? routingConfidence.toFixed(2) : 'n/a';
    const routingSource = trimText(routing.classifier?.source, 80) || 'rules';
    const routingHeader = `intent=${routingIntent} | confidence=${routingConfidenceText} | source=${routingSource}`;
    const routingPlan = routing.plan && typeof routing.plan === 'object' ? routing.plan : {};
    const routingEntityRows = Object.entries(routing.entities && typeof routing.entities === 'object' ? routing.entities : {})
      .map(([key, value]) => {
        const clean = trimText(value, 180);
        return clean ? `${key}: ${clean}` : '';
      })
      .filter(Boolean);
    const routingPlanRows = Object.entries(routingPlan)
      .filter(([key]) => !['selected_tool_names', 'tool_selection_rationale', 'protocol_match', 'protocol_candidates'].includes(key))
      .map(([key, value]) => {
        if (typeof value === 'boolean') {
          return `${key}: ${value}`;
        }
        const clean = trimText(value, 180);
        return clean ? `${key}: ${clean}` : '';
      })
      .filter(Boolean);
    const routingProtocolMatch = routingPlan.protocol_match && typeof routingPlan.protocol_match === 'object'
      ? routingPlan.protocol_match
      : {};
    const routingProtocolMatchRows = [
      trimText(routingProtocolMatch.selected_protocol_id, 80)
        ? `selected_protocol_id: ${trimText(routingProtocolMatch.selected_protocol_id, 80)}`
        : '',
      trimText(routingProtocolMatch.selected_protocol_name, 180)
        ? `selected_protocol_name: ${trimText(routingProtocolMatch.selected_protocol_name, 180)}`
        : '',
      Number.isFinite(Number(routingProtocolMatch.top_score))
        ? `top_score: ${Number(routingProtocolMatch.top_score).toFixed(3)}`
        : '',
      Number.isFinite(Number(routingProtocolMatch.score_delta))
        ? `score_delta: ${Number(routingProtocolMatch.score_delta).toFixed(3)}`
        : '',
      `needs_clarification: ${routingProtocolMatch.needs_clarification === true}`,
      trimText(routingProtocolMatch.ambiguity_reason, 180)
        ? `ambiguity_reason: ${trimText(routingProtocolMatch.ambiguity_reason, 180)}`
        : ''
    ].filter(Boolean);
    const routingProtocolCandidateRows = asArray(routingPlan.protocol_candidates).map((candidate, index) => {
      const name = trimText(candidate?.protocol_name, 180) || trimText(candidate?.protocol_id, 80) || `candidate_${index + 1}`;
      const score = Number(candidate?.score);
      const semantic = Number(candidate?.semantic_score);
      const entity = Number(candidate?.entity_overlap_score);
      const project = Number(candidate?.project_relevance_score);
      const recent = Number(candidate?.recent_workflow_relevance_score);
      const metrics = [
        Number.isFinite(score) ? `score=${score.toFixed(3)}` : '',
        Number.isFinite(semantic) ? `semantic=${semantic.toFixed(3)}` : '',
        Number.isFinite(entity) ? `entity=${entity.toFixed(3)}` : '',
        Number.isFinite(project) ? `project=${project.toFixed(3)}` : '',
        Number.isFinite(recent) ? `recent=${recent.toFixed(3)}` : ''
      ].filter(Boolean).join(' ');
      const reason = trimText(candidate?.reason, 180);
      return `${index + 1}. ${name}${metrics ? ` (${metrics})` : ''}${reason ? ` - ${reason}` : ''}`;
    }).filter(Boolean);
    const routingToolRows = asArray(routingPlan.selected_tool_names).map((tool) => trimText(tool, 120)).filter(Boolean);
    const routingSelectorRows = asArray(routingPlan.tool_selection_rationale).map((row, index) => {
      const tool = trimText(row?.tool, 120) || `tool_${index + 1}`;
      const score = Number(row?.score);
      const entity = Number(row?.entityScore);
      const task = Number(row?.taskScore);
      const exactness = Number(row?.exactnessScore);
      const reason = trimText(row?.reason, 180);
      const metrics = [
        Number.isFinite(score) ? `score=${score.toFixed(2)}` : '',
        Number.isFinite(entity) ? `entity=${entity.toFixed(2)}` : '',
        Number.isFinite(task) ? `task=${task.toFixed(2)}` : '',
        Number.isFinite(exactness) ? `exactness=${exactness.toFixed(2)}` : ''
      ].filter(Boolean).join(' ');
      return `${tool}${metrics ? ` (${metrics})` : ''}${reason ? ` - ${reason}` : ''}`;
    }).filter(Boolean);
    const routingClassifierRows = [
      `fallbackAttempted: ${routing.classifier?.fallbackAttempted === true}`,
      `fallbackUsed: ${routing.classifier?.fallbackUsed === true}`,
      `lowConfidence: ${routing.classifier?.lowConfidence === true}`,
      `tieDetected: ${routing.classifier?.tieDetected === true}`,
      trimText(routing.classifier?.ruleReason, 220) ? `ruleReason: ${trimText(routing.classifier?.ruleReason, 220)}` : '',
      trimText(routing.classifier?.fallbackError, 220) ? `fallbackError: ${trimText(routing.classifier?.fallbackError, 220)}` : ''
    ].filter(Boolean);
    const routingRows = [routingHeader];

    const confidence = Number(meta.confidence);
    const confidenceText = Number.isFinite(confidence) ? `Confidence: ${confidence.toFixed(2)}` : 'Confidence: n/a';
    const approvalText = meta.requiresApproval ? 'Requires approval: yes' : 'Requires approval: no';
    const activityRows = collectActivityRows(meta);

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
        <p class="small-note">${safeText(confidenceText)} | ${safeText(approvalText)}</p>
        ${renderMetaList('Routing', routingRows)}
        ${renderMetaList('Routing Entities', routingEntityRows)}
        ${renderMetaList('Routing Plan', routingPlanRows)}
        ${renderMetaList('Routing Protocol Match', routingProtocolMatchRows)}
        ${renderMetaList('Routing Protocol Candidates', routingProtocolCandidateRows)}
        ${renderMetaList('Routing Tools', routingToolRows)}
        ${renderMetaList('Routing Tool Selector', routingSelectorRows)}
        ${renderMetaList('Routing Classifier', routingClassifierRows)}
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
          provider: String(state.settings?.llm?.provider || '').trim(),
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
          routing: result.routing && typeof result.routing === 'object' ? result.routing : {},
          proposedWriteActions: asArray(result.proposedWriteActions),
          intermediateStates: asArray(result.intermediateStates),
          toolTrace: asArray(result.toolTrace),
          requestText: messageText
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
          routing: {},
          proposedWriteActions: [],
          intermediateStates: [],
          toolTrace: [],
          requestText: messageText
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
