export function initHomeDashboard({
  state,
  persist,
  safeText,
  onOpenSampleSearch = () => {}
}) {
  const passageSummary = document.getElementById('dashboard-passage-summary');
  const overdueList = document.getElementById('dashboard-passage-overdue-list');
  const soonList = document.getElementById('dashboard-passage-soon-list');
  const unconfiguredList = document.getElementById('dashboard-passage-unconfigured-list');

  const workflowSelect = document.getElementById('dashboard-workflow-select');
  const workflowNextStep = document.getElementById('dashboard-workflow-next-step');
  const workflowProgressList = document.getElementById('dashboard-workflow-progress-list');

  const timerDisplay = document.getElementById('dashboard-timer-display');
  const timerStatus = document.getElementById('dashboard-timer-status');
  const timerCustomMinutesInput = document.getElementById('dashboard-timer-custom-minutes');
  const timerSetBtn = document.getElementById('dashboard-timer-set-btn');
  const timerStartBtn = document.getElementById('dashboard-timer-start-btn');
  const timerPauseBtn = document.getElementById('dashboard-timer-pause-btn');
  const timerResetBtn = document.getElementById('dashboard-timer-reset-btn');
  const presetButtons = [...document.querySelectorAll('[data-dashboard-preset-minutes]')];

  if (
    !passageSummary
    || !overdueList
    || !soonList
    || !unconfiguredList
    || !workflowSelect
    || !workflowNextStep
    || !workflowProgressList
    || !timerDisplay
    || !timerStatus
    || !timerCustomMinutesInput
    || !timerSetBtn
    || !timerStartBtn
    || !timerPauseBtn
    || !timerResetBtn
  ) {
    return {
      render: () => {}
    };
  }

  const timerState = {
    durationMs: 15 * 60 * 1000,
    remainingMs: 15 * 60 * 1000,
    running: false,
    endAtMs: 0,
    alert: false
  };
  let timerTickHandle = 0;
  let timerHint = '';

  overdueList.addEventListener('click', onPassageListClick);
  soonList.addEventListener('click', onPassageListClick);
  unconfiguredList.addEventListener('click', onPassageListClick);
  workflowSelect.addEventListener('change', onWorkflowSelected);
  workflowProgressList.addEventListener('click', onWorkflowProgressClick);
  timerSetBtn.addEventListener('click', onTimerSet);
  timerStartBtn.addEventListener('click', onTimerStart);
  timerPauseBtn.addEventListener('click', onTimerPause);
  timerResetBtn.addEventListener('click', onTimerReset);
  timerCustomMinutesInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    onTimerSet();
  });
  presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const minutes = Number(button.dataset.dashboardPresetMinutes);
      setTimerDuration(minutes);
    });
  });

  function ensureDashboardState() {
    if (!state.settings || typeof state.settings !== 'object') {
      state.settings = {};
    }
    if (!state.settings.dashboard || typeof state.settings.dashboard !== 'object') {
      state.settings.dashboard = {
        currentWorkflowId: '',
        workflowProgress: {}
      };
      return true;
    }
    let changed = false;
    if (typeof state.settings.dashboard.currentWorkflowId !== 'string') {
      state.settings.dashboard.currentWorkflowId = '';
      changed = true;
    }
    if (
      !state.settings.dashboard.workflowProgress
      || typeof state.settings.dashboard.workflowProgress !== 'object'
      || Array.isArray(state.settings.dashboard.workflowProgress)
    ) {
      state.settings.dashboard.workflowProgress = {};
      changed = true;
    }
    return changed;
  }

  function parseWorkflowTimestamp(workflow) {
    const parsed = Date.parse(String(workflow?.updatedAt || workflow?.createdAt || '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function workflowsSortedByRecent() {
    return [...(Array.isArray(state.workflows) ? state.workflows : [])]
      .sort((a, b) => parseWorkflowTimestamp(b) - parseWorkflowTimestamp(a));
  }

  function normalizeWorkflowProgress(workflow) {
    const dashboard = state.settings.dashboard;
    const map = dashboard.workflowProgress;
    const workflowId = String(workflow?.id || '');
    const raw = Array.isArray(map[workflowId]) ? map[workflowId] : [];
    const validBlockIds = new Set((workflow?.blocks || []).map((block) => String(block?.id || '')));
    const seen = new Set();
    const normalized = [];
    raw.forEach((blockId) => {
      const id = String(blockId || '').trim();
      if (!id || seen.has(id) || !validBlockIds.has(id)) {
        return;
      }
      seen.add(id);
      normalized.push(id);
    });
    if (normalized.length !== raw.length || !Array.isArray(map[workflowId])) {
      map[workflowId] = normalized;
      return true;
    }
    return false;
  }

  function pruneWorkflowProgress(workflows) {
    const known = new Set(workflows.map((workflow) => String(workflow?.id || '')).filter(Boolean));
    const progressMap = state.settings.dashboard.workflowProgress;
    let changed = false;
    Object.keys(progressMap).forEach((workflowId) => {
      if (known.has(workflowId)) {
        return;
      }
      delete progressMap[workflowId];
      changed = true;
    });
    return changed;
  }

  function normalizeCurrentWorkflowId(workflows) {
    const dashboard = state.settings.dashboard;
    const currentId = String(dashboard.currentWorkflowId || '');
    const hasCurrent = currentId && workflows.some((workflow) => workflow.id === currentId);
    if (hasCurrent) {
      return false;
    }
    const nextId = workflows[0]?.id || '';
    if (nextId === currentId) {
      return false;
    }
    dashboard.currentWorkflowId = nextId;
    return true;
  }

  function parseLocalDate(dateString) {
    const raw = String(dateString || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return null;
    }
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, monthIndex, day);
    if (
      date.getFullYear() !== year
      || date.getMonth() !== monthIndex
      || date.getDate() !== day
    ) {
      return null;
    }
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatRelativeDays(dayDelta) {
    if (dayDelta === 0) {
      return 'due today';
    }
    if (dayDelta > 0) {
      return `due in ${dayDelta} day(s)`;
    }
    return `overdue by ${Math.abs(dayDelta)} day(s)`;
  }

  function renderPassageRows(host, rows, { section }) {
    if (!rows.length) {
      host.innerHTML = '<p class="small-note">None.</p>';
      return;
    }
    host.innerHTML = rows.map((row) => {
      const mainLabel = row.sample.code
        ? `${row.sample.code} - ${row.sample.name || ''}`
        : (row.sample.name || row.sample.id || 'Unnamed sample');
      const detail = section === 'unconfigured'
        ? 'Missing passage date or interval.'
        : `${formatDateLocal(row.dueDate)} (${formatRelativeDays(row.daysFromToday)})`;
      const query = row.sample.code || row.sample.name || row.sample.id || '';
      return `
        <article class="dashboard-item">
          <div>
            <strong>${safeText(mainLabel)}</strong>
            <p class="small-note">${safeText(detail)}</p>
          </div>
          <button
            type="button"
            class="ghost-btn"
            data-dashboard-open-sample="${safeText(query)}"
          >Open</button>
        </article>
      `;
    }).join('');
  }

  function renderPassageWidget() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const soonLimit = new Date(today);
    soonLimit.setDate(soonLimit.getDate() + 3);

    const overdue = [];
    const soon = [];
    const unconfigured = [];

    (Array.isArray(state.samples) ? state.samples : []).forEach((sample) => {
      if (String(sample?.type || '').trim().toLowerCase() !== 'cell_line') {
        return;
      }
      const dateValue = String(sample?.cellPassage?.lastPassageDate || '').trim();
      const interval = Math.round(Number(sample?.cellPassage?.intervalDays));
      const lastPassage = parseLocalDate(dateValue);
      if (!lastPassage || !Number.isFinite(interval) || interval <= 0) {
        unconfigured.push({ sample });
        return;
      }
      const dueDate = new Date(lastPassage);
      dueDate.setDate(dueDate.getDate() + interval);
      dueDate.setHours(0, 0, 0, 0);
      const daysFromToday = Math.round((dueDate.getTime() - today.getTime()) / 86400000);
      const row = { sample, dueDate, daysFromToday };
      if (dueDate.getTime() < today.getTime()) {
        overdue.push(row);
      } else if (dueDate.getTime() <= soonLimit.getTime()) {
        soon.push(row);
      }
    });

    overdue.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    soon.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    unconfigured.sort((a, b) => String(a.sample?.updatedAt || '').localeCompare(String(b.sample?.updatedAt || '')));

    passageSummary.textContent = `Overdue: ${overdue.length} | Due in 3 days: ${soon.length} | Unconfigured: ${unconfigured.length}`;
    renderPassageRows(overdueList, overdue, { section: 'overdue' });
    renderPassageRows(soonList, soon, { section: 'soon' });
    renderPassageRows(unconfiguredList, unconfigured, { section: 'unconfigured' });
  }

  function protocolNameById(protocolId) {
    const protocol = (Array.isArray(state.protocols) ? state.protocols : [])
      .find((item) => item.id === protocolId);
    return protocol?.name || 'Missing protocol';
  }

  function memberNameById(memberId) {
    if (!memberId) {
      return 'Unassigned';
    }
    const member = (Array.isArray(state.members) ? state.members : [])
      .find((item) => item.id === memberId);
    return member?.name || memberId;
  }

  function blockLabel(block, index) {
    const type = String(block?.type || '').trim().toLowerCase();
    if (type === 'protocol') {
      return `Block ${index + 1}: ${protocolNameById(String(block?.protocolId || ''))}`;
    }
    const text = String(block?.text || '').trim();
    return `Block ${index + 1}: ${text || 'Text block'}`;
  }

  function buildUpstreamMap(workflow) {
    const map = new Map();
    (workflow?.blocks || []).forEach((block) => {
      map.set(block.id, []);
    });
    (workflow?.links || []).forEach((link) => {
      const toId = String(link?.toBlockId || '').trim();
      const fromId = String(link?.fromBlockId || '').trim();
      if (!toId || !fromId || !map.has(toId)) {
        return;
      }
      map.get(toId).push(fromId);
    });
    return map;
  }

  function computeNextStep(workflow, finishedSet) {
    const blocks = Array.isArray(workflow?.blocks) ? workflow.blocks : [];
    const unfinished = blocks.filter((block) => !finishedSet.has(block.id));
    if (!unfinished.length) {
      return { block: null, complete: true, fallback: false };
    }
    const upstreamMap = buildUpstreamMap(workflow);
    for (const block of unfinished) {
      const upstream = upstreamMap.get(block.id) || [];
      if (upstream.every((upstreamId) => finishedSet.has(upstreamId))) {
        return { block, complete: false, fallback: false };
      }
    }
    return { block: unfinished[0], complete: false, fallback: true };
  }

  function renderWorkflowWidget() {
    const workflows = workflowsSortedByRecent();
    let changed = false;
    changed = pruneWorkflowProgress(workflows) || changed;
    changed = normalizeCurrentWorkflowId(workflows) || changed;

    const currentWorkflowId = String(state.settings.dashboard.currentWorkflowId || '');
    workflowSelect.innerHTML = workflows.length
      ? workflows.map((workflow) => (
        `<option value="${safeText(workflow.id)}">${safeText(workflow.name || 'Untitled workflow')}</option>`
      )).join('')
      : '<option value="">No workflows available</option>';
    workflowSelect.disabled = !workflows.length;
    if (workflows.length) {
      workflowSelect.value = currentWorkflowId;
    } else {
      workflowSelect.value = '';
    }

    const workflow = workflows.find((item) => item.id === currentWorkflowId);
    if (!workflow) {
      workflowNextStep.textContent = 'No workflow selected. Create a workflow to track next steps.';
      workflowProgressList.innerHTML = '<p class="small-note">No workflow progress to display.</p>';
      if (changed) {
        persist();
      }
      return;
    }

    changed = normalizeWorkflowProgress(workflow) || changed;
    const finished = new Set(state.settings.dashboard.workflowProgress[workflow.id] || []);
    const next = computeNextStep(workflow, finished);
    const total = workflow.blocks.length;
    const doneCount = finished.size;
    if (next.complete) {
      workflowNextStep.textContent = `Workflow complete (${doneCount}/${total} blocks).`;
    } else {
      const index = workflow.blocks.findIndex((block) => block.id === next.block.id);
      const title = blockLabel(next.block, index);
      const prefix = next.fallback ? 'Next (fallback):' : 'Next:';
      workflowNextStep.textContent = `${prefix} ${title} (${doneCount}/${total} done)`;
    }

    workflowProgressList.innerHTML = workflow.blocks.length
      ? workflow.blocks.map((block, index) => {
        const isDone = finished.has(block.id);
        const assignee = memberNameById(String(block.assigneeId || ''));
        return `
          <article class="dashboard-item${isDone ? ' is-done' : ''}">
            <div>
              <strong>${safeText(blockLabel(block, index))}</strong>
              <p class="small-note">Assignee: ${safeText(assignee)}</p>
            </div>
            <button
              type="button"
              class="ghost-btn"
              data-dashboard-workflow-toggle="${safeText(block.id)}"
            >${isDone ? 'Undo' : 'Done'}</button>
          </article>
        `;
      }).join('')
      : '<p class="small-note">This workflow has no blocks yet.</p>';

    if (changed) {
      persist();
    }
  }

  function formatTimer(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function stopTimerTick() {
    if (!timerTickHandle) {
      return;
    }
    window.clearInterval(timerTickHandle);
    timerTickHandle = 0;
  }

  function startTimerTick() {
    if (timerTickHandle) {
      return;
    }
    timerTickHandle = window.setInterval(onTimerTick, 250);
  }

  function syncRemainingFromNow() {
    if (!timerState.running) {
      return;
    }
    timerState.remainingMs = Math.max(0, timerState.endAtMs - Date.now());
  }

  function setTimerDuration(minutes) {
    const rounded = Math.round(Number(minutes));
    if (!Number.isFinite(rounded) || rounded <= 0) {
      timerHint = 'Enter a valid minute value.';
      renderTimerWidget();
      return;
    }
    const durationMs = rounded * 60 * 1000;
    timerState.durationMs = durationMs;
    timerState.remainingMs = durationMs;
    timerState.running = false;
    timerState.endAtMs = 0;
    timerState.alert = false;
    timerHint = '';
    stopTimerTick();
    if (timerCustomMinutesInput) {
      timerCustomMinutesInput.value = String(rounded);
    }
    renderTimerWidget();
  }

  function renderTimerWidget() {
    syncRemainingFromNow();
    timerDisplay.textContent = formatTimer(timerState.remainingMs);
    timerDisplay.classList.toggle('is-alert', timerState.alert);

    if (timerHint) {
      timerStatus.textContent = timerHint;
    } else if (timerState.alert) {
      timerStatus.textContent = "Time's up.";
    } else if (timerState.running) {
      timerStatus.textContent = 'Running';
    } else if (timerState.remainingMs < timerState.durationMs) {
      timerStatus.textContent = 'Paused';
    } else {
      timerStatus.textContent = 'Ready';
    }

    timerStartBtn.disabled = timerState.running;
    timerPauseBtn.disabled = !timerState.running;
  }

  function onTimerTick() {
    syncRemainingFromNow();
    if (timerState.remainingMs > 0) {
      renderTimerWidget();
      return;
    }
    timerState.remainingMs = 0;
    timerState.running = false;
    timerState.endAtMs = 0;
    timerState.alert = true;
    stopTimerTick();
    timerHint = '';
    renderTimerWidget();
  }

  function onTimerSet() {
    setTimerDuration(timerCustomMinutesInput.value);
  }

  function onTimerStart() {
    if (timerState.running) {
      return;
    }
    if (timerState.remainingMs <= 0 || timerState.alert) {
      timerState.remainingMs = timerState.durationMs;
    }
    timerState.running = true;
    timerState.alert = false;
    timerHint = '';
    timerState.endAtMs = Date.now() + timerState.remainingMs;
    startTimerTick();
    renderTimerWidget();
  }

  function onTimerPause() {
    if (!timerState.running) {
      return;
    }
    syncRemainingFromNow();
    timerState.running = false;
    timerState.endAtMs = 0;
    stopTimerTick();
    timerHint = '';
    renderTimerWidget();
  }

  function onTimerReset() {
    timerState.running = false;
    timerState.endAtMs = 0;
    timerState.remainingMs = timerState.durationMs;
    timerState.alert = false;
    timerHint = '';
    stopTimerTick();
    renderTimerWidget();
  }

  function onPassageListClick(event) {
    const button = event.target.closest('[data-dashboard-open-sample]');
    if (!button) {
      return;
    }
    const query = String(button.dataset.dashboardOpenSample || '').trim();
    onOpenSampleSearch(query);
  }

  function onWorkflowSelected() {
    ensureDashboardState();
    state.settings.dashboard.currentWorkflowId = String(workflowSelect.value || '');
    persist();
    renderWorkflowWidget();
  }

  function onWorkflowProgressClick(event) {
    const button = event.target.closest('[data-dashboard-workflow-toggle]');
    if (!button) {
      return;
    }
    const blockId = String(button.dataset.dashboardWorkflowToggle || '').trim();
    if (!blockId) {
      return;
    }

    const workflowId = String(state.settings.dashboard.currentWorkflowId || '');
    const workflow = (Array.isArray(state.workflows) ? state.workflows : [])
      .find((item) => item.id === workflowId);
    if (!workflow) {
      return;
    }
    const progressMap = state.settings.dashboard.workflowProgress;
    const current = new Set(Array.isArray(progressMap[workflowId]) ? progressMap[workflowId] : []);
    if (current.has(blockId)) {
      current.delete(blockId);
    } else {
      current.add(blockId);
    }
    progressMap[workflowId] = workflow.blocks
      .map((block) => block.id)
      .filter((id) => current.has(id));
    persist();
    renderWorkflowWidget();
  }

  function render() {
    if (ensureDashboardState()) {
      persist();
    }
    renderPassageWidget();
    renderWorkflowWidget();
    renderTimerWidget();
  }

  return {
    render
  };
}
