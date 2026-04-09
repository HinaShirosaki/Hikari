import { collectAgentActivityRows } from './response.js';
import { renderMarkdown } from './markdown.js';
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

function collectRenderablePythonSandboxOutput(source) {
  const payload = source && typeof source === 'object' ? source : {};
  const outputs = asArray(payload.render_outputs).map((entry) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    const type = trimText(item.type, 40).toLowerCase();
    if (type === 'text') {
      const content = trimText(item.content, 24000);
      if (!content) {
        return null;
      }
      return {
        type: 'text',
        title: trimText(item.title, 160),
        format: trimText(item.format, 80).toLowerCase() || 'text/plain',
        content
      };
    }
    if (type === 'image') {
      const dataBase64 = String(item.data_base64 || '').replace(/\s+/g, '');
      if (!dataBase64) {
        return null;
      }
      return {
        type: 'image',
        title: trimText(item.title, 160),
        alt: trimText(item.alt, 200) || trimText(item.title, 160) || 'Python sandbox image output',
        mime_type: trimText(item.mime_type, 120).toLowerCase() || 'image/png',
        data_base64: dataBase64,
        path: trimText(item.path, 240)
      };
    }
    return null;
  }).filter(Boolean);

  const stdout = trimText(payload.stdout, 12000);
  const stderr = trimText(payload.stderr, 12000);
  const error = trimText(payload.error, 1200);
  if (!outputs.some((item) => item.type === 'text') && stdout) {
    outputs.unshift({
      type: 'text',
      title: 'stdout',
      format: 'text/plain',
      content: stdout
    });
  } else if (!outputs.length && !stdout && stderr) {
    outputs.push({
      type: 'text',
      title: 'stderr',
      format: 'text/plain',
      content: stderr
    });
  }

  return {
    status: trimText(payload.status, 40),
    runId: trimText(payload.run_id, 120),
    error,
    stdout,
    stderr,
    outputs
  };
}

function collectPythonSandboxRuns(meta) {
  if (!meta || typeof meta !== 'object') {
    return [];
  }
  const runs = [];
  const pushRun = (label, payload) => {
    const normalized = collectRenderablePythonSandboxOutput(payload);
    if (!normalized.outputs.length && !normalized.error && !normalized.stdout && !normalized.stderr) {
      return;
    }
    runs.push({
      label: trimText(label, 160) || 'Python sandbox',
      ...normalized
    });
  };

  const scienceSections = [
    ['General science', meta.general_science_question],
    ['Project science', meta.project_science_question],
    ['Result analysis', meta.result_analysis]
  ];
  scienceSections.forEach(([label, payload]) => {
    asArray(payload?.tool_trace).forEach((entry, index) => {
      if (trimText(entry?.tool_name, 120) !== 'python-sandbox') {
        return;
      }
      const round = Number.isFinite(Number(entry?.round)) ? `Round ${Number(entry.round)}` : `Run ${index + 1}`;
      pushRun(`${label}: ${round}`, entry);
    });
  });

  return runs.slice(0, 6);
}

function formatPythonTextOutput(output) {
  if (trimText(output?.format, 80).toLowerCase() !== 'application/json') {
    return trimText(output?.content, 24000);
  }
  try {
    return trimText(JSON.stringify(JSON.parse(String(output?.content || '')), null, 2), 24000);
  } catch {
    return trimText(output?.content, 24000);
  }
}

