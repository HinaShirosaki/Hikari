import { showTransientNotice } from '../../lib/notify.js';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || '').trim();
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

  function renderTasks() {
    if (tasks === null) {
      summary.textContent = 'Loading schedules…';
      list.innerHTML = '';
      return;
    }

    const activeTasks = tasks.filter((task) => task?.enabled !== false);
    summary.textContent = tasks.length
      ? `${activeTasks.length} active schedule${activeTasks.length === 1 ? '' : 's'}`
      : 'No schedules yet.';

    if (!tasks.length) {
      list.innerHTML = '<p class="small-note">Set up paper finding from a project notebook.</p>';
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

  return { render: renderWidget };
}
