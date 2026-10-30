// The contribution heatmap: bucketing a project's activity by day and turning
// those buckets into the week grid the dashboard renders.
function createDashboardContributions({
  CONTRIBUTION_WEEK_COUNT,
  asArray,
  cleanText,
  normalizeKey,
  normalizeNotebookState,
  getProjectNotebookEntries,
  getProjectWorkflows,
  getProjectAssays,
  getProjectGelAnalyses,
  getProjectPapers,
  getProjectSamples
} = {}) {
  function normalizeSampleType(value) {
    return normalizeKey(value).replace(/\s+/g, '_');
  }

  function createContributionBucket() {
    return {
      projectLogs: 0,
      completedProtocols: 0,
      dataUploads: 0,
      analysisNotes: 0,
      papers: 0,
      samples: 0,
      total: 0
    };
  }

  function formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function dayKeyFromTimestamp(timestamp) {
    const parsed = new Date(cleanText(timestamp));
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

  function collectFileRecordActivity(dayMap, records, fallbackTimestamp) {
    asArray(records).forEach((record) => {
      addContributionActivity(
        dayMap,
        record?.importedAt || record?.updatedAt || fallbackTimestamp,
        'dataUploads'
      );
    });
  }

  function resultTableHasContent(entry) {
    const tables = asArray(entry?.resultTables).length ? asArray(entry.resultTables) : [entry?.resultTable].filter(Boolean);
    return tables.some((table) => {
      const rows = asArray(table?.rows);
      return rows.some((row) => Object.entries(row || {}).some(([key, value]) => (
        key !== 'id' && cleanText(value)
      )));
    });
  }

  function collectProjectContributionActivity({ project, notebookEntries, workflows, assays, gelAnalyses, papers, samples }) {
    const dayMap = new Map();

    addContributionActivity(dayMap, project?.updatedAt || project?.createdAt, 'projectLogs');

    notebookEntries.forEach((entry) => {
      if (entry?.notebookState === 'suggested') return;
      const entryTimestamp = entry?.updatedAt || entry?.executedAt || entry?.createdAt;
      addContributionActivity(dayMap, entryTimestamp, 'projectLogs');

      const isExecuted = normalizeNotebookState(entry?.notebookState) !== 'planned';
      if (isExecuted && (entry?.protocolId || entry?.protocolName || entry?.executedAt)) {
        addContributionActivity(dayMap, entry?.executedAt || entryTimestamp, 'completedProtocols');
      }

      const resultFileRecords = asArray(entry?.resultFileRecords);
      collectFileRecordActivity(dayMap, resultFileRecords, entryTimestamp);
      if (!resultFileRecords.length && asArray(entry?.resultFiles).length) {
        addContributionActivity(dayMap, entryTimestamp, 'dataUploads', entry.resultFiles.length);
      }

      if (cleanText(entry?.result) || resultTableHasContent(entry) || asArray(entry?.selectionInsights).length) {
        addContributionActivity(dayMap, entryTimestamp, 'analysisNotes');
      }
    });

    workflows.forEach((workflow) => {
      asArray(workflow?.entries).forEach((entry) => {
        const stepStates = entry?.stepStates && typeof entry.stepStates === 'object' && !Array.isArray(entry.stepStates)
          ? entry.stepStates
          : {};
        Object.values(stepStates).forEach((stepState) => {
          const stepTimestamp = stepState?.updatedAt || stepState?.completedAt || workflow?.updatedAt || workflow?.createdAt;
          if (normalizeKey(stepState?.status) === 'completed' || stepState?.completedAt) {
            addContributionActivity(dayMap, stepState?.completedAt || stepTimestamp, 'completedProtocols');
          }
          collectFileRecordActivity(dayMap, stepState?.resultFileRecords, stepTimestamp);
          if (!asArray(stepState?.resultFileRecords).length && asArray(stepState?.resultFiles).length) {
            addContributionActivity(dayMap, stepTimestamp, 'dataUploads', stepState.resultFiles.length);
          }
          if (cleanText(stepState?.result)) {
            addContributionActivity(dayMap, stepTimestamp, 'analysisNotes');
          }
        });
      });
    });

    assays.forEach((assay) => {
      const timestamp = assay?.updatedAt || assay?.createdAt;
      if (assay?.resultValues && typeof assay.resultValues === 'object' && Object.keys(assay.resultValues).length) {
        addContributionActivity(dayMap, timestamp, 'dataUploads');
      }
      if (assay?.latestAnalysis && typeof assay.latestAnalysis === 'object') {
        addContributionActivity(dayMap, assay.latestAnalysis.updatedAt || timestamp, 'analysisNotes');
      }
    });

    gelAnalyses.forEach((analysis) => {
      const timestamp = analysis?.updatedAt || analysis?.createdAt;
      if (analysis?.imageName || analysis?.report || analysis?.previewImagePath || analysis?.previewImageDataUrl) {
        addContributionActivity(dayMap, timestamp, 'dataUploads');
      }
      addContributionActivity(dayMap, timestamp, 'analysisNotes');
    });

    papers.forEach((paper) => {
      addContributionActivity(dayMap, paper?.updatedAt || paper?.discoveredAt || paper?.createdAt, 'papers');
    });

    samples.forEach((sample) => {
      addContributionActivity(dayMap, sample?.updatedAt || sample?.createdAt, 'samples');
    });

    return dayMap;
  }

  function getProjectSummary(project) {
    const notebookEntries = getProjectNotebookEntries(project);
    const notebookEntryIds = new Set(notebookEntries.map((entry) => entry.id).filter(Boolean));
    const workflows = getProjectWorkflows(project, notebookEntryIds);
    const assays = getProjectAssays(project, notebookEntryIds);
    const gelAnalyses = getProjectGelAnalyses(project, notebookEntryIds);
    const papers = getProjectPapers(project, notebookEntryIds, notebookEntries);
    const samples = getProjectSamples(project, notebookEntries, assays);
    const plasmids = samples.filter((sample) => normalizeSampleType(sample?.type) === 'plasmid');
    const activeDayMap = collectProjectContributionActivity({
      project,
      notebookEntries,
      workflows,
      assays,
      gelAnalyses,
      papers,
      samples
    });

    return {
      notebookEntries,
      workflows,
      assays,
      gelAnalyses,
      papers,
      samples,
      plasmids,
      activeDayMap
    };
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = startOfWeek(today);
    start.setDate(start.getDate() - ((CONTRIBUTION_WEEK_COUNT - 1) * 7));
    return Array.from({ length: CONTRIBUTION_WEEK_COUNT * 7 }, (_item, index) => {
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
      return `No project activity on ${dateLabel}`;
    }
    const parts = [
      formatContributionPart(day.bucket.projectLogs, 'project log'),
      formatContributionPart(day.bucket.completedProtocols, 'completed protocol'),
      formatContributionPart(day.bucket.dataUploads, 'data upload'),
      formatContributionPart(day.bucket.analysisNotes, 'analysis note'),
      formatContributionPart(day.bucket.papers, 'paper'),
      formatContributionPart(day.bucket.samples, 'sample update')
    ].filter(Boolean);
    return `${total} project activit${total === 1 ? 'y' : 'ies'} on ${dateLabel}: ${parts.join(', ')}`;
  }

  return {
    normalizeSampleType,
    createContributionBucket,
    formatDateLocal,
    dayKeyFromTimestamp,
    addContributionActivity,
    collectFileRecordActivity,
    resultTableHasContent,
    collectProjectContributionActivity,
    getProjectSummary,
    startOfWeek,
    addDays,
    contributionLevel,
    buildContributionDays,
    formatContributionDate,
    formatContributionPart,
    contributionCellLabel
  };
}

export { createDashboardContributions };
