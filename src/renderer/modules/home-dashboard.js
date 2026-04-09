// Home dashboard controller.
//
// Responsibilities:
// - summarize urgent bench work for the home screen
// - surface cell-passage reminders, planned notebook follow-ups, and workflow progress
// - provide a lightweight dashboard timer with presets, pause, and reset support
// - bridge quick-log notes into the assistant or notebook workspace
export function initHomeDashboard({
  state,
  persist,
  safeText,
  onOpenSampleSearch = () => {},
  onOpenSamples = () => onOpenSampleSearch(''),
  onOpenNotebook = () => {},
  onOpenWorkflow = () => {},
  onOpenAssistant = () => {},
  onSendQuickLogToAgent = () => false
}) {
  const todaySummary = document.getElementById('dashboard-today-summary');
  const todayOverdueCount = document.getElementById('dashboard-today-overdue-count');
  const todayWorkflowCount = document.getElementById('dashboard-today-workflow-count');
  const todayIncubationCount = document.getElementById('dashboard-today-incubation-count');
  const todayList = document.getElementById('dashboard-today-list');

  const passageSummary = document.getElementById('dashboard-passage-summary');
  const overdueList = document.getElementById('dashboard-passage-overdue-list');
  const soonList = document.getElementById('dashboard-passage-soon-list');
  const unconfiguredList = document.getElementById('dashboard-passage-unconfigured-list');

  const workflowSelect = document.getElementById('dashboard-workflow-select');
  const workflowNextStep = document.getElementById('dashboard-workflow-next-step');
  const workflowProgressList = document.getElementById('dashboard-workflow-progress-list');

  const incubationSummary = document.getElementById('dashboard-incubation-summary');
  const incubationList = document.getElementById('dashboard-incubation-list');

  const quickLogInput = document.getElementById('dashboard-quick-log-input');
  const quickLogStatus = document.getElementById('dashboard-quick-log-status');
  const quickLogAgentBtn = document.getElementById('dashboard-quick-log-agent-btn');
  const quickLogNotebookBtn = document.getElementById('dashboard-quick-log-notebook-btn');
  const quickLogClearBtn = document.getElementById('dashboard-quick-log-clear-btn');

  const localTimeDisplay = document.getElementById('dashboard-local-time');
  const localDateDisplay = document.getElementById('dashboard-local-date');
  const timerDisplay = document.getElementById('dashboard-timer-display');
  const timerStatus = document.getElementById('dashboard-timer-status');
  const timerSavedList = document.getElementById('dashboard-timer-saved-list');
  const timerCustomMinutesInput = document.getElementById('dashboard-timer-custom-minutes');
  const timerSetBtn = document.getElementById('dashboard-timer-set-btn');
  const timerStartBtn = document.getElementById('dashboard-timer-start-btn');
  const timerPauseBtn = document.getElementById('dashboard-timer-pause-btn');
  const timerResetBtn = document.getElementById('dashboard-timer-reset-btn');
  const presetButtons = [...document.querySelectorAll('[data-dashboard-preset-minutes]')];
  const quickActionButtons = [...document.querySelectorAll('[data-dashboard-action]')];

  if (
    !todaySummary
    || !todayOverdueCount
    || !todayWorkflowCount
    || !todayIncubationCount
    || !todayList
    || !passageSummary
    || !overdueList
    || !soonList
    || !unconfiguredList
    || !workflowSelect
    || !workflowNextStep
    || !workflowProgressList
    || !incubationSummary
    || !incubationList
    || !quickLogInput
    || !quickLogStatus
    || !quickLogAgentBtn
    || !quickLogNotebookBtn
    || !quickLogClearBtn
    || !localTimeDisplay
    || !localDateDisplay
    || !timerDisplay
    || !timerStatus
    || !timerSavedList
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
    alert: false,
    savedDurations: [15, 10, 30, 5]
  };
  let timerTickHandle = 0;
  let localClockHandle = 0;
  let timerHint = '';

  overdueList.addEventListener('click', onPassageListClick);
  soonList.addEventListener('click', onPassageListClick);
  unconfiguredList.addEventListener('click', onPassageListClick);
  todayList.addEventListener('click', onDashboardActionClick);
  workflowSelect.addEventListener('change', onWorkflowSelected);
  workflowProgressList.addEventListener('click', onWorkflowProgressClick);
  incubationList.addEventListener('click', onDashboardActionClick);
  quickActionButtons.forEach((button) => {
    button.addEventListener('click', onQuickActionClick);
  });
  quickLogInput.addEventListener('input', onQuickLogInput);
  quickLogInput.addEventListener('keydown', onQuickLogKeydown);
  quickLogAgentBtn.addEventListener('click', onQuickLogSendToAgent);
  quickLogNotebookBtn.addEventListener('click', () => {
    onOpenNotebook();
    setQuickLogStatus('Notebook opened.');
  });
  quickLogClearBtn.addEventListener('click', onQuickLogClear);
  timerSavedList.addEventListener('click', onSavedTimerClick);
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

  renderLocalClock();
  localClockHandle = window.setInterval(renderLocalClock, 1000);

  function ensureDashboardState() {
    if (!state.settings || typeof state.settings !== 'object') {
      state.settings = {};
    }
    if (!state.settings.dashboard || typeof state.settings.dashboard !== 'object') {
      state.settings.dashboard = {
        currentWorkflowId: '',
        workflowProgress: {},
        quickLogDraft: ''
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
    if (typeof state.settings.dashboard.quickLogDraft !== 'string') {
      state.settings.dashboard.quickLogDraft = '';
      changed = true;
    }
    return changed;
  }

  function sampleLabel(sample) {
    const code = String(sample?.code || '').trim();
    const name = String(sample?.name || '').trim();
    if (code && name) {
      return `${code} - ${name}`;
    }
    return code || name || String(sample?.id || 'Unnamed sample');
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

  function parseTimestamp(rawValue) {
    const parsed = Date.parse(String(rawValue || '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatWaitingAge(timestampMs) {
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
      return 'waiting';
    }
    const elapsedMs = Math.max(0, Date.now() - timestampMs);
    const elapsedHours = Math.floor(elapsedMs / 3600000);
    const elapsedDays = Math.floor(elapsedMs / 86400000);
    if (elapsedDays >= 1) {
      return `${elapsedDays} day(s) waiting`;
    }
    if (elapsedHours >= 1) {
      return `${elapsedHours} hour(s) waiting`;
    }
    return 'started today';
  }

  function renderPassageRows(host, rows, { section }) {
    if (!rows.length) {
      host.innerHTML = '<p class="small-note">None.</p>';
      return;
    }
    host.innerHTML = rows.map((row) => {
      const detail = section === 'unconfigured'
        ? 'Missing passage date or interval.'
        : `${formatDateLocal(row.dueDate)} (${formatRelativeDays(row.daysFromToday)})`;
      const query = row.sample.code || row.sample.name || row.sample.id || '';
      return `
        <article class="dashboard-item">
          <div>
            <strong>${safeText(sampleLabel(row.sample))}</strong>
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

  function collectPassageRows() {
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

    return {
      overdue,
      soon,
      unconfigured
    };
  }

  function renderPassageWidget(passageRows) {
    passageSummary.textContent = `Overdue: ${passageRows.overdue.length} | Due in 3 days: ${passageRows.soon.length} | Unconfigured: ${passageRows.unconfigured.length}`;
    renderPassageRows(overdueList, passageRows.overdue, { section: 'overdue' });
    renderPassageRows(soonList, passageRows.soon, { section: 'soon' });
    renderPassageRows(unconfiguredList, passageRows.unconfigured, { section: 'unconfigured' });
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

  function buildWorkflowContext() {
    const workflows = workflowsSortedByRecent();
    let changed = false;
    changed = pruneWorkflowProgress(workflows) || changed;
    changed = normalizeCurrentWorkflowId(workflows) || changed;

    const currentWorkflowId = String(state.settings.dashboard.currentWorkflowId || '');
    const workflow = workflows.find((item) => item.id === currentWorkflowId) || null;
    let finished = new Set();
    let next = { block: null, complete: false, fallback: false };

    if (workflow) {
      changed = normalizeWorkflowProgress(workflow) || changed;
      finished = new Set(state.settings.dashboard.workflowProgress[workflow.id] || []);
      next = computeNextStep(workflow, finished);
    }

    return {
      workflows,
      currentWorkflowId,
      workflow,
      finished,
      next,
      changed
    };
  }

  function renderWorkflowWidget(context) {
    const { workflows, currentWorkflowId, workflow, finished, next } = context;
    workflowSelect.innerHTML = workflows.length
      ? workflows.map((item) => (
        `<option value="${safeText(item.id)}">${safeText(item.name || 'Untitled workflow')}</option>`
      )).join('')
      : '<option value="">No workflows available</option>';
    workflowSelect.disabled = !workflows.length;
    workflowSelect.value = workflows.length ? currentWorkflowId : '';

    if (!workflow) {
      workflowNextStep.textContent = 'No workflow selected. Create a workflow to track next steps.';
      workflowProgressList.innerHTML = '<p class="small-note">No workflow progress to display.</p>';
      return;
    }

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
  }

  function collectIncubationRows() {
    return (Array.isArray(state.notebookEntries) ? state.notebookEntries : [])
      .filter((entry) => String(entry?.notebookState || '').trim().toLowerCase() === 'planned')
      .map((entry) => ({
        entry,
        timestampMs: parseTimestamp(entry?.updatedAt || entry?.createdAt || '')
      }))
      .sort((a, b) => a.timestampMs - b.timestampMs);
  }

  function renderIncubationWidget(rows) {
    incubationSummary.textContent = rows.length
      ? `${rows.length} planned notebook follow-up(s) still waiting.`
      : 'No planned follow-ups waiting.';
    if (!rows.length) {
      incubationList.innerHTML = '<p class="small-note">Nothing is parked in a planned state right now.</p>';
      return;
    }
    incubationList.innerHTML = rows.map(({ entry, timestampMs }) => `
      <article class="dashboard-item">
        <div>
          <strong>${safeText(String(entry?.protocolName || 'Untitled notebook page'))}</strong>
          <p class="small-note">${safeText(String(entry?.projectName || 'Unassigned project'))} | ${safeText(formatWaitingAge(timestampMs))}</p>
        </div>
        <button
          type="button"
          class="ghost-btn"
          data-dashboard-action="notebook"
        >Open</button>
      </article>
    `).join('');
  }

  function buildTodayItems({ passageRows, workflowContext, incubationRows }) {
    const items = [];
    const workflow = workflowContext.workflow;
    const workflowOpenCount = workflow
      ? Math.max(0, workflow.blocks.length - workflowContext.finished.size)
      : 0;

    if (workflow && !workflowContext.next.complete && workflowContext.next.block) {
      const nextIndex = workflow.blocks.findIndex((block) => block.id === workflowContext.next.block.id);
      items.push({
        title: blockLabel(workflowContext.next.block, nextIndex),
        detail: `${workflowContext.finished.size}/${workflow.blocks.length} blocks complete`,
        action: 'workflow',
        actionLabel: 'Workflow'
      });
    }

    passageRows.overdue.slice(0, 2).forEach((row) => {
      items.push({
        title: sampleLabel(row.sample),
        detail: `Cell passage ${formatRelativeDays(row.daysFromToday)}`,
        action: 'samples',
        actionLabel: 'Samples'
      });
    });

    if (!passageRows.overdue.length) {
      passageRows.soon.slice(0, 1).forEach((row) => {
        items.push({
          title: sampleLabel(row.sample),
          detail: `Cell passage ${formatRelativeDays(row.daysFromToday)}`,
          action: 'samples',
          actionLabel: 'Samples'
        });
      });
    }

    incubationRows.slice(0, 2).forEach(({ entry, timestampMs }) => {
      items.push({
        title: String(entry?.protocolName || 'Planned notebook follow-up'),
        detail: `${String(entry?.projectName || 'Unassigned project')} | ${formatWaitingAge(timestampMs)}`,
        action: 'notebook',
        actionLabel: 'Notebook'
      });
    });

    return {
      items: items.slice(0, 4),
      counts: {
        overdue: passageRows.overdue.length,
        workflowOpen: workflowOpenCount,
        incubation: incubationRows.length
      }
    };
  }

  function renderTodayWidget(todayData) {
    todayOverdueCount.textContent = String(todayData.counts.overdue);
    todayWorkflowCount.textContent = String(todayData.counts.workflowOpen);
    todayIncubationCount.textContent = String(todayData.counts.incubation);

    if (!todayData.items.length) {
      todaySummary.textContent = 'Nothing urgent is waiting on the bench right now.';
      todayList.innerHTML = '<p class="small-note">The dashboard is clear. Use Quick Actions to jump into a workspace.</p>';
      return;
    }

    todaySummary.textContent = `${todayData.items.length} active item(s) need attention today.`;
    todayList.innerHTML = todayData.items.map((item) => `
      <article class="dashboard-item">
        <div>
          <strong>${safeText(item.title)}</strong>
          <p class="small-note">${safeText(item.detail)}</p>
        </div>
        <button
          type="button"
          class="ghost-btn"
          data-dashboard-action="${safeText(item.action)}"
        >${safeText(item.actionLabel)}</button>
      </article>
    `).join('');
  }

  function syncQuickLogInput() {
    const draft = String(state.settings.dashboard.quickLogDraft || '');
    if (quickLogInput.value !== draft) {
      quickLogInput.value = draft;
    }
  }

  function setQuickLogStatus(message) {
    quickLogStatus.textContent = String(message || '').trim() || 'Type a bench note to keep it handy on this screen.';
  }

  function renderQuickLogWidget() {
    syncQuickLogInput();
    if (String(state.settings.dashboard.quickLogDraft || '').trim()) {
      setQuickLogStatus('Draft saved locally. Press Command/Ctrl+Enter to send it to the Assistant.');
      return;
    }
    setQuickLogStatus('Type a bench note to keep it handy on this screen.');
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

  function formatTimerSummary(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m left`;
    }
    return `${minutes}m ${String(seconds).padStart(2, '0')}s left`;
  }

  function renderLocalClock() {
    const now = new Date();
    localTimeDisplay.textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    localDateDisplay.textContent = now.toLocaleDateString([], {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });
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
    timerState.savedDurations = [
      rounded,
      ...timerState.savedDurations.filter((value) => value !== rounded)
    ].slice(0, 4);
    const durationMs = rounded * 60 * 1000;
    timerState.durationMs = durationMs;
    timerState.remainingMs = durationMs;
    timerState.running = false;
    timerState.endAtMs = 0;
    timerState.alert = false;
    timerHint = '';
    stopTimerTick();
    timerCustomMinutesInput.value = String(rounded);
    renderTimerWidget();
  }

  function renderSavedTimers() {
    const currentMinutes = Math.max(1, Math.round(timerState.durationMs / 60000));
    const rows = [
      {
        minutes: currentMinutes,
        title: timerState.running
          ? 'Current countdown'
          : (timerState.remainingMs < timerState.durationMs ? 'Paused timer' : 'Loaded timer'),
        value: timerState.running
          ? formatTimerSummary(timerState.remainingMs)
          : `${currentMinutes}m ready`,
        active: true
      },
      ...timerState.savedDurations
        .filter((minutes) => minutes !== currentMinutes)
        .map((minutes) => ({
          minutes,
          title: `${minutes} minute timer`,
          value: 'Tap to load',
          active: false
        }))
    ];

    timerSavedList.innerHTML = rows.map((row) => `
      <button
        type="button"
        class="dashboard-timer-row${row.active ? ' is-active' : ''}"
        data-dashboard-saved-minutes="${row.minutes}"
      >
        <span class="dashboard-timer-row-title">${safeText(row.title)}</span>
        <span class="dashboard-timer-row-value">${safeText(row.value)}</span>
      </button>
    `).join('');
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
    renderSavedTimers();
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

  function onSavedTimerClick(event) {
    const button = event.target.closest('[data-dashboard-saved-minutes]');
    if (!button) {
      return;
    }
    const minutes = Number(button.dataset.dashboardSavedMinutes);
    setTimerDuration(minutes);
  }

  function onPassageListClick(event) {
    const button = event.target.closest('[data-dashboard-open-sample]');
    if (!button) {
      return;
    }
    const query = String(button.dataset.dashboardOpenSample || '').trim();
    onOpenSampleSearch(query);
  }

  function runDashboardAction(action) {
    const normalized = String(action || '').trim().toLowerCase();
    if (!normalized) {
      return;
    }
    if (normalized === 'samples') {
      onOpenSamples();
      return;
    }
    if (normalized === 'workflow') {
      onOpenWorkflow();
      return;
    }
    if (normalized === 'notebook') {
      onOpenNotebook();
      return;
    }
    if (normalized === 'assistant') {
      onOpenAssistant();
    }
  }

  function onDashboardActionClick(event) {
    const button = event.target.closest('[data-dashboard-action]');
    if (!button) {
      return;
    }
    runDashboardAction(button.dataset.dashboardAction);
  }

  function onQuickActionClick(event) {
    const button = event.currentTarget;
    runDashboardAction(button?.dataset?.dashboardAction);
  }

  function onQuickLogInput() {
    ensureDashboardState();
    state.settings.dashboard.quickLogDraft = quickLogInput.value;
    persist();
    if (quickLogInput.value.trim()) {
      setQuickLogStatus('Draft saved locally. Press Command/Ctrl+Enter to send it to the Assistant.');
      return;
    }
    setQuickLogStatus('Type a bench note to keep it handy on this screen.');
  }

  function onQuickLogKeydown(event) {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) {
      return;
    }
    event.preventDefault();
    onQuickLogSendToAgent();
  }

  function onQuickLogSendToAgent() {
    const value = quickLogInput.value.trim();
    if (!value) {
      setQuickLogStatus('Add a bench note before sending it to the Assistant.');
      return;
    }
    const sent = onSendQuickLogToAgent(value);
    if (sent === false) {
      setQuickLogStatus('Unable to hand the note to the Assistant from this screen.');
      return;
    }
    state.settings.dashboard.quickLogDraft = '';
    quickLogInput.value = '';
    persist();
    setQuickLogStatus('Sent to Assistant.');
  }

  function onQuickLogClear() {
    state.settings.dashboard.quickLogDraft = '';
    quickLogInput.value = '';
    persist();
    setQuickLogStatus('Quick log cleared.');
  }

  function onWorkflowSelected() {
    ensureDashboardState();
    state.settings.dashboard.currentWorkflowId = String(workflowSelect.value || '');
    persist();
    render();
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
    render();
  }

  function render() {
    let changed = ensureDashboardState();
    if (!localClockHandle) {
      renderLocalClock();
      localClockHandle = window.setInterval(renderLocalClock, 1000);
    }

    const passageRows = collectPassageRows();
    const workflowContext = buildWorkflowContext();
    const incubationRows = collectIncubationRows();
    const todayData = buildTodayItems({
      passageRows,
      workflowContext,
      incubationRows
    });

    changed = workflowContext.changed || changed;
    if (changed) {
      persist();
    }

    renderTodayWidget(todayData);
    renderPassageWidget(passageRows);
    renderWorkflowWidget(workflowContext);
    renderIncubationWidget(incubationRows);
    renderQuickLogWidget();
    renderTimerWidget();
  }

  return {
    render
  };
}
