export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function trimText(value, maxLength = 5000) {
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

export function mapWorkflow(workflow, protocolsById = new Map(), projectNameById = new Map()) {
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
    notebookEntryIds: asArray(workflow?.notebookEntryIds).map((id) => trimText(id, 120)).filter(Boolean).slice(0, 40),
    block_count: blocks.length,
    link_count: asArray(workflow?.links).length,
    steps_preview: stepsPreview,
    blocks: blocks.slice(0, 40).map((block, index) => {
      const type = String(block?.type || '').trim().toLowerCase() === 'text' ? 'text' : (String(block?.protocolId || '').trim() ? 'protocol' : 'text');
      const protocolId = trimText(block?.protocolId, 120);
      const protocolName = protocolId ? trimText(protocolsById.get(protocolId), 180) : '';
      return {
        id: trimText(block?.id, 120) || `block-${index + 1}`,
        type,
        protocolId,
        protocolName,
        text: type === 'text' ? trimText(block?.text, 220) : '',
        assigneeId: trimText(block?.assigneeId, 120)
      };
    }),
    links: asArray(workflow?.links).slice(0, 60).map((link, index) => ({
      id: trimText(link?.id, 120) || `link-${index + 1}`,
      fromBlockId: trimText(link?.fromBlockId, 120),
      toBlockId: trimText(link?.toBlockId, 120)
    })).filter((link) => link.fromBlockId && link.toBlockId),
    updated_at: String(workflow?.updatedAt || workflow?.createdAt || '')
  };
}

export function mapPaper(paper) {
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

export function mapProject(project) {
  return {
    id: String(project?.id || ''),
    name: trimText(project?.name, 160),
    summary: trimText(project?.description || project?.objective, 240)
  };
}

export function toConversation(messages) {
  return asArray(messages)
    .slice(-12)
    .map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      text: trimText(message?.text, 4000)
    }))
    .filter((item) => item.text);
}

export const TOOL_ACTIVITY_LABELS = {
  'inventory-lookup': 'Checking inventory records',
  'record-lookup': 'Checking lab records',
  'purchase-recommendation': 'Finding products to buy',
  'notebook-draft': 'Preparing notebook draft',
  'python-sandbox': 'Running Python sandbox',
  'literature-search': 'Searching literature sources',
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
  toolbox_crispr_sgrna_designer: 'Designing CRISPR sgRNAs',
  run_python_sandbox: 'Running Python sandbox',
  hybrid_web_fallback: 'Merging web and literature evidence',
  download_paper_pdf: 'Downloading papers'
};

export const DEVELOPER_TOOL_TEST_OPTIONS = [
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
    name: 'notebook-draft',
    label: 'Notebook Draft',
    description: 'Pass a planning-style message to inspect the proposed next experiment and confirm-first notebook payload.',
    example: 'Draft tomorrow’s next experiment for Atlas.'
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
    example: 'binder stability methods'
  },
  {
    name: 'purchase-recommendation',
    label: 'Purchase Recommendation',
    description: 'Pass a product request and inspect the extracted purchasable items with image, price, and vendor metadata.',
    example: 'cheap metal-free endotoxin-free syringe filter'
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

export const DEVELOPER_TOOL_TEST_OPTION_BY_NAME = new Map(
  DEVELOPER_TOOL_TEST_OPTIONS.map((item) => [item.name, item])
);

export function inferRequestedActivities(requestText) {
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
  if (/\b(buy|purchase|shop|shopping|vendor|price)\b/.test(text)) {
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

export function formatStageActivity(stage, goal) {
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

export function formatWriteActivity(action) {
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
