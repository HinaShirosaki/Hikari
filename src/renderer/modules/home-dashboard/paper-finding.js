import { showTransientNotice } from '../../lib/notify.js';
import { asArray, ensureObject } from '../../lib/normalize.js';

function cleanText(value) {
  return String(value || '').trim();
}

function paperFindingConfig(task = {}) {
  return ensureObject(ensureObject(ensureObject(task).metadata).paper_finding);
}

function projectNameForTask(task = {}) {
  const config = paperFindingConfig(task);
  const project = ensureObject(task.project);
  return cleanText(project.name || config.project_name || config.project_id) || 'Project';
}

function cadenceForTask(task = {}) {
  const config = paperFindingConfig(task);
  const detailedLabel = cleanText(config.frequency_label);
  if (detailedLabel) {
    return detailedLabel;
  }
  const value = Number(config.frequency_value);
  const unit = cleanText(config.frequency_unit).toLowerCase();
  if (Number.isFinite(value) && value > 0 && unit) {
    const displayValue = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
    return `Every ${displayValue} ${unit}${value === 1 ? '' : 's'}`;
  }
  return 'Recurring schedule';
}

function nextRunForTask(task = {}) {
  if (task.enabled === false) {
    return 'Paused';
  }
  const raw = cleanText(task.next_run_at || task.nextRunAt);
  const nextRun = new Date(raw);
  if (!raw || Number.isNaN(nextRun.getTime())) {
    return 'Scheduled';
  }
  const timezone = cleanText(ensureObject(task.schedule).timezone);
  return `Next ${nextRun.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timezone ? { timeZone: timezone, timeZoneName: 'short' } : {})
  })}`;
}

function taskRunResult(task = {}) {
  return ensureObject(ensureObject(task).last_run?.result);
}

