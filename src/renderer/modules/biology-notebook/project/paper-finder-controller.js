import { showTransientNotice } from '../../../lib/notify.js';
import { asArray, ensureObject } from '../../../lib/normalize.js';

function cleanText(value) {
  return String(value || '').trim();
}

function taskConfig(task = {}) {
  return ensureObject(ensureObject(ensureObject(task).metadata).paper_finding);
}

function formatNextRun(task = {}) {
  const raw = cleanText(task.next_run_at || task.nextRunAt);
  if (!raw) {
    return task.enabled === false ? 'Paused' : 'Not scheduled';
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return 'Scheduled';
  }
  return `Next: ${parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })}`;
}

function paperCountFromRun(result = {}) {
  const run = ensureObject(result.run);
  const structured = ensureObject(run.result || ensureObject(result.task).last_run?.result);
  return asArray(structured.papers).length;
}

function taskRunResult(task = {}) {
  return ensureObject(ensureObject(task).last_run?.result);
}

function escapeHtml(value) {
  return cleanText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHttpUrl(value) {
  const raw = cleanText(value);
  return /^https?:\/\//i.test(raw) ? raw : '';
}

function renderPaperCard(paper = {}) {
  const source = ensureObject(paper);
  const title = escapeHtml(source.title) || 'Untitled paper';
  const url = safeHttpUrl(source.url);
  const heading = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">${title}</a>`
    : title;
  const metaBits = [source.journal, source.published_at, source.source]
    .map(escapeHtml)
    .filter(Boolean);
  const summary = escapeHtml(source.summary);
  const reason = escapeHtml(source.relevance_reason);
  return [
    '<article class="project-paper-finder-result" data-paper-finder-result>',
    `<h4>${heading}</h4>`,
    metaBits.length
      ? `<p class="small-note project-paper-finder-result-meta">${metaBits.join(' · ')}</p>`
      : '',
    summary ? `<p class="project-paper-finder-result-summary">${summary}</p>` : '',
    reason ? `<p class="small-note project-paper-finder-result-reason">Why: ${reason}</p>` : '',
    '</article>'
  ].join('');
}

export function createProjectPaperFinderController({
  host,
  state,
  api,
  onTaskChanged = () => {}
} = {}) {
  let activeProject = null;
  let activeTask = null;
  let loadRevision = 0;
  let busy = false;

  function findElement(selector) {
    return host?.querySelector?.(selector) || null;
  }

  function elements() {
    return {
      form: findElement('[data-paper-finder-form]'),
      stateLabel: findElement('[data-paper-finder-state]'),
      frequencyValue: findElement('[data-paper-finder-frequency-value]'),
      frequencyUnit: findElement('[data-paper-finder-frequency-unit]'),
      requirements: findElement('[data-paper-finder-requirements]'),
      saveBtn: findElement('[data-paper-finder-save]'),
      runBtn: findElement('[data-paper-finder-run]'),
      toggleBtn: findElement('[data-paper-finder-toggle]'),
      removeBtn: findElement('[data-paper-finder-remove]'),
      status: findElement('[data-paper-finder-status]'),
      results: findElement('[data-paper-finder-results]')
    };
  }

  function renderResults(task = activeTask) {
    const container = elements().results;
    if (!container) {
      return;
    }
    const result = taskRunResult(task);
    const papers = asArray(result.papers);
    if (!papers.length) {
      container.innerHTML = '';
      container.hidden = true;
      return;
    }
    const runSummary = escapeHtml(result.summary)
      || `Found ${papers.length} paper${papers.length === 1 ? '' : 's'}.`;
    container.innerHTML = [
      `<p class="small-note project-paper-finder-results-head">${runSummary}</p>`,
      ...papers.map(renderPaperCard)
    ].join('');
    container.hidden = false;
  }

  function setStatus(message = '', { error = false } = {}) {
    if (error && message) {
      showTransientNotice(message, { type: 'error' });
    }
    const status = elements().status;
    if (!status) {
      return;
    }
    status.textContent = cleanText(message);
    status.classList?.toggle?.('is-error', Boolean(error));
  }

  function setBusy(nextBusy) {
    busy = Boolean(nextBusy);
    const controls = elements();
    [controls.saveBtn, controls.runBtn, controls.toggleBtn, controls.removeBtn]
      .filter(Boolean)
      .forEach((button) => {
        button.disabled = busy;
      });
  }

  function syncTask(task = null) {
    activeTask = task && typeof task === 'object' ? task : null;
    const controls = elements();
    const hasTask = Boolean(activeTask?.id);
    if (controls.form) {
      controls.form.dataset.taskId = hasTask ? activeTask.id : '';
    }
    if (controls.stateLabel) {
      controls.stateLabel.textContent = hasTask ? formatNextRun(activeTask) : 'Not scheduled';
    }
    if (controls.saveBtn) {
      controls.saveBtn.textContent = hasTask ? 'Save schedule' : 'Schedule';
    }
    [controls.runBtn, controls.toggleBtn, controls.removeBtn].filter(Boolean).forEach((button) => {
      button.hidden = !hasTask;
    });
    if (controls.toggleBtn && hasTask) {
      controls.toggleBtn.textContent = activeTask.enabled === false ? 'Resume' : 'Pause';
    }
  }

  function hydrateFields(task = null) {
    const controls = elements();
    const config = taskConfig(task);
    if (controls.frequencyValue) {
      controls.frequencyValue.value = String(Number(config.frequency_value) || 1);
    }
    if (controls.frequencyUnit) {
      controls.frequencyUnit.value = cleanText(config.frequency_unit) || 'week';
    }
    if (controls.requirements) {
      controls.requirements.value = cleanText(config.requirements);
    }
  }

  function taskMatchesProject(task, project) {
    const config = taskConfig(task);
    const taskProject = ensureObject(task.project);
    return Boolean(
      cleanText(project?.id)
      && cleanText(project?.id) === cleanText(taskProject.id || config.project_id)
    );
  }

  async function load(project) {
    activeProject = project && typeof project === 'object' ? project : null;
    activeTask = null;
    const revision = ++loadRevision;
    syncTask(null);
    hydrateFields(null);
    renderResults(null);
    setStatus('');
    if (!activeProject || !host) {
      return null;
    }
    if (typeof api?.listPaperFindingTasks !== 'function') {
      setStatus('Scheduled paper finding is unavailable in this build.', { error: true });
      const controls = elements();
      if (controls.saveBtn) {
        controls.saveBtn.disabled = true;
      }
      return null;
    }

    setStatus('Loading schedule...');
    try {
      const response = await api.listPaperFindingTasks();
      if (revision !== loadRevision || cleanText(activeProject?.id) !== cleanText(project?.id)) {
        return null;
      }
      if (response?.ok !== true) {
        setStatus(response?.error || 'Could not load the paper-finding schedule.', { error: true });
        return null;
      }
      const task = asArray(response.tasks).find((entry) => taskMatchesProject(entry, project)) || null;
      syncTask(task);
      hydrateFields(task);
      renderResults(task);
      setStatus(task ? 'Metadata-only paper finding is active.' : 'No paper-finding schedule yet.');
      return task;
    } catch (error) {
      if (revision === loadRevision) {
        setStatus(error?.message || 'Could not load the paper-finding schedule.', { error: true });
      }
      return null;
    }
  }

  function buildInput() {
    const controls = elements();
    const settings = ensureObject(state?.settings);
    const llm = ensureObject(settings.llm);
    return {
      project: {
        id: cleanText(activeProject?.id),
        name: cleanText(activeProject?.name),
        description: cleanText(activeProject?.description),
        storage_path: cleanText(settings.storagePath),
        data_file_path: cleanText(state?.data_file_path || state?.dataFilePath)
      },
      requirements: cleanText(controls.requirements?.value),
      frequency: {
        value: Number(controls.frequencyValue?.value) || 1,
        unit: cleanText(controls.frequencyUnit?.value) || 'week'
      },
      preferred_journals: asArray(settings.preferredJournals),
      enabled: true,
      execution: {
        model: cleanText(llm.model),
        reasoning_effort: cleanText(llm.reasoningEffort) || 'medium',
        enable_web_search: true,
        timeout_ms: 900_000
      }
    };
  }

  async function save(event) {
    event?.preventDefault?.();
    if (busy || !activeProject) {
      return null;
    }
    const saveSchedule = api?.schedulePaperFinding;
    if (typeof saveSchedule !== 'function') {
      setStatus('Scheduled paper finding is unavailable in this build.', { error: true });
      return null;
    }
    setBusy(true);
    setStatus(activeTask ? 'Saving schedule...' : 'Creating schedule...');
    try {
      const response = await saveSchedule(buildInput());
      if (response?.ok !== true || !response.task) {
        setStatus(response?.error || 'Could not save the paper-finding schedule.', { error: true });
        return null;
      }
      syncTask(response.task);
      hydrateFields(response.task);
      setStatus('Schedule saved. Results will remain metadata-only.');
      onTaskChanged(response.task);
      return response.task;
    } catch (error) {
      setStatus(error?.message || 'Could not save the paper-finding schedule.', { error: true });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    if (busy || !activeTask?.id || typeof api?.runPaperFindingTask !== 'function') {
      return null;
    }
    setBusy(true);
    setStatus('Finding papers...');
    try {
      const response = await api.runPaperFindingTask(activeTask.id);
      if (response?.ok !== true) {
        setStatus(response?.error || 'Paper finding failed.', { error: true });
        return null;
      }
      if (response.task) {
        syncTask(response.task);
      }
      renderResults(response.task || activeTask);
      const paperCount = paperCountFromRun(response);
      setStatus(
        paperCount
          ? `Found ${paperCount} paper card${paperCount === 1 ? '' : 's'} as metadata.`
          : 'Paper finding completed with no matching cards.'
      );
      onTaskChanged(response.task || activeTask);
      return response;
    } catch (error) {
      setStatus(error?.message || 'Paper finding failed.', { error: true });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    if (busy || !activeTask?.id || typeof api?.updateScheduledTask !== 'function') {
      return null;
    }
    const nextEnabled = activeTask.enabled === false;
    setBusy(true);
    setStatus(nextEnabled ? 'Resuming schedule...' : 'Pausing schedule...');
    try {
      const response = await api.updateScheduledTask(activeTask.id, { enabled: nextEnabled });
      if (response?.ok !== true || !response.task) {
        setStatus(response?.error || 'Could not update the schedule.', { error: true });
        return null;
      }
      syncTask(response.task);
      setStatus(nextEnabled ? 'Paper finding resumed.' : 'Paper finding paused.');
      onTaskChanged(response.task);
      return response.task;
    } catch (error) {
      setStatus(error?.message || 'Could not update the schedule.', { error: true });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || !activeTask?.id || typeof api?.deletePaperFindingTask !== 'function') {
      return null;
    }
    setBusy(true);
    setStatus('Removing schedule...');
    try {
      const response = await api.deletePaperFindingTask(activeTask.id);
      if (response?.ok !== true) {
        setStatus(response?.error || 'Could not remove the schedule.', { error: true });
        return null;
      }
      syncTask(null);
      hydrateFields(null);
      renderResults(null);
      setStatus('Paper-finding schedule removed.');
      onTaskChanged(null);
      return response;
    } catch (error) {
      setStatus(error?.message || 'Could not remove the schedule.', { error: true });
      return null;
    } finally {
      setBusy(false);
    }
  }

  function onHostSubmit(event) {
    const form = event?.target?.closest?.('[data-paper-finder-form]')
      || (event?.target?.dataset?.paperFinderForm !== undefined ? event.target : null);
    if (form) {
      void save(event);
    }
  }

  function onHostClick(event) {
    const target = event?.target;
    if (target?.closest?.('[data-paper-finder-run]') || target?.dataset?.paperFinderRun !== undefined) {
      void runNow();
    } else if (target?.closest?.('[data-paper-finder-toggle]') || target?.dataset?.paperFinderToggle !== undefined) {
      void toggleEnabled();
    } else if (target?.closest?.('[data-paper-finder-remove]') || target?.dataset?.paperFinderRemove !== undefined) {
      void remove();
    }
  }

  host?.addEventListener?.('submit', onHostSubmit);
  host?.addEventListener?.('click', onHostClick);

  return {
    getActiveTask: () => activeTask,
    load,
    remove,
    runNow,
    save,
    syncTask,
    toggleEnabled
  };
}
