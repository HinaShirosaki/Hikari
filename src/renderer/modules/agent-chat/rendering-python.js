import { renderMarkdown } from './markdown.js';
import { asArray, trimText } from './shared.js';

export function collectRenderablePythonSandboxOutput(source) {
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
    outputs.unshift({ type: 'text', title: 'stdout', format: 'text/plain', content: stdout });
  } else if (!outputs.length && !stdout && stderr) {
    outputs.push({ type: 'text', title: 'stderr', format: 'text/plain', content: stderr });
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

export function collectPythonSandboxRuns(meta) {
  if (!meta || typeof meta !== 'object') {
    return [];
  }
  const runs = [];
  const pushRun = (label, payload) => {
    const normalized = collectRenderablePythonSandboxOutput(payload);
    if (!normalized.outputs.length && !normalized.error && !normalized.stdout && !normalized.stderr) {
      return;
    }
    runs.push({ label: trimText(label, 160) || 'Python sandbox', ...normalized });
  };

  [
    ['General science', meta.general_science_question],
    ['Project science', meta.project_science_question],
    ['Result analysis', meta.result_analysis]
  ].forEach(([label, payload]) => {
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

export function renderPythonSandboxRuns(runs, safeText) {
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
        const showStdout = trimText(run.stdout, 12000)
          && !asArray(run.outputs).some((output) => trimText(output?.title, 80).toLowerCase() === 'stdout');
        const showStderr = trimText(run.stderr, 12000)
          && !asArray(run.outputs).some((output) => trimText(output?.title, 80).toLowerCase() === 'stderr');
        return `
          <div class="agent-python-output-run">
            ${summary ? `<p class="small-note">${safeText(summary)}</p>` : ''}
            <div class="agent-python-output-grid">
              ${asArray(run.outputs).map((output) => renderPythonOutputCard(output, safeText)).join('')}
            </div>
            ${trimText(run.error, 1200) ? `
              <details><summary>Error</summary><pre class="agent-meta-json">${safeText(trimText(run.error, 1200))}</pre></details>
            ` : ''}
            ${showStdout ? `
              <details><summary>stdout</summary><pre class="agent-meta-json">${safeText(trimText(run.stdout, 12000))}</pre></details>
            ` : ''}
            ${showStderr ? `
              <details><summary>stderr</summary><pre class="agent-meta-json">${safeText(trimText(run.stderr, 12000))}</pre></details>
            ` : ''}
          </div>
        `;
      }).join('')}
    </section>
  `;
}
