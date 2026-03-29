import { collectAgentActivityRows } from './response.js';
import {
  asArray,
  trimText
} from './shared.js';
import {
  findNotebookEntryByProposalId,
  normalizeNotebookDraft,
  resolveNotebookDraftProposalId
} from './notebook-drafts.js';

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

function renderMetaList(title, rows, safeText) {
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

function renderMetaJson(title, value, safeText) {
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

function renderAssistantMeta(meta, messageId = '', { state, safeText }) {
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
          ? renderMetaList('Input Message', [trimText(toolTest.request_message || primaryItem.request_message, 6000)], safeText)
          : ''}
        ${primaryItem && trimText(primaryItem.result_message, 6000)
          ? renderMetaList('Result Message', [trimText(primaryItem.result_message, 6000)], safeText)
          : ''}
        ${renderMetaList('Tool Details', detailRows, safeText)}
        ${primaryItem ? renderMetaJson('Raw Result', primaryItem.raw_result, safeText) : ''}
        ${failureRows.length ? renderMetaList('Failures', failureRows, safeText) : ''}
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
  const notebookDraftWorkflow = meta.notebook_draft && typeof meta.notebook_draft === 'object'
    ? meta.notebook_draft
    : {};
  const notebookDraft = normalizeNotebookDraft(meta.notebookDraft);
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
  const notebookDraftRows = [
    trimText(notebookDraftWorkflow.status, 60)
      ? `status: ${trimText(notebookDraftWorkflow.status, 60)}`
      : '',
    trimText(notebookDraftWorkflow.project_name, 220)
      ? `project_name: ${trimText(notebookDraftWorkflow.project_name, 220)}`
      : '',
    trimText(notebookDraftWorkflow?.selected_protocol?.name, 220)
      ? `selected_protocol: ${trimText(notebookDraftWorkflow.selected_protocol.name, 220)}`
      : '',
    trimText(notebookDraftWorkflow?.source_workflow?.name, 220)
      ? `workflow: ${trimText(notebookDraftWorkflow.source_workflow.name, 220)}`
      : '',
    trimText(notebookDraft?.save?.status, 120)
      ? `save_status: ${trimText(notebookDraft.save.status, 120)}`
      : ''
  ].filter(Boolean);
  const notebookDraftProposalRows = [
    trimText(notebookDraft?.proposal?.title, 220)
      ? `title: ${trimText(notebookDraft.proposal.title, 220)}`
      : '',
    trimText(notebookDraft?.proposal?.purpose, 260)
      ? `purpose: ${trimText(notebookDraft.proposal.purpose, 260)}`
      : '',
    trimText(notebookDraft?.proposal?.rationale, 260)
      ? `rationale: ${trimText(notebookDraft.proposal.rationale, 260)}`
      : '',
    trimText(notebookDraft?.proposal?.proposal_id, 180)
      ? `proposal_id: ${trimText(notebookDraft.proposal.proposal_id, 180)}`
      : ''
  ].filter(Boolean);
  const notebookDraftMaterialRows = asArray(notebookDraft?.proposal?.planned_materials).map((item) => trimText(item, 220)).filter(Boolean);
  const notebookDraftCheckpointRows = asArray(notebookDraft?.proposal?.checkpoints).map((item) => trimText(item, 220)).filter(Boolean);
  const notebookDraftMissingRows = asArray(notebookDraftWorkflow.missing_placeholders).map((item, index) => {
    const display = trimText(item?.display, 120) || trimText(item?.placeholder_key, 160);
    const reason = trimText(item?.reason, 220);
    if (!display) {
      return '';
    }
    return `missing_${index + 1}: ${display}${reason ? ` (${reason})` : ''}`;
  }).filter(Boolean);
  const notebookDraftFollowUpRows = asArray(notebookDraftWorkflow.follow_up_questions).map((question) => trimText(question, 260)).filter(Boolean);
  const notebookDraftProposalId = resolveNotebookDraftProposalId(notebookDraft);
  const existingPlannedEntry = notebookDraftProposalId
    ? findNotebookEntryByProposalId(state.notebookEntries, notebookDraftProposalId)
    : null;
  const showCreatePlannedPageButton = Boolean(
    notebookDraft
    && notebookDraft.save.mode === 'confirm_before_save'
    && trimText(messageId, 120)
  );
  const plannedPageButtonDisabled = Boolean(
    existingPlannedEntry
    || notebookDraft?.save?.applied === true
    || ['planned_page_created', 'already_created'].includes(trimText(notebookDraft?.save?.status, 120))
  );
  const plannedPageButtonLabel = plannedPageButtonDisabled ? 'Planned Page Created' : 'Create Planned Page';
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
      ${renderMetaList('Intent Parser', parserRows, safeText)}
      ${renderMetaList('Protocol Candidates', protocolCandidateRows, safeText)}
      ${renderMetaList('Entities', parserEntityRows, safeText)}
      ${renderMetaList('Inventory Search', inventorySearchRows, safeText)}
      ${renderMetaList('Protocol Workflow', protocolRows, safeText)}
      ${renderMetaList('Protocol Matches', protocolCandidateMatchRows, safeText)}
      ${renderMetaList('Missing Placeholders', protocolMissingRows, safeText)}
      ${renderMetaList('Follow-up Questions', protocolFollowUpRows, safeText)}
      ${notebookDraftRows.length ? renderMetaList('Planned Notebook Draft', notebookDraftRows, safeText) : ''}
      ${notebookDraftProposalRows.length ? renderMetaList('Draft Proposal', notebookDraftProposalRows, safeText) : ''}
      ${notebookDraftMaterialRows.length ? renderMetaList('Planned Materials', notebookDraftMaterialRows, safeText) : ''}
      ${notebookDraftCheckpointRows.length ? renderMetaList('Checkpoints', notebookDraftCheckpointRows, safeText) : ''}
      ${notebookDraftMissingRows.length ? renderMetaList('Draft Missing Placeholders', notebookDraftMissingRows, safeText) : ''}
      ${notebookDraftFollowUpRows.length ? renderMetaList('Draft Follow-up', notebookDraftFollowUpRows, safeText) : ''}
      ${showCreatePlannedPageButton ? `
        <section class="agent-draft-actions">
          <button
            type="button"
            class="primary-btn"
            data-agent-create-planned-page="${safeText(trimText(messageId, 120))}"
            ${plannedPageButtonDisabled ? 'disabled' : ''}
          >
            ${safeText(plannedPageButtonLabel)}
          </button>
        </section>
      ` : ''}
      ${hasInventoryLookup ? renderMetaList('Inventory Lookup', inventoryRows, safeText) : ''}
      ${hasInventoryLookup ? renderMetaList('Inventory Items', inventoryItemRows, safeText) : ''}
      ${hasInventoryLookup ? renderMetaList('Inventory Follow-up', inventoryFollowUpRows, safeText) : ''}
      ${hasRecordLookup ? renderMetaList('Record Lookup', recordRows, safeText) : ''}
      ${hasRecordLookup ? renderMetaList('Record Items', recordItemRows, safeText) : ''}
      ${hasRecordLookup ? renderMetaList('Record Follow-up', recordFollowUpRows, safeText) : ''}
      ${generalScienceRows.length ? renderMetaList('General Science', generalScienceRows, safeText) : ''}
      ${generalScienceCitationRows.length ? renderMetaList('General Science Citations', generalScienceCitationRows, safeText) : ''}
      ${generalScienceFollowUps.length ? renderMetaList('General Science Follow-up', generalScienceFollowUps, safeText) : ''}
      ${projectScienceRows.length ? renderMetaList('Project Science', projectScienceRows, safeText) : ''}
      ${projectScienceCitationRows.length ? renderMetaList('Project Science Citations', projectScienceCitationRows, safeText) : ''}
      ${projectScienceFollowUps.length ? renderMetaList('Project Science Follow-up', projectScienceFollowUps, safeText) : ''}
      ${resultAnalysisRows.length ? renderMetaList('Result Analysis', resultAnalysisRows, safeText) : ''}
      ${resultAnalysisCitationRows.length ? renderMetaList('Result Analysis Citations', resultAnalysisCitationRows, safeText) : ''}
      ${resultAnalysisFollowUps.length ? renderMetaList('Result Analysis Follow-up', resultAnalysisFollowUps, safeText) : ''}
      ${renderMetaList('Reasoning Summary', reasoningSummaryRows, safeText)}
      ${showDeveloperTrace ? renderMetaList('Developer Trace', developerTraceRows, safeText) : ''}
    </div>
  `;
}

export function renderHistory({ historyNode, messages, state, safeText }) {
  const safeMessages = asArray(messages);
  if (!safeMessages.length) {
    historyNode.innerHTML = '<p class="small-note">Start by asking the agent a lab question.</p>';
    return;
  }

  historyNode.innerHTML = safeMessages.map((message) => {
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
          ${role === 'assistant' ? renderAssistantMeta(message.meta, message.id, { state, safeText }) : ''}
        </article>
      </div>
    `;
  }).join('');

  historyNode.scrollTop = historyNode.scrollHeight;
}
