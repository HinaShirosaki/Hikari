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
  if (meta.notebookDraft?.save?.mode === 'auto_save_draft') {
    const status = meta.notebookDraft?.save?.applied === true ? 'done' : 'pending';
    upsertRow(status, `Notebook draft auto-save: ${trimText(meta.notebookDraft?.save?.status, 80) || 'pending'}`);
  }
  if (meta.routing?.plan?.needs_clarification) {
    upsertRow('pending', 'Waiting on routing clarification');
  }

  return rows.slice(0, 20);
}

export function initAgentChat({ state, persist, createId, safeText, onNotebookEntriesChanged }) {
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
      protocols: [],
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
    const responseType = trimText(meta.response_type, 80);
    const confidenceLabel = trimText(meta.confidence_label, 20);
    const responseLayerRows = [
      responseType ? `response_type: ${responseType}` : '',
      confidenceLabel ? `confidence_label: ${confidenceLabel}` : ''
    ].filter(Boolean);
    const sourceSummary = meta.source_summary && typeof meta.source_summary === 'object'
      ? meta.source_summary
      : {};
    const sourceSummaryRows = [];
    const totalSources = Number(sourceSummary.total_sources);
    if (Number.isFinite(totalSources)) {
      sourceSummaryRows.push(`total_sources: ${totalSources}`);
    }
    asArray(sourceSummary.groups).forEach((group, groupIndex) => {
      const sourceType = trimText(group?.source_type, 80) || `group_${groupIndex + 1}`;
      const label = trimText(group?.label, 80) || sourceType;
      const count = Number(group?.count);
      const itemRows = asArray(group?.items).slice(0, 4).map((item) => {
        const pointer = trimText(item?.pointer, 160) || trimText(item?.source, 160) || '-';
        const reason = trimText(item?.reason, 120);
        return reason ? `${pointer} (${reason})` : pointer;
      });
      const preview = itemRows.join('; ');
      sourceSummaryRows.push(`${label} [${sourceType}] count=${Number.isFinite(count) ? count : asArray(group?.items).length}${preview ? `: ${preview}` : ''}`);
    });
    const unresolvedFieldRows = asArray(meta.unresolved_fields).map((item) => {
      const name = trimText(item?.display, 120) || trimText(item?.placeholder_key, 120) || trimText(item?.placeholder_id, 120) || 'placeholder';
      const reason = trimText(item?.reason, 160) || 'missing_supported_value';
      return `${name}: ${reason}`;
    }).filter(Boolean);
    if (!unresolvedFieldRows.length) {
      unresolvedFieldRows.push('none');
    }
    const validation = meta.validation && typeof meta.validation === 'object'
      ? meta.validation
      : {};
    const validationRows = [
      `passed: ${validation.passed === true}`,
      `forced_clarification: ${validation.forced_clarification === true}`
    ];
    asArray(validation.failure_reasons).forEach((reason, index) => {
      const clean = trimText(reason, 120);
      if (clean) {
        validationRows.push(`failure_reason_${index + 1}: ${clean}`);
      }
    });
    asArray(validation.violations).slice(0, 8).forEach((violation, index) => {
      const code = trimText(violation?.code, 80) || `violation_${index + 1}`;
      const severity = trimText(violation?.severity, 30) || 'blocking';
      const message = trimText(violation?.message, 180) || '';
      const detail = trimText(violation?.detail, 120);
      validationRows.push(`${index + 1}. ${code} [${severity}]${message ? ` ${message}` : ''}${detail ? ` (${detail})` : ''}`);
    });
    const provenance = meta.provenance && typeof meta.provenance === 'object'
      ? meta.provenance
      : {};
    const provenanceRows = [];
    const unsupportedCount = Number(provenance.unsupported_statement_count);
    if (Number.isFinite(unsupportedCount)) {
      provenanceRows.push(`unsupported_statement_count: ${unsupportedCount}`);
    }
    asArray(provenance.source_evidence).slice(0, 10).forEach((row, index) => {
      const statement = trimText(row?.statement, 220) || `statement_${index + 1}`;
      const supportLevel = trimText(row?.support_level, 20) || 'none';
      const supports = asArray(row?.supports).slice(0, 3).map((support) => (
        trimText(support?.pointer, 120) || trimText(support?.source, 120) || '-'
      )).filter(Boolean);
      provenanceRows.push(`${index + 1}. [${supportLevel}] ${statement}${supports.length ? ` -> ${supports.join('; ')}` : ''}`);
    });
    if (!provenanceRows.length) {
      provenanceRows.push('No provenance rows.');
    }
    const notebookDraft = normalizeNotebookDraft(meta.notebookDraft);
    const notebookDraftRows = notebookDraft ? [
      `protocol: ${trimText(notebookDraft.protocol?.name, 220) || '-'}`,
      `project: ${trimText(notebookDraft.project?.name, 180) || '-'} (${trimText(notebookDraft.project?.resolution_source, 80) || '-'})`,
      `type: ${trimText(notebookDraft.notebook_type, 40) || 'biology'}`,
      `save: mode=${trimText(notebookDraft.save?.mode, 80) || '-'} status=${trimText(notebookDraft.save?.status, 80) || '-'} applied=${notebookDraft.save?.applied === true}`
    ] : [];
    const notebookDraftFilledRows = notebookDraft
      ? asArray(notebookDraft.placeholder_values).map((item) => {
        const key = trimText(item?.placeholder_key, 120) || trimText(item?.display, 120) || 'placeholder';
        const value = trimText(item?.value, 220) || '-';
        const source = trimText(item?.source, 120) || '-';
        return `${key}: ${value} (${source})`;
      })
      : [];
    const notebookDraftUnresolvedRows = notebookDraft
      ? asArray(notebookDraft.unresolved_placeholders).map((item) => {
        const key = trimText(item?.placeholder_key, 120) || trimText(item?.display, 120) || 'placeholder';
        const reason = trimText(item?.reason, 120) || 'missing_supported_value';
        return `${key}: ${reason}`;
      })
      : [];
    const notebookDraftStepRows = notebookDraft
      ? asArray(notebookDraft.rendered_steps).map((step, index) => `${index + 1}. ${trimText(step, 220)}`)
      : [];
    const routing = meta.routing && typeof meta.routing === 'object' ? meta.routing : {};
    const routingIntent = trimText(routing.intent, 80) || '-';
    const routingConfidence = Number(routing.confidence);
    const routingConfidenceText = Number.isFinite(routingConfidence) ? routingConfidence.toFixed(2) : 'n/a';
    const routingSource = trimText(routing.classifier?.source, 80) || 'llm_parser';
    const routingHeader = `intent=${routingIntent} | confidence=${routingConfidenceText} | source=${routingSource}`;
    const routingPlan = routing.plan && typeof routing.plan === 'object' ? routing.plan : {};
    const routingEntityRows = Object.entries(routing.entities && typeof routing.entities === 'object' ? routing.entities : {})
      .map(([key, value]) => {
        const clean = trimText(value, 180);
        return clean ? `${key}: ${clean}` : '';
      })
      .filter(Boolean);
    const routingPlanRows = Object.entries(routingPlan)
      .filter(([key]) => ![
        'selected_tool_names',
        'tool_selection_rationale',
        'protocol_match',
        'protocol_candidates',
        'project_match',
        'project_candidates',
        'paper_match',
        'paper_candidates',
        'python_task_type',
        'python_ready',
        'python_needs_clarification',
        'python_artifact_count',
        'web_fallback_triggered',
        'web_fallback_reason',
        'web_queries',
        'web_sources',
        'inventory_search'
      ].includes(key))
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
    const routingProjectMatch = routingPlan.project_match && typeof routingPlan.project_match === 'object'
      ? routingPlan.project_match
      : {};
    const routingProjectMatchRows = [
      trimText(routingProjectMatch.selected_project_id, 80)
        ? `selected_project_id: ${trimText(routingProjectMatch.selected_project_id, 80)}`
        : '',
      trimText(routingProjectMatch.selected_project_name, 180)
        ? `selected_project_name: ${trimText(routingProjectMatch.selected_project_name, 180)}`
        : '',
      Number.isFinite(Number(routingProjectMatch.top_score))
        ? `top_score: ${Number(routingProjectMatch.top_score).toFixed(3)}`
        : '',
      Number.isFinite(Number(routingProjectMatch.score_delta))
        ? `score_delta: ${Number(routingProjectMatch.score_delta).toFixed(3)}`
        : '',
      trimText(routingProjectMatch.resolution_source, 80)
        ? `resolution_source: ${trimText(routingProjectMatch.resolution_source, 80)}`
        : '',
      `needs_clarification: ${routingProjectMatch.needs_clarification === true}`,
      trimText(routingProjectMatch.ambiguity_reason, 180)
        ? `ambiguity_reason: ${trimText(routingProjectMatch.ambiguity_reason, 180)}`
        : ''
    ].filter(Boolean);
    const routingProjectCandidateRows = asArray(routingPlan.project_candidates).map((candidate, index) => {
      const name = trimText(candidate?.project_name, 180) || trimText(candidate?.project_id, 80) || `candidate_${index + 1}`;
      const score = Number(candidate?.score);
      const exact = Number(candidate?.exact_name_score);
      const partial = Number(candidate?.partial_name_score);
      const selected = Number(candidate?.selected_bias_score);
      const linked = Number(candidate?.linked_record_support_score);
      const metrics = [
        Number.isFinite(score) ? `score=${score.toFixed(3)}` : '',
        Number.isFinite(exact) ? `exact=${exact.toFixed(3)}` : '',
        Number.isFinite(partial) ? `partial=${partial.toFixed(3)}` : '',
        Number.isFinite(selected) ? `selected=${selected.toFixed(3)}` : '',
        Number.isFinite(linked) ? `linked=${linked.toFixed(3)}` : ''
      ].filter(Boolean).join(' ');
      const reason = trimText(candidate?.reason, 180);
      return `${index + 1}. ${name}${metrics ? ` (${metrics})` : ''}${reason ? ` - ${reason}` : ''}`;
    }).filter(Boolean);
    const routingPaperMatch = routingPlan.paper_match && typeof routingPlan.paper_match === 'object'
      ? routingPlan.paper_match
      : {};
    const routingPaperMatchRows = [
      trimText(routingPaperMatch.selected_paper_id, 80)
        ? `selected_paper_id: ${trimText(routingPaperMatch.selected_paper_id, 80)}`
        : '',
      trimText(routingPaperMatch.selected_paper_title, 220)
        ? `selected_paper_title: ${trimText(routingPaperMatch.selected_paper_title, 220)}`
        : '',
      trimText(routingPaperMatch.secondary_paper_id, 80)
        ? `secondary_paper_id: ${trimText(routingPaperMatch.secondary_paper_id, 80)}`
        : '',
      trimText(routingPaperMatch.secondary_paper_title, 220)
        ? `secondary_paper_title: ${trimText(routingPaperMatch.secondary_paper_title, 220)}`
        : '',
      Number.isFinite(Number(routingPaperMatch.top_score))
        ? `top_score: ${Number(routingPaperMatch.top_score).toFixed(3)}`
        : '',
      Number.isFinite(Number(routingPaperMatch.score_delta))
        ? `score_delta: ${Number(routingPaperMatch.score_delta).toFixed(3)}`
        : '',
      trimText(routingPaperMatch.availability_status, 80)
        ? `availability_status: ${trimText(routingPaperMatch.availability_status, 80)}`
        : '',
      `deep_read_ready: ${routingPaperMatch.deep_read_ready === true}`,
      trimText(routingPaperMatch.secondary_availability_status, 80)
        ? `secondary_availability_status: ${trimText(routingPaperMatch.secondary_availability_status, 80)}`
        : '',
      `secondary_deep_read_ready: ${routingPaperMatch.secondary_deep_read_ready === true}`,
      `needs_clarification: ${routingPaperMatch.needs_clarification === true}`,
      trimText(routingPaperMatch.ambiguity_reason, 180)
        ? `ambiguity_reason: ${trimText(routingPaperMatch.ambiguity_reason, 180)}`
        : ''
    ].filter(Boolean);
    const routingPaperCandidateRows = asArray(routingPlan.paper_candidates).map((candidate, index) => {
      const name = trimText(candidate?.paper_title, 220) || trimText(candidate?.paper_id, 80) || `paper_${index + 1}`;
      const score = Number(candidate?.score);
      const semantic = Number(candidate?.semantic_score);
      const title = Number(candidate?.title_score);
      const entity = Number(candidate?.entity_overlap_score);
      const project = Number(candidate?.project_relevance_score);
      const metrics = [
        Number.isFinite(score) ? `score=${score.toFixed(3)}` : '',
        Number.isFinite(semantic) ? `semantic=${semantic.toFixed(3)}` : '',
        Number.isFinite(title) ? `title=${title.toFixed(3)}` : '',
        Number.isFinite(entity) ? `entity=${entity.toFixed(3)}` : '',
        Number.isFinite(project) ? `project=${project.toFixed(3)}` : ''
      ].filter(Boolean).join(' ');
      const availability = trimText(candidate?.availability_status, 80);
      const reason = trimText(candidate?.reason, 180);
      return `${index + 1}. ${name}${metrics ? ` (${metrics})` : ''}${availability ? ` availability=${availability}` : ''}${reason ? ` - ${reason}` : ''}`;
    }).filter(Boolean);
    const paperAvailabilityRows = [
      trimText(routingPaperMatch.selected_paper_title, 220)
        ? `${trimText(routingPaperMatch.selected_paper_title, 220)}: ${trimText(routingPaperMatch.availability_status, 80) || 'unknown'} (deep_ready=${routingPaperMatch.deep_read_ready === true})`
        : '',
      trimText(routingPaperMatch.secondary_paper_title, 220)
        ? `${trimText(routingPaperMatch.secondary_paper_title, 220)}: ${trimText(routingPaperMatch.secondary_availability_status, 80) || 'unknown'} (deep_ready=${routingPaperMatch.secondary_deep_read_ready === true})`
        : ''
    ].filter(Boolean);
    if (!paperAvailabilityRows.length) {
      paperAvailabilityRows.push('No paper availability context.');
    }
    const routingPythonRows = [
      trimText(routingPlan.python_task_type, 80)
        ? `python_task_type: ${trimText(routingPlan.python_task_type, 80)}`
        : '',
      `python_ready: ${routingPlan.python_ready === true}`,
      `python_needs_clarification: ${routingPlan.python_needs_clarification === true}`,
      Number.isFinite(Number(routingPlan.python_artifact_count))
        ? `python_artifact_count: ${Number(routingPlan.python_artifact_count)}`
        : '',
      trimText(routingPlan.python_codegen_status, 80)
        ? `python_codegen_status: ${trimText(routingPlan.python_codegen_status, 80)}`
        : '',
      trimText(routingPlan.python_codegen_reason, 180)
        ? `python_codegen_reason: ${trimText(routingPlan.python_codegen_reason, 180)}`
        : ''
    ].filter(Boolean);
    const routingWebFallbackRows = [
      `web_fallback_triggered: ${routingPlan.web_fallback_triggered === true}`,
      trimText(routingPlan.web_fallback_reason, 180)
        ? `web_fallback_reason: ${trimText(routingPlan.web_fallback_reason, 180)}`
        : ''
    ].filter(Boolean);
    asArray(routingPlan.web_queries).forEach((query, index) => {
      const clean = trimText(query, 220);
      if (clean) {
        routingWebFallbackRows.push(`query_${index + 1}: ${clean}`);
      }
    });
    const webSourceRows = asArray(routingPlan.web_sources).map((item, index) => {
      const title = trimText(item?.title, 180) || trimText(item?.url, 180) || `web_source_${index + 1}`;
      const lane = trimText(item?.source_lane, 40);
      const domain = trimText(item?.source_domain, 120);
      const tool = trimText(item?.source_tool, 120);
      const score = Number(item?.score);
      const metrics = [
        lane ? `lane=${lane}` : '',
        domain ? `domain=${domain}` : '',
        tool ? `tool=${tool}` : '',
        Number.isFinite(score) ? `score=${score.toFixed(2)}` : ''
      ].filter(Boolean).join(' ');
      return `${index + 1}. ${title}${metrics ? ` (${metrics})` : ''}`;
    }).filter(Boolean);
    const routingInventorySearch = routingPlan.inventory_search && typeof routingPlan.inventory_search === 'object'
      ? routingPlan.inventory_search
      : {};
    const routingInventorySearchRows = [
      trimText(routingInventorySearch.normalized_query, 220)
        ? `normalized_query: ${trimText(routingInventorySearch.normalized_query, 220)}`
        : '',
      trimText(routingInventorySearch.search_mode, 80)
        ? `search_mode: ${trimText(routingInventorySearch.search_mode, 80)}`
        : ''
    ].filter(Boolean);
    asArray(routingInventorySearch.candidate_terms).forEach((term, index) => {
      const clean = trimText(term, 160);
      if (clean) {
        routingInventorySearchRows.push(`candidate_${index + 1}: ${clean}`);
      }
    });
    asArray(routingInventorySearch.aliases).forEach((term, index) => {
      const clean = trimText(term, 160);
      if (clean) {
        routingInventorySearchRows.push(`alias_${index + 1}: ${clean}`);
      }
    });
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
    const routingParserRows = [
      trimText(routing.classifier?.parserPrimaryIntent, 80)
        ? `primary_intent: ${trimText(routing.classifier?.parserPrimaryIntent, 80)}`
        : '',
      asArray(routing.classifier?.parserSecondaryIntents).length
        ? `secondary_intents: ${asArray(routing.classifier?.parserSecondaryIntents).join(', ')}`
        : '',
      trimText(routing.classifier?.mappedExecutionIntent, 80)
        ? `mapped_execution_intent: ${trimText(routing.classifier?.mappedExecutionIntent, 80)}`
        : '',
      `parser_needs_clarification: ${routing.classifier?.parserNeedsClarification === true}`,
      trimText(routing.classifier?.parserClarificationReason, 220)
        ? `clarification_reason: ${trimText(routing.classifier?.parserClarificationReason, 220)}`
        : '',
      trimText(routing.classifier?.parserReasoningSummary, 220)
        ? `reasoning_summary: ${trimText(routing.classifier?.parserReasoningSummary, 220)}`
        : ''
    ].filter(Boolean);
    const routingParserEntityRows = Object.entries(
      routing.classifier?.parserEntities && typeof routing.classifier.parserEntities === 'object'
        ? routing.classifier.parserEntities
        : {}
    ).map(([key, value]) => {
      const clean = trimText(value, 180);
      return clean ? `${key}: ${clean}` : '';
    }).filter(Boolean);
    const routingRows = [routingHeader];

    const confidence = Number(meta.confidence);
    const confidenceText = Number.isFinite(confidence) ? `Confidence: ${confidence.toFixed(2)}` : 'Confidence: n/a';
    const confidenceLabelText = confidenceLabel ? `Confidence label: ${confidenceLabel}` : '';
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
        <p class="small-note">${safeText([confidenceText, confidenceLabelText, approvalText].filter(Boolean).join(' | '))}</p>
        ${renderMetaList('Routing', routingRows)}
        ${renderMetaList('Routing Parser', routingParserRows)}
        ${renderMetaList('Routing Parser Entities', routingParserEntityRows)}
        ${renderMetaList('Routing Entities', routingEntityRows)}
        ${renderMetaList('Routing Plan', routingPlanRows)}
        ${renderMetaList('Routing Inventory Search', routingInventorySearchRows)}
        ${renderMetaList('Routing Project Match', routingProjectMatchRows)}
        ${renderMetaList('Routing Project Candidates', routingProjectCandidateRows)}
        ${renderMetaList('Routing Paper Match', routingPaperMatchRows)}
        ${renderMetaList('Routing Paper Candidates', routingPaperCandidateRows)}
        ${renderMetaList('Paper Availability', paperAvailabilityRows)}
        ${renderMetaList('Routing Python', routingPythonRows)}
        ${renderMetaList('Routing Web Fallback', routingWebFallbackRows)}
        ${renderMetaList('Web Sources', webSourceRows)}
        ${renderMetaList('Routing Protocol Match', routingProtocolMatchRows)}
        ${renderMetaList('Routing Protocol Candidates', routingProtocolCandidateRows)}
        ${renderMetaList('Routing Tools', routingToolRows)}
        ${renderMetaList('Routing Tool Selector', routingSelectorRows)}
        ${renderMetaList('Routing Classifier', routingClassifierRows)}
        ${renderMetaList('Response Layer', responseLayerRows)}
        ${renderMetaList('Source Summary', sourceSummaryRows)}
        ${renderMetaList('Unresolved Fields', unresolvedFieldRows)}
        ${renderMetaList('Validation', validationRows)}
        ${renderMetaList('Provenance', provenanceRows)}
        ${renderMetaList('Notebook Draft', notebookDraftRows)}
        ${renderMetaList('Notebook Draft Filled Placeholders', notebookDraftFilledRows)}
        ${renderMetaList('Notebook Draft Unresolved Placeholders', notebookDraftUnresolvedRows)}
        ${renderMetaList('Notebook Draft Steps', notebookDraftStepRows)}
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

      const result = await window.enanaApi.agentChat({
        message: messageText,
        projectId,
        projectName,
        conversation: toConversation(state.agentChat.messages),
        stateSnapshot,
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
      const notebookDraft = applyNotebookDraftAutoSave(result.notebookDraft, messageText);

      state.agentChat.messages.push({
        id: createId(),
        role: 'assistant',
        text: trimText(result.answer, 12000) || 'No answer generated.',
        createdAt: new Date().toISOString(),
        meta: {
          confidence: result.confidence,
          confidence_label: trimText(result.confidence_label, 20),
          response_type: trimText(result.response_type, 80),
          source_summary: result.source_summary && typeof result.source_summary === 'object'
            ? result.source_summary
            : null,
          unresolved_fields: asArray(result.unresolved_fields),
          validation: result.validation && typeof result.validation === 'object'
            ? result.validation
            : null,
          provenance: result.provenance && typeof result.provenance === 'object'
            ? result.provenance
            : null,
          requiresApproval: result.requiresApproval === true,
          citations: asArray(result.citations),
          decisionRecord: result.decisionRecord || {},
          routing: result.routing && typeof result.routing === 'object' ? result.routing : {},
          notebookDraft: notebookDraft || null,
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
          confidence_label: 'low',
          response_type: 'factual_answer',
          source_summary: null,
          unresolved_fields: [],
          validation: null,
          provenance: null,
          requiresApproval: false,
          citations: [],
          decisionRecord: {},
          routing: {},
          notebookDraft: null,
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
