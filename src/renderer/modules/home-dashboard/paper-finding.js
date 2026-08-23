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
  return `Next ${nextRun.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
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

function papersForTasks(tasks = []) {
  return sortTasksByLatestResult(tasks).flatMap((task) => (
    asArray(taskRunResult(task).papers).map((paper) => ({ paper, task }))
  ));
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
  elements = {}
} = {}) {
  const { summary, list, openBtn } = elements;
  if (!summary || !list) {
    return { render: () => {} };
  }

  const escapeText = typeof safeText === 'function' ? safeText : (value) => String(value || '');
  let tasks = null;
  let request = null;
  let lastLoadedAt = 0;

  openBtn?.addEventListener?.('click', () => onOpenNotebook());

  function renderPaperResult({ paper, task }) {
    const source = ensureObject(paper);
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
    return `
      <article class="home-paper-finding-result" data-paper-finding-result>
        <div class="home-paper-finding-result-head">
          <span class="home-paper-finding-project">${escapeText(projectName)}</span>
          <span class="home-paper-finding-policy">Metadata only</span>
        </div>
        <h3 class="home-paper-finding-title">${escapeText(title)}</h3>
        ${authors ? `<p class="home-paper-finding-authors">${escapeText(authors)}</p>` : ''}
        ${meta.length ? `<p class="home-paper-finding-meta">${escapeText(meta.join(' · '))}</p>` : ''}
        ${summaryText ? `<p class="home-paper-finding-summary">${escapeText(summaryText)}</p>` : ''}
        ${reasonText ? `<p class="home-paper-finding-reason"><strong>Why it matters:</strong> ${escapeText(reasonText)}</p>` : ''}
        ${url ? `<a class="home-paper-finding-source" href="${escapeText(url)}" target="_blank" rel="noreferrer noopener">View source ↗</a>` : ''}
      </article>
    `;
  }

  function renderTasks() {
    if (tasks === null) {
      summary.textContent = 'Loading schedules…';
      list.innerHTML = '';
      return;
    }

    const activeTasks = tasks.filter((task) => task?.enabled !== false);
    const foundPapers = papersForTasks(tasks);
    summary.textContent = foundPapers.length
      ? `${foundPapers.length} paper${foundPapers.length === 1 ? '' : 's'} found · ${activeTasks.length} active schedule${activeTasks.length === 1 ? '' : 's'}`
      : tasks.length
        ? `${activeTasks.length} active schedule${activeTasks.length === 1 ? '' : 's'}`
        : 'No schedules yet.';

    if (!tasks.length) {
      list.innerHTML = '<p class="small-note">Set up paper finding from a project notebook.</p>';
      return;
    }

    if (foundPapers.length) {
      list.innerHTML = foundPapers.map(renderPaperResult).join('');
      return;
    }

    list.innerHTML = sortScheduledTasks(tasks).slice(0, 3).map((task) => {
      const paused = task?.enabled === false;
      return `
        <div class="home-row home-paper-finding-row${paused ? ' is-muted' : ''}">
          <div class="home-row-copy">
            <div class="home-row-name">${escapeText(projectNameForTask(task))}</div>
            <div class="home-row-meta">${escapeText(`${cadenceForTask(task)} · ${nextRunForTask(task)}`)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  async function refresh() {
    if (request) {
      return request;
    }
    if (typeof api?.listPaperFindingTasks !== 'function') {
      tasks = [];
      lastLoadedAt = Date.now();
      summary.textContent = 'Available in project notebooks.';
      list.innerHTML = '<p class="small-note">Set up paper finding from a project notebook.</p>';
      return null;
    }

    request = Promise.resolve(api.listPaperFindingTasks())
      .then((response) => {
        if (response?.ok !== true) {
          throw new Error(cleanText(response?.error) || 'Could not load schedules.');
        }
        tasks = asArray(response.tasks);
        lastLoadedAt = Date.now();
        renderTasks();
      })
      .catch(() => {
        tasks = [];
        lastLoadedAt = Date.now();
        summary.textContent = 'Could not load schedules.';
        showTransientNotice(summary.textContent, { type: 'error' });
        list.innerHTML = '<p class="small-note">Open Notebook to manage paper finding.</p>';
      })
      .finally(() => {
        request = null;
      });
    return request;
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
