import { asArray, normalizeAgentUserQuestion, trimText } from './shared.js';

function activityStatusRank(status) {
  if (status === 'done') {
    return 3;
  }
  if (status === 'pending') {
    return 2;
  }
  return 1;
}

export function collectAgentActivityRows(meta) {
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

  const recordLookup = meta.record_lookup && typeof meta.record_lookup === 'object'
    ? meta.record_lookup
    : {};
  const recordStatus = trimText(recordLookup.status, 40);
  if (recordStatus) {
    upsertRow(recordStatus === 'matched' ? 'done' : 'pending', `Record lookup status: ${recordStatus}`);
  }
  const recordItemCount = asArray(recordLookup.items).length;
  if (recordItemCount > 0) {
    upsertRow('done', `Record matches: ${recordItemCount}`);
  }
  if (recordLookup.backfilled_sql === true) {
    upsertRow('done', 'Record SQL index backfilled');
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

  asArray(meta.developer_trace).forEach((trace) => {
    const stage = trimText(trace?.stage, 120);
    if (stage) {
      upsertRow('done', `Trace stage: ${stage}`);
    }
  });

  return rows.slice(0, 20);
}

export function summarizeInventoryLookup(lookup) {
  const payload = lookup && typeof lookup === 'object' ? lookup : {};
  const status = trimText(payload.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    const followUps = asArray(payload.follow_up_questions).map((item) => trimText(item, 280)).filter(Boolean);
    return followUps.join(' ') || 'I need more details to run inventory lookup.';
  }
  const query = trimText(payload.query, 220);
  const items = asArray(payload.items);
  if (status === 'matched' && items.length) {
    const previewLines = items
      .slice(0, 3)
      .map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const label = trimText(source.name || source.id, 140);
        if (!label) {
          return '';
        }
        const details = [
          trimText(source.location, 180) ? `location ${trimText(source.location, 180)}` : '',
          trimText(source.container_name, 180) ? `container ${trimText(source.container_name, 180)}` : '',
          Number.isFinite(Number(source.well_index)) ? `well ${Number(source.well_index)}` : '',
          trimText(source.quantity, 80)
            ? `${trimText(source.kind, 40) === 'personal_sample' ? 'concentration' : 'quantity'} ${trimText(source.quantity, 80)}`
            : '',
          trimText(source.amount, 80) ? `amount ${trimText(source.amount, 80)}` : '',
          trimText(source.supplier, 160) ? `supplier ${trimText(source.supplier, 160)}` : '',
          !trimText(source.location, 180) && trimText(source.zone, 120) ? `zone ${trimText(source.zone, 120)}` : ''
        ].filter(Boolean).slice(0, 4);
        return `${index + 1}. ${label}${details.length ? ` (${details.join('; ')})` : ''}`;
      })
      .filter(Boolean);
    const extraCount = Math.max(0, items.length - previewLines.length);
    return [
      `Found ${items.length} inventory match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}.`,
      ...previewLines,
      extraCount ? `${extraCount} more match${extraCount === 1 ? '' : 'es'} not shown.` : ''
    ].filter(Boolean).join('\n');
  }
  if (status === 'no_match') {
    return `No inventory matches found${query ? ` for "${query}"` : ''}.`;
  }
  return '';
}

export function summarizeRecordLookup(lookup) {
  const payload = lookup && typeof lookup === 'object' ? lookup : {};
  const status = trimText(payload.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    const followUps = asArray(payload.follow_up_questions).map((item) => trimText(item, 280)).filter(Boolean);
    return followUps.join(' ') || 'I need more details to run record lookup.';
  }
  const query = trimText(payload.query, 220);
  const items = asArray(payload.items);
  if (status === 'matched' && items.length) {
    const previewLines = items
      .slice(0, 3)
      .map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const label = trimText(source.title || source.id, 140);
        if (!label) {
          return '';
        }
        const recordType = trimText(source.record_type, 40).replace(/_/g, ' ');
        const details = [
          trimText(source.project_name, 180) ? `project ${trimText(source.project_name, 180)}` : '',
          trimText(source.linked_protocol_name, 180) ? `protocol ${trimText(source.linked_protocol_name, 180)}` : '',
          trimText(source.updated_at, 80) ? `updated ${trimText(source.updated_at, 80)}` : ''
        ].filter(Boolean).slice(0, 3);
        return `${index + 1}. ${recordType ? `${recordType}: ` : ''}${label}${details.length ? ` (${details.join('; ')})` : ''}`;
      })
      .filter(Boolean);
    const extraCount = Math.max(0, items.length - previewLines.length);
    return [
      `Found ${items.length} record match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}.`,
      ...previewLines,
      extraCount ? `${extraCount} more match${extraCount === 1 ? '' : 'es'} not shown.` : ''
    ].filter(Boolean).join('\n');
  }
  if (status === 'no_match') {
    return `No record matches found${query ? ` for "${query}"` : ''}.`;
  }
  return '';
}

