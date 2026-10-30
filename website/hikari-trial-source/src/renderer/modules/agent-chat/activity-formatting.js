import { trimText } from './text.js';

export const TOOL_ACTIVITY_LABELS = {
  'inventory-lookup': 'Checking inventory records',
  'notebook-lookup': 'Checking lab notebook pages',
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
