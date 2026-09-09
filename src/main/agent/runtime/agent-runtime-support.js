'use strict';

const { createAgentLlmRuntimeHelpers } = require('../../lib/llm/runtime-helpers.js');
const { normalizePaperAnnotationSnapshot } = require('../../papers/shared/paper-comment-context.js');
const { normalizeChemicalStorePayload } = require('../../data/data-snapshot-utils.js');

function createAgentRuntimeSupport(deps = {}) {
  const {
    asArray,
    cleanText
  } = createAgentLlmRuntimeHelpers(deps);

  function clamp(value, min, max) {
    const numeric = Number.isFinite(Number(value)) ? Number(value) : min;
    return Math.max(min, Math.min(max, numeric));
  }

  function normalizePreferredJournalNames(value) {
    const candidates = [];
    function pushCandidate(candidate) {
      if (Array.isArray(candidate)) {
        candidate.forEach(pushCandidate);
        return;
      }
      if (candidate && typeof candidate === 'object') {
        pushCandidate(candidate.name || candidate.url || candidate.href || '');
        return;
      }
      String(candidate || '')
        .split(/[;\n]+/)
        .map((item) => cleanText(item, 240).trim())
        .filter(Boolean)
        .forEach((item) => candidates.push(item));
    }
    pushCandidate(value);
    return asArray(candidates)
      .filter((item, index, list) => {
        const key = item.toLowerCase();
        return key && list.findIndex((candidate) => candidate.toLowerCase() === key) === index;
      })
      .slice(0, 12);
  }

  function buildProjectRecordIndex({ snapshot } = {}) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const projects = asArray(source.projects);
    const protocols = asArray(source.protocols);
    const workflows = asArray(source.workflows);
    const notebookEntries = asArray(source.notebookEntries);
    const papers = asArray(source.papers);
    const byProjectId = {};
    const byProjectName = {};

    const ensureProjectBucket = (projectId, projectName) => {
      const idKey = cleanText(projectId, 120).toLowerCase();
      const nameKey = cleanText(projectName, 220).toLowerCase();
      if (idKey && !byProjectId[idKey]) {
        byProjectId[idKey] = {
          protocols: [],
          workflows: [],
          notebook_entries: [],
          papers: []
        };
      }
      if (nameKey && !byProjectName[nameKey]) {
        byProjectName[nameKey] = {
          protocols: [],
          workflows: [],
          notebook_entries: [],
          papers: []
        };
      }
      return { idKey, nameKey };
    };

    const pushUnique = (bucket, key, value) => {
      const normalized = cleanText(value, 160);
      if (!normalized || !Array.isArray(bucket[key]) || bucket[key].includes(normalized)) {
        return;
      }
      bucket[key].push(normalized);
    };

    const pickEntryId = (entry) => cleanText(
      entry?.id
        || entry?.protocolId
        || entry?.protocol_id
        || entry?.workflowId
        || entry?.workflow_id
        || entry?.entryId
        || entry?.entry_id
        || entry?.paperId
        || entry?.paper_id
        || entry?.title
        || entry?.name,
      220
    );

    const resolveProjectRef = (entry) => ({
      id: cleanText(
        entry?.projectId
          || entry?.project_id
          || entry?.project?.id
          || entry?.project_ref?.id
          || '',
        120
      ),
      name: cleanText(
        entry?.projectName
          || entry?.project_name
          || entry?.project?.name
          || entry?.project_ref?.name
          || '',
        220
      )
    });

    projects.forEach((project) => {
      ensureProjectBucket(project?.id, project?.name);
    });

    const attachRows = (rows, field) => {
      rows.forEach((row) => {
        const { id, name } = resolveProjectRef(row);
        const { idKey, nameKey } = ensureProjectBucket(id, name);
        const rowId = pickEntryId(row);
        if (idKey && byProjectId[idKey]) {
          pushUnique(byProjectId[idKey], field, rowId);
        }
        if (nameKey && byProjectName[nameKey]) {
          pushUnique(byProjectName[nameKey], field, rowId);
        }
      });
    };

    attachRows(protocols, 'protocols');
    attachRows(workflows, 'workflows');
    attachRows(notebookEntries, 'notebook_entries');
    attachRows(papers, 'papers');

    return {
      by_project_id: byProjectId,
      by_project_name: byProjectName
    };
  }

  function normalizeAgentSnapshot(rawSnapshot) {
    const snapshot = rawSnapshot && typeof rawSnapshot === 'object' ? rawSnapshot : {};
    const experimentData = snapshot.experimentData && typeof snapshot.experimentData === 'object'
      ? snapshot.experimentData
      : {};
    const normalizedPersonalInventory = Array.isArray(snapshot.inventory?.personal)
      ? asArray(snapshot.inventory.personal).slice(0, 40)
      : snapshot.inventory?.personal && typeof snapshot.inventory.personal === 'object'
        ? Object.entries(snapshot.inventory.personal)
          .slice(0, 40)
          .map(([zone, items]) => ({
            zone: cleanText(zone, 80),
            items: asArray(items).slice(0, 60)
          }))
        : [];
    const assays = asArray(snapshot.assays).length
      ? asArray(snapshot.assays).slice(0, 80)
      : asArray(experimentData.assay_runs).slice(0, 80);
    const gelAnalyses = asArray(snapshot.gelAnalyses).length
      ? asArray(snapshot.gelAnalyses).slice(0, 80)
      : asArray(experimentData.gel_runs).slice(0, 80);
    const normalizedChemicalInventory = asArray(snapshot.inventory?.chemicals).length
      ? asArray(snapshot.inventory.chemicals).slice(0, 220)
      : asArray(snapshot.labInventory?.chemicals).slice(0, 220);
    const normalizedExperimentData = {
      schema_name: cleanText(experimentData.schema_name, 80) || 'hikari_experiment_json',
      schema_version: cleanText(experimentData.schema_version, 20) || '1.0',
      generated_utc: cleanText(experimentData.generated_utc, 80) || cleanText(snapshot.timestamp, 80),
      notebook_runs: asArray(experimentData.notebook_runs).slice(0, 120),
      assay_runs: asArray(experimentData.assay_runs).slice(0, 80),
      gel_runs: asArray(experimentData.gel_runs).slice(0, 80)
    };
    if (!normalizedExperimentData.assay_runs.length && assays.length) {
      normalizedExperimentData.assay_runs = assays;
    }
    if (!normalizedExperimentData.gel_runs.length && gelAnalyses.length) {
      normalizedExperimentData.gel_runs = gelAnalyses;
    }
    const normalizedPapers = asArray(snapshot.papers)
      .slice(0, 80)
      .map((paper) => normalizePaperAnnotationSnapshot(paper, { asArray, cleanText }));
    const activePaper = snapshot.activePaper && typeof snapshot.activePaper === 'object' && !Array.isArray(snapshot.activePaper)
      ? normalizePaperAnnotationSnapshot(snapshot.activePaper, { asArray, cleanText })
      : null;
    const paperAgentSource = snapshot.paper_agent && typeof snapshot.paper_agent === 'object' && !Array.isArray(snapshot.paper_agent)
      ? snapshot.paper_agent
      : (snapshot.paperAgent && typeof snapshot.paperAgent === 'object' && !Array.isArray(snapshot.paperAgent)
        ? snapshot.paperAgent
        : {});
    const transformedMarkdownRelativePath = cleanText(
      paperAgentSource.transformed_markdown_relative_path
        || paperAgentSource.transformedMarkdownRelativePath
        || paperAgentSource.knowledge_markdown_relative_path
        || paperAgentSource.knowledgeMarkdownRelativePath
        || activePaper?.transformed_markdown_relative_path
        || activePaper?.knowledge_markdown_relative_path
        || activePaper?.knowledgeMarkdownRelativePath,
      2400
    );
    const paperAgentSessionPrompt = cleanText(paperAgentSource.session_prompt || paperAgentSource.sessionPrompt, 2400);
    const hasPaperAgentContext = Boolean(activePaper || paperAgentSessionPrompt || transformedMarkdownRelativePath);
    const settingsSource = snapshot.settings && typeof snapshot.settings === 'object'
      ? snapshot.settings
      : {};
    const agentSettingsSource = settingsSource.agent && typeof settingsSource.agent === 'object'
      && !Array.isArray(settingsSource.agent)
      ? settingsSource.agent
      : {};
    const disabledMcpToolNames = asArray(
      agentSettingsSource.disabledMcpToolNames
        || agentSettingsSource.disabled_mcp_tool_names
    ).map((name) => cleanText(name, 160)).filter(Boolean);
    const preferredJournals = normalizePreferredJournalNames([
      settingsSource.preferredJournals,
      settingsSource.preferred_journals,
      snapshot.preferredJournals,
      snapshot.preferred_journals,
      settingsSource.preferredJournal,
      settingsSource.preferred_journal,
      snapshot.preferredJournal,
      snapshot.preferred_journal
    ]);
    const preferredJournal = preferredJournals.join('; ');
    const rawScheduledTask = snapshot.scheduled_task || snapshot.scheduledTask;
    const scheduledTaskSource = rawScheduledTask && typeof rawScheduledTask === 'object' && !Array.isArray(rawScheduledTask)
      ? {
        id: cleanText(rawScheduledTask.id, 160),
        task_type: cleanText(rawScheduledTask.task_type || rawScheduledTask.taskType, 80),
        deny_paper_download: rawScheduledTask.deny_paper_download === true
          || rawScheduledTask.denyPaperDownload === true
      }
      : null;
    const normalizedSnapshot = {
      projects: asArray(snapshot.projects).slice(0, 40),
      protocols: asArray(snapshot.protocols).slice(0, 100),
      notebookEntries: asArray(snapshot.notebookEntries).slice(0, 180),
      workflows: asArray(snapshot.workflows).slice(0, 120),
      assays,
      gelAnalyses,
      experimentData: normalizedExperimentData,
      papers: normalizedPapers,
      activePaper,
      paper_agent: hasPaperAgentContext ? {
        active_paper_id: cleanText(
          paperAgentSource.active_paper_id
            || paperAgentSource.activePaperId
            || activePaper?.id
            || activePaper?.paper_id
            || activePaper?.paperId,
          220
        ),
        active_paper_title: cleanText(
          paperAgentSource.active_paper_title
            || paperAgentSource.activePaperTitle
            || activePaper?.title
            || activePaper?.paper_title
            || activePaper?.paperTitle,
          320
        ),
        session_prompt: paperAgentSessionPrompt,
        transformed_markdown_relative_path: transformedMarkdownRelativePath,
        knowledge_status: cleanText(
          paperAgentSource.knowledge_status
            || paperAgentSource.knowledgeStatus
            || activePaper?.knowledge_status
            || activePaper?.knowledgeStatus,
          80
        ),
        has_transformed_markdown: Boolean(transformedMarkdownRelativePath)
      } : null,
      inventory: snapshot.inventory && typeof snapshot.inventory === 'object'
        ? {
          personal: normalizedPersonalInventory,
          chemicals: normalizedChemicalInventory
        }
        : {
          personal: [],
          chemicals: normalizedChemicalInventory
        },
      labInventory: normalizeChemicalStorePayload(snapshot.labInventory),
      settings: {
        storagePath: cleanText(settingsSource.storagePath || snapshot?.storagePath, 1200),
        preferredJournals,
        preferredJournal,
        agent: {
          disabledMcpToolNames
        }
      },
      // Scheduled-task policy has to survive normalization: the paper-download
      // executor reads deny_paper_download off the normalized snapshot.
      ...(scheduledTaskSource ? { scheduled_task: scheduledTaskSource } : {}),
      data_file_path: cleanText(snapshot.data_file_path || snapshot.dataFilePath, 1600),
      timestamp: cleanText(snapshot.timestamp, 80)
    };
    normalizedSnapshot.projectIndex = buildProjectRecordIndex({ snapshot: normalizedSnapshot });
    return normalizedSnapshot;
  }

  function scoreByQuery(text, queryTokens) {
    if (!queryTokens.length) {
      return 1;
    }
    const haystack = String(text || '').toLowerCase();
    return queryTokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
  }

  function normalizeQuery(value) {
    const query = cleanText(value, 300).toLowerCase();
    const tokens = query
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .slice(0, 12);
    return { query, tokens };
  }

  function pickTopMatches(items, buildSearchText, query, limit) {
    const { tokens } = normalizeQuery(query);
    const scored = asArray(items).map((item) => ({
      item,
      score: scoreByQuery(buildSearchText(item), tokens)
    }));
    return scored
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, clamp(Number(limit) || 6, 1, 25))
      .map((entry) => entry.item);
  }

  return {
    normalizeAgentSnapshot,
    normalizeQuery,
    scoreByQuery,
    pickTopMatches
  };
}

module.exports = {
  createAgentRuntimeSupport
};