function renderPythonOutputCard(output, safeText) {
  if (!output || typeof output !== 'object') {
    return '';
  }
  if (output.type === 'image') {
    const dataUri = `data:${trimText(output.mime_type, 120) || 'image/png'};base64,${String(output.data_base64 || '')}`;
    const meta = [trimText(output.mime_type, 120), trimText(output.path, 160)].filter(Boolean).join(' | ');
    return `
      <article class="agent-python-output-card agent-python-output-card-image">
        <header class="agent-python-output-header">
          <strong>${safeText(trimText(output.title, 160) || 'Image output')}</strong>
          ${meta ? `<span>${safeText(meta)}</span>` : ''}
        </header>
        <img
          class="agent-python-output-image"
          src="${safeText(dataUri)}"
          alt="${safeText(trimText(output.alt, 200) || 'Python sandbox image output')}"
        />
      </article>
    `;
  }

  const format = trimText(output.format, 80).toLowerCase() || 'text/plain';
  const body = format === 'text/markdown'
    ? `<div class="agent-chat-markdown agent-python-output-markdown">${renderMarkdown(output.content, safeText)}</div>`
    : `<pre class="agent-python-output-pre">${safeText(formatPythonTextOutput(output))}</pre>`;
  return `
    <article class="agent-python-output-card">
      <header class="agent-python-output-header">
        <strong>${safeText(trimText(output.title, 160) || 'Text output')}</strong>
        <span>${safeText(format)}</span>
      </header>
      ${body}
    </article>
  `;
}

function renderPythonSandboxRuns(runs, safeText) {
  const visibleRuns = asArray(runs).filter((run) => run && typeof run === 'object');
  if (!visibleRuns.length) {
    return '';
  }
  return `
    <section class="agent-python-output-group" aria-label="Python sandbox outputs">
      <h4>Python Sandbox Output</h4>
      ${visibleRuns.map((run) => {
        const summary = [
          trimText(run.label, 160),
          trimText(run.status, 40) ? `status=${trimText(run.status, 40)}` : '',
          trimText(run.runId, 120) ? `run=${trimText(run.runId, 120)}` : ''
        ].filter(Boolean).join(' | ');
        const shouldShowStdoutDetails = trimText(run.stdout, 12000)
          && !asArray(run.outputs).some((output) => trimText(output?.title, 80).toLowerCase() === 'stdout');
        const shouldShowStderrDetails = trimText(run.stderr, 12000)
          && !asArray(run.outputs).some((output) => trimText(output?.title, 80).toLowerCase() === 'stderr');
        return `
          <div class="agent-python-output-run">
            ${summary ? `<p class="small-note">${safeText(summary)}</p>` : ''}
            <div class="agent-python-output-grid">
              ${asArray(run.outputs).map((output) => renderPythonOutputCard(output, safeText)).join('')}
            </div>
            ${trimText(run.error, 1200) ? `
              <details>
                <summary>Error</summary>
                <pre class="agent-meta-json">${safeText(trimText(run.error, 1200))}</pre>
              </details>
            ` : ''}
            ${shouldShowStdoutDetails ? `
              <details>
                <summary>stdout</summary>
                <pre class="agent-meta-json">${safeText(trimText(run.stdout, 12000))}</pre>
              </details>
            ` : ''}
            ${shouldShowStderrDetails ? `
              <details>
                <summary>stderr</summary>
                <pre class="agent-meta-json">${safeText(trimText(run.stderr, 12000))}</pre>
              </details>
            ` : ''}
          </div>
        `;
      }).join('')}
    </section>
  `;
}

