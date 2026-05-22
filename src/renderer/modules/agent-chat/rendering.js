import { renderMarkdown } from './markdown.js';
import {
  asArray,
  normalizeAgentUserQuestion,
  trimText
} from './shared.js';
import {
  findNotebookEntryForDraft,
  normalizeNotebookDraft,
  normalizeNotebookState
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

function renderCollapsibleThinkingTrace(title, rows, safeText, { open = false } = {}) {
  if (!rows.length) {
    return '';
  }
  return `
    <details
      class="agent-thinking-trace"
      ${open ? 'open ' : ''}
      data-agent-generated-trace="true"
      data-agent-trace-open="${open ? 'true' : 'false'}"
      aria-label="${safeText(title)}"
    >
      <summary class="agent-thinking-trace-summary">${safeText(title)}</summary>
      <ul class="agent-thinking-trace-list">
        ${rows.map((row) => `<li class="agent-thinking-trace-item">${safeText(row)}</li>`).join('')}
      </ul>
    </details>
  `;
}

function renderLiveGeneratedTrace(rows, safeText) {
  if (!rows.length) {
    return '';
  }
  return `
    <div class="agent-thinking-trace agent-generated-trace-live" aria-label="Agent Trace">
      <ul class="agent-thinking-trace-list">
        ${rows.map((row) => `<li class="agent-thinking-trace-item">${safeText(row)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function normalizeTraceComparableText(value = '') {
  return trimText(value, 2000)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isInternalCodexPromptText(value = '') {
  return /^#\s*Hikari Codex Chat Turn\b/u.test(trimText(value, 200));
}

function filterGeneratedTraceRows(rows = [], finalText = '') {
  const seen = new Set();
  const finalKey = normalizeTraceComparableText(finalText);
  return asArray(rows)
    .map((row) => trimText(row, 1200))
    .filter((row) => {
      if (!row || isInternalCodexPromptText(row)) {
        return false;
      }
      const key = normalizeTraceComparableText(row);
      if (!key || key === finalKey || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeThinkingTraceRows(rows) {
  const seen = new Set();
  return asArray(rows)
    .map((row) => trimText(row?.text || row, 420))
    .filter((row) => {
      if (!row) {
        return false;
      }
      const key = row.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 32);
}

function normalizeActivityTraceRows(rows) {
  const seen = new Set();
  return asArray(rows)
    .map((row) => {
      const source = row && typeof row === 'object' ? row : { text: row };
      const text = trimText(source.text, 420);
      if (!text) {
        return '';
      }
      const routingIntent = trimText(source.routing_intent || source.routingIntent, 120);
      if (routingIntent && routingIntent !== 'codex_agent') {
        return '';
      }
      const stage = trimText(source.stage, 80);
      if (stage && ![
        'codex_agent_started',
        'codex_agent_completed',
        'tool_call_started',
        'tool_call_completed',
        'tool_call_failed'
      ].includes(stage)) {
        return '';
      }
      if (text === 'Request received') {
        return '';
      }
      const status = trimText(source.status, 40).toLowerCase();
      if (status === 'failed') {
        return `Failed: ${text}`;
      }
      if (status === 'completed' || status === 'done') {
        return `Done: ${text}`;
      }
      return text;
    })
    .filter((row) => {
      if (!row) {
        return false;
      }
      const key = row.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 32);
}

function normalizeCodexCliDisplayRows(rows) {
  const seen = new Set();
  return asArray(rows)
    .map((row) => {
      const source = row && typeof row === 'object' ? row : { text: row };
      const text = trimText(
        source.text
          || source.display_text
          || source.displayText
          || source.message,
        1200
      );
      if (!text) {
        return '';
      }
      const routingIntent = trimText(source.routing_intent || source.routingIntent, 120);
      if (routingIntent && routingIntent !== 'codex_agent') {
        return '';
      }
      return text;
    })
    .filter((row) => {
      if (!row) {
        return false;
      }
      const key = row.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(-80);
}

function buildStructuredThinkingTraceRows(trace) {
  const source = trace && typeof trace === 'object'
    ? trace
    : null;
  if (!source) {
    return [];
  }
  const rows = [
    trimText(source.intent_parse_question, 420)
      ? `Intent parse: ${trimText(source.intent_parse_question, 420)}`
      : '',
    trimText(source.question_clarifier, 420)
      ? `Clarify: ${trimText(source.question_clarifier, 420)}`
      : '',
    trimText(source.criteria_generate, 420)
      ? `Criteria: ${trimText(source.criteria_generate, 420)}`
      : ''
  ].filter(Boolean);
  asArray(source.tool_rounds).slice(0, 8).forEach((round, index) => {
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
    ['Pre-synthesis', source.pre_synthesize_answer],
    ['Judge', source.judge],
    ['Final synthesis', source.final_synthesize],
    ['Answered question', source.final_synthesized_question]
  ].forEach(([label, value]) => {
    const clean = trimText(value, 420);
    if (clean) {
      rows.push(`${label}: ${clean}`);
    }
  });
  return rows.slice(0, 32);
}

function collectAssistantThinkingTraceRows(meta) {
  if (!meta || typeof meta !== 'object') {
    return [];
  }
  const liveProgress = meta.live_progress && typeof meta.live_progress === 'object'
    ? meta.live_progress
    : null;
  const liveThinkingRows = normalizeThinkingTraceRows(liveProgress?.thinking_rows);
  if (liveThinkingRows.length) {
    return liveThinkingRows;
  }
  const structuredThinkingRows = buildStructuredThinkingTraceRows(meta.thinking_trace);
  if (structuredThinkingRows.length) {
    return structuredThinkingRows;
  }
  const persistedThinkingRows = normalizeThinkingTraceRows(
    meta.thinking_trace_rows || meta.thinkingTraceRows
  );
  return persistedThinkingRows;
}

function collectAssistantActivityRows(meta) {
  if (!meta || typeof meta !== 'object') {
    return [];
  }
  const liveProgress = meta.live_progress && typeof meta.live_progress === 'object'
    ? meta.live_progress
    : null;
  const liveActivityRows = normalizeActivityTraceRows(liveProgress?.activity_rows);
  if (liveActivityRows.length) {
    return liveActivityRows;
  }
  return normalizeActivityTraceRows(meta.activity_trace_rows || meta.activityTraceRows);
}

function collectAssistantCodexCliDisplayRows(meta) {
  if (!meta || typeof meta !== 'object') {
    return [];
  }
  const liveProgress = meta.live_progress && typeof meta.live_progress === 'object'
    ? meta.live_progress
    : null;
  const liveDisplayRows = normalizeCodexCliDisplayRows(liveProgress?.codex_cli_display_rows);
  if (liveDisplayRows.length) {
    return liveDisplayRows;
  }
  return normalizeCodexCliDisplayRows(
    meta.codex_cli_display_rows
      || meta.codexCliDisplayRows
      || meta.codex_display_rows
      || meta.codexDisplayRows
  );
}

function isCodexAgentTraceMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return false;
  }
  const liveProgress = meta.live_progress && typeof meta.live_progress === 'object'
    ? meta.live_progress
    : null;
  const routingIntent = trimText(
    liveProgress?.routing_intent
      || meta.routing_intent
      || meta.routingIntent
      || meta.parser?.primary_intent
      || meta.parser?.primaryIntent,
    120
  );
  return routingIntent === 'codex_agent' || Boolean(meta.codex_agent || meta.codexAgent);
}

function collectAssistantGeneratedTraceRows(meta, finalText = '') {
  if (!meta || typeof meta !== 'object') {
    return [];
  }
  const codexCliRows = collectAssistantCodexCliDisplayRows(meta);
  if (codexCliRows.length && isCodexAgentTraceMeta(meta)) {
    return filterGeneratedTraceRows(codexCliRows, finalText);
  }
  return filterGeneratedTraceRows([
    ...collectAssistantThinkingTraceRows(meta),
    ...collectAssistantActivityRows(meta)
  ], finalText);
}

function renderAssistantGeneratedTrace(meta, safeText, finalText = '') {
  const rows = collectAssistantGeneratedTraceRows(meta, finalText);
  if (!rows.length) {
    return '';
  }
  const isLive = Boolean(meta?.live_progress && typeof meta.live_progress === 'object');
  if (isLive) {
    return renderLiveGeneratedTrace(rows, safeText);
  }
  return renderCollapsibleThinkingTrace('Agent Trace', rows, safeText, { open: false });
}

function renderUserQuestionCard(meta, messageId = '', safeText, { disabled = false } = {}) {
  const explicitUserQuestion = meta?.user_question
    || meta?.userQuestion
    || meta?.codex_agent?.user_question
    || meta?.codex_agent?.userQuestion;
  const codexStatus = trimText(meta?.codex_agent?.status, 40);
  const keepUserQuestion = Boolean(
    explicitUserQuestion
    && (
      codexStatus === 'needs_more_info'
      || codexStatus === 'needs_user_answer'
      || (!meta?.codex_agent && meta?.parser?.needs_clarification === true)
    )
  );
  const question = keepUserQuestion
    ? normalizeAgentUserQuestion(explicitUserQuestion, '')
    : null;
  if (!question) {
    return '';
  }
  const answeredText = trimText(question.answered?.answer, 1000);
  const messageKey = trimText(messageId, 120);
  const controlsDisabled = disabled || Boolean(answeredText) || !messageKey;
  const disabledAttr = controlsDisabled ? ' disabled' : '';
  const options = asArray(question.options);
  return `
    <section
      class="agent-user-question-card${controlsDisabled ? ' is-disabled' : ''}"
      data-agent-user-question-card="${safeText(messageKey)}"
      aria-label="Clarification question"
    >
      <p class="agent-user-question-kicker">Clarification Needed</p>
      <h4>${safeText(question.question)}</h4>
      ${question.context ? `<p class="agent-user-question-context">${safeText(question.context)}</p>` : ''}
      ${options.length ? `
        <div class="agent-user-question-options">
          ${options.map((option) => `
            <button
              type="button"
              class="agent-user-question-option"
              data-agent-question-option="${safeText(messageKey)}"
              data-agent-question-answer="${safeText(option.value)}"
              ${disabledAttr}
            >
              <span>${safeText(option.label)}</span>
              ${option.description ? `<small>${safeText(option.description)}</small>` : ''}
            </button>
          `).join('')}
        </div>
      ` : ''}
      ${question.allow_custom ? `
        <div class="agent-user-question-custom">
          <textarea
            rows="2"
            data-agent-question-custom-input="${safeText(messageKey)}"
            placeholder="${safeText(question.placeholder)}"
            ${disabledAttr}
          ></textarea>
          <button
            type="button"
            class="primary-btn"
            data-agent-question-submit="${safeText(messageKey)}"
            ${disabledAttr}
          >
            ${safeText(question.submit_label)}
          </button>
        </div>
      ` : ''}
      ${answeredText ? `<p class="agent-user-question-answer">Answered: ${safeText(answeredText)}</p>` : ''}
      ${!answeredText && disabled ? '<p class="agent-user-question-answer">This thread has already continued.</p>' : ''}
    </section>
  `;
}

function renderAssistantMeta(meta, messageId = '', { state, safeText, canAnswerQuestion = true }) {
  if (!meta || typeof meta !== 'object') {
    return '';
  }
  const liveProgress = meta.live_progress && typeof meta.live_progress === 'object'
    ? meta.live_progress
    : null;
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
  if (liveProgress) {
    return '';
  }
  const notebookDraft = normalizeNotebookDraft(meta.notebookDraft);
  const existingNotebookEntry = findNotebookEntryForDraft(state.notebookEntries, notebookDraft);
  const showCreatePlannedPageButton = Boolean(
    notebookDraft
    && notebookDraft?.save?.mode === 'confirm_before_save'
    && trimText(messageId, 120)
    && !existingNotebookEntry
  );
  const showOpenNotebookPageButton = Boolean(
    notebookDraft
    && existingNotebookEntry
    && trimText(messageId, 120)
  );
  const openNotebookButtonLabel = normalizeNotebookState(existingNotebookEntry?.notebookState) === 'planned'
    ? 'Open Planned Page'
    : 'Open Notebook Page';
  const hasPurchaseRecommendation = meta.purchase_recommendation && typeof meta.purchase_recommendation === 'object';
  const purchaseRecommendation = hasPurchaseRecommendation
    ? meta.purchase_recommendation
    : {};
  const pythonSandboxRuns = collectPythonSandboxRuns(meta);
  const userQuestionCard = renderUserQuestionCard(meta, messageId, safeText, {
    disabled: canAnswerQuestion !== true
  });
  const sections = [
    userQuestionCard,
    hasPurchaseRecommendation ? renderPurchaseRecommendationCards(purchaseRecommendation, safeText) : '',
    renderPythonSandboxRuns(pythonSandboxRuns, safeText),
    showCreatePlannedPageButton ? `
      <section class="agent-draft-actions">
        <button
          type="button"
          class="primary-btn"
          data-agent-create-planned-page="${safeText(trimText(messageId, 120))}"
        >
          Create Planned Page
        </button>
      </section>
    ` : '',
    showOpenNotebookPageButton ? `
      <section class="agent-draft-actions">
        <button
          type="button"
          class="ghost-btn"
          data-agent-open-notebook-page="${safeText(trimText(messageId, 120))}"
        >
          ${safeText(openNotebookButtonLabel)}
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

function renderUserAttachments(attachments, safeText) {
  const items = asArray(attachments).filter((attachment) => trimText(attachment?.name, 240));
  if (!items.length) {
    return '';
  }
  return `
    <div class="agent-attachment-list">
      ${items.map((attachment) => `
        <span class="agent-attachment-pill${trimText(attachment?.kind, 20) === 'image' ? ' is-image' : ''}">
          <span>${safeText(trimText(attachment?.kind, 20) === 'image' ? 'Image' : 'File')}</span>
          <span>${safeText(trimText(attachment?.name, 240))}</span>
        </span>
      `).join('')}
    </div>
  `;
}

export function renderHistory({ historyNode, messages, state, safeText }) {
  const safeMessages = asArray(messages);
  if (!safeMessages.length) {
    const projectId = trimText(state?.agentChat?.projectId, 120);
    const projectName = asArray(state?.projects).find((project) => trimText(project?.id, 120) === projectId)?.name || '';
    historyNode.innerHTML = `
      <section class="agent-empty-state">
        <p class="agent-empty-kicker">Agent Workspace</p>
        <h3>${safeText(projectName ? `Start a thread for ${projectName}` : 'Start a new lab thread')}</h3>
        <p class="small-note">
          ${safeText(projectName
            ? 'Ask for planning help, record lookups, literature grounding, or a next-step recommendation within the selected project.'
            : 'Ask for planning help, record lookups, literature grounding, or a next-step recommendation across your lab data.')}
        </p>
        <div class="agent-empty-prompt-list">
          <button type="button" class="ghost-btn agent-empty-prompt" data-agent-suggest-prompt="Summarize the latest progress and open questions for this project.">Summarize recent progress</button>
          <button type="button" class="ghost-btn agent-empty-prompt" data-agent-suggest-prompt="Draft the next experiment I should run and explain why.">Draft the next experiment</button>
          <button type="button" class="ghost-btn agent-empty-prompt" data-agent-suggest-prompt="Find likely causes for a weak assay signal and suggest troubleshooting steps.">Troubleshoot an assay</button>
        </div>
      </section>
    `;
    return;
  }

  historyNode.innerHTML = safeMessages.map((message, index) => {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const headerLabel = role === 'assistant' ? 'Assistant' : 'You';
    const cardClass = role === 'assistant' ? 'agent-chat-item-assistant' : 'agent-chat-item-user';
    const rowClass = role === 'assistant' ? 'agent-chat-row-assistant' : 'agent-chat-row-user';
    const hasLiveProgress = Boolean(message?.meta?.live_progress && typeof message.meta.live_progress === 'object');
    const timestamp = formatTime(message.createdAt);
    const assistantGeneratedTrace = role === 'assistant'
      ? renderAssistantGeneratedTrace(message.meta, safeText, hasLiveProgress ? '' : (message.text || ''))
      : '';
    const assistantMeta = role === 'assistant'
      ? renderAssistantMeta(message.meta, message.id, {
        state,
        safeText,
        canAnswerQuestion: !safeMessages.slice(index + 1).some((item) => item?.role === 'user')
      })
      : '';
    const messageBody = role === 'assistant'
      ? `<div class="agent-chat-body agent-chat-markdown">${renderMarkdown(message.text || '', safeText)}</div>`
      : `<p class="agent-chat-body agent-chat-body-plain">${safeText(message.text || '')}</p>`;
    const liveGeneratedTrace = hasLiveProgress ? assistantGeneratedTrace : '';
    const completedGeneratedTrace = hasLiveProgress ? '' : assistantGeneratedTrace;
    return `
      <div class="agent-chat-row ${rowClass}${hasLiveProgress ? ' is-live' : ''}">
        <div class="agent-chat-identity" aria-hidden="true">
          <span class="agent-chat-avatar agent-chat-avatar-${role}">${role === 'assistant' ? 'AI' : 'You'}</span>
        </div>
        <article class="agent-chat-item ${cardClass}">
          <header class="agent-chat-header">
            <div class="agent-chat-header-copy">
              <strong>${headerLabel}</strong>
              ${hasLiveProgress ? '<span class="agent-live-pill">Working</span>' : ''}
            </div>
            <span>${safeText(timestamp)}</span>
          </header>
          ${liveGeneratedTrace}
          ${messageBody}
          ${completedGeneratedTrace}
          ${role === 'user' ? renderUserAttachments(message.attachments, safeText) : ''}
          ${assistantMeta}
        </article>
      </div>
    `;
  }).join('');

  historyNode.querySelectorAll('details[data-agent-generated-trace="true"]').forEach((traceNode) => {
    traceNode.open = traceNode?.dataset?.agentTraceOpen === 'true';
  });
}
