import { asArray, trimText } from '../shared.js';

function activityStatusRank(status) {
  if (status === 'done') {
    return 3;
  }
  if (status === 'pending') {
    return 2;
  }
  return 1;
}

function collectAgentActivityRows(meta) {
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

  const notebookDraftWorkflow = meta.notebook_draft && typeof meta.notebook_draft === 'object'
    ? meta.notebook_draft
    : {};
  const notebookDraftStatus = trimText(notebookDraftWorkflow.status, 40);
  if (notebookDraftStatus) {
    upsertRow(notebookDraftStatus === 'proposal_ready' ? 'done' : 'pending', `Notebook draft status: ${notebookDraftStatus}`);
  }
  const notebookDraftProtocolName = trimText(notebookDraftWorkflow?.selected_protocol?.name, 220);
  if (notebookDraftProtocolName) {
    upsertRow('done', `Planned protocol: ${notebookDraftProtocolName}`);
  }
  const proposalTitle = trimText(notebookDraftWorkflow?.proposal?.title, 220);
  if (proposalTitle) {
    upsertRow('done', `Proposal: ${proposalTitle}`);
  }
  const notebookDraftMissingCount = asArray(notebookDraftWorkflow.missing_placeholders).length;
  if (notebookDraftMissingCount > 0) {
    upsertRow('pending', `Planned draft missing placeholders: ${notebookDraftMissingCount}`);
  }

  const notebookAppendWorkflow = meta.notebook_append && typeof meta.notebook_append === 'object'
    ? meta.notebook_append
    : {};
  const notebookAppendStatus = trimText(notebookAppendWorkflow.status, 40);
  if (notebookAppendStatus) {
    upsertRow(
      notebookAppendStatus === 'proposal_ready' ? 'pending' : 'done',
      `Notebook append status: ${notebookAppendStatus}`
    );
  }
  const notebookAppendSection = trimText(notebookAppendWorkflow?.proposal?.section_title, 220);
  if (notebookAppendSection) {
    upsertRow('pending', `Append awaiting review: ${notebookAppendSection}`);
  }

  const protocolGeneration = meta.protocol_generation && typeof meta.protocol_generation === 'object'
    ? meta.protocol_generation
    : {};
  const protocolGenerationStatus = trimText(protocolGeneration.status, 40);
  if (protocolGenerationStatus) {
    upsertRow(
      protocolGenerationStatus === 'awaiting_user_approval' ? 'pending' : 'done',
      `Protocol generation status: ${protocolGenerationStatus}`
    );
  }
  const generatedProtocolCount = asArray(protocolGeneration.protocols).length
    || (protocolGeneration.protocol && typeof protocolGeneration.protocol === 'object' ? 1 : 0);
  if (generatedProtocolCount > 0) {
    upsertRow('pending', `Generated protocol awaiting review: ${generatedProtocolCount}`);
  }

  const inventoryLookup = meta.inventory_lookup && typeof meta.inventory_lookup === 'object'
    ? meta.inventory_lookup
    : {};
  const inventoryStatus = trimText(inventoryLookup.status, 40);
  if (inventoryStatus) {
    upsertRow(inventoryStatus === 'matched' ? 'done' : 'pending', `Inventory lookup status: ${inventoryStatus}`);
  }
  const inventoryItemCount = asArray(inventoryLookup.items).length;
  if (inventoryItemCount > 0) {
    upsertRow('done', `Inventory matches: ${inventoryItemCount}`);
  }
  if (inventoryLookup.backfilled_sql === true) {
    upsertRow('done', 'Inventory SQL index backfilled');
  }

  const notebookLookup = meta.notebook_lookup && typeof meta.notebook_lookup === 'object'
    ? meta.notebook_lookup
    : {};
  const notebookStatus = trimText(notebookLookup.status, 40);
  if (notebookStatus) {
    upsertRow(notebookStatus === 'matched' ? 'done' : 'pending', `Notebook lookup status: ${notebookStatus}`);
  }
  const notebookItemCount = asArray(notebookLookup.items).length;
  if (notebookItemCount > 0) {
    upsertRow('done', `Notebook matches: ${notebookItemCount}`);
  }
  if (notebookLookup.backfilled_sql === true) {
    upsertRow('done', 'Notebook SQL index backfilled');
  }

  const purchaseRecommendation = meta.purchase_recommendation && typeof meta.purchase_recommendation === 'object'
    ? meta.purchase_recommendation
    : {};
  const purchaseStatus = trimText(purchaseRecommendation.status, 40);
  if (purchaseStatus) {
    upsertRow(purchaseStatus === 'matched' ? 'done' : 'pending', `Purchase recommendation status: ${purchaseStatus}`);
  }
  const purchaseItemCount = asArray(purchaseRecommendation.items).length;
  if (purchaseItemCount > 0) {
    upsertRow('done', `Purchase matches: ${purchaseItemCount}`);
  }

  const codexAgent = meta.codex_agent && typeof meta.codex_agent === 'object'
    ? meta.codex_agent
    : {};
  const codexAgentStatus = trimText(codexAgent.status, 40);
  if (codexAgentStatus) {
    upsertRow(codexAgentStatus === 'completed' ? 'done' : 'pending', `Codex agent status: ${codexAgentStatus}`);
  }
  const codexCitationCount = asArray(codexAgent.citations).length;
  if (codexCitationCount > 0) {
    upsertRow('done', `Codex agent citations: ${codexCitationCount}`);
  }

  [
    ['General science', meta.general_science_question],
    ['Project science', meta.project_science_question],
    ['Result analysis', meta.result_analysis]
  ].forEach(([label, payload]) => {
    const source = payload && typeof payload === 'object' ? payload : {};
    const status = trimText(source.status, 40);
    if (status) {
      upsertRow(status === 'completed' ? 'done' : 'pending', `${label} status: ${status}`);
    }
    const roundsExecuted = Number(source.rounds_executed) || 0;
    if (roundsExecuted > 0) {
      upsertRow('done', `${label} rounds: ${roundsExecuted}`);
    }
    const citationCount = asArray(source.citations).length;
    if (citationCount > 0) {
      upsertRow('done', `${label} citations: ${citationCount}`);
    }
  });

  return rows.slice(0, 20);
}

export {
  collectAgentActivityRows
};
