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

function renderThinkingTrace(title, rows, safeText) {
  if (!rows.length) {
    return '';
  }
  return `
    <section class="agent-thinking-trace" aria-label="${safeText(title)}">
      <h4>${safeText(title)}</h4>
      <ul class="agent-thinking-trace-list">
        ${rows.map((row) => `<li class="agent-thinking-trace-item">${safeText(row)}</li>`).join('')}
      </ul>
    </section>
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
  const thinkingRows = asArray(progress?.thinking_rows).map((row) => trimText(row?.text || row, 420)).filter(Boolean);
  if (!thinkingRows.length) {
    return '';
  }
  return `
    <div class="agent-meta-grid agent-meta-grid-streamlined">
      ${renderThinkingTrace('Thinking Trace', thinkingRows, safeText)}
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
    if (!pythonSandboxRuns.length) {
      return '';
    }
    return `
      <div class="agent-meta-grid agent-meta-grid-streamlined">
        ${renderPythonSandboxRuns(pythonSandboxRuns, safeText)}
      </div>
    `;
  }
  const notebookDraft = normalizeNotebookDraft(meta.notebookDraft);
  const notebookDraftProposalId = resolveNotebookDraftProposalId(notebookDraft);
  const existingPlannedEntry = notebookDraftProposalId
    ? findNotebookEntryByProposalId(state.notebookEntries, notebookDraftProposalId)
    : null;
  const showCreatePlannedPageButton = Boolean(
    notebookDraft
    && notebookDraft?.save?.mode === 'confirm_before_save'
    && trimText(messageId, 120)
  );
  const plannedPageButtonDisabled = Boolean(
    existingPlannedEntry
    || notebookDraft?.save?.applied === true
    || ['planned_page_created', 'already_created'].includes(trimText(notebookDraft?.save?.status, 120))
  );
  const plannedPageButtonLabel = plannedPageButtonDisabled ? 'Planned Page Created' : 'Create Planned Page';
  const hasPurchaseRecommendation = meta.purchase_recommendation && typeof meta.purchase_recommendation === 'object';
  const purchaseRecommendation = hasPurchaseRecommendation
    ? meta.purchase_recommendation
    : {};
  const generalScience = meta.general_science_question && typeof meta.general_science_question === 'object'
    ? meta.general_science_question
    : {};
  const projectScience = meta.project_science_question && typeof meta.project_science_question === 'object'
    ? meta.project_science_question
    : {};
  const resultAnalysis = meta.result_analysis && typeof meta.result_analysis === 'object'
    ? meta.result_analysis
    : {};
  const pythonSandboxRuns = collectPythonSandboxRuns(meta);
  const scienceThinkingRows = [
    buildScienceThinkingTraceRows(generalScience),
    buildScienceThinkingTraceRows(projectScience),
    buildScienceThinkingTraceRows(resultAnalysis)
  ].find((rows) => rows.length) || [];
  const sections = [
    hasPurchaseRecommendation ? renderPurchaseRecommendationCards(purchaseRecommendation, safeText) : '',
    renderPythonSandboxRuns(pythonSandboxRuns, safeText),
    scienceThinkingRows.length ? renderThinkingTrace('Thinking Trace', scienceThinkingRows, safeText) : '',
    showCreatePlannedPageButton ? `
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
    ` : ''
  ].filter(Boolean);
  if (!sections.length) {
    return '';
  }
  return `
    <div class="agent-meta-grid agent-meta-grid-streamlined">
      ${sections.join('')}
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