function renderPurchaseRecommendationCards(purchaseRecommendation, safeText) {
  const payload = purchaseRecommendation && typeof purchaseRecommendation === 'object' ? purchaseRecommendation : {};
  const items = asArray(payload.items).filter((item) => (
    trimText(item?.title, 320)
    && trimText(item?.vendor, 220)
    && trimText(item?.price_text, 120)
    && trimText(item?.image_url, 2000)
    && trimText(item?.product_url, 2000)
  ));
  if (!items.length) {
    return '';
  }
  return `
    <section class="agent-purchase-group" aria-label="Purchase recommendations">
      <div class="agent-purchase-grid">
        ${items.map((item) => `
          <button
            type="button"
            class="agent-purchase-item"
            data-agent-open-external-url="${safeText(trimText(item.product_url, 2000))}"
            aria-label="${safeText(`Open ${trimText(item.title, 220)} from ${trimText(item.vendor, 180)}`)}"
          >
            <span class="agent-purchase-image-wrap">
              <img
                class="agent-purchase-image"
                src="${safeText(trimText(item.image_url, 2000))}"
                alt="${safeText(trimText(item.title, 220))}"
              />
            </span>
            <span class="agent-purchase-copy">
              <strong class="agent-purchase-title">${safeText(trimText(item.title, 220))}</strong>
              <span class="agent-purchase-price">${safeText(trimText(item.price_text, 120))}</span>
              <span class="agent-purchase-vendor">${safeText(trimText(item.vendor, 180))}</span>
            </span>
          </button>
        `).join('')}
      </div>
    </section>
  `;
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

function buildScienceThinkingTraceRows(payload) {
  const trace = payload?.thinking_trace && typeof payload.thinking_trace === 'object'
    ? payload.thinking_trace
    : null;
  if (!trace) {
    return [];
  }
  const rows = [
    trimText(trace.intent_parse_question, 420)
      ? `Intent parse: ${trimText(trace.intent_parse_question, 420)}`
      : '',
    trimText(trace.question_clarifier, 420)
      ? `Clarify: ${trimText(trace.question_clarifier, 420)}`
      : '',
    trimText(trace.criteria_generate, 420)
      ? `Criteria: ${trimText(trace.criteria_generate, 420)}`
      : ''
  ].filter(Boolean);
  asArray(trace.tool_rounds).slice(0, 8).forEach((round, index) => {
    const roundNumber = Math.max(1, Number(round?.round) || index + 1);
    const toolSelection = trimText(round?.tool_selection, 420);
    const toolCall = trimText(round?.tool_call, 420);
    const toolResults = trimText(round?.tool_results, 420);
    if (toolSelection) {
      rows.push(`Round ${roundNumber} selection: ${toolSelection}`);
    }
    if (toolCall) {
      rows.push(`Round ${roundNumber} call: ${toolCall}`);
    }
    if (toolResults) {
      rows.push(`Round ${roundNumber} results: ${toolResults}`);
    }
  });
  [
    ['Pre-synthesis', trace.pre_synthesize_answer],
    ['Judge', trace.judge],
    ['Final synthesis', trace.final_synthesize],
    ['Answered question', trace.final_synthesized_question]
  ].forEach(([label, value]) => {
    const clean = trimText(value, 420);
    if (clean) {
      rows.push(`${label}: ${clean}`);
    }
  });
  return rows.slice(0, 32);
}

function renderLiveProgressMeta(progress, safeText) {
  const activityRows = asArray(progress?.activity_rows).map((row) => ({
    status: trimText(row?.status, 40) || 'pending',
    text: trimText(row?.text, 260)
  })).filter((row) => row.text);
  const thinkingRows = asArray(progress?.thinking_rows).map((row) => trimText(row?.text || row, 420)).filter(Boolean);
  const summaryLine = [
    trimText(progress?.routing_intent, 80) ? `Intent=${trimText(progress.routing_intent, 80)}` : '',
    trimText(progress?.stage, 80) ? `Stage=${trimText(progress.stage, 80)}` : '',
    trimText(progress?.request_id, 120) ? `Request=${trimText(progress.request_id, 120)}` : ''
  ].filter(Boolean).join(' | ');

  return `
    <div class="agent-meta-grid">
      ${thinkingRows.length ? `
        <section class="agent-activity" aria-label="Live thinking trace">
          <h4>Thinking</h4>
          <ul class="agent-activity-list">
            ${thinkingRows.map((row) => `
              <li class="agent-activity-item">
                <span>${safeText(row)}</span>
              </li>
            `).join('')}
          </ul>
        </section>
      ` : ''}
      ${activityRows.length ? `
        <section class="agent-activity" aria-label="Live agent activity">
          <h4>Working</h4>
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
      ${summaryLine ? `<p class="small-note">${safeText(summaryLine)}</p>` : ''}
    </div>
  `;
}

function renderAssistantMeta(meta, messageId = '', { state, safeText }) {
  if (!meta || typeof meta !== 'object') {
    return '';
  }
  const liveProgress = meta.live_progress && typeof meta.live_progress === 'object'
    ? meta.live_progress
    : null;
  if (liveProgress) {
    return renderLiveProgressMeta(liveProgress, safeText);
  }
  const toolTest = meta.tool_test && typeof meta.tool_test === 'object'
    ? meta.tool_test
    : null;
  if (toolTest) {
    const toolItems = asArray(toolTest.items);
    const runMode = trimText(toolTest.run_mode, 40) || (toolItems.length === 1 ? 'single' : 'all');
    const primaryItem = runMode === 'single' ? (toolItems[0] && typeof toolItems[0] === 'object' ? toolItems[0] : null) : null;
    const pythonSandboxRuns = primaryItem && trimText(primaryItem.tool_name, 120) === 'python-sandbox'
      ? [{
        label: 'Manual tool test',
        ...collectRenderablePythonSandboxOutput(primaryItem.raw_result)
      }]
      : [];
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
        ${renderPythonSandboxRuns(pythonSandboxRuns, safeText)}
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
  const hasPurchaseRecommendation = meta.purchase_recommendation && typeof meta.purchase_recommendation === 'object';
  const purchaseRecommendation = hasPurchaseRecommendation
    ? meta.purchase_recommendation
    : {};
  const purchaseRecommendationRows = [
    trimText(purchaseRecommendation.status, 40)
      ? `status: ${trimText(purchaseRecommendation.status, 40)}`
      : '',
    trimText(purchaseRecommendation.query, 240)
      ? `query: ${trimText(purchaseRecommendation.query, 240)}`
      : '',
    trimText(purchaseRecommendation.source, 80)
      ? `source: ${trimText(purchaseRecommendation.source, 80)}`
      : '',
    trimText(purchaseRecommendation?.filters?.budget_preference, 80)
      ? `budget_preference: ${trimText(purchaseRecommendation.filters.budget_preference, 80)}`
      : '',
    `item_count: ${asArray(purchaseRecommendation.items).length}`
  ].filter(Boolean);
  const purchaseFilterRows = [
    ...asArray(purchaseRecommendation?.filters?.required_terms).map((term, index) => {
      const clean = trimText(term, 120);
      return clean ? `required_${index + 1}: ${clean}` : '';
    }),
    ...asArray(purchaseRecommendation?.filters?.excluded_terms).map((term, index) => {
      const clean = trimText(term, 120);
      return clean ? `excluded_${index + 1}: ${clean}` : '';
    })
  ].filter(Boolean);
  const purchaseFollowUpRows = asArray(purchaseRecommendation.follow_up_questions).map((question) => trimText(question, 260)).filter(Boolean);
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
  const pythonSandboxRuns = collectPythonSandboxRuns(meta);
  const scienceThinkingRows = [
    buildScienceThinkingTraceRows(generalScience),
    buildScienceThinkingTraceRows(projectScience),
    buildScienceThinkingTraceRows(resultAnalysis)
  ].find((rows) => rows.length) || [];
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
      ${renderPurchaseRecommendationCards(purchaseRecommendation, safeText)}
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
      ${hasPurchaseRecommendation ? renderMetaList('Purchase Recommendation', purchaseRecommendationRows, safeText) : ''}
      ${hasPurchaseRecommendation ? renderMetaList('Purchase Filters', purchaseFilterRows, safeText) : ''}
      ${hasPurchaseRecommendation ? renderMetaList('Purchase Follow-up', purchaseFollowUpRows, safeText) : ''}
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
      ${renderPythonSandboxRuns(pythonSandboxRuns, safeText)}
      ${scienceThinkingRows.length ? renderMetaList('Thinking Trace', scienceThinkingRows, safeText) : ''}
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
    const messageBody = role === 'assistant'
      ? `<div class="agent-chat-body agent-chat-markdown">${renderMarkdown(message.text || '', safeText)}</div>`
      : `<p class="agent-chat-body agent-chat-body-plain">${safeText(message.text || '')}</p>`;
    return `
      <div class="agent-chat-row ${rowClass}">
        <article class="agent-chat-item ${cardClass}">
          <header class="agent-chat-header">
            <strong>${headerLabel}</strong>
            <span>${safeText(formatTime(message.createdAt))}</span>
          </header>
          ${messageBody}
          ${role === 'assistant' ? renderAssistantMeta(message.meta, message.id, { state, safeText }) : ''}
        </article>
      </div>
    `;
  }).join('');

  historyNode.scrollTop = historyNode.scrollHeight;
}