export function summarizePurchaseRecommendation(purchaseRecommendation) {
  const payload = purchaseRecommendation && typeof purchaseRecommendation === 'object' ? purchaseRecommendation : {};
  const status = trimText(payload.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(payload.follow_up_questions).map((item) => trimText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can recommend something to buy.';
  }
  const query = trimText(payload.query, 220);
  const items = asArray(payload.items);
  const requiredTerms = asArray(payload?.filters?.required_terms).map((item) => trimText(item, 120)).filter(Boolean);
  const matchMode = trimText(payload.match_mode, 20);
  if (status === 'matched' && items.length) {
    if (matchMode === 'partial') {
      return `Found ${items.length} likely product match${items.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}, but I could not verify every requested attribute from the vendor pages.`;
    }
    return `Found ${items.length} purchase recommendation${items.length === 1 ? '' : 's'}${query ? ` for "${query}"` : ''}${requiredTerms.length ? ` matching ${requiredTerms.join(', ')}` : ''}.`;
  }
  if (status === 'no_match') {
    return `No purchase recommendations found${query ? ` for "${query}"` : ''}.`;
  }
  return '';
}

export function summarizeCodexAgent(codexAgent) {
  const payload = codexAgent && typeof codexAgent === 'object' ? codexAgent : {};
  const status = trimText(payload.status, 40);
  if (!status) {
    return '';
  }
  const explicitUserQuestion = payload.user_question || payload.userQuestion;
  const userQuestion = explicitUserQuestion
    ? normalizeAgentUserQuestion(explicitUserQuestion, '')
    : null;
  if (status === 'needs_more_info') {
    if (userQuestion?.question) {
      return userQuestion.question;
    }
    return asArray(payload.follow_up_questions).map((item) => trimText(item, 500)).filter(Boolean).join(' ')
      || trimText(payload.answer, 12000)
      || 'I need more detail before I can continue.';
  }
  return trimText(payload.answer || payload.assistant_text, 12000);
}

export function summarizeScienceResult(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const status = trimText(source.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(source.follow_up_questions).map((item) => trimText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can continue.';
  }
  const answer = trimText(source.answer, 12000);
  if (answer) {
    return answer;
  }
  const followUps = asArray(source.follow_up_questions).map((item) => trimText(item, 280)).filter(Boolean);
  return followUps.join(' ');
}

export function summarizeNotebookDraft(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const status = trimText(source.status, 40);
  if (!status) {
    return '';
  }
  if (status === 'needs_more_info') {
    return asArray(source.follow_up_questions).map((item) => trimText(item, 280)).filter(Boolean).join(' ')
      || 'I need more detail before I can plan the next notebook page.';
  }
  const proposal = source.proposal && typeof source.proposal === 'object' ? source.proposal : {};
  const title = trimText(proposal.title, 220);
  const purpose = trimText(proposal.purpose, 320);
  const protocolName = trimText(source?.selected_protocol?.name, 220);
  if (status === 'proposal_ready') {
    return title && purpose
      ? `Planned notebook draft ready: ${title}. ${purpose}`
      : `Planned notebook draft ready${protocolName ? ` using protocol ${protocolName}` : ''}.`;
  }
  return '';
}

function extractStructuredThinkingTrace(result) {
  const source = result && typeof result === 'object' ? result : {};
  const candidates = [
    source.thinking_trace,
    source.general_science_question?.thinking_trace,
    source.project_science_question?.thinking_trace,
    source.result_analysis?.thinking_trace
  ];
  return candidates.find((candidate) => (
    candidate
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
  )) || null;
}

export function normalizeAgentResponse(result) {
  const protocolWorkflow = result?.protocol_to_notebook && typeof result.protocol_to_notebook === 'object'
    ? result.protocol_to_notebook
    : null;
  const notebookDraftWorkflow = result?.notebook_draft && typeof result.notebook_draft === 'object'
    ? result.notebook_draft
    : null;
  const notebookPayload = protocolWorkflow?.notebook && typeof protocolWorkflow.notebook === 'object'
    ? protocolWorkflow.notebook
    : result?.notebookDraft;
  const parser = result?.parser && typeof result.parser === 'object' ? result.parser : {};
  const protocolStatus = trimText(protocolWorkflow?.status, 40);
  const followUpQuestions = asArray(protocolWorkflow?.follow_up_questions).map((item) => trimText(item, 320)).filter(Boolean);
  const completedNotebookText = trimText(
    protocolWorkflow?.notebook?.entry_template?.result
      || protocolWorkflow?.notebook?.save?.reason
      || '',
    12000
  );
  const inventoryLookup = result?.inventory_lookup && typeof result.inventory_lookup === 'object'
    ? result.inventory_lookup
    : null;
  const recordLookup = result?.record_lookup && typeof result.record_lookup === 'object'
    ? result.record_lookup
    : null;
  const purchaseRecommendation = result?.purchase_recommendation && typeof result.purchase_recommendation === 'object'
    ? result.purchase_recommendation
    : null;
  const codexAgent = result?.codex_agent && typeof result.codex_agent === 'object'
    ? result.codex_agent
    : null;
  const explicitUserQuestion = result?.user_question
    || result?.userQuestion
    || codexAgent?.user_question
    || codexAgent?.userQuestion;
  const codexStatus = trimText(codexAgent?.status, 40);
  const keepUserQuestion = Boolean(
    explicitUserQuestion
    && (
      codexStatus === 'needs_more_info'
      || codexStatus === 'needs_user_answer'
      || (!codexAgent && parser?.needs_clarification === true)
    )
  );
  const userQuestion = keepUserQuestion
    ? normalizeAgentUserQuestion(explicitUserQuestion, '')
    : null;
  const generalScienceQuestion = result?.general_science_question && typeof result.general_science_question === 'object'
    ? result.general_science_question
    : null;
  const projectScienceQuestion = result?.project_science_question && typeof result.project_science_question === 'object'
    ? result.project_science_question
    : null;
  const resultAnalysis = result?.result_analysis && typeof result.result_analysis === 'object'
    ? result.result_analysis
    : null;
  const inventorySummaryText = summarizeInventoryLookup(inventoryLookup);
  const recordSummaryText = summarizeRecordLookup(recordLookup);
  const purchaseRecommendationText = summarizePurchaseRecommendation(purchaseRecommendation);
  const codexAgentText = summarizeCodexAgent(codexAgent);
  const notebookDraftText = summarizeNotebookDraft(notebookDraftWorkflow);
  const scienceAnswerText = summarizeScienceResult(generalScienceQuestion)
    || summarizeScienceResult(projectScienceQuestion)
    || summarizeScienceResult(resultAnalysis);
  const assistantText = notebookDraftText
    || codexAgentText
    || (protocolStatus === 'completed'
      ? (completedNotebookText
        || `Notebook draft completed using protocol ${trimText(protocolWorkflow?.selected_protocol?.name, 220) || 'selection'}.`)
      : (protocolStatus === 'needs_more_info'
      ? (followUpQuestions.join(' ') || 'More details are needed to fill the remaining notebook placeholders.')
      : (scienceAnswerText
          || purchaseRecommendationText
          || inventorySummaryText
          || recordSummaryText
          || trimText(parser.reasoning_summary, 12000)
          || 'Intent parsing completed.')));

  return {
    parser,
    protocolWorkflow,
    notebookDraftWorkflow,
    notebookPayload,
    purchaseRecommendation,
    codexAgent,
    userQuestion,
    inventoryLookup,
    recordLookup,
    generalScienceQuestion,
    projectScienceQuestion,
    resultAnalysis,
    thinkingTrace: extractStructuredThinkingTrace(result),
    developerTrace: asArray(result?.developer_trace),
    assistantText
  };
}