function safeHttpUrl(value) {
  const raw = cleanText(value);
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function authorName(author) {
  if (author && typeof author === 'object' && !Array.isArray(author)) {
    return cleanText(author.name || [author.given, author.family].filter(Boolean).join(' '));
  }
  return cleanText(author);
}

function authorsForPaper(paper = {}) {
  const source = ensureObject(paper);
  const authors = asArray(source.authors || source.author)
    .map(authorName)
    .filter(Boolean);
  if (!authors.length && cleanText(source.author)) {
    authors.push(cleanText(source.author));
  }
  if (authors.length <= 3) {
    return authors.join(', ');
  }
  return `${authors.slice(0, 3).join(', ')}, et al.`;
}

function sortTasksByLatestResult(tasks = []) {
  return tasks.slice().sort((left, right) => {
    const leftRun = ensureObject(left?.last_run);
    const rightRun = ensureObject(right?.last_run);
    const leftResult = taskRunResult(left);
    const rightResult = taskRunResult(right);
    const leftTime = new Date(
      leftRun.completed_at || leftRun.completedAt || leftResult.generated_at || leftResult.generatedAt || ''
    ).getTime();
    const rightTime = new Date(
      rightRun.completed_at || rightRun.completedAt || rightResult.generated_at || rightResult.generatedAt || ''
    ).getTime();
    const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY;
    const safeRight = Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY;
    return safeRight - safeLeft;
  });
}

// Papers already saved when the run finished are not news; papers saved from
// this round's cards stay (as "Saved") until the next run replaces them.
function papersForTasks(tasks = []) {
  return sortTasksByLatestResult(tasks).flatMap((task) => (
    asArray(taskRunResult(task).papers)
      .filter((paper) => paper?.already_local !== true)
      .map((paper) => ({ paper, task }))
  ));
}

function savedFilePath(paper = {}) {
  return paper.download_status === 'saved' ? cleanText(ensureObject(paper.local_file).file_path) : '';
}

function paperKey({ paper, task }) {
  const source = ensureObject(paper);
  const url = safeHttpUrl(source.url);
  return `${cleanText(task.id) || projectNameForTask(task)}:${cleanText(source.doi || source.pmid) || url || cleanText(source.title) || 'Untitled paper'}`;
}

function sortScheduledTasks(tasks) {
  return tasks.slice().sort((left, right) => {
    const leftTime = new Date(left?.next_run_at || left?.nextRunAt || '').getTime();
    const rightTime = new Date(right?.next_run_at || right?.nextRunAt || '').getTime();
    const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY;
    const safeRight = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY;
    return safeLeft - safeRight;
  });
}

export function initPaperFindingWidget({
  api = null,
  safeText = (value) => String(value || ''),
  onOpenNotebook = () => {},
  onOpenPaper = null,
  elements = {}
} = {}) {
  const { summary, list, openBtn, runBtn, nextRun } = elements;
  if (!summary || !list) {
    return { render: () => {} };
  }

  const escapeText = typeof safeText === 'function' ? safeText : (value) => String(value || '');
  let tasks = null;
  let request = null;
  let lastLoadedAt = 0;
  let lastMarkup = null;
  let availabilityMessage = '';
  let hasLoadError = false;
  let running = false;
  const cardTargets = new Map();
  const downloading = new Set();

  openBtn?.addEventListener?.('click', () => onOpenNotebook());
  runBtn?.addEventListener?.('click', () => { void runNow(); });
  list.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-paper-finding-setup]')) {
      onOpenNotebook();
    }
    const downloadBtn = event.target.closest?.('[data-paper-finding-download]');
    if (downloadBtn) {
      void downloadPaper(downloadBtn.dataset.paperFindingDownload);
    }
    const openBtn = event.target.closest?.('[data-paper-finding-open]');
    if (openBtn) {
      void openSavedPaper(openBtn.dataset.paperFindingOpen);
    }
  });

  function setListMarkup(markup) {
    if (markup === lastMarkup) {
      return;
    }
    const expanded = new Set([...(list.querySelectorAll?.('details[open]') || [])]
      .map((detail) => detail.dataset.paperFindingKey));
    list.innerHTML = markup;
    lastMarkup = markup;
    list.querySelectorAll?.('details[data-paper-finding-key]').forEach((detail) => {
      detail.open = expanded.has(detail.dataset.paperFindingKey);
    });
  }

  // The finder never downloads on its own, so the footer says so once instead
  // of badging every card; Download on a card saves a PDF on demand.
  function renderScheduleFooter(activeTasks, hasPapers = false) {
    if (!nextRun) {
      return;
    }
    const scheduled = sortScheduledTasks(activeTasks).find((task) => (
      Number.isFinite(new Date(task?.next_run_at || task?.nextRunAt || '').getTime())
    ));
    const parts = [
      scheduled ? `<span>${escapeText(nextRunForTask(scheduled))}</span>` : '',
      hasPapers ? '<span title="Paper finder saves citation details only; use Download to save a PDF to the project.">Metadata only</span>' : ''
    ].filter(Boolean);
    nextRun.innerHTML = parts.join('');
    nextRun.hidden = !parts.length;
  }

  function renderPaperResult({ paper, task }) {
    const source = ensureObject(paper);
    const key = paperKey({ paper, task });
    const projectName = projectNameForTask(task);
    const title = cleanText(source.title) || 'Untitled paper';
    const authors = authorsForPaper(source);
    const meta = [source.journal, source.published_at, source.source]
      .map(cleanText)
      .filter(Boolean);
    if (cleanText(source.doi)) {
      meta.push(`DOI ${cleanText(source.doi)}`);
    }
    if (cleanText(source.pmid)) {
      meta.push(`PMID ${cleanText(source.pmid)}`);
    }
    if (cleanText(source.pmcid)) {
      meta.push(`PMCID ${cleanText(source.pmcid)}`);
    }
    const summaryText = cleanText(source.summary);
    const reasonText = cleanText(source.relevance_reason);
    const url = safeHttpUrl(source.url);
    const bibliography = [source.journal, source.published_at].map(cleanText).filter(Boolean).join(' · ');
    const hasDetails = Boolean(summaryText || authors || meta.length);
    const savedPath = savedFilePath(source);
    const canOpen = Boolean(savedPath) && typeof onOpenPaper === 'function';
    const canDownload = !savedPath && Boolean(cleanText(task.id) && (url || cleanText(source.doi)))
      && typeof api?.downloadFoundPaper === 'function';
    if (canDownload || canOpen) {
      cardTargets.set(key, { paper: source, task });
    }
    const isDownloading = downloading.has(key);
    return `
      <article class="home-paper-finding-result" data-paper-finding-result>
        <div class="home-paper-finding-result-head">
          <span class="home-paper-finding-project">${escapeText(projectName)}</span>
          ${bibliography ? `<span class="home-paper-finding-citation">${escapeText(bibliography)}</span>` : ''}
        </div>
        <h3 class="home-paper-finding-title">${escapeText(title)}</h3>
        ${reasonText ? `<p class="home-paper-finding-reason"><strong>Why it matters:</strong> ${escapeText(reasonText)}</p>` : ''}
        ${hasDetails || url || canDownload || savedPath ? `
          <div class="home-paper-finding-links">
            ${hasDetails ? `
              <details class="home-paper-finding-details" data-paper-finding-key="${escapeText(key)}">
                <summary>${summaryText ? 'Summary' : 'Details'}<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg></summary>
                ${summaryText ? `<p class="home-paper-finding-summary">${escapeText(summaryText)}</p>` : ''}
                ${authors ? `<p class="home-paper-finding-authors">${escapeText(authors)}</p>` : ''}
                ${meta.length ? `<p class="home-paper-finding-meta">${escapeText(meta.join(' · '))}</p>` : ''}
              </details>
            ` : ''}
            ${url ? `<a class="home-paper-finding-source" href="${escapeText(url)}" target="_blank" rel="noreferrer noopener">Source<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 17 17 7M8 7h9v9"/></svg></a>` : ''}
            ${canDownload ? `<button type="button" class="home-paper-finding-source" data-paper-finding-download="${escapeText(key)}" title="Save the PDF to ${escapeText(projectName)}"${isDownloading ? ' disabled' : ''}>${isDownloading ? 'Downloading…' : 'Download'}<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg></button>` : ''}
            ${savedPath ? `<span class="home-paper-finding-saved" title="Saved to ${escapeText(projectName)}">Saved<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg></span>` : ''}
            ${canOpen ? `<button type="button" class="home-paper-finding-source" data-paper-finding-open="${escapeText(key)}" title="Open in Papers">Open</button>` : ''}
          </div>
        ` : ''}
      </article>
    `;
  }

  function renderTasks() {
    summary.classList?.toggle('is-error', hasLoadError);
    if (runBtn) {
      const runnable = Array.isArray(tasks) && tasks.some((task) => task?.enabled !== false && task?.id);
      runBtn.hidden = !runnable || typeof api?.runPaperFindingTask !== 'function';
      runBtn.disabled = running;
    }
    if (running) {
      summary.textContent = 'Finding papers…';
      return;
    }
    if (availabilityMessage) {
      summary.textContent = availabilityMessage;
      renderScheduleFooter([]);
      setListMarkup('<button type="button" class="ghost-btn home-paper-finding-setup" data-paper-finding-setup>Open project notebooks →</button>');
      return;
    }
    if (tasks === null) {
      summary.textContent = 'Loading schedules…';
      setListMarkup('');
      return;
    }

    const activeTasks = tasks.filter((task) => task?.enabled !== false);
    const foundPapers = papersForTasks(tasks);
    renderScheduleFooter(activeTasks, foundPapers.length > 0);
    summary.textContent = foundPapers.length
      ? `${foundPapers.length} paper${foundPapers.length === 1 ? '' : 's'} found · ${activeTasks.length} active schedule${activeTasks.length === 1 ? '' : 's'}`
      : tasks.length
        ? `${activeTasks.length} active schedule${activeTasks.length === 1 ? '' : 's'}`
        : '';

    if (!tasks.length) {
      setListMarkup('<button type="button" class="ghost-btn home-paper-finding-setup" data-paper-finding-setup><svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>Set up paper finding</button>');
      return;
    }

    if (foundPapers.length) {
      cardTargets.clear();
      setListMarkup(foundPapers.map(renderPaperResult).join(''));
      return;
    }

    setListMarkup(sortScheduledTasks(tasks).slice(0, 3).map((task) => {
      const paused = task?.enabled === false;
      return `
        <div class="home-row home-paper-finding-row${paused ? ' is-muted' : ''}">
          <div class="home-row-copy">
            <div class="home-row-name">${escapeText(projectNameForTask(task))}</div>
            <div class="home-row-meta">${escapeText(`${cadenceForTask(task)} · ${nextRunForTask(task)}`)}</div>
          </div>
        </div>
      `;
    }).join(''));
  }

  async function refresh() {
    if (request) {
      return request;
    }
    if (typeof api?.listPaperFindingTasks !== 'function') {
      tasks = [];
      lastLoadedAt = Date.now();
      availabilityMessage = 'Available in project notebooks.';
      hasLoadError = false;
      renderTasks();
      return null;
    }

    request = Promise.resolve(api.listPaperFindingTasks())
      .then((response) => {
        if (response?.ok !== true) {
          throw new Error(cleanText(response?.error) || 'Could not load schedules.');
        }
        tasks = asArray(response.tasks);
        availabilityMessage = '';
        hasLoadError = false;
        lastLoadedAt = Date.now();
        renderTasks();
      })
      .catch(() => {
        tasks = [];
        lastLoadedAt = Date.now();
        availabilityMessage = 'Could not load schedules.';
        hasLoadError = true;
        renderTasks();
        showTransientNotice(availabilityMessage, { type: 'error' });
      })
      .finally(() => {
        request = null;
      });
    return request;
  }

  async function runNow() {
    if (running || typeof api?.runPaperFindingTask !== 'function') {
      return;
    }
    const ids = asArray(tasks).filter((task) => task?.enabled !== false && task?.id).map((task) => task.id);
    if (!ids.length) {
      return;
    }
    running = true;
    renderTasks();
    const failures = [];
    // ponytail: runs schedules one after another; main already rejects a task that is mid-run.
    for (const id of ids) {
      try {
        const response = await api.runPaperFindingTask(id);
        if (response?.ok !== true) {
          failures.push(cleanText(response?.error) || 'Paper finding failed.');
        }
      } catch (error) {
        failures.push(cleanText(error?.message) || 'Paper finding failed.');
      }
    }
    running = false;
    if (request) {
      await request;
    }
    await refresh();
    if (failures.length) {
      showTransientNotice(failures[0], { type: 'error' });
    }
  }

  async function downloadPaper(key) {
    const target = cardTargets.get(key);
    if (!target || downloading.has(key)) {
      return;
    }
    downloading.add(key);
    renderTasks();
    const projectName = projectNameForTask(target.task);
    try {
      const response = await api.downloadFoundPaper(target.task.id, target.paper);
      if (response?.ok !== true) {
        showTransientNotice(cleanText(response?.error) || 'Paper download failed.', { type: 'error' });
      } else if (response.download_status === 'completed') {
        showTransientNotice(`Saved ${cleanText(response.file_name) || 'the PDF'} to ${projectName}.`);
        // Main marked the card saved; reload so it turns into Saved · Open.
        if (request) {
          await request;
        }
        await refresh();
      } else {
        showTransientNotice('Paper download is still running.');
      }
    } catch (error) {
      showTransientNotice(cleanText(error?.message) || 'Paper download failed.', { type: 'error' });
    } finally {
      downloading.delete(key);
      renderTasks();
    }
  }

  async function openSavedPaper(key) {
    const paper = ensureObject(cardTargets.get(key)?.paper);
    const filePath = savedFilePath(paper);
    if (!filePath) {
      return;
    }
    try {
      await onOpenPaper({ filePath, relativePath: cleanText(ensureObject(paper.local_file).relative_path) });
    } catch (error) {
      showTransientNotice(cleanText(error?.message) || 'Could not open the saved PDF.', { type: 'error' });
    }
  }

  function renderWidget() {
    if (tasks === null || (Date.now() - lastLoadedAt) > 20_000) {
      refresh();
    }
    renderTasks();
  }

  const windowObject = summary.ownerDocument?.defaultView;
  windowObject?.setInterval?.(() => {
    const homeView = summary.closest?.('#home-view');
    if (!homeView || homeView.classList?.contains?.('is-active')) {
      refresh();
    }
  }, 20_000);

  return { render: renderWidget };
}
