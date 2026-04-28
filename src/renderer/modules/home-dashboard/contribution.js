import { formatDateLocal, normalizeNotebookState } from './utils.js';

// GitHub-style contribution heatmap covering the past 22 weeks. Aggregates
// notebook entries, completed protocol steps, file uploads, analysis notes,
// and quick logs into per-day buckets.
export function initContributionWidget({ state, safeText, elements }) {
  const { summary, monthLabels, grid } = elements;

  function createContributionBucket() {
    return {
      notebookEntries: 0,
      completedProtocols: 0,
      dataUploads: 0,
      analysisNotes: 0,
      quickLogs: 0,
      total: 0
    };
  }

  function dayKeyFromTimestamp(timestamp) {
    const parsed = new Date(String(timestamp || '').trim());
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    return formatDateLocal(parsed);
  }

  function addContributionActivity(dayMap, timestamp, kind, weight = 1) {
    const dayKey = dayKeyFromTimestamp(timestamp);
    if (!dayKey) {
      return;
    }
    const amount = Math.max(1, Math.round(Number(weight) || 1));
    const bucket = dayMap.get(dayKey) || createContributionBucket();
    if (!Object.prototype.hasOwnProperty.call(bucket, kind)) {
      return;
    }
    bucket[kind] += amount;
    bucket.total += amount;
    dayMap.set(dayKey, bucket);
  }

  function resultTableHasContent(table) {
    const rows = Array.isArray(table?.rows) ? table.rows : [];
    return rows.some((row) => Object.entries(row || {}).some(([key, value]) => (
      key !== 'id' && String(value || '').trim()
    )));
  }

  function collectFileRecordActivity(dayMap, records, fallbackTimestamp) {
    const fileRecords = Array.isArray(records) ? records : [];
    fileRecords.forEach((record) => {
      addContributionActivity(
        dayMap,
        record?.importedAt || record?.updatedAt || fallbackTimestamp,
        'dataUploads'
      );
    });
  }

  function collectNotebookContribution(dayMap) {
    (Array.isArray(state.notebookEntries) ? state.notebookEntries : []).forEach((entry) => {
      const entryTimestamp = entry?.updatedAt || entry?.executedAt || entry?.createdAt;
      addContributionActivity(dayMap, entryTimestamp, 'notebookEntries');

      const isExecuted = normalizeNotebookState(entry?.notebookState) !== 'planned';
      if (isExecuted && (entry?.protocolId || entry?.protocolName || entry?.executedAt)) {
        addContributionActivity(dayMap, entry?.executedAt || entryTimestamp, 'completedProtocols');
      }

      const resultFileRecords = Array.isArray(entry?.resultFileRecords) ? entry.resultFileRecords : [];
      collectFileRecordActivity(dayMap, resultFileRecords, entryTimestamp);
      if (!resultFileRecords.length && Array.isArray(entry?.resultFiles) && entry.resultFiles.length) {
        addContributionActivity(dayMap, entryTimestamp, 'dataUploads', entry.resultFiles.length);
      }

      if (String(entry?.result || '').trim()) {
        addContributionActivity(dayMap, entryTimestamp, 'analysisNotes');
      }
      if (resultTableHasContent(entry?.resultTable)) {
        addContributionActivity(dayMap, entryTimestamp, 'analysisNotes');
      }
      if (Array.isArray(entry?.selectionInsights) && entry.selectionInsights.length) {
        addContributionActivity(dayMap, entryTimestamp, 'analysisNotes');
      }
    });
  }

  function collectWorkflowContribution(dayMap) {
    (Array.isArray(state.workflows) ? state.workflows : []).forEach((workflow) => {
      (Array.isArray(workflow?.entries) ? workflow.entries : []).forEach((entry) => {
        const stepStates = entry?.stepStates && typeof entry.stepStates === 'object' && !Array.isArray(entry.stepStates)
          ? entry.stepStates
          : {};
        Object.values(stepStates).forEach((stepState) => {
          const stepTimestamp = stepState?.updatedAt || stepState?.completedAt || workflow?.updatedAt || workflow?.createdAt;
          if (String(stepState?.status || '').trim().toLowerCase() === 'completed' || stepState?.completedAt) {
            addContributionActivity(dayMap, stepState?.completedAt || stepTimestamp, 'completedProtocols');
          }
          collectFileRecordActivity(dayMap, stepState?.resultFileRecords, stepTimestamp);
          if (
            (!Array.isArray(stepState?.resultFileRecords) || !stepState.resultFileRecords.length)
            && Array.isArray(stepState?.resultFiles)
            && stepState.resultFiles.length
          ) {
            addContributionActivity(dayMap, stepTimestamp, 'dataUploads', stepState.resultFiles.length);
          }
          if (String(stepState?.result || '').trim()) {
            addContributionActivity(dayMap, stepTimestamp, 'analysisNotes');
          }
        });
      });
    });
  }

  function collectAnalysisContribution(dayMap) {
    (Array.isArray(state.assays) ? state.assays : []).forEach((assay) => {
      const timestamp = assay?.updatedAt || assay?.createdAt;
      if (assay?.resultValues && typeof assay.resultValues === 'object' && Object.keys(assay.resultValues).length) {
        addContributionActivity(dayMap, timestamp, 'dataUploads');
      }
      if (assay?.latestAnalysis && typeof assay.latestAnalysis === 'object') {
        addContributionActivity(dayMap, assay.latestAnalysis.updatedAt || timestamp, 'analysisNotes');
      }
    });

    (Array.isArray(state.gelAnalyses) ? state.gelAnalyses : []).forEach((analysis) => {
      const timestamp = analysis?.updatedAt || analysis?.createdAt;
      if (analysis?.imageName || analysis?.report || analysis?.previewImagePath || analysis?.previewImageDataUrl) {
        addContributionActivity(dayMap, timestamp, 'dataUploads');
      }
      addContributionActivity(dayMap, timestamp, 'analysisNotes');
    });
  }

  function collectQuickLogContribution(dayMap) {
    (Array.isArray(state.settings?.dashboard?.quickLogEntries) ? state.settings.dashboard.quickLogEntries : [])
      .forEach((entry) => {
        addContributionActivity(dayMap, entry?.createdAt || entry?.updatedAt, 'quickLogs');
      });
  }

  function collectContributionActivity() {
    const dayMap = new Map();
    collectNotebookContribution(dayMap);
    collectWorkflowContribution(dayMap);
    collectAnalysisContribution(dayMap);
    collectQuickLogContribution(dayMap);
    return dayMap;
  }

  function startOfWeek(date) {
    const clone = new Date(date);
    clone.setHours(0, 0, 0, 0);
    clone.setDate(clone.getDate() - clone.getDay());
    return clone;
  }

  function addDays(date, days) {
    const clone = new Date(date);
    clone.setDate(clone.getDate() + days);
    return clone;
  }

  function contributionLevel(total) {
    const count = Number(total) || 0;
    if (count <= 0) {
      return 0;
    }
    if (count === 1) {
      return 1;
    }
    if (count <= 3) {
      return 2;
    }
    if (count <= 6) {
      return 3;
    }
    return 4;
  }

  function buildContributionDays(dayMap) {
    const weekCount = 22;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = startOfWeek(today);
    start.setDate(start.getDate() - ((weekCount - 1) * 7));
    return Array.from({ length: weekCount * 7 }, (_item, index) => {
      const date = addDays(start, index);
      const dayKey = formatDateLocal(date);
      const bucket = dayMap.get(dayKey) || createContributionBucket();
      return {
        date,
        dayKey,
        bucket,
        level: contributionLevel(bucket.total),
        isFuture: date.getTime() > today.getTime()
      };
    });
  }

  function formatContributionDate(date) {
    return date.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  function formatContributionPart(count, label) {
    const value = Number(count) || 0;
    if (!value) {
      return '';
    }
    return `${value} ${label}${value === 1 ? '' : 's'}`;
  }

  function contributionCellLabel(day) {
    const total = Number(day.bucket.total) || 0;
    const dateLabel = formatContributionDate(day.date);
    if (!total) {
      return `No logged activity on ${dateLabel}`;
    }
    const parts = [
      formatContributionPart(day.bucket.notebookEntries, 'notebook entry'),
      formatContributionPart(day.bucket.completedProtocols, 'completed protocol'),
      formatContributionPart(day.bucket.dataUploads, 'data upload'),
      formatContributionPart(day.bucket.analysisNotes, 'analysis note'),
      formatContributionPart(day.bucket.quickLogs, 'quick log')
    ].filter(Boolean);
    return `${total} logged activit${total === 1 ? 'y' : 'ies'} on ${dateLabel}: ${parts.join(', ')}`;
  }

  function renderContributionMonthLabels(days) {
    const seenMonths = new Set();
    const labels = [];
    days.forEach((day, index) => {
      const monthKey = `${day.date.getFullYear()}-${day.date.getMonth()}`;
      if (seenMonths.has(monthKey)) {
        return;
      }
      if (index > 0 && day.date.getDate() > 7) {
        return;
      }
      seenMonths.add(monthKey);
      labels.push({
        column: Math.floor(index / 7) + 1,
        label: day.date.toLocaleDateString([], { month: 'short' })
      });
    });
    const weekCount = Math.ceil(days.length / 7);
    monthLabels.style.gridTemplateColumns = `repeat(${weekCount}, var(--contribution-cell-size))`;
    monthLabels.innerHTML = labels.map((label) => `
      <span class="home-contribution-month-label" style="grid-column: ${label.column} / span 3;">${safeText(label.label)}</span>
    `).join('');
  }

  function renderContributionWidget(dayMap) {
    const days = buildContributionDays(dayMap);
    const visibleDays = days.filter((day) => !day.isFuture);
    const activeDays = visibleDays.filter((day) => day.bucket.total > 0).length;
    const totalActivity = visibleDays.reduce((sum, day) => sum + day.bucket.total, 0);
    const todayKey = formatDateLocal(new Date());
    const todayTotal = dayMap.get(todayKey)?.total || 0;
    summary.textContent = totalActivity
      ? `${totalActivity} logged activit${totalActivity === 1 ? 'y' : 'ies'} across ${activeDays} active day${activeDays === 1 ? '' : 's'} | Today: ${todayTotal}`
      : 'No activity logged in the last 18 weeks.';

    renderContributionMonthLabels(days);
    grid.innerHTML = days.map((day) => `
      <span
        class="home-contribution-cell"
        data-level="${day.isFuture ? 0 : day.level}"
        role="gridcell"
        tabindex="0"
        title="${safeText(contributionCellLabel(day))}"
        aria-label="${safeText(contributionCellLabel(day))}"
      ></span>
    `).join('');
  }

  function render() {
    renderContributionWidget(collectContributionActivity());
  }

  return {
    render,
    handleEscape: () => false
  };
}
