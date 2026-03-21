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

  const parser = meta.parser && typeof meta.parser === 'object' ? meta.parser : {};
  const intent = trimText(parser.primary_intent, 80);
  if (intent) {
    upsertRow('done', `Intent parsed: ${intent}`);
  }
  if (parser.needs_clarification === true) {
    upsertRow('pending', 'Clarification required before execution');
  } else {
    upsertRow('done', 'No clarification required');
  }
  const reasoning = trimText(parser.reasoning_summary, 240);
  if (reasoning) {
    upsertRow('done', `Parser reasoning: ${reasoning}`);
  }
  const protocolWorkflow = meta.protocol_to_notebook && typeof meta.protocol_to_notebook === 'object'
    ? meta.protocol_to_notebook
    : {};
  const protocolStatus = trimText(protocolWorkflow.status, 40);
  if (protocolStatus) {
    upsertRow(protocolStatus === 'completed' ? 'done' : 'pending', `Protocol notebook status: ${protocolStatus}`);
  }
  const selectedProtocolName = trimText(protocolWorkflow?.selected_protocol?.name, 220);
  if (selectedProtocolName) {
    upsertRow('done', `Selected protocol: ${selectedProtocolName}`);
  }
  const missingCount = asArray(protocolWorkflow.missing_placeholders).length;
  if (missingCount > 0) {
    upsertRow('pending', `Missing placeholders: ${missingCount}`);
  }

  asArray(meta.developer_trace).forEach((trace) => {
    const stage = trimText(trace?.stage, 120);
    if (stage) {
      upsertRow('done', `Trace stage: ${stage}`);
    }
  });

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
    const reasoningSummaryRows = [trimText(parser.reasoning_summary, 600) || 'No parser reasoning summary returned.'];
    const activityRows = collectActivityRows(meta);
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
        },
        agent: {
          developerMode: state.settings?.agent?.developerMode === true
        }
      });

      if (!result?.ok) {
        throw new Error(result?.error || 'Agent request failed.');
      }
      const protocolWorkflow = result.protocol_to_notebook && typeof result.protocol_to_notebook === 'object'
        ? result.protocol_to_notebook
        : null;
      const notebookPayload = protocolWorkflow?.notebook && typeof protocolWorkflow.notebook === 'object'
        ? protocolWorkflow.notebook
        : result.notebookDraft;
      const notebookDraft = applyNotebookDraftAutoSave(notebookPayload, messageText);
      const parser = result.parser && typeof result.parser === 'object' ? result.parser : {};
      const protocolStatus = trimText(protocolWorkflow?.status, 40);
      const followUpQuestions = asArray(protocolWorkflow?.follow_up_questions).map((item) => trimText(item, 320)).filter(Boolean);
      const completedNotebookText = trimText(
        protocolWorkflow?.notebook?.entry_template?.result
          || protocolWorkflow?.notebook?.save?.reason
          || '',
        12000
      );
      const assistantText = protocolStatus === 'completed'
        ? (completedNotebookText
          || `Notebook draft completed using protocol ${trimText(protocolWorkflow?.selected_protocol?.name, 220) || 'selection'}.`)
        : (protocolStatus === 'needs_more_info'
          ? (followUpQuestions.join(' ') || 'More details are needed to fill the remaining notebook placeholders.')
          : (trimText(parser.reasoning_summary, 12000) || 'Intent parsing completed.'));

      state.agentChat.messages.push({
        id: createId(),
        role: 'assistant',
        text: assistantText,
        createdAt: new Date().toISOString(),
        meta: {
          parser,
          protocol_to_notebook: protocolWorkflow,
          notebookDraft: notebookDraft || null,
          developer_trace: asArray(result.developer_trace),
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
          notebookDraft: null,
          developer_trace: [],
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
