'use strict';

const { createAgentLlmRuntimeHelpers } = require('../shared/agent-llm-utils.js');
const { normalizeChemicalStorePayload } = require('../../main/data/data-snapshot-utils.js');

const DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE =
  'You are Lab Agent, an AI assistant for a research lab app. Help users retrieve lab information, reason carefully about scientific questions, and stay explicit about uncertainty.\n\n{{projectScope}}\n\nUse only tools that are explicitly available in the current runtime. If a needed tool is unavailable, say so clearly instead of pretending it succeeded.';
const DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE =
  'Return JSON matching the expected response schema exactly. If evidence is missing, say so plainly.';

function createAgentRuntimeSupport(deps = {}) {
  const {
    asArray,
    cleanText,
    safeParseJson
  } = createAgentLlmRuntimeHelpers(deps);
  const renderPromptTemplate = typeof deps.renderPromptTemplate === 'function'
    ? deps.renderPromptTemplate
    : ((template, vars = {}) => String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => String(vars[key] ?? '')));
  const defaultSystemPrompt = String(deps.DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE || '').trim()
    || DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE;
  const defaultSynthesisPrompt = String(deps.DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE || '').trim()
    || DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE;

  function clamp(value, min, max) {
    const numeric = Number.isFinite(Number(value)) ? Number(value) : min;
    return Math.max(min, Math.min(max, numeric));
  }

  function normalizeRoutingPayload(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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
      schema_name: cleanText(experimentData.schema_name, 80) || 'enana_experiment_json',
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
      .map((paper) => {
        if (!paper || typeof paper !== 'object' || Array.isArray(paper)) {
          return paper;
        }
        const { comments, ...rest } = paper;
        return rest;
      });
    const normalizedSnapshot = {
      projects: asArray(snapshot.projects).slice(0, 40),
      protocols: asArray(snapshot.protocols).slice(0, 100),
      notebookEntries: asArray(snapshot.notebookEntries).slice(0, 180),
      workflows: asArray(snapshot.workflows).slice(0, 120),
      assays,
      gelAnalyses,
      experimentData: normalizedExperimentData,
      papers: normalizedPapers,
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
        storagePath: cleanText(snapshot?.settings?.storagePath || snapshot?.storagePath, 1200)
      },
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

  function buildAgentSystemPrompt(projectName, prompts) {
    const projectScope = projectName ? `Scoped project: ${projectName}.` : 'Scope: all projects.';
    const template = String(prompts?.agent?.systemPromptTemplate || '').trim() || defaultSystemPrompt;
    const rendered = renderPromptTemplate(template, { projectScope });
    const skillsCatalogPrompt = cleanText(prompts?.agent?.skillsCatalogPrompt, 16000);
    const activeSkillsPrompt = cleanText(prompts?.agent?.activeSkillsPrompt, 24000);
    return [rendered, skillsCatalogPrompt, activeSkillsPrompt].filter(Boolean).join('\n\n');
  }

  function buildAgentSynthesisPrompt(_requiresApproval, prompts) {
    const template = String(prompts?.agent?.synthesisPromptTemplate || '').trim() || defaultSynthesisPrompt;
    return renderPromptTemplate(template, {});
  }

  function normalizeAgentOutput(raw, fallbackText) {
    const parsed = safeParseJson(raw, null);
    if (parsed && typeof parsed === 'object') {
      return {
        answer: cleanText(parsed.answer, 12000) || fallbackText || 'No answer generated.',
        confidence: Number.isFinite(parsed.confidence) ? clamp(Number(parsed.confidence), 0, 1) : 0.55,
        requiresApproval: parsed.requires_approval === true,
        proposedWriteActions: asArray(parsed.proposed_write_actions),
        citations: asArray(parsed.citations),
        decisionRecord: parsed.decision_record && typeof parsed.decision_record === 'object'
          ? parsed.decision_record
          : { assumptions: [], open_questions: [], verification_notes: [] }
      };
    }

    return {
      answer: fallbackText || 'No answer generated.',
      confidence: 0.55,
      requiresApproval: false,
      proposedWriteActions: [],
      citations: [],
      decisionRecord: {
        assumptions: [],
        open_questions: [],
        verification_notes: ['Structured synthesis was unavailable; returned plain-text fallback.']
      }
    };
  }

  function toPromptConversationTranscript(conversation) {
    const rows = asArray(conversation).map((item, index) => {
      const role = item?.role === 'assistant' ? 'assistant' : 'user';
      return `${index + 1}. ${role}: ${cleanText(item?.text, 2400)}`;
    }).filter(Boolean);
    return rows.length ? rows.join('\n') : 'No prior messages.';
  }

  return {
    DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE: defaultSystemPrompt,
    DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE: defaultSynthesisPrompt,
    normalizeRoutingPayload,
    normalizeAgentSnapshot,
    normalizeQuery,
    scoreByQuery,
    pickTopMatches,
    buildAgentSystemPrompt,
    buildAgentSynthesisPrompt,
    normalizeAgentOutput,
    toPromptConversationTranscript
  };
}

module.exports = {
  DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE,
  createAgentRuntimeSupport
};
